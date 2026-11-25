import { FALLBACK_CHAMPIONS, SAMPLE_ITEM_NAMES, guessId } from "../lib/champions";
import type { Reading } from "../lib/live";
import { seeded, shuffle, type Rng } from "../lib/util";

/*
 * A fake League for development and tests: produces the same raw data as the real client and game,
 * so it runs through exactly the same code. Never part of the production build.
 */

/** nexus/ff/early/left: normal endings. none: everyone left, League records nothing. quit: only the helper's player left. */
export type SimEnd = "nexus" | "ff" | "early" | "left" | "none" | "quit";

interface SimPlayer {
  riotId: string;
  bot: boolean;
  team: 100 | 200;
  championId: number;
  level: number;
  k: number;
  d: number;
  a: number;
  items: number[];
  spells: [string, number][];
  augments: number[];
  left: boolean;
}

export interface SimOptions {
  /** Riot IDs. The first one is the player running the helper. */
  blue: string[];
  red: string[];
  blueBots?: number;
  redBots?: number;
  seed?: number;
  custom?: boolean;
}

const SPELLS: [string, number][] = [["SummonerFlash", 4], ["SummonerSnowball", 32], ["SummonerHeal", 7], ["SummonerBarrier", 21], ["SummonerExhaust", 3], ["SummonerHaste", 6], ["SummonerDot", 14]];
const AUGMENTS = [1205, 1141, 1002, 1004, 1006, 1007, 1009, 1011, 1013, 1018, 1020, 1027];

export class Sim {
  readonly gameId: number;
  readonly champions: Record<number, string> = Object.fromEntries(FALLBACK_CHAMPIONS.map((n, i) => [i + 1, guessId(n)]));
  players: SimPlayer[] = [];
  phase = "ChampSelect";
  clock = 0;
  winner: 100 | 200 = 100;
  ended: SimEnd | null = null;
  /** match history is ready */
  history = false;
  private events: Record<string, unknown>[] = [];
  private r: Rng;
  private custom: boolean;

  constructor(o: SimOptions) {
    this.r = seeded(o.seed ?? 7);
    this.custom = o.custom ?? true;
    this.gameId = 7_000_000_000 + (o.seed ?? 7);
    const champs = shuffle(Object.keys(this.champions).map(Number), this.r);
    const add = (riotId: string, team: 100 | 200, bot: boolean) =>
      this.players.push({
        riotId, bot, team, championId: champs[this.players.length], level: 3, k: 0, d: 0, a: 0, items: [], augments: [], left: false,
        spells: [SPELLS[0], SPELLS[1 + Math.floor(this.r() * (SPELLS.length - 1))]],
      });
    o.blue.forEach((x) => add(x, 100, false));
    for (let i = 0; i < (o.blueBots ?? 0); i++) add("", 100, true);
    o.red.forEach((x) => add(x, 200, false));
    for (let i = 0; i < (o.redBots ?? 0); i++) add("", 200, true);
  }

  private champ = (p: SimPlayer) => this.champions[p.championId];
  private puuid = (p: SimPlayer) => (p.bot ? "00000000-0000-0000-0000-000000000000" : `puuid-${p.riotId}`);
  private name = (p: SimPlayer) => (p.bot ? `${this.champ(p)} Bot` : p.riotId.split("#")[0]);
  private team = (n: number) => this.players.filter((p) => p.team === n);
  private event(EventName: string, rest: Record<string, unknown> = {}) {
    this.events.push({ EventID: this.events.length, EventName, EventTime: this.clock, ...rest });
  }

  load() {
    this.phase = "InProgress";
    this.clock = 0;
  }
  /** The game itself starts. */
  start() {
    this.load();
    this.clock = 1;
    this.event("GameStart");
  }

