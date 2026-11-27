import { championFromId } from "./champions";
import type { AppData, EndReason, FeedEnd, FeedEvent, FeedPlayer, LiveFeed, Match, ParticipantStats, Player, Side, TeamSize } from "./types";

/*
 * Turns what the League client and the running game say into one live game.
 * Pure on purpose (no browser, no Node), so the dev reader, the tests and later the server share it.
 *
 * Sources, all on the PC of the one person running the helper:
 *  - the League client: phase, lobby teams, end-of-game stats, match history
 *  - the running game (port 2999): clock, champions, levels, items, K/D/A, spells, events
 */

/** One look at League. Everything is raw, unknown JSON, and any part can be missing. */
export interface Reading {
  at: number;
  /** Client phase, or "Closed" when the client isn't running. */
  phase: string;
  session?: unknown;
  /** /lol-champ-select/v1/session: the lobby teams in `session` are empty until the game loads */
  champSelect?: unknown;
  /** /lol-lobby/v2/lobby, as it was before champ select */
  lobby?: unknown;
  /** /liveclientdata/allgamedata, only while a game is running */
  inGame?: unknown;
  eog?: unknown;
  /** /lol-match-history/v1/games/{id} */
  history?: unknown;
  /** puuid -> Name#TAG */
  names?: Record<string, string>;
  /** champion id -> Data Dragon id, e.g. 62 -> "MonkeyKing" */
  champions?: Record<number, string>;
}

/** How long a finished game stays on the Live page. */
export const RECENT_MS = 5 * 60_000;
/** No update for this long: say so, and stop the clock. */
export const STALE_MS = 15_000;
/** The game is over, but League hasn't named a winner after this long: a member decides. */
export const NO_RESULT_MS = 3 * 60_000;

/* ---------- small readers for unknown JSON ---------- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const yes = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(1|true)$/i.test(v));
const ids = (v: unknown[]) => v.map((x) => num(x) ?? 0).filter((x) => x > 0);
const sideOf = (team: unknown): Side | undefined =>
  team === "ORDER" || num(team) === 100 ? "blue" : team === "CHAOS" || num(team) === 200 ? "red" : undefined;

/* ---------- summoner spells ---------- */

/** Data Dragon id -> number. The running game only names spells. */
export const SPELL_IDS: Record<string, number> = {
  SummonerBarrier: 21, SummonerBoost: 1, SummonerCherryFlash: 2202, SummonerCherryHold: 2201, SummonerDot: 14,
  SummonerExhaust: 3, SummonerFlash: 4, SummonerHaste: 6, SummonerHeal: 7, SummonerMana: 13, SummonerPoroRecall: 30,
  SummonerPoroThrow: 31, SummonerSmite: 11, SummonerSnowURFSnowball_Mark: 39, SummonerSnowball: 32, SummonerTeleport: 12,
  SummonerBarrier_Jade: 721, SummonerBattleCry_Jade: 716, SummonerBoost_Jade: 71, SummonerClairvoyance_Jade: 75,
  SummonerDot_Jade: 714, SummonerExhaust_Jade: 73, SummonerFlash_Jade: 74, SummonerFortify_Jade: 705, SummonerHaste_Jade: 76,
  SummonerHeal_Jade: 77, SummonerMana_Jade: 713, SummonerRally_Jade: 709, SummonerRevive_Jade: 777, SummonerSmite_Jade: 711,
  SummonerSpell_Promote_Jade: 720, SummonerTeleport_Jade: 712,
};
const SPELL_BY_KEY = new Map(Object.entries(SPELL_IDS).map(([k, v]) => [k.toLowerCase(), v]));

export function spellId(spell: unknown): number {
  const raw = /SummonerSpell_(.+?)_(?:DisplayName|Name|Description)$/i.exec(str(obj(spell).rawDisplayName))?.[1] ?? "";
  return SPELL_BY_KEY.get(raw.toLowerCase()) ?? 0;
}

/* ---------- mode and map ---------- */

const MODES: Record<string, string> = {
  KIWI: "ARAM: Mayhem", ARAM: "ARAM", CLASSIC: "Classic", PRACTICETOOL: "Practice Tool", CHERRY: "Arena", URF: "URF", SWIFTPLAY: "Swiftplay",
};
const MAPS: Record<number, string> = { 11: "Summoner's Rift", 12: "Howling Abyss", 21: "Nexus Blitz", 30: "Arena" };
const modeName = (m: string) => MODES[m.toUpperCase()] ?? (m || undefined);

/* ---------- parsers ---------- */

