import { openRoomsFrom } from "./logic";
import type { Transport } from "./transport";
import type { RoomInfo } from "./types";

/**
 * "Open rooms": every host tab tracks { rooms: RoomInfo[] } in one presence channel (topic "bn-arcade-rooms" on
 * Supabase, a BroadcastChannel of the same name locally). Its own topic, so the "bn-arcade" presence of
 * useArcadeOnline (src/minigames/data.ts) stays exactly as it is.
 *
 * One shared channel per tab: the Arcade page (useOpenRooms) and a hosting game (useHostRoom) use it at the same time,
 * and realtime-js allows only one channel per topic. Released a moment after the last user, so a StrictMode
 * unmount + mount (or going from a game back to the list) doesn't leave and re-join.
 */
export class Directory {
  private make: () => Transport;
  private t: Transport | null = null;
  private users = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private mine = new Map<string, RoomInfo>();
  private remote: unknown[] = [];
  private list: RoomInfo[] = [];
  private subs = new Set<() => void>();
  private releaseMs: number;

  constructor(make: () => Transport, releaseMs = 1_000) {
    this.make = make;
    this.releaseMs = releaseMs;
  }

  /** Use the channel; call the returned function when done. */
  acquire(): () => void {
    this.users++;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (!this.t) {
      const t = this.make();
      this.t = t;
      t.connect({
        status: () => {},
        presence: (state) => {
          if (this.t !== t) return;
          this.remote = Object.values(state);
          this.recompute();
        },
        broadcast: () => {},
      });
      this.push();
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.users--;
      if (this.users > 0) return;
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null;
        if (this.users > 0 || !this.t) return;
        const t = this.t;
        this.t = null;
        this.remote = [];
        this.recompute();
        void t.close();
      }, this.releaseMs);
    };
  }

  /** A host lists its room (again, with new numbers) or takes it off (null). */
  publish(code: string, info: RoomInfo | null) {
    if (info) this.mine.set(code, info);
    else if (!this.mine.delete(code)) return;
    this.push();
    this.recompute();
  }

  private push() {
    this.t?.track(this.mine.size ? { rooms: [...this.mine.values()] } : null);
  }

  private recompute() {
    // Your own rooms too: a BroadcastChannel doesn't hear itself, and Supabase presence may lag behind.
    const next = openRoomsFrom([{ rooms: [...this.mine.values()] }, ...this.remote]);
    if (JSON.stringify(next) === JSON.stringify(this.list)) return;
    this.list = next;
    this.subs.forEach((f) => f());
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  getSnapshot = () => this.list;
}
