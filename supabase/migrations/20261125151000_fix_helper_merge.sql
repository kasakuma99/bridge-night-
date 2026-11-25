-- Fix: player ids are uuids, but jsonb keys are text.
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

revoke execute on function public._apply_helper_result(jsonb) from public, anon, authenticated;
grant execute on function public._apply_helper_result(jsonb) to service_role;
