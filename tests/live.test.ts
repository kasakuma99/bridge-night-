import { describe, expect, it } from "vitest";
import { Sim, type SimEnd } from "../src/dev/sim";
import { championFromId } from "../src/lib/champions";
import {
  NO_RESULT_MS,
  RECENT_MS,
  STALE_MS,
  applyFeed,
  clockOf,
  decideFeed,
  endReason,
  endText,
  eventText,
  feedMatch,
  hasAugments,
  isStale,
  linkFeed,
  matchPlayers,
  needsWinner,
  nextFeed,
  parseInGame,
  showFeed,
  sizeLabel,
  spellId,
  waitingForResult,
  type Reading,
} from "../src/lib/live";
import { badges, compute, formOf, periodStats, records, weeklyAwards } from "../src/lib/stats";
import { DEFAULT_SETTINGS, type AppData, type LiveFeed, type Player } from "../src/lib/types";

const T0 = 1_800_000_000_000;
const NAMES = ["Tosh", "Samu", "Lenny", "Artur", "Philip", "Nick"];
const PLAYERS: Player[] = NAMES.map((name, i) => ({ id: `p${i}`, name, riotId: `${name}#EUW`, active: true, createdAt: 0 }));
const rid = (...n: string[]) => n.map((x) => `${x}#EUW`);
const empty = (): AppData => ({ players: PLAYERS, matches: [], live: null, feed: null, settings: DEFAULT_SETTINGS });

/** Plays a game and returns every state on the way. */
function play(sim: Sim, how?: SimEnd, winner: 100 | 200 = 100, steps = 80) {
  let t = T0;
  let f = nextFeed(null, sim.reading(t));
  const select = f;
  sim.load();
  f = nextFeed(f, sim.reading((t += 2000)));
  const loading = f;
  sim.start();
  for (let i = 0; i < steps; i++) {
    sim.step(10);
    f = nextFeed(f, sim.reading((t += 2000)));
  }
  const playing = f;
  if (how) {
    sim.finish(how, winner);
    f = nextFeed(f, sim.reading((t += 2000)));
  }
  return { select: select!, loading: loading!, playing: playing!, end: f!, t };
}
const three = (seed = 7) => new Sim({ blue: rid("Tosh", "Samu", "Lenny"), red: rid("Artur", "Philip", "Nick"), seed });

