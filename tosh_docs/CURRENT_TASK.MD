# T01: Bring `tosh` up to date with `main` and record a baseline

**Status:** Ready to start: do step 1, then continue at step 5. The planning window remade the branch from the rewritten `main` on 2026-11-25.
**Planned:** 2026-11-25
**Depends on:** nothing

Read the rules in [TODO.MD](TODO.MD) first.

## Why

The branch now starts from the rewritten `main`, which includes a new per-player Elo rating. We need to know what passes today, so later failures can be traced to our own changes.

## State when this was planned (check it again)

- `tosh` is `main` (`5f47193`) plus the commit that adds `tosh_docs/`. Do not push.
- If `git fetch` shows new commits on `main`, a fast-forward no longer works because `tosh` has its own commit. Record them under Result and continue on the current version; the planning window decides how to merge.
- `tosh_docs/` is committed on `tosh`
- `node_modules` exists, but was not checked
- Node 24.18.0 (Vitest needs 22.12+, 24, or 26+)

## Steps

- [ ] 1. Run `git status` and `git branch --show-current`. Continue only on `tosh`, with no changes other than `tosh_docs/`.
- [x] 2. Run `git fetch origin`, then list what is coming: `git log --oneline tosh..origin/main`.
- [x] 3. Start `tosh` from the rewritten `origin/main`. Done in the planning window. Do not merge, rebase, reset or force.
- [x] 4. List every commit that came in under Result, one line each. Point out any change to the database, helper, rating or login so the plan can be updated.
- [ ] 5. Run `npm ci`. It replaces `node_modules`, so stop any dev server first. `package-lock.json` must not change.
- [ ] 6. Run `npm run typecheck`, `npm test` and `npm run build`. Record each result.
- [ ] 7. Run `npm run dev:sample` and check that these pages load without console errors: `/`, `/live`, `/history`, `/stats`, `/rivals`, `/builds`, `/players`, `/helper`. If no browser is available, say so under Result. Stop the server afterwards.
- [ ] 8. Run `.\helper\build.ps1` in PowerShell. It only compiles; don't run the exe. The output in `helper/dist/` is ignored by git.
- [ ] 9. Run `git status` again. Only `tosh_docs/` should show.

## Out of scope

- Fixing anything that fails. Record it instead.
- `npm run e2e`: Playwright is not declared yet (T81).
- `npm run dev`: it can use the live database. Use `dev:sample` only.
- Committing, pushing, migrations and deploys.

## Done when

- `tosh` contains `5f47193`
- Every check in steps 5 to 8 has a recorded result, whether it passed, failed or could not be run
- No tracked files changed apart from `tosh_docs/`

## When finished

1. Fill in the Result section.
2. In TODO.MD, set T01 to `[x]` (or `[!]` with the reason) and add a line to the Completed log.
3. Stop. The next task is planned in the other window.

## Result

_To be filled in by the working window._

| Check | Result | Notes |
|---|---|---|
| Branch starts from `origin/main` | Passed | `5f47193` |
| `npm ci` | | |
| `npm run typecheck` | | |
| `npm test` | | Passed / failed: |
| `npm run build` | | |
| Pages in `dev:sample` | | |
| `helper/build.ps1` | | |
| Working tree clean except `tosh_docs/` | | |

Commits that came in (all rating changes; no database, helper or login changes):

- `d068bfa` New rating system: per-player Elo with placement, FF penalty and small bonuses
- `4802ad9` Team label: "Team Elo" instead of "avg"
- `5f47193` Gentler Elo: a 100 point gap is now 13 for the favourite and 17 for the underdog

Problems or questions:
