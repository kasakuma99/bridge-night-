-- Arcade round 2: live Versus rooms (Realtime), the trivia leaderboard, and trivia questions + settings that admins edit.
-- Members read, admins write the trivia tables; only members get into rooms. Visitors see nothing.

/* -------------------------------------------------------- trivia leaderboard */

-- MUST MATCH the boards in src/minigames/registry.ts (Board id, maxScore, lowerIsBetter).
insert into public.minigame_games (game_id, max_score, lower_is_better) values
  ('trivia-solo', 10000, false)
on conflict (game_id) do nothing;

/* ---------------------------------------------------------- trivia questions */

-- Questions an admin adds on the site. The built-in ones live in src/minigames/trivia/questions/*.ts.
-- The category list MUST MATCH TRIVIA_CATEGORIES in src/minigames/trivia/types.ts (here, and in trivia_settings below).
create table public.trivia_questions (
  id         text primary key check (id ~ '^custom-[a-z0-9-]{1,60}$'),
  category   text not null check (category in ('league', 'music', 'film-tv', 'games', 'geography', 'science', 'history', 'sport', 'food', 'general')),
  topic      text not null default '' check (char_length(topic) <= 40),
  difficulty smallint not null check (difficulty between 1 and 3),
  question   text not null check (char_length(btrim(question)) between 1 and 200 and char_length(question) <= 200),
  answer     text not null check (char_length(btrim(answer)) between 1 and 100 and char_length(answer) <= 100),
  -- Other spellings that count as right. At most 10, no empty ones.
  accept     text[] not null default '{}' check (
    cardinality(accept) <= 10 and array_position(accept, null) is null and array_position(accept, '') is null
    and coalesce(array_ndims(accept), 1) = 1 and char_length(array_to_string(accept, '')) <= 600),
  -- Multiple choice: none, or exactly 4 options and one of them is the answer.
  choices    text[] check (choices is null or (
    cardinality(choices) = 4 and array_ndims(choices) = 1 and array_position(choices, null) is null
    and array_position(choices, '') is null and answer = any (choices) and char_length(array_to_string(choices, '')) <= 400)),
  fact       text check (fact is null or char_length(fact) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.trivia_questions is 'Trivia questions added by admins on the site. Members read, admins write.';

-- Who and when come from the database, never from the request. The backup restore (service role, no login) keeps its values.
create function public.trivia_questions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
      new.updated_at := now();
    end if;
  else
    new.id         := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.trivia_questions_guard() from public, anon, authenticated;
create trigger trivia_questions_guard before insert or update on public.trivia_questions
  for each row execute function public.trivia_questions_guard();

/* ----------------------------------------------------------- trivia settings */

create table public.trivia_settings (
  id         smallint primary key default 1 check (id = 1),
  -- Categories nobody can pick.
  disabled   text[] not null default '{}' check (
    disabled <@ array['league', 'music', 'film-tv', 'games', 'geography', 'science', 'history', 'sport', 'food', 'general']::text[]
    and array_position(disabled, null) is null),
  -- "What we like": notes for whoever writes the next questions.
  notes      text not null default '' check (char_length(notes) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.trivia_settings is 'One row: trivia categories switched off and notes for question writers. Members read, admins write.';
insert into public.trivia_settings (id) values (1);

create function public.trivia_settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function public.trivia_settings_guard() from public, anon, authenticated;
create trigger trivia_settings_guard before insert or update on public.trivia_settings
  for each row execute function public.trivia_settings_guard();

/* ---------------------------------------------------------------------- RLS */

alter table public.trivia_questions enable row level security;
alter table public.trivia_settings  enable row level security;

create policy trivia_questions_read   on public.trivia_questions for select to authenticated using ((select public.is_member()));
create policy trivia_questions_insert on public.trivia_questions for insert to authenticated with check ((select public.is_admin()));
create policy trivia_questions_update on public.trivia_questions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy trivia_questions_delete on public.trivia_questions for delete to authenticated using ((select public.is_admin()));

create policy trivia_settings_read   on public.trivia_settings for select to authenticated using ((select public.is_member()));
create policy trivia_settings_update on public.trivia_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- No insert or delete: the one row is made above.

revoke all on public.trivia_questions, public.trivia_settings from anon, authenticated;
-- Members read everything except who wrote it: created_by / updated_by are admins' login ids (auth uuids) and stay
-- out of the site. Column grants, so "select *" is refused for members; the site names its columns.
grant select (id, category, topic, difficulty, question, answer, accept, choices, fact, created_at, updated_at)
  on public.trivia_questions to authenticated;
grant select (id, disabled, notes, updated_at) on public.trivia_settings to authenticated;
grant insert (id, category, topic, difficulty, question, answer, accept, choices, fact) on public.trivia_questions to authenticated;
grant update (category, topic, difficulty, question, answer, accept, choices, fact) on public.trivia_questions to authenticated;
grant delete on public.trivia_questions to authenticated;                   -- RLS: admins only
grant update (disabled, notes) on public.trivia_settings to authenticated;  -- RLS: admins only
grant select on public.trivia_questions, public.trivia_settings to service_role; -- the weekly backup reads everything

/* ------------------------------------------------------- live Versus rooms */

-- Private Realtime channels, members only (strangers with the public key can't join, listen or send):
--   "bn-room:<CODE>"     one per room: presence (who is in it) and broadcast (state from the host, actions from players).
--                        CODE = 4 letters without I, L, O, U (CODE_LETTERS in src/minigames/room/logic.ts).
--   "bn-arcade-rooms"    presence only: hosts list their open rooms there.
-- The "bn-arcade" policies from 20261126120000_minigame_scores.sql stay as they are.
-- Skipped where Realtime isn't installed (the small test database).
do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute $p$create policy bn_room_read on realtime.messages for select to authenticated
      using ((select public.is_member()) and realtime.messages.extension in ('broadcast', 'presence')
             and (select realtime.topic()) ~ '^bn-room:[A-HJKMNP-TV-Z]{4}$')$p$;
    execute $p$create policy bn_room_write on realtime.messages for insert to authenticated
      with check ((select public.is_member()) and realtime.messages.extension in ('broadcast', 'presence')
                  and (select realtime.topic()) ~ '^bn-room:[A-HJKMNP-TV-Z]{4}$')$p$;
    execute $p$create policy bn_arcade_rooms_read on realtime.messages for select to authenticated
      using ((select public.is_member()) and realtime.messages.extension = 'presence' and (select realtime.topic()) = 'bn-arcade-rooms')$p$;
    execute $p$create policy bn_arcade_rooms_write on realtime.messages for insert to authenticated
      with check ((select public.is_member()) and realtime.messages.extension = 'presence' and (select realtime.topic()) = 'bn-arcade-rooms')$p$;
  end if;
end $$;