type Incoming = Partial<FeedPlayer> & { side: Side };

const fullId = (name: string, tag: string) => (name && tag ? `${name}#${tag}` : "");
const champKey = (id: unknown, r: Reading) => {
  const key = r.champions?.[num(id) ?? 0];
  return key ? championFromId(key) : undefined;
};

/** Riot ID of a player in client data, from the lookup, or from the fields that happen to be filled in. */
const clientRiotId = (p: Obj, r: Reading): string | undefined =>
  r.names?.[str(p.puuid)] ||
  fullId(str(p.gameName) || str(p.riotIdGameName), str(p.tagLine) || str(p.riotIdTagLine)) ||
  undefined;

const noAccount = (p: Obj) => !str(p.puuid) || /^[0-]+$/.test(str(p.puuid));

export function parseSession(r: Reading) {
  const s = obj(r.session);
  const queue = obj(obj(s.gameData).queue);
  const custom = obj(s.gameData).isCustomGame;
  // In champ select the game id and teams are empty, or still those of the game before.
  const g = r.phase === "ChampSelect" ? {} : obj(s.gameData);
  const players: Incoming[] = [];
  const picks = arr(g.playerChampionSelections).map(obj);
  for (const [list, side] of [[g.teamOne, "blue"], [g.teamTwo, "red"]] as [unknown, Side][])
    for (const raw of arr(list)) {
      const p = obj(raw);
      const pick = picks.find((x) => str(x.puuid) && str(x.puuid) === str(p.puuid)) ?? {};
      const bot = noAccount(p);
      const spells = ids([p.spell1Id ?? pick.spell1Id, p.spell2Id ?? pick.spell2Id]);
      players.push({
        side,
        ...(bot ? { bot } : {}),
        riotId: bot ? undefined : clientRiotId(p, r),
        champion: champKey(p.championId || pick.championId, r),
        ...(spells.length ? { spells } : {}),
      });
    }
  const gameId = num(g.gameId);
  return {
    custom: typeof custom === "boolean" ? custom : undefined,
    gameId: gameId && gameId > 0 ? String(gameId) : undefined,
    mode: modeName(str(obj(s.map).gameMode) || str(queue.gameMode)),
    map: MAPS[num(obj(s.map).id) ?? num(queue.mapId) ?? 0] ?? (str(obj(s.map).name) || undefined),
    players,
  };
}

/** Both teams in champ select. The lobby knows both, champ select may only show your own. */
export function parseChampSelect(r: Reading): Incoming[] {
  const config = obj(obj(r.lobby).gameConfig);
  const cs = obj(r.champSelect);
  const out: Incoming[] = [];
  const at = new Map<string, number>();
  const add = (p: Obj, side: Side | undefined, bot: boolean) => {
    const puuid = noAccount(p) ? "" : str(p.puuid);
    if (!side || (!puuid && !bot)) return;
    const known = puuid ? at.get(puuid) : undefined;
    if (known != null) {
      out[known] = { ...out[known], side };
      return;
    }
    if (puuid) at.set(puuid, out.length);
    out.push({ side, ...(bot ? { bot } : {}), riotId: bot ? undefined : clientRiotId(p, r) });
  };
  for (const p of arr(config.customTeam100).map(obj)) add(p, "blue", p.isBot === true);
  for (const p of arr(config.customTeam200).map(obj)) add(p, "red", p.isBot === true);
  for (const p of [...arr(cs.myTeam), ...arr(cs.theirTeam)].map(obj)) add(p, num(p.team) === 1 ? "blue" : num(p.team) === 2 ? "red" : undefined, false);
  return out;
}

interface InGame {
  players: Incoming[];
  clock: number;
  mode?: string;
  map?: string;
  /** every name an event may use for a player -> index in players */
  byName: Map<string, number>;
  events: Obj[];
  /** the side of the helper's own player */
  me?: Side;
}

