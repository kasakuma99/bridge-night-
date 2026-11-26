# Where we are

Checked against the code on 2026-11-26. Site: `main`, deployed by Cloudflare. Helper: **0.7.0** (`helper-v0.7.0`).

## On the site now

| Page | What it does |
|---|---|
| Teams | Random teams from 1v1 to 5v5, uneven teams (3v2), fair sit-out rotation, a smaller game offered when there are too few players |
| Live | The running custom game, filled in by the helper: champions from the loading screen on, levels, K/D/A, items, a log |
| Past games | Every game with champions, K/D/A, items, surrenders. Admins swap winners and delete games |
| Stats | Leaderboard, streaks, records, a profile card per player |
| Rivals | Head-to-head and "X is dominating Y" |
| Helper | Download, SHA-256, personal helper tokens (up to 3 per member) |
| Players (admin) | Players and Riot IDs, approving and blocking members, backup download and restore |

Behind the scenes: Discord login, members-only site, the `live` Edge Function, and the backup worker (a daily keep-alive
and a weekly backup, keeping the last 8).

## Built but switched off

These are in [features.ts](../src/lib/features.ts). The code, tests and stored data are there: set a flag to `true` to
bring a feature back, then check the pages.

| Flag | What it brings back | Now |
|---|---|---|
| `ratings` | Elo ratings | Everyone has a fixed 1000 "Papi Points" |
| `classicTeams` | The samu-dev Teams page (hero, captains, sit-out choice, lock by hand) and the old Live page | off |
| `teamModes` | Balanced and Captains (needs `classicTeams`) | off |
| `bounties` | Bounties on win streaks (needs `classicTeams`) | off |
| `rerollLimit` | "Reroll · 2 left" (needs `classicTeams`) | off |
| `dodges` | The 12-hour dodge rule | off |
| `challenges` | Random challenges in champ select | off |
| `builds` | Builds page (U.GG and Mobalytics links) | off |
| `playerPages` | A page per player (`/stats/:id`) instead of the side card | off |
| `rivals` | Rivals page | **on** |
| `privateSite` | Only approved members see anything | **on** |
| `soloGames` | Games with our players on one side only (alone or against bots) count. **For testing: switch off** | **on** |

What the current Teams page still misses compared to the samu-dev one is listed in
[teams-page-extras.md](teams-page-extras.md).

## Not built yet

- Discord posts (teams when locked, the result with rivalry and bounty news), item 11 of the build plan.
- Games without the helper (see [release.md](release.md)). When the helper ran but League named no winner, a member can
  already pick "Blue won" or "Red won" on the Live page. A game with no helper at all can't be entered yet.
- An undo or log for deleted and changed games (see [security-review.md](security-review.md), #2).

## To do

- [ ] Switch `soloGames` off once testing is done.
- [ ] Decide about Elo (`ratings`) and rebuild the Teams extras.
- [ ] Turn off the Email login provider on the live Supabase project if only Discord is used.
- [ ] Remove the old `helper` Edge Function once nobody runs a helper older than 0.5.
- [ ] Delete old branches. All changes from `integration`, `launcher-dev`, `samu-dev` and `tosh` are in `main`.
      `readme-dev` still has a few commits that aren't (the "Launcher 0.7 spec" notes): check them before deleting it.

Security: see [security-review.md](security-review.md). Most findings are fixed, and the summary table lists what is left.
