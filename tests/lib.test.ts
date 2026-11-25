import { describe, expect, it, beforeAll } from "vitest";
import { compute, rating, rivalries, rivalryVerb, badges, records, weeklyAwards, bountyTarget, expected, ratingChange, winChanceVs, FF_PENALTY } from "../src/lib/stats";
import { makeTeams, snakeOrder, sitPriority, rerollsLeft, canDraft, rerollKey, defaultSize, maxSize, captainPick, captainUndo, teamKey } from "../src/lib/teams";
import { dodgeStatus } from "../src/lib/dodges";
import { uggUrl, mobaUrl, guessId } from "../src/lib/champions";
import { monthKey, dayKey, seeded, HOUR, DAY } from "../src/lib/util";
import { DEFAULT_SETTINGS, type Match, type Player, type Side, type LiveGame } from "../src/lib/types";
import { sampleData, emptyData, ROSTER } from "../src/data/sample";

const players: Player[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => ({ id, name: id.toUpperCase(), active: true, createdAt: 0 }));
const active = (id: string) => players.some((p) => p.id === id && p.active);
let t0 = Date.UTC(2026, 9, 1, 18);
const match = (blue: string[], red: string[], winner: Side, extra: Partial<Match> = {}): Match => ({
  id: Math.random().toString(36),
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

describe("ratings", () => {
  const base = { games: 20, streak: 0, endedBounty: false, surrendered: false };
  it("starts at 1000; an even first game moves 20 points (placement K=40)", () => {
    const c = compute([match(["a"], ["b"], "blue")], players);
    expect(rating(c, "a")).toBe(1020);
    expect(rating(c, "b")).toBe(980);
    expect(rating(c, "c")).toBe(1000);
  });
  it("after placement an even game moves 16 points (K=32)", () => {
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true }).delta).toBe(16);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: false }).delta).toBe(-16);
  });
  it("the favourite wins less and the underdog loses less", () => {
    const favWins = ratingChange({ ...base, rating: 1100, opponents: [1000], won: true }).delta;
    const dogWins = ratingChange({ ...base, rating: 1000, opponents: [1100], won: true }).delta;
    const dogLoses = ratingChange({ ...base, rating: 1000, opponents: [1100], won: false }).delta;
    const favLoses = ratingChange({ ...base, rating: 1100, opponents: [1000], won: false }).delta;
    expect(favWins).toBe(12);
    expect(dogWins).toBe(20);
    expect(dogLoses).toBe(-12);
    expect(favLoses).toBe(-20);
  });
  it("compares each player with every opponent, not team averages", () => {
    // Same team, different ratings: the stronger player gains less for the same win.
    const strong = ratingChange({ ...base, rating: 1200, opponents: [1000, 1000], won: true }).delta;
    const weak = ratingChange({ ...base, rating: 900, opponents: [1000, 1000], won: true }).delta;
    expect(strong).toBeLessThan(weak);
    expect(winChanceVs(1000, [900, 1100])).toBeCloseTo((expected(1000, 900) + expected(1000, 1100)) / 2);
  });
  it("surrendering costs 5 extra, only for the losers", () => {
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: false, surrendered: true }).delta).toBe(-21);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true, surrendered: true }).delta).toBe(16);
    const c = compute([match(["a"], ["b"], "blue", { surrender: "ff" })], players);
    expect(rating(c, "b")).toBe(1000 - 20 - FF_PENALTY);
  });
  it("gives a small win streak bonus and a bounty bonus", () => {
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true, streak: 1 }).streak).toBe(0);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true, streak: 2 }).streak).toBe(1);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true, streak: 9 }).streak).toBe(3);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1000], won: true, endedBounty: true }).bounty).toBe(3);
  });
  it("every game counts at least 3 points", () => {
    expect(ratingChange({ ...base, rating: 1600, opponents: [1000], won: true }).delta).toBe(3);
    expect(ratingChange({ ...base, rating: 1000, opponents: [1600], won: false }).delta).toBe(-3);
  });
  it("records the change per game and recalculates from the match list", () => {
    const ms = [match(["a"], ["b"], "blue"), match(["a"], ["b"], "blue")];
    const c = compute(ms, players);
    expect(c.changes[ms[0].id].a.delta).toBe(20);
    expect(c.changes[ms[0].id].b.delta).toBe(-20);
    expect(rating(compute(ms.slice(0, 1), players), "a")).toBe(1020);
  });
});

