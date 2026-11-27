import type { Board, MinigameDef } from "./types";
import { CHAMP_GUESSER } from "./champ-guesser";
import { triviaDefs } from "./trivia";

/**
 * Every Arcade game. Add a game by importing its defs here; the order is the order on the page.
 * Every board id here must also be in public.minigame_games (supabase/migrations).
 */
export const MINIGAMES: MinigameDef[] = [...CHAMP_GUESSER, ...triviaDefs];

export const findGame = (id: string | undefined) => MINIGAMES.find((g) => g.id === id);

/** A leaderboard and the game it belongs to. */
export function findBoard(boardId: string | undefined): { game: MinigameDef; board: Board } | undefined {
  for (const game of MINIGAMES) {
    const board = game.boards.find((b) => b.id === boardId);
    if (board) return { game, board };
  }
  return undefined;
}
