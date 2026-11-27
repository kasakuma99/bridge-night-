import { describe, expect, it } from "vitest";
import { compute } from "../src/lib/stats";
import {
  board,
  filterMatches,
  overview,
  periodStart,
  playerView,
  rivalryTop,
  sortBoard,
  stomps,
  synergies,
  synergyTop,
  type Filter,
} from "../src/lib/statsPage";
import type { Match, Player, Side, TeamSize } from "../src/lib/types";
import { DAY, HOUR } from "../src/lib/util";

// 2026-11-27 12:00 in Berlin (UTC+1).
const NOW = Date.UTC(2026, 10, 27, 11, 0, 0);
const players: Player[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, name: id.toUpperCase(), active: true, createdAt: 0 }));
const isActive = (id: string) => players.some((p) => p.id === id && p.active);
const name = (id: string) => id.toUpperCase();
let n = 0;
const game = (blue: string[], red: string[], winner: Side, at: number, x: Partial<Match> = {}): Match => ({
  id: `m${n++}`,
  playedAt: at,
  mode: Math.max(blue.length, red.length) as TeamSize,
  blue,
  red,
  winner,
  stats: {},
  dodges: [],
  sitOut: [],
  ...x,
});
const ALL: Filter = { mode: 0, period: 0 };

describe("periods", () => {
  it("today starts at 06:00 in Berlin, also after midnight", () => {
    expect(periodStart(1, NOW)).toBe(Date.UTC(2026, 10, 27, 5, 0, 0));
    const late = Date.UTC(2026, 10, 27, 1, 30); // 02:30 in Berlin: still last night
    expect(periodStart(1, late)).toBe(Date.UTC(2026, 10, 26, 5, 0, 0));
    expect(periodStart(7, NOW)).toBe(NOW - 7 * DAY);
    expect(periodStart(0, NOW)).toBe(0);
  });

  it("filters by team size and time", () => {
    const ms = [game(["a", "b"], ["c", "d"], "blue", NOW - HOUR), game(["a", "b", "e"], ["c", "d", "f"], "red", NOW - 3 * DAY), game(["a"], ["b"], "red", NOW - 40 * DAY)];
    expect(filterMatches(ms, { mode: 2, period: 0 }, NOW)).toEqual([ms[0]]);
    expect(filterMatches(ms, { mode: 0, period: 7 }, NOW)).toEqual([ms[0], ms[1]]);
    expect(filterMatches(ms, { mode: 0, period: 1 }, NOW)).toEqual([ms[0]]);
    expect(filterMatches(ms, ALL, NOW)).toHaveLength(3);
  });
});

describe("synergy", () => {
  it("is the win rate together compared with what the players win on their own", () => {
    // a + b win together 4 of 4. Apart they lose.
    const ms = [
      ...Array.from({ length: 4 }, (_, i) => game(["a", "b"], ["c", "d"], "blue", i)),
      ...Array.from({ length: 2 }, (_, i) => game(["a", "c"], ["d", "e"], "red", 10 + i)),
      ...Array.from({ length: 2 }, (_, i) => game(["b", "c"], ["d", "e"], "red", 20 + i)),
    ];
    const c = compute(ms, players);
    const s = synergies(c, [2], isActive);
    const ab = s.find((x) => x.ids.join() === "a,b")!;
    expect(ab.rate).toBeCloseTo(5 / 6);
    expect(ab.expected).toBeCloseTo(4 / 6); // a and b won 4 of 6 each
    expect(ab.score).toBeGreaterThan(0);
    const top = synergyTop(s, 3);
    expect(top.best[0].ids).toEqual(["a", "b"]);
    expect(top.worst.some((x) => x.ids.join() === "a,b")).toBe(false);
  });

  it("needs 3 games together", () => {
    const c = compute([game(["a", "b"], ["c", "d"], "blue", 1), game(["a", "b"], ["c", "d"], "blue", 2)], players);
    expect(synergies(c, [2], isActive)).toEqual([]);
  });

  it("knows teams of 4 and 5", () => {
    const ms = Array.from({ length: 3 }, (_, i) => game(["a", "b", "c", "d", "e"], ["f"], "blue", i));
    const c = compute(ms, players);
    expect(synergies(c, [4], isActive)).toHaveLength(5);
    expect(synergies(c, [5], isActive)).toHaveLength(1);
  });
});

describe("leaderboard", () => {
  const ms = [
    game(["a"], ["b"], "blue", 1),
    game(["a"], ["b"], "blue", 2),
    game(["a"], ["c"], "red", 3),
    game(["c"], ["d"], "blue", 4),
  ];
  const c = compute(ms, players);
  const rows = board(c, c, isActive);

  it("only has players with games, all with the same Papi Points", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(rows.map((r) => r.points))).toEqual(new Set([1000]));
  });

  it("sorts by any column, both ways, with the usual order for ties", () => {
    expect(sortBoard(rows, "points", true, name).map((r) => r.id)).toEqual(["c", "a", "b", "d"]); // same points: wins, then win rate, then games
    expect(sortBoard(rows, "wr", true, name)[0].id).toBe("c");
    expect(sortBoard(rows, "g", true, name)[0].id).toBe("a");
    expect(sortBoard(rows, "l", true, name)[0].id).toBe("b");
    expect(sortBoard(rows, "wr", false, name)[0].id).toBe("b");
  });
});

