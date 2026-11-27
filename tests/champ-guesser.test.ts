import { describe, expect, it } from "vitest";
import {
  MAX_ROUND_POINTS,
  MODE_STEPS,
  champPoints,
  cropRect,
  hueRotate,
  isMatch,
  kMeans,
  normalize,
  pickChampions,
  posterize,
  resolveGuess,
  roundTotal,
  shuffled,
  stepAt,
  suggest,
  timedOut,
  STEP_MS,
  HOLD_MS,
  type Mode,
  BOARD_ID,
  HINT_SPEEDS,
  VS_MAX_WRONG,
  vsAddPlayers,
  vsAllDone,
  vsEnd,
  vsGuess,
  vsIsLastRound,
  vsLobby,
  vsParticipants,
  vsPass,
  vsRanking,
  vsReveal,
  vsSetStep,
  vsSettings,
  vsStartRound,
  vsStatus,
  vsStepAt,
  vsTimedOut,
  boardFor,
  SKIP_WRONG,
  type VsState,
  makeHostSave,
  parseHostSave,
} from "../src/minigames/champ-guesser/logic";
import { CHAMP_GUESSER } from "../src/minigames/champ-guesser";
import { FALLBACK_CHAMPIONS, guessId } from "../src/lib/champions";

const champs = FALLBACK_CHAMPIONS.map((name) => ({ name, id: guessId(name) }));
const byName = (n: string) => champs.find((c) => c.name === n)!;

describe("champ guesser: names", () => {
  it("normalises case, punctuation and spaces", () => {
    expect(normalize("Kai'Sa")).toBe("kaisa");
    expect(normalize("Nunu & Willump")).toBe("nunuwillump");
    expect(normalize(" Dr. Mundo ")).toBe("drmundo");
    expect(normalize("Kaïsa")).toBe("kaisa");
  });
  it("accepts names, ids and nicknames", () => {
    expect(isMatch("kaisa", byName("Kai'Sa"), champs)).toBe(true);
    expect(isMatch("KAI SA", byName("Kai'Sa"), champs)).toBe(true);
    expect(isMatch("nunu", byName("Nunu & Willump"), champs)).toBe(true);
    expect(isMatch("mundo", byName("Dr. Mundo"), champs)).toBe(true);
    expect(isMatch("drmundo", byName("Dr. Mundo"), champs)).toBe(true);
    expect(isMatch("wukong", byName("Wukong"), champs)).toBe(true);
    expect(isMatch("monkeyking", byName("Wukong"), champs)).toBe(true);
    expect(isMatch("j4", byName("Jarvan IV"), champs)).toBe(true);
    expect(isMatch("mf", byName("Miss Fortune"), champs)).toBe(true);
    expect(isMatch("ahri", byName("Akali"), champs)).toBe(false);
  });
  it("tells a wrong champion apart from a non-champion", () => {
    expect(resolveGuess("Ahri", champs)?.name).toBe("Ahri");
    expect(resolveGuess("vi", champs)?.name).toBe("Vi");
    expect(resolveGuess("yi", champs)?.name).toBe("Master Yi");
    expect(resolveGuess("banana", champs)).toBeNull();
    expect(resolveGuess("  ", champs)).toBeNull();
  });
  it("autocompletes prefixes first, then word starts", () => {
    const s = suggest("ka", champs).map((c) => c.name);
    expect(s[0]).toBe("Kai'Sa");
    expect(s.every((n) => normalize(n).includes("ka") || n.split(/\W+/).some((w) => w.toLowerCase().startsWith("ka")))).toBe(true);
    expect(suggest("sin", champs).map((c) => c.name)).toContain("Lee Sin");
    expect(suggest("mundo", champs)[0].name).toBe("Dr. Mundo");
    expect(suggest("", champs)).toEqual([]);
    expect(suggest("a", champs, 3)).toHaveLength(3);
  });
});

