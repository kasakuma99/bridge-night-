# Bridge Night: TODO

Master task list for the `tosh` branch. Last updated: 2026-11-25.

## How these docs work

- **TODO.MD** (this file) lists every task and its status.
- **CURRENT_TASK.MD** holds the detailed plan for the one task being worked on.
- The **planning window** writes CURRENT_TASK.MD. The **working window** (Auto) carries it out.
- When a task is finished, the working window:
  1. fills in the Result section of CURRENT_TASK.MD,
  2. updates the status here and adds a line to the Completed log,
  3. stops. The planning window then writes the next task.

Status: `[ ]` not started, `[~]` in progress, `[x]` done and verified, `[!]` blocked (say why)

## Rules for every task

- Work on `tosh` only. Never push to `main`: it deploys the live site automatically.
- Commit, push, apply migrations, deploy functions or workers, and publish helper releases only when Tosh asks.
- The Supabase project in `.env.production` is the **live** one. Do not test against it (see D1).
- Migrations already in the repo are never edited. Add a new one, timestamped after the newest.
- This repo is **public**. No secrets, tokens, Riot IDs or raw game captures in commits or in these docs.
- `main` moves often. Run `git fetch` and check before starting a task.
- The history of `main` was rewritten on 2026-11-25. Never push, merge or rebase the old history: `tosh-old-local`, or any commit that does not descend from `5f47193`. If git reports unrelated histories, stop.
- Commit only with a GitHub noreply email. It is set for this repo on Tosh's PC; check `git config user.email` in any other clone.
- A task is `[x]` only after its checks have passed. Otherwise write down what was not verified.

## Scope

Private web app for a group of friends playing custom League games:

1. Private access: Discord login, manual approval on first login, then stay logged in
2. Random team generator: pick players; 1v1 to 5v5; warning popup when teams would be unequal
3. Live page: red and blue teams, site names, champions, items, game clock, mode, map, result (surrender or nexus), "recently finished" for a few minutes. Augments appear once the game has ended (D3).
4. Past games tab: detailed breakdown of each game
5. Stats page: leaderboard of everyone with 1+ game (games, W/L, win %, best win streak, Papi Points)
6. Gallery: photos and videos with uploader, date and title; only the uploader and admins can edit

## Decisions

| ID | Question | Proposed default | Decision |
|---|---|---|---|
| D1 | Where do we test database changes? | A separate free Supabase project | **Separate free Supabase project** (2026-11-25) |
| D2 | Who sees enemy items during a live game? | Not the players in that game, until it ends | **Everyone, immediately** (2026-11-25). Risk noted in T84. |
| D3 | Live augments: most are not exposed until the game ends | Show the ones we can detect live, all of them afterwards | **Only after the game** (2026-11-25) |
| D4 | Where is gallery media stored? | Cloudflare R2 | **Cloudflare R2** (2026-11-25) |
| D5 | Save helper results automatically, or have a member confirm? | Automatic | **Automatic** (2026-11-25) |
| D6 | Who links a Discord member to a player and their Riot ID? | An admin, when approving | **An admin, when approving** (2026-11-25) |
| D7 | Uneven player count | Popup: play uneven, sit someone out, or cancel | **All three choices** (2026-11-25) |
| D8 | Keep Rivals, Builds, balanced and captains modes, bounties, reroll limit, dodges, challenges? | Keep | **Keep the code, remove from the frontend for now** (2026-11-25). See T22. |
| D9 | Which Elo formula? `main` has a new per-player one | Use the one on `main` | **Later** (2026-11-25). Until then every player has a fixed 1,000 "Papi Points". See T62. The formula on `main` also counts bounty and win streak bonuses and a surrender penalty, so revisit that with D8. |

## Tasks

### Phase 0: Foundation
- [x] **T01** Bring `tosh` up to date with `main` and record a test baseline. Branch remade from the rewritten `main` (`5f47193`); baseline recorded.
- [ ] **T02** Set up a separate Supabase test project with Discord login, and point local development at it (D1)
- [ ] **T03** Capture one real custom ARAM: Mayhem game (read-only) to confirm augment, surrender and live fields. Proves or disproves the assumptions behind T30 to T45. Captures stay out of git.

### Phase 1: Private access
- [ ] **T10** Show only a login or waiting page to anyone who is not an approved member
- [ ] **T11** Database: only approved members can read game data. Today `anon` can read players, matches, match_participants, dodge_log, live_game and settings, and so can pending and removed users.
- [ ] **T12** Fix: declined or removed people cannot reappear for approval. The `members` row is created only on first signup.
- [ ] **T13** Link each Discord member to a player and Riot ID; an admin does it when approving (D6)

