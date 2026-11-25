// Bridge Night backup + keep-alive worker (Cloudflare Workers, free plan).
//  * Every day: one tiny read, so the free Supabase project doesn't pause after a quiet week.
//  * Every week: export all tables as JSON into Workers KV, keeping the last 8 snapshots.
// It has no public endpoint: every web request gets a 404. The Supabase secret key is a Worker secret,
// never in git.

interface Env {
  BACKUPS: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

const TABLES: [string, string][] = [
  ["players", "created_at"],
  ["player_riot_ids", "player_id"],
  ["matches", "played_at"],
  ["match_participants", "match_id"],
  ["dodge_log", "id"],
  ["live_game", "id"],
  ["settings", "id"],
  ["members", "user_id"],
  ["helper_tokens", "created_at"],
  ["pending_results", "created_at"],
];
const KEEP = 8;
const PAGE = 1000;

async function rest(env: Env, path: string) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    // New Supabase secret keys (sb_secret_...) go in the apikey header only.
    headers: { apikey: env.SUPABASE_SECRET_KEY },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as unknown[];
}

async function keepAlive(env: Env) {  await rest(env, "settings?select=id&limit=1");
  console.log("keep-alive ok");
}

async function backup(env: Env) {
  const tables: Record<string, unknown[]> = {};
  for (const [t, order] of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await rest(env, `${t}?select=*&order=${order}&offset=${from}&limit=${PAGE}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    tables[t] = rows;
  }
  const now = new Date();
  const key = `backup-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  await env.BACKUPS.put(key, JSON.stringify({ app: "bridge-night", kind: "database-snapshot", createdAt: now.toISOString(), tables }));
  const list = await env.BACKUPS.list({ prefix: "backup-" });
  const old = list.keys.map((k) => k.name).sort().slice(0, Math.max(0, list.keys.length - KEEP));
  for (const k of old) await env.BACKUPS.delete(k);
  console.log(`backup ${key} saved (${Object.values(tables).reduce((a, r) => a + r.length, 0)} rows), removed ${old.length} old`);
}

export default {
  async scheduled(event: ScheduledController, env: Env) {
    if (event.cron === "0 3 * * 1") await backup(env); // Mondays 03:00 UTC
    else await keepAlive(env); // daily
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
