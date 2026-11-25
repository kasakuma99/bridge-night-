import { describe, expect, it } from "vitest";
import { TEAM_SIZES, makeTeams, maxSize, teamKey, teamPlan } from "../src/lib/teams";
import { seeded } from "../src/lib/util";

const ids = (n: number) => Array.from({ length: n }, (_, i) => "p" + i);
const base = { ratingOf: () => 1000, sitPriority: {} };

describe("team plan", () => {
  it("has 1v1 to 5v5", () => {
    expect(TEAM_SIZES).toEqual([1, 2, 3, 4, 5]);
    expect(maxSize(10)).toBe(5);
    expect(maxSize(30)).toBe(5);
  });
  it("exact and extra players", () => {
    expect(teamPlan(6, 3)).toEqual({ kind: "full", sizes: [3, 3], out: 0 });
    expect(teamPlan(6, 2)).toEqual({ kind: "full", sizes: [2, 2], out: 2 });
    expect(teamPlan(10, 5)).toEqual({ kind: "full", sizes: [5, 5], out: 0 });
  });
  it("too few, but even: a smaller equal game", () => {
    expect(teamPlan(6, 5)).toEqual({ kind: "short", sizes: [3, 3] });
    expect(teamPlan(2, 3)).toEqual({ kind: "short", sizes: [1, 1] });
  });
  it("odd numbers ask: play uneven or sit someone out", () => {
    expect(teamPlan(5, 3)).toEqual({ kind: "odd", uneven: { sizes: [3, 2], out: 0 }, sit: { sizes: [2, 2], out: 1 } });
    expect(teamPlan(5, 2)).toEqual({ kind: "odd", uneven: { sizes: [3, 2], out: 0 }, sit: { sizes: [2, 2], out: 1 } });
    expect(teamPlan(7, 2)).toEqual({ kind: "odd", uneven: { sizes: [3, 2], out: 2 }, sit: { sizes: [2, 2], out: 3 } });
    expect(teamPlan(3, 5)).toEqual({ kind: "odd", uneven: { sizes: [2, 1], out: 0 }, sit: { sizes: [1, 1], out: 1 } });
  });
  it("never more than 5 on a side", () => {
    expect(teamPlan(11, 5)).toEqual({ kind: "odd", uneven: null, sit: { sizes: [5, 5], out: 1 } });
  });
  it("needs two players", () => {
    expect(teamPlan(0, 1).kind).toBe("none");
    expect(teamPlan(1, 1).kind).toBe("none");
  });
  it("every plan can be made, without losing or doubling anyone", () => {
    for (let n = 2; n <= 12; n++)
      for (const size of TEAM_SIZES) {
        const p = teamPlan(n, size);
        const all = p.kind === "odd" ? [p.uneven, p.sit] : p.kind === "none" ? [] : [p];
        for (const x of all) {
          if (!x) continue;
          const L = makeTeams({ ...base, selected: ids(n), size, sizes: x.sizes, style: "random", rng: seeded(n * 10 + size) });
          expect([L.blue.length, L.red.length].sort()).toEqual([...x.sizes].sort());
          expect(new Set([...L.blue, ...L.red, ...L.sitOut]).size).toBe(n);
          expect(L.size).toBe(Math.max(...x.sizes));
        }
      }
  });
});

describe("making teams", () => {
  it("5v5 works", () => {
    const L = makeTeams({ ...base, selected: ids(10), size: 5, style: "random", rng: seeded(3) });
    expect([L.blue.length, L.red.length, L.sitOut.length]).toEqual([5, 5, 0]);
  });
  it("uneven teams: either side can be the bigger one, and everyone can be on it", () => {
    const sides = new Set<string>();
    const onBig = new Set<string>();
    const rng = seeded(13);
    for (let i = 0; i < 80; i++) {
      const L = makeTeams({ ...base, selected: ids(5), size: 3, sizes: [2, 3], style: "random", rng });
      sides.add(`${L.blue.length}v${L.red.length}`);
      (L.blue.length > L.red.length ? L.blue : L.red).forEach((x) => onBig.add(x));
    }
    expect([...sides].sort()).toEqual(["2v3", "3v2"]);
    expect(onBig.size).toBe(5);
  });
  it("true random reaches every split", () => {
    const seen = new Set<string>();
    const rng = seeded(11);
    for (let i = 0; i < 400; i++) {
      const L = makeTeams({ ...base, selected: ids(6), size: 3, style: "random", rng });
      seen.add(teamKey(L.blue, L.red));
    }
    expect(seen.size).toBe(10);
  });
  it("weighted finds the closest split, also for uneven teams", () => {
    const pts: Record<string, number> = { p0: 1500, p1: 1400, p2: 1000, p3: 900, p4: 800 };
    const avg = (t: string[]) => t.reduce((a, x) => a + pts[x], 0) / t.length;
    for (let s = 1; s < 20; s++) {
      const L = makeTeams({ selected: ids(4), size: 2, style: "balanced", ratingOf: (id) => pts[id], sitPriority: {}, rng: seeded(s) });
      expect(Math.abs(avg(L.blue) - avg(L.red))).toBe(0);
      const U = makeTeams({ selected: ids(5), size: 3, sizes: [3, 2], style: "balanced", ratingOf: (id) => pts[id], sitPriority: {}, rng: seeded(s) });
      expect(Math.abs(avg(U.blue) - avg(U.red))).toBeLessThan(80);
    }
  });
  it("with equal points, weighted still mixes the teams", () => {
    const seen = new Set<string>();
    const rng = seeded(12);
    for (let i = 0; i < 60; i++) {
      const L = makeTeams({ ...base, selected: ids(4), size: 2, style: "balanced", rng });
      seen.add(teamKey(L.blue, L.red));
    }
    expect(seen.size).toBe(3);
  });
  it("a reroll changes the teams when it can", () => {
    for (const sizes of [[2, 2], [3, 2]] as [number, number][]) {
      const L = makeTeams({ ...base, selected: ids(sizes[0] + sizes[1]), size: 3, sizes, style: "random", rng: seeded(5) });
      for (let s = 1; s < 30; s++) {
        const R = makeTeams({ ...base, selected: ids(sizes[0] + sizes[1]), size: 3, sizes, style: "random", current: L, rng: seeded(s) });
        expect(teamKey(R.blue, R.red)).not.toBe(teamKey(L.blue, L.red));
      }
    }
    // 1v1 has only one split: rerolling must not fail
    const D = makeTeams({ ...base, selected: ids(2), size: 1, style: "random" });
    expect(makeTeams({ ...base, selected: ids(2), size: 1, style: "random", current: D }).blue).toHaveLength(1);
  });
});
