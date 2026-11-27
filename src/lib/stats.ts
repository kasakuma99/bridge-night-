import type { Match, Player, Side } from "./types";
import { DAY, combos, monthKey } from "./util";

/* ---------- rating (Elo, per player) ----------
 * Everyone starts at 1000. After each game every player gets their own change:
 *  - Each player is compared with every opponent one by one (no team average). Beating stronger players
 *    gives more, beating weaker players gives less; losing to stronger players costs less, to weaker more.
 *  - A 100 point gap means 13 for the favourite and 17 for the underdog (soft scale of 800 instead of chess's 400).
 *  - Placement: the first 10 games move faster (K 40), after that K 30 (an even game is +/-15).
 *  - Surrender (FF): the losing team loses 5 extra.
 *  - Win streak bonus: +1 for the 3rd win in a row, +2 for the 4th, +3 from the 5th on.
 *  - Bounty: ending someone's streak of 3+ wins gives the winners +3.
 *  - Every game counts: at least +3 for a win and at least -3 for a loss.
 * Kills and deaths don't change the rating.
 */
export const START_RATING = 1000;
export const K_FACTOR = 30;
export const K_PLACEMENT = 40;
export const PLACEMENT_GAMES = 10;
export const FF_PENALTY = 5;
export const BOUNTY_BONUS = 3;
export const MIN_CHANGE = 3;

/** Rating points for a 10x difference in odds. 800 keeps changes gentle: a 100 point gap is 13 vs 17. */
export const ELO_SCALE = 800;

export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / ELO_SCALE));
const mean = (xs: number[], fallback: number) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);

/** Chance that a player with this rating beats these opponents: their pairwise chances, averaged. */
export const winChanceVs = (r: number, opponents: number[]) => mean(opponents.map((o) => expected(r, o)), 0.5);

export interface RatingChange {
  delta: number;
  base: number;
  streak: number;
  bounty: number;
  ff: number;
}

/** One player's rating change for one game. */
export function ratingChange(o: {
  rating: number;
  games: number;
  opponents: number[];
  won: boolean;
  /** win streak before this game (>0 = wins in a row) */
  streak: number;
  endedBounty: boolean;
  surrendered: boolean;
}): RatingChange {
  const k = o.games < PLACEMENT_GAMES ? K_PLACEMENT : K_FACTOR;
  let base = Math.round(k * ((o.won ? 1 : 0) - winChanceVs(o.rating, o.opponents)));
  if (o.won) base = Math.max(MIN_CHANGE, base);
  else base = Math.min(-MIN_CHANGE, base);
  const nextStreak = o.won ? (o.streak > 0 ? o.streak + 1 : 1) : 0;
  const streak = o.won && nextStreak >= 3 ? Math.min(3, nextStreak - 2) : 0;
  const bounty = o.won && o.endedBounty ? BOUNTY_BONUS : 0;
  const ff = !o.won && o.surrendered ? -FF_PENALTY : 0;
  return { delta: base + streak + bounty + ff, base, streak, bounty, ff };
}

export interface PlayerStat {
  id: string;
  rating: number;
  hist: number[];
  g: number;
  w: number;
  l: number;
  /** >0 win streak, <0 loss streak */
  streak: number;
  bestStreak: number;
  champs: Record<string, number>;
  winChamps: Set<string>;
  upsets: number;
  bountiesClaimed: number;
  crowns: number;
  k: number;
  d: number;
  a: number;
  kdaGames: number;
  items: Record<number, number>;
}

export interface Group {
  ids: string[];
  g: number;
  w: number;
}

export interface HeadToHead {
  a: string;
  b: string;
  /** winner id per game, chronological */
  res: string[];
  wa: number;
  wb: number;
  g: number;
  leader: string;
  streak: number;
}

export interface ChampStat {
  g: number;
  w: number;
  items: Record<number, number>;
}

export interface MonthChampion {
  month: string;
  id: string;
  w: number;
  g: number;
  current: boolean;
}

export interface Computed {
  st: Record<string, PlayerStat>;
  groups: Group[];
  h2h: HeadToHead[];
  champ: Record<string, ChampStat>;
  monthly: MonthChampion[];
  /** matches sorted oldest first */
  sorted: Match[];
  /** rating change per match and player (match id -> player id -> change) */
  changes: Record<string, Record<string, RatingChange>>;
}

