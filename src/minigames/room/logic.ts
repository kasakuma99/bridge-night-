import type { RoomInfo, RoomPlayer } from "./types";

/*
 * Pure helpers for Versus rooms: codes, presence entries, message envelopes, size limits.
 * No React, no Supabase, no BroadcastChannel: tested in tests/rooms.test.ts.
 */

/** Room code letters: no I, L, O or U (they look like 1, 0 and V on a shrunk stream). */
export const CODE_LETTERS = "ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 4;
const CODE_RE = new RegExp(`^[${CODE_LETTERS}]{${CODE_LENGTH}}$`);

/**
 * The biggest message a room sends: 64 KB of JSON. Supabase Realtime takes more, but every player downloads every
 * state, so keep pictures small (the champion game sends JPEG data: URLs of a few KB). Bigger messages are dropped
 * with a console warning, on the sending and on the receiving side.
 */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/** How long players wait for a host who dropped out (a refresh, a short network gap) before the room counts as closed. */
export const HOST_GRACE_MS = 10_000;
/** After the host's "close": how long players wait in case the same host mounts the room again right away. */
export const CLOSE_GRACE_MS = 2_000;
/** How long a player waits for a host to show up in a room they just joined. */
export const NO_HOST_MS = 8_000;
/** The host sends its state at most this often; the newest state always goes out. */
export const STATE_MIN_GAP_MS = 100;

/** Realtime topic of a room (Supabase). The RLS policies in 20261127100000_arcade_rooms_trivia.sql match this. */
export const roomTopic = (code: string) => `bn-room:${code}`;
/** BroadcastChannel name of a room (local mode). */
export const localRoomChannel = (code: string) => `bn-room-${code}`;
/** Where hosts list their rooms: presence on this topic (Supabase) or this BroadcastChannel (local). */
export const ROOMS_TOPIC = "bn-arcade-rooms";

/** A new random room code. `random` is for tests. */
export function makeCode(random: () => number = secureRandom): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length) % CODE_LETTERS.length];
  return s;
}

function secureRandom(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.random();
}

/** What someone typed or pasted ("kqzd", " KQZD ", a whole join link) -> "KQZD", or null when it can't be a code. */
export function normalizeCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  const m = /[?&]room=([^&#\s]+)/.exec(s);
  if (m) s = m[1];
  s = s.toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

/** Size of a message as sent (UTF-8 JSON). Infinity when it can't be sent at all (cycles, BigInt...). */
export function payloadBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return Infinity;
    return new TextEncoder().encode(json).length;
  } catch {
    return Infinity;
  }
}

export const fitsPayload = (value: unknown, max = MAX_PAYLOAD_BYTES) => payloadBytes(value) <= max;

/* ---------- presence ---------- */

const AVATAR = "https://cdn.discordapp.com/";

/** A player as anyone in the channel may have written it: keep it short and only Discord avatars. */
export function cleanPlayer(x: unknown): RoomPlayer | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.slice(0, 64) : "";
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
  if (!id || !name) return null;
  const avatar = typeof o.avatar === "string" && o.avatar.startsWith(AVATAR) ? o.avatar.slice(0, 300) : null;
  return { id, name, avatar };
}

/** What each tab tracks in a room's presence. */
export interface RoomMeta {
  role: "host" | "player";
  player: RoomPlayer;
  /** ms since epoch when this tab joined (the host keeps its first one across a refresh). */
  since: number;
}

export function cleanMeta(x: unknown): RoomMeta | null {
  const o = (x ?? {}) as Record<string, unknown>;
  if (o.role !== "host" && o.role !== "player") return null;
  const player = cleanPlayer(o.player);
  if (!player) return null;
  const since = typeof o.since === "number" && Number.isFinite(o.since) ? o.since : 0;
  return { role: o.role, player, since };
}

/** presence key -> clean meta. Broken entries are left out. */
export function cleanPresence(state: Record<string, unknown>): Map<string, RoomMeta> {
  const out = new Map<string, RoomMeta>();
  for (const [key, meta] of Object.entries(state)) {
    const m = cleanMeta(meta);
    if (key && m) out.set(key, m);
  }
  return out;
}

/**
 * The host as a player sees it. Once a host key is known (`pinned`) only that key counts, so a second tab claiming to
 * be host can't take over. Before that: the earliest host. null = no host in the room right now.
 */
export function pickHost(presence: Map<string, RoomMeta>, pinned: string | null): string | null {
  if (pinned) return presence.get(pinned)?.role === "host" ? pinned : null;
  let best: string | null = null;
  for (const [key, m] of presence) {
    if (m.role !== "host") continue;
    const b = best ? presence.get(best)! : null;
    if (!b || m.since < b.since || (m.since === b.since && key < best!)) best = key;
  }
  return best;
}

