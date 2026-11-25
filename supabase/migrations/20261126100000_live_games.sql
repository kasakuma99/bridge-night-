-- Live games from League, 5v5 and uneven teams, more game details, and linking members to players.
-- Only adds things: the site that is live today keeps working. The private lock is in supabase/release/.

/* ------------------------------------------------------------ game details */

alter table public.matches drop constraint matches_mode_check;
alter table public.matches add constraint matches_mode_check check (mode between 1 and 5);
alter table public.matches
  add column end_reason   text check (end_reason in ('nexus', 'ff', 'early', 'left', 'unknown')),
  add column duration_sec int  check (duration_sec between 1 and 36000),
  add column guests       jsonb check (jsonb_typeof(guests) = 'array' and octet_length(guests::text) <= 20000),
  add column game_mode    text check (char_length(game_mode) <= 40),
  add column map          text check (char_length(map) <= 40);
comment on column public.matches.guests is 'Bots and people who are not on the site (never with a Riot ID).';

alter table public.match_participants
  add column level    smallint check (level between 0 and 100),
  add column spells   int[],
  add column augments int[];

/* ----------------------------------------------------------------- members */

-- 'blocked': declined or removed. They stay out, also when they log in again, until an admin lets them back in.
alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('pending', 'member', 'admin', 'blocked'));
alter table public.members add column player_id uuid unique references public.players (id) on delete set null;
grant update (player_id) on public.members to authenticated; -- RLS: admins only

-- The signup trigger runs once per account. Someone whose row was deleted would wait forever without this.
create function public.ensure_member() returns text
language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Log in first' using errcode = '42501'; end if;
  insert into public.members (user_id, display_name, avatar_url)
  select u.id,
         left(coalesce(u.raw_user_meta_data -> 'custom_claims' ->> 'global_name', u.raw_user_meta_data ->> 'full_name',
                       u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'user_name', ''), 60),
         case when u.raw_user_meta_data ->> 'avatar_url' like 'https://cdn.discordapp.com/%'
              then left(u.raw_user_meta_data ->> 'avatar_url', 300) end
  from auth.users u where u.id = auth.uid()
  on conflict (user_id) do nothing;
  select role into v_role from public.members where user_id = auth.uid();
  return v_role;
end $$;
revoke execute on function public.ensure_member() from public, anon;
grant execute on function public.ensure_member() to authenticated;

/* --------------------------------------------------------------- live game */

-- Off while testing: finished games go to test_games and don't count. On at release.
alter table public.settings add column save_live_games boolean not null default false;

-- What the site shows. No Riot IDs. At most one row. Only the "live" Edge Function writes.
create table public.live_feed (
  singleton  boolean primary key default true check (singleton),
  data       jsonb not null check (octet_length(data::text) <= 200000),
  updated_at timestamptz not null default now()
);
-- The full state between two updates, with Riot IDs. Never readable from the site.
create table public.live_state (
  singleton  boolean primary key default true check (singleton),
  data       jsonb check (octet_length(data::text) <= 400000),
  token_id   uuid references public.helper_tokens (id) on delete set null,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);
create table public.test_games (
  game_id    text primary key check (char_length(game_id) <= 40),
  data       jsonb not null check (octet_length(data::text) <= 100000),
  created_at timestamptz not null default now()
);

alter table public.live_feed  enable row level security;
alter table public.live_state enable row level security;
alter table public.test_games enable row level security;
create policy live_feed_read  on public.live_feed  for select to authenticated using ((select public.is_member()));
create policy test_games_read on public.test_games for select to authenticated using ((select public.is_member()));

revoke all on public.live_feed, public.live_state, public.test_games from anon, authenticated;
grant select on public.live_feed, public.test_games to authenticated;
grant select, insert, update, delete on public.live_feed, public.live_state, public.test_games to service_role;
alter publication supabase_realtime add table public.live_feed, public.test_games;

