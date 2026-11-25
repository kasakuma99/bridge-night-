-- Hardening after the security review.

-- 1) Only admins may change the Discord link and the helper review switch (members keep the house rules).
create or replace function public.settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.discord_url is distinct from old.discord_url or new.review_helper_results is distinct from old.review_helper_results)
     and coalesce(auth.role(), '') <> 'service_role' and not public.is_admin() then
    raise exception 'Only admins can change that' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.settings_guard() from public, anon, authenticated;
create trigger settings_guard before update on public.settings for each row execute function public.settings_guard();

-- 2) Size limit for the live game state.
create or replace function public.set_live(p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  if p_data is null or p_data = 'null'::jsonb then
    delete from public.live_game where true;
    return;
  end if;
  if octet_length(p_data::text) > 100000 then raise exception 'Live game data is too large' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Live game must be an object' using errcode = 'P0001'; end if;
  v_id := (p_data ->> 'id')::uuid;
  if exists (select 1 from public.matches where live_id = v_id) then
    raise exception 'This game was already saved' using errcode = 'P0001';
  end if;
  delete from public.live_game where id <> v_id;
  insert into public.live_game (id, data, updated_at) values (v_id, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;
revoke execute on function public.set_live(jsonb) from public, anon;
grant execute on function public.set_live(jsonb) to authenticated;

-- 3) Future tables and functions are closed by default; each one gets explicit grants.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
