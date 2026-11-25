-- Bridge Night: initial schema.
-- Visitors (anon) can read public game data. Only approved members can write.
-- Riot IDs are members-only. members and helper_tokens are admin-only (plus your own member row).
-- Ratings, streaks, badges, awards are NOT stored: the site calculates them from the match list.

create extension if not exists pgcrypto with schema extensions;

/* ------------------------------------------------------------------ members */

create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url   text,
  role         text not null default 'pending' check (role in ('pending', 'member', 'admin')),
  created_at   timestamptz not null default now()
);
comment on table public.members is 'Allowlist. Everyone who logs in gets a pending row; an admin approves them.';

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role in ('member', 'admin'));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin');
$$;

-- Every new login gets a pending member row (name + avatar from Discord).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.members (user_id, display_name, avatar_url)
  values (
    new.id,
    left(coalesce(
      new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'user_name',
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ), 60),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ------------------------------------------------------------------ players */

create table public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 20),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index players_active_name_key on public.players (lower(name)) where active;

-- Separate table so visitors never see Riot IDs.
create table public.player_riot_ids (
  player_id uuid primary key references public.players (id) on delete cascade,
  riot_id   text not null check (riot_id ~ '^[^#]{1,40}#[^#]{1,10}$')
);
create unique index player_riot_ids_riot_id_key on public.player_riot_ids (lower(riot_id));

/* ------------------------------------------------------------------ matches */

create table public.matches (
  id           uuid primary key default gen_random_uuid(),
  played_at    timestamptz not null default now(),
  mode         smallint not null check (mode between 1 and 4),
  winner       text not null check (winner in ('blue', 'red')),
  sit_out      uuid[] not null default '{}',
  challenge    text check (char_length(challenge) <= 120),
  duration_min int check (duration_min between 1 and 600),
  game_id      text unique,  -- Riot game id from the helper: dedupe
  live_id      uuid unique,  -- live game it came from: saved only once
  created_by   uuid default auth.uid() references auth.users (id) on delete set null
);
create index matches_played_at_idx on public.matches (played_at desc);

create table public.match_participants (
  match_id   uuid not null references public.matches (id) on delete cascade,
  player_id  uuid not null references public.players (id),
  team       text not null check (team in ('blue', 'red')),
  slot       smallint not null default 0,
  champion   text check (char_length(champion) <= 40),
  kills      int check (kills between 0 and 999),
  deaths     int check (deaths between 0 and 999),
  assists    int check (assists between 0 and 999),
  items      int[],
  damage     int check (damage >= 0),
  primary key (match_id, player_id)
);
create index match_participants_player_idx on public.match_participants (player_id);

create table public.dodge_log (
  id        bigint generated always as identity primary key,
  match_id  uuid not null references public.matches (id) on delete cascade,
  player_id uuid references public.players (id),
  side      text not null check (side in ('blue', 'red')),
  champion  text not null default '',
  at        timestamptz not null
);
create index dodge_log_match_idx on public.dodge_log (match_id);

/* ---------------------------------------------------------------- live game */

-- At most one row (singleton). The whole live game state lives in data (same shape as the site's LiveGame).
create table public.live_game (
  id         uuid primary key,
  singleton  boolean not null default true unique check (singleton),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

/* ----------------------------------------------------------------- settings */

create table public.settings (
  id                    smallint primary key default 1 check (id = 1),
  dodge_hours           numeric(5, 2) not null default 12 check (dodge_hours between 0 and 168),
  dodges_per_team       int not null default 2 check (dodges_per_team between 0 and 10),
  reroll_limit          int not null default 2 check (reroll_limit between -1 and 50),
  challenges_enabled    boolean not null default true,
  discord_url           text not null default 'https://discord.gg/mEAF2C9Qq' check (discord_url ~ '^https://'),
  review_helper_results boolean not null default true,
  updated_at            timestamptz not null default now()
);
insert into public.settings default values;

/* ------------------------------------------------------------ helper tokens */

create table public.helper_tokens (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 40),
  token_hash   text not null unique,  -- sha256 hex; the token itself is shown once and never stored
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

/* ---------------------------------------------------------------- functions */

-- Start / update / clear the live game. Refuses to bring back a game that was already saved.
create or replace function public.set_live(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  if p_data is null or p_data = 'null'::jsonb then
    delete from public.live_game where true;
    return;
  end if;
  v_id := (p_data ->> 'id')::uuid;
  if exists (select 1 from public.matches where live_id = v_id) then
    raise exception 'This game was already saved' using errcode = 'P0001';
  end if;
  delete from public.live_game where id <> v_id;
  insert into public.live_game (id, data, updated_at) values (v_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

-- Saves the live game as a match exactly once (row lock + unique live_id).
-- Returns the new match id, or null if it was already saved / no longer live.
create or replace function public.save_live_result(p_live_id uuid, p_winner text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  L     jsonb;
  v_mid uuid;
  v_dur int;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  if p_winner not in ('blue', 'red') then raise exception 'Winner must be blue or red'; end if;

  select data into L from public.live_game where id = p_live_id for update;
  if L is null then return null; end if;

  v_dur := coalesce(
    nullif(L ->> 'durationMin', '')::int,
    case when nullif(L ->> 'startedAt', '') is not null
      then greatest(1, round((extract(epoch from now()) * 1000 - (L ->> 'startedAt')::bigint) / 60000.0))::int end
  );

  insert into public.matches (mode, winner, sit_out, challenge, duration_min, live_id)
  values (
    (L ->> 'size')::smallint,
    p_winner,
    coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(L -> 'sitOut', '[]')) x), '{}'),
    nullif(L ->> 'challenge', ''),
    least(v_dur, 600),
    p_live_id
  )
  on conflict (live_id) do nothing
  returning id into v_mid;

  if v_mid is null then
    delete from public.live_game where id = p_live_id;
    return null;
  end if;

  insert into public.match_participants (match_id, player_id, team, slot, champion, kills, deaths, assists, items, damage)
  select v_mid, e.pid::uuid, t.team, (e.ord - 1)::smallint,
         nullif(s ->> 'champion', ''),
         (s ->> 'kills')::int, (s ->> 'deaths')::int, (s ->> 'assists')::int,
         case when jsonb_typeof(s -> 'items') = 'array'
              then array(select i::int from jsonb_array_elements_text(s -> 'items') i) end,
         (s ->> 'damage')::int
  from (values ('blue'), ('red')) t (team)
  cross join lateral jsonb_array_elements_text(coalesce(L -> t.team, '[]')) with ordinality e (pid, ord)
  cross join lateral (select L -> 'stats' -> e.pid as s) st;

  insert into public.dodge_log (match_id, player_id, side, champion, at)
  select v_mid, nullif(d ->> 'playerId', '')::uuid, d ->> 'side', coalesce(d ->> 'champion', ''),
         to_timestamp((d ->> 'at')::bigint / 1000.0)
  from jsonb_array_elements(coalesce(L -> 'dodgeLog', '[]')) d;

  delete from public.live_game where id = p_live_id;
  return v_mid;
end $$;

-- Admin: create a helper token. Returns the token ONCE; only its hash is stored.
create or replace function public.create_helper_token(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  v_token := 'bnh_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.helper_tokens (name, token_hash)
  values (left(trim(p_name), 40), encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end $$;

-- Admin: replace players, Riot IDs, matches and settings from a backup (one transaction).
create or replace function public.restore_backup(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare s jsonb := coalesce(p -> 'settings', '{}');
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p ->> 'app' is distinct from 'bridge-night' or jsonb_typeof(p -> 'players') <> 'array'
     or jsonb_typeof(p -> 'matches') <> 'array' then
    raise exception 'That file is not a Bridge Night backup';
  end if;

  delete from public.live_game where true;
  delete from public.matches where true;          -- participants + dodges cascade
  delete from public.player_riot_ids where true;
  delete from public.players where true;

  insert into public.players (id, name, active, created_at)
  select (x ->> 'id')::uuid, x ->> 'name', coalesce((x ->> 'active')::boolean, true),
         coalesce(to_timestamp((x ->> 'createdAt')::bigint / 1000.0), now())
  from jsonb_array_elements(p -> 'players') x;

  insert into public.player_riot_ids (player_id, riot_id)
  select (x ->> 'id')::uuid, x ->> 'riotId'
  from jsonb_array_elements(p -> 'players') x
  where nullif(x ->> 'riotId', '') is not null;

  insert into public.matches (id, played_at, mode, winner, sit_out, challenge, duration_min, game_id, live_id)
  select (m ->> 'id')::uuid, to_timestamp((m ->> 'playedAt')::bigint / 1000.0), (m ->> 'mode')::smallint,
         m ->> 'winner',
         coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(m -> 'sitOut', '[]')) x), '{}'),
         nullif(m ->> 'challenge', ''), (m ->> 'durationMin')::int, nullif(m ->> 'gameId', ''),
         nullif(m ->> 'liveId', '')::uuid
  from jsonb_array_elements(p -> 'matches') m;

  insert into public.match_participants (match_id, player_id, team, slot, champion, kills, deaths, assists, items, damage)
  select (m ->> 'id')::uuid, e.pid::uuid, t.team, (e.ord - 1)::smallint,
         nullif(st ->> 'champion', ''),
         (st ->> 'kills')::int, (st ->> 'deaths')::int, (st ->> 'assists')::int,
         case when jsonb_typeof(st -> 'items') = 'array'
              then array(select i::int from jsonb_array_elements_text(st -> 'items') i) end,
         (st ->> 'damage')::int
  from jsonb_array_elements(p -> 'matches') m
  cross join (values ('blue'), ('red')) t (team)
  cross join lateral jsonb_array_elements_text(coalesce(m -> t.team, '[]')) with ordinality e (pid, ord)
  cross join lateral (select m -> 'stats' -> e.pid as st) z;

  insert into public.dodge_log (match_id, player_id, side, champion, at)
  select (m ->> 'id')::uuid, nullif(d ->> 'playerId', '')::uuid, d ->> 'side', coalesce(d ->> 'champion', ''),
         to_timestamp((d ->> 'at')::bigint / 1000.0)
  from jsonb_array_elements(p -> 'matches') m
  cross join lateral jsonb_array_elements(coalesce(m -> 'dodges', '[]')) d;

  update public.settings set
    dodge_hours        = coalesce((s ->> 'dodgeHours')::numeric, dodge_hours),
    dodges_per_team    = coalesce((s ->> 'dodgesPerTeam')::int, dodges_per_team),
    reroll_limit       = coalesce((s ->> 'rerollLimit')::int, reroll_limit),
    challenges_enabled = coalesce((s ->> 'challengesEnabled')::boolean, challenges_enabled),
    discord_url        = coalesce(nullif(s ->> 'discordUrl', ''), discord_url),
    updated_at         = now()
  where id = 1;
end $$;

/* ------------------------------------------------------------- RLS policies */

alter table public.members            enable row level security;
alter table public.players            enable row level security;
alter table public.player_riot_ids    enable row level security;
alter table public.matches            enable row level security;
alter table public.match_participants enable row level security;
alter table public.dodge_log          enable row level security;
alter table public.live_game          enable row level security;
alter table public.settings           enable row level security;
alter table public.helper_tokens      enable row level security;

-- members: see your own row; admins see and manage everyone.
create policy members_select on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy members_update on public.members for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy members_delete on public.members for delete to authenticated
  using ((select public.is_admin()) and user_id <> (select auth.uid()));

-- public game data: everyone reads.
create policy players_read  on public.players            for select to anon, authenticated using (true);
create policy matches_read  on public.matches            for select to anon, authenticated using (true);
create policy parts_read    on public.match_participants for select to anon, authenticated using (true);
create policy dodges_read   on public.dodge_log          for select to anon, authenticated using (true);
create policy live_read     on public.live_game          for select to anon, authenticated using (true);
create policy settings_read on public.settings           for select to anon, authenticated using (true);

-- members write.
create policy players_insert on public.players for insert to authenticated with check ((select public.is_member()));
create policy players_update on public.players for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy riot_all on public.player_riot_ids for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy matches_update on public.matches for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy matches_delete on public.matches for delete to authenticated using ((select public.is_member()));
create policy settings_update on public.settings for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- helper tokens: admins only.
create policy tokens_select on public.helper_tokens for select to authenticated using ((select public.is_admin()));
create policy tokens_update on public.helper_tokens for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

/* ------------------------------------------------------------------- grants */
-- Explicit grants for the Data API (RLS above still decides which rows).

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.players, public.matches, public.match_participants, public.dodge_log,
                public.live_game, public.settings to anon, authenticated;
grant insert, update on public.players to authenticated;
grant select, insert, update, delete on public.player_riot_ids to authenticated;
grant update (winner), delete on public.matches to authenticated;
grant update (dodge_hours, dodges_per_team, reroll_limit, challenges_enabled, discord_url,
              review_helper_results, updated_at) on public.settings to authenticated;
grant select, delete on public.members to authenticated;
grant update (role) on public.members to authenticated;
grant select (id, name, created_at, last_used_at, revoked_at) on public.helper_tokens to authenticated;
grant update (revoked_at) on public.helper_tokens to authenticated;

grant execute on function public.is_member(), public.is_admin() to anon, authenticated;
grant execute on function public.set_live(jsonb), public.save_live_result(uuid, text),
                          public.create_helper_token(text), public.restore_backup(jsonb) to authenticated;

/* ----------------------------------------------------------------- realtime */

alter publication supabase_realtime add table
  public.live_game, public.matches, public.match_participants, public.players, public.settings;
