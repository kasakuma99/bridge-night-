import { FEATURES } from "../lib/features";
import { applyFeed, decideFeed } from "../lib/live";
import type { AppData, LiveFeed, LiveGame, Match, Player, Settings, Side } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { uid } from "../lib/util";
import { emptyData } from "./sample";

export interface StoreState {
  status: "loading" | "ready" | "error";
  error?: string;
  data: AppData;
}

/**
 * Everything the pages may change goes through this interface. Phase 1 keeps it in the browser
 * (LocalStore); Phase 2 swaps in a Supabase implementation with the same methods.
 */
export interface DataStore {
  readonly sample: boolean;
  subscribe(fn: () => void): () => void;
  getState(): StoreState;
  /** Whether this person may see the data. Without it nothing is loaded, and nothing is kept. */
  setAccess?(allowed: boolean): void;
  addPlayer(name: string, riotId?: string): Promise<Player>;
  updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "riotId">>): Promise<void>;
  removePlayer(id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  setLive(live: LiveGame | null): Promise<void>;
  /** The newest look at the game in League. Finished games are saved on their own. */
  setFeed(feed: LiveFeed | null): Promise<void>;
  /** A member says who won a game that League named no winner for, or that it doesn't count. */
  decideFeed(feedId: string, choice: Side | "skip"): Promise<void>;
  /** Saves the live game once. Returns null if it was already saved (double tap, second device). */
  saveResult(liveId: string, winner: Side): Promise<Match | null>;
  flipWinner(matchId: string): Promise<void>;
  deleteMatch(matchId: string): Promise<void>;
  exportBackup(): string;
  restoreBackup(json: string): Promise<void>;
  resetSample(): Promise<void>;
}

export class StoreError extends Error {}

const KEY = "bn-data-v4";
/** Older local data: the players (with their Riot IDs) and the games really played are kept, dummy games are not. */
const OLD_KEYS = ["bn-data-v3", "bn-data-v2"];
const isPlayed = (m: Match) => /^g\d+$/.test(m.id) && !(+m.gameId! >= 7_000_000_000 && +m.gameId! < 7_000_200_000);
const NAME_MAX = 20;

export function validName(name: string, players: Player[], selfId?: string) {
  const n = name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  if (!n) throw new StoreError("Enter a name");
  if (players.some((p) => p.active && p.id !== selfId && p.name.toLowerCase() === n.toLowerCase()))
    throw new StoreError(`${n} is already on the list`);
  return n;
}

function isAppData(x: unknown): x is AppData {
  const d = x as AppData;
  return !!d && Array.isArray(d.players) && Array.isArray(d.matches) && typeof d.settings === "object";
}