describe("champ guesser: scoring", () => {
  const steps = MODE_STEPS.pixel.length;
  it("1000 at the first step, 200 at the last, falling in between", () => {
    expect(champPoints(0, steps, 0, "pixel")).toBe(1000);
    expect(champPoints(steps - 1, steps, 0, "pixel")).toBe(200);
    for (let s = 1; s < steps; s++) expect(champPoints(s, steps, 0, "pixel")).toBeLessThan(champPoints(s - 1, steps, 0, "pixel"));
  });
  it("wrong guesses cost a little, never below the floor", () => {
    expect(champPoints(0, steps, 2, "pixel")).toBe(900);
    expect(champPoints(steps - 1, steps, 50, "pixel")).toBe(50);
  });
  it("Mixed pays more but never above 1000 per champion", () => {
    for (let s = 0; s < steps; s++) {
      expect(champPoints(s, steps, 0, "mixed")).toBeGreaterThanOrEqual(champPoints(s, steps, 0, "pixel"));
      expect(champPoints(s, steps, 0, "mixed")).toBeLessThanOrEqual(1000);
    }
    expect(champPoints(steps - 1, steps, 0, "mixed")).toBe(270);
  });
  it("round total is capped at 5000 and ignores junk", () => {
    expect(roundTotal([1000, 1000, 1000, 1000, 1000])).toBe(MAX_ROUND_POINTS);
    expect(roundTotal([1200, 1000, 1000, 1000, 1000, 1000])).toBe(5000);
    expect(roundTotal([-50, NaN, 300])).toBe(300);
    for (const m of ["pixel", "colours", "mixed"] as Mode[]) expect(roundTotal(Array(5).fill(champPoints(0, 8, 0, m)))).toBeLessThanOrEqual(5000);
  });
  it("steps advance every 2.5 s and time runs out after the hold", () => {
    expect(stepAt(0, 8)).toBe(0);
    expect(stepAt(STEP_MS * 3 + 1, 8)).toBe(3);
    expect(stepAt(1e9, 8)).toBe(7);
    expect(timedOut(8 * STEP_MS + HOLD_MS - 1, 8)).toBe(false);
    expect(timedOut(8 * STEP_MS + HOLD_MS, 8)).toBe(true);
  });
  it("every mode has the same number of steps and gets clearer", () => {
    for (const m of ["pixel", "mixed"] as Mode[]) {
      const cols = MODE_STEPS[m].map((s) => s.cols);
      expect(cols).toEqual([...cols].sort((a, b) => a - b));
    }
    expect(new Set(Object.values(MODE_STEPS).map((s) => s.length)).size).toBe(1);
  });
});

describe("champ guesser: picking", () => {
  it("picks 5 different champions, the same for the same seed", () => {
    const a = pickChampions(champs, 5, 42);
    expect(a).toHaveLength(5);
    expect(new Set(a.map((c) => c.id)).size).toBe(5);
    expect(pickChampions(champs, 5, 42)).toEqual(a);
    expect(pickChampions(champs, 5, 43)).not.toEqual(a);
  });
  it("skips excluded ids and duplicate entries", () => {
    const a = pickChampions(champs, 5, 1);
    const b = pickChampions(champs, 5, 1, a.map((c) => c.id));
    expect(b.some((c) => a.some((x) => x.id === c.id))).toBe(false);
    const dup = [...champs, ...champs];
    expect(shuffled(dup, 9)).toHaveLength(champs.length);
  });
});