describe("streaks, bounties, badges", () => {
  it("tracks streaks and bounty claims", () => {
    const ms = [1, 2, 3].map(() => match(["a"], ["b"], "blue"));
    let c = compute(ms, players);
    expect(c.st.a.streak).toBe(3);
    expect(c.st.b.streak).toBe(-3);
    expect(bountyTarget(c, ["a", "b"])).toBe("a");
    ms.push(match(["a"], ["b"], "red"));
    c = compute(ms, players);
    expect(c.st.b.bountiesClaimed).toBe(1);
    expect(badges(c.st.b).map((x) => x.title)).toContain("Bounty hunter");
  });
  it("awards on fire, giant slayer, champion pool and game milestones", () => {
    const ms: Match[] = [];
    for (let i = 0; i < 15; i++) ms.push(match(["a"], ["b"], "blue"));
    // c beats strong a as an underdog
    ms.push(match(["c"], ["a"], "blue"));
    const champs = ["Ahri", "Lux", "Zed", "Jinx", "Sona", "Ezreal", "Garen", "Annie"];
    champs.forEach((ch) => ms.push(match(["d"], ["e"], "blue", { stats: { d: { champion: ch } } })));
    for (let i = 0; i < 10; i++) ms.push(match(["d"], ["e"], "red"));
    const c = compute(ms, players);
    expect(badges(c.st.a).map((x) => x.title)).toContain("On fire");
    expect(badges(c.st.c).map((x) => x.title)).toContain("Giant slayer");
    const d = badges(c.st.d).map((x) => x.title);
    expect(d).toContain("Champion pool");
    expect(d).toContain("On fire");
    expect(badges(c.st.e).map((x) => x.title)).not.toContain("25 games");
  });
});

describe("rivalries", () => {
  it("names the verb by streak length", () => {
    expect(rivalryVerb(3)).toBe("has the upper hand on");
    expect(rivalryVerb(4)).toBe("is dominating");
    expect(rivalryVerb(5)).toBe("is dominating");
    expect(rivalryVerb(6)).toBe("owns");
  });
  it("only counts opposite sides and needs 3 in a row", () => {
    const ms = [match(["a", "c"], ["b", "d"], "blue"), match(["a"], ["b"], "blue"), match(["a", "b"], ["c", "d"], "blue")];
    let r = rivalries(compute(ms, players), active);
    expect(r.find((f) => f.a === "a" && f.b === "b")).toBeUndefined();
    ms.push(match(["b"], ["a"], "red"));
    r = rivalries(compute(ms, players), active);
    const ab = r.find((f) => f.a === "a" && f.b === "b")!;
    expect(ab.leader).toBe("a");
    expect(ab.streak).toBe(3);
  });
});

