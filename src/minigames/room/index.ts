import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { SAMPLE_MODE, useAuth } from "../../data/context";
import { supabase } from "../../lib/supabase";
import { useArcadeMe } from "../data";
import { Directory } from "./directory";
import { RoomEngine, ROOM_EVENTS, type RoomSnapshot } from "./engine";
import { localRoomChannel, makeCode, normalizeCode, ROOMS_TOPIC, roomTopic } from "./logic";
import { localTransport, realtimeTransport, type Transport } from "./transport";
import type { Room, RoomInfo, RoomPlayer } from "./types";

/**
 * Live rooms for Versus games (contract: ./types.ts).
 *
 * Supabase: one private Realtime channel per room, topic "bn-room:<CODE>". Presence = who is in the room (RoomMeta in
 * ./logic.ts: role, player, since). Broadcast events (envelopes in ./logic.ts):
 *   "state"  host -> everyone   the public state; sent again when someone joins and when someone says "hello"
 *   "action" player -> host     carries the host's presence key in `to`; the host only takes actions from players in
 *                               the room's presence and passes the player from presence (not from the message) on
 *   "hello"  player -> host     "send me the state" (after joining, and when the host comes back)
 *   "close"  host -> everyone   the host ended the room (left the page inside the site, or leave())
 * Open rooms: every hosting tab tracks { rooms: RoomInfo[] } on the private presence topic "bn-arcade-rooms"
 * (./directory.ts). Its own topic, so the "bn-arcade" presence in ../data.ts is untouched.
 * Only approved members can join any of these topics (RLS on realtime.messages, 20261127100000_arcade_rooms_trivia.sql).
 *
 * Trust: Realtime does not say who sent a broadcast and presence keys are chosen by the client, so the sender checks
 * (players only take state from the host's key, the host only takes actions from keys in the room) stop mix-ups, stale
 * tabs and a second "host" tab; they can't stop an approved member who writes their own client. That is why only
 * members get in at all, the host's browser keeps the answers, and solo scores are checked by the database.
 *
 * Local mode (no Supabase or `npm run dev:sample`): the same over BroadcastChannel("bn-room-<CODE>") and
 * BroadcastChannel("bn-arcade-rooms"), with a made-up name per tab ("Preview", "Preview 2"...), so two tabs can play.
 */

/** null = local mode. Same choice as the data store in src/data/context.tsx. */
const sb = supabase && !SAMPLE_MODE ? supabase : null;

/* ---------- this tab ---------- */

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** A random key per tab (kept across a refresh): the presence key in rooms. Says nothing about the person. */
function tabKey(): string {
  const s = session();
  let k = s?.getItem("bn-tab-key") ?? "";
  if (!/^[a-z0-9]{12}$/.test(k)) {
    k = "";
    for (let i = 0; i < 12; i++) k += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    s?.setItem("bn-tab-key", k);
  }
  return k;
}

/**
 * Local mode: someone per tab, so two tabs are two people. The id comes from the tab key, so it is unique per tab;
 * the name is just a readable counter ("Preview", "Preview 2"...; it starts again after 99, ids stay unique).
 */
function localIdentity(): RoomPlayer {
  const s = session();
  const id = `local-${tabKey()}`;
  try {
    const old = JSON.parse(s?.getItem("bn-room-preview") ?? "null") as RoomPlayer | null;
    if (old && old.id === id && typeof old.name === "string") return old;
  } catch {
    /* new one below */
  }
  let n = 1;
  try {
    n = (Number(localStorage.getItem("bn-room-preview-n")) || 0) + 1;
    if (n > 99) n = 1;
    localStorage.setItem("bn-room-preview-n", String(n));
  } catch {
    /* no storage: everyone is called "Preview" (ids still differ) */
  }
  const me: RoomPlayer = { id, name: n === 1 ? "Preview" : `Preview ${n}` };
  s?.setItem("bn-room-preview", JSON.stringify(me));
  return me;
}

interface Identity {
  me: RoomPlayer | null;
  key: string;
  /** Why you can't play, when me is null. */
  why: string;
}

function useIdentity(): Identity {
  const { user, isMember, pending } = useAuth();
  const arcadeMe = useArcadeMe();
  const local = useMemo(() => (sb ? null : localIdentity()), []);
  const key = useMemo(tabKey, []);
  const me = sb ? (arcadeMe ? { id: arcadeMe.id, name: arcadeMe.name, avatar: arcadeMe.avatar ?? null } : null) : isMember ? local : null;
  const meKey = me ? JSON.stringify(me) : "";
  const stable = useMemo(() => (meKey ? (JSON.parse(meKey) as RoomPlayer) : null), [meKey]);
  const why = !user ? "Log in with Discord to play Versus." : pending || !isMember ? "Only approved members can play Versus." : "";
  return { me: stable, key, why };
}

function transportFor(code: string, key: string): Transport {
  return sb ? realtimeTransport(sb, roomTopic(code), key, ROOM_EVENTS) : localTransport(localRoomChannel(code), key);
}

let dir: Directory | null = null;
function directory(): Directory {
  dir ??= new Directory(() => (sb ? realtimeTransport(sb, ROOMS_TOPIC, tabKey(), []) : localTransport(ROOMS_TOPIC, tabKey())));
  return dir;
}

/* ---------- the host's code survives a refresh ---------- */

/** Rooms this tab hosts right now (you can't join your own room from the same tab). */
const hosting = new Set<string>();
/** Forgetting a code waits a moment: a StrictMode unmount + mount keeps the same room. */
const forget = new Map<string, ReturnType<typeof setTimeout>>();

interface Saved {
  code: string;
  since: number;
}
const savedKey = (gameId: string) => `bn-room-host:${gameId}`;
function readSaved(gameId: string): Saved | null {
  try {
    const v = JSON.parse(session()?.getItem(savedKey(gameId)) ?? "null") as Saved | null;
    return v && normalizeCode(v.code) === v.code && typeof v.since === "number" ? v : null;
  } catch {
    return null;
  }
}

/* ---------- hooks ---------- */

const noop = () => {};

function useSnapshot<S>(engine: RoomEngine<S, unknown> | null): RoomSnapshot<S> | null {
  const sub = useCallback((fn: () => void) => (engine ? engine.subscribe(fn) : noop), [engine]);
  const get = useCallback(() => (engine ? engine.getSnapshot() : null), [engine]);
  return useSyncExternalStore(sub, get, get);
}

interface Api<S, A> {
  setState: (s: S) => void;
  setPhase: (p: RoomInfo["phase"], title?: string) => void;
  send: (a: A) => boolean;
  onAction: (fn: (from: RoomPlayer, a: A) => void) => () => void;
  leave: () => void;
}

/**
 * The Room functions, the same objects for the life of the component, whatever engine is current (StrictMode and a
 * code change swap engines). The host's newest state is kept here and handed to a new engine, and action listeners
 * live here, so a game can subscribe once.
 */
function useApi<S, A>(leave: () => void) {
  const engineRef = useRef<RoomEngine<S, A> | null>(null);
  const lastState = useRef<{ s: S } | null>(null);
  const listeners = useRef(new Set<(from: RoomPlayer, a: A) => void>()).current;
  const attach = useCallback(
    (e: RoomEngine<S, A>) => {
      engineRef.current = e;
      if (lastState.current) e.setState(lastState.current.s);
      const off = e.onAction((from, a) => listeners.forEach((f) => f(from, a)));
      return () => {
        off();
        if (engineRef.current === e) engineRef.current = null;
      };
    },
    [listeners],
  );
  const api = useMemo<Api<S, A>>(
    () => ({
      setState: (s) => {
        lastState.current = { s };
        engineRef.current?.setState(s);
      },
      setPhase: (p, t) => engineRef.current?.setPhase(p, t),
      send: (a) => engineRef.current?.send(a) ?? false,
      onAction: (fn) => {
        listeners.add(fn);
        return () => void listeners.delete(fn);
      },
      leave,
    }),
    [listeners, leave],
  );
  return { api, attach };
}

const toRoom = <S, A>(snap: RoomSnapshot<S>, api: Api<S, A>): Room<S, A> => ({ ...snap, ...api });

const deadRoom = (code: string, role: "host" | "player", me: RoomPlayer | null, error: string): RoomSnapshot<never> => ({
  code,
  role,
  me: me ?? { id: "", name: "" },
  players: [],
  host: null,
  state: null,
  status: "error",
  error,
});

/** Open a new room for this game; it stays open while the component is mounted. A refresh re-opens the same code. */
export function useHostRoom<S, A>(gameId: string, title: string): Room<S, A> {
  const id = useIdentity();
  const [code, setCode] = useState(() => readSaved(gameId)?.code ?? makeCode());
  const [engine, setEngine] = useState<RoomEngine<S, A> | null>(null);
  const [left, setLeft] = useState(false);
  const titleRef = useRef(title);
  titleRef.current = title;
  const meRef = useRef(id.me);
  meRef.current = id.me;
  const canHost = !!id.me && !left;
  const leave = useCallback(() => setLeft(true), []);
  const { api, attach } = useApi<S, A>(leave);

  useEffect(() => {
    const me = meRef.current;
    if (!canHost || !me) return;
    const sk = savedKey(gameId);
    const pending = forget.get(sk);
    if (pending) clearTimeout(pending);
    forget.delete(sk);
    const old = readSaved(gameId);
    const since = old?.code === code ? old.since : Date.now();
    session()?.setItem(sk, JSON.stringify({ code, since } satisfies Saved));

    const d = directory();
    const release = d.acquire();
    let conflict = false;
    const e = new RoomEngine<S, A>({
      role: "host",
      code,
      key: id.key,
      me,
      transport: transportFor(code, id.key),
      gameId,
      title: titleRef.current,
      since,
      onInfo: (info) => d.publish(code, info),
      onConflict: () => {
        conflict = true;
        setCode(makeCode());
      },
    });
    hosting.add(code);
    const detach = attach(e);
    e.start();
    setEngine(e);
    return () => {
      detach();
      void e.stop(!conflict);
      d.publish(code, null);
      release();
      hosting.delete(code);
      setEngine((x) => (x === e ? null : x));
      forget.set(
        sk,
        setTimeout(() => {
          forget.delete(sk);
          if (readSaved(gameId)?.code === code) session()?.removeItem(sk);
        }, 300),
      );
    };
  }, [gameId, code, id.key, canHost, attach]);

  useEffect(() => {
    if (engine && id.me) engine.setMe(id.me);
  }, [engine, id.me]);
  useEffect(() => {
    engine?.setTitle(title);
  }, [engine, title]);

  const snap = useSnapshot(engine as RoomEngine<S, unknown> | null);
  return useMemo(() => {
    if (left) return toRoom<S, A>({ ...deadRoom(code, "host", id.me, "You closed the room."), status: "closed" }, api);
    if (!id.me) return toRoom<S, A>(deadRoom(code, "host", null, id.why), api);
    return toRoom<S, A>(snap ?? { ...deadRoom(code, "host", id.me, ""), status: "connecting", error: undefined }, api);
  }, [snap, code, id.me, id.why, left, api]);
}

/** Join a room by code (or a pasted join link). null code = not joining (returns null). */
export function useJoinRoom<S, A>(code: string | null): Room<S, A> | null {
  const id = useIdentity();
  const norm = normalizeCode(code);
  const [engine, setEngine] = useState<RoomEngine<S, A> | null>(null);
  const [left, setLeft] = useState<string | null>(null);
  const meRef = useRef(id.me);
  meRef.current = id.me;
  const canJoin = !!id.me && !!norm && !hosting.has(norm) && left !== norm;
  const leave = useCallback(() => setLeft(norm), [norm]);
  const { api, attach } = useApi<S, A>(leave);

  useEffect(() => {
    const me = meRef.current;
    if (!canJoin || !me || !norm) return;
    const e = new RoomEngine<S, A>({ role: "player", code: norm, key: id.key, me, transport: transportFor(norm, id.key) });
    const detach = attach(e);
    e.start();
    setEngine(e);
    return () => {
      detach();
      void e.stop(false);
      setEngine((x) => (x === e ? null : x));
    };
  }, [norm, id.key, canJoin, attach]);

  useEffect(() => {
    if (engine && id.me) engine.setMe(id.me);
  }, [engine, id.me]);

  const snap = useSnapshot(engine as RoomEngine<S, unknown> | null);
  return useMemo(() => {
    if (code == null) return null;
    const c = norm ?? String(code).slice(0, 8).toUpperCase();
    if (!norm) return toRoom<S, A>(deadRoom(c, "player", id.me, "That room code doesn't look right."), api);
    if (!id.me) return toRoom<S, A>(deadRoom(c, "player", null, id.why), api);
    if (left === norm) return toRoom<S, A>({ ...deadRoom(c, "player", id.me, "You left the room."), status: "closed" }, api);
    if (hosting.has(norm)) return toRoom<S, A>(deadRoom(c, "player", id.me, "You are hosting this room in this tab. Join from another device or tab."), api);
    const s = snap && snap.code === norm ? snap : { ...deadRoom(c, "player", id.me, ""), status: "connecting" as const, error: undefined };
    return toRoom<S, A>(s, api);
  }, [code, norm, snap, id.me, id.why, left, api]);
}

/** Rooms open right now, for the Arcade page. Empty for visitors. */
export function useOpenRooms(): RoomInfo[] {
  const { me } = useIdentity();
  const on = !!me;
  useEffect(() => (on ? directory().acquire() : undefined), [on]);
  const sub = useCallback((fn: () => void) => (on ? directory().subscribe(fn) : noop), [on]);
  const get = useCallback(() => (on ? directory().getSnapshot() : EMPTY), [on]);
  return useSyncExternalStore(sub, get, get);
}
const EMPTY: RoomInfo[] = [];

export const roomLink = (gameId: string, code: string) => `${location.origin}/arcade/${gameId}?room=${code}`;

export { MAX_PAYLOAD_BYTES, normalizeCode } from "./logic";
export type { Room, RoomInfo, RoomPlayer, RoomStatus } from "./types";
