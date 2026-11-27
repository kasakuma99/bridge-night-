import {
  acceptAction,
  acceptState,
  cleanPresence,
  CLOSE_GRACE_MS,
  HOST_GRACE_MS,
  MAX_PAYLOAD_BYTES,
  NO_HOST_MS,
  payloadBytes,
  pickHost,
  readEnvelope,
  roomPlayers,
  STATE_MIN_GAP_MS,
  type RoomMeta,
} from "./logic";
import type { Transport, TransportStatus } from "./transport";
import type { RoomInfo, RoomPlayer, RoomStatus } from "./types";

/**
 * One side of a room (host or player) on top of a Transport. No React: ./index.ts wraps it in hooks, and
 * tests/rooms.test.ts runs a host and players against an in-memory transport.
 */

export const ROOM_EVENTS = ["state", "action", "hello", "close"] as const;

export interface RoomSnapshot<S> {
  code: string;
  role: "host" | "player";
  me: RoomPlayer;
  players: RoomPlayer[];
  host: RoomPlayer | null;
  state: S | null;
  status: RoomStatus;
  error?: string;
}

export interface EngineOptions {
  role: "host" | "player";
  code: string;
  /** This tab's presence key. */
  key: string;
  me: RoomPlayer;
  transport: Transport;
  /** Host: what "Open rooms" shows. */
  gameId?: string;
  title?: string;
  /** Host: when this tab first opened the room (kept across a refresh, so players keep seeing the same host). */
  since?: number;
  /** Host: the code is already used by another host; pick a new one. */
  onConflict?: () => void;
  /** Host: the room as "Open rooms" should show it (null = not listed). */
  onInfo?: (info: RoomInfo | null) => void;
}

export class RoomEngine<S, A> {
  private o: EngineOptions;
  private snap: RoomSnapshot<S>;
  private subs = new Set<() => void>();
  private actionSubs = new Set<(from: RoomPlayer, a: A) => void>();
  private presence = new Map<string, RoomMeta>();
  private hostKey: string | null = null;
  private pinned: string | null = null;
  private net: TransportStatus = "connecting";
  private stopped = false;
  private ended = false;
  private hostSeen = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private noHostTimer: ReturnType<typeof setTimeout> | null = null;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSend = 0;
  private dirty = false;
  private phase: RoomInfo["phase"] = "lobby";
  private title: string;
  private since: number;
  private checkedConflict = false;

  constructor(o: EngineOptions) {
    this.o = o;
    this.title = o.title ?? "";
    this.since = o.since ?? Date.now();
    this.snap = { code: o.code, role: o.role, me: o.me, players: [], host: null, state: null, status: "connecting" };
  }

