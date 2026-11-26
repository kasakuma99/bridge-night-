# Security review

First review: 2026-11-25. **Status checked again against the code on 2026-11-26.**

What was checked: the website code (`src/`), the security headers (`public/_headers`), the database migrations
(`supabase/migrations/*.sql`) and both Edge Functions (`supabase/functions/helper/` and `supabase/functions/live/`).

Overall the setup is in good shape: Row Level Security is on for every table, all database functions use
`security definer` with an empty `search_path`, tables and functions are closed by default and opened one by one,
helper tokens are stored only as a hash, Riot IDs are members-only, the whole site is members-only, and only the public
(publishable) key is in the website.

> The status below is what the **repository** contains. Most fixes are in `20261126110000_private.sql`, which is applied
> in step 4 of [release.md](release.md). If that step was skipped on the live project, those fixes are not live yet.

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Helper tokens keep working after the owner's login is deleted | Medium | **Fixed** |
| 2 | Any member can delete games or flip winners, with no trace | Medium | **Mostly fixed**: admins only. No undo or log yet |
| 3 | The live game accepts any JSON from members | Low | **Fixed** |
| 4 | No rate limit on the helper endpoint | Low | **Fixed** in `live`. Old `helper` function still has none |
| 5 | Request body read fully before its size is checked | Info | **Fixed** in `live`. Old `helper` function unchanged |
| 6 | Anyone can create a "pending" account | Low | **Partly fixed**: the email provider is still on |
| 7 | An admin can remove their own admin role | Low | **Fixed** |
| 8 | Avatar links are stored unchecked | Low | **Fixed** |
| 9 | Use the PKCE login flow | Low | **Fixed** |
| 10 | Helper results can't be verified | Info | **Changed**: the review switch is now off, see below |
| 11 | Small notes | Info | Still true, nothing to do |