export function parseInGame(raw: unknown): InGame | null {
  const d = obj(raw);
  const list = arr(d.allPlayers).map(obj);
  if (!list.length) return null;
  const g = obj(d.gameData);
  const players: Incoming[] = [];
  const byName = new Map<string, number>();
  const champs = new Map<string, number[]>();
  for (const p of list) {
    const side = sideOf(p.team);
    if (!side) continue;
    const i = players.length;
    const sc = obj(p.scores);
    const sp = obj(p.summonerSpells);
    const name = str(p.riotIdGameName) || str(p.riotId).split("#")[0] || str(p.summonerName).split("#")[0];
    const riotId = /#./.test(str(p.riotId)) ? str(p.riotId) : fullId(name, str(p.riotIdTagLine));
    const key = /^game_character_displayname_(.+)$/i.exec(str(p.rawChampionName))?.[1] ?? "";
    const champion = key ? championFromId(key, str(p.championName)) : str(p.championName) || undefined;
    const bot = p.isBot === true;
    players.push({
      side,
      ...(bot ? { bot } : {}),
      riotId: bot ? undefined : riotId || name || undefined,
      champion,
      level: num(p.level),
      kills: num(sc.kills),
      deaths: num(sc.deaths),
      assists: num(sc.assists),
      items: ids(
        arr(p.items)
          .map(obj)
          .sort((a, b) => (num(a.slot) ?? 9) - (num(b.slot) ?? 9))
          .map((x) => x.itemID),
      ),
      spells: [spellId(sp.summonerSpellOne), spellId(sp.summonerSpellTwo)],
      dead: p.isDead === true,
    });
    for (const n of [riotId, name, str(p.summonerName), str(p.riotId)]) if (n) byName.set(n.toLowerCase(), i);
    if (champion) champs.set(champion.toLowerCase(), [...(champs.get(champion.toLowerCase()) ?? []), i]);
  }
  // Some events name the champion instead (streamer mode): only safe if nobody else plays it.
  for (const [c, who] of champs) if (who.length === 1 && !byName.has(c)) byName.set(c, who[0]);
  const a = obj(d.activePlayer);
  const mine = byName.get((str(a.riotId) || str(a.summonerName)).toLowerCase());
  return {
    players,
    clock: Math.max(0, num(g.gameTime) ?? 0),
    mode: modeName(str(g.gameMode)),
    map: MAPS[num(g.mapNumber) ?? 0],
    byName,
    events: arr(obj(d.events).Events).map(obj),
    me: mine == null ? undefined : players[mine].side,
  };
}

interface Result {
  gameId: string;
  winner?: Side;
  durationSec?: number;
  surrender?: "ff" | "early";
  /** League says this game was not finished properly. */
  aborted: boolean;
  players: (Incoming & { left?: boolean })[];
}

const oneWinner = (w: Side[]) => (w.length === 1 ? w[0] : undefined);
const augmentsOf = (st: Obj, key: (n: number) => string) => ids([1, 2, 3, 4, 5, 6].map((n) => st[key(n)]));

/** The client's end-of-game screen. */
export function parseEog(r: Reading): Result | null {
  const b = obj(r.eog);
  const gameId = num(b.gameId);
  if (!gameId || gameId <= 0) return null;
  const out: Result = { gameId: String(gameId), aborted: b.invalid === true, players: [], durationSec: num(b.gameLength) || undefined };
  const winners: Side[] = [];
  const flags: string[] = [];
  // Field names differ between patches, so every surrender flag counts.
  const scan = (o: Obj) => {
    for (const [k, v] of Object.entries(o)) if (/surrender/i.test(k) && yes(v)) flags.push(k);
  };
  scan(b);
  for (const rawTeam of arr(b.teams)) {
    const t = obj(rawTeam);
    const side = sideOf(t.teamId);
    if (side && t.isWinningTeam === true) winners.push(side);
    scan(t);
    for (const raw of arr(t.players)) {
      const p = obj(raw);
      const st = obj(p.stats);
      scan(p);
      scan(st);
      const ps = sideOf(p.teamId) ?? side;
      if (!ps) continue;
      const bot = p.botPlayer === true;
      const augments = augmentsOf(st, (n) => `PLAYER_AUGMENT_${n}`);
      out.players.push({
        side: ps,
        ...(bot ? { bot } : {}),
        riotId: bot ? undefined : clientRiotId(p, r),
        champion: champKey(p.championId, r),
        level: num(st.LEVEL),
        kills: num(st.CHAMPIONS_KILLED),
        deaths: num(st.NUM_DEATHS),
        assists: num(st.ASSISTS),
        damage: num(st.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS),
        items: ids(arr(p.items)),
        spells: ids([p.spell1Id, p.spell2Id]),
        ...(augments.length ? { augments } : {}),
        left: p.leaver === true,
      });
    }
  }
  out.winner = oneWinner(winners);
  out.surrender = flags.some((f) => /early/i.test(f)) ? "early" : flags.length ? "ff" : undefined;
  return out;
}

