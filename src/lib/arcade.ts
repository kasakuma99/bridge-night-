import { showFeed } from "./live";
import type { LiveFeed } from "./types";
import type { LobbyState, OnlineUser } from "../minigames/types";
import { TRIVIA_CATEGORIES, type TriviaCategory, type TriviaQuestion, type TriviaSettings } from "../minigames/trivia/types";

/* Pure helpers for the Arcade data (src/minigames/data.ts). No React, no Supabase: tested in tests/arcade.test.ts. */

/** One saved round. `name` is only used when the player isn't in the players list (local preview). */
export interface RawScore {
  playerId: string;
  score: number;
  /** ms since epoch */
  at: number;
  name?: string;
}

/** Best first. Same score: whoever got it first stays ahead. */
export function compareScores(lowerIsBetter = false) {
  return (a: RawScore, b: RawScore) => (lowerIsBetter ? a.score - b.score : b.score - a.score) || a.at - b.at;
}

/** Each player's best round, best first, at most `limit` rows. */
export function bestPerPlayer(rows: readonly RawScore[], lowerIsBetter = false, limit = Infinity): RawScore[] {
  const cmp = compareScores(lowerIsBetter);
  const best = new Map<string, RawScore>();
  for (const r of rows) {
    if (!r.playerId || !Number.isFinite(r.score)) continue;
    const old = best.get(r.playerId);
    if (!old || cmp(r, old) < 0) best.set(r.playerId, r);
  }
  return [...best.values()].sort(cmp).slice(0, Math.max(0, limit));
}

/** What a leaderboard (Board) accepts. Mirrors the database check (minigame_games in the migrations). */
export function checkScore(score: number, maxScore: number | undefined): number {
  if (typeof score !== "number" || !Number.isFinite(score)) throw new Error("That score can't be saved.");
  const s = Math.round(score);
  if (s < 0 || (maxScore != null && s > maxScore)) throw new Error("That score is not possible in this game.");
  return s;
}

const AVATAR = "https://cdn.discordapp.com/";

/**
 * Presence lists one entry per open tab. Keep one per person (by id), drop broken entries, and never show an
 * avatar that isn't from Discord (any member can put anything into their presence). Sorted by name.
 */
