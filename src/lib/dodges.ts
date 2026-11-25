import type { LiveGame, Match, Settings, Side } from "./types";
import { HOUR } from "./util";

export interface DodgeStatus {
  /** Rule switched off (0 dodges per team). */
  off: boolean;
  /** The next game starts a new night (12h+ since the last saved game). */
  freshNight: boolean;
  lastGameAt: number | null;
  /** ms since the last saved game (Infinity if none). */
  sinceLast: number;
  /** ms until a 12h break is reached (0 if already fresh). */
  untilFresh: number;
  perTeam: number;
  used: Record<Side, number>;
  left: Record<Side, number>;
}

/**
 * Our house rule: after a break of `dodgeHours` or more, a new night starts. During that night
 * Blue side and Red side each have `dodgesPerTeam` dodges in total, shared across every game of
 * the night. The night lasts until the next break of `dodgeHours` or more.
 */
export function dodgeStatus(matches: Match[], s: Settings, now: number, live?: LiveGame | null): DodgeStatus {
  const need = s.dodgeHours * HOUR;
  const sorted = matches.slice().sort((a, b) => b.playedAt - a.playedAt);
  const last = sorted[0]?.playedAt ?? null;
  const sinceLast = last == null ? Infinity : now - last;
  const freshNight = sinceLast >= need;
  const used: Record<Side, number> = { blue: 0, red: 0 };
  if (!freshNight) {
    // Walk back through tonight's games until a long enough break.
    for (let i = 0; i < sorted.length; i++) {
      for (const d of sorted[i].dodges ?? []) used[d.side]++;
      const prev = sorted[i + 1];
      if (!prev || sorted[i].playedAt - prev.playedAt >= need) break;
    }
  }
  if (live && live.phase !== "draft") for (const d of live.dodgeLog) used[d.side]++;
  const per = Math.max(0, s.dodgesPerTeam);
  return {
    off: per === 0,
    freshNight,
    lastGameAt: last,
    sinceLast,
    untilFresh: freshNight ? 0 : need - sinceLast,
    perTeam: per,
    used,
    left: { blue: Math.max(0, per - used.blue), red: Math.max(0, per - used.red) },
  };
}