/** The client's match history entry. A game everyone left is there too, as "Abort_TooFewPlayers" without a winner. Comes a little later, and is the surest place for augments. */
export function parseHistory(r: Reading): Result | null {
  const b = obj(r.history);
  const gameId = num(b.gameId);
  if (!gameId || gameId <= 0) return null;
  const out: Result = {
    gameId: String(gameId),
    aborted: /^abort/i.test(str(b.endOfGameResult)),
    players: [],
    durationSec: num(b.gameDuration) || undefined,
  };
  const who = new Map(arr(b.participantIdentities).map((x) => [num(obj(x).participantId), obj(obj(x).player)]));
  const flags = { ff: false, early: false };
  for (const raw of arr(b.participants)) {
    const p = obj(raw);
    const st = obj(p.stats);
    const side = sideOf(p.teamId);
    if (!side) continue;
    if (yes(st.gameEndedInEarlySurrender)) flags.early = true;
    if (yes(st.gameEndedInSurrender)) flags.ff = true;
    const player = who.get(num(p.participantId)) ?? {};
    const bot = noAccount(player);
    const augments = augmentsOf(st, (n) => `playerAugment${n}`);
    out.players.push({
      side,
      ...(bot ? { bot } : {}),
      riotId: bot ? undefined : clientRiotId(player, r),
      champion: champKey(p.championId, r),
      level: num(st.champLevel),
      kills: num(st.kills),
      deaths: num(st.deaths),
      assists: num(st.assists),
      damage: num(st.totalDamageDealtToChampions),
      items: ids([0, 1, 2, 3, 4, 5, 6].map((n) => st[`item${n}`])),
      spells: ids([p.spell1Id, p.spell2Id]),
      ...(augments.length ? { augments } : {}),
    });
  }
  out.winner = oneWinner(
    arr(b.teams)
      .map(obj)
      .filter((t) => str(t.win).toLowerCase() === "win" || t.win === true)
      .map((t) => sideOf(t.teamId))
      .filter((s): s is Side => !!s),
  );
  out.surrender = flags.early ? "early" : flags.ff ? "ff" : undefined;
  return out;
}

/* ---------- events ---------- */

const LOG_MAX = 80;

function parseEvents(g: InGame, keyOf: (i: number) => string): FeedEvent[] {
  const out: FeedEvent[] = [];
  const who = (n: unknown) => {
    const name = str(n).toLowerCase();
    const i = g.byName.get(name) ?? g.byName.get(name.split("#")[0]);
    return i == null ? undefined : keyOf(i);
  };
  const alone = (by?: Side) => !!by && g.players.filter((p) => p.side !== by).length < 2;
  /** Who or what did it, when it wasn't a player. */
  const thing = (n: unknown) =>
    /^turret_/i.test(str(n)) ? "turret" : /^(barracks|sru_inhib|inhib)/i.test(str(n)) ? "inhibitor" : /^minion_/i.test(str(n)) ? "minion" : undefined;
  const owner = (n: unknown): Side | undefined =>
    /_T(1|order)(_|$)/i.test(str(n)) ? "blue" : /_T(2|chaos)(_|$)/i.test(str(n)) ? "red" : undefined;
  for (const [i, e] of g.events.entries()) {
    const base = { id: num(e.EventID) ?? i, time: num(e.EventTime) ?? 0 };
    const helpers = arr(e.Assisters).map(who).filter((x): x is string => !!x);
    switch (str(e.EventName)) {
      case "GameStart":
        out.push({ ...base, type: "start" });
        break;
      case "FirstBlood":
        out.push({ ...base, type: "firstblood", by: who(e.Recipient ?? e.Recorder) });
        break;
      case "ChampionKill":
        out.push({ ...base, type: "kill", by: who(e.KillerName), byThing: thing(e.KillerName), victim: who(e.VictimName), helpers });
        break;
      case "Multikill":
        out.push({ ...base, type: "multikill", by: who(e.KillerName), n: num(e.KillStreak) });
        break;
      case "Ace":
        // Against one player, every kill is an ace.
        if (alone(sideOf(e.AcingTeam))) break;
        out.push({ ...base, type: "ace", by: who(e.Acer), side: sideOf(e.AcingTeam) });
        break;
      case "FirstBrick":
        out.push({ ...base, type: "firstturret", by: who(e.KillerName), byThing: thing(e.KillerName) });
        break;
      case "TurretKilled":
        out.push({ ...base, type: "turret", by: who(e.KillerName), byThing: thing(e.KillerName), side: owner(e.TurretKilled), helpers });
        break;
      case "InhibKilled":
        out.push({ ...base, type: "inhibitor", by: who(e.KillerName), byThing: thing(e.KillerName), side: owner(e.InhibKilled), helpers });
        break;
    }
  }
  return out.sort((a, b) => a.time - b.time || a.id - b.id).slice(-LOG_MAX);
}

