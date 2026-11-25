# Release: the private site with live games

For the two of us, on release day. It takes about 30 minutes. Pick a time when nobody is playing.

**Owner** = the owner of the GitHub, Cloudflare and Supabase accounts. **Tosh** can do the Supabase steps too.

What changes: only approved members see the site, games come from the helper 0.5, and only admins swap winners or delete games.
Elo, the other Teams page, bounties, dodges, challenges and builds stay hidden (see [features.ts](../src/lib/features.ts)).
Solo and bot games count for now.

## Before release day

- [x] Test games: confirmed by Tosh on 25 November 2026. Through the live server: Practice Tool. With the local reader: a custom
      Mayhem 1v1. Not played through the live server: 2v2 or bigger, one team leaving, only the helper leaving. Watch the first
      real game after the release
- [x] The project is registered in Riot's Developer Portal (Tosh)
- [ ] Every player has their Riot ID on the Players page
- [ ] At least two admins can log in
- [ ] **Owner:** Cloudflare > bridge-night > Settings > Build. Write down the deploy commands. For `main` it is usually
      `npx wrangler deploy`. For other branches it must **not** be that one (`npx wrangler versions upload` is fine)
- [ ] **Owner:** Supabase > Integrations. If GitHub is connected, turn off automatic migrations, so step 4 decides when the data
      becomes private
- [ ] **Owner:** Supabase > Authentication. Only Discord is on, and the live address is the Site URL

## Release day

### 1. Get ready
1. Nobody is in a custom game. Everyone exits their helper (BN icon > Exit).
2. **Back up:** Players page > Download backup (JSON). Keep it private, outside the project.
3. Note the newest commit of `main`, in case you have to go back.

### 2. The branch
`integration` is pushed and has everything, also `supabase/migrations/20261126110000_private.sql`. All tests pass.
Merging does not run it: that is step 4.

### 3. The site
1. Open a pull request from `integration` to `main`. The owner reviews and merges it.
2. Wait for Cloudflare to finish, then open the live site and log in. It must work **before** you go on.

Until step 4 the data is still public behind the new login page, and games still only count as tests. Going back is one click.

### 4. Make the data private
```
npx supabase db push --remote=kimgoxjydargqtbwolxz --skip-vault --dry-run
```
It must list **only** `20261126110000_private.sql`. Then:
```
npx supabase db push --remote=kimgoxjydargqtbwolxz --skip-vault
npx supabase functions deploy helper --remote=kimgoxjydargqtbwolxz --no-verify-jwt --use-api
node scripts/check-private.mjs
```
The last command must say "Everything is closed to strangers".

### 5. The helper
The owner, on an up-to-date `main`:
```
git tag helper-v0.5.0
git push origin helper-v0.5.0
```
GitHub builds and publishes it. Everyone downloads it from the Helper page. Their token and settings stay.
Older helpers can still send results, but no live games.

### 6. Check
- [ ] A private window only shows "Log in with Discord"
- [ ] A member sees Teams, Live, Past games, Stats, Rivals and Players; no buttons to swap or delete games
- [ ] An admin sees those buttons, the members and the backup
- [ ] Someone new sees "Waiting for approval", and gets in after an admin approves
- [ ] Declining someone shows them "No access"
- [ ] Making teams works, also 5v5 and uneven
- [ ] A short custom game appears on Live, then in Past games, and counts in Stats
- [ ] The test games from before are gone

## Going back

Start with the smallest step that helps.

| Problem | What to do |
|---|---|
| The site doesn't work, before step 4 | GitHub: revert the pull request. Or Cloudflare > Deployments > roll back. Nothing else is needed |
| The site doesn't work, after step 4 | The same, **and** run [undo.sql](../supabase/release/undo.sql) in the Supabase SQL Editor. This makes the data public again. No data is lost |
| Live games don't arrive | Check the token and the Riot IDs. The helper's log is in `%APPDATA%\BridgeNightHelper\helper-log.txt` |
| Games are saved wrongly | `update public.settings set save_live_games = false where id = 1;` in the SQL Editor stops saving. Admins delete wrong games on Past games |
| Data is lost or wrong | Players page > Restore from backup. It replaces all players, games and settings |
| The old helper function | Deploy it again from the old `main`: `npx supabase functions deploy helper --remote=kimgoxjydargqtbwolxz --no-verify-jwt --use-api` |

The additions from 25 November 2026 (new tables and columns) can stay in every case: the old site ignores them.

## After the release
- Decide about Elo, and rebuild the Teams extras ([teams-page-extras.md](teams-page-extras.md))
- Games without the helper
- The gallery
- Delete the branches that are no longer needed