describe("records, awards, monthly champions", () => {
  it("records need K/D/A, best KDA needs 3 games", () => {
    const k = (kills: number, deaths: number, assists: number) => ({ kills, deaths, assists });
    const ms = [
      match(["a"], ["b"], "blue", { stats: { a: k(12, 2, 5), b: k(3, 9, 4) } }),
      match(["a"], ["b"], "blue", { stats: { a: k(8, 1, 5), b: k(20, 9, 4) } }),
    ];
    let r = records(ms, 0, active);
    expect(r.bestGame).toMatchObject({ id: "b", k: 20 });
    expect(r.bestKda).toBeUndefined();
    ms.push(match(["a"], ["b"], "red", { stats: { a: k(1, 1, 1), b: k(1, 1, 1) } }));
    r = records(ms, 0, active);
    expect(r.bestKda?.id).toBe("a");
    expect(r.mostWins?.id).toBe("a");
  });
  it("weekly MVP needs 2 games", () => {
    const now = t0 + HOUR * 3;
    const aw = weeklyAwards([match(["a"], ["b"], "blue")], now, active);
    expect(aw.mvp).toBeUndefined();
  });
  it("monthly champion needs 3 games and uses Berlin months", () => {
    // 31 Oct 23:30 UTC is already 1 Nov in Berlin (CET, UTC+1)
    expect(monthKey(Date.UTC(2026, 9, 31, 23, 30))).toBe("2026-11");
    expect(dayKey(Date.UTC(2026, 9, 31, 22, 30))).toBe("2026-10-31");
    t0 = Date.UTC(2026, 6, 1, 18);
    const ms = [match(["a"], ["b"], "blue"), match(["a"], ["b"], "blue"), match(["a"], ["c"], "blue"), match(["b"], ["c"], "blue")];
    const c = compute(ms, players, Date.UTC(2026, 10, 1));
    expect(c.monthly[0]).toMatchObject({ month: "2026-07", id: "a", w: 3, current: false });
    expect(c.st.a.crowns).toBe(1);
    const cur = compute(ms, players, Date.UTC(2026, 6, 20));
    expect(cur.monthly[0].current).toBe(true);
    expect(cur.st.a.crowns).toBe(0);
  });
});

describe("team generator", () => {
  const ratingOf = () => 1000;
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  it("default size is the biggest up to 3v3", () => {
    expect(defaultSize(9)).toBe(3);
    expect(maxSize(9)).toBe(4);
    expect(defaultSize(5)).toBe(2);
    expect(defaultSize(2)).toBe(1);
  });
  it("makes full, disjoint teams and sits out the rest", () => {
    for (let s = 1; s < 50; s++) {
      const L = makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: {}, rng: seeded(s) });
      expect(L.blue).toHaveLength(3);
      expect(L.red).toHaveLength(3);
      expect(L.sitOut).toHaveLength(1);
      expect(new Set([...L.blue, ...L.red, ...L.sitOut]).size).toBe(7);
    }
  });
  it("whoever sat out plays next (fair rotation)", () => {
    const ms = [match(["a", "b", "c"], ["d", "e", "f"], "blue", { sitOut: ["g"] })];
    const pr = sitPriority(ms, ids);
    expect(pr.g).toBe(1);
    expect(pr.a).toBe(0);
    for (let s = 1; s < 30; s++) {
      const L = makeTeams({ selected: ids, size: 3, style: "random", ratingOf, sitPriority: pr, rng: seeded(s) });
      expect(L.sitOut).not.toContain("g");
    }
  });
  it("keep apart always splits the pair", () => {
    for (let s = 1; s < 40; s++) {
      const L = makeTeams({ selected: ids.slice(0, 6), size: 3, style: "random", ratingOf, sitPriority: {}, apart: ["a", "b"], rng: seeded(s) });
      expect(L.blue.includes("a")).not.toBe(L.blue.includes("b"));
    }
  });
  it("avoids the last game's teams and never repeats the current draft", () => {
    const sel = ["a", "b", "c", "d"];
    const last = { blue: ["a", "b"], red: ["c", "d"] };
    for (let s = 1; s < 40; s++) {
      const L = makeTeams({ selected: sel, size: 2, style: "random", ratingOf, sitPriority: {}, avoid: last, rng: seeded(s) });
      expect(teamKey(L.blue, L.red)).not.toBe(teamKey(last.blue, last.red));
      const R = makeTeams({ selected: sel, size: 2, style: "random", ratingOf, sitPriority: {}, current: L, rng: seeded(s + 99) });
      expect(teamKey(R.blue, R.red)).not.toBe(teamKey(L.blue, L.red));
    }
  });
  it("balanced picks the closest split", () => {
    const r: Record<string, number> = { a: 1400, b: 1300, c: 900, d: 800 };
    for (let s = 1; s < 20; s++) {
      const L = makeTeams({ selected: ["a", "b", "c", "d"], size: 2, style: "balanced", ratingOf: (id) => r[id], sitPriority: {}, rng: seeded(s) });
      // a must be with d or c, never with b
      expect(L.blue.includes("a")).not.toBe(L.blue.includes("b"));
    }
  });
  it("captains: snake order, lower rated captain picks first, undo works", () => {
    expect(snakeOrder(5, "blue")).toEqual(["blue", "red", "red", "blue", "blue"]);
    const r: Record<string, number> = { a: 1200, b: 900 };
    const L = makeTeams({ selected: ids.slice(0, 6), size: 3, style: "captains", ratingOf: (id) => r[id] ?? 1000, sitPriority: {}, apart: ["a", "b"], rng: seeded(3) });
    expect([L.blue[0], L.red[0]].sort()).toEqual(["a", "b"]);
    const lowSide = L.blue[0] === "b" ? "blue" : "red";
    expect(L.captains!.order[0]).toBe(lowSide);
    const first = L.captains!.pool[0];
    const P1 = captainPick(L, first);
    expect(P1[lowSide]).toContain(first);
    const U = captainUndo(P1);
    expect(U[lowSide]).not.toContain(first);
    expect(U.captains!.pool).toContain(first);
    let X: LiveGame = L;
    while (X.captains!.i < X.captains!.order.length) X = captainPick(X, X.captains!.pool[0]);
    expect(X.blue).toHaveLength(3);
    expect(X.red).toHaveLength(3);
  });
  it("reroll limit: 'Reroll · 2 left' after the first draft, then 1, then none", () => {
    expect(rerollsLeft(2, 0)).toBe(2);
    expect(rerollsLeft(2, 1)).toBe(2);
    expect(rerollsLeft(2, 2)).toBe(1);
    expect(rerollsLeft(2, 3)).toBe(0);
    expect(canDraft(2, 3)).toBe(false);
    expect(canDraft(0, 1)).toBe(false);
    expect(rerollsLeft(-1, 9)).toBe(Infinity);
    // toggling a player off and on gives the same key, so the count is kept
    expect(rerollKey(["b", "a", "c"], 1)).toBe(rerollKey(["a", "c", "b"], 1));
  });
});

