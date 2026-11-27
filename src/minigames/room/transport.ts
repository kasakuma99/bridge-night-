import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * One presence + broadcast channel, the same shape for Supabase Realtime and for BroadcastChannel (local mode).
 * The room engine (./engine.ts) and the open-rooms directory (./directory.ts) only talk to this.
 */
export type TransportStatus = "connecting" | "open" | "closed" | "error";

export interface TransportHandlers {
  status: (s: TransportStatus, error?: string) => void;
  /** Everyone tracked right now (presence key -> the newest meta), including yourself, and who came and went since last time. */
  presence: (state: Record<string, unknown>, joined: string[], left: string[]) => void;
  broadcast: (event: string, payload: unknown) => void;
}

export interface Transport {
  connect(h: TransportHandlers): void;
  /** null = stop being listed. Remembered and sent again after a reconnect. */
  track(meta: unknown): void;
  /** Never echoed back to yourself. Dropped while not connected. */
  send(event: string, payload: unknown): void;
  close(): Promise<void>;
}

/** Diffs presence snapshots into joined / left keys. */
function presenceDiff() {
  let prev = new Set<string>();
  return (state: Record<string, unknown>) => {
    const now = new Set(Object.keys(state));
    const joined = [...now].filter((k) => !prev.has(k));
    const left = [...prev].filter((k) => !now.has(k));
    prev = now;
    return { joined, left };
  };
}

/* ---------- Supabase Realtime ---------- */

/** The last leave of each topic. realtime-js hands back a channel that is still leaving for the same topic, and
 *  subscribe() on that does nothing, so a new channel waits until the previous one is removed (round-1 StrictMode bug). */
const leaving = new Map<string, Promise<void>>();

export function realtimeTransport(client: SupabaseClient, topic: string, key: string, events: readonly string[]): Transport {
  let ch: RealtimeChannel | null = null;
  let dead = false;
  let meta: unknown = null;
  let subscribed = false;
  const diff = presenceDiff();

  const push = () => {
    if (!ch || !subscribed) return;
    if (meta != null) void ch.track(meta as Record<string, unknown>);
    else void ch.untrack();
  };

  return {
    connect(h) {
      h.status("connecting");
      void (leaving.get(topic) ?? Promise.resolve()).then(() => {
        if (dead) return;
        // Private: only approved members may join (RLS on realtime.messages, 20261127100000_arcade_rooms_trivia.sql).
        const c = client.channel(topic, { config: { private: true, presence: { key }, broadcast: { self: false, ack: false } } });
        ch = c;
        c.on("presence", { event: "sync" }, () => {
          if (dead) return;
          const state: Record<string, unknown> = {};
          for (const [k, metas] of Object.entries(c.presenceState())) if (metas.length) state[k] = metas[metas.length - 1];
          const { joined, left } = diff(state);
          h.presence(state, joined, left);
        });
        for (const ev of events) c.on("broadcast", { event: ev }, (m: { payload?: unknown }) => !dead && h.broadcast(ev, m.payload));
        c.subscribe((status, err) => {
          if (dead) return;
          if (status === "SUBSCRIBED") {
            subscribed = true;
            h.status("open");
            push(); // again after every reconnect
          } else {
            subscribed = false;
            if (status === "CHANNEL_ERROR") {
              const denied = /unauthori[sz]ed|denied|policy|permission/i.test(err?.message ?? "");
              h.status("error", denied ? "Only approved members can play Versus. An admin has to let you in first." : "Connection problem. Trying again...");
            } else if (status === "TIMED_OUT") h.status("connecting");
            else h.status("closed", "The connection closed.");
          }
        });
      });
    },
    track(m) {
      meta = m;
      push();
    },
    send(event, payload) {
      if (!ch || !subscribed || dead) return;
      void ch.send({ type: "broadcast", event, payload }).catch(() => undefined);
    },
    close() {
      dead = true;
      const c = ch;
      ch = null;
      if (!c) return Promise.resolve();
      const p = client.removeChannel(c).then(
        () => undefined,
        () => undefined,
      );
      leaving.set(topic, p);
      void p.then(() => leaving.get(topic) === p && leaving.delete(topic));
      return p;
    },
  };
}

/* ---------- BroadcastChannel (local mode: two tabs of `npm run dev:sample`) ---------- */

/** Local presence is a heartbeat: every tab repeats its meta, and one that goes quiet this long counts as gone. */
export const LOCAL_BEAT_MS = 1_500;
export const LOCAL_GONE_MS = 5_000;

type LocalMsg =
  | { t: "p"; key: string; meta: unknown }
  | { t: "bye"; key: string }
  | { t: "hi"; key: string }
  | { t: "b"; key: string; event: string; payload: unknown };

export function localTransport(name: string, key: string): Transport {
  let bc: BroadcastChannel | null = null;
  let meta: unknown = null;
  let h: TransportHandlers | null = null;
  const peers = new Map<string, { meta: unknown; seen: number }>();
  const timers: ReturnType<typeof setInterval>[] = [];
  let dead = false;
  const diff = presenceDiff();

  const post = (m: LocalMsg) => {
    try {
      bc?.postMessage(m);
    } catch {
      /* closed */
    }
  };
  const emit = () => {
    if (!h || dead) return;
    const state: Record<string, unknown> = {};
    for (const [k, p] of peers) state[k] = p.meta;
    if (meta != null) state[key] = meta;
    const { joined, left } = diff(state);
    h.presence(state, joined, left);
  };
  const announce = () => meta != null && post({ t: "p", key, meta });
  const bye = () => post({ t: "bye", key });

  return {
    connect(handlers) {
      h = handlers;
      if (typeof BroadcastChannel === "undefined") {
        handlers.status("error", "This browser can't run local rooms.");
        return;
      }
      bc = new BroadcastChannel(name);
      bc.onmessage = (e: MessageEvent<LocalMsg>) => {
        const m = e.data;
        if (dead || !m || typeof m !== "object" || typeof m.key !== "string" || m.key === key) return;
        if (m.t === "p") {
          peers.set(m.key, { meta: m.meta, seen: Date.now() });
          emit();
        } else if (m.t === "bye") {
          if (peers.delete(m.key)) emit();
        } else if (m.t === "hi") announce();
        else if (m.t === "b" && typeof m.event === "string") h?.broadcast(m.event, m.payload);
      };
      timers.push(setInterval(announce, LOCAL_BEAT_MS));
      timers.push(
        setInterval(() => {
          const old = Date.now() - LOCAL_GONE_MS;
          let changed = false;
          for (const [k, p] of peers) if (p.seen < old) changed = peers.delete(k) || changed;
          if (changed) emit();
        }, 1_000),
      );
      if (typeof window !== "undefined") window.addEventListener("pagehide", bye);
      post({ t: "hi", key });
      // Open on the next tick, like a network join would be.
      setTimeout(() => {
        if (dead) return;
        handlers.status("open");
        announce();
        emit();
      }, 0);
    },
    track(m) {
      meta = m;
      if (meta == null) bye();
      else announce();
      emit();
    },
    send(event, payload) {
      if (!dead) post({ t: "b", key, event, payload });
    },
    close() {
      if (dead) return Promise.resolve();
      if (meta != null) bye();
      dead = true;
      timers.forEach(clearInterval);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", bye);
      bc?.close();
      bc = null;
      h = null;
      return Promise.resolve();
    },
  };
}
