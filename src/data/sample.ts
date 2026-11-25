import type { AppData, Match, Player, Side, TeamSize } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { FALLBACK_CHAMPIONS, CHALLENGES, SAMPLE_ITEM_NAMES } from "../lib/champions";
import { DAY, HOUR, seeded, shuffle } from "../lib/util";

/** Dummy names for local work. Later, the players are the people who signed in with Discord. */
export const ROSTER = ["Tosh", "Samu", "Lenny", "Artur", "Philip", "Nick"];

export function rosterPlayers(now = Date.now()): Player[] {
  return ROSTER.map((name, i) => ({ id: "p" + i, name, active: true, createdAt: now - DAY * 60 + i }));
}

/** Players only, empty history. */
export function emptyData(now = Date.now()): AppData {
  return { players: rosterPlayers(now), matches: [], live: null, settings: { ...DEFAULT_SETTINGS } };
}

/** Sample data for local development only: 33 fake games over the last 6 weeks. */
export function sampleData(now = Date.now()): AppData {
  const r = seeded(51);
  const players = rosterPlayers(now);
  players[0].riotId = "Tosh#TEST";
  players[1].riotId = "Samu#TEST";
  const skill = [0.6, 0.66, 0.5, 0.47, 0.52, 0.4];
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
    const tonight = shuffle(ids, r).slice(0, 4 + Math.floor(r() * 3));
    const size = tonight.length === 6 && r() < 0.7 ? 3 : 2;
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
  mk(["p0", "p5", "p4"], ["p1", "p3", "p2"], "blue", evening(2, 0.2), [], true);
  mk(["p1", "p2", "p4"], ["p0", "p3", "p5"], "red", evening(2, 0.45), [], true);
  mk(["p0", "p3"], ["p1", "p5"], "blue", evening(1, 0.25), ["p2", "p4"], true);
  matches[20].challenge = CHALLENGES[2];
  matches[25].challenge = CHALLENGES[0];
  matches[30].challenge = CHALLENGES[5];
  matches[29].dodges = [{ playerId: "p1", champion: "Yuumi", side: "blue", at: matches[29].playedAt - 30 * 6e4 }];
  matches[29].stats.p1.champion = "Ezreal";
  // The newest games have what the live page collects.
  const ends = ["nexus", "ff", "nexus", "left", "nexus"] as const;
  const augs = [1205, 1141, 1002, 1004, 1006, 1007, 1009, 1018];
  matches.slice(-5).forEach((m, i) => {
    m.end = ends[i];
    if (m.end === "ff" || m.end === "left") m.surrender = "ff";
    m.durationSec = (m.durationMin ?? 18) * 60 + i * 11;
    m.gameMode = "ARAM: Mayhem";
    m.map = "Howling Abyss";
    [...m.blue, ...m.red].forEach((p, k) => {
      m.stats[p] = { ...m.stats[p], level: 14 + ((i + k) % 5), spells: [4, [32, 7, 21, 3][(i + k) % 4]], augments: [0, 1, 2, 3].map((x) => augs[(i + k * 3 + x) % augs.length]) };
    });
  });
  return { players, matches, live: null, settings: { ...DEFAULT_SETTINGS } };
}