describe("champ guesser: image maths", () => {
  const img = (cols: [number, number, number][], each: number) => {
    const px: number[] = [];
    for (const c of cols) for (let i = 0; i < each; i++) px.push(c[0], c[1], c[2], 255);
    return px;
  };
  it("k-means finds the dominant colours, biggest first", () => {
    const px = [...img([[250, 10, 10]], 300), ...img([[10, 10, 250]], 100)];
    const pal = kMeans(px, 2, { seed: 3 });
    expect(pal).toHaveLength(2);
    expect(pal[0]).toMatchObject({ r: 250, g: 10, b: 10 });
    expect(pal[0].weight).toBeCloseTo(0.75);
    expect(pal[1]).toMatchObject({ r: 10, g: 10, b: 250 });
  });
  it("k-means is repeatable, skips transparent pixels and copes with k above the colour count", () => {
    const px = [...img([[0, 0, 0]], 50), ...img([[255, 255, 255]], 50), 1, 2, 3, 0];
    expect(kMeans(px, 5, { seed: 1 })).toEqual(kMeans(px, 5, { seed: 1 }));
    expect(kMeans(px, 5, { seed: 1 })).toHaveLength(2);
    expect(kMeans([], 3)).toEqual([]);
  });
  it("k-means gives where each colour sits", () => {
    // 4x1 image: left half red, right half blue.
    const px = img([[255, 0, 0]], 2).concat(img([[0, 0, 255]], 2));
    const pal = kMeans(px, 2, { seed: 2, width: 4 });
    const red = pal.find((p) => p.r > 200)!;
    const blue = pal.find((p) => p.b > 200)!;
    expect(red.x).toBeCloseTo(0.25);
    expect(blue.x).toBeCloseTo(0.75);
  });
  it("posterize maps pixels to the nearest palette colour", () => {
    const px = [240, 20, 20, 255, 30, 30, 200, 255];
    posterize(px, [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }]);
    expect(px).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });
  it("hue rotation keeps greys and turns red into green", () => {
    expect(hueRotate(255, 0, 0, 120)).toEqual([0, 255, 0]);
    expect(hueRotate(255, 0, 0, 360)).toEqual([255, 0, 0]);
    expect(hueRotate(128, 128, 128, 90)).toEqual([128, 128, 128]);
  });
  it("crops to the aspect, leaning right", () => {
    const c = cropRect(1215, 717, 4 / 3, 0.6);
    expect(c.h).toBe(717);
    expect(c.w).toBe(956);
    expect(c.x).toBe(Math.round((1215 - 956) * 0.6));
    expect(c.x + c.w).toBeLessThanOrEqual(1215);
    const tall = cropRect(308, 560, 4 / 3);
    expect(tall.w).toBe(308);
    expect(tall.y + tall.h).toBeLessThanOrEqual(560);
  });
});

describe("champ guesser: definition", () => {
  it("is one game with a board per picture mode", () => {
    expect(CHAMP_GUESSER).toHaveLength(1);
    const g = CHAMP_GUESSER[0];
    expect(g.id).toBe("champ-guesser");
    expect(g.boards.map((b) => b.id)).toEqual([...Object.values(BOARD_ID), "champ-timed", "champ-skips"]);
    expect(g.boards.map((b) => b.label)).toEqual(["Pixelated", "Colours", "Both", "Timed", "Fewest skips"]);
    for (const b of g.boards.slice(0, 3)) expect(b.maxScore).toBe(MAX_ROUND_POINTS);
    expect(g.boards[4]).toMatchObject({ maxScore: 10, lowerIsBetter: true });
  });
});

