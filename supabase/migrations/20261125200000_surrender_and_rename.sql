-- 1) Only admins can rename players (members can still add and remove players and edit Riot IDs).
create or replace function public.players_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name and coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Only admins can rename players' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.players_guard() from public, anon, authenticated;
create trigger players_guard before update on public.players for each row execute function public.players_guard();

-- 2) Surrender: 'ff' = the losing team surrendered, 'early' = early surrender (remake style).
alter table public.matches add column surrender text check (surrender in ('ff', 'early'));

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

  insert into public.matches (mode, winner, sit_out, challenge, duration_min, game_id, live_id, surrender)
  values (
    least(4, greatest(1, (L ->> 'size')::smallint)),
    p_winner,
    coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(L -> 'sitOut', '[]')) x), '{}'),
    nullif(L ->> 'challenge', ''),
    least(v_dur, 600),
    nullif(p_game_id, ''),
    p_live_id,
    case when L ->> 'surrender' in ('ff', 'early') then L ->> 'surrender' end
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
      from (select unnest(v_lp)::text as k) z));
    if (p ->> 'durationSec') is not null then
      L := L || jsonb_build_object('durationMin', greatest(1, round((p ->> 'durationSec')::numeric / 60))::int);
    end if;
    L := L || jsonb_strip_nulls(jsonb_build_object('surrender', case when p ->> 'surrender' in ('ff', 'early') then p ->> 'surrender' end));
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
  L := L || jsonb_strip_nulls(jsonb_build_object('surrender', case when p ->> 'surrender' in ('ff', 'early') then p ->> 'surrender' end));
    return public._insert_match(L, v_winner, v_game, null);
end $$;

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

  insert into public.matches (id, played_at, mode, winner, sit_out, challenge, duration_min, game_id, live_id, surrender)
  select (m ->> 'id')::uuid, to_timestamp((m ->> 'playedAt')::bigint / 1000.0), (m ->> 'mode')::smallint,
         m ->> 'winner',
         coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(m -> 'sitOut', '[]')) x), '{}'),
         nullif(m ->> 'challenge', ''), (m ->> 'durationMin')::int, nullif(m ->> 'gameId', ''),
         nullif(m ->> 'liveId', '')::uuid,
         case when m ->> 'surrender' in ('ff', 'early') then m ->> 'surrender' end
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

revoke execute on function public._insert_match(jsonb, text, text, uuid), public._apply_helper_result(jsonb) from public, anon, authenticated;
grant execute on function public._insert_match(jsonb, text, text, uuid), public._apply_helper_result(jsonb) to service_role;
revoke execute on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;