/* ---------- merging ---------- */

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const gameName = (id?: string) => id?.split("#")[0];
/** Same Riot ID, or the same name when one of the two doesn't know the tag. */
const sameAccount = (a?: string, b?: string) =>
  same(a, b) || (!!a && !!b && (!a.includes("#") || !b.includes("#")) && same(gameName(a), gameName(b)));

/**
 * Updates players with newer information. `full`: the incoming list is everyone in the game, so anyone else is dropped.
 * Also returns the key each incoming player ended up with.
 */
function mergePlayers(old: FeedPlayer[], incoming: Incoming[], full: boolean, nextKey: () => string) {
  const used = new Set<FeedPlayer>();
  const found: (FeedPlayer | undefined)[] = incoming.map(() => undefined);
  // Surest matches first, so a vague one can't take someone else's place.
  const rules: ((p: FeedPlayer, x: Incoming) => boolean)[] = [
    (p, x) => sameAccount(p.riotId, x.riotId),
    (p, x) => p.side === x.side && same(p.champion, x.champion) && !!p.bot === !!x.bot,
    (p, x) => p.side === x.side && same(p.champion, x.champion),
    (p, x) => p.side === x.side && !!p.bot && !!x.bot && (!p.champion || !x.champion),
  ];
  for (const rule of rules)
    incoming.forEach((x, i) => {
      if (found[i]) return;
      const hit = old.find((p) => !used.has(p) && rule(p, x));
      if (!hit) return;
      found[i] = hit;
      used.add(hit);
    });
  const keys: string[] = [];
  const fresh: FeedPlayer[] = [];
  const updated = new Map<FeedPlayer, FeedPlayer>();
  incoming.forEach((x, i) => {
    const prev = found[i];
    const known = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Incoming;
    // Less information must not replace more.
    if (prev?.riotId?.includes("#") && known.riotId && !known.riotId.includes("#")) delete known.riotId;
    if (known.spells && prev?.spells.some((s) => s) && !known.spells.some((s) => s)) delete known.spells;
    const p: FeedPlayer = { items: [], spells: [], ...prev, ...known, key: prev?.key ?? nextKey() };
    keys.push(p.key);
    if (prev) updated.set(prev, p);
    else fresh.push(p);
  });
  const kept = old.filter((p) => updated.has(p) || !full).map((p) => updated.get(p) ?? p);
  return { players: [...kept, ...fresh], keys };
}

/** Why a finished game ended. Leaving counts as a surrender: the whole losing team was gone. */
export function endReason(res: { winner?: Side; surrender?: "ff" | "early"; players: { side: Side; bot?: boolean; left?: boolean }[] }): EndReason {
  if (!res.winner) return "unknown";
  if (res.surrender) return res.surrender;
  const losers = res.players.filter((p) => p.side !== res.winner && !p.bot);
  return losers.length > 0 && losers.every((p) => p.left) ? "left" : "nexus";
}

/* ---------- the live game ---------- */

const OVER = new Set(["WaitingForStats", "PreEndOfGame", "EndOfGame"]);
export const GONE = new Set(["None", "Lobby", "Matchmaking", "ReadyCheck", "ChampSelect", "TerminatedInError"]);
const RUNNING = new Set(["GameStart", "InProgress"]);

const blank = (id: string, at: number): LiveFeed => ({ id, status: "select", players: [], events: [], startedAt: at, updatedAt: at });

/** Adds a result. The end-of-game screen knows who left, match history knows the augments. */
function withResult(f: LiveFeed, res: Result, at: number): LiveFeed {
  if (f.gameId && f.gameId !== res.gameId) return f;
  let n = f.players.length;
  const incoming = res.players.map((p): Incoming => {
    const { left, ...rest } = p;
    void left;
    return rest;
  });
  const alive = f.players.map((p) => (p.dead ? { ...p, dead: false } : p));
  const { players } = mergePlayers(alive, incoming, false, () => `x${f.id}-${n++}`);
  const was = f.end;
  const official = !!res.winner && !res.aborted;
  const winner = was?.sure ? was.winner : official ? res.winner : was?.winner;
  let reason = was?.reason;
  // "left" and surrenders stay: the other source may not know about them.
  if (official && res.winner === winner && (!reason || reason === "unknown" || reason === "nexus")) reason = endReason(res);
  const sure = !!was?.sure || official;
  const end: FeedEnd = {
    at: was?.at ?? at,
    ...(winner ? { winner } : {}),
    ...(reason ? { reason } : {}),
    ...(sure ? { sure } : {}),
    ...(res.aborted && !sure ? { aborted: true } : {}),
    durationSec: res.durationSec ?? was?.durationSec,
  };
  return { ...f, gameId: res.gameId, status: "ended", players, end, updatedAt: at };
}

