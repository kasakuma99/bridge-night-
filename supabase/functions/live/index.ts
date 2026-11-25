// Bridge Night live games.
//  * The helper app sends what it sees in League (type "reading"), with its helper token.
//  * A member decides a game that League named no winner for (type "decide"), with their login.
// All the logic is in core.js, which is built from src/lib/liveServer.ts and tested there.
// Deploy without JWT verification: helpers have their own tokens, and logins are checked below.

import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-types="./core.d.ts"
import { decide, SOLO, step } from "./core.js";

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

const MAX_BODY = 400 * 1024;
const ORIGINS = new Set(["https://bridge-night.bridge-night.workers.dev", "http://localhost:5173"]);

// deno-lint-ignore no-explicit-any
type Any = any;

const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get("origin") ?? "";
  return ORIGINS.has(o)
    ? {
      "access-control-allow-origin": o,
      "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST",
      vary: "origin",
    }
    : {};
};

class Refused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads at most MAX_BODY bytes, whatever the headers say. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY) throw new Refused(413, "too much data");
    parts.push(chunk);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(all));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    /* below */
  }
  throw new Refused(400, "body must be a JSON object");
}

async function isMember(userId: string) {
  const { data } = await db.from("members").select("role").eq("user_id", userId).maybeSingle();
  return data?.role === "member" || data?.role === "admin";
}

/** The helper's token. Its owner must still be an approved member. */
async function helper(secret: string) {
  if (!/^bnh_[0-9a-f]{48}$/.test(secret)) throw new Refused(401, "missing or malformed helper token");
  const { data: tok } = await db
    .from("helper_tokens")
    .select("id,name,created_by,last_used_at")
    .eq("token_hash", await sha256(secret))
    .is("revoked_at", null)
    .maybeSingle();
  if (!tok) throw new Refused(401, "unknown or revoked helper token");
  if (!tok.created_by || !(await isMember(tok.created_by))) throw new Refused(401, "the owner of this token is no longer a member");
  return tok as { id: string; name: string; last_used_at: string | null };
}

async function roster() {
  const [{ data: ids, error: e1 }, { data: pl, error: e2 }] = await Promise.all([
    db.from("player_riot_ids").select("player_id,riot_id"),
    db.from("players").select("id,name,active"),
  ]);
  if (e1 || e2) throw e1 ?? e2;
  const riot = new Map((ids ?? []).map((r: Any) => [r.player_id, r.riot_id]));
  return (pl ?? []).map((p: Any) => ({ id: p.id, name: p.name, active: p.active, createdAt: 0, riotId: riot.get(p.id) }));
}

async function load() {
  const [s, f] = await Promise.all([
    db.from("live_state").select("data,token_id,version,updated_at").maybeSingle(),
    db.from("live_feed").select("data,updated_at").maybeSingle(),
  ]);
  if (s.error || f.error) throw s.error ?? f.error;
  return {
    version: Number(s.data?.version ?? 0),
    state: {
      raw: s.data?.data ?? null,
      token: s.data?.token_id ?? null,
      at: s.data ? Date.parse(s.data.updated_at) : 0,
      shownAt: f.data ? Date.parse(f.data.updated_at) : 0,
    },
    shown: f.data?.data ?? null,
  };
}

/** Saves a finished game, or only remembers it while testing (settings.save_live_games is off). */
async function save(what: Any, feed: Any) {
  const { data: st, error: e0 } = await db.from("settings").select("save_live_games").eq("id", 1).maybeSingle();
  if (e0) throw e0;
  if (!st?.save_live_games) {
    const { error } = await db.from("test_games").upsert({ game_id: what.match.gameId, data: what.match });
    if (error) throw error;
    return { ...feed, savedAs: what.match.id };
  }
  const { data: id, error } = await db.rpc("_save_live_game", { m: what.match, p_known: what.known });
  if (error) throw error;
  return id ? { ...feed, savedAs: id } : feed;
}

/** feed: undefined = unchanged, null = show nothing. */
async function put(version: number, raw: Any, feed: Any, token: string | null) {
  const { data, error } = await db.rpc("_put_live", {
    p_version: version,
    p_state: raw,
    p_feed: feed ?? null,
    p_clear: feed === null,
    p_token: token,
  });
  if (error) throw error;
  return data === true;
}

async function reading(body: Record<string, unknown>, tok: { id: string }) {
  const r = body.reading as Any;
  if (!r || typeof r !== "object" || typeof r.phase !== "string" || r.phase.length > 40) throw new Refused(400, "missing reading");
  const players = await roster();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { version, state, shown } = await load();
    const s = step({ state, shown, reading: r, token: tok.id, players, solo: SOLO, now: Date.now() });
    if (s.state === state) return { ok: true, note: s.note };
    // Nothing going on before or after: no need to write.
    if (!s.state.raw && !state.raw && s.feed === undefined) return { ok: true, note: s.note };
    let feed: Any = s.feed;
    if (s.save) {
      try {
        feed = await save(s.save, feed);
      } catch (e) {
        console.error("could not save the game", e); // tried again with the next reading
      }
    }
    if (await put(version, s.state.raw, feed, s.state.token)) return { ok: true, note: s.note, ...need(s.state.raw) };
  }
  return { ok: false, note: "busy, try again" };
}

/** What the helper should look up next. */
function need(raw: Any) {
  if (!raw?.gameId) return {};
  const base = { gameId: raw.gameId, status: raw.status };
  if (raw.status !== "ended") return base;
  const waitsForAugments = /mayhem/i.test(raw.mode ?? "") && !raw.players.some((p: Any) => p.augments?.length);
  return { ...base, history: !raw.end?.aborted && (!raw.end?.sure || waitsForAugments) };
}

async function decideGame(body: Record<string, unknown>) {
  const choice = body.choice;
  if (choice !== "blue" && choice !== "red" && choice !== "skip") throw new Refused(400, "choose blue, red or skip");
  for (let attempt = 0; attempt < 4; attempt++) {
    const { version, state, shown } = await load();
    const d = decide(shown, String(body.feedId ?? ""), choice, SOLO);
    if (!d) throw new Refused(409, "This game already has a result");
    const feed = d.save ? await save(d.save, d.feed) : d.feed;
    if (await put(version, state.raw, feed, state.token)) return { ok: true, note: "saved" };
  }
  throw new Refused(409, "Busy, try again");
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json" };
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json(405, { ok: false, note: "use POST" });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!secret.startsWith("bnh_")) {
      const { data, error } = await db.auth.getUser(secret);
      if (error || !data.user || !(await isMember(data.user.id))) throw new Refused(401, "Only members can do that");
      const body = await readBody(req);
      if (body.type !== "decide") throw new Refused(400, "unknown type");
      return json(200, await decideGame(body));
    }

    const tok = await helper(secret);
    const body = await readBody(req);
    if (body.type === "hello") return json(200, { ok: true, note: `connected as "${tok.name}"` });
    if (body.type !== "reading") throw new Refused(400, "unknown type");
    // One reading per second and token is plenty.
    if (tok.last_used_at && Date.now() - Date.parse(tok.last_used_at) < 900) throw new Refused(429, "too fast");
    await db.from("helper_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);
    return json(200, await reading(body, tok));
  } catch (e) {
    if (e instanceof Refused) return json(e.status, { ok: false, note: e.message });
    console.error("live error", e);
    return json(500, { ok: false, note: "server error" });
  }
});
