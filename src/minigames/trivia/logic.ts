import { TRIVIA_CATEGORIES, type TriviaCategory, type TriviaQuestion } from "./types";

/* Pure logic for Trivia night: questions, answer checking, scoring, the Versus reducers and the admin form.
   No React, no storage, no network. */

/* =====================================================================================
   categories and filtering
   ===================================================================================== */

export const CATEGORY_IDS: TriviaCategory[] = TRIVIA_CATEGORIES.map((c) => c.id);
export const CATEGORY_LABEL = Object.fromEntries(TRIVIA_CATEGORIES.map((c) => [c.id, c.label])) as Record<TriviaCategory, string>;
/** Short labels for chips on the stream. */
export const CATEGORY_SHORT: Record<TriviaCategory, string> = { ...CATEGORY_LABEL, league: "League", general: "General" };
export const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = { 1: "Easy", 2: "Medium", 3: "Hard" };

export const isCategory = (v: unknown): v is TriviaCategory => typeof v === "string" && (CATEGORY_IDS as string[]).includes(v);

export type DifficultyFilter = 1 | 2 | 3 | "any";

export interface Filters {
  /** The picked categories. Empty = nothing picked (nothing matches). */
  categories: readonly TriviaCategory[];
  difficulty: DifficultyFilter;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** True when a question (built in or from the database) is complete enough to be played. */
export function isPlayable(q: unknown): q is TriviaQuestion {
  if (!isObj(q)) return false;
  if (!isStr(q.id) || !q.id || !isCategory(q.category)) return false;
  if (q.difficulty !== 1 && q.difficulty !== 2 && q.difficulty !== 3) return false;
  if (!isStr(q.question) || !q.question.trim() || !isStr(q.answer) || !q.answer.trim()) return false;
  if (q.choices !== undefined && q.choices !== null) {
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || !q.choices.every(isStr)) return false;
    if (!q.choices.includes(q.answer)) return false;
  }
  return true;
}

/** Built-in questions first, then the admin-added ones. Unplayable ones and repeated ids are dropped (first wins). */
export function mergeQuestions(builtIn: readonly TriviaQuestion[], custom: readonly TriviaQuestion[]): TriviaQuestion[] {
  const seen = new Set<string>();
  const out: TriviaQuestion[] = [];
  for (const q of [...builtIn, ...custom]) {
    if (!isPlayable(q) || seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

/** Categories that can be picked, in setup order. */
export function enabledCategories(disabled: readonly TriviaCategory[]): TriviaCategory[] {
  return CATEGORY_IDS.filter((c) => !disabled.includes(c));
}

export function matchesFilters(q: TriviaQuestion, f: Filters, disabled: readonly TriviaCategory[] = []): boolean {
  if (disabled.includes(q.category) || !f.categories.includes(q.category)) return false;
  if (f.difficulty !== "any" && q.difficulty !== f.difficulty) return false;
  return true;
}

export function filterQuestions(all: readonly TriviaQuestion[], f: Filters, disabled: readonly TriviaCategory[] = []): TriviaQuestion[] {
  return all.filter((q) => matchesFilters(q, f, disabled));
}

/** Questions per category for the chosen difficulty (disabled categories count 0). */
export function categoryCounts(all: readonly TriviaQuestion[], difficulty: DifficultyFilter, disabled: readonly TriviaCategory[] = []): Record<TriviaCategory, number> {
  const out = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0])) as Record<TriviaCategory, number>;
  for (const q of all) {
    if (disabled.includes(q.category)) continue;
    if (difficulty !== "any" && q.difficulty !== difficulty) continue;
    out[q.category]++;
  }
  return out;
}

/* =====================================================================================
   seeded random and picking
   ===================================================================================== */

/** Small fast seeded generator (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String hash (FNV-1a), used to give each question its own stable choice order within a game. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(arr: readonly T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Picks up to `count` questions without repeats. Questions whose id is in `seen` only come after every unseen one
 * is used. Duplicate ids in the pool are ignored.
 */
export function pickQuestions(pool: readonly TriviaQuestion[], count: number, seen: ReadonlySet<string>, rand: () => number): TriviaQuestion[] {
  const byId = new Map<string, TriviaQuestion>();
  for (const q of pool) if (!byId.has(q.id)) byId.set(q.id, q);
  const unique = [...byId.values()];
  const fresh = shuffle(unique.filter((q) => !seen.has(q.id)), rand);
  const old = shuffle(unique.filter((q) => seen.has(q.id)), rand);
  return [...fresh, ...old].slice(0, Math.max(0, count));
}

