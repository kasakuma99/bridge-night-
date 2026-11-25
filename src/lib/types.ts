export type Side = "blue" | "red";
export type TeamSize = 1 | 2 | 3 | 4 | 5;
export type TeamStyle = "random" | "balanced" | "captains";

export interface Player {
  id: string;
  name: string;
  /** Riot ID (Name#TAG). Only ever shown to logged-in members. */
  riotId?: string;
  /** Removed players stay in old matches but are hidden everywhere else. */
  active: boolean;
  createdAt: number;
}

export interface ParticipantStats {
  champion?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  /** Data Dragon item ids, only when the helper app sent them. */
  items?: number[];
  damage?: number;
  level?: number;
  /** Summoner spells (Data Dragon numbers). */
  spells?: number[];
  /** Augments (Community Dragon ids), in the order they were picked. */
  augments?: number[];
}

export interface DodgeEntry {
  playerId: string;
  champion: string;
  side: Side;
  at: number;
}

export interface Match {
  id: string;
  /** When the result was saved (ms since epoch). */
  playedAt: number;
  mode: TeamSize;
  blue: string[];
  red: string[];
  winner: Side;
  stats: Record<string, ParticipantStats>;
  dodges: DodgeEntry[];
  sitOut: string[];
  challenge?: string;
  durationMin?: number;
  /** Riot game id (from the helper), used to deduplicate. */
  gameId?: string;
  /** Live game id it came from, so the same live game is never saved twice. */
  liveId?: string;
  /** The losing team surrendered ("ff"), or surrendered early ("early"). */
  surrender?: Surrender;
  /** How it ended, when League told us. */
  end?: EndReason;
  durationSec?: number;
  /** Bots, and people who aren't on the site. */
  guests?: FeedPlayer[];
  gameMode?: string;
  map?: string;
}

export type Surrender = "ff" | "early";

export type LivePhase = "draft" | "select" | "playing" | "result";

export interface CaptainDraft {
  pool: string[];
  order: Side[];
  i: number;
  log: string[];
}

export interface LiveGame {
  id: string;
  phase: LivePhase;
  size: TeamSize;
  blue: string[];
  red: string[];
  sitOut: string[];
  captains?: CaptainDraft;
  /** How the teams were made (for rerolls). */
  style?: TeamStyle;
  stats: Record<string, ParticipantStats>;
  dodgeLog: DodgeEntry[];
  challenge?: string;
  createdAt: number;
  lockedAt?: number;
  startedAt?: number;
  durationMin?: number;
  surrender?: Surrender;
}

/* ---------- the live game, as League reports it ---------- */

/** "left": the whole losing team left, which counts as a surrender. */
export type EndReason = "nexus" | "ff" | "early" | "left" | "unknown";

export type FeedStatus = "select" | "loading" | "playing" | "ended";

export interface FeedPlayer {
  key: string;
  /** Player of the site. Missing for bots and guests. */
  playerId?: string;
  /** Only between League and the site, never stored. */
  riotId?: string;
  bot?: boolean;
  side: Side;
  champion?: string;
  level?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  damage?: number;
  items: number[];
  spells: number[];
  augments?: number[];
  dead?: boolean;
}

export interface FeedEvent {
  id: number;
  /** Seconds on the game clock. */
  time: number;
  type: "start" | "kill" | "firstblood" | "multikill" | "ace" | "firstturret" | "turret" | "inhibitor";
  /** Player keys. */
  by?: string;
  byThing?: string;
  victim?: string;
  helpers?: string[];
  /** Ace: the team that made it. Turret and inhibitor: the team that lost it. */
  side?: Side;
  n?: number;
}

export interface FeedEnd {
  at: number;
  winner?: Side;
  reason?: EndReason;
  /** The result came from League's own end-of-game data. */
  sure?: boolean;
  /** League says the game was not finished. */
  aborted?: boolean;
  durationSec?: number;
}

export interface LiveFeed {
  id: string;
  gameId?: string;
  status: FeedStatus;
  mode?: string;
  map?: string;
  players: FeedPlayer[];
  events: FeedEvent[];
  clock?: { sec: number; at: number };
  startedAt: number;
  updatedAt: number;
  end?: FeedEnd;
  /** What a member decided for a game without a winner. */
  choice?: Side | "skip";
  /** The saved game, so a deleted one doesn't come back. */
  savedAs?: string;
}

export interface Settings {
  dodgeHours: number;
  dodgesPerTeam: number;
  /** -1 = no limit */
  rerollLimit: number;
  challengesEnabled: boolean;
  discordUrl: string;
}

export interface AppData {
  players: Player[];
  matches: Match[];
  live: LiveGame | null;
  /** The game League is playing right now, or just finished. */
  feed?: LiveFeed | null;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  dodgeHours: 12,
  dodgesPerTeam: 2,
  rerollLimit: 2,
  challengesEnabled: true,
  discordUrl: "https://discord.gg/mEAF2C9Qq",
};
