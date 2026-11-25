-- Members create their own helper tokens (admins still see and revoke all of them).

create or replace function public.create_helper_token(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if not public.is_member() then raise exception 'Members only' using errcode = '42501'; end if;
  if (select count(*) from public.helper_tokens where created_by = auth.uid() and revoked_at is null) >= 3 then
    raise exception 'You already have 3 helper tokens. Revoke one first.' using errcode = 'P0001';
  end if;
  v_token := 'bnh_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.helper_tokens (name, token_hash, created_by)
  values (left(coalesce(nullif(trim(p_name), ''), 'Helper'), 40), encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());
  return v_token;
end $$;
revoke execute on function public.create_helper_token(text) from public, anon;
grant execute on function public.create_helper_token(text) to authenticated;

drop policy tokens_select on public.helper_tokens;
drop policy tokens_update on public.helper_tokens;

-- see: admins everything, members their own
create policy tokens_select on public.helper_tokens for select to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())));
-- revoke only (a revoked token can't be brought back)
create policy tokens_update on public.helper_tokens for update to authenticated
  using ((select public.is_admin()) or (created_by = (select auth.uid()) and (select public.is_member())))
  with check (revoked_at is not null);

grant select (created_by) on public.helper_tokens to authenticated;
grant select on public.members to service_role;