export const hasKda = (s?: { kills?: number; deaths?: number; assists?: number }) =>
  !!s && s.kills != null && s.deaths != null && s.assists != null;

export const kdaRatio = (k: number, d: number, a: number) => (k + a) / Math.max(1, d);

const blank = (id: string): PlayerStat => ({
  id,
  rating: START_RATING,
  hist: [START_RATING],
  g: 0,
  w: 0,
  l: 0,
  streak: 0,
  bestStreak: 0,
  champs: {},
  winChamps: new Set(),
  upsets: 0,
  bountiesClaimed: 0,
  crowns: 0,
  k: 0,
  d: 0,
  a: 0,
  kdaGames: 0,
  items: {},
});

/** Everything derived from the full match list. Never stored. */
export function compute(matches: Match[], players: Player[], now = Date.now()): Computed {
  const st: Record<string, PlayerStat> = {};
  for (const p of players) st[p.id] = blank(p.id);
  const ensure = (id: string) => (st[id] ??= blank(id));
  const groups: Record<string, Group> = {};
  const pairs: Record<string, { a: string; b: string; res: string[] }> = {};
  const champ: Record<string, ChampStat> = {};
  const changes: Record<string, Record<string, RatingChange>> = {};
  const months: Record<string, Record<string, { g: number; w: number }>> = {};
  const sorted = matches.slice().sort((a, b) => a.playedAt - b.playedAt);

  for (const m of sorted) {
    const sides: Record<Side, string[]> = { blue: m.blue, red: m.red };
    const loser: Side = m.winner === "blue" ? "red" : "blue";
    // Ratings before this game, so the order of players doesn't matter.
    const before: Record<string, number> = {};
    for (const p of [...m.blue, ...m.red]) before[p] = ensure(p).rating;
    const teamChance = (side: Side) => {
      const opp = sides[side === "blue" ? "red" : "blue"].map((p) => before[p]);
      return mean(sides[side].map((p) => winChanceVs(before[p], opp)), 0.5);
    };
    const winProb = teamChance(m.winner);
    const bounty = sides[loser].some((p) => ensure(p).streak >= 3);
    const mk = monthKey(m.playedAt);
    const mo = (months[mk] ??= {});
    const ch: Record<string, RatingChange> = (changes[m.id] = {});

    for (const side of ["blue", "red"] as Side[]) {
      const won = m.winner === side;
      const opponents = sides[side === "blue" ? "red" : "blue"].map((p) => before[p]);
      for (const p of sides[side]) {
        const x = ensure(p);
        const change = ratingChange({
          rating: before[p],
          games: x.g,
          opponents,
          won,
          streak: x.streak,
          endedBounty: bounty,
          surrendered: !!m.surrender,
        });
        ch[p] = change;
        x.rating += change.delta;
        x.hist.push(x.rating);
        x.g++;
        if (won) x.w++;
        else x.l++;
        x.streak = won ? (x.streak > 0 ? x.streak + 1 : 1) : x.streak < 0 ? x.streak - 1 : -1;
        const s = m.stats[p];
        const c = s?.champion;
        if (won) {
          x.bestStreak = Math.max(x.bestStreak, x.streak);
          if (c) x.winChamps.add(c);
          if (winProb < 0.35) x.upsets++;
          if (bounty) x.bountiesClaimed++;
        }
        if (hasKda(s)) {
          x.k += s!.kills!;
          x.d += s!.deaths!;
          x.a += s!.assists!;
          x.kdaGames++;
        }
        const mp = (mo[p] ??= { g: 0, w: 0 });
        mp.g++;
        if (won) mp.w++;
        if (c) {
          x.champs[c] = (x.champs[c] || 0) + 1;
          const cs = (champ[c] ??= { g: 0, w: 0, items: {} });
          cs.g++;
          if (won) cs.w++;
          for (const it of s?.items ?? []) cs.items[it] = (cs.items[it] || 0) + 1;
        }
        for (const it of s?.items ?? []) x.items[it] = (x.items[it] || 0) + 1;
      }
      const team = sides[side].slice().sort();
      for (const k of [2, 3, 4, 5])
        for (const c of combos(team, k)) {
          const key = c.join(",");
          const g = (groups[key] ??= { ids: c, g: 0, w: 0 });
          g.g++;
          if (won) g.w++;
        }
    }
    for (const a of m.blue)
      for (const b of m.red) {
        const [x, y] = a < b ? [a, b] : [b, a];
        const pr = (pairs[x + "," + y] ??= { a: x, b: y, res: [] });
        pr.res.push(m.winner === "blue" ? a : b);
      }
  }

  const h2h: HeadToHead[] = Object.values(pairs).map((p) => {
    const wa = p.res.filter((w) => w === p.a).length;
    const leader = p.res[p.res.length - 1];
    let streak = 0;
    for (let i = p.res.length - 1; i >= 0 && p.res[i] === leader; i--) streak++;
    return { ...p, wa, wb: p.res.length - wa, g: p.res.length, leader, streak };
  });

  const activeIds = new Set(players.filter((p) => p.active).map((p) => p.id));
  const cur = monthKey(now);
  const monthly: MonthChampion[] = [];
  for (const [month, ps] of Object.entries(months)) {
    const top = Object.entries(ps)
      .filter(([id, v]) => v.g >= 3 && activeIds.has(id))
      .sort((a, b) => b[1].w - a[1].w || b[1].w / b[1].g - a[1].w / a[1].g)[0];
    if (top) monthly.push({ month, id: top[0], w: top[1].w, g: top[1].g, current: month === cur });
  }
  monthly.sort((a, b) => (a.month < b.month ? 1 : -1));
  for (const x of monthly) if (!x.current) ensure(x.id).crowns++;

  return { st, groups: Object.values(groups), h2h, champ, monthly, sorted, changes };
}