export class LocalStore implements DataStore {
  private state: StoreState;
  private subs = new Set<() => void>();
  constructor(readonly sample: boolean) {
    this.state = { status: "ready", data: this.load() };
    if (typeof window !== "undefined")
      window.addEventListener("storage", (e) => {
        // Another tab changed the data: behave like realtime.
        if (e.key === KEY) this.set({ ...this.state, data: this.load() }, false);
      });
  }
  private load(): AppData {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (isAppData(d)) return { ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
      }
    } catch {
      /* fall through */
    }
    const fresh = emptyData();
    try {
      for (const key of OLD_KEYS) {
        const old = JSON.parse(localStorage.getItem(key) || "null");
        if (isAppData(old)) return { ...fresh, players: old.players, matches: old.matches.filter(isPlayed), feed: old.feed ?? null };
      }
    } catch {
      /* nothing to keep */
    }
    return fresh;
  }
  private set(s: StoreState, persist = true) {
    this.state = s;
    if (persist)
      try {
        localStorage.setItem(KEY, JSON.stringify(s.data));
      } catch {
        /* ignore */
      }
    this.subs.forEach((f) => f());
  }
  private update(f: (d: AppData) => AppData) {
    this.set({ ...this.state, data: f(this.state.data) });
  }
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getState = () => this.state;

  async addPlayer(name: string, riotId?: string) {
    const d = this.state.data;
    const n = validName(name, d.players);
    const p: Player = { id: uid(), name: n, riotId: riotId?.trim() || undefined, active: true, createdAt: Date.now() };
    this.update((d) => ({ ...d, players: [...d.players, p] }));
    return p;
  }
  async updatePlayer(id: string, patch: Partial<Pick<Player, "name" | "riotId">>) {
    const d = this.state.data;
    const name = patch.name != null ? validName(patch.name, d.players, id) : undefined;
    this.update((d) => ({
      ...d,
      players: d.players.map((p) =>
        p.id === id
          ? { ...p, ...(name ? { name } : {}), ...(patch.riotId != null ? { riotId: patch.riotId.trim() || undefined } : {}) }
          : p,
      ),
    }));
  }
  async removePlayer(id: string) {
    this.update((d) => ({
      ...d,
      players: d.players.map((p) => (p.id === id ? { ...p, active: false } : p)),
      live: d.live && [...d.live.blue, ...d.live.red, ...(d.live.captains?.pool ?? [])].includes(id) ? null : d.live,
    }));
  }
  async saveSettings(s: Settings) {
    this.update((d) => ({ ...d, settings: s }));
  }
  async setLive(live: LiveGame | null) {
    this.update((d) => ({ ...d, live }));
  }
  async setFeed(feed: LiveFeed | null) {
    const next = applyFeed(this.state.data, feed, FEATURES.soloGames);
    if (next !== this.state.data) this.update(() => next);
  }
  async decideFeed(feedId: string, choice: Side | "skip") {
    const next = decideFeed(this.state.data, feedId, choice, FEATURES.soloGames);
    if (next === this.state.data) throw new StoreError("This game already has a result");
    this.update(() => next);
  }
  async saveResult(liveId: string, winner: Side) {
    const d = this.state.data;
    const L = d.live;
    // Same rule as the database's unique constraint on live_id.
    if (!L || L.id !== liveId || d.matches.some((m) => m.liveId === liveId)) return null;
    const now = Date.now();
    const m: Match = {
      id: uid(),
      liveId,
      playedAt: now,
      mode: L.size,
      blue: L.blue,
      red: L.red,
      winner,
      stats: L.stats,
      dodges: L.dodgeLog,
      sitOut: L.sitOut,
      challenge: L.challenge || undefined,
      surrender: L.surrender,
      durationMin: L.durationMin ?? (L.startedAt ? Math.max(1, Math.round((now - L.startedAt) / 6e4)) : undefined),
    };
    this.update((d) => ({ ...d, matches: [...d.matches, m], live: null }));
    return m;
  }
  async flipWinner(matchId: string) {
    this.update((d) => ({
      ...d,
      matches: d.matches.map((m) => (m.id === matchId ? { ...m, winner: m.winner === "blue" ? "red" : "blue" } : m)),
    }));
  }
  async deleteMatch(matchId: string) {
    this.update((d) => ({ ...d, matches: d.matches.filter((m) => m.id !== matchId) }));
  }
  exportBackup() {
    const { players, matches, settings } = this.state.data;
    return JSON.stringify({ app: "bridge-night", version: 1, exportedAt: new Date().toISOString(), players, matches, settings }, null, 2);
  }
  async restoreBackup(json: string) {
    let d: unknown;
    try {
      d = JSON.parse(json);
    } catch {
      throw new StoreError("That file isn't valid JSON");
    }
    if (!isAppData(d)) throw new StoreError("That file isn't a Bridge Night backup");
    this.update(() => ({
      players: d.players,
      matches: d.matches,
      settings: { ...DEFAULT_SETTINGS, ...d.settings },
      live: null,
    }));
  }
  async resetSample() {
    this.update(() => emptyData());
  }
}
