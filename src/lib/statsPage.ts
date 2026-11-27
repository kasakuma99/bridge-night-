import { FEATURES, PAPI_POINTS, byWins } from "./features";
import { compute, playerSummary, type Computed, type Group, type HeadToHead, type Versus } from "./stats";
import type { Match, Player, RerollEntry, Side } from "./types";
import { DAY, HOUR, TZ } from "./util";

/* What the Stats page shows, for one mode and one period. Everything is calculated from the games. */

/** 0 = every team size. */
export type ModeFilter = 0 | 2 | 3 | 4 | 5;
/** Days back. 1 = today (from 06:00, so a night past midnight is one day). 0 = all time. */
export type PeriodFilter = 0 | 1 | 7 | 30;

export const MODES: ModeFilter[] = [0, 2, 3, 4, 5];
export const PERIODS: PeriodFilter[] = [1, 7, 30, 0];
export const modeLabel = (m: ModeFilter) => (m ? `${m}v${m}` : "Overall");
export const periodLabel = (p: PeriodFilter) => (p === 1 ? "Today" : p ? `${p} days` : "All time");

export const asMode = (v: unknown): ModeFilter => (MODES.includes(Number(v) as ModeFilter) ? (Number(v) as ModeFilter) : 0);
export const asPeriod = (v: unknown, fallback: PeriodFilter = 0): PeriodFilter =>
  v != null && v !== "" && PERIODS.includes(Number(v) as PeriodFilter) ? (Number(v) as PeriodFilter) : fallback;

/** A new day starts at 06:00 in Berlin. */
export const DAY_STARTS = 6;

const hms = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** When the period starts (ms). 0 = all time. */
export function periodStart(p: PeriodFilter, now: number): number {
  if (!p) return 0;
  if (p !== 1) return now - p * DAY;
  const [h, m, s] = hms.format(new Date(now)).split(":").map(Number);
  const start = now - ((h * 60 + m) * 60 + s) * 1000 - (now % 1000) + DAY_STARTS * HOUR;
  return start > now ? start - DAY : start;
}

export interface Filter {
  mode: ModeFilter;
  period: PeriodFilter;
}

export const inFilter = (f: Filter, now: number) => {
  const since = periodStart(f.period, now);
  return (t: number, size?: number) => t >= since && (!f.mode || size === f.mode);
};

export const filterMatches = (matches: Match[], f: Filter, now: number) => {
  const ok = inFilter(f, now);
  return matches.filter((m) => ok(m.playedAt, m.mode));
};

const sideOf = (m: Match, id: string): Side | null => (m.blue.includes(id) ? "blue" : m.red.includes(id) ? "red" : null);
const lengthSec = (m: Match) => m.durationSec ?? (m.durationMin ? m.durationMin * 60 : undefined);

/* ---------- synergy ---------- */

/** Games a group needs together before it counts. */
export const MIN_SYNERGY_GAMES = 3;

export interface Synergy extends Group {
  /** The group's win rate together, smoothed so a few games don't decide it. */
  rate: number;
  /** What its players' own win rates predict. */
  expected: number;
  /** rate - expected: above 0 they win more together than on their own. */
  score: number;
}

/**
 * Synergy: how much more (or less) a group wins together than its players do on their own.
 * The win rate together is smoothed ((w + 1) / (g + 2)), and the prediction is the average win rate of its players.
 */
export function synergies(c: Computed, sizes: number[], isActive: (id: string) => boolean, min = MIN_SYNERGY_GAMES): Synergy[] {
  return c.groups
    .filter((g) => sizes.includes(g.ids.length) && g.g >= min && g.ids.every(isActive))
    .map((g) => {
      const own = g.ids.map((id) => {
        const x = c.st[id];
        return x?.g ? x.w / x.g : 0.5;
      });
      const expected = own.reduce((a, b) => a + b, 0) / own.length;
      const rate = (g.w + 1) / (g.g + 2);
      return { ...g, rate, expected, score: rate - expected };
    });
}

/** Group sizes that belong to a mode. Overall: all of them. */
export const groupSizes = (mode: ModeFilter) => (mode ? [mode] : [2, 3, 4, 5]);
export const groupName = (n: number) => (n === 2 ? "duo" : n === 3 ? "trio" : n === 4 ? "team of 4" : "team of 5");

const bySynergy = (a: Synergy, b: Synergy) => b.score - a.score || b.g - a.g || a.ids.join().localeCompare(b.ids.join());

