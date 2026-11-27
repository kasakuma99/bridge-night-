import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawScore } from "../lib/arcade";

/*
 * The Arcade's part of the database: public.minigame_scores, the view public.minigame_best and the members link
 * (supabase/migrations/20261126120000_minigame_scores.sql). Row Level Security decides who may do what; these
 * functions only turn the answers into something the page can show.
 */

interface PgErr {
  code?: string;
  message?: string;
}

/** A readable message for a failed insert. The database's own P0001 messages are written for people. */
export function scoreError(e: PgErr | null | undefined): Error {
  const msg = e?.message ?? "";
  if (e?.code === "42501" || /row-level security|permission denied|members only/i.test(msg))
    return new Error("Only approved members can save scores. An admin has to let you in first.");
  if (e?.code === "P0001" && msg) return new Error(msg.replace(/\.?$/, "."));
  if (e?.code === "23503") return new Error("Unknown game.");
  if (e?.code === "23514") return new Error("That score is not possible in this game.");
  return new Error("Could not save the score. Check your connection and try again.");
}

/** Each player's best score on one leaderboard, best first. The column is still called game_id; it holds Board ids. */
export async function fetchBest(sb: SupabaseClient, boardId: string, lowerIsBetter: boolean, limit: number): Promise<RawScore[]> {
  const { data, error } = await sb
    .from("minigame_best")
    .select("player_id,score,created_at")
    .eq("game_id", boardId)
    .order("score", { ascending: lowerIsBetter })
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;
  return ((data ?? []) as { player_id: string; score: number; created_at: string }[]).map((r) => ({
    playerId: r.player_id,
    score: r.score,
    at: Date.parse(r.created_at),
  }));
}

/** Saves a round for the logged-in member. The database fills in the player and the time, and checks the score. */
export async function insertScore(sb: SupabaseClient, boardId: string, score: number): Promise<void> {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("Log in with Discord to save your score.");
  const { error } = await sb.from("minigame_scores").insert({ game_id: boardId, score });
  if (error) throw scoreError(error);
}

/** The player linked to this login (members.player_id; you may read your own member row). */
export async function fetchMyPlayerId(sb: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await sb.from("members").select("player_id").eq("user_id", userId).maybeSingle();
  if (error) return null;
  return (data as { player_id: string | null } | null)?.player_id ?? null;
}

/* ---------- trivia that admins edit: public.trivia_questions and public.trivia_settings ---------- */
/* (20261127100000_arcade_rooms_trivia.sql: members read, admins write) */

const ADMINS_ONLY = "Only admins can change trivia.";

/** A readable message for a failed trivia change. */
export function triviaError(e: PgErr | null | undefined): Error {
  const msg = e?.message ?? "";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(msg)) return new Error(ADMINS_ONLY);
  if (e?.code === "23514") return new Error("That question doesn't fit the rules (length, 4 options with the answer, category).");
  if (e?.code === "23505") return new Error("A question with this id already exists.");
  return new Error("Could not save. Check your connection and try again.");
}

/** Every admin-added question (oldest first) and the settings row, as stored. Checking happens in the caller. */
export async function fetchTrivia(sb: SupabaseClient): Promise<{ questions: unknown[]; settings: unknown }> {
  const [q, s] = await Promise.all([
    sb.from("trivia_questions").select("id,category,topic,difficulty,question,answer,accept,choices,fact").order("created_at").limit(2000),
    sb.from("trivia_settings").select("disabled,notes").eq("id", 1).maybeSingle(),
  ]);
  if (q.error) throw q.error;
  if (s.error) throw s.error;
  return { questions: q.data ?? [], settings: s.data };
}

type QuestionRow = {
  category: string;
  topic: string;
  difficulty: number;
  question: string;
  answer: string;
  accept: string[];
  choices: string[] | null;
  fact: string | null;
};

async function loggedIn(sb: SupabaseClient) {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error("Log in with Discord first.");
}

/*
 * Writes ask for a row count, not the rows back: members may only read some columns (not created_by / updated_by),
 * and RLS makes a non-admin's update or delete hit 0 rows instead of failing, so 0 = not allowed (or already gone).
 */

/** New question (`isNew`) or a change. */
export async function writeTriviaQuestion(sb: SupabaseClient, id: string, row: QuestionRow, isNew: boolean): Promise<void> {
  await loggedIn(sb);
  if (isNew) {
    const { error } = await sb.from("trivia_questions").insert({ id, ...row }); // RLS refuses non-admins with an error
    if (error) throw triviaError(error);
    return;
  }
  const { error, count } = await sb.from("trivia_questions").update(row, { count: "exact" }).eq("id", id);
  if (error) throw triviaError(error);
  if (!count) throw new Error("That question is gone, or only admins can change it.");
}

export async function removeTriviaQuestion(sb: SupabaseClient, id: string): Promise<void> {
  await loggedIn(sb);
  const { error, count } = await sb.from("trivia_questions").delete({ count: "exact" }).eq("id", id);
  if (error) throw triviaError(error);
  if (!count) throw new Error("That question is gone, or only admins can delete it.");
}

export async function writeTriviaSettings(sb: SupabaseClient, disabled: string[], notes: string): Promise<void> {
  await loggedIn(sb);
  const { error, count } = await sb.from("trivia_settings").update({ disabled, notes }, { count: "exact" }).eq("id", 1);
  if (error) throw triviaError(error);
  if (!count) throw new Error(ADMINS_ONLY);
}