/** The next state of the live game. `null` = no custom game to show. */
export function nextFeed(prev: LiveFeed | null, r: Reading): LiveFeed | null {
  const s = parseSession(r);
  let f = prev;
  const starting = r.phase === "ChampSelect" || RUNNING.has(r.phase);

  // Only custom games. A finished one stays visible while a normal game starts.
  if (s.custom === false && (starting || r.phase === "Reconnect")) return prev?.status === "ended" ? prev : null;

  // A newer game replaces an older one.
  const otherId = !!f?.gameId && !!s.gameId && f.gameId !== s.gameId;
  const rejoined = f?.status === "ended" && RUNNING.has(r.phase) && !!s.gameId && f.gameId === s.gameId;
  if (starting && f && (otherId || (f.status === "ended" && !rejoined))) f = null;

  if (starting && s.custom) f ??= blank(s.gameId ?? `t${r.at}`, r.at);
  if (!f) return null;

  if (s.gameId && !f.gameId && starting) f = { ...f, gameId: s.gameId };
  if (s.mode && !f.mode) f = { ...f, mode: s.mode };
  if (s.map && !f.map) f = { ...f, map: s.map };

  const id = f.id;
  let n = 0;
  const nextKey = () => `x${id}-${r.at}-${n++}`;
  const inGame = RUNNING.has(r.phase) || r.phase === "Reconnect" || OVER.has(r.phase) ? parseInGame(r.inGame) : null;

  if (r.phase === "ChampSelect" && f.status === "select") {
    // Fair play: no champions or spells before the loading screen, because both teams see the site.
    const lobby = parseChampSelect(r);
    if (lobby.length) f = { ...f, players: mergePlayers(f.players, lobby, true, nextKey).players };
    f = { ...f, updatedAt: r.at };
  } else if (RUNNING.has(r.phase) && !inGame && (f.status === "select" || f.status === "loading")) {
    if (s.players.length) f = { ...f, players: mergePlayers(f.players, s.players, true, nextKey).players };
    f = { ...f, status: "loading", updatedAt: r.at };
  }

  // Once it is over, the last frames of the game add nothing (unless someone left too early and came back).
  if (inGame && !(f.status === "ended" && (f.end?.winner || OVER.has(r.phase)))) {
    const m = mergePlayers(f.players, inGame.players, true, nextKey);
    const events = parseEvents(inGame, (i) => m.keys[i]);
    const over = inGame.events.find((e) => str(e.EventName) === "GameEnd");
    const won = str(over?.Result).toLowerCase();
    const { end: _end, ...rest } = f;
    void _end;
    f = {
      ...rest,
      status: "playing",
      mode: inGame.mode ?? f.mode,
      map: inGame.map ?? f.map,
      players: m.players,
      events: events.length ? events : f.events,
      clock: { sec: inGame.clock, at: r.at },
      updatedAt: r.at,
    };
    if (over && inGame.me && (won === "win" || won === "lose")) {
      const winner: Side = (won === "win") === (inGame.me === "blue") ? "blue" : "red";
      f = { ...f, status: "ended", end: { at: r.at, winner, reason: "unknown", durationSec: Math.round(num(over.EventTime) ?? inGame.clock) } };
    }
  }

  if (f.status === "select" && r.phase !== "ChampSelect" && GONE.has(r.phase)) return null; // champ select was cancelled
  if (f.status === "loading" && GONE.has(r.phase)) return null; // never started
  // The game is over, or the client no longer knows about it.
  if (f.status === "playing" && (OVER.has(r.phase) || GONE.has(r.phase)))
    f = { ...f, status: "ended", end: { at: r.at, durationSec: f.clock && Math.round(f.clock.sec) }, updatedAt: r.at };

  const eog = parseEog(r);
  if (eog && (f.gameId === eog.gameId || (!f.gameId && f.status === "ended"))) f = withResult(f, eog, r.at);
  // Someone who quit early only gets the result from match history.
  const history = parseHistory(r);
  if (history && f.gameId === history.gameId && (f.status === "ended" || history.winner || history.aborted)) f = withResult(f, history, r.at);
  return f;
}

/* ---------- for the site ---------- */