**Still to do:** retire the old `helper` function (#4, #5), turn off the email provider on the live project (#6), and
think about an undo or log for game edits by admins (#2).

## Fixed in the website (first review)

| What | Why it matters |
|---|---|
| Stricter Content-Security-Policy: `default-src 'none'`, no more `'unsafe-inline'` for styles, `base-uri 'none'`, `manifest-src 'self'`. Supabase (https + wss), Discord avatars, Data Dragon and the GitHub API still work. | If someone ever managed to sneak HTML into the page, the browser now refuses far more of it (inline styles, a `<base>` tag, unknown sources). |
| `font-src` also allows `data:` | Vite inlines 4 tiny font files (Cyrillic letters) as `data:` URLs; the old policy silently blocked them. |
| `Cross-Origin-Opener-Policy: same-origin` | Other sites that open ours in a pop-up can't reach into our window. The Discord login is a normal full-page redirect, so it is not affected. |
| More `Permissions-Policy` entries and `includeSubDomains` for HSTS | Turns off browser features we never use. |
| Avatars only from `https://cdn.discordapp.com/`, display names capped at 40 characters | Login metadata can be edited by the user themself; this stops odd links or very long names in the header. |
| Helper page only links to downloads that really point at our GitHub repo, and only shows a SHA-256 that has the right format | The page trusted every URL the GitHub API returned. |
| Players page: errors are shown when removing a player, saving a Riot ID, the house rules or the Discord link fails; backup files over 10 MB are refused before reading | Before, a failed save gave no message at all. |
| New test: no secret key (`sb_secret_...` or a `service_role` key) can be in a `VITE_` variable or `.env.production` | `VITE_` variables end up in the public website. The built `dist/` was also searched: no secret keys. |

## Findings for the database and Edge Functions

### 1. Helper tokens keep working after the owner's login is deleted (Medium): Fixed
- **Was:** the owner check only ran when `created_by` was set, and `created_by` became empty when a user was deleted.
- **Now:**
  - `20261126110000_private.sql` deletes tokens without an owner and changes the foreign key to `on delete cascade`, so
    deleting a user deletes their tokens.
  - Both functions refuse a token whose owner is missing or not a member any more (`live/index.ts`:
    `if (!tok.created_by || !(await isMember(...)))`; `helper/index.ts` the same through `m` being empty).

### 2. Any member can delete games, flip winners and throw away helper results, with no trace (Medium): Mostly fixed
- **Now:** `20261126110000_private.sql` changes `matches_update` and `matches_delete` to **admins only**. The site
  shows "Swap winner" and "Delete" only to admins.
- **Still open:**
  - Any member can still delete *pending* helper results (`pending_delete` in `20261125150000_helper.sql`). This matters
    less now: helper 0.5+ saves games through the `live` function, not as pending results.
  - There is still no undo or log. An admin account that is careless or hijacked can still delete games, and the weekly
    backup is the only way back.
- **Possible next step:** a `deleted_at` column (soft delete that an admin can restore), or a small log table filled by a
  trigger (who, what, when).

### 3. The live game accepts any JSON from members (Low): Fixed
- **Now:** `set_live` in `20261126110000_private.sql` only accepts the known keys and a known `phase`. `blue`, `red` and
  `sitOut` must be lists, there are at most 5 players per side, every id must be an existing player, and the whole object
  is capped at 20 KB (was 100 KB).
- **Small leftover:** single strings such as `challenge` have no length cap of their own. The 20 KB cap limits them.

### 4. No rate limit on the helper endpoint (Low): Fixed in `live`
- **Now:** the `live` function, which helper 0.5+ uses, answers `429 too fast` when the same token was used less than
  0.9 seconds ago (`live/index.ts`).
- **Still open:** the old `helper` function has no limit. It is only needed by helpers older than 0.5. Helper 0.5+
  switches its settings from the old address to the new one by itself (`Program.OldServer` in `BridgeNightHelper.cs`).
- **Suggested fix:** once nobody runs a helper older than 0.5, remove the old function
  (`npx supabase functions delete helper`) and the `supabase/functions/helper/` folder.

### 5. The request body is read fully before its size is checked (Info): Fixed in `live`
- **Now:** `live` reads the body as a stream and stops after 400 KB (`readBody` in `live/index.ts`).
- **Still open:** the old `helper` function checks `Content-Length` (64 KB) but then still uses `req.text()`. This goes
  away together with the old function (see #4).

### 6. Anyone can create a "pending" account (Low): Partly fixed
- **Now:** declined or removed people get the role `blocked` and stay out, also when they log in again. Members can't
  be deleted from the site any more (`members_delete` was dropped), so nobody can clear their own block. Pending people
  can see nothing: the whole site is members-only.
- **Still open:** `supabase/config.jsonc` still has `"email": { "enabled": true }` and `enable_signup: true`. That file
  is only for the local database. On the live project, check **Authentication > Providers** in the Supabase dashboard
  and turn **Email** off if only Discord is used.

### 7. An admin can remove their own admin role (Low): Fixed
- **Now:** the `members_guard` trigger in `20261126110000_private.sql` refuses to let anyone change their own role, and
  refuses a change that would leave no admin. It locks the admin rows, so two admins can't demote each other at the same
  moment.

### 8. Avatar links are stored unchecked (Low): Fixed
- **Now:** `handle_new_user` and `ensure_member` keep `avatar_url` only when it starts with `https://cdn.discordapp.com/`,
  and cut it to 300 characters. Existing links from other places were set to empty. The website checks the same prefix
  again before showing an avatar (`src/data/context.tsx`).

### 9. Use the PKCE login flow (Low): Fixed
- **Now:** `src/lib/supabase.ts` creates the client with `flowType: "pkce"`.

### 10. Helper results can't be verified (Info): Changed
- **Before:** results from the helper went to "pending" first, and a second person confirmed them
  (`review_helper_results`, on by default).
- **Now:** at release `20261126110000_private.sql` sets `review_helper_results = false` and `save_live_games = true`.
  Games from the helper count right away. There is still no way to check a result against Riot, because custom games
  aren't in Riot's API.
- **Why that is acceptable for us:** only approved members can make tokens, every token belongs to a person, a token
  stops working when its owner is removed, and only admins can delete a wrong game.
- **To stop saving in an emergency:** `update public.settings set save_live_games = false where id = 1;` in the SQL
  Editor ([release.md](release.md)).

### 11. Small notes (Info)
- Visitors can't call `is_member()` and `is_admin()` any more (`private.sql` revokes them from `anon`).
- `restore_backup` is admins only and replaces everything in one transaction; a broken file rolls back completely. Good.
- The public key in `.env.production` is the publishable key. That is meant to be public.
- `scripts/check-private.mjs` checks the live project from outside and must say "Everything is closed to strangers".
