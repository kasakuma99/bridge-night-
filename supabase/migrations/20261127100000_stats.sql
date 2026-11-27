-- The new Stats page: Discord pictures for members, and champ selects that never became a game (rerolls).
-- Only adds things: the site that is live today keeps working.

/* ------------------------------------------------- Discord picture and name */

-- Members may only read their own row of members. This gives them the picture and Discord name of the players
-- that are linked to an account, and nothing else.
create function public.player_profiles()
returns table (player_id uuid, avatar_url text, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.player_id, m.avatar_url, nullif(m.display_name, '')
  from public.members m
  where m.player_id is not null and m.role in ('member', 'admin') and public.is_member();
$$;
revoke execute on function public.player_profiles() from public, anon;
grant execute on function public.player_profiles() to authenticated;

/* ---------------------------------------------------------------- rerolls */

-- A custom game whose champ select went back to the lobby. League doesn't say who left, so only the players
-- who were in it are kept. Only the "live" Edge Function writes.
create table public.rerolls (
  id      uuid primary key default gen_random_uuid(),
  live_id text not null unique check (char_length(live_id) <= 40),
  at      timestamptz not null default now(),
  size    smallint check (size between 1 and 5),
  players uuid[] not null default '{}' check (cardinality(players) <= 10)
);
create index rerolls_at on public.rerolls (at desc);
alter table public.rerolls enable row level security;
create policy rerolls_read on public.rerolls for select to authenticated using ((select public.is_member()));
revoke all on public.rerolls from anon;
grant select on public.rerolls to authenticated;

-- The same champ select is only counted once.
create function public._log_reroll(p_live_id text, p_size smallint, p_players uuid[]) returns void
language sql security definer set search_path = '' as $$
  insert into public.rerolls (live_id, size, players)
  values (left(p_live_id, 40), p_size,
          coalesce(array(select x from unnest(p_players) x where exists (select 1 from public.players pl where pl.id = x) limit 10), '{}'))
  on conflict (live_id) do nothing;
$$;
revoke execute on function public._log_reroll(text, smallint, uuid[]) from public, anon, authenticated;
grant execute on function public._log_reroll(text, smallint, uuid[]) to service_role;
grant select, insert on public.rerolls to service_role;
