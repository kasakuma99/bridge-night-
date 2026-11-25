# T01: Bring `tosh` up to date with `main` and record a baseline

**Status:** Done on 2026-11-25. All checks ran. The `npm test` problem was fixed afterwards at Tosh's request; see Problems.
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

- [x] 1. Run `git status` and `git branch --show-current`. Continue only on `tosh`, with no changes other than `tosh_docs/`.
- [x] 2. Run `git fetch origin`, then list what is coming: `git log --oneline tosh..origin/main`.
- [x] 3. Start `tosh` from the rewritten `origin/main`. Done in the planning window. Do not merge, rebase, reset or force.
- [x] 4. List every commit that came in under Result, one line each. Point out any change to the database, helper, rating or login so the plan can be updated.
- [x] 5. Run `npm ci`. It replaces `node_modules`, so stop any dev server first. `package-lock.json` must not change.
- [x] 6. Run `npm run typecheck`, `npm test` and `npm run build`. Record each result.
- [x] 7. Run `npm run dev:sample` and check that these pages load without console errors: `/`, `/live`, `/history`, `/stats`, `/rivals`, `/builds`, `/players`, `/helper`. If no browser is available, say so under Result. Stop the server afterwards.
- [x] 8. Run `.\helper\build.ps1` in PowerShell. It only compiles; don't run the exe. The output in `helper/dist/` is ignored by git.
- [x] 9. Run `git status` again. Only `tosh_docs/` should show.

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

Checked on 2026-11-25 at `8ef1bd1` with Node 24.18.0, npm 12.2.3 and Vitest 5.1.1 on Windows 11. `git fetch` showed no new commits on `main`.

| Check | Result | Notes |
|---|---|---|
| Branch starts from `origin/main` | Passed | `5f47193` |
| `npm ci` | Passed | 158 packages added, 0 vulnerabilities, `package-lock.json` unchanged. npm blocked the install scripts of `esbuild` and `workerd`. |
| `npm run typecheck` | Passed | |
| `npm test` | Passed, with a condition | Passed / failed: 33 / 0 from `C:`. From lowercase `c:` the suite failed to load (problem 1, fixed afterwards: now 33 / 0 from both). |
| `npm run build` | Passed | Warning: the JS bundle is 593 kB (175 kB gzipped), over Vite's 500 kB notice. |
| Pages in `dev:sample` | Passed | All 8 pages rendered in headless Chrome at 1280x900, with no console errors or warnings, exceptions or failed requests. No requests to Supabase. Load check only: nothing was clicked. |
| `helper/build.ps1` | Passed | 36,352 byte exe, not run. |
| Working tree clean except `tosh_docs/` | Passed | At the end of the task. The fix for problem 1 later changed `package.json` and added `scripts/vitest.mjs`. |

Commits that came in (all rating changes; no database, helper or login changes):

- `d068bfa` New rating system: per-player Elo with placement, FF penalty and small bonuses
- `4802ad9` Team label: "Team Elo" instead of "avg"
- `5f47193` Gentler Elo: a 100 point gap is now 13 for the favourite and 17 for the underdog

Problems or questions:

1. **`npm test` failed from a lowercase drive letter: fixed after the task.** When Vitest is loaded from `c:\...` instead of `C:\...`, Node treats them as different files and Vitest stops with `Cannot read properties of undefined (reading 'config')`. Settings in `vite.config.ts` load too late to help (tried). `npm test` now runs `scripts/vitest.mjs`, which starts Vitest from its real path. Checked: 33 / 0 for all four combinations of `c:` and `C:`, arguments are passed on, and a failing test still gives exit code 1. Running `npx vitest` directly skips the launcher and still fails from `c:`.
2. **Blocked install scripts: no approval needed.** npm 12 did not run the `esbuild` and `workerd` install scripts, but wrangler 4.168.0 works without them. Checked locally: dry-run deploys of both workers, `wrangler dev` for the site, and `wrangler dev` for the backup worker with both crons against a fake Supabase and local KV. Not tested: login, real deploys, remote resources, R2.
3. **Stopping the dev server** left its `node` child on port 5173. It was identified by its command line and stopped; the port is free.
