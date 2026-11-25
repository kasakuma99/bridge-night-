-- Bridge Night: helper app support.
-- The helper never talks to tables directly: it calls the "helper" Edge Function with its token.
-- The Edge Function (service_role) calls the internal functions below. Members confirm pending results on the site.

/* ------------------------------------------------- shared match insert */

-- Inserts a match from a LiveGame-shaped jsonb. Returns null if that live game or Riot game id was already saved.
-- Internal: only service_role and the security-definer functions below may call it.
create or replace function public._insert_match(L jsonb, p_winner text, p_game_id text, p_live_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_mid uuid;
  v_dur int;
begin
  if p_winner not in ('blue', 'red') then raise exception 'Winner must be blue or red'; end if;
  v_dur := coalesce(
    nullif(L ->> 'durationMin', '')::int,
    case when nullif(L ->> 'startedAt', '') is not null
      then greatest(1, round((extract(epoch from now()) * 1000 - (L ->> 'startedAt')::bigint) / 60000.0))::int end
  );

  insert into public.matches (mode, winner, sit_out, challenge, duration_min, game_id, live_id)
  values (
    least(4, greatest(1, (L ->> 'size')::smallint)),
    p_winner,
    coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(L -> 'sitOut', '[]')) x), '{}'),
    nullif(L ->> 'challenge', ''),
    least(v_dur, 600),
    nullif(p_game_id, ''),
    p_live_id
  )
  on conflict do nothing
  returning id into v_mid;
  if v_mid is null then return null; end if;

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

  return v_mid;
end $$;

