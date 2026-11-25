-- Only admins can add, change or remove Riot IDs. Members can still see them (visitors never can).
drop policy riot_all on public.player_riot_ids;
create policy riot_select on public.player_riot_ids for select to authenticated using ((select public.is_member()));
create policy riot_insert on public.player_riot_ids for insert to authenticated with check ((select public.is_admin()));
create policy riot_update on public.player_riot_ids for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy riot_delete on public.player_riot_ids for delete to authenticated using ((select public.is_admin()));