  /* ---------- React side ---------- */

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<RoomSnapshot<S>>) {
    this.snap = { ...this.snap, ...patch };
    if (!("error" in patch) && patch.status && patch.status !== "closed" && patch.status !== "error") delete this.snap.error;
    this.subs.forEach((f) => f());
  }

  /* ---------- lifecycle ---------- */

  start() {
    this.o.transport.connect({
      status: (s, err) => this.onNet(s, err),
      presence: (state, joined, left) => this.onPresence(state, joined, left),
      broadcast: (ev, p) => this.onBroadcast(ev, p),
    });
    this.o.transport.track(this.meta());
    if (this.o.role === "player") this.noHostTimer = setTimeout(() => this.noHost(), NO_HOST_MS);
  }

  /** Leave. `end` = the host ends the room for everyone (unmount, leave()); a refresh never gets here. */
  stop(end: boolean) {
    if (this.stopped) return Promise.resolve();
    if (end && this.o.role === "host") this.o.transport.send("close", { from: this.o.key });
    this.stopped = true;
    this.clearTimers();
    this.o.onInfo?.(null);
    this.subs.clear();
    this.actionSubs.clear();
    return this.o.transport.close();
  }

  private clearTimers() {
    for (const t of [this.graceTimer, this.noHostTimer, this.sendTimer]) if (t) clearTimeout(t);
    this.graceTimer = this.noHostTimer = this.sendTimer = null;
  }

  setMe(me: RoomPlayer) {
    if (this.stopped || JSON.stringify(me) === JSON.stringify(this.snap.me)) return;
    this.o.me = me;
    this.set({ me });
    this.o.transport.track(this.meta());
    this.publishInfo();
  }

  private meta(): RoomMeta {
    return { role: this.o.role, player: this.o.me, since: this.since };
  }

  /* ---------- host ---------- */

  setState(s: S) {
    if (this.o.role !== "host" || this.stopped) return;
    if (payloadBytes({ from: this.o.key, s }) > MAX_PAYLOAD_BYTES) {
      console.warn(`[bridge-night] room state is over ${MAX_PAYLOAD_BYTES / 1024} KB and was not sent. Make pictures smaller.`);
      return;
    }
    this.set({ state: s });
    this.queueState();
  }

  setPhase(phase: RoomInfo["phase"], title?: string) {
    if (this.o.role !== "host" || this.stopped) return;
    this.phase = phase;
    if (title !== undefined) this.title = title;
    this.publishInfo();
  }

  setTitle(title: string) {
    if (this.o.role !== "host" || this.stopped || title === this.title) return;
    this.title = title;
    this.publishInfo();
  }

  onAction(fn: (from: RoomPlayer, a: A) => void) {
    if (this.o.role !== "host") return () => {};
    this.actionSubs.add(fn);
    return () => void this.actionSubs.delete(fn);
  }

  /** Newest state to everyone, at most every STATE_MIN_GAP_MS. */
  private queueState() {
    if (this.snap.state == null) return;
    this.dirty = true;
    if (this.sendTimer) return;
    const wait = Math.max(0, this.lastSend + STATE_MIN_GAP_MS - Date.now());
    if (wait === 0) this.flushState();
    else this.sendTimer = setTimeout(() => this.flushState(), wait);
  }

  private flushState() {
    this.sendTimer = null;
    if (!this.dirty || this.stopped || this.snap.state == null) return;
    if (this.net !== "open") return; // sent again once connected (onNet)
    this.dirty = false;
    this.lastSend = Date.now();
    this.o.transport.send("state", { from: this.o.key, s: this.snap.state });
  }

  private publishInfo() {
    if (this.o.role !== "host" || this.stopped || !this.o.gameId) return;
    this.o.onInfo?.({
      code: this.o.code,
      gameId: this.o.gameId,
      title: this.title,
      host: this.o.me,
      players: Math.max(1, this.snap.players.length),
      phase: this.phase,
    });
  }

  /* ---------- player ---------- */

  /** false = not sent: no host right now (connecting, reconnecting, closed), not connected, or too big. */
  send(a: A): boolean {
    if (this.o.role !== "player" || this.stopped || this.ended) return false;
    if (!this.hostKey || this.graceTimer || this.net !== "open") return false; // nobody to send it to; the game shows the status
    const env = { from: this.o.key, to: this.hostKey, a };
    if (payloadBytes(env) > MAX_PAYLOAD_BYTES) {
      console.warn("[bridge-night] room action too big, not sent");
      return false;
    }
    this.o.transport.send("action", env);
    return true;
  }

  private hello() {
    if (this.o.role === "player" && this.net === "open") this.o.transport.send("hello", { from: this.o.key });
  }

  private noHost() {
    this.noHostTimer = null;
    if (!this.hostSeen && !this.stopped) this.close("No room with this code is open right now.");
  }

  /**
   * Closed for good (the host closed the room, the host stayed away past the grace time, no host, connection gone):
   * leave the channel and stop every timer now, not only when the page unmounts. The snapshot stays readable.
   */
  private close(error: string) {
    if (this.ended) return;
    this.ended = true;
    this.clearTimers();
    this.set({ status: "closed", error, host: null });
    void this.o.transport.close();
  }

  /* ---------- transport events ---------- */

  private onNet(s: TransportStatus, err?: string) {
    if (this.stopped || this.ended) return;
    this.net = s;
    if (s === "open") {
      if (this.o.role === "host") {
        this.set({ status: "open" });
        this.publishInfo();
        this.dirty = true;
        this.queueState();
      } else {
        this.hello();
        if (this.hostKey && !this.graceTimer) this.set({ status: "open" });
      }
    } else if (s === "error") this.set({ status: "error", error: err });
    else if (s === "closed") {
      if (this.o.role === "player") this.close(err ?? "The connection closed.");
      else if (this.o.role === "host") this.set({ status: "closed", error: err ?? "The connection closed." });
    } else if (!this.graceTimer) this.set({ status: "connecting" });
  }

  private onPresence(raw: Record<string, unknown>, joined: string[], left: string[]) {
    if (this.stopped || this.ended) return;
    this.presence = cleanPresence(raw);
    const me = this.o.key;

    if (this.o.role === "host") {
      // Someone else already hosts this code (two people picked the same one): take another.
      if (!this.checkedConflict && this.presence.has(me)) {
        this.checkedConflict = true;
        const other = [...this.presence].some(([k, m]) => k !== me && m.role === "host");
        if (other) {
          this.o.onConflict?.();
          return;
        }
      }
      this.hostKey = me;
      this.set({ players: roomPlayers(this.presence, me), host: this.o.me });
      this.publishInfo();
      // Late joiners catch up: the latest state again whenever someone new arrives.
      if (joined.some((k) => k !== me)) {
        this.dirty = true;
        this.queueState();
      }
      return;
    }

    // Player
    const host = pickHost(this.presence, this.pinned);
    if (host && !this.pinned) this.pinned = host;
    const wasHost = this.hostKey;
    this.hostKey = host;
    if (host) {
      this.hostSeen = true;
      if (this.noHostTimer) clearTimeout(this.noHostTimer);
      this.noHostTimer = null;
      if (this.graceTimer) {
        // The host is back (a refresh): carry on.
        clearTimeout(this.graceTimer);
        this.graceTimer = null;
      }
      if (!wasHost) this.hello();
    } else if (wasHost && this.pinned && left.includes(this.pinned) && !this.graceTimer) {
      // The host dropped out (a refresh, a network gap): "reconnecting" for a few seconds, then closed for good.
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (!this.hostKey && !this.stopped) this.close("The host left.");
      }, HOST_GRACE_MS);
    }
    const hostMeta = host ? this.presence.get(host)!.player : null;
    const patch: Partial<RoomSnapshot<S>> = { players: roomPlayers(this.presence, host), host: hostMeta ?? (this.graceTimer ? this.snap.host : null) };
    if (this.graceTimer) patch.status = "reconnecting";
    else if (host && this.net === "open") patch.status = "open";
    this.set(patch);
  }

  private onBroadcast(event: string, payload: unknown) {
    if (this.stopped || this.ended) return;
    const env = readEnvelope(payload);
    if (!env) {
      if (payload && payloadBytes(payload) > MAX_PAYLOAD_BYTES) console.warn("[bridge-night] dropped a room message over the size limit");
      return;
    }
    if (this.o.role === "host") {
      if (event === "hello") {
        // Anyone in the channel may ask: the state is public to the room anyway.
        this.dirty = true;
        this.queueState();
      } else if (event === "action") {
        const from = acceptAction(env, this.o.key, this.presence);
        if (from) this.actionSubs.forEach((f) => f(from, env.a as A));
      }
      return;
    }
    // Player
    if (event === "state" && acceptState(env, this.hostKey)) {
      const patch: Partial<RoomSnapshot<S>> = { state: env.s as S };
      if (this.net === "open" && !this.graceTimer) patch.status = "open";
      this.set(patch);
    } else if (event === "close" && env.from === this.hostKey) {
      // The host's page unmounted the room. That also happens right before the same host mounts it again
      // (React StrictMode, a game switching from setup to the host view after a refresh), so wait a moment:
      // if the host is back by then, carry on; otherwise the room is closed for good.
      if (this.graceTimer) clearTimeout(this.graceTimer);
      this.hostKey = null;
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (!this.hostKey && !this.stopped) this.close("The host closed the room.");
      }, CLOSE_GRACE_MS);
      this.set({ status: "reconnecting" });
    }
  }
}
