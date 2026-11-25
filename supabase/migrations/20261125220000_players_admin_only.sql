-- Only admins can add players or remove/restore them (the name guard from before stays as a second lock).
drop policy players_insert on public.players;
drop policy players_update on public.players;
create policy players_insert on public.players for insert to authenticated with check ((select public.is_admin()));
create policy players_update on public.players for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
