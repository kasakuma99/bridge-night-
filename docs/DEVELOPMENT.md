# Working on Bridge Night

## Run it locally

```bash
npm install
npm run dev:sample   # sample players and games, no account needed
npm run dev:live     # sample data plus the game League is playing on this PC
npm run dev:db       # the real database, with login: changes are real!
npm test             # unit tests, database changes and the live server
npm run e2e          # clicks through the site (first: npm run dev:sample -- --port 5174)
npm run typecheck
.\helper\build.ps1   # builds the helper with the C# compiler that ships with Windows
```

## Where we are

[status.md](status.md) lists what's on the site, what's built but switched off in `src/lib/features.ts`, and what's
still to do. [security-review.md](security-review.md) lists every security finding and whether it's fixed.

## Where things are

- `src/lib/` holds the rules as plain functions: Elo, streaks, badges, awards, rivalries, team generator. Times use Europe/Berlin.
- `src/data/` is the only place that changes data, with a local store for samples and a Supabase store for the live site.
- `supabase/` has the database schema, security rules and the live function. [release.md](release.md) has the release steps.
- `helper/` is the Windows helper app (C#, built by GitHub Actions).
- `backup-worker/` is the backup and keep-alive worker.

## Branches

`main` is the live site: Cloudflare deploys it automatically. New work happens on `<topic>-dev` branches first.

## How it runs for free

| Part | Runs on |
|---|---|
| Website | Cloudflare Workers, deployed automatically from `main` |
| Database, login, live updates | Supabase (Postgres, Discord login, Realtime) |
| Live games | Supabase Edge Function `live` |
| Backups and keep-alive | A Cloudflare Worker on a timer: daily keep-alive, weekly backup (last 8 kept) |
| Helper builds | GitHub Actions |

## Security and privacy

- The site is private. Row Level Security on every table: without approval you can read nothing.
- Riot IDs of people who aren't on the site are never stored, and live data has no Riot IDs at all.
- Helper tokens are stored only as a SHA-256 hash and can be revoked at any time.
- Only the public Supabase key is in this repository. Secret keys live only in Supabase and Cloudflare.
