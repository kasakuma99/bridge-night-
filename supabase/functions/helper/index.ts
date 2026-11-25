// Bridge Night helper endpoint.
// For helper apps before 0.5: only their end-of-game results still count. Live games come from helper 0.5 and newer,
// through the "live" function. Champ select and game start are ignored here, so an old helper can't block the site.
// Every request needs a helper token (created by an admin on the site). Only its SHA-256 hash is stored.
// The service-role key never leaves Supabase: it's provided to this function by the platform.

import { createClient } from "npm:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  (() => {
    try {
      return Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"))[0] as string;
    } catch {
      return "";
    }
  })();
const db = createClient(URL_, KEY, { auth: { persistSession: false } });

const MAX_BODY = 64 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- validation ---------- */

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);
const int = (v: unknown, max = 999) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : undefined);
const riot = (v: unknown) => {
  const s = str(v, 60);
  return s && /^[^#]{1,40}#[^#]{1,10}$/.test(s) ? s.toLowerCase() : undefined;
};
const side = (v: unknown) => (v === "blue" || v === "red" ? v : undefined);
const items = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => Number.isInteger(x) && x > 0 && x < 1_000_000).slice(0, 10) as number[] : undefined;

/** riot id (lowercase) -> player id, only for active players */
async function roster() {
  const [{ data: ids, error: e1 }, { data: pl, error: e2 }] = await Promise.all([
    db.from("player_riot_ids").select("player_id,riot_id"),
    db.from("players").select("id,active"),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const active = new Set((pl ?? []).filter((p) => p.active).map((p) => p.id));
  const m = new Map<string, string>();
  for (const r of ids ?? []) if (active.has(r.player_id)) m.set(String(r.riot_id).toLowerCase(), r.player_id);
  return m;
}

/* ---------- handlers ---------- */

async function result(body: Record<string, unknown>, tokenId: string) {
  const gameId = str(String(body.gameId ?? ""), 40);
  if (!gameId || !/^[0-9A-Za-z_-]+$/.test(gameId)) return { ok: false, note: "missing game id" };
  const map = await roster();
  const players: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(body.players) ? body.players.slice(0, 10) : []) {
    const p = raw as Record<string, unknown>;
    const pid = map.get(riot(p.riotId) ?? "");
    const s = side(p.side);
    if (!pid || !s || seen.has(pid) || typeof p.win !== "boolean") continue;
    seen.add(pid);
    players.push({
      playerId: pid,
      side: s,
      win: p.win,
      champion: str(p.champion, 40),
      kills: int(p.kills),
      deaths: int(p.deaths),
      assists: int(p.assists),
      items: items(p.items),
      damage: int(p.damage, 10_000_000),
    });
  }
  if (players.length < 2) return { ok: true, note: "fewer than 2 of our players, ignored" };
  if (!players.some((p) => p.side === "blue") || !players.some((p) => p.side === "red"))
    return { ok: true, note: "our players were all on one side, ignored" };
  const surrender = body.surrender === "ff" || body.surrender === "early" ? body.surrender : undefined;
  const payload = { gameId, durationSec: int(body.durationSec, 36_000), surrender, players };

  const { data: dup } = await db.from("matches").select("id").eq("game_id", gameId).maybeSingle();
  if (dup) return { ok: true, note: "already saved" };

  const { data: st } = await db.from("settings").select("review_helper_results").eq("id", 1).maybeSingle();
  if (st?.review_helper_results ?? true) {
    const { error } = await db
      .from("pending_results")
      .upsert({ game_id: gameId, payload, token_id: tokenId }, { onConflict: "game_id", ignoreDuplicates: true });
    if (error) throw error;
    return { ok: true, note: "waiting for a member to confirm it on the site" };
  }
  const { data: mid, error } = await db.rpc("_apply_helper_result", { p: payload });
  if (error) throw error;
  return { ok: true, note: mid ? "result saved" : "already saved" };
}

/* ---------- entry ---------- */

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, note: "use POST" });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^bnh_[0-9a-f]{48}$/.test(token)) return json(401, { ok: false, note: "missing or malformed helper token" });

  const { data: tok } = await db
    .from("helper_tokens")
    .select("id,name,created_by")
    .eq("token_hash", await sha256(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!tok) return json(401, { ok: false, note: "unknown or revoked helper token" });
  // The person who made the token must still be an approved member.
  {
    const { data: m } = tok.created_by
      ? await db.from("members").select("role").eq("user_id", tok.created_by).maybeSingle()
      : { data: null };
    if (!m || (m.role !== "member" && m.role !== "admin"))
      return json(401, { ok: false, note: "the owner of this token is no longer a member" });
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return json(413, { ok: false, note: "too much data" });
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json(413, { ok: false, note: "too much data" });
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, note: "body must be JSON" });
  }

  void db.from("helper_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id).then(() => {});

  try {
    switch (body.type) {
      case "hello":
        return json(200, { ok: true, note: `connected as "${tok.name}"` });
      case "champselect":
      case "phase":
        return json(200, { ok: true, note: "live games need helper 0.5 or newer, get it on the Helper page" });
      case "result":
        return json(200, await result(body, tok.id));
      default:
        return json(400, { ok: false, note: "unknown type" });
    }
  } catch (e) {
    console.error("helper error", e);
    return json(500, { ok: false, note: "server error" });
  }
});
