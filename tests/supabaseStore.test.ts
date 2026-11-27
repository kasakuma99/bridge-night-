import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseStore } from "../src/data/supabaseStore";
import type { LiveFeed } from "../src/lib/types";

/* The store against a stand-in for Supabase: what it loads, when, and what it does with live updates. */

const M = "00000000-0000-4000-8000-000000000001";
const feed = (x: Partial<LiveFeed> = {}): LiveFeed => ({ id: "t1", status: "playing", players: [], events: [], startedAt: 1, updatedAt: 1, ...x });

function fake(over: Record<string, unknown[]> = {}) {
  const tables: Record<string, unknown[]> = {
    players: [{ id: "p0", name: "Tosh", active: true, created_at: "2026-01-01T00:00:00Z" }],
    player_riot_ids: [],
    matches: [{ id: M, played_at: "2026-01-01T00:00:00Z", mode: 5, winner: "red", sit_out: [], challenge: null, duration_min: 15, game_id: "55", live_id: null, surrender: "ff", end_reason: "left", duration_sec: 900, guests: [{ key: "s1", side: "red", items: [], spells: [], bot: true }], game_mode: "ARAM: Mayhem", map: "Howling Abyss" }],
    match_participants: [{ match_id: M, player_id: "p0", team: "blue", slot: 0, champion: "Yone", kills: 1, deaths: 2, assists: 3, items: [3031], damage: 4, level: 18, spells: [4, 32], augments: [7] }],
    dodge_log: [],
    live_game: [],
    settings: [{ dodge_hours: 12, dodges_per_team: 2, reroll_limit: 2, challenges_enabled: true, discord_url: "", save_live_games: true }],
    live_feed: [],
    test_games: [],
    rerolls: [],
    player_profiles: [],
    ...over,
  };
  const loads: string[] = [];
  let push: (p: unknown) => void = () => {};
  const invoke = vi.fn(async () => ({ error: null as unknown }));
  const sb = {
    auth: { onAuthStateChange: () => ({}) },
    channel: () => {
      const ch = { on: (_e: string, _f: unknown, cb: (p: unknown) => void) => ((push = cb), ch), subscribe: () => ch };
      return ch;
    },
    removeChannel: vi.fn(async () => {}),
    functions: { invoke },
    rpc: async (fn: string) => ({ data: tables[fn], error: null }),
    from: (t: string) => {
      loads.push(t);
      const rows = { data: tables[t], error: null };
      const q = { select: () => q, order: () => q, eq: () => q, range: async () => rows, maybeSingle: async () => ({ data: tables[t][0] ?? null, error: null }) };
      return q;
    },
  };
  return { sb: sb as unknown as SupabaseClient, tables, loads, invoke, live: (data: LiveFeed | null) => push({ table: "live_feed", eventType: data ? "UPDATE" : "DELETE", new: data ? { data } : {} }) };
}
const ready = (s: SupabaseStore) => vi.waitFor(() => expect(s.getState().status).toBe("ready"));

