export type Side = "blue" | "red";
export type TeamSize = 1 | 2 | 3 | 4;
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
}

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
  stats: Record<string, ParticipantStats>;
  dodgeLog: DodgeEntry[];
  challenge?: string;
  createdAt: number;
  lockedAt?: number;
  startedAt?: number;
  durationMin?: number;
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
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  dodgeHours: 12,
  dodgesPerTeam: 2,
  rerollLimit: 2,
  challengesEnabled: true,
  discordUrl: "https://discord.gg/mEAF2C9Qq",
};
