import type { LiveGame, Match, Side, TeamSize, TeamStyle } from "./types";
import { combos, rndInt, shuffle, uid, type Rng } from "./util";

export const teamKey = (a: string[], b: string[]) =>
  [a.slice().sort().join(","), b.slice().sort().join(",")].sort().join("|");

/** Largest team size the selection allows (1–4). */
export const maxSize = (n: number): TeamSize => Math.max(1, Math.min(4, Math.floor(n / 2))) as TeamSize;
/** Default: the biggest size up to 3v3. */
export const defaultSize = (n: number): TeamSize => Math.min(3, maxSize(n)) as TeamSize;

/**
 * Sit-out priority: how many games in a row (most recent first) each player sat out
 * since they last played. Higher number = plays first next time.
 */
export function sitPriority(matches: Match[], ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const sorted = matches.slice().sort((a, b) => b.playedAt - a.playedAt);
  for (const id of ids) {
    let n = 0;
    for (const m of sorted) {
      if (m.blue.includes(id) || m.red.includes(id)) break;
      if (m.sitOut?.includes(id)) n++;
    }
    out[id] = n;
  }
  return out;
}

/** Snake order A-B-B-A-A-B… for `n` picks, `first` side picks first. */
export function snakeOrder(n: number, first: Side): Side[] {
  const second: Side = first === "blue" ? "red" : "blue";
  return Array.from({ length: n }, (_, i) => (((i + 1) >> 1) & 1 ? second : first));
}

export interface MakeTeamsInput {
  selected: string[];
  size: TeamSize;
  style: TeamStyle;
  ratingOf: (id: string) => number;
  sitPriority: Record<string, number>;
  apart?: [string, string] | null;
  /** Teams of the last played game (when "Avoid the teams from the last game" is on). */
  avoid?: { blue: string[]; red: string[] } | null;
  /** The current draft, so a reroll never repeats it. */
  current?: { blue: string[]; red: string[] } | null;
  rng?: Rng;
  now?: number;
}

export function makeTeams(inp: MakeTeamsInput): LiveGame {
  const rng = inp.rng ?? Math.random;
  const { size } = inp;
  let pool = inp.selected.slice();
  let sitOut: string[] = [];
  if (pool.length > 2 * size) {
    pool = shuffle(pool, rng).sort((a, b) => (inp.sitPriority[b] || 0) - (inp.sitPriority[a] || 0));
    sitOut = pool.slice(2 * size);
    pool = pool.slice(0, 2 * size);
  }
  if (pool.length < 2 * size) throw new Error("Not enough players for this size");

  const [a1, a2] = inp.apart ?? [];
  const apart = a1 && a2 && a1 !== a2 && pool.includes(a1) && pool.includes(a2) ? [a1, a2] : null;
  const base: LiveGame = {
    id: uid(),
    phase: "draft",
    size,
    blue: [],
    red: [],
    sitOut,
    stats: {},
    dodgeLog: [],
    createdAt: inp.now ?? Date.now(),
  };

  if (inp.style === "captains" && size > 1) {
    const caps = apart ? apart.slice() : shuffle(pool, rng).slice(0, 2);
    if (rng() < 0.5) caps.reverse();
    const rest = shuffle(pool.filter((x) => !caps.includes(x)), rng);
    const first: Side = inp.ratingOf(caps[0]) <= inp.ratingOf(caps[1]) ? "blue" : "red";
    return {
      ...base,
      blue: [caps[0]],
      red: [caps[1]],
      captains: { pool: rest, order: snakeOrder(rest.length, first), i: 0, log: [] },
    };
  }

  const [first, ...rest] = pool;
  let parts = combos(rest, size - 1).map((c) => {
    const A = [first, ...c];
    return [A, pool.filter((x) => !A.includes(x))] as [string[], string[]];
  });
  const keep = (f: (p: [string[], string[]]) => boolean) => {
    const x = parts.filter(f);
    if (x.length) parts = x;
  };
  if (apart) keep(([A]) => A.includes(apart[0]) !== A.includes(apart[1]));
  if (inp.avoid) {
    const k = teamKey(inp.avoid.blue, inp.avoid.red);
    keep((p) => teamKey(...p) !== k);
  }
  if (inp.current && inp.current.blue.length) {
    const k = teamKey(inp.current.blue, inp.current.red);
    keep((p) => teamKey(...p) !== k);
  }

  let pick: [string[], string[]];
  if (inp.style === "balanced") {
    const avgR = (t: string[]) => t.reduce((s, p) => s + inp.ratingOf(p), 0) / t.length;
    const diff = (p: [string[], string[]]) => Math.abs(avgR(p[0]) - avgR(p[1]));
    const best = Math.min(...parts.map(diff));
    const near = parts.filter((p) => diff(p) <= best + 12);
    pick = near[rndInt(near.length, rng)];
  } else pick = parts[rndInt(parts.length, rng)];
  if (rng() < 0.5) pick = [pick[1], pick[0]];
  return { ...base, blue: shuffle(pick[0], rng), red: shuffle(pick[1], rng) };
}

export const draftOpen = (L: LiveGame | null) => !!(L?.captains && L.captains.i < L.captains.order.length);

export function captainPick(L: LiveGame, id: string): LiveGame {
  const cp = L.captains;
  if (!cp || cp.i >= cp.order.length || !cp.pool.includes(id)) return L;
  const side = cp.order[cp.i];
  return {
    ...L,
    [side]: [...L[side], id],
    captains: { ...cp, pool: cp.pool.filter((x) => x !== id), log: [...cp.log, id], i: cp.i + 1 },
  };
}

export function captainUndo(L: LiveGame): LiveGame {
  const cp = L.captains;
  if (!cp || !cp.i) return L;
  const id = cp.log[cp.log.length - 1];
  const side = cp.order[cp.i - 1];
  return {
    ...L,
    [side]: L[side].filter((x) => x !== id),
    captains: { ...cp, pool: [...cp.pool, id], log: cp.log.slice(0, -1), i: cp.i - 1 },
  };
}

/* ---------- reroll limit ---------- */

/** Key for the reroll counter: same players + size = same count, so toggling someone off and on keeps it. */
export const rerollKey = (selected: string[], size: number) => selected.slice().sort().join(",") + "|" + size;

/** How many rerolls are left after `made` drafts for this key. */
export function rerollsLeft(limit: number, made: number) {
  if (limit < 0) return Infinity;
  return made ? limit - (made - 1) : limit;
}
export const canDraft = (limit: number, made: number) => !made || rerollsLeft(limit, made) > 0;