/** Everyone in the room: host first, then by join time; one entry per person (two tabs of one person count once). */
export function roomPlayers(presence: Map<string, RoomMeta>, hostKey: string | null): RoomPlayer[] {
  const host = hostKey ? presence.get(hostKey) : undefined;
  const rest = [...presence.entries()]
    .filter(([k, m]) => k !== hostKey && m.role === "player")
    .sort((a, b) => a[1].since - b[1].since || (a[0] < b[0] ? -1 : 1))
    .map(([, m]) => m.player);
  const seen = new Set<string>();
  const out: RoomPlayer[] = [];
  for (const p of host?.role === "host" ? [host.player, ...rest] : rest) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/* ---------- messages ---------- */

/**
 * Every broadcast is an envelope. `from` is the sender's presence key; Realtime doesn't tell us who sent a message,
 * so this is what the checks below compare (see the note on trust in ./index.ts).
 *   "state"  host -> all      { from, s }        the public game state
 *   "action" player -> host   { from, to, a }    `to` = the host's key
 *   "hello"  player -> host   { from }           "send me the state" (after joining or reconnecting)
 *   "close"  host -> all      { from }           the host ended the room
 */
export type RoomEvent = "state" | "action" | "hello" | "close";

export interface Envelope {
  from: string;
  to?: string;
  s?: unknown;
  a?: unknown;
}

const KEY_RE = /^[\w.:~-]{1,100}$/;
export const validKey = (k: unknown): k is string => typeof k === "string" && KEY_RE.test(k);

/** A message as received: null when broken or too big. */
export function readEnvelope(payload: unknown, max = MAX_PAYLOAD_BYTES): Envelope | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (!validKey(p.from)) return null;
  if (p.to !== undefined && !validKey(p.to)) return null;
  if (payloadBytes(p) > max) return null;
  return p as unknown as Envelope;
}

/** Player side: a state counts only when it comes from the host and holds something. */
export function acceptState(env: Envelope | null, hostKey: string | null): env is Envelope & { s: unknown } {
  return !!env && !!hostKey && env.from === hostKey && env.s !== undefined && env.s !== null;
}

/** Host side: an action counts only when it is meant for this host and comes from a player in the room right now. */
export function acceptAction(env: Envelope | null, myKey: string, presence: Map<string, RoomMeta>): RoomPlayer | null {
  if (!env || env.to !== myKey || env.from === myKey || env.a === undefined) return null;
  const m = presence.get(env.from);
  return m && m.role === "player" ? m.player : null;
}

/* ---------- open rooms ---------- */

const PHASES = new Set<RoomInfo["phase"]>(["lobby", "playing", "ended"]);

export function cleanRoomInfo(x: unknown): RoomInfo | null {
  const o = (x ?? {}) as Record<string, unknown>;
  const code = normalizeCode(typeof o.code === "string" ? o.code : null);
  const gameId = typeof o.gameId === "string" && /^[a-z0-9-]{1,40}$/.test(o.gameId) ? o.gameId : null;
  const host = cleanPlayer(o.host);
  if (!code || !gameId || !host || code !== o.code) return null;
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 80) : "";
  const players = typeof o.players === "number" && Number.isFinite(o.players) ? Math.max(0, Math.min(99, Math.round(o.players))) : 0;
  const phase = PHASES.has(o.phase as RoomInfo["phase"]) ? (o.phase as RoomInfo["phase"]) : "lobby";
  return { code, gameId, title, host, players, phase };
}

/**
 * Open rooms from the directory presence: each tab tracks { rooms: RoomInfo[] }. One entry per code (the first one
 * seen wins), rooms still in the lobby first, then by title.
 */
export function openRoomsFrom(entries: readonly unknown[]): RoomInfo[] {
  const byCode = new Map<string, RoomInfo>();
  for (const e of entries) {
    const rooms = (e as { rooms?: unknown } | null)?.rooms;
    if (!Array.isArray(rooms)) continue;
    for (const r of rooms.slice(0, 5)) {
      const info = cleanRoomInfo(r);
      if (info && !byCode.has(info.code)) byCode.set(info.code, info);
    }
  }
  const order = { lobby: 0, playing: 1, ended: 2 };
  return [...byCode.values()].sort((a, b) => order[a.phase] - order[b.phase] || a.title.localeCompare(b.title) || a.code.localeCompare(b.code));
}
