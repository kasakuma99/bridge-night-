import type { AppData, Match, Player, Side, TeamSize } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { FALLBACK_CHAMPIONS, CHALLENGES, SAMPLE_ITEM_NAMES } from "../lib/champions";
import { DAY, HOUR, seeded, shuffle } from "../lib/util";

/** Our real group. Riot IDs are added later on the Players page. */
export const ROSTER = ["Samu", "Nick", "Phillip", "Lenny", "Francesco", "Tosh", "Arthur", "Mantas", "Ilia", "Emilian"];

export function rosterPlayers(now = Date.now()): Player[] {
  return ROSTER.map((name, i) => ({ id: "p" + i, name, active: true, createdAt: now - DAY * 60 + i }));
}

/** Launch data: real players, empty history. */
export function emptyData(now = Date.now()): AppData {
  return { players: rosterPlayers(now), matches: [], live: null, settings: { ...DEFAULT_SETTINGS } };
}

/** Sample data for local development only: ~34 fake games over the last 6 weeks. */
export function sampleData(now = Date.now()): AppData {
  const r = seeded(51);
  const players = rosterPlayers(now);
  players[0].riotId = "Samu#EUW";
  players[1].riotId = "NickTheQuick#EUW";
  const skill = [0.66, 0.4, 0.52, 0.5, 0.55, 0.47, 0.5, 0.5, 0.45, 0.48];
  const sk = (id: string) => skill[+id.slice(1)];
  const items = Object.keys(SAMPLE_ITEM_NAMES).map(Number);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const evening = (daysAgo: number, f: number) => midnight.getTime() - daysAgo * DAY + 19 * HOUR + f * 4 * HOUR;
  const matches: Match[] = [];
  let n = 0;
  const mk = (blue: string[], red: string[], winner: Side, t: number, sitOut: string[], withItems: boolean) => {
    const stats: Match["stats"] = {};
    for (const p of [...blue, ...red]) {
      const won = (winner === "blue") === blue.includes(p);
      stats[p] = {
        champion: FALLBACK_CHAMPIONS[Math.floor(r() * FALLBACK_CHAMPIONS.length)],
        kills: Math.floor(r() * 10 + sk(p) * 8 + (won ? 3 : 0)),
        deaths: Math.floor(r() * 8 + 3 - (won ? 2 : 0)),
        assists: Math.floor(r() * 20 + 12),
        ...(withItems ? { items: shuffle(items, r).slice(0, 6), damage: Math.floor(18000 + r() * 30000) } : {}),
      };
    }
    matches.push({
      id: "m" + n++,
      playedAt: Math.round(t),
      mode: blue.length as TeamSize,
      blue,
      red,
      winner,
      stats,
      dodges: [],
      sitOut,
      durationMin: Math.floor(14 + r() * 12),
    });
  };
  const ids = players.map((p) => p.id);
  for (let i = 0; i < 28; i++) {
    const tonight = shuffle(ids, r).slice(0, 6 + Math.floor(r() * 3));
    const size = r() < 0.6 ? 3 : 2;
    const pool = tonight.slice(0, size * 2);
    const blue = pool.slice(0, size);
    const red = pool.slice(size);
    const avg = (t: string[]) => t.reduce((a, p) => a + sk(p), 0) / t.length;
    const winner: Side = r() < 0.5 + (avg(blue) - avg(red)) * 1.6 ? "blue" : "red";
    mk(blue, red, winner, evening(40 - i, r()), tonight.slice(size * 2), i > 20);
  }
  // A few recent nights so streaks, rivalries and awards show up.
  mk(["p0", "p2"], ["p1", "p4"], "blue", evening(4, 0.1), ["p3", "p5"], true);
  mk(["p1", "p3", "p5"], ["p0", "p2", "p4"], "red", evening(4, 0.3), [], true);
  mk(["p0", "p5", "p6"], ["p1", "p3", "p7"], "blue", evening(2, 0.2), ["p2"], true);
  mk(["p1", "p2", "p4"], ["p0", "p3", "p5"], "red", evening(2, 0.45), ["p6"], true);
  mk(["p0", "p6"], ["p1", "p8"], "blue", evening(1, 0.25), ["p9"], true);
  matches[20].challenge = CHALLENGES[2];
  matches[25].challenge = CHALLENGES[0];
  matches[30].challenge = CHALLENGES[5];
  matches[29].dodges = [{ playerId: "p1", champion: "Yuumi", side: "blue", at: matches[29].playedAt - 30 * 6e4 }];
  matches[29].stats.p1.champion = "Ezreal";
  return { players, matches, live: null, settings: { ...DEFAULT_SETTINGS } };
}