-- Same behaviour as before, now sharing _insert_match.
create or replace function public.save_live_result(p_live_id uuid, p_winner text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  L     jsonb;
  v_mid uuid;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  select data into L from public.live_game where id = p_live_id for update;
  if L is null then return null; end if;
  v_mid := public._insert_match(L, p_winner, L ->> 'gameId', p_live_id);
  delete from public.live_game where id = p_live_id;
  return v_mid;
end $$;

/* ------------------------------------------------- helper results */

-- A result sent by a helper, waiting for a member to confirm it (when review is on).
-- payload: { gameId, durationSec, players: [{ playerId, side: 'blue'|'red', win, champion, kills, deaths, assists, items, damage }] }
-- side = the League team (100 = blue, 200 = red). Only known players (matched by Riot ID) are included.
create table public.pending_results (
  id         uuid primary key default gen_random_uuid(),
  game_id    text not null unique,
  payload    jsonb not null,
  token_id   uuid references public.helper_tokens (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.pending_results enable row level security;
create policy pending_select on public.pending_results for select to authenticated using ((select public.is_member()));
create policy pending_delete on public.pending_results for delete to authenticated using ((select public.is_member()));
grant select, delete on public.pending_results to authenticated;
alter publication supabase_realtime add table public.pending_results;

-- Applies a helper result: attaches it to the live game if it has the same players, otherwise creates a new match.
-- Returns the match id, or null if this Riot game was already saved.
create or replace function public._apply_helper_result(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_game   text := nullif(p ->> 'gameId', '');
  v_known  uuid[];
  v_live   record;
  L        jsonb;
  v_lp     uuid[];
  v_stats  jsonb := '{}';
  v_winner text;
  v_blue   jsonb;
  v_red    jsonb;
  v_mid    uuid;
  r        jsonb;
begin
  if v_game is null then raise exception 'Missing game id'; end if;
  if exists (select 1 from public.matches where game_id = v_game) then return null; end if;

  select array_agg((x ->> 'playerId')::uuid) into v_known
  from jsonb_array_elements(coalesce(p -> 'players', '[]')) x
  where exists (select 1 from public.players pl where pl.id = (x ->> 'playerId')::uuid);
  if coalesce(array_length(v_known, 1), 0) < 2 then raise exception 'Fewer than 2 of our players in that game'; end if;

  for r in select * from jsonb_array_elements(p -> 'players') loop
    if not ((r ->> 'playerId')::uuid = any (v_known)) then continue; end if;
    v_stats := v_stats || jsonb_build_object(r ->> 'playerId', jsonb_strip_nulls(jsonb_build_object(
      'champion', nullif(r ->> 'champion', ''),
      'kills', (r ->> 'kills')::int, 'deaths', (r ->> 'deaths')::int, 'assists', (r ->> 'assists')::int,
      'items', case when jsonb_typeof(r -> 'items') = 'array' then r -> 'items' end,
      'damage', (r ->> 'damage')::int)));
  end loop;

  select id, data into v_live from public.live_game for update;
  if v_live.id is not null then
    L := v_live.data;
    select array_agg(x::uuid) into v_lp
    from jsonb_array_elements_text(coalesce(L -> 'blue', '[]') || coalesce(L -> 'red', '[]')) x;
  end if;

  if v_live.id is not null and coalesce(L ->> 'phase', '') <> 'draft' and v_lp @> v_known and v_known @> v_lp then
    -- Same players as the live game: the winner is whichever site side the winners were on.
    select case when bool_or((x ->> 'win')::boolean) then 'blue' else 'red' end into v_winner
    from jsonb_array_elements(p -> 'players') x
    where (x ->> 'playerId') in (select jsonb_array_elements_text(L -> 'blue'));
    -- merge: helper stats win over typed-in ones, but keep anything the helper didn't send
    L := jsonb_set(L, '{stats}', (
      select coalesce(jsonb_object_agg(k, coalesce(L -> 'stats' -> k, '{}') || coalesce(v_stats -> k, '{}')), '{}')
      from unnest(v_lp) k));
    if (p ->> 'durationSec') is not null then
      L := L || jsonb_build_object('durationMin', greatest(1, round((p ->> 'durationSec')::numeric / 60))::int);
    end if;
    v_mid := public._insert_match(L, v_winner, v_game, v_live.id);
    delete from public.live_game where id = v_live.id;
    return v_mid;
  end if;

  -- No matching live game: a new match straight from the League teams.
  select coalesce(jsonb_agg(x ->> 'playerId'), '[]') into v_blue
  from jsonb_array_elements(p -> 'players') x where x ->> 'side' = 'blue' and (x ->> 'playerId')::uuid = any (v_known);
  select coalesce(jsonb_agg(x ->> 'playerId'), '[]') into v_red
  from jsonb_array_elements(p -> 'players') x where x ->> 'side' = 'red' and (x ->> 'playerId')::uuid = any (v_known);
  if jsonb_array_length(v_blue) = 0 or jsonb_array_length(v_red) = 0 then
    raise exception 'Need our players on both sides';
  end if;
  select case when bool_or((x ->> 'win')::boolean) then 'blue' else 'red' end into v_winner
  from jsonb_array_elements(p -> 'players') x where x ->> 'side' = 'blue';

  L := jsonb_build_object(
    'size', greatest(jsonb_array_length(v_blue), jsonb_array_length(v_red)),
    'blue', v_blue, 'red', v_red, 'stats', v_stats, 'dodgeLog', '[]'::jsonb, 'sitOut', '[]'::jsonb,
    'durationMin', case when (p ->> 'durationSec') is not null
                        then greatest(1, round((p ->> 'durationSec')::numeric / 60))::int end);
  return public._insert_match(L, v_winner, v_game, null);
end $$;

-- Member confirms a pending helper result.
create or replace function public.confirm_pending_result(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_payload jsonb; v_mid uuid;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  delete from public.pending_results where id = p_id returning payload into v_payload;
  if v_payload is null then return null; end if;
  v_mid := public._apply_helper_result(v_payload);
  return v_mid;
end $$;

-- Admin turns the review step on or off is a normal settings update (review_helper_results).

/* ------------------------------------------------- grants */

revoke execute on function public._insert_match(jsonb, text, text, uuid) from public, anon, authenticated;
revoke execute on function public._apply_helper_result(jsonb) from public, anon, authenticated;
grant execute on function public._insert_match(jsonb, text, text, uuid), public._apply_helper_result(jsonb) to service_role;
revoke execute on function public.confirm_pending_result(uuid) from public, anon;
grant execute on function public.confirm_pending_result(uuid) to authenticated;
revoke execute on function public.save_live_result(uuid, text) from public, anon;
grant execute on function public.save_live_result(uuid, text) to authenticated;

-- The Edge Function (service_role) needs these tables.
grant select on public.players, public.player_riot_ids, public.settings, public.matches to service_role;
grant select, update on public.helper_tokens to service_role;
grant select, insert, update on public.live_game to service_role;
grant select, insert, delete on public.pending_results to service_role;