/** Best and worst groups, n each. A group is never on both lists. */
export function synergyTop(list: Synergy[], n: number) {
  const best = list.filter((s) => s.score > 0).sort(bySynergy).slice(0, n);
  const worst = list
    .filter((s) => s.score < 0)
    .sort((a, b) => bySynergy(b, a))
    .slice(0, n);
  return { best, worst };
}

/* ---------- leaderboard ---------- */

export type SortKey = "points" | "g" | "w" | "l" | "wr";

export interface BoardRow {
  id: string;
  points: number;
  g: number;
  w: number;
  l: number;
  wr: number;
}

/** Points shown for a player: their rating when ratings are on, else the fixed Papi Points. */
export const pointsFor = (full: Computed, id: string) => (FEATURES.ratings ? Math.round(full.st[id]?.rating ?? PAPI_POINTS) : PAPI_POINTS);

export function board(c: Computed, full: Computed, isActive: (id: string) => boolean): BoardRow[] {
  return Object.values(c.st)
    .filter((x) => x.g && isActive(x.id))
    .map((x) => ({ id: x.id, points: pointsFor(full, x.id), g: x.g, w: x.w, l: x.l, wr: x.w / x.g }));
}

/** Highest first (desc), or lowest first. Ties: the usual order (wins, win rate, games, name). */
export function sortBoard(rows: BoardRow[], key: SortKey, desc: boolean, name: (id: string) => string) {
  const tie = byWins(name);
  return rows.slice().sort((a, b) => {
    const d = (b[key] - a[key]) * (desc ? 1 : -1);
    return d || tie(a, b);
  });
}

/* ---------- head to head ---------- */

export interface Pairing {
  a: string;
  b: string;
  wa: number;
  wb: number;
  g: number;
}

const pairing = (h: HeadToHead): Pairing => (h.wa >= h.wb ? { a: h.a, b: h.b, wa: h.wa, wb: h.wb, g: h.g } : { a: h.b, b: h.a, wa: h.wb, wb: h.wa, g: h.g });

/** The biggest gap in wins between two players. `a` is the one who won more. */
export function stomps(c: Computed, isActive: (id: string) => boolean, n = 3): Pairing[] {
  return c.h2h
    .filter((h) => h.wa !== h.wb && isActive(h.a) && isActive(h.b))
    .map(pairing)
    .sort((x, y) => y.wa - y.wb - (x.wa - x.wb) || x.wb - y.wb || x.a.localeCompare(y.a))
    .slice(0, n);
}

/** Games against each other before two players are a rivalry. */
export const MIN_RIVALRY_GAMES = 4;

/** Closest to even against each other, then the most games. */
export function rivalryTop(c: Computed, isActive: (id: string) => boolean, n = 3): Pairing[] {
  return c.h2h
    .filter((h) => h.g >= MIN_RIVALRY_GAMES && isActive(h.a) && isActive(h.b))
    .map(pairing)
    .sort((x, y) => (x.wa - x.wb) / x.g - (y.wa - y.wb) / y.g || y.g - x.g || x.a.localeCompare(y.a))
    .slice(0, n);
}

/* ---------- the group ---------- */

export interface PickStat {
  key: string;
  picks: number;
  wins: number;
}

/** At least this many picks for an augment's win rate to count. */
export const MIN_AUGMENT_PICKS = 3;

const tally = (rec: Record<string, PickStat>, key: string, won: boolean) => {
  const x = (rec[key] ??= { key, picks: 0, wins: 0 });
  x.picks++;
  if (won) x.wins++;
};
const mostPicked = (rec: Record<string, PickStat>) => Object.values(rec).sort((a, b) => b.picks - a.picks || b.wins - a.wins || a.key.localeCompare(b.key));
const bestRate = (rec: Record<string, PickStat>, min: number) =>
  Object.values(rec)
    .filter((x) => x.picks >= min)
    .sort((a, b) => b.wins / b.picks - a.wins / a.picks || b.picks - a.picks || a.key.localeCompare(b.key));

