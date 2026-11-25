-- RELEASE DAY ONLY. Run this together with the merge to main, after a backup.
-- It makes the data private, so the site that was live before stops working for visitors.
-- It is not in supabase/migrations/ on purpose: nothing may apply it earlier by accident.
-- On release day it moves to supabase/migrations/ with a new timestamp.

/* ------------------------------------- only approved members read anything */

drop policy players_read  on public.players;
drop policy matches_read  on public.matches;
drop policy parts_read    on public.match_participants;
drop policy dodges_read   on public.dodge_log;
drop policy live_read     on public.live_game;
drop policy settings_read on public.settings;
create policy players_read  on public.players            for select to authenticated using ((select public.is_member()));
create policy matches_read  on public.matches            for select to authenticated using ((select public.is_member()));
create policy parts_read    on public.match_participants for select to authenticated using ((select public.is_member()));
create policy dodges_read   on public.dodge_log          for select to authenticated using ((select public.is_member()));
create policy live_read     on public.live_game          for select to authenticated using ((select public.is_member()));
create policy settings_read on public.settings           for select to authenticated using ((select public.is_member()));
revoke all on all tables in schema public from anon;
revoke execute on function public.is_member(), public.is_admin() from anon;

/* -------------------------------------------------- only admins edit games */

drop policy matches_update on public.matches;
drop policy matches_delete on public.matches;
create policy matches_update on public.matches for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy matches_delete on public.matches for delete to authenticated using ((select public.is_admin()));

/* ----------------------------------------------------------------- members */

-- Removing someone means blocking them, so they can't come back on their own.
drop policy members_delete on public.members;
revoke delete on public.members from authenticated;

create function public.members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    if old.user_id = auth.uid() then
      raise exception 'You can''t change your own role' using errcode = 'P0001';
    end if;
    if old.role = 'admin' then
      -- one change at a time, so two admins can't demote each other at once
      perform 1 from public.members where role = 'admin' for update;
      if not exists (select 1 from public.members where role = 'admin' and user_id <> old.user_id) then
        raise exception 'There has to be at least one admin' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.members_guard() from public, anon, authenticated;
create trigger members_guard before update on public.members for each row execute function public.members_guard();

-- Avatars only from Discord, and not endless.
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
      ''
    ), 60),
    case when new.raw_user_meta_data ->> 'avatar_url' like 'https://cdn.discordapp.com/%'
         then left(new.raw_user_meta_data ->> 'avatar_url', 300) end
  )
  on conflict (user_id) do nothing;
  return new;
end $$;
update public.members set avatar_url = null where avatar_url is not null and avatar_url not like 'https://cdn.discordapp.com/%';

-- A helper token goes with its owner's account.
delete from public.helper_tokens where created_by is null;
alter table public.helper_tokens drop constraint helper_tokens_created_by_fkey;
alter table public.helper_tokens add constraint helper_tokens_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete cascade;

/* ------------------------------------------------------ teams on the site */

-- Teams of the generator: a known shape, nothing else.
create or replace function public.set_live(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  if p_data is null or p_data = 'null'::jsonb then
    delete from public.live_game where true;
    return;
  end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Live game must be an object' using errcode = 'P0001'; end if;
  if octet_length(p_data::text) > 20000 then raise exception 'Live game data is too large' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_object_keys(p_data) k where k not in
      ('id', 'phase', 'size', 'blue', 'red', 'sitOut', 'captains', 'style', 'stats', 'dodgeLog', 'challenge', 'createdAt',
       'lockedAt', 'startedAt', 'durationMin', 'surrender'))
     or coalesce(p_data ->> 'phase', '') not in ('draft', 'select', 'playing', 'result')
     or jsonb_typeof(p_data -> 'blue') is distinct from 'array' or jsonb_typeof(p_data -> 'red') is distinct from 'array'
     or jsonb_typeof(p_data -> 'sitOut') is distinct from 'array' then
    raise exception 'That is not a live game' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_data -> 'blue') > 5 or jsonb_array_length(p_data -> 'red') > 5 then
    raise exception 'At most 5 players per side' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text((p_data -> 'blue') || (p_data -> 'red') || (p_data -> 'sitOut')) x
    where not exists (select 1 from public.players pl where pl.id::text = x)) then
    raise exception 'Unknown player' using errcode = 'P0001';
  end if;
  v_id := (p_data ->> 'id')::uuid;
  if exists (select 1 from public.matches where live_id = v_id) then
    raise exception 'This game was already saved' using errcode = 'P0001';
  end if;
  delete from public.live_game where id <> v_id;
  insert into public.live_game (id, data, updated_at) values (v_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

/* ------------------------------------------------------------------ backup */

create or replace function public.restore_backup(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s     jsonb := coalesce(p -> 'settings', '{}');
  links jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p ->> 'app' is distinct from 'bridge-night' or jsonb_typeof(p -> 'players') <> 'array'
     or jsonb_typeof(p -> 'matches') <> 'array' then
    raise exception 'That file is not a Bridge Night backup';
  end if;

  select coalesce(jsonb_object_agg(user_id, player_id), '{}') into links from public.members where player_id is not null;

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

  -- Members stay linked to their players.
  update public.members m set player_id = pl.id
  from public.players pl where pl.id::text = links ->> m.user_id::text;

  insert into public.matches (id, played_at, mode, winner, sit_out, challenge, duration_min, game_id, live_id, surrender,
                              end_reason, duration_sec, guests, game_mode, map)
  select (m ->> 'id')::uuid, to_timestamp((m ->> 'playedAt')::bigint / 1000.0), (m ->> 'mode')::smallint,
         m ->> 'winner',
         coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(m -> 'sitOut', '[]')) x), '{}'),
         nullif(m ->> 'challenge', ''), (m ->> 'durationMin')::int, nullif(m ->> 'gameId', ''),
         nullif(m ->> 'liveId', '')::uuid,
         case when m ->> 'surrender' in ('ff', 'early') then m ->> 'surrender' end,
         m ->> 'end', (m ->> 'durationSec')::int, nullif(m -> 'guests', 'null'::jsonb), m ->> 'gameMode', m ->> 'map'
  from jsonb_array_elements(p -> 'matches') m;

  insert into public.match_participants (match_id, player_id, team, slot, champion, kills, deaths, assists, items, damage,
                                         level, spells, augments)
  select (m ->> 'id')::uuid, e.pid::uuid, t.team, (e.ord - 1)::smallint,
         nullif(st ->> 'champion', ''),
         (st ->> 'kills')::int, (st ->> 'deaths')::int, (st ->> 'assists')::int,
         public._ints(st -> 'items'), (st ->> 'damage')::int,
         (st ->> 'level')::smallint, public._ints(st -> 'spells'), public._ints(st -> 'augments')
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

/* ------------------------------------------- games are saved from now on */

delete from public.test_games where true;
delete from public.live_feed where true;
delete from public.live_state where true;
delete from public.live_game where true; -- a game the old helper started would block the Teams page
alter table public.settings disable trigger settings_guard; -- it only lets admins change this, and nobody is logged in here
update public.settings set save_live_games = true, review_helper_results = false where id = 1;
alter table public.settings enable trigger settings_guard;

-- 5v5 from older helpers is 5v5, not 4v4.
do $$ begin
  execute replace(pg_get_functiondef('public._insert_match(jsonb, text, text, uuid)'::regprocedure), 'least(4,', 'least(5,');
end $$;
