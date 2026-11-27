-- Arcade: scores of the solo minigames, and who is on the Arcade page right now.
-- Members only. Everyone saves only their own scores, the database checks them, nobody edits them, admins remove cheats.

/* ------------------------------------------------------------------- games */

-- The solo games with a leaderboard. MUST MATCH src/minigames/registry.ts (id, maxScore, lowerIsBetter):
-- a game that is missing here can't save scores ("Unknown game"). Add new games with a new migration.
create table public.minigame_games (
  game_id         text primary key check (game_id ~ '^[a-z0-9-]{1,40}$'),
  max_score       integer not null check (max_score > 0),
  lower_is_better boolean not null default false
);
comment on table public.minigame_games is 'Solo Arcade games and their highest possible score. Must match src/minigames/registry.ts.';
insert into public.minigame_games (game_id, max_score, lower_is_better) values
  ('champ-pixel',   5000, false),
  ('champ-colours', 5000, false),
  ('champ-mixed',   5000, false);

/* ------------------------------------------------------------------ scores */

create table public.minigame_scores (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players (id) on delete cascade,
  game_id    text not null references public.minigame_games (game_id) on delete cascade,
  score      integer not null check (score >= 0),
  created_at timestamptz not null default now()
);
comment on table public.minigame_scores is 'One row per finished round of a solo Arcade game. Insert only (own player), admins delete.';
-- Leaderboards: best per player and game. The guard: the newest score of a player in a game.
create index minigame_scores_board_idx  on public.minigame_scores (game_id, player_id, score desc, created_at);
create index minigame_scores_player_idx on public.minigame_scores (player_id, game_id, created_at desc);

-- Fills in the player (from the member's link, never from the request), checks the score, and slows down repeats.
create function public.minigame_scores_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_player uuid;
  v_max    integer;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  select m.player_id into v_player from public.members m where m.user_id = auth.uid();
  if v_player is null then
    raise exception 'Your account is not linked to a player yet. Ask an admin.' using errcode = 'P0001';
  end if;
  new.player_id  := v_player;
  new.created_at := now();
  select g.max_score into v_max from public.minigame_games g where g.game_id = new.game_id;
  if v_max is null then raise exception 'Unknown game' using errcode = 'P0001'; end if;
  if new.score is null or new.score < 0 or new.score > v_max then
    raise exception 'That score is not possible in this game' using errcode = 'P0001';
  end if;
  -- One score per player and game every 10 seconds. The lock makes two requests at once wait for each other.
  perform pg_advisory_xact_lock(hashtext('minigame_scores'), hashtext(v_player::text || '/' || new.game_id));
  if exists (select 1 from public.minigame_scores s
             where s.player_id = v_player and s.game_id = new.game_id and s.created_at > now() - interval '10 seconds') then
    raise exception 'Too fast: wait a few seconds before saving another score' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.minigame_scores_guard() from public, anon, authenticated;
create trigger minigame_scores_guard before insert on public.minigame_scores
  for each row execute function public.minigame_scores_guard();

-- Each player's best score per game (lowest for times). Runs with the rights of the reader, so the RLS below applies.
create view public.minigame_best with (security_invoker = true) as
  select distinct on (s.game_id, s.player_id) s.game_id, s.player_id, s.score, s.created_at
  from public.minigame_scores s
  join public.minigame_games g on g.game_id = s.game_id
  order by s.game_id, s.player_id, case when g.lower_is_better then s.score else -s.score end, s.created_at;

/* -------------------------------------------------------------------- RLS */

alter table public.minigame_games  enable row level security;
alter table public.minigame_scores enable row level security;
create policy minigame_games_read  on public.minigame_games  for select to authenticated using ((select public.is_member()));
create policy minigame_scores_read on public.minigame_scores for select to authenticated using ((select public.is_member()));
-- Your own player only. The guard already set player_id; this is the second lock on the door.
create policy minigame_scores_insert on public.minigame_scores for insert to authenticated
  with check (
    (select public.is_member())
    and player_id = (select m.player_id from public.members m where m.user_id = (select auth.uid()))
  );
-- No update policy: a score can't be changed. Only admins delete (cheats, tests).
create policy minigame_scores_delete on public.minigame_scores for delete to authenticated using ((select public.is_admin()));

revoke all on public.minigame_games, public.minigame_scores, public.minigame_best from anon, authenticated;
grant select on public.minigame_games, public.minigame_scores, public.minigame_best to authenticated;
grant insert (game_id, score) on public.minigame_scores to authenticated; -- id, player and time come from the database
grant delete on public.minigame_scores to authenticated;                  -- RLS: admins only
grant select on public.minigame_games, public.minigame_scores to service_role; -- the weekly backup reads everything

/* ------------------------------------------- who is on the Arcade page */

-- The site uses a private Realtime channel "bn-arcade" for presence (name and Discord avatar).
-- Only approved members may join it, so strangers with the public key can't see who is online.
-- Skipped where Realtime isn't installed (the small test database).
do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute $p$create policy bn_arcade_presence_read on realtime.messages for select to authenticated
      using ((select public.is_member()) and realtime.messages.extension = 'presence' and (select realtime.topic()) = 'bn-arcade')$p$;
    execute $p$create policy bn_arcade_presence_write on realtime.messages for insert to authenticated
      with check ((select public.is_member()) and realtime.messages.extension = 'presence' and (select realtime.topic()) = 'bn-arcade')$p$;
  end if;
end $$;