describe("during a game", () => {
  it("goes through champ select, loading and playing", () => {
    const g = play(three());
    expect([g.select.status, g.loading.status, g.playing.status]).toEqual(["select", "loading", "playing"]);
    expect(g.select.gameId).toBeUndefined();
    expect(g.playing.id).toBe(g.select.id);
    expect(g.playing.gameId).toBe(String(three().gameId));
    expect(g.playing.mode).toBe("ARAM: Mayhem");
    expect(g.playing.map).toBe("Howling Abyss");
  });

  it("knows the sides in champ select, but shows no champions or spells yet (fair play)", () => {
    const { select, loading } = play(three());
    expect(select.players.map((p) => p.side)).toEqual(["blue", "blue", "blue", "red", "red", "red"]);
    expect(select.players.every((p) => !p.champion && !p.spells.length)).toBe(true);
    expect(loading.players.every((p) => p.champion)).toBe(true);
  });

  it("ignores the game before, which League still reports in champ select", () => {
    const sim = three();
    const r = sim.reading(T0, { names: { ...sim.reading(T0).names, "puuid-stranger": "Stranger#X" } });
    expect(JSON.stringify(r.session)).toContain("puuid-stranger");
    const f = nextFeed(null, r)!;
    expect(f.players).toHaveLength(6);
    expect(f.gameId).toBeUndefined();
    expect(JSON.stringify(f)).not.toMatch(/Stranger|6999999999/);
  });

  it("no ace lines against a single player, and nobody stays dead after the game", () => {
    const sim = new Sim({ blue: rid("Tosh"), red: rid("Nick") });
    const { playing, t } = play(sim);
    const r = sim.reading(t + 2000);
    const inGame = structuredClone(r.inGame) as { allPlayers: { isDead: boolean }[]; events: { Events: unknown[] } };
    inGame.events.Events.push({ EventID: 900, EventName: "Ace", EventTime: 802, Acer: "Tosh", AcingTeam: "ORDER" });
    inGame.allPlayers[0].isDead = true;
    const f = nextFeed(playing, { ...r, inGame })!;
    expect(f.players[0].dead).toBe(true);
    expect(f.events.some((e) => e.type === "ace")).toBe(false);
    sim.finish("ff");
    expect(nextFeed(f, sim.reading(t + 4000))!.players.some((p) => p.dead)).toBe(false);
  });

  it("knows both teams from the lobby, even when champ select shows only one", () => {
    const sim = new Sim({ blue: rid("Tosh"), red: rid("Nick"), redBots: 1 });
    const r = sim.reading(T0);
    expect(nextFeed(null, r)!.players.map((p) => [p.riotId, p.side, !!p.bot])).toEqual([["Tosh#EUW", "blue", false], ["Nick#EUW", "red", false], [undefined, "red", true]]);
    expect(nextFeed(null, { ...r, lobby: undefined })!.players.map((p) => p.riotId)).toEqual(["Tosh#EUW"]);
    expect(nextFeed(null, { ...r, lobby: undefined, champSelect: undefined })!.players).toEqual([]);
    const swapped = { ...r, champSelect: { myTeam: [{ puuid: "puuid-Tosh#EUW", team: 2 }] } };
    expect(nextFeed(null, swapped)!.players[0].side).toBe("red");
  });

  it("follows a side swap in champ select", () => {
    const sim = three();
    let f = nextFeed(null, sim.reading(T0));
    [sim.players[0].team, sim.players[3].team] = [200, 100];
    f = nextFeed(f, sim.reading(T0 + 2000));
    const L = linkFeed(f!, PLAYERS);
    expect(L.players).toHaveLength(6);
    expect(L.players.find((p) => p.playerId === "p0")!.side).toBe("red");
    expect(L.players.find((p) => p.playerId === "p3")!.side).toBe("blue");
  });

  it("has champions, levels, K/D/A, items, spells and the clock", () => {
    const sim = three();
    const { playing } = play(sim);
    expect(playing.players).toHaveLength(6);
    for (const [i, p] of playing.players.entries()) {
      const s = sim.players[i];
      expect(p).toMatchObject({ level: s.level, kills: s.k, deaths: s.d, assists: s.a, items: s.items, spells: s.spells.map((x) => x[1]) });
      expect(p.champion).toBe(championFromId(sim.champions[s.championId]));
    }
    expect(playing.clock!.sec).toBe(801);
  });

  it("the clock runs on between updates and stops when they stop", () => {
    const f = { ...play(three()).playing };
    const at = f.clock!.at;
    expect(clockOf(f, at + 3000)).toBe(804);
    expect(clockOf(f, at + 10 * 60_000)).toBe(801 + STALE_MS / 1000);
    expect(isStale(f, f.updatedAt + STALE_MS)).toBe(false);
    expect(isStale(f, f.updatedAt + STALE_MS + 1)).toBe(true);
  });

  it("logs events with names from the site", () => {
    const L = linkFeed(play(three(), undefined, 100, 25).playing, PLAYERS);
    const name = (k?: string) => PLAYERS.find((p) => p.id === L.players.find((x) => x.key === k)?.playerId)?.name;
    const lines = L.events.map((e) => eventText(e, name));
    expect(lines[0]).toBe("Game started");
    expect(lines.some((l) => /^(Tosh|Samu|Lenny|Artur|Philip|Nick) killed (Tosh|Samu|Lenny|Artur|Philip|Nick)/.test(l))).toBe(true);
    expect(lines.filter((l) => l.startsWith("First blood"))).toHaveLength(1);
    expect(lines.join()).not.toMatch(/undefined|Someone|someone/);
    expect(play(three()).playing.events).toHaveLength(80);
  });

  it("describes kills and turrets without a player", () => {
    const none = () => undefined;
    expect(eventText({ id: 1, time: 1, type: "kill", byThing: "turret", victim: "x" }, (k) => (k ? "Tosh" : undefined))).toBe("A turret killed Tosh");
    expect(eventText({ id: 1, time: 1, type: "turret", byThing: "minion", side: "red" }, none)).toBe("A minion destroyed a red turret");
    expect(eventText({ id: 1, time: 1, type: "multikill", n: 5 }, none)).toBe("Penta kill: Someone");
    expect(eventText({ id: 1, time: 1, type: "ace", side: "blue" }, none)).toBe("Blue team ace");
  });

  it("never keeps Riot IDs after linking", () => {
    for (const f of Object.values(play(three(), "nexus"))) if (typeof f === "object") expect(JSON.stringify(linkFeed(f, PLAYERS))).not.toMatch(/#|EUW/);
  });

  it("shows people who aren't on the site as guests, and bots as bots", () => {
    const sim = new Sim({ blue: rid("Tosh", "Stranger"), red: [], redBots: 2 });
    const { select, playing } = play(sim);
    expect(linkFeed(select, PLAYERS).players.map((p) => [p.playerId, !!p.bot])).toEqual([["p0", false], [undefined, false], [undefined, true], [undefined, true]]);
    const L = linkFeed(playing, PLAYERS);
    expect(L.players.map((p) => [p.playerId, !!p.bot])).toEqual([["p0", false], [undefined, false], [undefined, true], [undefined, true]]);
  });

  it("matches players by champion when names are hidden (streamer mode)", () => {
    const sim = three();
    let f = nextFeed(null, sim.reading(T0));
    sim.load();
    f = nextFeed(f, sim.reading(T0 + 1000));
    sim.start();
    sim.step(10);
    const r = sim.reading(T0 + 2000);
    const game = structuredClone(r.inGame) as { allPlayers: Record<string, unknown>[]; events: { Events: Record<string, unknown>[] } };
    for (const p of game.allPlayers) Object.assign(p, { riotId: "", riotIdGameName: p.championName, riotIdTagLine: "", summonerName: p.championName });
    f = nextFeed(f, { ...r, inGame: game });
    expect(linkFeed(f!, PLAYERS).players.map((p) => p.playerId)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("one Riot ID can't be two players", () => {
    const f = play(three()).playing;
    const twice = { ...f, players: f.players.map((p) => ({ ...p, riotId: "Tosh#EUW" })) };
    expect(linkFeed(twice, PLAYERS).players.filter((p) => p.playerId === "p0")).toHaveLength(1);
  });

  it("works for 1v1, 5v5, 3v2 and a game alone", () => {
    const G = ["Guest1", "Guest2", "Guest3", "Guest4"];
    for (const [b, r] of [[["Tosh"], ["Nick"]], [["Tosh", "Samu", "Lenny", "Artur", "Philip"], ["Nick", ...G]], [["Tosh", "Samu", "Lenny"], ["Artur", "Nick"]], [["Tosh"], []]] as string[][][]) {
      const { playing } = play(new Sim({ blue: rid(...b), red: rid(...r) }));
      expect(playing.players.filter((p) => p.side === "blue")).toHaveLength(b.length);
      expect(playing.players.filter((p) => p.side === "red")).toHaveLength(r.length);
    }
  });

  it("ignores games that aren't custom games", () => {
    const sim = new Sim({ blue: rid("Tosh"), red: rid("Nick"), custom: false });
    expect(nextFeed(null, sim.reading(T0))).toBeNull();
    sim.start();
    expect(nextFeed(null, sim.reading(T0))).toBeNull();
    const done = play(three(), "nexus").end;
    expect(nextFeed(done, sim.reading(T0 + 1e6))).toBe(done);
  });

  it("survives missing and broken data", () => {
    const sim = three();
    sim.start();
    const good = nextFeed(null, sim.reading(T0))!;
    for (const bad of [undefined, null, 5, "x", [], {}, { allPlayers: [null, 3, {}] }]) {
      const f = nextFeed(good, sim.reading(T0 + 2000, { inGame: bad, session: bad, eog: bad, history: bad } as Partial<Reading>));
      expect(f?.status).toBe("playing");
    }
    expect(nextFeed(good, { at: T0, phase: "Closed" })).toEqual(good);
    expect(parseInGame({})).toBeNull();
  });

  it("reads spells by their internal name, in any language", () => {
    expect(spellId({ displayName: "Blitz", rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" })).toBe(4);
    expect(spellId({ rawDisplayName: "GeneratedTip_SummonerSpell_SummonerSnowball_DisplayName" })).toBe(32);
    expect(spellId({ rawDisplayName: "GeneratedTip_SummonerSpell_SomethingNew_DisplayName" })).toBe(0);
    expect(spellId(undefined)).toBe(0);
    expect(championFromId("MonkeyKing")).toBe("Wukong");
    expect(championFromId("FiddleSticks")).toBe("Fiddlesticks");
    expect(championFromId("Brandnew", "Brand New")).toBe("Brand New");
  });

  it("champ select that is cancelled disappears", () => {
    const sim = three();
    const f = nextFeed(null, sim.reading(T0));
    sim.phase = "Lobby";
    expect(nextFeed(f, sim.reading(T0 + 2000))).toBeNull();
  });
});

describe("after a game", () => {
  it.each([["nexus", "nexus"], ["ff", "ff"], ["early", "early"], ["left", "left"]] as [SimEnd, string][])("%s", (how, reason) => {
    for (const winner of [100, 200] as const) {
      const { end } = play(three(), how, winner);
      expect(end.status).toBe("ended");
      expect(end.end).toMatchObject({ winner: winner === 100 ? "blue" : "red", reason, sure: true, durationSec: 801 });
      expect(end.players).toHaveLength(6);
    }
  });

  it("a team that left counts as FF, one player leaving doesn't", () => {
    const losers = (...left: boolean[]) => left.map((l) => ({ side: "red" as const, left: l }));
    expect(endReason({ winner: "blue", players: losers(true, true, true) })).toBe("left");
    expect(endReason({ winner: "blue", players: losers(true, true, false) })).toBe("nexus");
    expect(endReason({ winner: "blue", players: [{ side: "blue", left: true }, ...losers(false)] })).toBe("nexus");
    expect(endReason({ winner: "blue", surrender: "ff", players: losers(true) })).toBe("ff");
    expect(endReason({ winner: "blue", players: [{ side: "red", bot: true }] })).toBe("nexus");
    expect(endText("blue", "left")).toBe("Red left the game (FF)");
    const m = feedMatch(linkFeed(play(three(), "left").end, PLAYERS), { solo: true })!;
    expect(m).toMatchObject({ end: "left", surrender: "ff" });
  });

  it("augments arrive later and don't lose anything", () => {
    const sim = three();
    const { end, t } = play(sim, "left");
    expect(end.players.every((p) => !p.augments)).toBe(true);
    sim.history = true;
    const f = nextFeed(end, sim.reading(t + 30_000))!;
    expect(f.players.map((p) => p.augments)).toEqual(sim.players.map((p) => p.augments));
    expect(f.end).toMatchObject({ reason: "left", at: end.end!.at });
    expect(f.players).toHaveLength(6);
  });

  it("everyone left: no winner is guessed, a member decides after a while", () => {
    const { end, t } = play(new Sim({ blue: rid("Tosh"), red: [] }), "none");
    expect(end.status).toBe("ended");
    expect(end.end!.winner).toBeUndefined();
    expect(waitingForResult(end, t + 1000)).toBe(true);
    expect(needsWinner(end, t + NO_RESULT_MS + 1000)).toBe(true);
    expect(showFeed(end, t + 3 * RECENT_MS)).toBe(true);
    expect(feedMatch(linkFeed(end, PLAYERS), { solo: true })).toBeNull();
    const d = applyFeed(empty(), end, true);
    expect(d.matches).toHaveLength(0);
    const red = decideFeed(d, end.id, "red", true);
    expect(red.matches[0]).toMatchObject({ winner: "red", blue: ["p0"], red: [], end: "unknown" });
    expect(red.feed!.savedAs).toBe(red.matches[0].id);
    expect(decideFeed(red, end.id, "blue", true)).toBe(red);
    const skip = decideFeed(d, end.id, "skip", true);
    expect(skip.matches).toHaveLength(0);
    expect(showFeed(skip.feed, t)).toBe(false);
    expect(applyFeed(skip, { ...end, updatedAt: t + 9000 }, true).feed!.choice).toBe("skip");
  });

  it("an aborted match history entry asks at once, and can't overrule a real result", () => {
    const sim = three();
    const { end, t } = play(sim, "none");
    const f = nextFeed(end, sim.reading(t + 5000, { history: sim.matchHistory("Abort_TooFewPlayers") }))!;
    expect(f.end!.winner).toBeUndefined();
    expect(needsWinner(f, t + 5000)).toBe(true);
    const ok = three(8);
    const g = play(ok, "nexus", 200);
    const after = nextFeed(g.end, ok.reading(g.t + 5000, { history: ok.matchHistory("Abort_Unexpected") }))!;
    expect(after.end).toMatchObject({ winner: "red", reason: "nexus", sure: true });
    expect(after.end!.aborted).toBeUndefined();
  });

  it("alone, then left: exactly what League records for a real custom Mayhem game", () => {
    const sim = new Sim({ blue: rid("Tosh"), red: [] });
    const { playing, t } = play(sim);
    sim.phase = "WaitingForStats";
    let f = nextFeed(playing, sim.reading(t + 2000, { inGame: undefined }))!;
    expect(f.status).toBe("ended");
    sim.phase = "None";
    const history = { ...sim.matchHistory("Abort_TooFewPlayers"), teams: [{ teamId: 100, win: "Fail" }] };
    f = nextFeed(f, sim.reading(t + 4000, { session: undefined, history }))!;
    expect(f.end).toMatchObject({ aborted: true });
    expect(f.end!.winner).toBeUndefined();
    expect(needsWinner(f, t + 4000)).toBe(true);
  });

  it("one team only, nexus destroyed: exactly what League records for a real Practice Tool game", () => {
    const sim = new Sim({ blue: rid("Tosh"), red: [] });
    const { playing, t } = play(sim);
    sim.finish("nexus", 100);
    const r = sim.reading(t + 2000);
    const eog = r.eog as { teams: unknown[] };
    const f = nextFeed(playing, { ...r, phase: "PreEndOfGame", eog: { ...eog, teams: eog.teams.slice(0, 1) } })!;
    expect(f.end).toMatchObject({ winner: "blue", reason: "nexus", sure: true });
  });

  it("augments belong to ARAM: Mayhem only", () => {
    const none = matchPlayers(feedMatch(linkFeed(play(three(), "nexus").end, PLAYERS), { solo: true })!);
    expect(hasAugments("ARAM: Mayhem", none)).toBe(true);
    expect(hasAugments("Practice Tool", none.map((p) => ({ ...p, augments: [1] })))).toBe(false);
    expect(hasAugments(undefined, none)).toBe(false);
  });

  it("only the helper leaves: the game stays open until match history has the result", () => {
    const sim = three();
    let { end: f, t } = play(sim, "quit", 200);
    expect(f.status).toBe("playing");
    f = nextFeed(f, sim.reading((t += 60_000)))!;
    expect(f.status).toBe("playing");
    expect(isStale(f, t)).toBe(true);
    sim.othersFinish();
    f = nextFeed(f, sim.reading((t += 60_000)))!;
    expect(f.status).toBe("ended");
    expect(f.end).toMatchObject({ winner: "red", sure: true });
    expect(f.players.every((p) => p.augments)).toBe(true);
  });

  it("the helper reconnects and the game goes on", () => {
    const sim = three();
    const { playing, t } = play(sim);
    sim.phase = "Reconnect";
    const away = nextFeed(playing, sim.reading(t + 2000))!;
    sim.phase = "InProgress";
    sim.step(60);
    const back = nextFeed(away, sim.reading(t + 60_000))!;
    expect(back).toMatchObject({ id: playing.id, status: "playing", clock: { sec: 861 } });
  });

  it("reads the winner from the game itself if nothing else comes", () => {
    const sim = three();
    const { playing, t } = play(sim);
    const r = sim.reading(t + 2000);
    const inGame = structuredClone(r.inGame) as { events: { Events: unknown[] } };
    inGame.events.Events.push({ EventID: 999, EventName: "GameEnd", EventTime: 805, Result: "Lose" });
    const f = nextFeed(playing, { ...r, inGame })!;
    expect(f.end).toMatchObject({ winner: "red", reason: "unknown", durationSec: 805 });
    sim.finish("ff", 200);
    expect(nextFeed(f, sim.reading(t + 9000))!.end).toMatchObject({ winner: "red", reason: "ff", sure: true });
  });

  it("stays for a few minutes, also when the lobby is open again", () => {
    const sim = three();
    const { end, t } = play(sim, "nexus");
    sim.phase = "Lobby";
    const f = nextFeed(end, sim.reading(t + 5000, { session: { gameData: { isCustomGame: true } } }))!;
    expect(f.status).toBe("ended");
    expect(showFeed(f, f.end!.at + RECENT_MS - 1)).toBe(true);
    expect(showFeed(f, f.end!.at + RECENT_MS + 1)).toBe(false);
  });

  it("a new game replaces the finished one", () => {
    const { end, t } = play(three(), "nexus");
    const f = nextFeed(end, three(9).reading(t + 60_000))!;
    expect(f.status).toBe("select");
    expect(f.gameId).not.toBe(end.gameId);
    expect(f.end).toBeUndefined();
  });

  it("another game's result is not mixed in", () => {
    const sim = three();
    const other = three(11);
    play(other, "ff");
    const { playing, t } = play(sim);
    const f = nextFeed(playing, { ...sim.reading(t + 1000), eog: other.reading(t).eog, history: other.matchHistory() })!;
    expect(f.status).toBe("playing");
  });
});

describe("saving", () => {
  const ended = (how: SimEnd = "nexus", winner: 100 | 200 = 100) => {
    const sim = three();
    return { sim, ...play(sim, how, winner) };
  };

  it("saves once, with everything from the live page", () => {
    const { sim, end } = ended();
    let d = applyFeed(empty(), end, true);
    d = applyFeed(d, { ...end, updatedAt: end.updatedAt + 1 }, true);
    expect(d.matches).toHaveLength(1);
    const m = d.matches[0];
    expect(m).toMatchObject({ blue: ["p0", "p1", "p2"], red: ["p3", "p4", "p5"], winner: "blue", mode: 3, durationSec: 801, gameMode: "ARAM: Mayhem" });
    expect(m.stats.p0).toMatchObject({ level: sim.players[0].level, kills: sim.players[0].k, items: sim.players[0].items });
    expect(JSON.stringify(d.matches) + JSON.stringify(d.feed)).not.toContain("#");
    expect(sizeLabel(m)).toBe("3v3");
    expect(matchPlayers(m)).toHaveLength(6);
  });

  it("an unchanged feed changes nothing", () => {
    const { end } = ended();
    const d = applyFeed(empty(), end, true);
    expect(applyFeed(d, end, true)).toBe(d);
    expect(applyFeed(d, null, true)).toBe(d);
  });

  it("augments are added to the saved game, and a corrected winner stays", () => {
    const { sim, end, t } = ended();
    let d = applyFeed(empty(), end, true);
    d = { ...d, matches: d.matches.map((m) => ({ ...m, winner: "red" as const })) };
    sim.history = true;
    d = applyFeed(d, nextFeed(end, sim.reading(t + 5000)), true);
    expect(d.matches).toHaveLength(1);
    expect(d.matches[0].winner).toBe("red");
    expect(d.matches[0].stats.p0.augments).toEqual(sim.players[0].augments);
  });

  it("a deleted game doesn't come back", () => {
    const { sim, end, t } = ended();
    let d = applyFeed(empty(), end, true);
    d = { ...d, matches: [] };
    sim.history = true;
    d = applyFeed(d, nextFeed(end, sim.reading(t + 5000)), true);
    expect(d.matches).toHaveLength(0);
  });

  it("solo games count only while the switch is on, games of strangers never", () => {
    const solo = linkFeed(play(new Sim({ blue: rid("Tosh"), red: [], redBots: 3 }), "nexus").end, PLAYERS);
    expect(feedMatch(solo, { solo: false })).toBeNull();
    const m = feedMatch(solo, { solo: true })!;
    expect([m.blue, m.red, m.guests!.length, sizeLabel(m), m.mode]).toEqual([["p0"], [], 3, "1v3", 3]);
    const strangers = linkFeed(play(new Sim({ blue: rid("A1"), red: rid("B1") }), "nexus").end, PLAYERS);
    expect(feedMatch(strangers, { solo: true })).toBeNull();
  });

  it("stats work with a side nobody from the site played on", () => {
    const solo = feedMatch(linkFeed(play(new Sim({ blue: rid("Tosh"), red: [] }), "nexus").end, PLAYERS), { solo: true })!;
    const lost = { ...solo, id: "x", gameId: "x", winner: "red" as const, playedAt: solo.playedAt + 1 };
    const now = solo.playedAt + 1000;
    const c = compute([solo, lost], PLAYERS, now);
    expect(c.st.p0).toMatchObject({ g: 2, w: 1, l: 1, bestStreak: 1, streak: -1 });
    expect(Number.isFinite(c.st.p0.rating)).toBe(true);
    expect(() => badges(c.st.p0)).not.toThrow();
    const on = () => true;
    expect(periodStats([solo, lost], 0, on).rows).toHaveLength(1);
    expect(() => [records([solo, lost], 0, on), weeklyAwards([solo, lost], now, on)]).not.toThrow();
    expect(formOf([solo, lost], "p0", 5)).toEqual([true, false]);
  });

  it("old games without the new details still work", () => {
    const old = { id: "m", playedAt: T0, mode: 2 as const, blue: ["p0"], red: ["p1"], winner: "blue" as const, stats: {}, dodges: [], sitOut: [], surrender: "ff" as const };
    expect(sizeLabel(old)).toBe("1v1");
    expect(matchPlayers(old).map((p) => [p.playerId, p.items])).toEqual([["p0", []], ["p1", []]]);
  });

  it("a Riot ID added after the game still links it", () => {
    const { end } = ended();
    const none = { ...empty(), players: PLAYERS.map((p) => ({ ...p, riotId: undefined })) };
    const d = applyFeed(none, end, true);
    expect(d.matches).toHaveLength(0);
    expect(applyFeed({ ...d, players: PLAYERS }, end, true).matches).toHaveLength(1);
  });

  it("the running game disappears when League has none, a finished one doesn't", () => {
    const d = applyFeed(empty(), play(three()).playing as LiveFeed, true);
    expect(applyFeed(d, null, true).feed).toBeNull();
  });
});