export function dedupeOnline(entries: readonly unknown[]): OnlineUser[] {
  const seen = new Map<string, OnlineUser>();
  for (const e of entries) {
    const x = (e ?? {}) as Record<string, unknown>;
    const id = typeof x.id === "string" ? x.id.slice(0, 64) : "";
    const name = typeof x.name === "string" ? x.name.trim().slice(0, 40) : "";
    if (!id || !name || seen.has(id)) continue;
    const avatar = typeof x.avatar === "string" && x.avatar.startsWith(AVATAR) ? x.avatar.slice(0, 300) : null;
    seen.set(id, { id, name, avatar });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A 5v5 custom game is the biggest lobby we play. */
export const LOBBY_SIZE = 10;

/**
 * The League lobby, from the live feed the helper sends (data.feed, see src/lib/live.ts).
 *
 * What the feed knows: the helper only starts a feed when League enters champ select. Before that (players still
 * joining the custom lobby) nothing is sent, so there is no "waiting" state to show. `feed.players` holds every slot
 * the helper saw: in champ select both custom teams from the lobby (customTeam100/200, bots included) plus the champ
 * select teams; in the game everyone in it. Guests and bots take a slot too, so they count. The feed never says how
 * big the lobby is meant to be, so `of` is 10 (5v5), or more if somehow more were seen.
 *
 * feed.status -> phase:
 *   "select"  -> "Champ select" ("Waiting for players" while nobody is listed yet)
 *   "loading" -> "Loading in"
 *   "playing" -> "In game"
 *   "ended", skipped, too old for the Live page, or no update for LOBBY_GONE_MS (helper closed) -> null (no lobby)
 * The Live page already warns after 15 s without updates (isStale); the lobby waits longer, because the page clock
 * only ticks every 30 s and a quiet champ select is normal.
 */
export const LOBBY_GONE_MS = 2 * 60_000;

export function lobbyFromFeed(feed: LiveFeed | null | undefined, now: number): LobbyState | null {
  if (!showFeed(feed, now) || feed.status === "ended" || now - feed.updatedAt > LOBBY_GONE_MS) return null;
  const inLobby = feed.players.length;
  const phase =
    feed.status === "select" ? (inLobby ? "Champ select" : "Waiting for players") : feed.status === "loading" ? "Loading in" : "In game";
  return { inLobby, of: Math.max(LOBBY_SIZE, inLobby), phase };
}

/* ---------- trivia that admins edit (src/minigames/trivia/data.ts) ---------- */

const CATEGORY_IDS = new Set<string>(TRIVIA_CATEGORIES.map((c) => c.id));
export const isTriviaCategory = (c: unknown): c is TriviaCategory => typeof c === "string" && CATEGORY_IDS.has(c);

/** Limits of public.trivia_questions / trivia_settings (20261127100000_arcade_rooms_trivia.sql). */
export const TRIVIA_LIMITS = { question: 200, answer: 100, topic: 40, fact: 300, accept: 10, notes: 4000 } as const;

const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");

/**
 * A question as an admin typed it -> what gets saved, or a readable Error. The same rules as the database, so the
 * message comes before the request. Empty `accept`, `choices` and `fact` are left out.
 */
export function checkTriviaQuestion(q: Partial<Omit<TriviaQuestion, "id">>): Omit<TriviaQuestion, "id"> {
  const L = TRIVIA_LIMITS;
  if (!isTriviaCategory(q.category)) throw new Error("Pick a category.");
  const question = str(q.question);
  const answer = str(q.answer);
  const topic = str(q.topic);
  if (!question) throw new Error("Write a question.");
  if (question.length > L.question) throw new Error(`The question can be at most ${L.question} characters.`);
  if (!answer) throw new Error("Write the answer.");
  if (answer.length > L.answer) throw new Error(`The answer can be at most ${L.answer} characters.`);
  if (topic.length > L.topic) throw new Error(`The topic can be at most ${L.topic} characters.`);
  const difficulty = Number(q.difficulty);
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) throw new Error("Pick a difficulty from 1 to 3.");

  const accept = [...new Set((Array.isArray(q.accept) ? q.accept : []).map(str).filter((a) => a && a !== answer))];
  if (accept.length > L.accept) throw new Error(`At most ${L.accept} other spellings.`);
  if (accept.some((a) => a.length > L.answer)) throw new Error(`Other spellings can be at most ${L.answer} characters.`);
  if (accept.join("").length > 600) throw new Error("The other spellings are too long together.");

  const rawChoices = (Array.isArray(q.choices) ? q.choices : []).map(str);
  let choices: [string, string, string, string] | undefined;
  if (rawChoices.some(Boolean)) {
    if (rawChoices.length !== 4 || rawChoices.some((c) => !c)) throw new Error("Multiple choice needs exactly 4 options.");
    if (rawChoices.some((c) => c.length > L.answer)) throw new Error(`Each option can be at most ${L.answer} characters.`);
    if (!rawChoices.includes(answer)) throw new Error("One of the 4 options has to be the answer, written the same way.");
    if (new Set(rawChoices.map((c) => c.toLowerCase())).size !== 4) throw new Error("The 4 options have to be different.");
    choices = rawChoices as [string, string, string, string];
  }
  const fact = str(q.fact);
  if (fact.length > L.fact) throw new Error(`The fact can be at most ${L.fact} characters.`);

  return {
    category: q.category,
    topic,
    difficulty,
    question,
    answer,
    ...(accept.length ? { accept } : {}),
    ...(choices ? { choices } : {}),
    ...(fact ? { fact } : {}),
  };
}

/** Settings as typed -> what gets saved: known categories only, once each, in the setup screen's order. */
export function checkTriviaSettings(s: Partial<TriviaSettings>): TriviaSettings {
  const notes = typeof s.notes === "string" ? s.notes : "";
  if (notes.length > TRIVIA_LIMITS.notes) throw new Error(`The notes can be at most ${TRIVIA_LIMITS.notes} characters.`);
  const want = new Set(Array.isArray(s.disabled) ? s.disabled : []);
  return { disabled: TRIVIA_CATEGORIES.map((c) => c.id).filter((id) => want.has(id)), notes };
}

/** A stored question (database row or localStorage), or null when it doesn't fit the rules any more. */
export function readTriviaQuestion(x: unknown): TriviaQuestion | null {
  const o = (x ?? {}) as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^custom-[a-z0-9-]{1,60}$/.test(o.id)) return null;
  try {
    const q = checkTriviaQuestion({
      category: o.category as TriviaCategory,
      topic: o.topic as string,
      difficulty: o.difficulty as 1,
      question: o.question as string,
      answer: o.answer as string,
      accept: Array.isArray(o.accept) ? (o.accept as string[]) : undefined,
      choices: Array.isArray(o.choices) ? (o.choices as [string, string, string, string]) : undefined,
      fact: typeof o.fact === "string" ? o.fact : undefined,
    });
    return { id: o.id, ...q };
  } catch {
    return null;
  }
}