describe("the Supabase store", () => {
  it("adds Discord pictures (only from Discord) and rerolls", async () => {
    const f = fake({
      player_profiles: [{ player_id: "p0", avatar_url: "https://cdn.discordapp.com/a.png", display_name: "tosh" }, { player_id: "p9", avatar_url: "https://evil.example/a.png", display_name: "x" }],
      rerolls: [{ at: "2026-01-01T00:00:00Z", size: 3, players: ["p0"] }],
    });
    const s = new SupabaseStore(f.sb);
    s.setAccess(true);
    await ready(s);
    const d = s.getState().data;
    expect(d.players[0]).toMatchObject({ avatarUrl: "https://cdn.discordapp.com/a.png", discordName: "tosh" });
    expect(d.rerolls).toEqual([{ at: Date.parse("2026-01-01T00:00:00Z"), size: 3, players: ["p0"] }]);
  });

  it("still loads when the database has no pictures or rerolls yet", async () => {
    const f = fake();
    (f.sb as unknown as { rpc: unknown }).rpc = async () => ({ data: null, error: { message: "no such function" } });
    const s = new SupabaseStore(f.sb);
    s.setAccess(true);
    await ready(s);
    expect(s.getState().data.players[0].avatarUrl).toBeUndefined();
  });

  it("loads nothing without access, and forgets everything when it is taken away", async () => {
    const f = fake();
    const s = new SupabaseStore(f.sb);
    await s.refresh();
    expect(f.loads).toEqual([]);
    expect(s.getState().status).toBe("loading");
    s.setAccess(true);
    await ready(s);
    expect(s.getState().data.players).toHaveLength(1);
    s.setAccess(false);
    expect(s.getState()).toMatchObject({ status: "loading", data: { players: [], matches: [] } });
    const n = f.loads.length;
    await s.refresh();
    expect(f.loads).toHaveLength(n);
  });

  it("reads all details of a game", async () => {
    const s = new SupabaseStore(fake().sb);
    s.setAccess(true);
    await ready(s);
    expect(s.getState().data.matches[0]).toMatchObject({
      mode: 5, end: "left", surrender: "ff", durationSec: 900, gameMode: "ARAM: Mayhem", map: "Howling Abyss", guests: [{ bot: true }],
      stats: { p0: { champion: "Yone", level: 18, spells: [4, 32], augments: [7], items: [3031] } },
    });
  });

  it("takes live updates without loading everything again, until a game was saved", async () => {
    const f = fake({ live_feed: [{ data: feed() }] });
    const s = new SupabaseStore(f.sb);
    s.setAccess(true);
    await ready(s);
    expect(s.getState().data.feed).toMatchObject({ id: "t1" });
    const n = f.loads.length;
    f.live(feed({ updatedAt: 9, clock: { sec: 5, at: 9 } }));
    expect(s.getState().data.feed!.clock!.sec).toBe(5);
    await new Promise((r) => setTimeout(r, 250));
    expect(f.loads).toHaveLength(n);
    // A slower full load doesn't bring back an older look at the same game.
    await s.refresh();
    expect(s.getState().data.feed!.updatedAt).toBe(9);
    const n2 = f.loads.length;
    f.live(feed({ updatedAt: 10, status: "ended", savedAs: M }));
    await vi.waitFor(() => expect(f.loads.length).toBeGreaterThan(n2));
    f.live(null);
    expect(s.getState().data.feed).toBeNull();
  });

  it("shows test games before the release only, and protects them", async () => {
    const test = { data: { id: "g77", gameId: "77", playedAt: 1, mode: 1, blue: ["p0"], red: [], winner: "blue", stats: {}, dodges: [], sitOut: [] } };
    const f = fake({ test_games: [test] });
    const s = new SupabaseStore(f.sb);
    s.setAccess(true);
    await ready(s);
    expect(s.getState().data.matches.map((m) => m.id)).toEqual([M]);
    (f.tables.settings[0] as { save_live_games: boolean }).save_live_games = false;
    await s.refresh();
    expect(s.getState().data.matches.map((m) => m.id)).toEqual([M, "g77"]);
    await expect(s.deleteMatch("g77")).rejects.toThrow("test game");
    await expect(s.flipWinner("g77")).rejects.toThrow("test game");
  });

  it("a member's decision goes to the server, with its reason if it refuses", async () => {
    const f = fake();
    const s = new SupabaseStore(f.sb);
    s.setAccess(true);
    await ready(s);
    await s.decideFeed("t1", "blue");
    expect(f.invoke).toHaveBeenCalledWith("live", { body: { type: "decide", feedId: "t1", choice: "blue" } });
    f.invoke.mockResolvedValueOnce({ error: Object.assign(new Error("x"), { context: new Response(JSON.stringify({ note: "This game already has a result" }), { status: 409 }) }) });
    await expect(s.decideFeed("t1", "red")).rejects.toThrow("already has a result");
    f.invoke.mockResolvedValueOnce({ error: Object.assign(new Error("boom"), { context: new Response("{}", { status: 500 }) }) });
    await expect(s.decideFeed("t1", "red")).rejects.toThrow("Could not save the result");
    await expect(s.setFeed()).rejects.toThrow("helper");
  });
});