describe("dodge rule (whole night, per side)", () => {
  const S = { ...DEFAULT_SETTINGS };
  const base = Date.UTC(2026, 10, 20, 18);
  const m = (h: number, dodges: Side[] = []): Match => ({
    id: String(h),
    playedAt: base + h * HOUR,
    mode: 2,
    blue: ["a", "b"],
    red: ["c", "d"],
    winner: "blue",
    stats: {},
    sitOut: [],
    dodges: dodges.map((side) => ({ playerId: "a", champion: "Yuumi", side, at: 0 })),
  });
  it("first game ever: fresh night", () => {
    const d = dodgeStatus([], S, base, null);
    expect(d.freshNight).toBe(true);
    expect(d.left).toEqual({ blue: 2, red: 2 });
  });
  it("12h after the last game: fresh night with full dodges", () => {
    const d = dodgeStatus([m(0, ["blue", "blue"])], S, base + 12 * HOUR, null);
    expect(d.freshNight).toBe(true);
    expect(d.left).toEqual({ blue: 2, red: 2 });
  });
  it("dodges are shared across the whole night", () => {
    const ms = [m(-20, ["red"]), m(0, ["blue"]), m(0.5, ["blue", "red"])];
    const d = dodgeStatus(ms, S, base + HOUR, null);
    expect(d.freshNight).toBe(false);
    expect(d.used).toEqual({ blue: 2, red: 1 }); // the red dodge 20h ago belongs to an earlier night
    expect(d.left).toEqual({ blue: 0, red: 1 });
    expect(d.untilFresh / HOUR).toBeCloseTo(11.5);
  });
  it("counts dodges from the running game", () => {
    const live = { phase: "select", dodgeLog: [{ side: "red" }] } as unknown as LiveGame;
    const d = dodgeStatus([m(0)], S, base + HOUR, live);
    expect(d.left).toEqual({ blue: 2, red: 1 });
  });
  it("can be switched off", () => {
    expect(dodgeStatus([], { ...S, dodgesPerTeam: 0 }, base, null).off).toBe(true);
  });
});

