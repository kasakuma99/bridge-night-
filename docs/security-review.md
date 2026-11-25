# Security review (2026-11-25)

What was checked: the website code (`src/`), the security headers (`public/_headers`), the database migrations
(`supabase/migrations/*.sql`) and the helper Edge Function (`supabase/functions/helper/index.ts`).

Overall the setup is in good shape: Row Level Security is on for every table, all database functions use
`security definer` with an empty `search_path`, tables and functions are closed by default and opened one by one,
helper tokens are stored only as a hash, Riot IDs are members-only, and only the public (publishable) key is in the website.

## Already fixed in the website (this change)

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

## Findings for the database and Edge Function (not changed: for you to decide)

### 1. Helper tokens keep working after the owner's login is deleted (Medium)
- **Where:** `supabase/functions/helper/index.ts` (the `if (tok.created_by)` check) and `helper_tokens.created_by ... on delete set null` in `20261125120000_init.sql`.
- **Why it matters:** The function checks "is the person who made this token still a member?" only when `created_by` is set. If you delete someone's user in the Supabase dashboard (Authentication > Users), `created_by` becomes empty and their helper tokens keep working forever, with no owner check.
- **Suggested fix:** In the Edge Function, refuse tokens whose `created_by` is empty. Or change the foreign key to `on delete cascade`. Until then: revoke a person's tokens on the Players page before deleting their user.

### 2. Any member can delete games, flip winners and throw away helper results, with no trace (Medium)
- **Where:** policies `matches_delete`, `matches_update`, `pending_delete` (`20261125120000_init.sql`, `20261125150000_helper.sql`).
- **Why it matters:** This is how the build plan wants it, but one careless or hijacked member account can wipe the whole history in a minute, and nobody can see who did it. The weekly backup is the only way back.
- **Suggested fix:** Pick one: (a) only admins may delete games; (b) "soft delete" (a `deleted_at` column, hidden on the site, an admin can restore); (c) a small log table (who, what, when) filled by a trigger.

### 3. The live game accepts any JSON from members (Low)
- **Where:** `set_live` in `20261125170000_hardening.sql`.
- **Why it matters:** Members can store any object up to 100 KB. It is readable by everyone and pushed live to every open page. React shows it as plain text, so it can't run code, but a member could fill it with junk or misleading text (long challenge text, fake names, huge lists).
- **Suggested fix:** Check the shape in `set_live`: only known keys, at most 4 players per side, ids must be existing players, strings capped (champion 40, challenge 120).

### 4. No rate limit on the helper endpoint (Low)
- **Where:** `supabase/functions/helper/index.ts`.
- **Why it matters:** Every request with a well-formed token does several database lookups. A leaked token (or a buggy helper) could hammer the free-plan database.
- **Suggested fix:** Refuse requests from a token that was used less than ~1 second ago (`last_used_at`), or cap requests per minute per token.

### 5. The request body is read fully before its size is checked when no Content-Length is sent (Info)
- **Where:** `req.text()` in the Edge Function.
- **Why it matters:** Only matters for very large uploads; Supabase has its own limits, so the risk is small.
- **Suggested fix:** Read the body as a stream and stop after 64 KB.

### 6. Anyone can create a "pending" account (Low)
- **Where:** `handle_new_user` trigger (`20261125120000_init.sql`); Auth settings in the Supabase dashboard.
- **Why it matters:** Every Discord user who logs in gets a pending row (they can't change anything). The local `supabase/config.jsonc` also has the email provider and sign-ups enabled; if that is true on the live project too, people can create accounts through the public API without Discord.
- **Suggested fix:** In the Supabase dashboard (Authentication > Providers) turn off Email if only Discord is used. Now and then decline old pending people on the Players page.

### 7. An admin can remove their own admin role (Low)
- **Where:** policy `members_update` (`20261125120000_init.sql`).
- **Why it matters:** If the last admin turns themself into a normal member (the site hides that button for yourself, but the database allows it), nobody can approve members any more until someone fixes it in SQL.
- **Suggested fix:** A trigger that refuses changing your own role, or refuses when it would leave zero admins.

### 8. Avatar links are stored unchecked (Low)
- **Where:** `handle_new_user` (`avatar_url`), shown in the Members panel.
- **Why it matters:** The value comes from login metadata. The browser's CSP only loads images from Discord's CDN, so it can't be used for tracking, but the database stores whatever it gets, at any length.
- **Suggested fix:** Keep it only if it starts with `https://cdn.discordapp.com/` and is under ~300 characters.

### 9. Use the PKCE login flow (Low, website config)
- **Where:** `src/lib/supabase.ts` (`createClient` options).
- **Why it matters:** Supabase's default for the browser puts the login tokens in the address bar (`#access_token=...`) for a moment on return. PKCE (`flowType: "pkce"`) sends a short-lived one-time code instead, which is the recommended flow.
- **Suggested fix:** Add `flowType: "pkce"` to the auth options and test the Discord login once on the live site. (The new login popup already stays hidden for both kinds of return.)

### 10. Helper results can't be verified (Info)
- **Where:** `result()` in the Edge Function, setting `review_helper_results`.
- **Why it matters:** Nobody can check a result against Riot (custom games aren't in Riot's API), so a member with a token could send a made-up game. With "Check helper results before they count" switched on (the default) a second person sees it first.
- **Suggested fix:** Keep that switch on.

### 11. Small notes (Info)
- `is_member()` and `is_admin()` can be called by visitors; they only return `false`, so that's fine.
- `restore_backup` replaces everything in one transaction; a broken file rolls back completely. Good.
- The public key in `.env.production` is the publishable key. That is meant to be public.