export const rating = (c: Computed, id: string) => Math.round(c.st[id]?.rating ?? START_RATING);
/** Team strength shown next to a team: the plain mean of its players' ratings. */
export const teamAvg = (c: Computed, ids: string[]) =>
  Math.round(ids.reduce((a, id) => a + rating(c, id), 0) / Math.max(1, ids.length));
/** Blue's chance to win, from the same per-player comparisons the rating uses. */
export const blueWinChance = (c: Computed, blue: string[], red: string[]) => {
  const r = (id: string) => c.st[id]?.rating ?? START_RATING;
  const opp = red.map(r);
  return mean(blue.map((id) => winChanceVs(r(id), opp)), 0.5);
};

export interface EloEntry {
  match: Match;
  won: boolean;
  change: RatingChange;
  /** Elo right after this game */
  after: number;
}

/** One player's games with their Elo change and Elo after each game, oldest first. */
export function eloLog(c: Computed, id: string): EloEntry[] {
  const out: EloEntry[] = [];
  let r = START_RATING;
  for (const m of c.sorted) {
    const change = c.changes[m.id]?.[id];
    if (!change) continue;
    r += change.delta;
    out.push({ match: m, won: (m.blue.includes(id) ? "blue" : "red") === m.winner, change, after: r });
  }
  return out;
}

/** Elo won or lost over a player's last n games (0 without games). */
export const eloTrend = (log: EloEntry[], n = 5) => log.slice(-n).reduce((a, e) => a + e.change.delta, 0);

/* ---------- rivalries ---------- */

export function rivalryVerb(streak: number) {
  return streak >= 6 ? "owns" : streak >= 4 ? "is dominating" : "has the upper hand on";
}

/** Active rivalries (3+ wins in a row head-to-head), strongest first. */
export function rivalries(c: Computed, isActive: (id: string) => boolean) {
  return c.h2h
    .filter((f) => f.streak >= 3 && isActive(f.a) && isActive(f.b))
    .sort((a, b) => b.streak - a.streak || b.g - a.g);
}

/* ---------- period stats ---------- */

export interface PeriodRow {
  id: string;
  g: number;
  w: number;
  k: number;
  d: number;
  a: number;
  kn: number;
}