  /** Lets some game time pass: kills, items, levels and now and then a turret. */
  step(sec: number) {
    if (this.phase !== "InProgress" || this.clock === 0) return;
    this.clock += sec;
    for (const p of this.players) {
      p.level = Math.min(18, 3 + Math.floor(this.clock / 70));
      const want = Math.min(6, Math.floor(this.clock / 150));
      const pool = Object.keys(SAMPLE_ITEM_NAMES).map(Number).filter((i) => !p.items.includes(i));
      if (p.items.length < want) p.items.push(pool[Math.floor(this.r() * pool.length)]);
      const augs = Math.min(4, 1 + Math.floor(this.clock / 300));
      if (p.augments.length < augs) p.augments.push(AUGMENTS[Math.floor(this.r() * AUGMENTS.length)]);
    }
    const [a, b] = this.r() < 0.5 ? [100, 200] : [200, 100];
    const killers = this.team(a);
    const victims = this.team(b);
    if (!killers.length || !victims.length) return;
    if (this.r() < Math.min(0.9, sec / 12)) {
      const killer = killers[Math.floor(this.r() * killers.length)];
      const victim = victims[Math.floor(this.r() * victims.length)];
      const helpers = killers.filter((p) => p !== killer && this.r() < 0.6);
      killer.k++;
      victim.d++;
      for (const h of helpers) h.a++;
      const first = !this.events.some((e) => e.EventName === "ChampionKill");
      this.event("ChampionKill", { KillerName: this.name(killer), VictimName: this.name(victim), Assisters: helpers.map(this.name) });
      if (first) this.event("FirstBlood", { Recipient: this.name(killer) });
      else if (this.r() < 0.15) this.event("Multikill", { KillerName: this.name(killer), KillStreak: 2 + Math.floor(this.r() * 2) });
      if (this.r() < 0.06) this.event("Ace", { Acer: this.name(killer), AcingTeam: a === 100 ? "ORDER" : "CHAOS" });
    }
    if (this.r() < sec / 200) {
      const killer = killers[Math.floor(this.r() * killers.length)];
      const first = !this.events.some((e) => e.EventName === "TurretKilled");
      this.event("TurretKilled", { TurretKilled: `Turret_T${b === 100 ? 1 : 2}_C_0${1 + Math.floor(this.r() * 5)}_A`, KillerName: this.name(killer), Assisters: [] });
      if (first) this.event("FirstBrick", { KillerName: this.name(killer) });
      else if (this.r() < 0.3) this.event("InhibKilled", { InhibKilled: `Barracks_T${b === 100 ? 1 : 2}_C1`, KillerName: this.name(killer), Assisters: [] });
    }
  }

  finish(how: SimEnd, winner: 100 | 200 = 100) {
    this.ended = how;
    this.winner = winner;
    if (how === "left") for (const p of this.team(winner === 100 ? 200 : 100)) p.left = true;
    if (how === "none") for (const p of this.players) p.left = true;
    this.phase = how === "none" ? "Lobby" : how === "quit" ? "Reconnect" : "EndOfGame";
  }
  /** After "quit": the others finish the game. */
  othersFinish() {
    this.phase = "Lobby";
    this.history = true;
  }

  reading(at: number, over: Partial<Reading> = {}): Reading {
    const running = this.phase === "InProgress" && this.clock > 0;
    const done = this.phase === "EndOfGame";
    const select = this.phase === "ChampSelect";
    // As in the real client: until the game loads, these still hold the game before.
    const before = [{ puuid: "puuid-stranger", championId: 1, spell1Id: 4, spell2Id: 14 }];
    const lobby = (n: number) =>
      select ? before : this.team(n).map((p) => ({ puuid: this.puuid(p), championId: p.championId, spell1Id: p.spells[0][1], spell2Id: p.spells[1][1] }));
    return {
      at,
      phase: this.phase,
      names: Object.fromEntries(this.players.filter((p) => !p.bot).map((p) => [this.puuid(p), p.riotId])),
      champions: this.champions,
      session:
        this.phase === "Lobby"
          ? undefined
          : {
              phase: this.phase,
              gameData: { gameId: select ? 6_999_999_999 : this.gameId, isCustomGame: this.custom, teamOne: lobby(100), teamTwo: lobby(200), playerChampionSelections: [], queue: { id: 3270 } },
              map: { id: 12, gameMode: "KIWI" },
            },
      ...(select
        ? {
            lobby: {
              gameConfig: {
                isCustom: true,
                customTeam100: this.team(100).map((p) => ({ puuid: p.bot ? "" : this.puuid(p), isBot: p.bot })),
                customTeam200: this.team(200).map((p) => ({ puuid: p.bot ? "" : this.puuid(p), isBot: p.bot })),
              },
            },
            champSelect: { myTeam: this.team(100).filter((p) => !p.bot).map((p) => ({ puuid: this.puuid(p), team: 1, championId: p.championId })), theirTeam: [] },
          }
        : {}),
      inGame: running ? this.allGameData() : undefined,
      eog: done ? this.eog() : undefined,
      history: this.history ? this.matchHistory() : undefined,
      ...over,
    };
  }