describe("head to head", () => {
  const ms = [
    ...Array.from({ length: 5 }, (_, i) => game(["a"], ["b"], "blue", i)),
    game(["a"], ["b"], "red", 6),
    ...Array.from({ length: 2 }, (_, i) => game(["c"], ["d"], "blue", 10 + i)),
    ...Array.from({ length: 2 }, (_, i) => game(["c"], ["d"], "red", 20 + i)),
  ];
  const c = compute(ms, players);

  it("biggest stomp: the largest gap in wins, the winner first", () => {
    expect(stomps(c, isActive)[0]).toEqual({ a: "a", b: "b", wa: 5, wb: 1, g: 6 });
    expect(stomps(c, isActive).some((p) => p.a === "c" || p.a === "d")).toBe(false); // 2–2 is no stomp
  });

  it("biggest rivalry: closest to even, with at least 4 games", () => {
    expect(rivalryTop(c, isActive)[0]).toMatchObject({ g: 4, wa: 2, wb: 2 });
    expect(rivalryTop(c, isActive)[1]).toMatchObject({ a: "a", b: "b" });
  });
});

describe("the group's cards", () => {
  it("counts games, length, FF wins, rerolls, augments and champions", () => {
    const ms = [
      game(["a"], ["b"], "blue", NOW - HOUR, { durationSec: 600, surrender: "ff", stats: { a: { champion: "Ahri", augments: [1, 2] }, b: { champion: "Ahri", augments: [1] } } }),
      game(["a"], ["b"], "red", NOW - HOUR, { durationMin: 20, stats: { a: { champion: "Zed", augments: [1] }, b: { augments: [1] } } }),
      game(["a"], ["b"], "red", NOW - HOUR),
    ];
    const rerolls = [{ at: NOW - HOUR, size: 1, players: ["a"] }, { at: NOW - HOUR, size: 3, players: ["a"] }, { at: NOW - 30 * DAY, size: 1, players: [] }];
    const o = overview(ms, rerolls, { mode: 1 as never, period: 7 }, NOW);
    expect(o).toMatchObject({ games: 3, avgSec: 900, totalSec: 2700, ffWins: 1, rerolls: 1 });
    expect(o.augments[0]).toEqual({ key: "1", picks: 4, wins: 2 });
    expect(o.bestAugments).toEqual([{ key: "1", picks: 4, wins: 2 }]);
    expect(o.champions[0]).toEqual({ key: "Ahri", picks: 2, wins: 1 });
    expect(overview(ms, rerolls, ALL, NOW).rerolls).toBe(3);
  });
});

describe("a player", () => {
  it("has wins, FF %, augments, streaks and partners for the mode", () => {
    const ms = [
      game(["a", "b"], ["c", "d"], "blue", 1, { stats: { a: { augments: [7, 8], damage: 1000, kills: 1, deaths: 2, assists: 3 } } }),
      game(["a", "b"], ["c", "d"], "blue", 2, { stats: { a: { augments: [7], damage: 3000 } } }),
      game(["a", "b"], ["c", "d"], "blue", 3),
      game(["a", "c"], ["b", "d"], "red", 4, { surrender: "ff" }),
      game(["a", "c"], ["b", "d"], "red", 5),
      game(["a", "c"], ["b", "d"], "red", 6),
    ];
    const c = compute(ms, players);
    const v = playerView({ id: "a", ms, c, full: c, f: { mode: 2, period: 0 }, isActive, name });
    expect(v).toMatchObject({ g: 6, w: 3, l: 3, points: 1000, change: 0, ff: 1, bestStreak: 3, worstRun: 3, avgDamage: 2000, kdaGames: 1 });
    expect(v.ffRate).toBeCloseTo(1 / 6);
    expect(v.augments[0]).toEqual({ key: "7", picks: 2, wins: 2 });
    expect(v.form).toEqual([true, true, true, false, false, false]);
    expect(v.partners).toHaveLength(1);
    expect(v.partners[0].best?.ids).toEqual(["a", "b"]);
    expect(v.partners[0].worst?.ids).toEqual(["a", "c"]);
  });

  it("overall: only the group sizes with enough games", () => {
    const ms = Array.from({ length: 3 }, (_, i) => game(["a", "b"], ["c", "d"], "blue", i));
    const c = compute(ms, players);
    const v = playerView({ id: "a", ms, c, full: c, f: ALL, isActive, name });
    expect(v.partners.map((p) => p.size)).toEqual([2]);
  });
});
