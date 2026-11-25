// node scripts/check-private.mjs   Asks the live project for everything, the way a stranger would.
// Read-only, with the public key from .env.production. After the release, every line has to say "closed".
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.production", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => /^(\w+)=["']?(.*?)["']?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const url = env.VITE_SUPABASE_URL;
const headers = { apikey: env.VITE_SUPABASE_ANON_KEY, "content-type": "application/json" };
let open = 0;
const line = (name, closed, detail) => {
  if (!closed) open++;
  console.log(`${closed ? "closed" : "OPEN  "}  ${name}  ${detail}`);
};

const TABLES = ["players", "matches", "match_participants", "dodge_log", "live_game", "live_feed", "live_state", "test_games", "settings", "members", "helper_tokens", "player_riot_ids", "pending_results"];
for (const t of TABLES) {
  const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers });
  line(t, r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
const CALLS = {
  ensure_member: {},
  set_live: { p_data: {} },
  create_helper_token: { p_name: "x" },
  restore_backup: { p: {} },
  confirm_pending_result: { p_id: "00000000-0000-0000-0000-000000000000" },
  save_live_result: { p_live_id: "00000000-0000-0000-0000-000000000000", p_winner: "blue" },
  _save_live_game: { m: {}, p_known: false },
  _put_live: { p_version: -1, p_state: null, p_feed: null, p_clear: false, p_token: null },
};
for (const [f, body] of Object.entries(CALLS)) {
  const r = await fetch(`${url}/rest/v1/rpc/${f}`, { method: "POST", headers, body: JSON.stringify(body) });
  line(`${f}()`, r.status === 401 || r.status === 403, `HTTP ${r.status}`);
}
for (const f of ["live", "helper"]) {
  const r = await fetch(`${url}/functions/v1/${f}`, { method: "POST", headers, body: '{"type":"hello"}' });
  line(`function ${f}`, r.status === 401, `HTTP ${r.status}`);
}
console.log(open ? `\n${open} open` : "\nEverything is closed to strangers.");
process.exitCode = open ? 1 : 0;