/** Riot IDs become players of the site. What's left has no Riot IDs, so it can be shown and stored. */
export function linkFeed(f: LiveFeed, players: Player[]): LiveFeed {
  const byRiot = new Map(players.filter((p) => p.active && p.riotId).map((p) => [p.riotId!.trim().toLowerCase(), p.id]));
  const keys = new Map(f.players.map((p, i) => [p.key, `s${i}`]));
  const swap = (k?: string) => (k ? keys.get(k) : undefined);
  const taken = new Set<string>();
  return {
    ...f,
    players: f.players.map(({ riotId, ...p }) => {
      const id = p.playerId ?? (riotId ? byRiot.get(riotId.toLowerCase()) : undefined);
      const playerId = id && !taken.has(id) ? id : undefined;
      if (playerId) taken.add(playerId);
      return { ...p, key: keys.get(p.key)!, ...(playerId ? { playerId } : {}) };
    }),
    events: f.events.map((e) => ({
      ...e,
      by: swap(e.by),
      victim: swap(e.victim),
      ...(e.helpers ? { helpers: e.helpers.map(swap).filter((x): x is string => !!x) } : {}),
    })),
  };
}

/** Over, but League named no winner: a member has to decide. */
export const needsWinner = (f: LiveFeed, now: number) =>
  f.status === "ended" && !f.choice && !f.end?.winner && (!!f.end?.aborted || now - (f.end?.at ?? 0) > NO_RESULT_MS);

export const waitingForResult = (f: LiveFeed, now: number) =>
  f.status === "ended" && !f.choice && !f.end?.winner && !needsWinner(f, now);

/** Is there something to show on the Live page? */
export function showFeed(f: LiveFeed | null | undefined, now: number): f is LiveFeed {
  if (!f || f.choice === "skip") return false;
  if (f.status !== "ended") return now - f.updatedAt < 6 * 36e5;
  const age = now - (f.end?.at ?? 0);
  return age < RECENT_MS || (needsWinner(f, now) && age < 24 * 36e5);
}

/** Game clock in seconds. Runs on between updates, and stops when updates stop. */
export const clockOf = (f: LiveFeed, now: number) =>
  f.clock ? f.clock.sec + Math.max(0, Math.min(now - f.clock.at, STALE_MS)) / 1e3 : 0;

export const isStale = (f: LiveFeed, now: number) => f.status !== "ended" && now - f.updatedAt > STALE_MS;

/** The game as it is saved. `null` while there is no winner, or when nobody from the site played. */
export function feedMatch(f: LiveFeed, opts: { solo: boolean }): Match | null {
  if (f.status !== "ended" || f.choice === "skip" || !f.end) return null;
  const winner = f.choice ?? f.end.winner;
  if (!winner) return null;
  const on = (side: Side) => f.players.filter((p) => p.side === side);
  const site = (side: Side) => on(side).flatMap((p) => (p.playerId ? [p.playerId] : []));
  const blue = site("blue");
  const red = site("red");
  if (opts.solo ? !blue.length && !red.length : !blue.length || !red.length) return null;
  const reason: EndReason = f.end.winner === winner ? (f.end.reason ?? "unknown") : "unknown";
  const guests = f.players.filter((p) => !p.playerId);
  const stats: Record<string, ParticipantStats> = {};
  for (const p of f.players) if (p.playerId) stats[p.playerId] = statsOf(p);
  const sec = f.end.durationSec;
  return {
    id: `g${f.gameId ?? f.id}`,
    gameId: f.gameId ?? f.id,
    playedAt: f.end.at,
    mode: Math.max(1, Math.min(5, Math.max(on("blue").length, on("red").length))) as TeamSize,
    blue,
    red,
    winner,
    stats,
    dodges: [],
    sitOut: [],
    end: reason,
    ...(reason === "ff" || reason === "left" ? { surrender: "ff" as const } : reason === "early" ? { surrender: "early" as const } : {}),
    ...(sec ? { durationSec: sec, durationMin: Math.max(1, Math.round(sec / 60)) } : {}),
    ...(guests.length ? { guests } : {}),
    ...(f.mode ? { gameMode: f.mode } : {}),
    ...(f.map ? { map: f.map } : {}),
  };
}

function statsOf({ champion, kills, deaths, assists, items, damage, level, spells, augments }: FeedPlayer): ParticipantStats {
  const s = { champion, kills, deaths, assists, items, damage, level, spells, augments };
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as ParticipantStats;
}