  private allGameData() {
    const spell = (s: [string, number]) => ({ displayName: s[0], rawDisplayName: `GeneratedTip_SummonerSpell_${s[0]}_DisplayName` });
    return {
      activePlayer: { riotId: this.players[0]?.riotId },
      allPlayers: this.players.map((p) => ({
        championName: this.champ(p),
        rawChampionName: `game_character_displayname_${this.champ(p)}`,
        isBot: p.bot,
        isDead: false,
        items: p.items.map((itemID, slot) => ({ itemID, slot, count: 1 })),
        level: p.level,
        riotId: p.bot ? this.name(p) + "#" : p.riotId,
        riotIdGameName: this.name(p),
        riotIdTagLine: p.bot ? "" : p.riotId.split("#")[1],
        scores: { kills: p.k, deaths: p.d, assists: p.a, creepScore: 0, wardScore: 0 },
        summonerSpells: { summonerSpellOne: spell(p.spells[0]), summonerSpellTwo: spell(p.spells[1]) },
        team: p.team === 100 ? "ORDER" : "CHAOS",
      })),
      events: { Events: this.events },
      gameData: { gameMode: "KIWI", gameTime: this.clock, mapName: "Map12", mapNumber: 12 },
    };
  }

  private eog() {
    const ff = this.ended === "ff";
    const early = this.ended === "early";
    return {
      gameId: this.gameId,
      gameLength: Math.round(this.clock),
      invalid: false,
      teams: [100, 200].map((n) => ({
        teamId: n,
        isWinningTeam: n === this.winner,
        players: this.team(n).map((p) => ({
          puuid: this.puuid(p),
          botPlayer: p.bot,
          championId: p.championId,
          leaver: p.left,
          teamId: n,
          items: [...p.items, ...Array(7 - p.items.length).fill(0)],
          spell1Id: p.spells[0][1],
          spell2Id: p.spells[1][1],
          stats: {
            LEVEL: p.level, CHAMPIONS_KILLED: p.k, NUM_DEATHS: p.d, ASSISTS: p.a, TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: 1000 * p.k + 800,
            GAME_ENDED_IN_SURRENDER: ff ? 1 : 0, GAME_ENDED_IN_EARLY_SURRENDER: early ? 1 : 0,
          },
        })),
      })),
    };
  }

  matchHistory(endOfGameResult = "GameComplete") {
    return {
      gameId: this.gameId,
      gameDuration: Math.round(this.clock),
      endOfGameResult,
      teams: [100, 200].map((n) => ({ teamId: n, win: n === this.winner ? "Win" : "Fail" })),
      participantIdentities: this.players.map((p, i) => ({ participantId: i + 1, player: { puuid: this.puuid(p) } })),
      participants: this.players.map((p, i) => ({
        participantId: i + 1,
        teamId: p.team,
        championId: p.championId,
        spell1Id: p.spells[0][1],
        spell2Id: p.spells[1][1],
        stats: {
          champLevel: p.level, kills: p.k, deaths: p.d, assists: p.a, totalDamageDealtToChampions: 1000 * p.k + 800,
          gameEndedInSurrender: this.ended === "ff", gameEndedInEarlySurrender: this.ended === "early",
          ...Object.fromEntries(p.items.map((x, k) => [`item${k}`, x])),
          ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((k) => [`playerAugment${k}`, p.augments[k - 1] ?? 0])),
        },
      })),
    };
  }
}