describe("champ guesser: versus", () => {
  const IMG = "data:image/png;base64,AAAA";
  const host = { id: "h1", name: "Host" };
  const p1 = { id: "u1", name: "Ann" };
  const p2 = { id: "u2", name: "Ben" };
  const ahri = byName("Ahri");
  const lobby = () => vsAddPlayers(vsLobby({ mode: "pixel", rounds: 3, stepMs: HINT_SPEEDS.normal, hostPlays: true }), [host, p1, p2]);
  const started = () => vsStartRound(lobby(), IMG, true);

  it("lobby: everyone gets a name and 0 points; settings only change in the lobby", () => {
    const s = lobby();
    expect(s.scores).toEqual({ h1: 0, u1: 0, u2: 0 });
    expect(vsAddPlayers(s, [p1])).toBe(s);
    const s2 = vsSettings(s, { mode: "mixed", rounds: 10 });
    expect(s2.mode).toBe("mixed");
    expect(s2.rounds).toBe(10);
    expect(s2.names).toEqual(s.names);
    const r = started();
    expect(vsSettings(r, { rounds: 15 })).toBe(r);
  });

  it("a round starts at step 0 with the picture and a full clock", () => {
    const s = started();
    expect(s).toMatchObject({ phase: "round", round: 1, step: 0, image: IMG, msLeft: s.limit, hits: [], passed: [] });
    expect(s.limit).toBe(8 * HINT_SPEEDS.normal + HOLD_MS);
    expect(vsStepAt(s, HINT_SPEEDS.normal * 2 + 5)).toBe(2);
    expect(vsStepAt(s, 1e9)).toBe(7);
    expect(vsTimedOut(s, s.limit - 1)).toBe(false);
    expect(vsTimedOut(s, s.limit)).toBe(true);
    const s3 = vsSetStep(s, 3, 3 * HINT_SPEEDS.normal, IMG, true);
    expect(s3.step).toBe(3);
    expect(s3.msLeft).toBe(s.limit - 3 * HINT_SPEEDS.normal);
  });

  it("scores like solo: earlier step = more, wrong guesses cost, non-champions are ignored", () => {
    let s = started();
    let r = vsGuess(s, ahri, champs, p1, "ahri", 1200);
    expect(r.result).toBe("right");
    expect(r.points).toBe(champPoints(0, 8, 0, "pixel"));
    s = r.state;
    expect(s.scores.u1).toBe(1000);
    expect(s.hits[0]).toMatchObject({ id: "u1", step: 0, ms: 1200 });
    // A second right guess from the same player does nothing.
    expect(vsGuess(s, ahri, champs, p1, "ahri", 1500).result).toBe("ignored");
    s = vsSetStep(s, 4, 10000, IMG, true);
    expect(vsGuess(s, ahri, champs, p2, "banana", 10000).result).toBe("unknown");
    r = vsGuess(s, ahri, champs, p2, "Akali", 10100);
    expect(r.result).toBe("wrong");
    s = r.state;
    expect(s.wrong.u2).toBe(1);
    r = vsGuess(s, ahri, champs, p2, "AHRI", 11000);
    expect(r.points).toBe(champPoints(4, 8, 1, "pixel"));
    expect(r.points).toBeLessThan(1000);
    expect(r.state.hits.map((h) => h.id)).toEqual(["u1", "u2"]);
  });

  it("too many wrong names puts a player out for the round", () => {
    let s = started();
    const wrongs = champs.filter((c) => c.id !== ahri.id).slice(0, VS_MAX_WRONG);
    for (const c of wrongs) s = vsGuess(s, ahri, champs, p1, c.name, 100).state;
    expect(vsStatus(s, "u1")).toBe("out");
    expect(vsGuess(s, ahri, champs, p1, "Ahri", 200).result).toBe("ignored");
    expect(s.scores.u1).toBe(0);
  });

  it("the round is done when everyone still here guessed or passed", () => {
    let s = started();
    const ids = vsParticipants([host, p1, p2], host.id, true);
    expect(ids).toEqual(["h1", "u1", "u2"]);
    expect(vsParticipants([host, p1, p2], host.id, false)).toEqual(["u1", "u2"]);
    s = vsGuess(s, ahri, champs, p1, "ahri", 100).state;
    s = vsPass(s, "u2");
    expect(vsAllDone(s, ids)).toBe(false);
    expect(vsAllDone(s, ["u1", "u2"])).toBe(true);
    s = vsPass(s, "h1");
    expect(vsAllDone(s, ids)).toBe(true);
    expect(vsAllDone(s, [])).toBe(false);
  });

  it("reveal, history, next round and end", () => {
    let s = vsGuess(started(), ahri, champs, p2, "ahri", 2600).state;
    s = vsSetStep(s, 1, 2600, IMG, true);
    s = vsReveal(s, ahri);
    expect(s.phase).toBe("reveal");
    expect(s.image).toBeNull();
    expect(s.reveal).toMatchObject({ round: 1, name: "Ahri", id: ahri.id });
    expect(s.reveal!.hits.map((h) => h.id)).toEqual(["u2"]);
    expect(s.history).toHaveLength(1);
    expect(vsReveal(s, ahri)).toBe(s);
    s = vsStartRound(s, IMG, true);
    expect(s).toMatchObject({ round: 2, hits: [], passed: [], wrong: {}, reveal: null });
    expect(s.scores.u2).toBe(1000);
    s = vsReveal(vsStartRound(vsReveal(s, byName("Annie")), IMG, true), byName("Garen"));
    expect(vsIsLastRound(s)).toBe(true);
    s = vsEnd(s);
    expect(s.phase).toBe("end");
    expect(s.history.map((h) => h.name)).toEqual(["Ahri", "Annie", "Garen"]);
  });

  it("ranks by score with shared places", () => {
    let s = lobby();
    s = { ...s, scores: { h1: 500, u1: 900, u2: 500 } };
    expect(vsRanking(s).map((r) => [r.name, r.place])).toEqual([
      ["Ann", 1],
      ["Ben", 2],
      ["Host", 2],
    ]);
    expect(vsRanking({ ...s, scores: { h1: 0, u1: 0, u2: 0 } }, ["u1"]).map((r) => r.id)).toEqual(["u1"]);
  });

  it("the public state never contains the answer before the reveal", () => {
    const answer = byName("Kai'Sa");
    const leaks = (s: VsState) => {
      const json = JSON.stringify(s).toLowerCase();
      return json.includes(answer.name.toLowerCase()) || json.includes(answer.id.toLowerCase());
    };
    const states: VsState[] = [];
    let s = lobby();
    states.push(s);
    s = vsStartRound(s, IMG, true);
    states.push(s);
    for (let step = 1; step < 8; step++) {
      s = vsSetStep(s, step, step * 2500, IMG, true);
      states.push(s);
      // Wrong guesses, nonsense, the right answer and passes on the way.
      s = vsGuess(s, answer, champs, p2, "Ahri", step * 2500).state;
      states.push(s);
      s = vsGuess(s, answer, champs, p2, "kai'sa is it", step * 2500).state;
      states.push(s);
    }
    s = vsGuess(s, answer, champs, p1, "kaisa", 20000).state;
    states.push(s);
    s = vsPass(s, "h1");
    states.push(s);
    for (const st of states) {
      expect(st.phase === "round" || st.phase === "lobby").toBe(true);
      expect(st.reveal).toBeNull();
      expect(leaks(st)).toBe(false);
    }
    // Ending mid-round keeps it secret too.
    expect(leaks(vsEnd(s))).toBe(false);
    // After the reveal it's allowed.
    expect(leaks(vsReveal(s, answer))).toBe(true);
  });
});

