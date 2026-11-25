/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/dev/sim";
import { STALE_MS, type Reading } from "../src/lib/live";
import { HEARTBEAT_MS, TAKEOVER_MS, step, tidy, type ServerState, type Step } from "../src/lib/liveServer";
import type { LiveFeed, Player } from "../src/lib/types";

const T0 = 1_800_000_000_000;
const PLAYERS: Player[] = ["Tosh", "Samu", "Lenny", "Nick"].map((name, i) => ({ id: `p${i}`, name, riotId: `${name}#EUW`, active: true, createdAt: 0 }));
const rid = (...n: string[]) => n.map((x) => `${x}#EUW`);

/** A server with one live game, as the Edge Function keeps it. */
function server() {
  let state: ServerState = { raw: null, token: null, at: 0 };
  let shown: LiveFeed | null = null;
  const saved: string[] = [];
  return {
    send(reading: Reading, token: string, now: number, save = true): Step {
      const s = step({ state, shown, reading, token, players: PLAYERS, solo: true, now });
      state = s.state;
      if (s.feed !== undefined) {
        shown = s.feed;
        if (s.save && save) {
          saved.push(s.save.match.id);
          shown = { ...s.feed!, savedAs: s.save.match.id };
        }
      }
      return s;
    },
    get shown() {
      return shown;
    },
    get token() {
      return state.token;
    },
    saved,
  };
}
const game = (seed = 1, blue = rid("Tosh"), red = rid("Nick")) => {
  const sim = new Sim({ blue, red, seed });
  sim.load();
  sim.start();
  sim.step(100);
  return sim;
};
const idle: Reading = { at: 0, phase: "Lobby" };

