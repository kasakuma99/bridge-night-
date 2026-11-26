// One-off import of past games from the League client on this PC. Read-only: only GETs to the local client,
// nothing is sent anywhere. Writes the games it finds, in the shape public._save_live_game(m, false) takes,
// so they can be checked before anyone saves them.
//
//   node scripts/import-history.mjs --players players.json --out games.json [--skip 123,456]
//
// players.json: [{ id, name, riot_id }] (the site's active players). --skip: Riot game ids already on the
// site or deleted on purpose. Keeps custom 2v2, 3v3 and 4v4 games with a winner and at least two site players.
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const PLAYERS = arg("players");
const OUT = arg("out");
const SKIP = new Set((arg("skip") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
if (!PLAYERS || !OUT) {
  console.error("Usage: node scripts/import-history.mjs --players players.json --out games.json [--skip id,id]");
  process.exit(1);
}

const DIRS = [process.env.LEAGUE_DIR, "C:/Riot Games/League of Legends", "D:/Riot Games/League of Legends"].filter(Boolean);
const SIZES = new Set([2, 3, 4]);
const MODES = { KIWI: "ARAM: Mayhem", ARAM: "ARAM", CLASSIC: "Classic", PRACTICETOOL: "Practice Tool", CHERRY: "Arena", URF: "URF", SWIFTPLAY: "Swiftplay" };
const MAPS = { 11: "Summoner's Rift", 12: "Howling Abyss", 21: "Nexus Blitz", 30: "Arena" };

function lockfile() {
  for (const d of DIRS) {
    try {
      const [, , port, password] = readFileSync(join(d, "lockfile"), "utf8").split(":");
      if (port && password) return { port: +port, password };
    } catch {
      /* not here */
    }
  }
  throw new Error("League client not found. Start League (or set LEAGUE_DIR) and try again.");
}

const LCU = lockfile();
/** GET on this computer only. The client uses Riot's own certificate, which Node doesn't know. */
function get(path) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1", port: LCU.port, path, method: "GET", rejectUnauthorized: false, timeout: 15000,
        headers: { accept: "application/json", authorization: "Basic " + Buffer.from("riot:" + LCU.password).toString("base64") },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve(undefined);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout on ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const ids = (xs) => xs.map(Number).filter((x) => Number.isInteger(x) && x > 0);
const sideOf = (teamId) => (teamId === 100 ? "blue" : teamId === 200 ? "red" : undefined);

const players = JSON.parse(readFileSync(PLAYERS, "utf8"));
const byRiot = new Map(players.filter((p) => p.riot_id).map((p) => [p.riot_id.trim().toLowerCase(), p]));
const champs = new Map(((await get("/lol-game-data/assets/v1/champion-summary.json")) ?? []).map((c) => [c.id, c.name]));

// The client hands out history in pages. Keep asking until it has nothing older.
const seen = new Map();
for (let beg = 0; beg < 2000; beg += 20) {
  const page = await get(`/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${beg}&endIndex=${beg + 20}`);
  const games = page?.games?.games ?? [];
  const before = seen.size;
  for (const g of games) seen.set(String(g.gameId), g);
  if (!games.length || seen.size === before) break;
}
const all = [...seen.values()].sort((a, b) => a.gameCreation - b.gameCreation);
console.log(`History: ${all.length} games from ${new Date(all[0]?.gameCreation).toISOString().slice(0, 10)} to ${new Date(all.at(-1)?.gameCreation).toISOString().slice(0, 10)}`);

const custom = all.filter((g) => g.gameType === "CUSTOM_GAME");
console.log(`Custom games: ${custom.length}`);

const kept = [];
const skipped = [];
for (const brief of custom) {
  const gameId = String(brief.gameId);
  const why = (reason) => skipped.push({ gameId, date: new Date(brief.gameCreation).toISOString().slice(0, 16), reason });
  if (SKIP.has(gameId)) { why("already on the site or deleted"); continue; }
  if (brief.gameMode === "PRACTICETOOL") { why("practice tool"); continue; }

  const g = await get(`/lol-match-history/v1/games/${gameId}`);
  if (!g) { why("details not available"); continue; }
  if (/^abort/i.test(String(g.endOfGameResult ?? ""))) { why("aborted"); continue; }

  const who = new Map((g.participantIdentities ?? []).map((x) => [x.participantId, x.player ?? {}]));
  const on = { blue: [], red: [] };
  for (const p of g.participants ?? []) {
    const side = sideOf(p.teamId);
    if (!side) continue;
    const id = who.get(p.participantId) ?? {};
    const bot = !id.puuid || /^[0-]+$/.test(id.puuid);
    const riot = !bot && id.gameName && id.tagLine ? `${id.gameName}#${id.tagLine}`.toLowerCase() : "";
    const st = p.stats ?? {};
    const augments = ids([1, 2, 3, 4, 5, 6].map((k) => st[`playerAugment${k}`]));
    on[side].push({
      site: byRiot.get(riot),
      side,
      ...(bot ? { bot } : {}),
      champion: champs.get(p.championId),
      level: n(st.champLevel),
      kills: n(st.kills),
      deaths: n(st.deaths),
      assists: n(st.assists),
      damage: n(st.totalDamageDealtToChampions),
      items: ids([0, 1, 2, 3, 4, 5, 6].map((k) => st[`item${k}`])),
      spells: ids([p.spell1Id, p.spell2Id]),
      ...(augments.length ? { augments } : {}),
      ff: !!st.gameEndedInSurrender,
      early: !!st.gameEndedInEarlySurrender,
    });
  }
  const size = `${on.blue.length}v${on.red.length}`;
  if (on.blue.length !== on.red.length || !SIZES.has(on.blue.length)) { why(`${size}`); continue; }

  const site = [...on.blue, ...on.red].filter((p) => p.site);
  if (site.length < 2) { why(`${size}, only ${site.length} site player`); continue; }

  const winners = (g.teams ?? []).filter((t) => String(t.win).toLowerCase() === "win" || t.win === true).map((t) => sideOf(t.teamId));
  if (winners.length !== 1 || !winners[0]) { why("no winner"); continue; }

  const everyone = [...on.blue, ...on.red];
  const surrender = everyone.some((p) => p.early) ? "early" : everyone.some((p) => p.ff) ? "ff" : undefined;
  const stats = {};
  const guests = [];
  everyone.forEach(({ site: s, ff, early, ...p }, i) => {
    const { side, bot, ...st } = p;
    if (s) stats[s.id] = Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined));
    else guests.push(Object.fromEntries(Object.entries({ key: `s${i}`, ...p }).filter(([, v]) => v !== undefined)));
  });
  const sec = n(g.gameDuration);
  kept.push({
    gameId,
    playedAt: g.gameCreation + (sec ?? 0) * 1000,
    mode: on.blue.length,
    blue: on.blue.filter((p) => p.site).map((p) => p.site.id),
    red: on.red.filter((p) => p.site).map((p) => p.site.id),
    winner: winners[0],
    stats,
    end: surrender ?? "nexus",
    ...(surrender ? { surrender } : {}),
    ...(sec ? { durationSec: sec, durationMin: Math.max(1, Math.round(sec / 60)) } : {}),
    ...(guests.length ? { guests } : {}),
    ...(MODES[g.gameMode] ?? g.gameMode ? { gameMode: MODES[g.gameMode] ?? g.gameMode } : {}),
    ...(MAPS[g.mapId] ? { map: MAPS[g.mapId] } : {}),
  });
}

writeFileSync(OUT, JSON.stringify(kept, null, 1));
const name = new Map(players.map((p) => [p.id, p.name]));
console.log(`\nKeep: ${kept.length}`);
for (const m of kept) {
  const team = (s) => m[s].map((id) => `${name.get(id)} (${m.stats[id]?.champion ?? "?"})`).join(", ") + ((m.guests ?? []).some((g) => g.side === s) ? ` + ${(m.guests ?? []).filter((g) => g.side === s).length} guest` : "");
  console.log(`${new Date(m.playedAt).toISOString().slice(0, 16).replace("T", " ")}  ${m.mode}v${m.mode}  ${m.gameMode ?? ""}  ${m.durationMin ?? "?"}m  blue: ${team("blue")}  |  red: ${team("red")}  ->  ${m.winner}${m.surrender ? " (" + m.surrender + ")" : ""}  [${m.gameId}]`);
}
console.log(`\nSkipped custom games: ${skipped.length}`);
for (const s of skipped) console.log(`${s.date}  ${s.reason}  [${s.gameId}]`);