describe("champ guesser: host refresh save", () => {
  const IMG = "data:image/png;base64,AAAA";
  const ahri = byName("Ahri");
  const base = () => vsAddPlayers(vsLobby({ mode: "colours", rounds: 10, stepMs: HINT_SPEEDS.fast, hostPlays: false }), [{ id: "u1", name: "Ann" }]);

  it("round-trips a running round without the picture", () => {
    let vs = vsStartRound(base(), IMG, false);
    vs = vsGuess(vs, ahri, champs, { id: "u1", name: "Ann" }, "Akali", 900).state;
    const queue = shuffled(champs, 5);
    const raw = JSON.stringify(makeHostSave(vs, queue, 3, ahri, 140, 4321.6));
    expect(raw).not.toContain("base64");
    const back = parseHostSave(raw)!;
    expect(back.vs).toEqual({ ...vs, image: null });
    expect(back.queue).toEqual(queue.map((c) => ({ name: c.name, id: c.id })));
    expect(back).toMatchObject({ pos: 3, answer: { name: "Ahri", id: ahri.id }, hue: 140, elapsed: 4322 });
  });

  it("keeps a lobby and an ended game", () => {
    expect(parseHostSave(JSON.stringify(makeHostSave(base(), [], 0, null, 0, 0)))?.vs.phase).toBe("lobby");
    const ended = vsEnd(vsReveal(vsStartRound(base(), IMG, false), ahri));
    expect(parseHostSave(JSON.stringify(makeHostSave(ended, champs, 1, null, 0, 0)))?.vs.history).toHaveLength(1);
  });

  it("rejects junk and a round without its champion", () => {
    expect(parseHostSave(null)).toBeNull();
    expect(parseHostSave("{")).toBeNull();
    expect(parseHostSave("[]")).toBeNull();
    expect(parseHostSave(JSON.stringify({ v: 2 }))).toBeNull();
    const round = makeHostSave(vsStartRound(base(), IMG, false), champs, 1, ahri, 0, 0);
    expect(parseHostSave(JSON.stringify({ ...round, answer: null }))).toBeNull();
    expect(parseHostSave(JSON.stringify({ ...round, vs: { ...round.vs, mode: "nope" } }))).toBeNull();
    expect(parseHostSave(JSON.stringify({ ...round, queue: [1, 2] }))).toBeNull();
    expect(parseHostSave(JSON.stringify({ ...round, pos: 9999 }))?.pos).toBe(champs.length);
  });
});

