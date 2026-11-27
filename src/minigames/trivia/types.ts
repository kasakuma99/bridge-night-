/** Trivia categories, in the order the setup screen shows them. Admins can switch any of them off. */
export const TRIVIA_CATEGORIES = [
  { id: "league", label: "League of Legends" },
  { id: "music", label: "Music" },
  { id: "film-tv", label: "Film & TV" },
  { id: "games", label: "Video games" },
  { id: "geography", label: "Geography" },
  { id: "science", label: "Science & nature" },
  { id: "history", label: "History" },
  { id: "sport", label: "Sport" },
  { id: "food", label: "Food & drink" },
  { id: "general", label: "General knowledge" },
] as const;

export type TriviaCategory = (typeof TRIVIA_CATEGORIES)[number]["id"];

/** One trivia question: built in (./questions/*.ts) or added by an admin (stored in Supabase). */
export interface TriviaQuestion {
  /** Stable and unique. Built in: "league-0001", "general-0001"... Admin-added: "custom-<uuid>". Never reuse or renumber. */
  id: string;
  category: TriviaCategory;
  /** Finer label inside the category, e.g. "lore", "esports", "80s". */
  topic: string;
  /** 1 easy, 2 medium, 3 hard. */
  difficulty: 1 | 2 | 3;
  /** At most ~120 characters, readable on a shrunk stream. */
  question: string;
  answer: string;
  /** Open questions: other spellings that also count as right in auto-checking (e.g. "UK" for "United Kingdom"). */
  accept?: string[];
  /** Optional multiple choice: 4 options, one of them equal to `answer`. */
  choices?: [string, string, string, string];
  /** One short line shown after the reveal. */
  fact?: string;
}

/** What admins set for trivia (one row in Supabase). */
export interface TriviaSettings {
  /** Categories nobody can pick. */
  disabled: TriviaCategory[];
  /** "What we like": free text for whoever writes the next batch of questions (not used by the game itself). */
  notes: string;
}
