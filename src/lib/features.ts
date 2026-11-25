import type { Badge } from "./stats";
import type { TeamStyle } from "./types";

/**
 * What the site shows. What is false is hidden, but the code, tests and stored data stay:
 * set a value to true to bring a feature back.
 */
export interface Features {
  /**
   * The other Teams page (hero, captains, who sits out, options, locking teams by hand), from samu-dev. Off: the "Create random teams" page.
   * teamModes, rerollLimit, and the bounty and dodge info on the Teams page need this one too.
   */
  classicTeams: boolean;
  /** Rivals page, and on the other Teams page the rivalry banner and messages. */
  rivals: boolean;
  /** Builds page. */
  builds: boolean;
  /** Balanced and Captains modes. Off: teams are always random. */
  teamModes: boolean;
  /** Bounties on win streaks. */
  bounties: boolean;
  /** Reroll limit. Off: unlimited rerolls. */
  rerollLimit: boolean;
  /** Dodge rule in champ select. */
  dodges: boolean;
  /** Random challenges. */
  challenges: boolean;
  /** Only approved members see anything. Off: visitors can watch (the database must allow that too). */
  privateSite: boolean;
  /** A page per player (/stats/:id). Off: the side card on the Stats page. */
  playerPages: boolean;
  /** Games with our players on one side only (alone, or against bots) are saved and counted. For testing: switch off before release. */
  soloGames: boolean;
  /** Calculated Elo ratings. Off: everyone has a fixed number of Papi Points. */
  ratings: boolean;
}

export const FEATURES: Features = {
  classicTeams: false,
  rivals: true,
  builds: false,
  teamModes: false,
  bounties: false,
  rerollLimit: false,
  dodges: false,
  challenges: false,
  privateSite: true,
  playerPages: false,
  soloGames: true,
  ratings: false,
};

/* ---------- Papi Points ---------- */

/** Everyone has this many for now. Games don't change it. */
export const PAPI_POINTS = 1000;
export const fmtPoints = (n: number) => n.toLocaleString("en-GB");
export const POINTS_NAME = FEATURES.ratings ? "Rating" : "Papi Points";

/** The number next to a player: their rating, or the fixed Papi Points. */
export const shownPoints = (rating: number, f: Features = FEATURES) => (f.ratings ? String(rating) : fmtPoints(PAPI_POINTS));
/** The same as a number. Weighted teams use it, so with Papi Points everyone counts the same. */
export const pointsOf = (rating: number, f: Features = FEATURES) => (f.ratings ? rating : PAPI_POINTS);
/** "Rating 1016" or "1,000 Papi Points". */
export const pointsLabel = (rating: number, f: Features = FEATURES) =>
  f.ratings ? `Rating ${rating}` : `${fmtPoints(PAPI_POINTS)} Papi Points`;

/* ---------- what changes when a feature is off ---------- */

export const visibleBadges = (bs: Badge[], f: Features = FEATURES) =>
  bs.filter((b) => (f.bounties || b.title !== "Bounty hunter") && (f.ratings || b.title !== "Giant slayer"));

/** A browser may still remember Balanced or Captains. The saved choice is kept, just not used. */
export const usedTeamStyle = (saved: TeamStyle, f: Features = FEATURES): TeamStyle => (f.teamModes ? saved : "random");

/** -1 = no limit. */
export const usedRerollLimit = (setting: number, f: Features = FEATURES) => (f.rerollLimit ? setting : -1);

/** Leaderboard order without ratings: wins, then win rate, then games, then name. */
export function byWins(name: (id: string) => string) {
  type Row = { id: string; g: number; w: number };
  return (a: Row, b: Row) =>
    b.w - a.w || b.w / Math.max(1, b.g) - a.w / Math.max(1, a.g) || b.g - a.g || name(a.id).localeCompare(name(b.id));
}