describe("champ guesser: rules (timed, fewest skips)", () => {
  const IMG = "data:image/png;base64,AAAA";
  const host = { id: "h1", name: "Host" };
  const p1 = { id: "u1", name: "Ann" };
  const p2 = { id: "u2", name: "Ben" };
  const ahri = byName("Ahri");
  const skipsLobby = () => vsAddPlayers(vsLobby({ mode: "pixel", rules: "skips", rounds: 10, stepMs: HINT_SPEEDS.normal, hostPlays: false }), [host, p1, p2]);

  it("solo boards: classic per picture mode, timed and skips one board each", () => {
    expect(boardFor("colours", "classic")).toBe(BOARD_ID.colours);
    expect(boardFor("mixed", "timed")).toBe("champ-timed");
    expect(boardFor("pixel", "skips")).toBe("champ-skips");
  });

  it("skips rules: no clock, and fewer wrong names before you're out", () => {
    const s = vsStartRound(skipsLobby(), IMG, true);
    expect(vsTimedOut(s, 1e9)).toBe(false);
    let x = s;
    for (let i = 0; i < SKIP_WRONG; i++) x = vsGuess(x, ahri, champs, p1, "Annie", 1000).state;
    expect(vsStatus(x, "u1")).toBe("out");
  });

  it("skips rules: everyone who didn't get it gets a skip; fewest skips ranks first, points break ties", () => {
    let s = vsStartRound(skipsLobby(), IMG, true);
    s = vsGuess(s, ahri, champs, p1, "Ahri", 1000).state;
    s = vsPass(s, "u2");
    s = vsReveal(s, ahri, ["u1", "u2"]);
    expect(s.skips).toMatchObject({ u1: 0, u2: 1 });
    expect(s.reveal?.skipped).toEqual(["u2"]);
    expect(vsRanking(s).map((r) => r.id).slice(0, 2)).toEqual(["u1", "h1"]);
    // Classic rooms never count skips.
    const c = vsReveal(vsPass(vsStartRound(vsLobby({ mode: "pixel", rounds: 3, stepMs: 2500, hostPlays: false }), IMG, true), "u2"), ahri, ["u2"]);
    expect(c.skips).toEqual({});
  });
});
