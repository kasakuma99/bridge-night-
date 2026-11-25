# Build plan: our ARAM Mayhem friends hub

You (Claude Code) are going to build and launch this project for me. I want to do as little manual work as possible: do everything you can yourself. Whenever something needs me (creating an account, logging in, clicking something in a dashboard), stop and tell me exactly what to do, step by step, then continue.

The file `prototype.html` in this folder is a clickable prototype that I already reviewed and liked. **Use it as the reference for features, wording, layout and look** (dark theme, Outfit + Plus Jakarta Sans, Blue side vs Red side board, ice-blue accent). Rebuild it properly as described below. Do not ship the prototype itself.

## Before you start

Ask me these in one message and wait for the answers:

1. The site name / our group name. It must NOT contain "Riot", "League of Legends", "LoL", "ARAM" or champion names (Riot's fan content rules). The prototype uses the placeholder "Bridge Night".
2. Our Discord invite link.
3. Our players: names and Riot IDs (Name#TAG). The Riot IDs are needed so the helper app can recognise everyone. Known so far: Samu, Nick, Francesco, Lenny, Phillip, Tosh, Mantas (more coming).
4. Whether the accent color from the prototype is fine.

## What it is

A hub for our ARAM Mayhem custom games (League of Legends), played as 1v1, 2v2, 3v3 or 4v4. Anyone with the link can view. Only our group (logged in) can change data. A small optional Windows helper app, run by just one or a few of us, fills in picks and results automatically.

## Website features (all are in the prototype, except the Discord posts in 11)

1. **Players**: add, edit, remove (name, Riot ID). Removed players stay in old matches.
2. **Team generator**
   - Tap who is playing. Sizes 1v1 to 4v4; sizes without enough players are disabled. Default is the biggest size up to 3v3.
   - If there are too many players, choose sit-outs fairly (whoever sat out least recently plays first) and rotate.
   - Three styles: "Random", "Balanced" (uses ratings, picks randomly among near-equal splits) and "Captains" (two captains pick in snake order A-B-B-A…, the lower-rated captain picks first, with "Undo last pick"; the remaining players show their rating while picking).
   - "Reroll" with a limit per game (house rule, default 2, can be "No limit"). The button shows "Reroll · 2 left". Toggling a player off and on again must not reset the count; locking teams or cancelling a game does.
   - Behind a collapsed "More options" (shows "2 on" when active): "Avoid the teams from the last game" (last *played* game, and a reroll never repeats the current draft) and "Keep apart [player] and [player]" (always on opposite teams; in Captains mode they become the captains).
   - Bounty: if a player in the draft has 3+ wins in a row, show "Bounty on Samu. 4 wins in a row. Red side can end it tonight." When that streak is ended, the toast says "Bounty claimed!". Bounties don't change ratings.
   - Blue side vs Red side reveal with a short animation. "Lock teams and go to champ select" starts the live game.
   - If a live game is running, "Make teams" asks whether to cancel it first.
3. **Dodge rule** (our house rule)
   - If the new game starts 12 hours or more after the last saved game, each team gets 2 dodges in champ select, in every mode.
   - Dodges apply to the first game of the night. (Ask me once whether they should last the whole night instead.)
   - Hours and number of dodges are editable by members, in one "House rules" box together with the reroll limit and the challenge switch.
   - Show the rule status on Teams and Live: dodges on, or "come back in Xh".
4. **Live game** (shared in realtime with everyone who has the site open)
   - Steps: Champ select → In game → Result.
   - Champ select: each player's champion (picked on the site, or filled in automatically by the helper app). Team dodges shown as dots ("● ○ 1 left"). A Dodge button per player clears their pick and uses one of the team's dodges, logged as "Nick dodged Yuumi".
   - Optional random challenge: a small "Spin a random challenge" link in champ select (Spin again / Remove). Rules: Full AP builds even on AD champions, Full AD builds even on mages, No Flash, Tank items only, No boots, Always take the leftmost augment, Trade champions with a teammate before the game, No champion rerolls, Everyone takes Mark (snowball), No Heal or Barrier. It's saved with the match. A house-rules switch hides the link completely.
   - In game: running timer.
   - Result: K/D/A per player (optional, auto-filled by the helper when available), then Blue won / Red won saves it to the history. Saving also updates sit-out rotation.
   - Red dot on the Live tab while a game is running.
5. **Match history**: newest first, date, mode, duration, teams, champions, K/D/A, items (when the helper sent them), dodges, the challenge if there was one, winner highlighted. Filter by player and mode. Swap winner and delete (with confirmation) for members.
6. **Stats**
   - "Last 30 days / All time" switch. In the 30-day view, sort by wins, with the title "X has the most wins in the last 30 days".
   - Columns: wins, W–L, win rate, average K/D/A, rating, streak.
   - Rating: Elo-style, start 1000, K=32, team average vs team average, always all-time.
   - Records: most kills in one game, best KDA ratio (min 3 games), most kills overall, most wins.
   - Best duos and trios (min 3 games together), most played champions.
   - Awards this week (last 7 days, calculated automatically, no voting): MVP (most wins, min 2 games), most kills, best KDA, most deaths.
   - Monthly champions: the player with the most wins each calendar month (min 3 games), the current month shown as "so far". The 30-day/all-time stats are not reset.
   - Player profile (opens when you tap a leaderboard row): rating chart, record, best teammate, favourite victim, toughest opponent, most played champions, and badges only when earned: Monthly champion (gold), On fire (5+ wins in a row), Bounty hunter, Giant slayer (won with under 35% win chance), Champion pool (won with 8+ different champions), 25/50/100 games.
   - With helper data: most bought items per player and per champion.
7. **Rivals**: head-to-head when two players were on opposite sides. When someone wins 3+ in a row against the same player, show a banner: 3 = "has the upper hand on", 4–5 = "is dominating", 6+ = "owns" (e.g. "Samu is dominating Nick – 4 wins in a row head-to-head"). Show the top rivalry on the Teams page, all of them on Rivals, plus a full head-to-head table. After saving a game, show a toast if a rivalry between two opponents of that game grew.
8. **Builds**: champion search with icons from Riot's Data Dragon (always the latest version). Buttons open ARAM Mayhem builds in a new tab:
   - U.GG: `https://u.gg/lol/champions/aram-mayhem/{champion}-aram-mayhem`
   - Mobalytics: `https://mobalytics.gg/lol/champions/{champion}/mayhem-builds`
   - Verify the URL format for tricky names (Wukong, Nunu & Willump, Kai'Sa, Dr. Mundo, Renata Glasc, Bel'Veth) and test several links. Only link to these sites; never scrape or copy their data.
   - Also show our group's own games and win rate on that champion.
9. **Discord**: "Join our Discord" button in the header and footer. Open Graph/Twitter meta tags and a preview image, so the link looks good in Discord.
10. **Helper page**: explains what the helper does, who needs it (just one player per game), the download link, and how to check it is safe.
11. **Discord posts (optional, off by default)**: an admin can paste a Discord channel webhook URL in settings. When teams are locked, post the teams; when a result is saved, post the winner, K/D/A and any rivalry or bounty news. Send it from a Supabase Edge Function so the webhook URL is stored as a secret and never reaches the browser.

Don't build these unless I ask later (kept out so the site stays simple): tournament brackets, voting for awards, comments or a trash-talk wall, screenshot uploads, augment bingo, punishment wheel.

No Riot API key is needed. Riot's API doesn't return custom games (that would need player opt-in through Riot Sign On and a production key), and development keys expire every 24 hours. Champion and item icons come from Data Dragon, which needs no key. Custom-game data comes only from the helper app.

## Data rules

- Ratings, streaks, badges, awards and monthly champions are always calculated from the full match list, never stored by hand, so editing or deleting a game keeps everything correct.
- Days, "tonight", the 12h dodge break and calendar months use our time zone, Europe/Berlin.
- Only one live game at a time. The database is the source of truth: if two people tap "Blue won" at the same moment, or the helper and a person save at once, the game must be saved only once (unique constraint or transaction).
- Riot IDs are only visible to logged-in members. Visitors see names only.
- Launch with our real players and an empty history: no sample games and no "Reset sample data" button on the live site. Sample data is only for local development.

## Design rules (so it does NOT look vibe-coded)

- Follow the prototype's look. Define design tokens (colors, type scale, 4/8px spacing, radius) and use them everywhere.
- One accent color plus Team Blue and Team Red. No rainbow or purple gradients, no emojis as icons, one icon set (lucide).
- Fonts self-hosted: Outfit for headings and numbers, Plus Jakarta Sans for text (exactly as in the prototype). No monospace or condensed "code" look anywhere.
- Loading skeletons, empty states, error messages, toasts, confirm dialogs, disabled states.
- Subtle motion only, respect reduced motion. Phone first, fully responsive, keyboard accessible, visible focus, good contrast.
- Logo/wordmark from the site name, favicon, custom 404 page.
- Web app manifest and icons, so friends can use "Add to Home Screen" on iPhone and Android and open it like an app.
- Footer: Discord link, "Fan project" note, and this exact notice with the site name filled in:
  "[Site name] was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project."
- Never use Riot or League logos. Data Dragon champion and item icons are fine.

## Tech (everything must stay free)

- Vite + React + TypeScript + Tailwind CSS. Few, well-known dependencies.
- **Supabase (free plan)**: database, auth, realtime (live game), Edge Functions (helper uploads).
  - Tables (via migrations): players, matches, match_participants (team, champion, kills, deaths, assists, items, damage), live_game, dodge_log, settings, members, helper_tokens.
  - Row Level Security on every table. Visitors can read the public game data (players' names, matches, live game, stats); only logged-in members can write. Exceptions: Riot IDs are members-only (separate table or view), and `members`, `helper_tokens` and anything secret are admin-only, never readable by visitors.
  - Store helper tokens only as a hash; show the token once when it is created.
  - Login with Discord via Supabase Auth (fallback: email magic link). Allowlist of members. Make me the admin who can add and remove members.
  - New Supabase projects need explicit Postgres grants for the Data API; set those up.
  - Only the public anon key goes into the website. Never put the service_role key in the website, the helper or git. Keep secrets in .env.local (in .gitignore).
  - Free projects pause after a week of low activity, and the free plan has **no automatic backups**. Handle both with a small Cloudflare Worker on a Cron Trigger (free):
    - once a day: one small read from the database (keep-alive)
    - once a week: export all tables as JSON into Workers KV, keeping the last 8 snapshots
    - Don't use a scheduled GitHub Action for this: GitHub turns off scheduled workflows in public repos after 60 days without commits.
    - Check the current free limits for Workers, Cron Triggers and KV, and pick nothing that needs a credit card.
  - Admin settings get "Download backup (JSON)" and "Restore from backup" (with a confirm dialog), so I can always save our history myself.
- **Hosting**: Cloudflare free plan with automatic deploys from a GitHub repository and a free *.pages.dev (or *.workers.dev) address. Use what Cloudflare currently recommends for static sites. SPA fallback so refreshing any page works.

## Helper app (Windows, optional, run by one or a few players)

Goal: nobody has to type picks or results. Only one player in the game needs it running.

How it works:
- A small tray app for Windows. No admin rights, no autostart unless the user turns it on, no background service.
- It reads the League client's local API on the same PC (port and password from the client's `lockfile` in the League install folder, HTTPS on 127.0.0.1). It only reads; it never sends commands to the client.
- During champ select: read both teams' picks and send them to the site's live game, so the picks appear automatically.
- Move the live game along by itself using the client's game phase, so nobody has to tap through the steps: when champ select starts and teams are drafted on the site, lock them automatically; when the game loads, switch to "In game" and start the timer; when the game ends, fill in K/D/A, items and the winner. The manual buttons stay for games where nobody runs the helper.
- After the game: read the end-of-game stats for **all** players (Riot ID, champion, team, win/loss, K/D/A, items, damage, game ID, duration) and send them.
- Match players by Riot ID. Ignore unknown accounts.
- Verify the exact local endpoints and fields yourself before relying on them (gameflow phase, champ select session, end-of-game stats). They are unofficial and can change with patches, so handle missing fields gracefully and log clearly.
- Follow Riot's developer policies for League client data: read-only, no competitive-advantage features, nothing that isn't already visible to the player.

Sending data safely:
- The helper sends data to a **Supabase Edge Function**, never directly to tables.
- Each helper uses its own token (from helper_tokens, created by an admin on the site; revocable). The Edge Function checks the token, validates the data, and stores it.
- Deduplicate by game ID, so several helpers in the same game don't create duplicates.
- If a live game is open on the site with the same players, attach the result to it (fill picks, K/D/A, items, winner, then save). Otherwise create a new match.
- Show a small "Pending results" box on the site where a member can confirm or discard a helper result before it counts (on by default, can be switched off).

Build and distribution:
- Keep it small and simple (e.g. Node.js packaged as a single Windows .exe, or another lightweight option you recommend). No crypto, no ads, no telemetry.
- Source code stays in the same GitHub repo so anyone can read it. Build the .exe with GitHub Actions and publish it as a GitHub Release. The site's Helper page links to it and shows its SHA-256 hash.
- Settings window: site URL, helper token, "Pause sending", log of the last messages sent.
- Explain to me that unsigned .exe files can trigger antivirus warnings, and how my friends can verify it (hash, source code, VirusTotal).

## How to work

1. Check my setup first: Node.js LTS and Git. I already have free GitHub, Supabase and Cloudflare accounts (log in to those; don't create new ones). If anything is missing, tell me and install it only through official sources (winget) after I agree.
2. Start in plan mode: show me the plan (pages, components, database schema, helper flow, deploy steps) and wait for my OK.
3. **Phase 1**: build the complete website locally with sample data, matching the prototype, and open it in the preview. Test every feature yourself before saying it's done.
4. **Phase 2**: connect Supabase (use the Supabase CLI where possible). Walk me through the logins and dashboard clicks, including creating the Discord application for login.
5. **Phase 3**: create a public GitHub repository (GitHub CLI if possible) and deploy to Cloudflare. Before the first push, check that no key, token or .env file is in the commit. Walk me through the logins. Give me the live link.
6. **Phase 4**: build the helper app, the Edge Function and the Helper page. Test with a real custom game together with me, then publish the release.
7. At the end, give me: the live link, how to add/remove members and helper tokens, how to update the site later, and ideas for next features.

Rules: commit after every working step with clear messages. Only install official, widely used packages. Never run scripts from unknown websites. Ask before deleting anything outside this project folder.
