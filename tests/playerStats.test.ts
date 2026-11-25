import { describe, expect, it } from "vitest";
import { compute, extremes, playerSummary, type Versus } from "../src/lib/stats";
import type { Match, Player, Side } from "../src/lib/types";

const PLAYERS: Player[] = ["Tosh", "Samu", "Lenny", "Artur", "Philip"].map((name, i) => ({ id: `p${i}`, name, active: true, createdAt: 0 }));
const name = (id: string) => PLAYERS.find((p) => p.id === id)?.name ?? id;
const on = () => true;
let n = 0;
const game = (blue: string[], red: string[], winner: Side, stats: Match["stats"] = {}): Match => ({
  id: `m${++n}`, playedAt: 1_800_000_000_000 + n * 6e5, mode: 2, blue, red, winner, stats, dodges: [], sitOut: [],
});
const sum = (ms: Match[], id: string, active: (id: string) => boolean = on) => playerSummary(compute(ms, PLAYERS), id, active, name);
const v = (id: string, w: number, g: number): Versus => ({ id, w, g });

describe("highest and lowest win rate", () => {
  it("needs three games, as soon as anyone has them", () => {
    expect(extremes([v("p1", 1, 1), v("p2", 2, 4), v("p3", 1, 4)], name)).toEqual({ high: v("p2", 2, 4), low: v("p3", 1, 4) });
  });
  it("uses fewer games until then", () => {
    expect(extremes([v("p1", 1, 1), v("p2", 0, 2)], name)).toEqual({ high: v("p1", 1, 1), low: v("p2", 0, 2) });
  });
  it("one person is never both", () => {
    expect(extremes([v("p1", 3, 4)], name)).toEqual({ high: v("p1", 3, 4), low: null });
    expect(extremes([v("p1", 1, 4)], name)).toEqual({ high: null, low: v("p1", 1, 4) });
    expect(extremes([v("p1", 2, 4)], name)).toEqual({ high: null, low: null });
    expect(extremes([v("p1", 3, 4), v("p2", 3, 4)], name).low).toBeNull();
    expect(extremes([], name)).toEqual({ high: null, low: null });
  });
  it("a tie goes to more games, then the name", () => {
    expect(extremes([v("p1", 3, 4), v("p2", 6, 8), v("p3", 0, 4)], name).high!.id).toBe("p2");
    expect(extremes([v("p1", 3, 4), v("p2", 3, 4), v("p3", 0, 4)], name).high!.id).toBe("p2"); // Lenny before Samu
  });
});

describe("a player's page", () => {
  const st = (champion: string, kills: number, deaths: number, assists: number) => ({ champion, kills, deaths, assists });
  const ms = [
    game(["p0", "p1"], ["p2", "p3"], "blue", { p0: st("Yone", 10, 2, 5) }),
    game(["p0", "p1"], ["p2", "p3"], "blue", { p0: st("Yone", 5, 4, 10) }),
    game(["p0", "p1"], ["p2", "p4"], "blue", { p0: st("Milio", 0, 3, 30) }),
    game(["p0", "p2"], ["p3", "p4"], "red", { p0: st("Yone", 1, 7, 3) }),
    game(["p0", "p2"], ["p3", "p4"], "red", { p0: st("Annie", 4, 4, 2) }),
    game(["p3", "p2"], ["p0", "p1"], "red"),
    game(["p0", "p2"], ["p3", "p1"], "red"),
  ];

  it("games, wins, losses and K/D/A", () => {
    expect(sum(ms, "p0")).toMatchObject({ g: 7, w: 4, l: 3, k: 20, d: 20, a: 50, kdaGames: 5 });
  });
  it("most played champions, with wins", () => {
    expect(sum(ms, "p0").champs).toEqual([{ name: "Yone", g: 3, w: 2 }, { name: "Milio", g: 1, w: 1 }, { name: "Annie", g: 1, w: 0 }]);
  });
  it("best and worst duo, victim and toughest opponent", () => {
    const s = sum(ms, "p0");
    expect(s.bestDuo).toEqual(v("p1", 4, 4));
    expect(s.worstDuo).toEqual(v("p2", 0, 3));
    expect(s.victim).toEqual(v("p2", 4, 4));
    expect(s.toughest).toEqual(v("p4", 1, 3));
  });
  it("the same from the other side", () => {
    const s = sum(ms, "p2");
    expect(s.toughest).toEqual(v("p1", 0, 5));
    expect(s.victim).toBeNull();
    expect(s.worstDuo).toEqual(v("p3", 0, 3)); // a tie with Tosh: Artur comes first
    expect(s.bestDuo).toBeNull();
  });
  it("leaves out removed players", () => {
    const s = sum(ms, "p0", (id) => id !== "p1");
    expect(s.bestDuo).toBeNull();
    expect(s.worstDuo).toEqual(v("p2", 0, 3));
    expect(s.g).toBe(7);
  });
  it("works without any games, and alone", () => {
    expect(sum([], "p0")).toMatchObject({ g: 0, champs: [], bestDuo: null, worstDuo: null, victim: null, toughest: null });
    expect(sum([game(["p0"], [], "blue")], "p0")).toMatchObject({ g: 1, w: 1, bestDuo: null, victim: null });
    expect(sum(ms, "unknown").g).toBe(0);
  });
});
