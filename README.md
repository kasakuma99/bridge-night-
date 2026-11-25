# Bridge Night

Team generator, live games, match history and stats for our custom game nights. Fan project, not endorsed by Riot Games.

**Live site:** https://bridge-night.bridge-night.workers.dev · **Helper app:** see the [Releases](https://github.com/kasakuma99/bridge-night-/releases)

## Run it locally

```bash
npm install
npm run dev:sample   # http://localhost:5173 with sample players and games
```

`npm run dev` also uses sample data. A production build (`npm run build`) starts with our real players and an empty history.
In the local preview, the switch at the top ("View as admin / member / visitor") shows what each kind of user sees.

## Checks

```bash
npm test             # unit tests for ratings, stats, team generator, dodge rule, links, data store
npm run typecheck
npm run dev:sample   # in one terminal, then in another:
npm run e2e          # clicks through every feature in a real browser (needs Playwright + Chromium)
```

## How it's built

- Vite + React + TypeScript + Tailwind CSS, React Router, lucide icons, self-hosted Outfit + Plus Jakarta Sans.
- `src/lib/` holds the rules as plain functions: Elo ratings (start 1000, K=32, team average vs team average),
  streaks, bounties, badges, awards, monthly champions, rivalries, team generator, and the dodge rule. Times use Europe/Berlin.
- `src/data/store.ts` is the only place that changes data. Phase 1 keeps data in the browser; Phase 2 swaps in Supabase
  behind the same interface. Ratings, streaks, badges, awards and monthly champions are always recalculated from the full match list.
- Dodge rule: after a break of 12h (editable), a new night starts. Blue side and Red side each get 2 dodges (editable)
  for the whole night, shared across all games, until the next 12h break.
- `npm run icons` (scripts/make-icons.cjs) re-renders the favicon, home-screen icons and the Discord preview image.

## Still to do (later phases)

- Supabase: database, Discord login, member allowlist, realtime live game, Riot IDs members-only, helper tokens, backups.
- Cloudflare hosting with SPA fallback; set absolute URLs for `og:image` once the domain is known.
- Check the U.GG / Mobalytics links for tricky names (Wukong, Nunu & Willump, Kai'Sa, Dr. Mundo, Renata Glasc, Bel'Veth) from a normal network.
- Windows helper app, Edge Function, Discord posts.