describe("build links", () => {
  it("formats tricky names", () => {
    expect(uggUrl("Wukong")).toBe("https://u.gg/lol/champions/aram-mayhem/wukong-aram-mayhem");
    expect(uggUrl("Nunu & Willump")).toBe("https://u.gg/lol/champions/aram-mayhem/nunu-aram-mayhem");
    expect(uggUrl("Kai'Sa")).toBe("https://u.gg/lol/champions/aram-mayhem/kaisa-aram-mayhem");
    expect(uggUrl("Dr. Mundo")).toBe("https://u.gg/lol/champions/aram-mayhem/drmundo-aram-mayhem");
    expect(uggUrl("Renata Glasc")).toBe("https://u.gg/lol/champions/aram-mayhem/renata-aram-mayhem");
    expect(uggUrl("Bel'Veth")).toBe("https://u.gg/lol/champions/aram-mayhem/belveth-aram-mayhem");
    expect(mobaUrl("Dr. Mundo")).toBe("https://mobalytics.gg/lol/champions/dr-mundo/mayhem-builds");
    expect(mobaUrl("Kai'Sa")).toBe("https://mobalytics.gg/lol/champions/kaisa/mayhem-builds");
    expect(mobaUrl("Nunu & Willump")).toBe("https://mobalytics.gg/lol/champions/nunu/mayhem-builds");
    expect(mobaUrl("Miss Fortune")).toBe("https://mobalytics.gg/lol/champions/miss-fortune/mayhem-builds");
    expect(guessId("Wukong")).toBe("MonkeyKing");
    expect(guessId("Jarvan IV")).toBe("JarvanIV");
  });
});

describe("data", () => {
  beforeAll(() => {
    // minimal localStorage for the store
    const mem: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => void (mem[k] = v),
      removeItem: (k: string) => void delete mem[k],
      clear: () => {},
      key: () => null,
      length: 0,
    };
  });
  it("launch data has our real players and no games", () => {
    const d = emptyData();
    expect(d.players.map((p) => p.name)).toEqual(ROSTER);
    expect(d.matches).toHaveLength(0);
    expect(ROSTER).toHaveLength(10);
  });
  it("sample data is consistent", () => {
    const d = sampleData();
    for (const m of d.matches) {
      expect(m.blue.length).toBe(m.red.length);
      expect(new Set([...m.blue, ...m.red]).size).toBe(m.blue.length * 2);
    }
  });
  it("a live game is saved only once, and removed players stay in history", async () => {
    const { LocalStore } = await import("../src/data/store");
    const s = new LocalStore(false);
    const L = makeTeams({ selected: ["p0", "p1"], size: 1, style: "random", ratingOf: () => 1000, sitPriority: {} });
    await s.setLive({ ...L, phase: "result" });
    const [a, b] = await Promise.all([s.saveResult(L.id, "blue"), s.saveResult(L.id, "red")]);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(s.getState().data.matches).toHaveLength(1);
    await s.removePlayer("p0");
    expect(s.getState().data.players.find((p) => p.id === "p0")?.active).toBe(false);
    expect(s.getState().data.matches[0].blue.concat(s.getState().data.matches[0].red)).toContain("p0");
    await expect(s.addPlayer("nick")).rejects.toThrow(/already/);
    const p = await s.addPlayer("Samu"); // removed name can be reused
    expect(p.name).toBe("Samu");
    const json = s.exportBackup();
    await s.deleteMatch(s.getState().data.matches[0].id);
    await s.restoreBackup(json);
    expect(s.getState().data.matches).toHaveLength(1);
    await expect(s.restoreBackup("{}")).rejects.toThrow();
  });
  it("time helpers", () => {
    expect(DAY).toBe(24 * HOUR);
  });
});