describe("the live server", () => {
  it("uses its own clock, and never shows Riot IDs", () => {
    const s = server();
    s.send(game().reading(5), "a", T0);
    expect(s.shown).toMatchObject({ status: "playing", updatedAt: T0, clock: { at: T0 } });
    expect(s.shown!.players.map((p) => p.playerId)).toEqual(["p0", "p3"]);
    expect(JSON.stringify(s.shown)).not.toContain("#EUW");
  });

  it("writes at once when something happens, otherwise only often enough to not look stale", () => {
    expect(HEARTBEAT_MS + 4000).toBeLessThan(STALE_MS);
    const s = server();
    const sim = game();
    expect(s.send(sim.reading(T0), "a", T0).feed).toBeTruthy();
    expect(s.send(sim.reading(T0), "a", T0 + 2000).feed).toBeUndefined();
    expect(s.send(sim.reading(T0), "a", T0 + HEARTBEAT_MS).feed).toBeTruthy();
    sim.step(400);
    expect(s.send(sim.reading(T0), "a", T0 + HEARTBEAT_MS + 1000).feed).toBeTruthy();
  });

  it("one helper is in charge; another one in the same game takes over when it goes quiet", () => {
    const s = server();
    const sim = game();
    s.send(sim.reading(T0), "a", T0);
    expect(s.send(sim.reading(T0), "b", T0 + 2000).note).toContain("in charge");
    expect(s.token).toBe("a");
    sim.step(60);
    s.send(sim.reading(T0), "b", T0 + TAKEOVER_MS + 1);
    expect(s.token).toBe("b");
    expect(s.shown).toMatchObject({ status: "playing" });
  });

  it("a helper that isn't in the game can't end or replace it", () => {
    const s = server();
    s.send(game().reading(T0), "a", T0);
    const ranked = new Sim({ blue: rid("X"), red: rid("Y"), seed: 9, custom: false });
    for (const [i, r] of [idle, { at: 0, phase: "None" }, { at: 0, phase: "Closed" }, ranked.reading(T0)].entries()) {
      s.send(r, "b", T0 + 2000 + i);
      s.send(r, "b", T0 + TAKEOVER_MS + 1000 + i);
    }
    expect(s.shown).toMatchObject({ status: "playing" });
    expect(s.token).toBe("a");
    // Its own helper leaving does end it.
    s.send(idle, "a", T0 + 60_000);
    expect(s.shown).toMatchObject({ status: "ended" });
  });

  it("a new game may start right after another helper's game ended", () => {
    const s = server();
    const sim = game();
    s.send(sim.reading(T0), "a", T0);
    sim.finish("nexus", 100);
    s.send(sim.reading(T0), "a", T0 + 2000);
    expect(s.saved).toHaveLength(1);
    s.send(game(2, rid("Samu"), rid("Lenny")).reading(T0), "b", T0 + 4000);
    expect(s.shown).toMatchObject({ status: "playing" });
    expect(s.shown!.savedAs).toBeUndefined();
    expect(s.token).toBe("b");
  });

  it("saves once, again when augments arrive, and retries if saving failed", () => {
    const s = server();
    const sim = game();
    s.send(sim.reading(T0), "a", T0);
    sim.finish("ff", 200);
    expect(s.send(sim.reading(T0), "a", T0 + 2000, false).save).toMatchObject({ known: false }); // could not be saved
    expect(s.send(sim.reading(T0), "a", T0 + 4000).save).toMatchObject({ known: false, match: { winner: "red", end: "ff" } });
    expect(s.send(sim.reading(T0), "a", T0 + 6000).save).toBeUndefined();
    sim.history = true;
    const s2 = s.send(sim.reading(T0), "a", T0 + 8000);
    if (s2.save) expect(s2.save.known).toBe(true);
    expect(s.send(sim.reading(T0), "a", T0 + 60_000).feed).toBeUndefined();
  });

  it("the finished game stays when League goes back to the lobby, a cancelled champ select doesn't", () => {
    const s = server();
    const sim = new Sim({ blue: rid("Tosh"), red: rid("Nick") });
    s.send(sim.reading(T0), "a", T0);
    expect(s.shown).toMatchObject({ status: "select" });
    expect(s.send(idle, "a", T0 + 2000).feed).toBeNull();
    const g2 = game(3);
    s.send(g2.reading(T0), "a", T0 + 4000);
    g2.finish("nexus");
    s.send(g2.reading(T0), "a", T0 + 6000);
    s.send(idle, "a", T0 + 8000);
    expect(s.shown).toMatchObject({ status: "ended" });
  });

  it("nothing a helper sends can be too big or break the rules of the database", () => {
    const big: LiveFeed = {
      id: "x".repeat(500), gameId: "9".repeat(500), status: "playing", mode: "m".repeat(500), map: "m".repeat(500), startedAt: 0, updatedAt: 0,
      players: Array.from({ length: 100 }, (_, i) => ({ key: "k".repeat(500), side: "blue" as const, champion: "c".repeat(500), kills: 1e9, deaths: -5, level: 1.6, items: [NaN, -1, 1.5, ...Array(50).fill(3031)], spells: [4, 32, 6], augments: Array(50).fill(i + 1) })),
      events: Array.from({ length: 500 }, (_, i) => ({ id: i, time: i, type: "kill" as const, helpers: Array(50).fill("a") })),
    };
    const f = tidy(big);
    expect(JSON.stringify(f).length).toBeLessThan(60_000);
    expect(f.players[0]).toMatchObject({ kills: 999, deaths: 0, level: 2, items: Array(10).fill(3031), spells: [4, 32] });
    expect(f.players[0].champion).toHaveLength(40);
    const s = server();
    for (const junk of [{}, { session: 5 }, { session: { gameData: [] }, inGame: "x" }, { inGame: { allPlayers: [null, 3] }, eog: [], history: {} }])
      for (const phase of ["ChampSelect", "InProgress", "EndOfGame", "x"]) expect(() => s.send({ at: 0, phase, ...junk } as Reading, "a", T0)).not.toThrow();
  });

  it("the bundle for the server is up to date (node scripts/build-live.mjs)", async () => {
    // @ts-expect-error plain JavaScript
    const { bundle, OUT } = (await import("../scripts/build-live.mjs")) as { bundle: () => Promise<string>; OUT: string };
    expect(readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") === (await bundle())).toBe(true);
  }, 30_000);
});
