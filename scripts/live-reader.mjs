// Development only (npm run dev:live): reads the League client and the running game on this PC and gives
// the result to the local site. Read-only (GET), custom games only, and nothing leaves this computer.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";

const EVERY = 2000;
const GAME_PORT = +(process.env.LEAGUE_GAME_PORT || 2999);
const DIRS = [process.env.LEAGUE_DIR, "C:/Riot Games/League of Legends", "D:/Riot Games/League of Legends"].filter(Boolean);
const OUT = join(process.env.LOCALAPPDATA || process.env.HOME || ".", "bridge-night-captures");
const IN_FLOW = new Set(["ChampSelect", "GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame", "EndOfGame"]);
const IN_GAME = new Set(["GameStart", "InProgress", "Reconnect", "PreEndOfGame", "WaitingForStats"]);
const OVER = new Set(["PreEndOfGame", "WaitingForStats", "EndOfGame"]);
/** Never written to disk: lobby passwords, chat tokens, server addresses. */
const SECRET = /password|jwt|token|spectatorkey|encryptionkey|serverip|chatid|summonerid|accountid|obfuscated/i;

const redact = (v) =>
  Array.isArray(v)
    ? v.map(redact)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? "***" : redact(x)]))
      : v;

/** GET on this computer only. The client and the game use Riot's own certificate, which Node doesn't know. */
function get(port, path, password) {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1", port, path, method: "GET", rejectUnauthorized: false, timeout: 3000,
        headers: { accept: "application/json", ...(password ? { authorization: "Basic " + Buffer.from("riot:" + password).toString("base64") } : {}) },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(body) : undefined);
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
    req.end();
  });
}

function client() {
  for (const d of DIRS) {
    try {
      const [, , port, password] = readFileSync(join(d, "lockfile"), "utf8").split(":");
      if (port && password) return { get: (path) => get(+port, path, password) };
    } catch {
      /* not running, or installed somewhere else (set LEAGUE_DIR) */
    }
  }
  return null;
}

class Reader {
  feed = null;
  phase = "Closed";
  names = {};
  lobby = undefined;
  gotHistory = "";
  lastHistory = "";
  champions = null;
  lastRecord = "";
  lastGameAt = 0;
  lastEvents = -1;
  historyAt = 0;
  busy = false;
  file = null;