/** Saves a finished game once. Later news about it (augments) is added, but never changes who won. */
function withMatch(d: AppData, feed: LiveFeed, solo: boolean): AppData {
  const m = feedMatch(feed, { solo });
  if (!m) return { ...d, feed };
  const old = d.matches.find((x) => x.id === m.id || (!!x.gameId && x.gameId === m.gameId));
  if (!old) return feed.savedAs ? { ...d, feed } : { ...d, feed: { ...feed, savedAs: m.id }, matches: [...d.matches, m] };
  const next: Match = { ...old, ...m, id: old.id, playedAt: old.playedAt, winner: old.winner };
  if (old.winner !== m.winner) {
    next.end = old.end;
    next.surrender = old.surrender;
  }
  return { ...d, feed: { ...feed, savedAs: old.id }, matches: d.matches.map((x) => (x === old ? next : x)) };
}

/** The data with the newest look at the live game. */
export function applyFeed(d: AppData, incoming: LiveFeed | null, solo: boolean): AppData {
  // A finished game stays on the Live page for a while after League has moved on.
  if (!incoming) return d.feed && d.feed.status !== "ended" ? { ...d, feed: null } : d;
  const linked = linkFeed(incoming, d.players);
  const prev = d.feed?.id === linked.id ? d.feed : null;
  const feed: LiveFeed = {
    ...linked,
    ...(prev?.choice ? { choice: prev.choice } : {}),
    ...(prev?.savedAs ? { savedAs: prev.savedAs } : {}),
  };
  return prev && JSON.stringify(prev) === JSON.stringify(feed) ? d : withMatch(d, feed, solo);
}

/** A member decides a game that League named no winner for. */
export function decideFeed(d: AppData, feedId: string, choice: Side | "skip", solo: boolean): AppData {
  const f = d.feed;
  if (!f || f.id !== feedId || f.status !== "ended" || f.choice || f.end?.winner) return d;
  return withMatch(d, { ...f, choice }, solo);
}

/** Only ARAM: Mayhem has augments. Old games didn't save the mode. */
export const hasAugments = (mode: string | undefined, players: FeedPlayer[]) =>
  mode ? /mayhem/i.test(mode) : players.some((p) => p.augments?.length);

/** A saved game in the shape of the Live page. */
export function matchPlayers(m: Match): FeedPlayer[] {
  const mk = (id: string, side: Side): FeedPlayer => ({ key: id, playerId: id, side, items: [], spells: [], ...m.stats[id] });
  return [...m.blue.map((id) => mk(id, "blue")), ...m.red.map((id) => mk(id, "red")), ...(m.guests ?? [])];
}

/** "3v3", counting guests and bots. */
export function sizeLabel(m: Match) {
  const n = (s: Side) => m[s].length + (m.guests ?? []).filter((g) => g.side === s).length;
  return `${n("blue")}v${n("red")}`;
}

/** How a game ended, e.g. "Red surrendered (FF)". Empty when unknown. */
export function endText(winner: Side, reason?: EndReason): string {
  const loser = winner === "blue" ? "Red" : "Blue";
  switch (reason) {
    case "nexus":
      return `${loser}'s nexus was destroyed`;
    case "ff":
      return `${loser} surrendered (FF)`;
    case "early":
      return `${loser} surrendered early (FF)`;
    case "left":
      return `${loser} left the game (FF)`;
    default:
      return "";
  }
}
export const matchEnd = (m: Match) => endText(m.winner, m.end ?? m.surrender);

const MULTI = ["", "", "Double kill", "Triple kill", "Quadra kill", "Penta kill"];

/** One line of the log. */
export function eventText(e: FeedEvent, name: (key?: string) => string | undefined): string {
  const by = name(e.by) ?? (e.byThing ? `A ${e.byThing}`.replace("A i", "An i") : "Someone");
  const plus = e.helpers?.length ? ` (+${e.helpers.length})` : "";
  const team = e.side ? `a ${e.side}` : "a";
  switch (e.type) {
    case "start":
      return "Game started";
    case "kill":
      return `${by} killed ${name(e.victim) ?? "someone"}${plus}`;
    case "firstblood":
      return `First blood: ${by}`;
    case "multikill":
      return `${MULTI[Math.min(5, e.n ?? 0)] || "Multikill"}: ${by}`;
    case "ace":
      return e.side ? `${e.side === "blue" ? "Blue" : "Red"} team ace` : `Ace: ${by}`;
    case "firstturret":
      return `First turret: ${by}`;
    case "turret":
      return `${by} destroyed ${team} turret${plus}`;
    case "inhibitor":
      return `${by} destroyed ${team} inhibitor${plus}`;
  }
}
