import type { LiveGame, Match, Side, TeamSize, TeamStyle } from "./types";
import { combos, plural, rndInt, shuffle, uid, type Rng } from "./util";

export const teamKey = (a: string[], b: string[]) =>
  [a.slice().sort().join(","), b.slice().sort().join(",")].sort().join("|");

export const TEAM_SIZES: TeamSize[] = [1, 2, 3, 4, 5];
export const MAX_SIZE = 5;

/** Largest team size the selection allows (1–5). */
export const maxSize = (n: number): TeamSize => Math.max(1, Math.min(MAX_SIZE, Math.floor(n / 2))) as TeamSize;
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

export type Sizes = [number, number];

/** What happens when `n` players are picked for a `size` v `size` game. */
export type TeamPlan =
  | { kind: "none" }
  /** Enough players for the mode. `out` of them sit out. */
  | { kind: "full"; sizes: Sizes; out: number }
  /** Too few for the mode, but an even number: a smaller game. */
  | { kind: "short"; sizes: Sizes }
  /** Odd number: teams would not be equal, so someone has to choose. */
  | { kind: "odd"; uneven: { sizes: Sizes; out: number } | null; sit: { sizes: Sizes; out: number } };

export function teamPlan(n: number, size: TeamSize): TeamPlan {
  if (n < 2) return { kind: "none" };
  const half = Math.floor(n / 2);
  if (n % 2 === 0) {
    if (n < 2 * size) return { kind: "short", sizes: [half, half] };
    return { kind: "full", sizes: [size, size], out: n - 2 * size };
  }
  const small = Math.min(half, size);
  return {
    kind: "odd",
    uneven: small + 1 <= MAX_SIZE ? { sizes: [small + 1, small], out: n - 2 * small - 1 } : null,
    sit: { sizes: [small, small], out: n - 2 * small },
  };
}

/* ---------- who sits out ---------- */

/** "fair": whoever sat out most recently plays first (rotation). "random": anyone. "pick": tapped by hand. */
export type SitMode = "fair" | "random" | "pick";

/** How many players sit out with this many selected. */
export const extraPlayers = (n: number, size: number) => Math.max(0, n - 2 * size);

/** A stable seed from a string, so the same selection shows the same sit-out on every device. */
export function strSeed(s: string) {
  let h = 2166136261; // FNV-1a: spreads short, similar strings over the whole range
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 2147483646) + 1;
}

/** Picks that are still in tonight's selection, without duplicates. */
export const validPicks = (picked: string[], selected: string[]) =>
  picked.filter((id, i) => selected.includes(id) && picked.indexOf(id) === i);

/** Players who sit out this game (empty when nobody has to). Throws in "pick" mode until exactly the right number is picked. */
export function planSitOut(o: {
  selected: string[];
  size: TeamSize;
  /** Players per team, when the teams are not `size` v `size`. */
  sizes?: Sizes;
  mode: SitMode;
  sitPriority: Record<string, number>;
  picked?: string[];
  rng?: Rng;
}): string[] {
  const need = o.sizes ? o.sizes[0] + o.sizes[1] : 2 * o.size;
  const extra = Math.max(0, o.selected.length - need);
  if (!extra) return [];
  if (o.mode === "pick") {
    const p = validPicks(o.picked ?? [], o.selected);
    if (p.length !== extra) throw new Error(`Pick ${plural(extra, "player")} to sit out`);
    return p;
  }
  let order = shuffle(o.selected, o.rng ?? Math.random);
  if (o.mode === "fair") order = order.sort((a, b) => (o.sitPriority[b] || 0) - (o.sitPriority[a] || 0));
  return order.slice(need);
}

/** Tap a player in "pick" mode: on/off; when already full, the oldest pick makes room. */
export function toggleSitPick(picked: string[], id: string, extra: number): string[] {
  if (picked.includes(id)) return picked.filter((x) => x !== id);
  return [...picked, id].slice(-Math.max(1, extra));
}

/** Snake order A-B-B-A-A-B… for `n` picks, `first` side picks first. */
export function snakeOrder(n: number, first: Side): Side[] {
  const second: Side = first === "blue" ? "red" : "blue";
  return Array.from({ length: n }, (_, i) => (((i + 1) >> 1) & 1 ? second : first));
}

export interface MakeTeamsInput {
  selected: string[];
  size: TeamSize;
  /** Players per team, when the teams are not `size` v `size`. Which side gets more players is random. */
  sizes?: Sizes;
  style: TeamStyle;
  ratingOf: (id: string) => number;
  sitPriority: Record<string, number>;
  /** Who sits out, chosen beforehand with planSitOut. Default: fair rotation. */
  sitOut?: string[];
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
  const [big, small] = inp.sizes ? [Math.max(...inp.sizes), Math.min(...inp.sizes)] : [inp.size, inp.size];
  const size = big as TeamSize;
  const need = big + small;
  const sitOut = inp.sitOut ?? planSitOut({ selected: inp.selected, size, sizes: inp.sizes, mode: "fair", sitPriority: inp.sitPriority, rng });
  const pool = shuffle(
    inp.selected.filter((id) => !sitOut.includes(id)),
    rng,
  );
  if (small < 1 || pool.length < need) throw new Error("Not enough players for this size");
  if (pool.length > need) throw new Error("Too many players for this size");

  const [a1, a2] = inp.apart ?? [];
  const apart = a1 && a2 && a1 !== a2 && pool.includes(a1) && pool.includes(a2) ? [a1, a2] : null;
  const base: LiveGame = {
    id: uid(),
    phase: "draft",
    size,
    blue: [],
    red: [],
    sitOut,
    style: inp.style,
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
  // Equal teams: the first player is always in A, so mirrored splits aren't counted twice.
  let parts = (big === small ? combos(rest, big - 1).map((c) => [first, ...c]) : combos(pool, big)).map(
    (A) => [A, pool.filter((x) => !A.includes(x))] as [string[], string[]],
  );
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
