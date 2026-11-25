-- EMERGENCY ONLY: undoes the private part of private.sql, so the site from before the release works again.
-- Run it in the Supabase SQL Editor, together with going back to the old site (see docs/release.md).
-- It makes the game data public again, like it was before the release. No data is changed or deleted.
-- Stays as it is: blocked people, links between members and players, saved games, the checks on roles and teams.

drop policy if exists players_read  on public.players;
drop policy if exists matches_read  on public.matches;
drop policy if exists parts_read    on public.match_participants;
drop policy if exists dodges_read   on public.dodge_log;
drop policy if exists live_read     on public.live_game;
drop policy if exists settings_read on public.settings;
create policy players_read  on public.players            for select to anon, authenticated using (true);
create policy matches_read  on public.matches            for select to anon, authenticated using (true);
create policy parts_read    on public.match_participants for select to anon, authenticated using (true);
create policy dodges_read   on public.dodge_log          for select to anon, authenticated using (true);
create policy live_read     on public.live_game          for select to anon, authenticated using (true);
create policy settings_read on public.settings           for select to anon, authenticated using (true);
grant select on public.players, public.matches, public.match_participants, public.dodge_log, public.live_game, public.settings to anon;
grant execute on function public.is_member(), public.is_admin() to anon;

drop policy if exists matches_update on public.matches;
drop policy if exists matches_delete on public.matches;
create policy matches_update on public.matches for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy matches_delete on public.matches for delete to authenticated using ((select public.is_member()));

drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using ((select public.is_admin()) and user_id <> (select auth.uid()));
grant delete on public.members to authenticated;