  constructor(log, logic) {
    this.log = log;
    this.logic = logic;
    mkdirSync(OUT, { recursive: true });
    try {
      this.feed = JSON.parse(readFileSync(join(OUT, "state.json"), "utf8"));
    } catch {
      /* first start */
    }
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await this.read();
      const before = this.feed?.status;
      this.feed = (await this.logic()).nextFeed(this.feed, r);
      if (this.feed?.status !== before) this.log(`live game: ${this.feed ? this.feed.status : "none"}`);
      this.record(r);
      writeFileSync(join(OUT, "state.json"), JSON.stringify(this.feed));
    } catch (e) {
      this.log("problem: " + e.message);
    } finally {
      this.busy = false;
    }
  }

  async read() {
    const at = Date.now();
    const c = client();
    const phase = c ? ((await c.get("/lol-gameflow/v1/gameflow-phase")) ?? "Closed") : "Closed";
    const changed = phase !== this.phase;
    if (changed) this.log(`League client: ${phase}`);
    this.phase = phase;
    if (!c || phase === "Closed") return { at, phase: "Closed" };

    // The teams as they were in the lobby: League empties its other list until the game loads.
    if (phase === "Lobby") {
      const l = await c.get("/lol-lobby/v2/lobby");
      this.lobby = l?.gameConfig?.isCustom ? l : undefined;
    }
    // Only the people of this game: forget everyone from before.
    if (phase === "ChampSelect" && changed) this.names = {};
    const session = IN_FLOW.has(phase) ? await c.get("/lol-gameflow/v1/session") : undefined;
    const custom = session?.gameData?.isCustomGame === true;
    // In champ select, League still reports the id and teams of the game before: drop them here.
    if (phase === "ChampSelect" && session?.gameData) Object.assign(session.gameData, { gameId: 0, teamOne: [], teamTwo: [], playerChampionSelections: [] });
    const r = { at, phase, session, names: this.names, champions: this.champions ?? {} };
    // Nothing is read from games that aren't custom games.
    if (IN_FLOW.has(phase) && !custom) return { at, phase, session: { gameData: { isCustomGame: session?.gameData?.isCustomGame } } };

    if (custom || this.feed) {
      if (!this.champions) {
        const list = await c.get("/lol-game-data/assets/v1/champion-summary.json");
        if (Array.isArray(list)) this.champions = Object.fromEntries(list.filter((x) => x.id > 0).map((x) => [x.id, x.alias]));
        r.champions = this.champions ?? {};
      }
      for (const p of [...(session?.gameData?.teamOne ?? []), ...(session?.gameData?.teamTwo ?? [])]) await this.lookUp(c, p?.puuid);
    }
    if (custom && phase === "ChampSelect") {
      r.champSelect = await c.get("/lol-champ-select/v1/session");
      r.lobby = (await c.get("/lol-lobby/v2/lobby")) ?? this.lobby;
      if (!r.lobby?.gameConfig?.customTeam100) r.lobby = this.lobby;
      const g = r.lobby?.gameConfig ?? {};
      for (const p of [...(g.customTeam100 ?? []), ...(g.customTeam200 ?? []), ...(r.champSelect?.myTeam ?? []), ...(r.champSelect?.theirTeam ?? [])])
        await this.lookUp(c, p?.puuid);
    }
    if (custom && IN_GAME.has(phase)) r.inGame = await get(GAME_PORT, "/liveclientdata/allgamedata");

    const ours = this.feed?.gameId;
    if (ours && OVER.has(phase)) {
      const eog = await c.get("/lol-end-of-game/v1/eog-stats-block");
      if (String(eog?.gameId) === ours) {
        for (const t of eog.teams ?? []) for (const p of t.players ?? []) await this.lookUp(c, p?.puuid);
        r.eog = eog;
      }
    }
    // Match history: augments after a game, and the result if this player left before the end.
    const f = this.feed;
    const waiting = f?.status === "ended" && (!f.end?.winner || (this.gotHistory !== ours || /mayhem/i.test(f.mode ?? "") && !f.players.some((p) => p.augments?.length))) && !f.end?.aborted && at - f.end.at < 3600e3;
    const left = phase === "Reconnect" || (f?.status === "playing" && !IN_FLOW.has(phase));
    if (ours && (waiting || left)) {
      const pause = waiting && at - f.end.at < 60e3 ? 4e3 : 20e3;
      if (at - this.historyAt >= pause) {
        this.historyAt = at;
        const h = await c.get(`/lol-match-history/v1/games/${ours}`);
        if (String(h?.gameId) === ours) {
          for (const p of h.participantIdentities ?? []) await this.lookUp(c, p?.player?.puuid);
          r.history = h;
          this.gotHistory = ours;
        }
      }
    }
    return r;
  }

  async lookUp(c, puuid) {
    if (!puuid || /^[0-]+$/.test(puuid) || this.names[puuid]) return;
    const s = await c.get("/lol-summoner/v2/summoners/puuid/" + encodeURIComponent(puuid));
    if (s?.gameName && s?.tagLine) this.names[puuid] = `${s.gameName}#${s.tagLine}`;
  }

  /** Raw data of custom games, to check what League really says. Outside the repo, without secrets. */
  record(r) {
    if (!this.feed || (r.session ? r.session.gameData?.isCustomGame !== true : !r.eog && !r.history)) return;
    const events = r.inGame?.events?.Events?.length ?? -1;
    const sig = JSON.stringify([r.phase, r.session?.gameData?.gameId, !!r.inGame, !!r.eog, this.gotHistory, r.inGame ? 0 : [r.session?.gameData, !!r.lobby, r.champSelect?.myTeam?.length, r.champSelect?.theirTeam?.length]]);
    // The same match history again and again is no news.
    const again = r.history ? JSON.stringify(r.history) : "";
    if (!r.session && again === this.lastHistory) return;
    this.lastHistory = again || this.lastHistory;
    const due = r.inGame && (events !== this.lastEvents || r.at - this.lastGameAt > 10_000);
    if (sig === this.lastRecord && !due) return;
    this.lastRecord = sig;
    this.lastEvents = events;
    if (r.inGame) this.lastGameAt = r.at;
    const name = `game-${this.feed.id}.jsonl`;
    if (this.file !== name) {
      this.file = name;
      this.log(`recording to ${join(OUT, name)}`);
    }
    appendFileSync(join(OUT, name), JSON.stringify(redact({ ...r, champions: existsSync(join(OUT, name)) ? undefined : r.champions })) + "\n");
  }
}

/** Plays a recorded game again, five times as fast. */
class Replay {
  feed = null;
  champions = {};
  constructor(file, log, logic) {
    const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const from = rows[0]?.at ?? 0;
    const start = Date.now();
    log(`replaying ${rows.length} readings from ${file}`);
    const next = () => {
      const r = rows.shift();
      if (!r) return log("replay finished");
      this.champions = r.champions ?? this.champions;
      const at = start + (r.at - from) / 5;
      setTimeout(async () => {
        this.feed = (await logic()).nextFeed(this.feed, { ...r, champions: this.champions, at: Date.now() });
        next();
      }, Math.max(0, at - Date.now()));
    };
    next();
  }
  tick() {}
}

export function liveReader() {
  return {
    name: "bridge-night-live-reader",
    apply: "serve",
    configureServer(server) {
      const log = (m) => server.config.logger.info(`  [live] ${m}`, { timestamp: true });
      // The same code the site uses. Changes to it apply at once.
      const logic = () => server.ssrLoadModule("/src/lib/live.ts");
      const replay = process.env.VITE_LIVE_REPLAY;
      const source = replay ? new Replay(replay, log, logic) : new Reader(log, logic);
      const timer = setInterval(() => void source.tick(), EVERY);
      void source.tick();
      server.httpServer?.on("close", () => clearInterval(timer));
      log(replay ? "replay" : `reading League on this PC, recordings in ${OUT}`);
      server.middlewares.use("/__live", (req, res) => {
        // Riot IDs are in here: only this computer, only this site.
        const host = (req.headers.host ?? "").replace(/:\d+$/, "");
        const site = req.headers["sec-fetch-site"];
        res.removeHeader("access-control-allow-origin");
        if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || (site && site !== "same-origin" && site !== "none")) {
          res.statusCode = 403;
          return res.end();
        }
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify({ feed: source.feed, phase: source.phase }));
      });
    },
  };
}