export function periodStats(matches: Match[], since: number, isActive: (id: string) => boolean) {
  const rows: Record<string, PeriodRow> = {};
  let bestGame: { id: string; k: number; champion?: string } | null = null;
  const ms = matches.filter((m) => m.playedAt >= since);
  for (const m of ms)
    for (const side of ["blue", "red"] as Side[])
      for (const id of m[side]) {
        if (!isActive(id)) continue;
        const x = (rows[id] ??= { id, g: 0, w: 0, k: 0, d: 0, a: 0, kn: 0 });
        x.g++;
        if (m.winner === side) x.w++;
        const s = m.stats[id];
        if (hasKda(s)) {
          x.kn++;
          x.k += s.kills!;
          x.d += s.deaths!;
          x.a += s.assists!;
          if (!bestGame || s.kills! > bestGame.k) bestGame = { id, k: s.kills!, champion: s.champion };
        }
      }
  return { rows: Object.values(rows), bestGame, count: ms.length };
}

export function records(matches: Match[], since: number, isActive: (id: string) => boolean) {
  const { rows, bestGame } = periodStats(matches, since, isActive);
  const bestKda = rows
    .filter((x) => x.kn >= 3)
    .map((x) => ({ id: x.id, r: kdaRatio(x.k, x.d, x.a) }))
    .sort((a, b) => b.r - a.r)[0];
  const mostKills = rows.filter((x) => x.kn).sort((a, b) => b.k - a.k)[0];
  const mostWins = rows.slice().sort((a, b) => b.w - a.w || a.g - b.g)[0];
  return { bestGame, bestKda, mostKills, mostWins };
}

export function weeklyAwards(matches: Match[], now: number, isActive: (id: string) => boolean) {
  const { rows } = periodStats(matches, now - 7 * DAY, isActive);
  const kd = rows.filter((x) => x.kn);
  const first = <T,>(xs: T[], f: (a: T, b: T) => number) => xs.slice().sort(f)[0];
  return {
    any: rows.length > 0,
    mvp: first(rows.filter((x) => x.g >= 2), (a, b) => b.w - a.w || b.w / b.g - a.w / a.g),
    kills: first(kd, (a, b) => b.k - a.k),
    kda: first(kd.filter((x) => x.kn >= 2), (a, b) => kdaRatio(b.k, b.d, b.a) - kdaRatio(a.k, a.d, a.a)),
    deaths: first(kd, (a, b) => b.d - a.d),
  };
}

/* ---------- player profile ---------- */

export interface Badge {
  title: string;
  detail: string;
  gold?: boolean;
}

export function badges(x: PlayerStat | undefined): Badge[] {
  if (!x) return [];
  const b: Badge[] = [];
  if (x.crowns) b.push({ title: "Monthly champion", detail: x.crowns > 1 ? `Won ${x.crowns} months` : "Won a month", gold: true });
  if (x.bestStreak >= 5) b.push({ title: "On fire", detail: `Best streak: ${x.bestStreak} wins` });
  if (x.bountiesClaimed)
    b.push({ title: "Bounty hunter", detail: `Ended ${x.bountiesClaimed} win streak${x.bountiesClaimed > 1 ? "s" : ""}` });
  if (x.upsets) b.push({ title: "Giant slayer", detail: `${x.upsets} upset win${x.upsets > 1 ? "s" : ""} as the underdog` });
  if (x.winChamps.size >= 8) b.push({ title: "Champion pool", detail: `Won with ${x.winChamps.size} different champions` });
  const ms = [100, 50, 25].find((t) => x.g >= t);
  if (ms) b.push({ title: `${ms} games`, detail: `${x.g} games played` });
  return b;
}

/** How many games with or against someone count as enough to compare. */
export const MIN_TOGETHER = 3;

/** Games and wins with a teammate, or against an opponent. */
export interface Versus {
  id: string;
  g: number;
  w: number;
}

/**
 * The people with the highest and the lowest win rate. Only people with enough games are compared, or everyone
 * if nobody has. One person is never both: with a single rate, it counts as high above 50% and as low below.
 */
