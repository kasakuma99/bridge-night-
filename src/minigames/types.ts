import type { ComponentType } from "react";

/**
 * The shared contract for every Arcade minigame.
 * A game lives in src/minigames/<id>/, exports its MinigameDef from index.ts,
 * and is listed in src/minigames/registry.ts.
 *
 * Every game has its own setup screen where the player picks Solo (scores go on a leaderboard)
 * or Versus (a live room: the host streams on Discord, friends logged in on the site join and
 * answer on their own device). Rooms: src/minigames/room/.
 */

/** One leaderboard. A game can have several (e.g. one per picture mode). */
export interface Board {
  /** Stable: the key in public.minigame_games / minigame_scores. Must match the migrations. */
  id: string;
  /** Tab label, e.g. "Pixelated". */
  label: string;
  /** Highest possible score in one solo round. The server rejects anything above it. */
  maxScore: number;
  /** What the number means ("points"). */
  scoreLabel: string;
  /** true for times (lower wins). */
  lowerIsBetter?: boolean;
}

export interface MinigameProps {
  /** Solo rounds call this once when a round ends. The Arcade page saves it to that board. */
  onScore: (boardId: string, score: number) => void;
  /** Back to the Arcade list. */
  onExit: () => void;
  /** Call when a solo round, a room lobby or a Versus game starts: the page scrolls the game frame into view. */
  onPlay: () => void;
  /** Set when the page was opened with ?room=CODE (a join link or the "Open rooms" list): join that room right away. */
  joinCode: string | null;
}

export interface MinigameDef {
  /** URL-safe and stable: used in /arcade/<id>. */
  id: string;
  name: string;
  /** One line on the game card. */
  blurb: string;
  /** Solo leaderboards, in tab order. */
  boards: Board[];
  /** The game screen, loaded only when opened. */
  load: () => Promise<{ default: ComponentType<MinigameProps> }>;
}

/* ---------- data shown around the games (filled by src/minigames/data.ts) ---------- */

export interface ScoreRow {
  playerId: string;
  name: string;
  score: number;
  /** ISO time. */
  at: string;
}

export interface OnlineUser {
  /** Player id when known, otherwise the auth user id. */
  id: string;
  name: string;
  /** Discord avatar URL, if any. */
  avatar?: string | null;
}

/** How full the League lobby is, from the helper's live data. null = no lobby right now. */
export interface LobbyState {
  inLobby: number;
  of: number;
  /** Short text such as "Champ select" or "Waiting for players". */
  phase: string;
}
