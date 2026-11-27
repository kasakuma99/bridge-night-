import { describe, expect, it } from "vitest";
import {
  ACCEPT_TOTAL_MAX,
  ANSWER_GRACE_MS,
  CATEGORY_IDS,
  DEFAULT_SETUP,
  QUESTION_MAX,
  SOLO_MAX,
  answerMatches,
  categoryCounts,
  choiceKey,
  countdownLeft,
  draftFromQuestion,
  editDistance,
  emptyDraft,
  enabledCategories,
  filterQuestions,
  isControlTarget,
  isCorrect,
  isPlayable,
  isTypingTarget,
  markSeen,
  mergeQuestions,
  normalizeAnswer,
  parseSavedHost,
  parseSeen,
  parseSetup,
  pickQuestions,
  podium,
  rankScores,
  rng,
  roundPlan,
  shuffle,
  shuffleChoices,
  soloTotal,
  speedPoints,
  unseenCount,
  validateDraft,
  vsAddPlayers,
  vsAllAnswered,
  vsAnswer,
  vsCreate,
  vsEnd,
  vsNext,
  vsOverride,
  vsPublic,
  vsResume,
  vsReveal,
  vsSkip,
  vsStart,
  type QuestionDraft,
} from "../src/minigames/trivia/logic";
import { triviaDefs } from "../src/minigames/trivia";
import { QUESTIONS } from "../src/minigames/trivia/questions";
import { TRIVIA_CATEGORIES, type TriviaQuestion } from "../src/minigames/trivia/types";

const Q = (id: string, category: TriviaQuestion["category"], difficulty: 1 | 2 | 3, withChoices = true): TriviaQuestion => ({
  id,
  category,
  topic: "test",
  difficulty,
  question: `Question ${id}?`,
  answer: `ans-${id}`,
  ...(withChoices ? { choices: [`w1-${id}`, `ans-${id}`, `w2-${id}`, `w3-${id}`] as [string, string, string, string] } : {}),
});

const FIXTURE: TriviaQuestion[] = [
  Q("league-0001", "league", 1),
  Q("league-0002", "league", 2),
  Q("league-0003", "league", 3, false),
  Q("league-0004", "league", 1),
  Q("general-0001", "general", 1),
  Q("general-0002", "general", 2, false),
  Q("general-0003", "general", 3),
  Q("general-0004", "general", 2),
];