/** How many of the pool have not been seen yet. */
export function unseenCount(pool: readonly TriviaQuestion[], seen: ReadonlySet<string>): number {
  return pool.filter((q) => !seen.has(q.id)).length;
}

/** Adds ids to the seen list. If every question in `all` has been seen, start over with just the new ones. */
export function markSeen(seen: readonly string[], ids: readonly string[], allIds?: readonly string[]): string[] {
  const set = new Set(seen);
  for (const id of ids) set.add(id);
  if (allIds && allIds.length > 0 && allIds.every((id) => set.has(id))) return [...new Set(ids)];
  return [...set];
}

/** Reads a stored seen list; anything unexpected becomes an empty list. */
export function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isStr) : [];
  } catch {
    return [];
  }
}

/* ---------- choices ---------- */

export interface ShownChoices {
  choices: string[];
  /** Index of the answer in `choices`, -1 if the question has no choices or the answer is missing from them. */
  answerIndex: number;
}

/** Shuffles the 4 choices with a seed. The answer always stays among them. */
export function shuffleChoices(q: TriviaQuestion, seed: number): ShownChoices {
  if (!q.choices) return { choices: [], answerIndex: -1 };
  const choices = shuffle(q.choices, rng(seed ^ hash(q.id)));
  return { choices, answerIndex: choices.findIndex((c) => c === q.answer) };
}

export const LETTERS = ["A", "B", "C", "D"] as const;

/** Key to choice index: A-D or 1-4. -1 for anything else. */
export function choiceKey(key: string): number {
  const k = key.toUpperCase();
  const i = LETTERS.indexOf(k as (typeof LETTERS)[number]);
  if (i >= 0) return i;
  return /^[1-4]$/.test(k) ? Number(k) - 1 : -1;
}