-- Saves the next state if nobody else did in the meantime. p_feed null: unchanged, unless p_clear removes it.
create function public._put_live(p_version bigint, p_state jsonb, p_feed jsonb, p_clear boolean, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.live_state (singleton) values (true) on conflict do nothing;
  update public.live_state
  set data = nullif(p_state, 'null'::jsonb), token_id = p_token, version = version + 1, updated_at = now()
  where version = p_version;
  if not found then return false; end if;
  if p_clear then
    delete from public.live_feed where true;
  elsif p_feed is not null then
    insert into public.live_feed (data, updated_at) values (p_feed, now())
    on conflict (singleton) do update set data = excluded.data, updated_at = now();
  end if;
  return true;
end $$;

-- Saves a finished game (shape: the site's Match) once. Later calls add details such as augments, but never change
-- who won. p_known: it was saved before, so a game that is gone was deleted and stays away.
create function public._save_live_game(m jsonb, p_known boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_game text := nullif(m ->> 'gameId', '');
  v_old  public.matches;
  v_id   uuid;
  v_same boolean := true;
begin
  if v_game is null then raise exception 'Missing game id'; end if;
  if m ->> 'winner' not in ('blue', 'red') then raise exception 'Winner must be blue or red'; end if;

  select * into v_old from public.matches where game_id = v_game for update;
  if v_old.id is null and p_known then return null; end if;

  if v_old.id is null then
    insert into public.matches (played_at, mode, winner, game_id, duration_min, duration_sec, surrender, end_reason, guests, game_mode, map)
    values (
      to_timestamp((m ->> 'playedAt')::bigint / 1000.0), (m ->> 'mode')::smallint, m ->> 'winner', v_game,
      least(greatest((m ->> 'durationMin')::int, 1), 600), least(greatest((m ->> 'durationSec')::int, 1), 36000),
      m ->> 'surrender', m ->> 'end', nullif(m -> 'guests', 'null'::jsonb), left(m ->> 'gameMode', 40), left(m ->> 'map', 40))
    on conflict (game_id) do nothing
    returning id into v_id;
    if v_id is null then -- another helper was faster
      select id into v_id from public.matches where game_id = v_game;
    end if;
  else
    v_id := v_old.id;
    v_same := v_old.winner = m ->> 'winner';
    update public.matches set
      duration_min = coalesce(duration_min, least(greatest((m ->> 'durationMin')::int, 1), 600)),
      duration_sec = coalesce(least(greatest((m ->> 'durationSec')::int, 1), 36000), duration_sec),
      surrender    = case when v_same then m ->> 'surrender' else surrender end,
      end_reason   = case when v_same then m ->> 'end' else end_reason end,
      guests       = coalesce(nullif(m -> 'guests', 'null'::jsonb), guests),
      game_mode    = coalesce(left(m ->> 'gameMode', 40), game_mode),
      map          = coalesce(left(m ->> 'map', 40), map)
    where id = v_id;
  end if;

  insert into public.match_participants as mp
    (match_id, player_id, team, slot, champion, kills, deaths, assists, items, damage, level, spells, augments)
  select v_id, pl.id, t.team, (e.ord - 1)::smallint, left(nullif(s ->> 'champion', ''), 40),
         (s ->> 'kills')::int, (s ->> 'deaths')::int, (s ->> 'assists')::int,
         public._ints(s -> 'items'), (s ->> 'damage')::int, (s ->> 'level')::smallint,
         public._ints(s -> 'spells'), public._ints(s -> 'augments')
  from (values ('blue'), ('red')) t (team)
  cross join lateral jsonb_array_elements_text(coalesce(m -> t.team, '[]')) with ordinality e (pid, ord)
  join public.players pl on pl.id = e.pid::uuid
  cross join lateral (select m -> 'stats' -> e.pid as s) st
  on conflict (match_id, player_id) do update set
    champion = coalesce(excluded.champion, mp.champion),
    kills    = coalesce(excluded.kills, mp.kills),
    deaths   = coalesce(excluded.deaths, mp.deaths),
    assists  = coalesce(excluded.assists, mp.assists),
    items    = coalesce(excluded.items, mp.items),
    damage   = coalesce(excluded.damage, mp.damage),
    level    = coalesce(excluded.level, mp.level),
    spells   = coalesce(excluded.spells, mp.spells),
    augments = coalesce(excluded.augments, mp.augments);

  -- The same game sent by an older helper doesn't need confirming any more.
  delete from public.pending_results where game_id = v_game;
  return v_id;
end $$;

create function public._ints(j jsonb) returns int[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'array' then array(select x::int from jsonb_array_elements_text(j) x) end;
$$;

revoke execute on function public._put_live(bigint, jsonb, jsonb, boolean, uuid), public._save_live_game(jsonb, boolean), public._ints(jsonb)
  from public, anon, authenticated;
grant execute on function public._put_live(bigint, jsonb, jsonb, boolean, uuid), public._save_live_game(jsonb, boolean), public._ints(jsonb)
  to service_role;
grant select on public.members, public.helper_tokens to service_role;