### Phase 2: Team generator
- [ ] **T20** 5v5 support. The limit of 4 is in the `matches.mode` check, `_insert_match` (`least(4, ...)`), `TeamSize`, `maxSize`, the Teams and History UI, and `startLiveFromLobby`.
- [ ] **T21** Uneven teams and warning popup (D7). Needs storage for unequal team sizes and tests for Elo with unequal teams.
- [ ] **T22** Hide the extras behind one feature-flag file, keeping their code, tests and data (D8):
  - Rivals and Builds: nav links, footer links, routes, rivalry banner and rivalry toasts
  - Balanced and captains modes: random only, even if a browser remembers another mode
  - Reroll limit: not just hidden, rerolls become unlimited
  - Bounties: banner, toast and badge
  - Dodges and challenges: rule info, buttons, pips, spinner, related house rules, and their lines in History
  - The existing e2e script covers these features, so adjust it with T81

### Phase 3: Post-game data
- [ ] **T30** Schema: augments, mode, map, queue, patch, how the game ended, extra per-player stats
- [ ] **T31** Helper: after the game, read `/lol-match-history/v1/games/{gameId}` for augments, surrender and full stats. Check first whether the existing end-of-game surrender scan is enough (T03).
- [ ] **T32** Helper endpoint and SQL: validate and store the new fields
- [ ] **T33** Site: augment names and icons from Community Dragon. Needs an `img-src`/`connect-src` CSP update in `public/_headers`.

### Phase 4: Live page
- [ ] **T40** Separate live-state table that only the helper endpoint writes. `set_live` overwrites the whole `live_game` row, so it would erase helper updates.
- [ ] **T41** Store: apply live updates directly. Today any database change makes every browser reload every table.
- [ ] **T42** Helper: poll the Live Client API (`https://127.0.0.1:2999/liveclientdata/allgamedata`) during custom games only
- [ ] **T43** Helper endpoint: accept live updates, handle several helpers in one game. Items are visible to all members at once (D2).
- [ ] **T44** Live UI: teams, names, champions, items, mode, map, clock synced to game time. No augments during the game (D3).
- [ ] **T45** Automatic finish: winner, surrender or nexus, augments, "recently finished" for a few minutes, then Past games. Saved without confirmation (D5); admins can still correct or delete a game.

### Phase 5: Past games
- [ ] **T50** Past games tab with a detail page per game

### Phase 6: Stats
- [ ] **T60** Leaderboard columns: games, W/L, win %, best win streak, Papi Points. Best streak is already calculated (`bestStreak` in `src/lib/stats.ts`).
- [ ] **T61** Include everyone with 1+ game. Removed players are hidden today.
- [ ] **T62** Papi Points: show a fixed 1,000 for every player, current and future, and use that name instead of Elo or rating (D9). Games do not change it for now. Keep the rating code and its tests; hide rating changes in History, rating charts, and team averages or win chances based on it. Use the feature-flag file from T22.

### Phase 7: Gallery
- [ ] **T70** R2 bucket, upload worker that checks membership, table and access rules (D4). Check whether R2 asks for a payment method.
- [ ] **T71** Upload photos and videos with a title, plus size and type limits
- [ ] **T72** Gallery page: media, uploader, date, title; edit and delete for the uploader and admins

### Phase 8: Quality and release
- [ ] **T80** GitHub Actions: typecheck, tests and build on every push
- [ ] **T81** Declare Playwright, pin the Node version, typecheck the backup worker and Edge Function
- [ ] **T82** Extend the backup worker and JSON restore to all new tables and fields
- [ ] **T83** Update README, Helper page and visitor wording for a private site
- [ ] **T84** Riot policy: register the project in the Developer Portal; review the Elo rule; review live item visibility (D2: players can see enemy items their scoreboard has not revealed); never show augment win rates
- [ ] **T85** Release: migrations, functions, helper build, merge to `main`

## Facts to keep in mind

- Riot's web API does not return ARAM: Mayhem games (match-v5 gives 403). The local helper is the only source.
- The League client and in-game APIs are local and can change with any patch. Missing fields must not break anything.
- The helper stays GET-only towards the League client, and custom games only.
- Custom Mayhem augments and surrender fields are **not proven yet** (T03). Public projects confirm augments for matchmade games only.
- Live, only augments that replace a summoner spell are detectable, so the Live page shows none until the game ends (D3).
- Nexus wins are inferred: the game ended normally and no surrender flag was set.
- Arena is out of scope: it has no red and blue teams.

## Completed log

| Date | Task | Notes |
|---|---|---|
| 2026-11-25 | T01 | Baseline at `8ef1bd1`: install, typecheck, 33 tests, build, 8 sample pages and helper compile all pass. Afterwards: `npm test` fixed for paths starting with lowercase `c:` (`scripts/vitest.mjs`), and wrangler checked locally. |
