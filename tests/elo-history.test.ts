import { describe, expect, it } from "vitest";
import { compute, eloLog, eloTrend, rating, FF_PENALTY, START_RATING } from "../src/lib/stats";
import type { Match, Player, Side } from "../src/lib/types";
import { HOUR } from "../src/lib/util";

const players: Player[] = ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase(), active: true, createdAt: 0 }));
let t0 = Date.UTC(2026, 9, 1, 18);
let n = 0;
const match = (blue: string[], red: string[], winner: Side, extra: Partial<Match> = {}): Match => ({
  id: `m${++n}`,
  playedAt: (t0 += HOUR),
  mode: blue.length as 1,
  blue,
  red,
  winner,
  stats: {},
  dodges: [],
  sitOut: [],
  ...extra,
});

describe("eloLog", () => {
  it("is empty with no games, and the trend is 0", () => {
    const c = compute([], players);
    expect(eloLog(c, "a")).toEqual([]);
    expect(eloTrend(eloLog(c, "a"))).toBe(0);
    expect(eloLog(c, "nobody")).toEqual([]);
  });

  it("lists only the player's games, oldest first, ending at their current Elo", () => {
    const ms = [match(["a"], ["b"], "blue"), match(["c"], ["d"], "red"), match(["b"], ["a"], "blue"), match(["a", "c"], ["b", "d"], "blue")];
    // pass them out of order: the log must still be chronological
    const c = compute([ms[2], ms[0], ms[3], ms[1]], players);
    const log = eloLog(c, "a");
    expect(log.map((e) => e.match.id)).toEqual([ms[0].id, ms[2].id, ms[3].id]);
    expect(log.map((e) => e.won)).toEqual([true, false, true]);
    expect(log[log.length - 1].after).toBe(rating(c, "a"));
    let r = START_RATING;
    for (const e of log) expect(e.after).toBe((r += e.change.delta));
    // same numbers as the history chart and the per-match changes
    expect(log.map((e) => e.after)).toEqual(c.st.a.hist.slice(1));
    for (const e of log) expect(e.change).toBe(c.changes[e.match.id].a);
  });

  it("keeps the breakdown: a surrendering loser gets the FF penalty", () => {
    const c = compute([match(["a"], ["b"], "blue", { surrender: "ff" })], players);
    const [lost] = eloLog(c, "b");
    expect(lost.won).toBe(false);
    expect(lost.change.ff).toBe(-FF_PENALTY);
    expect(lost.change.delta).toBe(lost.change.base + lost.change.ff);
    expect(eloLog(c, "a")[0].change.ff).toBe(0);
  });

  it("eloTrend sums the last n changes", () => {
    const ms = Array.from({ length: 7 }, (_, i) => match(["a"], ["b"], i % 3 ? "blue" : "red"));
    const log = eloLog(compute(ms, players), "a");
    const deltas = log.map((e) => e.change.delta);
    expect(eloTrend(log)).toBe(deltas.slice(-5).reduce((x, y) => x + y, 0));
    expect(eloTrend(log, 2)).toBe(deltas[5] + deltas[6]);
    expect(eloTrend(log, 50)).toBe(log[6].after - START_RATING);
  });
});
