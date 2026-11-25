import { describe, expect, it } from "vitest";
import { extraPlayers, makeTeams, planSitOut, strSeed, toggleSitPick, validPicks, type SitMode } from "../src/lib/teams";
import { seeded } from "../src/lib/util";
import type { TeamStyle } from "../src/lib/types";

const ids = ["a", "b", "c", "d", "e", "f", "g"];
const ratingOf = () => 1000;

describe("who sits out", () => {
  it("nobody sits out when the selection fits", () => {
    expect(extraPlayers(6, 3)).toBe(0);
    expect(extraPlayers(7, 3)).toBe(1);
    expect(extraPlayers(9, 3)).toBe(3);
    for (const mode of ["fair", "random", "pick"] as SitMode[])
      expect(planSitOut({ selected: ids.slice(0, 6), size: 3, mode, sitPriority: {} })).toEqual([]);
  });

  it("fair rotation: whoever sat out last time plays", () => {
    for (let s = 1; s < 40; s++) {
      const out = planSitOut({ selected: ids, size: 2, mode: "fair", sitPriority: { g: 1, f: 2 }, rng: seeded(s) });
      expect(out).toHaveLength(3);
      expect(out).not.toContain("g");
      expect(out).not.toContain("f");
    }
  });

  it("fair rotation with a fixed seed is stable (same preview on every device)", () => {
    const seed = strSeed("a,b,c,d,e,f,g|3|12");
    const one = planSitOut({ selected: ids, size: 3, mode: "fair", sitPriority: {}, rng: seeded(seed) });
    const two = planSitOut({ selected: ids, size: 3, mode: "fair", sitPriority: {}, rng: seeded(seed) });
    expect(one).toEqual(two);
    expect(strSeed("x")).not.toBe(strSeed("y"));
  });

  it("random: anyone can sit out, even someone fair rotation would let play", () => {
    const seen = new Set<string>();
    for (let s = 1; s < 200; s++) {
      const out = planSitOut({ selected: ids, size: 3, mode: "random", sitPriority: { g: 5 }, rng: seeded(strSeed(`r${s}`)) });
      expect(out).toHaveLength(1);
      seen.add(out[0]);
    }
    expect(seen.size).toBe(7);
  });

  it("pick: needs exactly the right number of valid picks", () => {
    const base = { selected: ids, size: 3 as const, mode: "pick" as SitMode, sitPriority: {} };
    expect(planSitOut({ ...base, picked: ["c"] })).toEqual(["c"]);
    expect(() => planSitOut({ ...base, picked: [] })).toThrow("Pick 1 player to sit out");
    expect(() => planSitOut({ ...base, picked: ["zz"] })).toThrow();
    expect(() => planSitOut({ ...base, size: 2, picked: ["a"] })).toThrow("Pick 3 players to sit out");
    expect(validPicks(["a", "a", "zz", "b"], ids)).toEqual(["a", "b"]);
  });

  it("tapping toggles, and the oldest pick makes room when full", () => {
    expect(toggleSitPick([], "a", 1)).toEqual(["a"]);
    expect(toggleSitPick(["a"], "a", 1)).toEqual([]);
    expect(toggleSitPick(["a"], "b", 1)).toEqual(["b"]);
    expect(toggleSitPick(["a", "b"], "c", 2)).toEqual(["b", "c"]);
    expect(toggleSitPick(["a"], "b", 2)).toEqual(["a", "b"]);
  });
});

describe("makeTeams with a chosen sit-out", () => {
  const styles: TeamStyle[] = ["random", "balanced", "captains"];

  it("the chosen player sits out in every style, teams stay full", () => {
    for (const style of styles)
      for (let s = 1; s < 25; s++) {
        const L = makeTeams({ selected: ids, size: 3, style, ratingOf, sitPriority: { e: 9 }, sitOut: ["e"], rng: seeded(s) });
        expect(L.sitOut).toEqual(["e"]);
        const all = [...L.blue, ...L.red, ...(L.captains?.pool ?? [])];
        expect(all).toHaveLength(6);
        expect(all).not.toContain("e");
      }
  });

  it("keep apart still works with the others, and is skipped when one of them sits out", () => {
    for (let s = 1; s < 30; s++) {
      const L = makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: {}, sitOut: ["g"], apart: ["a", "b"], rng: seeded(s) });
      expect(L.blue.includes("a")).not.toBe(L.blue.includes("b"));
      const C = makeTeams({ selected: ids, size: 3, style: "captains", ratingOf, sitPriority: {}, sitOut: ["g"], apart: ["a", "b"], rng: seeded(s) });
      expect([C.blue[0], C.red[0]].sort()).toEqual(["a", "b"]);
      const X = makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: {}, sitOut: ["a"], apart: ["a", "b"], rng: seeded(s) });
      expect([...X.blue, ...X.red]).toContain("b");
    }
  });

  it("avoid last teams and no repeat of the current draft still hold", () => {
    const sel = ["a", "b", "c", "d", "e"];
    const last = { blue: ["a", "b"], red: ["c", "d"] };
    for (let s = 1; s < 30; s++) {
      const L = makeTeams({ selected: sel, size: 2, style: "random", ratingOf, sitPriority: {}, sitOut: ["e"], avoid: last, rng: seeded(s) });
      expect([L.blue.slice().sort().join(), L.red.slice().sort().join()].sort()).not.toEqual(["a,b", "c,d"]);
      const R = makeTeams({ selected: sel, size: 2, style: "balanced", ratingOf, sitPriority: {}, sitOut: ["e"], current: L, rng: seeded(s + 50) });
      expect(R.blue.slice().sort()).not.toEqual(L.blue.slice().sort());
      expect(R.blue.slice().sort()).not.toEqual(L.red.slice().sort());
    }
  });

  it("works with uneven teams and 5v5", () => {
    const ten = [...ids, "h", "i", "j"];
    for (let s = 1; s < 30; s++) {
      const out = planSitOut({ selected: ids, size: 3, sizes: [3, 2], mode: "fair", sitPriority: { a: 2 }, rng: seeded(s) });
      expect(out).toHaveLength(2);
      expect(out).not.toContain("a");
      const L = makeTeams({ selected: ids, size: 3, sizes: [3, 2], style: "random", ratingOf, sitPriority: {}, sitOut: out, rng: seeded(s) });
      expect([L.blue.length, L.red.length].sort()).toEqual([2, 3]);
      expect(L.sitOut).toEqual(out);
      const five = makeTeams({ selected: ten, size: 5, style: "balanced", ratingOf, sitPriority: {}, rng: seeded(s) });
      expect([five.blue.length, five.red.length, five.sitOut.length]).toEqual([5, 5, 0]);
    }
    expect(() => planSitOut({ selected: ids, size: 3, sizes: [3, 2], mode: "pick", sitPriority: {}, picked: ["a"] })).toThrow("Pick 2 players to sit out");
  });

  it("refuses a sit-out list of the wrong size", () => {
    expect(() => makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: {}, sitOut: [] })).toThrow("Too many");
    expect(() => makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: {}, sitOut: ["a", "b"] })).toThrow("Not enough");
  });
});