export function overview(ms: Match[], rerolls: RerollEntry[], f: Filter, now: number) {
  const augs: Record<string, PickStat> = {};
  const champs: Record<string, PickStat> = {};
  let timed = 0;
  let totalSec = 0;
  for (const m of ms) {
    const sec = lengthSec(m);
    if (sec) {
      timed++;
      totalSec += sec;
    }
    for (const side of ["blue", "red"] as Side[])
      for (const id of m[side]) {
        const s = m.stats[id];
        const won = m.winner === side;
        if (s?.champion) tally(champs, s.champion, won);
        for (const a of new Set(s?.augments ?? [])) tally(augs, String(a), won);
      }
  }
  const ok = inFilter(f, now);
  return {
    games: ms.length,
    /** Average length of the games that have one (seconds). */
    avgSec: timed ? totalSec / timed : 0,
    /** All games, counting the ones without a length as average. */
    totalSec: timed ? (totalSec / timed) * ms.length : 0,
    ffWins: ms.filter((m) => m.surrender).length,
    rerolls: rerolls.filter((r) => ok(r.at, r.size)).length,
    augments: mostPicked(augs).slice(0, 5),
    bestAugments: bestRate(augs, MIN_AUGMENT_PICKS).slice(0, 5),
    champions: mostPicked(champs).slice(0, 5),
  };
}

/* ---------- one player ---------- */

export function playerView(o: {
  id: string;
  ms: Match[];
  c: Computed;
  full: Computed;
  f: Filter;
  isActive: (id: string) => boolean;
  name: (id: string) => string;
}) {
  const { id, ms, c, full, f, isActive, name } = o;
  const x = c.st[id];
  const sum = playerSummary(c, id, isActive, name);
  const augs: Record<string, PickStat> = {};
  let ff = 0;
  let dmg = 0;
  let dmgGames = 0;
  let losing = 0;
  let worstRun = 0;
  const form: boolean[] = [];
  for (const m of c.sorted) {
    const side = sideOf(m, id);
    if (!side) continue;
    const won = m.winner === side;
    form.push(won);
    if (!won && m.surrender) ff++;
    losing = won ? 0 : losing + 1;
    worstRun = Math.max(worstRun, losing);
    const s = m.stats[id];
    if (s?.damage != null) {
      dmg += s.damage;
      dmgGames++;
    }
    for (const a of new Set(s?.augments ?? [])) tally(augs, String(a), won);
  }

  // Partners: the groups this player was in, by synergy.
  const partners = groupSizes(f.mode).map((size) => {
    const mine = synergies(c, [size], isActive).filter((s) => s.ids.includes(id));
    const sorted = mine.slice().sort(bySynergy);
    const best = sorted.find((s) => s.score > 0) ?? null;
    const worst = sorted.reverse().find((s) => s.score < 0) ?? null;
    return { size, best, worst };
  });

  // Points won or lost in the period. Always 0 with fixed Papi Points.
  const inPeriod = new Set(ms.map((m) => m.id));
  const change = FEATURES.ratings
    ? Object.entries(full.changes).reduce((a, [mid, ch]) => a + (inPeriod.has(mid) ? (ch[id]?.delta ?? 0) : 0), 0)
    : 0;

  return {
    g: x?.g ?? 0,
    w: x?.w ?? 0,
    l: x?.l ?? 0,
    points: pointsFor(full, id),
    change,
    kdaGames: x?.kdaGames ?? 0,
    k: x?.k ?? 0,
    d: x?.d ?? 0,
    a: x?.a ?? 0,
    /** How often their team surrendered. */
    ffRate: x?.g ? ff / x.g : 0,
    ff,
    augments: mostPicked(augs).slice(0, 6),
    partners: partners.filter((p) => p.best || p.worst || f.mode),
    victim: sum.victim as Versus | null,
    toughest: sum.toughest as Versus | null,
    bestStreak: x?.bestStreak ?? 0,
    worstRun,
    form: form.slice(-10),
    avgDamage: dmgGames ? dmg / dmgGames : 0,
    champs: sum.champs.slice(0, 5),
  };
}

/** Everything the Stats page needs for one filter. */
export function statsFor(matches: Match[], players: Player[], f: Filter, now: number) {
  const ms = filterMatches(matches, f, now);
  return { ms, c: compute(ms, players, now) };
}

/* ---------- formats ---------- */

export const pct = (w: number, g: number) => (g ? `${Math.round((w / g) * 100)}%` : "–");
/** A synergy score in points of win rate: "+12", "−5". */
export const signed = (v: number) => {
  const n = Math.round(v * 100);
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
};
/** "18:05" */
export const clock = (sec: number) => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** "12h 40m" */
export const hours = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