/* =====================================================================================
   answer checking
   ===================================================================================== */

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const SPECIAL: Record<string, string> = { "ø": "o", "æ": "ae", "œ": "oe", "ß": "ss", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i" };

/**
 * Forgiving form of an answer: lower case, no accents, no punctuation, "&" = "and", number words as digits
 * ("seven" = "7"), a leading "the" / "a" / "an" dropped, single spaces.
 */
export function normalizeAnswer(s: string): string {
  let t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  t = t.replace(/[øæœßłđðþı]/g, (c) => SPECIAL[c] ?? c);
  t = t.replace(/&/g, " and ").replace(/['’‘`´]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  t = t
    .split(" ")
    .map((w) => {
      const i = NUMBER_WORDS.indexOf(w);
      return i >= 0 ? String(i) : w;
    })
    .join(" ");
  return t.replace(/^(the|a|an) (?=\S)/, "");
}

/** Edit distance with swaps of neighbours counting as one (optimal string alignment). Stops early above `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/** How many typos an answer of this (normalized, spaces removed) length allows: none up to 5 letters, 1 up to 9, then 2. */
export function typoAllowance(target: string): number {
  const n = target.length;
  return n <= 5 ? 0 : n <= 9 ? 1 : 2;
}

/** One typed answer against one accepted spelling. */
export function answerMatches(given: string, target: string): boolean {
  if (!given.trim() || !target.trim()) return false;
  const g = normalizeAnswer(given);
  const t = normalizeAnswer(target);
  // Answers with no Latin letters or digits (e.g. only symbols): compare as typed.
  if (!t) return given.trim().toLowerCase() === target.trim().toLowerCase();
  if (!g) return false;
  if (g === t) return true;
  const gc = g.replace(/ /g, "");
  const tc = t.replace(/ /g, "");
  if (gc === tc) return true;
  // Numbers must be exact: "2009" is not a typo of "2008", "Season 11" not of "Season 10".
  if (gc.replace(/\D/g, "") !== tc.replace(/\D/g, "")) return false;
  const allow = typoAllowance(tc);
  return allow > 0 && editDistance(gc, tc, allow) <= allow;
}

/** Is this answer right? Multiple choice: the picked text must be exactly the answer. Open: answer or accept list, forgiving. */
export function isCorrect(q: Pick<TriviaQuestion, "answer" | "accept" | "choices">, given: string): boolean {
  if (!given.trim()) return false;
  if (q.choices) return given.trim() === q.answer.trim();
  return [q.answer, ...(q.accept ?? [])].some((t) => answerMatches(given, t));
}

/* =====================================================================================
   scoring
   ===================================================================================== */

export const BASE_POINTS = 500;
export const SPEED_POINTS = 500;
export const SOLO_COUNT = 10;
export const SOLO_SECONDS = 20;
/** Highest possible solo score: SOLO_COUNT x (BASE_POINTS + SPEED_POINTS). Matches the "trivia-solo" board. */
export const SOLO_MAX = SOLO_COUNT * (BASE_POINTS + SPEED_POINTS);
/** Answers that arrive this late after the deadline still count (network delay). */
export const ANSWER_GRACE_MS = 500;
export const MAX_ANSWER_LENGTH = 120;

/** Right answers get 500 plus up to 500 for speed (all of it at the start, nothing at the deadline). Wrong = 0. */
export function speedPoints(correct: boolean, leftMs: number, totalMs: number): number {
  if (!correct) return 0;
  if (!(totalMs > 0) || !Number.isFinite(leftMs)) return BASE_POINTS;
  const f = Math.max(0, Math.min(1, leftMs / totalMs));
  return BASE_POINTS + Math.round(SPEED_POINTS * f);
}

export interface SoloResult {
  id: string;
  given: string;
  correct: boolean;
  points: number;
}

export function soloTotal(results: readonly SoloResult[]): number {
  return Math.min(SOLO_MAX, results.reduce((s, r) => s + r.points, 0));
}

/* ---------- ranking ---------- */

export interface Ranked {
  id: string;
  name: string;
  score: number;
  /** 1-based, tied scores share a rank (1, 1, 3). */
  rank: number;
}

/** Highest score first, ties by name, then standard competition ranking. */
export function rankScores(scores: Readonly<Record<string, number>>, names: Readonly<Record<string, string>>): Ranked[] {
  const sorted = Object.keys(scores)
    .map((id) => ({ id, name: names[id] ?? "Player", score: scores[id] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  let rank = 0;
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}

/** Everyone with rank 1-3 (can be more than 3 people when tied). */
export function podium(rows: readonly Ranked[]): Ranked[] {
  return rows.filter((r) => r.rank <= 3);
}

/* =====================================================================================
   Versus (live room). The host's browser holds VsGame; players only ever see vsPublic(game).
   ===================================================================================== */

export type VsPhase = "lobby" | "question" | "reveal" | "ended";

export interface VsResult {
  correct: boolean;
  points: number;
  given: string;
}

/** The public state sent to everyone. The answer is only in `reveal`. */
export interface VsState {
  phase: VsPhase;
  /** 0-based question number. */
  index: number;
  total: number;
  /** null in the lobby and at the end. */
  question: string | null;
  /** Shuffled choices for multiple choice questions. */
  choices?: string[];
  category: TriviaCategory | null;
  topic?: string;
  difficulty?: 1 | 2 | 3;
  /**
   * Milliseconds left to answer when the host sent this state (0 when no question is open). Players count down from
   * when the state arrives, so their own clock doesn't matter. The host checks the real deadline with its own clock.
   */
  msLeft: number;
  /** Answer time per question. */
  seconds: number;
  /** Player ids who have answered this question. */
  answered: string[];
  /** Totals. While a question is open they don't include it yet. */
  scores: Record<string, number>;
  /** Names for everyone in `scores`, so the podium still works after someone leaves. */
  names: Record<string, string>;
  reveal?: { answer: string; fact?: string; results: Record<string, VsResult> };
}

export type VsAction = { type: "answer"; value: string; at: number };

export interface VsAnswer {
  value: string;
  /** Milliseconds left on the host's clock when it arrived. */
  leftMs: number;
  correct: boolean;
  points: number;
  /** The host changed the auto-check. */
  overridden?: boolean;
}

/** Host-only game. Never send this. */
export interface VsGame {
  phase: VsPhase;
  questions: TriviaQuestion[];
  /** Shuffled choices per question ([] for open ones). */
  choices: string[][];
  seconds: number;
  index: number;
  endsAt: number;
  /** Answers to the current question, by player id. */
  answers: Record<string, VsAnswer>;
  /** Points from finished questions. */
  banked: Record<string, number>;
  names: Record<string, string>;
}

export interface VsPlayer {
  id: string;
  name: string;
}

export function vsCreate(questions: readonly TriviaQuestion[], seconds: number, seed: number, players: readonly VsPlayer[] = []): VsGame {
  const g: VsGame = {
    phase: "lobby",
    questions: questions.slice(),
    choices: questions.map((q) => shuffleChoices(q, seed).choices),
    seconds,
    index: 0,
    endsAt: 0,
    answers: {},
    banked: {},
    names: {},
  };
  return vsAddPlayers(g, players);
}

/** Adds players who aren't in the scores yet (late joiners start at 0). Returns the same object when nothing changes. */
export function vsAddPlayers(g: VsGame, players: readonly VsPlayer[]): VsGame {
  const add = players.filter((p) => !(p.id in g.banked) || g.names[p.id] !== p.name);
  if (add.length === 0) return g;
  const banked = { ...g.banked };
  const names = { ...g.names };
  for (const p of add) {
    banked[p.id] ??= 0;
    names[p.id] = p.name;
  }
  return { ...g, banked, names };
}

function openQuestion(g: VsGame, index: number, now: number): VsGame {
  if (index >= g.questions.length) return { ...g, phase: "ended", endsAt: 0, answers: {} };
  return { ...g, phase: "question", index, endsAt: now + g.seconds * 1000, answers: {} };
}

export function vsStart(g: VsGame, now: number): VsGame {
  if (g.phase !== "lobby" || g.questions.length === 0) return g;
  return openQuestion(g, 0, now);
}

/** A player's answer, as received by the host at `now` (the host's clock; the client's `at` is ignored). */
export function vsAnswer(g: VsGame, from: VsPlayer, action: unknown, now: number): VsGame {
  if (g.phase !== "question") return g;
  if (!isObj(action) || action.type !== "answer" || !isStr(action.value)) return g;
  if (from.id in g.answers) return g; // first answer counts
  if (now > g.endsAt + ANSWER_GRACE_MS) return g;
  const value = action.value.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_LENGTH);
  if (!value) return g;
  const q = g.questions[g.index];
  const choices = g.choices[g.index] ?? [];
  if (choices.length > 0 && !choices.includes(value)) return g;
  const leftMs = Math.max(0, g.endsAt - now);
  const correct = isCorrect(q, value);
  const answers = { ...g.answers, [from.id]: { value, leftMs, correct, points: speedPoints(correct, leftMs, g.seconds * 1000) } };
  const banked = from.id in g.banked ? g.banked : { ...g.banked, [from.id]: 0 };
  return { ...g, answers, banked, names: { ...g.names, [from.id]: g.names[from.id] ?? from.name } };
}

/** True when every player in `playerIds` (the host excluded) has answered. False with nobody to wait for. */
export function vsAllAnswered(g: VsGame, playerIds: readonly string[]): boolean {
  return g.phase === "question" && playerIds.length > 0 && playerIds.every((id) => id in g.answers);
}

export function vsReveal(g: VsGame): VsGame {
  return g.phase === "question" ? { ...g, phase: "reveal" } : g;
}

/** During the reveal of an open question the host can mark an answer right or wrong. Points keep the speed bonus. */
export function vsOverride(g: VsGame, playerId: string, correct: boolean): VsGame {
  if (g.phase !== "reveal" || (g.choices[g.index]?.length ?? 0) > 0) return g;
  const a = g.answers[playerId];
  if (!a || a.correct === correct) return g;
  const points = speedPoints(correct, a.leftMs, g.seconds * 1000);
  return { ...g, answers: { ...g.answers, [playerId]: { ...a, correct, points, overridden: true } } };
}

function bank(g: VsGame): Record<string, number> {
  const banked = { ...g.banked };
  for (const [id, a] of Object.entries(g.answers)) banked[id] = (banked[id] ?? 0) + a.points;
  return banked;
}

/** From the reveal: bank the points and open the next question (or end). */
export function vsNext(g: VsGame, now: number): VsGame {
  if (g.phase !== "reveal") return g;
  return openQuestion({ ...g, banked: bank(g), answers: {} }, g.index + 1, now);
}

/** Drop the current question without points and move on. */
export function vsSkip(g: VsGame, now: number): VsGame {
  if (g.phase !== "question" && g.phase !== "reveal") return g;
  return openQuestion({ ...g, answers: {} }, g.index + 1, now);
}

/** End now. A revealed question still counts; an open one doesn't. */
export function vsEnd(g: VsGame): VsGame {
  if (g.phase === "ended") return g;
  const banked = g.phase === "reveal" ? bank(g) : g.banked;
  return { ...g, phase: "ended", banked, answers: {}, endsAt: 0 };
}

/** Totals as shown: banked points, plus the current question once it is revealed. */
export function vsScores(g: VsGame): Record<string, number> {
  return g.phase === "reveal" ? bank(g) : { ...g.banked };
}

/**
 * The only thing that leaves the host. Before the reveal it has no answer, no correctness and no given answers.
 * `now` is the host's Date.now(), for msLeft.
 */
export function vsPublic(g: VsGame, now: number): VsState {
  const q = g.questions[g.index];
  const live = (g.phase === "question" || g.phase === "reveal") && !!q;
  const choices = live ? g.choices[g.index] : undefined;
  const state: VsState = {
    phase: g.phase,
    index: g.index,
    total: g.questions.length,
    question: live ? q.question : null,
    category: live ? q.category : null,
    msLeft: g.phase === "question" ? Math.max(0, Math.round(g.endsAt - now)) : 0,
    seconds: g.seconds,
    answered: live ? Object.keys(g.answers) : [],
    scores: vsScores(g),
    names: { ...g.names },
  };
  if (live) {
    state.topic = q.topic;
    state.difficulty = q.difficulty;
    if (choices && choices.length > 0) state.choices = choices.slice();
  }
  if (g.phase === "reveal" && q) {
    const results: Record<string, VsResult> = {};
    for (const [id, a] of Object.entries(g.answers)) results[id] = { correct: a.correct, points: a.points, given: a.value };
    state.reveal = { answer: q.answer, results };
    if (q.fact) state.reveal.fact = q.fact;
  }
  return state;
}

/** After a host refresh: an open question keeps its deadline, or gets a fresh timer if it ran out meanwhile. */
export function vsResume(g: VsGame, now: number): VsGame {
  if (g.phase !== "question" || g.endsAt > now) return g;
  return { ...g, endsAt: now + g.seconds * 1000 };
}

/** Time left on a player's screen: the host's msLeft minus the time since that state arrived (performance.now()). */
export function countdownLeft(msLeft: number, arrivedAt: number, now: number): number {
  return Math.max(0, msLeft - Math.max(0, now - arrivedAt));
}

/* =====================================================================================
   setup (stored in localStorage)
   ===================================================================================== */

export type Mode = "solo" | "versus";

export interface Setup {
  mode: Mode;
  categories: TriviaCategory[];
  difficulty: DifficultyFilter;
  /** Versus only (Solo is always SOLO_COUNT). */
  count: 10 | 20 | 30;
  /** Versus only (Solo is always SOLO_SECONDS). */
  seconds: 15 | 20 | 30;
}

export const DEFAULT_SETUP: Setup = { mode: "solo", categories: [...CATEGORY_IDS], difficulty: "any", count: 10, seconds: 20 };

export function parseSetup(v: unknown): Setup {
  const s = isObj(v) ? v : {};
  const cats = Array.isArray(s.categories) ? CATEGORY_IDS.filter((c) => (s.categories as unknown[]).includes(c)) : DEFAULT_SETUP.categories;
  return {
    mode: s.mode === "versus" ? "versus" : "solo",
    categories: cats.length > 0 ? cats : [...DEFAULT_SETUP.categories],
    difficulty: s.difficulty === 1 || s.difficulty === 2 || s.difficulty === 3 || s.difficulty === "any" ? s.difficulty : DEFAULT_SETUP.difficulty,
    count: s.count === 10 || s.count === 20 || s.count === 30 ? s.count : DEFAULT_SETUP.count,
    seconds: s.seconds === 15 || s.seconds === 20 || s.seconds === 30 ? s.seconds : DEFAULT_SETUP.seconds,
  };
}

/** How long a round is: Solo is fixed so the leaderboard is fair. */
export function roundPlan(s: Pick<Setup, "mode" | "count" | "seconds">): { count: number; seconds: number } {
  return s.mode === "solo" ? { count: SOLO_COUNT, seconds: SOLO_SECONDS } : { count: s.count, seconds: s.seconds };
}

/* ---------- the host's game across a refresh (sessionStorage) ---------- */

export interface SavedHost {
  v: 1;
  setup: Setup;
  game: VsGame;
}

const PHASES: VsPhase[] = ["lobby", "question", "reveal", "ended"];
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecordOf = <T,>(v: unknown, ok: (x: unknown) => x is T): v is Record<string, T> => isObj(v) && Object.values(v).every(ok);
const isAnswer = (a: unknown): a is VsAnswer =>
  isObj(a) && isStr(a.value) && isNum(a.leftMs) && typeof a.correct === "boolean" && isNum(a.points) && a.points >= 0 && a.points <= BASE_POINTS + SPEED_POINTS;

/** Reads the saved host game. Anything that doesn't look exactly right gives null (start over). */
export function parseSavedHost(raw: string | null): SavedHost | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1 || !isObj(v.game)) return null;
  const g = v.game;
  if (!PHASES.includes(g.phase as VsPhase)) return null;
  if (!Array.isArray(g.questions) || !g.questions.every(isPlayable)) return null;
  const questions = g.questions as TriviaQuestion[];
  if (!Array.isArray(g.choices) || g.choices.length !== questions.length) return null;
  const choicesOk = (g.choices as unknown[]).every((c, i) => {
    if (!Array.isArray(c) || !c.every(isStr)) return false;
    const q = questions[i].choices;
    return q ? c.length === 4 && [...c].sort().join("\u0000") === [...q].sort().join("\u0000") : c.length === 0;
  });
  if (!choicesOk) return null;
  if (!isNum(g.seconds) || g.seconds < 5 || g.seconds > 120) return null;
  if (!isNum(g.index) || !Number.isInteger(g.index) || g.index < 0 || (g.index >= questions.length && questions.length > 0)) return null;
  if ((g.phase === "question" || g.phase === "reveal") && questions.length === 0) return null;
  if (!isNum(g.endsAt)) return null;
  if (!isRecordOf(g.answers, isAnswer) || !isRecordOf(g.banked, isNum) || !isRecordOf(g.names, isStr)) return null;
  const game: VsGame = {
    phase: g.phase as VsPhase,
    questions,
    choices: g.choices as string[][],
    seconds: g.seconds,
    index: g.index,
    endsAt: g.endsAt,
    answers: g.answers,
    banked: g.banked,
    names: g.names,
  };
  return { v: 1, setup: parseSetup(v.setup), game };
}

/* =====================================================================================
   admin form
   ===================================================================================== */

export const QUESTION_SOFT_MAX = 120;
export const QUESTION_MAX = 200;
export const ANSWER_MAX = 80;
export const TOPIC_MAX = 40;
export const FACT_MAX = 200;
/** All "other spellings" together (the database allows 600 characters). */
export const ACCEPT_TOTAL_MAX = 600;

/** What the admin form edits. Accept list as one spelling per line. */
export interface QuestionDraft {
  id?: string;
  category: TriviaCategory;
  topic: string;
  difficulty: 1 | 2 | 3;
  question: string;
  answer: string;
  accept: string;
  multipleChoice: boolean;
  choices: [string, string, string, string];
  fact: string;
}

export type DraftField = "category" | "topic" | "difficulty" | "question" | "answer" | "accept" | "choices" | "fact";

export function emptyDraft(category: TriviaCategory = "league"): QuestionDraft {
  return { category, topic: "", difficulty: 2, question: "", answer: "", accept: "", multipleChoice: false, choices: ["", "", "", ""], fact: "" };
}

export function draftFromQuestion(q: TriviaQuestion): QuestionDraft {
  return {
    id: q.id,
    category: q.category,
    topic: q.topic,
    difficulty: q.difficulty,
    question: q.question,
    answer: q.answer,
    accept: (q.accept ?? []).join("\n"),
    multipleChoice: !!q.choices,
    choices: q.choices ? [...q.choices] : ["", "", "", ""],
    fact: q.fact ?? "",
  };
}

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

export interface DraftCheck {
  errors: Partial<Record<DraftField, string>>;
  warnings: Partial<Record<DraftField, string>>;
  /** Ready to save when there are no errors. */
  value: (Omit<TriviaQuestion, "id"> & { id?: string }) | null;
}

export function validateDraft(d: QuestionDraft): DraftCheck {
  const errors: DraftCheck["errors"] = {};
  const warnings: DraftCheck["warnings"] = {};
  const topic = tidy(d.topic).toLowerCase();
  const question = tidy(d.question);
  const answer = tidy(d.answer);
  const fact = tidy(d.fact);

  if (!isCategory(d.category)) errors.category = "Pick a category.";
  if (d.difficulty !== 1 && d.difficulty !== 2 && d.difficulty !== 3) errors.difficulty = "Pick a difficulty.";
  if (!topic) errors.topic = "Add a topic, e.g. lore or 80s.";
  else if (topic.length > TOPIC_MAX) errors.topic = `At most ${TOPIC_MAX} characters.`;
  if (!question) errors.question = "Write the question.";
  else if (question.length > QUESTION_MAX) errors.question = `Too long: ${question.length} of at most ${QUESTION_MAX} characters.`;
  else if (question.length > QUESTION_SOFT_MAX) warnings.question = `${question.length} characters. Up to ${QUESTION_SOFT_MAX} reads better on stream.`;
  if (!answer) errors.answer = "Write the answer.";
  else if (answer.length > ANSWER_MAX) errors.answer = `At most ${ANSWER_MAX} characters.`;
  if (fact.length > FACT_MAX) errors.fact = `At most ${FACT_MAX} characters.`;

  let choices: [string, string, string, string] | undefined;
  let accept: string[] = [];
  if (d.multipleChoice) {
    const c = d.choices.map(tidy) as [string, string, string, string];
    const keys = c.map((x) => x.toLowerCase());
    if (c.some((x) => !x)) errors.choices = "Fill in all 4 choices.";
    else if (c.some((x) => x.length > ANSWER_MAX)) errors.choices = `Each choice at most ${ANSWER_MAX} characters.`;
    else if (new Set(keys).size !== 4) errors.choices = "The 4 choices must all be different.";
    else if (answer && !c.includes(answer)) {
      // Same text in another case still counts; the answer then takes the choice's spelling.
      if (keys.includes(answer.toLowerCase())) choices = c;
      else errors.choices = "One of the choices must be the answer.";
    } else choices = c;
  } else {
    const seen = new Set<string>([answer.toLowerCase()]);
    for (const line of d.accept.split(/\n/)) {
      const a = tidy(line);
      if (!a || seen.has(a.toLowerCase())) continue;
      if (a.length > ANSWER_MAX) {
        errors.accept = `Each spelling at most ${ANSWER_MAX} characters.`;
        break;
      }
      seen.add(a.toLowerCase());
      accept.push(a);
    }
    if (accept.length > 20) errors.accept = "At most 20 other spellings.";
    else if (accept.join("").length > ACCEPT_TOTAL_MAX) errors.accept = `Too long all together: at most ${ACCEPT_TOTAL_MAX} characters.`;
    accept = accept.slice(0, 20);
  }

  if (Object.keys(errors).length > 0) return { errors, warnings, value: null };
  const finalAnswer = choices ? (choices.find((c) => c.toLowerCase() === answer.toLowerCase()) as string) : answer;
  const value: Omit<TriviaQuestion, "id"> & { id?: string } = { category: d.category, topic, difficulty: d.difficulty, question, answer: finalAnswer };
  if (d.id) value.id = d.id;
  if (choices) value.choices = choices;
  if (accept.length > 0) value.accept = accept;
  if (fact) value.fact = fact;
  return { errors, warnings, value };
}

/* =====================================================================================
   keyboard
   ===================================================================================== */

/** True when a key event comes from a text field, so shortcuts should be ignored. */
export function isTypingTarget(t: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** True for a focused button or link: there Enter and Space must keep clicking it, not run a shortcut. */
export function isControlTarget(t: { tagName?: string; getAttribute?: (n: string) => string | null } | null | undefined): boolean {
  if (!t) return false;
  const tag = (t.tagName ?? "").toUpperCase();
  return tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || t.getAttribute?.("role") === "button";
}