export function extremes(list: Versus[], name: (id: string) => string): { high: Versus | null; low: Versus | null } {
  const enough = list.filter((x) => x.g >= MIN_TOGETHER);
  const pool = enough.length ? enough : list.filter((x) => x.g > 0);
  if (!pool.length) return { high: null, low: null };
  const rate = (x: Versus) => x.w / x.g;
  const more = (a: Versus, b: Versus) => b.g - a.g || name(a.id).localeCompare(name(b.id));
  const high = pool.slice().sort((a, b) => rate(b) - rate(a) || more(a, b))[0];
  const low = pool.slice().sort((a, b) => rate(a) - rate(b) || more(a, b))[0];
  if (rate(high) > rate(low)) return { high, low };
  return { high: rate(high) > 0.5 ? high : null, low: rate(high) < 0.5 ? high : null };
}

/** One player's own stats page: all games, all time. */
export function playerSummary(c: Computed, id: string, isActive: (id: string) => boolean, name: (id: string) => string) {
  const x = c.st[id] ?? blank(id);
  const champs: Record<string, { name: string; g: number; w: number }> = {};
  for (const m of c.sorted) {
    const side: Side | null = m.blue.includes(id) ? "blue" : m.red.includes(id) ? "red" : null;
    const champ = side && m.stats[id]?.champion;
    if (!champ) continue;
    const e = (champs[champ] ??= { name: champ, g: 0, w: 0 });
    e.g++;
    if (m.winner === side) e.w++;
  }
  const mates = c.groups
    .filter((g) => g.ids.length === 2 && g.ids.includes(id))
    .map((g): Versus => ({ id: g.ids.find((i) => i !== id)!, g: g.g, w: g.w }))
    .filter((v) => isActive(v.id));
  const foes = c.h2h
    .filter((f) => f.a === id || f.b === id)
    .map((f): Versus => ({ id: f.a === id ? f.b : f.a, g: f.g, w: f.a === id ? f.wa : f.wb }))
    .filter((v) => isActive(v.id));
  const duo = extremes(mates, name);
  const foe = extremes(foes, name);
  return {
    g: x.g,
    w: x.w,
    l: x.l,
    k: x.k,
    d: x.d,
    a: x.a,
    kdaGames: x.kdaGames,
    champs: Object.values(champs).sort((a, b) => b.g - a.g || b.w - a.w || a.name.localeCompare(b.name)),
    bestDuo: duo.high,
    worstDuo: duo.low,
    victim: foe.high,
    toughest: foe.low,
  };
}

/** Best teammate, victim and toughest opponent for the side card on the Stats page. */
export function profile(c: Computed, id: string, isActive: (id: string) => boolean) {
  const mate = c.groups
    .filter((g) => g.ids.length === 2 && g.ids.includes(id) && g.g >= 3 && g.ids.every(isActive))
    .sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g)[0];
  const foes = c.h2h
    .filter((f) => (f.a === id || f.b === id) && f.g >= 3 && isActive(f.a) && isActive(f.b))
    .map((f) => {
      const w = f.a === id ? f.wa : f.wb;
      return { o: f.a === id ? f.b : f.a, w, l: f.g - w, g: f.g, r: w / f.g };
    });
  const victim = foes.slice().sort((a, b) => b.r - a.r || b.g - a.g)[0];
  const nemesis = foes.slice().sort((a, b) => a.r - b.r)[0];
  return {
    mate: mate ? { id: mate.ids.find((i) => i !== id)!, w: mate.w, g: mate.g } : null,
    victim: victim && victim.r > 0.5 ? victim : null,
    nemesis: nemesis && nemesis.r < 0.5 ? nemesis : null,
  };
}

export const topEntries = <K extends string | number>(rec: Record<K, number>, n: number) =>
  (Object.entries(rec) as [K, number][]).sort((a, b) => b[1] - a[1]).slice(0, n);

export function formOf(matches: Match[], id: string, n: number): boolean[] {
  return matches
    .filter((m) => m.blue.includes(id) || m.red.includes(id))
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, n)
    .map((m) => (m.blue.includes(id) ? "blue" : "red") === m.winner)
    .reverse();
}

/** Top bounty target in a set of players (3+ win streak). */
export function bountyTarget(c: Computed, ids: string[]) {
  return ids
    .filter((id) => (c.st[id]?.streak ?? 0) >= 3)
    .sort((a, b) => c.st[b].streak - c.st[a].streak)[0];
}