describe("trivia def", () => {
  it("has one solo board with the right max score", () => {
    expect(triviaDefs).toHaveLength(1);
    expect(triviaDefs[0].id).toBe("trivia-night");
    expect(triviaDefs[0].boards).toEqual([{ id: "trivia-solo", label: "Trivia", maxScore: 10000, scoreLabel: "points" }]);
    expect(SOLO_MAX).toBe(10000);
  });

  it("every built-in question is playable with a unique id", () => {
    expect(QUESTIONS.every(isPlayable)).toBe(true);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});

describe("trivia question bank", () => {
  // The topic is shown while a question is open, and the question text is too: neither may give the answer away.
  it("no built-in question shows its answer in its topic or question text", () => {
    const leaks = QUESTIONS.filter((q) => {
      const ans = q.answer.toLowerCase();
      if (ans.length < 3) return false;
      const word = new RegExp(`\\b${ans.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      return q.topic.toLowerCase().includes(ans) || word.test(q.question.toLowerCase());
    }).map((q) => q.id);
    expect(leaks).toEqual([]);
  });
});

describe("trivia filtering", () => {
  const all = { categories: CATEGORY_IDS, difficulty: "any" as const };

  it("filters by several categories and difficulty", () => {
    expect(filterQuestions(FIXTURE, all)).toHaveLength(8);
    expect(filterQuestions(FIXTURE, { categories: ["league"], difficulty: "any" }).map((q) => q.id)).toEqual(["league-0001", "league-0002", "league-0003", "league-0004"]);
    expect(filterQuestions(FIXTURE, { categories: ["general", "music"], difficulty: 2 }).map((q) => q.id)).toEqual(["general-0002", "general-0004"]);
    expect(filterQuestions(FIXTURE, { ...all, difficulty: 1 })).toHaveLength(3);
    expect(filterQuestions(FIXTURE, { categories: [], difficulty: "any" })).toEqual([]);
    expect(filterQuestions([], all)).toEqual([]);
  });

  it("drops disabled categories even when picked", () => {
    expect(filterQuestions(FIXTURE, all, ["league"]).every((q) => q.category === "general")).toBe(true);
    expect(filterQuestions(FIXTURE, { categories: ["league"], difficulty: "any" }, ["league"])).toEqual([]);
    expect(enabledCategories(["league", "music"])).toEqual(CATEGORY_IDS.filter((c) => c !== "league" && c !== "music"));
    expect(enabledCategories([])).toEqual(TRIVIA_CATEGORIES.map((c) => c.id));
  });

  it("counts per category for the difficulty", () => {
    const c = categoryCounts(FIXTURE, "any");
    expect(c.league).toBe(4);
    expect(c.general).toBe(4);
    expect(c.music).toBe(0);
    expect(categoryCounts(FIXTURE, 2).general).toBe(2);
    expect(categoryCounts(FIXTURE, "any", ["general"]).general).toBe(0);
  });

  it("merges custom questions after the built-in ones, without duplicates or broken ones", () => {
    const custom: TriviaQuestion[] = [
      { ...Q("custom-1", "music", 1), question: "Custom?" },
      { ...Q("league-0001", "music", 1) }, // id clash: built-in wins
      { ...Q("custom-2", "music", 1), answer: "not in choices" },
      { ...Q("custom-3", "music", 1, false), question: "  " },
      { ...Q("custom-4", "nope" as TriviaQuestion["category"], 1) },
    ];
    const merged = mergeQuestions(FIXTURE, custom);
    expect(merged.map((q) => q.id)).toEqual([...FIXTURE.map((q) => q.id), "custom-1"]);
    expect(merged.find((q) => q.id === "league-0001")!.category).toBe("league");
    expect(filterQuestions(merged, { categories: ["music"], difficulty: "any" }).map((q) => q.id)).toEqual(["custom-1"]);
    expect(filterQuestions(merged, { categories: ["music"], difficulty: "any" }, ["music"])).toEqual([]);
  });
});

describe("trivia answer matching", () => {
  it("normalizes case, accents, punctuation, articles and number words", () => {
    expect(normalizeAnswer("  The Beatles! ")).toBe("beatles");
    expect(normalizeAnswer("Kai'Sa")).toBe("kaisa");
    expect(normalizeAnswer("Pokémon")).toBe("pokemon");
    expect(normalizeAnswer("Rock & Roll")).toBe("rock and roll");
    expect(normalizeAnswer("Seven")).toBe("7");
    expect(normalizeAnswer("Øresund")).toBe("oresund");
    expect(normalizeAnswer("A")).toBe("a");
  });

  it("edit distance counts swaps as one and stops early", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abcd", "abdc")).toBe(1);
    expect(editDistance("same", "same")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("aaaaaaaa", "bbbbbbbb", 2)).toBe(3);
  });

  it("forgives small typos only in longer answers", () => {
    expect(answerMatches("Tibbbers", "Tibbers")).toBe(true);
    expect(answerMatches("Heimerdigner", "Heimerdinger")).toBe(true);
    expect(answerMatches("Heimerdnigr", "Heimerdinger")).toBe(true); // 2 typos, 12 letters
    expect(answerMatches("Yone", "Yane")).toBe(false); // short: exact only
    expect(answerMatches("Jinx", "Jinx")).toBe(true);
    expect(answerMatches("Twisted Fate", "twistedfate")).toBe(true);
    expect(answerMatches("Something else", "Tibbers")).toBe(false);
    expect(answerMatches("", "Tibbers")).toBe(false);
  });

  it("never forgives a different number", () => {
    expect(answerMatches("2008", "2009")).toBe(false);
    expect(answerMatches("Season 11", "Season 10")).toBe(false);
    expect(answerMatches("Seasn 10", "Season 10")).toBe(true);
    expect(answerMatches("seven", "7")).toBe(true);
  });

  it("checks open questions against the accept list and choices exactly", () => {
    const open: TriviaQuestion = { ...Q("x", "geography", 1, false), answer: "United Kingdom", accept: ["UK", "Great Britain"] };
    expect(isCorrect(open, "uk")).toBe(true);
    expect(isCorrect(open, "great britian")).toBe(true);
    expect(isCorrect(open, "the united kingdom")).toBe(true);
    expect(isCorrect(open, "France")).toBe(false);
    expect(isCorrect(open, "   ")).toBe(false);
    const mc = FIXTURE[0];
    expect(isCorrect(mc, "ans-league-0001")).toBe(true);
    expect(isCorrect(mc, "w1-league-0001")).toBe(false);
    expect(isCorrect(mc, "ans-league-0002")).toBe(false);
  });

  it("maps A-D and 1-4 to choices", () => {
    expect(["a", "B", "c", "D", "1", "4", "5", "e"].map(choiceKey)).toEqual([0, 1, 2, 3, 0, 3, -1, -1]);
  });
});

describe("trivia scoring", () => {
  it("gives 500 plus up to 500 for speed, 0 when wrong", () => {
    expect(speedPoints(true, 20000, 20000)).toBe(1000);
    expect(speedPoints(true, 10000, 20000)).toBe(750);
    expect(speedPoints(true, 0, 20000)).toBe(500);
    expect(speedPoints(true, -500, 20000)).toBe(500);
    expect(speedPoints(true, 99999, 20000)).toBe(1000);
    expect(speedPoints(false, 20000, 20000)).toBe(0);
    expect(speedPoints(true, 5, 0)).toBe(500);
  });

  it("solo total never passes the board max", () => {
    const r = Array.from({ length: 10 }, (_, i) => ({ id: String(i), given: "x", correct: true, points: 1000 }));
    expect(soloTotal(r)).toBe(10000);
    expect(soloTotal([...r, ...r])).toBe(SOLO_MAX);
    expect(soloTotal([])).toBe(0);
  });

  it("ranks with shared places", () => {
    const rows = rankScores({ a: 10, b: 30, c: 10, d: 0 }, { a: "Ann", b: "Bo", c: "Cy", d: "Di" });
    expect(rows.map((r) => [r.name, r.rank])).toEqual([["Bo", 1], ["Ann", 2], ["Cy", 2], ["Di", 4]]);
    expect(podium(rows).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rankScores({ z: 1 }, {})[0].name).toBe("Player");
  });
});

describe("trivia setup", () => {
  it("parses stored setup and falls back to defaults", () => {
    expect(parseSetup(null)).toEqual(DEFAULT_SETUP);
    expect(parseSetup({ mode: "versus", categories: ["music", "nope", "league"], difficulty: 9, count: 20, seconds: 25 })).toEqual({
      mode: "versus",
      categories: ["league", "music"],
      difficulty: "any",
      count: 20,
      seconds: 20,
    });
    expect(parseSetup({ categories: [] }).categories).toEqual(CATEGORY_IDS);
  });

  it("solo is always 10 questions of 20 s", () => {
    expect(roundPlan({ mode: "solo", count: 30, seconds: 15 })).toEqual({ count: 10, seconds: 20 });
    expect(roundPlan({ mode: "versus", count: 30, seconds: 15 })).toEqual({ count: 30, seconds: 15 });
  });
});

/* ---------- versus ---------- */

const OPEN: TriviaQuestion = { id: "o1", category: "music", topic: "bands", difficulty: 2, question: "Which band sang Bohemian Rhapsody?", answer: "Queen", accept: ["Queen band"], fact: "It came out in 1975." };
const MC: TriviaQuestion = { id: "m1", category: "league", topic: "lore", difficulty: 1, question: "Annie's bear?", answer: "Tibbers", choices: ["Willump", "Tibbers", "Pix", "Meeps"] };
const ann = { id: "p-ann", name: "Ann" };
const bo = { id: "p-bo", name: "Bo" };
const T0 = 1_000_000;

function started(questions = [MC, OPEN]) {
  return vsStart(vsCreate(questions, 20, 7, [ann, bo]), T0);
}
const ans = (value: string) => ({ type: "answer" as const, value, at: 0 });

describe("trivia versus reducers", () => {
  it("starts in the lobby with everyone at 0, then opens question 1 with a deadline", () => {
    const lobby = vsCreate([MC, OPEN], 20, 7, [ann, bo]);
    expect(lobby.phase).toBe("lobby");
    expect(vsPublic(lobby, T0)).toMatchObject({ phase: "lobby", question: null, total: 2, scores: { "p-ann": 0, "p-bo": 0 } });
    const g = vsStart(lobby, T0);
    expect(g.phase).toBe("question");
    expect(g.endsAt).toBe(T0 + 20000);
    expect(vsStart(vsCreate([], 20, 1), T0).phase).toBe("lobby");
  });

  it("scores answers by the host's receive time, not the client's", () => {
    let g = started();
    g = vsAnswer(g, ann, { type: "answer", value: "Tibbers", at: T0 }, T0 + 10000);
    expect(g.answers["p-ann"]).toMatchObject({ correct: true, points: 750 });
    g = vsAnswer(g, bo, ans("Pix"), T0 + 1000);
    expect(g.answers["p-bo"]).toMatchObject({ correct: false, points: 0 });
  });

  it("keeps the first answer and ignores junk, unknown choices and late answers", () => {
    let g = started();
    const first = vsAnswer(g, ann, ans("Pix"), T0 + 100);
    expect(vsAnswer(first, ann, ans("Tibbers"), T0 + 200)).toBe(first);
    expect(vsAnswer(g, ann, { type: "nope", value: "Tibbers" }, T0)).toBe(g);
    expect(vsAnswer(g, ann, null, T0)).toBe(g);
    expect(vsAnswer(g, ann, ans("   "), T0)).toBe(g);
    expect(vsAnswer(g, ann, ans("Teemo"), T0)).toBe(g);
    expect(vsAnswer(g, ann, ans("Tibbers"), T0 + 20000 + ANSWER_GRACE_MS + 1)).toBe(g);
    expect(vsAnswer(g, ann, ans("Tibbers"), T0 + 20000 + ANSWER_GRACE_MS).answers["p-ann"].points).toBe(500);
    g = vsReveal(g);
    expect(vsAnswer(g, ann, ans("Tibbers"), T0)).toBe(g);
  });

  it("a late joiner who answers gets a score line", () => {
    const cy = { id: "p-cy", name: "Cy" };
    const g = vsAnswer(started(), cy, ans("Tibbers"), T0);
    expect(g.banked["p-cy"]).toBe(0);
    expect(g.names["p-cy"]).toBe("Cy");
    const h = vsAddPlayers(started(), [cy]);
    expect(vsPublic(h, T0).scores["p-cy"]).toBe(0);
    expect(vsAddPlayers(h, [cy])).toBe(h);
  });

  it("knows when everyone answered", () => {
    let g = started();
    expect(vsAllAnswered(g, [])).toBe(false);
    g = vsAnswer(g, ann, ans("Pix"), T0);
    expect(vsAllAnswered(g, ["p-ann", "p-bo"])).toBe(false);
    g = vsAnswer(g, bo, ans("Pix"), T0);
    expect(vsAllAnswered(g, ["p-ann", "p-bo"])).toBe(true);
    expect(vsAllAnswered(vsReveal(g), ["p-ann", "p-bo"])).toBe(false);
  });

  it("adds points at the reveal and banks them on next; ends after the last question", () => {
    let g = started();
    g = vsAnswer(g, ann, ans("Tibbers"), T0); // 1000
    expect(vsPublic(g, T0).scores["p-ann"]).toBe(0); // not before the reveal
    g = vsReveal(g);
    expect(vsPublic(g, T0).scores["p-ann"]).toBe(1000);
    g = vsNext(g, T0 + 30000);
    expect(g).toMatchObject({ phase: "question", index: 1, endsAt: T0 + 50000, answers: {} });
    expect(g.banked["p-ann"]).toBe(1000);
    g = vsNext(vsReveal(g), T0 + 60000);
    expect(g.phase).toBe("ended");
    expect(vsPublic(g, T0).scores).toEqual({ "p-ann": 1000, "p-bo": 0 });
  });

  it("skip drops the question without points; end keeps a revealed one only", () => {
    let g = vsAnswer(started(), ann, ans("Tibbers"), T0);
    const skipped = vsSkip(g, T0 + 1);
    expect(skipped.index).toBe(1);
    expect(skipped.banked["p-ann"]).toBe(0);
    expect(vsEnd(g).banked["p-ann"]).toBe(0);
    g = vsReveal(g);
    expect(vsEnd(g)).toMatchObject({ phase: "ended", banked: { "p-ann": 1000 } });
    expect(vsSkip(vsSkip(started(), T0), T0).phase).toBe("ended");
  });

  it("the host can override open answers during the reveal, keeping the speed bonus", () => {
    let g = vsNext(vsReveal(started()), T0); // question 2 (open), deadline T0 + 20000
    g = vsAnswer(g, ann, ans("Freddie's band"), T0 + 10000);
    g = vsAnswer(g, bo, ans("quen"), T0 + 5000); // short answer, no typo allowance
    expect(g.answers["p-ann"].correct).toBe(false);
    expect(vsOverride(g, "p-ann", true)).toBe(g); // not during the question
    g = vsReveal(g);
    g = vsOverride(g, "p-ann", true);
    expect(g.answers["p-ann"]).toMatchObject({ correct: true, points: 750, overridden: true });
    g = vsOverride(g, "p-bo", true);
    expect(g.answers["p-bo"].points).toBe(875);
    expect(vsPublic(g, T0).reveal!.results["p-bo"]).toEqual({ correct: true, points: 875, given: "quen" });
    expect(vsOverride(g, "nobody", true)).toBe(g);
    // Multiple choice can't be overridden.
    const mc = vsReveal(vsAnswer(started(), ann, ans("Pix"), T0));
    expect(vsOverride(mc, "p-ann", true)).toBe(mc);
  });
});

describe("trivia versus public state", () => {
  const secret = (g: ReturnType<typeof started>) => JSON.stringify(vsPublic(g, T0));

  it("never contains the answer, fact or results before the reveal", () => {
    // Open question: the answer text, accept list and fact must not appear anywhere.
    let g = vsNext(vsReveal(started()), T0);
    for (const step of [g, vsAnswer(g, ann, ans("Queen"), T0), vsAnswer(vsAnswer(g, ann, ans("Queen"), T0), bo, ans("ABBA"), T0)]) {
      const s = vsPublic(step, T0);
      const json = secret(step);
      expect(s.reveal).toBeUndefined();
      expect(json).not.toMatch(/queen/i);
      expect(json).not.toContain("1975");
      expect(json).not.toContain("ABBA");
      expect(json).not.toMatch(/correct|points|given|answer"/);
      expect(s.scores).toEqual({ "p-ann": 0, "p-bo": 0 });
    }
    g = vsAnswer(g, ann, ans("Queen"), T0);
    expect(vsPublic(g, T0).answered).toEqual(["p-ann"]);
  });

  it("multiple choice: only the shuffled choices, no answer index", () => {
    const g = vsAnswer(started(), ann, ans("Tibbers"), T0);
    const s = vsPublic(g, T0);
    expect([...s.choices!].sort()).toEqual([...MC.choices!].sort());
    expect(Object.keys(s).sort()).toEqual(["answered", "category", "choices", "difficulty", "index", "msLeft", "names", "phase", "question", "scores", "seconds", "topic", "total"]);
    expect(s.scores["p-ann"]).toBe(0);
  });

  it("the lobby and the end have no question at all", () => {
    const lobby = vsCreate([OPEN], 20, 1, [ann]);
    expect(secret(lobby)).not.toMatch(/queen|bohemian/i);
    const ended = vsEnd(vsStart(lobby, T0));
    expect(secret(ended)).not.toMatch(/queen|bohemian/i);
  });

  it("the reveal has answer, fact and everyone's result", () => {
    let g = vsNext(vsReveal(started()), T0);
    g = vsReveal(vsAnswer(g, ann, ans("queen band"), T0 + 4000));
    const s = vsPublic(g, T0);
    expect(s.msLeft).toBe(0);
    expect(s.reveal).toEqual({ answer: "Queen", fact: "It came out in 1975.", results: { "p-ann": { correct: true, points: 900, given: "queen band" } } });
  });

  it("the public state is plain JSON", () => {
    const g = vsReveal(vsAnswer(started(), ann, ans("Tibbers"), T0));
    expect(JSON.parse(JSON.stringify(vsPublic(g, T0)))).toEqual(vsPublic(g, T0));
  });
});

describe("trivia versus timer", () => {
  it("sends the time left by the host's clock, not a deadline", () => {
    const g = started(); // deadline T0 + 20000
    expect(vsPublic(g, T0).msLeft).toBe(20000);
    expect(vsPublic(g, T0 + 7250).msLeft).toBe(12750);
    expect(vsPublic(g, T0 + 99999).msLeft).toBe(0);
    expect(vsPublic(vsReveal(g), T0).msLeft).toBe(0);
    expect(vsPublic(vsCreate([MC], 20, 1), T0).msLeft).toBe(0);
    expect("endsAt" in vsPublic(g, T0)).toBe(false);
  });

  it("players count down from when the state arrived, whatever their clock says", () => {
    // A phone clock 10 minutes ahead doesn't matter: only the time since arrival counts.
    expect(countdownLeft(15000, 1000, 1000)).toBe(15000);
    expect(countdownLeft(15000, 1000, 6000)).toBe(10000);
    expect(countdownLeft(15000, 1000, 17000)).toBe(0);
    expect(countdownLeft(15000, 5000, 4000)).toBe(15000); // arrival "in the future": never more than msLeft
  });

  it("the host still decides with its own deadline (+ grace)", () => {
    const g = started();
    expect(vsAnswer(g, ann, ans("Tibbers"), T0 + 20000 + ANSWER_GRACE_MS).answers["p-ann"]).toBeTruthy();
    expect(vsAnswer(g, ann, { type: "answer", value: "Tibbers", at: T0 }, T0 + 20000 + ANSWER_GRACE_MS + 1).answers["p-ann"]).toBeUndefined();
  });
});

describe("trivia host refresh", () => {
  const setup = { ...DEFAULT_SETUP, mode: "versus" as const, seconds: 20 as const };
  const save = (game: unknown, extra: object = {}) => JSON.stringify({ v: 1, setup, game, ...extra });

  it("round-trips the private game with answers and scores", () => {
    let g = vsAnswer(started(), ann, ans("Tibbers"), T0 + 2000);
    g = vsNext(vsReveal(g), T0 + 5000);
    g = vsAnswer(g, bo, ans("quuen"), T0 + 6000);
    const back = parseSavedHost(save(g))!;
    expect(back.game).toEqual(g);
    expect(back.setup).toEqual(setup);
  });

  it("an open question keeps its deadline, or gets a fresh timer if it ran out", () => {
    const g = started(); // deadline T0 + 20000
    expect(vsResume(g, T0 + 5000)).toBe(g);
    expect(vsResume(g, T0 + 30000).endsAt).toBe(T0 + 30000 + 20000);
    const r = vsReveal(g);
    expect(vsResume(r, T0 + 99999)).toBe(r);
  });

  it("rejects junk and tampered games", () => {
    const g = started();
    expect(parseSavedHost(null)).toBeNull();
    expect(parseSavedHost("{")).toBeNull();
    expect(parseSavedHost(JSON.stringify({ v: 2, setup, game: g }))).toBeNull();
    expect(parseSavedHost(save({ ...g, phase: "party" }))).toBeNull();
    expect(parseSavedHost(save({ ...g, questions: [{ ...MC, answer: "nope" }, OPEN] }))).toBeNull();
    expect(parseSavedHost(save({ ...g, choices: [["a", "b", "c", "d"], []] }))).toBeNull();
    expect(parseSavedHost(save({ ...g, choices: [[]] }))).toBeNull();
    expect(parseSavedHost(save({ ...g, index: 5 }))).toBeNull();
    expect(parseSavedHost(save({ ...g, answers: { x: { value: "a", leftMs: 1, correct: true, points: 5000 } } }))).toBeNull();
    expect(parseSavedHost(save({ ...g, banked: { x: "lots" } }))).toBeNull();
    expect(parseSavedHost(save({ ...g, seconds: 0 }))).toBeNull();
  });

  it("an ended game and an empty lobby still load", () => {
    expect(parseSavedHost(save(vsEnd(started())))!.game.phase).toBe("ended");
    expect(parseSavedHost(save(vsCreate([], 20, 0)))!.game.phase).toBe("lobby");
  });
});

/* ---------- admin form ---------- */

const draft = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({ ...emptyDraft("music"), topic: "Bands", question: "Who sang Bohemian Rhapsody?", answer: "Queen", ...over });

describe("trivia admin form", () => {
  it("accepts a valid open question and tidies it", () => {
    const c = validateDraft(draft({ question: "  Who   sang Bohemian Rhapsody? ", accept: "Queen band\n\nqueen\n  The Queen  " }));
    expect(c.errors).toEqual({});
    expect(c.value).toEqual({ category: "music", topic: "bands", difficulty: 2, question: "Who sang Bohemian Rhapsody?", answer: "Queen", accept: ["Queen band", "The Queen"] });
  });

  it("requires question, answer and topic", () => {
    const c = validateDraft(draft({ question: " ", answer: "", topic: "" }));
    expect(Object.keys(c.errors).sort()).toEqual(["answer", "question", "topic"]);
    expect(c.value).toBeNull();
  });

  it("warns above 120 characters and refuses above 200", () => {
    const warn = validateDraft(draft({ question: "x".repeat(150) }));
    expect(warn.errors.question).toBeUndefined();
    expect(warn.warnings.question).toBeTruthy();
    expect(warn.value).not.toBeNull();
    const bad = validateDraft(draft({ question: "x".repeat(QUESTION_MAX + 1) }));
    expect(bad.errors.question).toBeTruthy();
    expect(bad.value).toBeNull();
  });

  it("multiple choice: 4 filled, unique, containing the answer", () => {
    const mc = (choices: [string, string, string, string], answer = "Queen") => validateDraft(draft({ multipleChoice: true, answer, choices, accept: "ignored" }));
    expect(mc(["Queen", "ABBA", "Oasis", "Blur"]).value).toEqual({ category: "music", topic: "bands", difficulty: 2, question: "Who sang Bohemian Rhapsody?", answer: "Queen", choices: ["Queen", "ABBA", "Oasis", "Blur"] });
    expect(mc(["Queen", "ABBA", "", "Blur"]).errors.choices).toMatch(/all 4/);
    expect(mc(["Queen", "ABBA", "abba", "Blur"]).errors.choices).toMatch(/different/);
    expect(mc(["Wham", "ABBA", "Oasis", "Blur"]).errors.choices).toMatch(/answer/);
    // Same text, other case: the answer takes the choice's spelling.
    expect(mc(["QUEEN", "ABBA", "Oasis", "Blur"]).value!.answer).toBe("QUEEN");
  });

  it("caps all other spellings together at what the database allows", () => {
    const many = Array.from({ length: 15 }, (_, i) => `spelling-${i}-`.padEnd(50, "x")).join("\n");
    expect(15 * 50).toBeGreaterThan(ACCEPT_TOTAL_MAX);
    expect(validateDraft(draft({ accept: many })).errors.accept).toMatch(/all together/);
  });

  it("checks the fact length and keeps the id when editing", () => {
    expect(validateDraft(draft({ fact: "y".repeat(201) })).errors.fact).toBeTruthy();
    const q: TriviaQuestion = { ...MC, id: "custom-abc", fact: "Fact." };
    const back = validateDraft(draftFromQuestion(q)).value!;
    expect(back).toEqual({ id: "custom-abc", category: "league", topic: "lore", difficulty: 1, question: "Annie's bear?", answer: "Tibbers", choices: ["Willump", "Tibbers", "Pix", "Meeps"], fact: "Fact." });
    expect(isPlayable({ ...back, id: back.id })).toBe(true);
  });
});

describe("trivia random", () => {
  it("rng is deterministic per seed and in [0, 1)", () => {
    const a = rng(42), b = rng(42), c = rng(43);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("shuffle keeps every item, does not change the input, and is seeded", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s1 = shuffle(arr, rng(7));
    expect([...s1].sort((x, y) => x - y)).toEqual(arr);
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(shuffle(arr, rng(7))).toEqual(s1);
  });
});

describe("trivia picking", () => {
  it("picks without repeats and caps at the pool size", () => {
    const picked = pickQuestions(FIXTURE, 5, new Set(), rng(1));
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((q) => q.id)).size).toBe(5);
    expect(pickQuestions(FIXTURE, 30, new Set(), rng(1))).toHaveLength(8);
    expect(pickQuestions(FIXTURE, 0, new Set(), rng(1))).toHaveLength(0);
  });

  it("ignores duplicate ids in the pool", () => {
    const pool = [...FIXTURE, FIXTURE[0], FIXTURE[1]];
    const picked = pickQuestions(pool, 30, new Set(), rng(3));
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((q) => q.id)).size).toBe(8);
  });

  it("prefers unseen questions, then fills up with seen ones", () => {
    const seen = new Set(["league-0001", "league-0002", "general-0001", "general-0002", "general-0003"]);
    for (let seed = 0; seed < 20; seed++) {
      const three = pickQuestions(FIXTURE, 3, seen, rng(seed)).map((q) => q.id);
      expect(three.every((id) => !seen.has(id))).toBe(true);
      const all = pickQuestions(FIXTURE, 8, seen, rng(seed)).map((q) => q.id);
      expect(all.slice(0, 3).every((id) => !seen.has(id))).toBe(true);
      expect(all.slice(3).every((id) => seen.has(id))).toBe(true);
    }
    expect(unseenCount(FIXTURE, seen)).toBe(3);
  });

  it("markSeen adds ids and starts over once everything was seen", () => {
    const all = FIXTURE.map((q) => q.id);
    expect(markSeen(["a"], ["b", "a"])).toEqual(["a", "b"]);
    const almost = all.slice(0, 7);
    expect(markSeen(almost, [all[7]], all)).toEqual([all[7]]);
    expect(markSeen([], ["x"], [])).toEqual(["x"]);
  });

  it("parseSeen tolerates junk", () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen("not json")).toEqual([]);
    expect(parseSeen('{"a":1}')).toEqual([]);
    expect(parseSeen('["a",2,"b"]')).toEqual(["a", "b"]);
  });
});

describe("trivia choices", () => {
  it("shuffles the choices but keeps the answer, stable per seed", () => {
    const q = FIXTURE[0];
    for (let seed = 0; seed < 30; seed++) {
      const { choices, answerIndex } = shuffleChoices(q, seed);
      expect([...choices].sort()).toEqual([...q.choices!].sort());
      expect(choices[answerIndex]).toBe(q.answer);
      expect(shuffleChoices(q, seed)).toEqual({ choices, answerIndex });
    }
    const orders = new Set(Array.from({ length: 30 }, (_, s) => shuffleChoices(q, s).choices.join("|")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("handles open questions and a missing answer", () => {
    expect(shuffleChoices(FIXTURE[2], 1)).toEqual({ choices: [], answerIndex: -1 });
    const broken: TriviaQuestion = { ...FIXTURE[0], answer: "nope" };
    expect(shuffleChoices(broken, 1).answerIndex).toBe(-1);
  });
});

describe("trivia keyboard", () => {
  it("knows when the user is typing", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isControlTarget({ tagName: "BUTTON" })).toBe(true);
    expect(isControlTarget({ tagName: "a" })).toBe(true);
    expect(isControlTarget({ tagName: "DIV", getAttribute: (n) => (n === "role" ? "button" : null) })).toBe(true);
    expect(isControlTarget({ tagName: "DIV", getAttribute: () => null })).toBe(false);
    expect(isControlTarget(null)).toBe(false);
  });
});
