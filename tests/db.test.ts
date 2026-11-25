/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";
import { Sim } from "../src/dev/sim";
import { decide, step, type ServerState } from "../src/lib/liveServer";
import type { LiveFeed, Match, Player } from "../src/lib/types";

/* The real database changes, run in a small Postgres. Supabase's own parts (roles, auth) are stand-ins. */

const SUPABASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema auth;
  grant usage on schema extensions, auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.claims() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.claims() ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.claims() ->> 'role' $$;
  create publication supabase_realtime;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const P = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const [ADMIN, MEMBER, PENDING, ADMIN2, GHOST] = [1, 2, 3, 4, 5].map(U);
const NAMES = ["Tosh", "Samu", "Lenny", "Artur", "Philip", "Nick"];

const PRIVATE = "20261126110000_private.sql";

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows[0];

type Who = "anon" | "service" | string;
/** Runs something the way Supabase would run it for this person. */
async function as<T = Record<string, unknown>>(who: Who, sql: string, args: unknown[] = []): Promise<T[]> {
  const role = who === "anon" ? "anon" : who === "service" ? "service_role" : "authenticated";
  const claims = JSON.stringify({ role, ...(role === "authenticated" ? { sub: who } : {}) });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, args)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}
const refused = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|row-level security|members only|admins only/i);

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  const files = readdirSync("supabase/migrations").sort();
  // What is live today, with data, before the new migration.
  for (const f of files.filter((x) => x < "20261126")) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const [id, name] of [[ADMIN, "Admin"], [MEMBER, "Member"], [PENDING, "New"], [ADMIN2, "Admin2"], [GHOST, "Ghost"]])
    await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, JSON.stringify({ full_name: name, avatar_url: "https://cdn.discordapp.com/a.png" })]);
  await db.query("update public.members set role = 'admin' where user_id in ($1, $2)", [ADMIN, ADMIN2]);
  await db.query("update public.members set role = 'member' where user_id = $1", [MEMBER]);
  await db.query("delete from public.members where user_id = $1", [GHOST]);
  for (const [i, n] of NAMES.entries()) {
    await db.query("insert into public.players (id, name) values ($1, $2)", [P(i), n]);
    await db.query("insert into public.player_riot_ids (player_id, riot_id) values ($1, $2)", [P(i), `${n}#EUW`]);
  }
  await db.query("insert into public.matches (id, mode, winner) values ($1, 1, 'blue')", [U(9)]);
  await db.query("insert into public.match_participants (match_id, player_id, team) values ($1, $2, 'blue'), ($1, $3, 'red')", [U(9), P(0), P(1)]);
  // The private part follows below.
  for (const f of files.filter((x) => x >= "20261126" && x !== PRIVATE)) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
}, 60_000);

/* The database part of the live Edge Function. */
async function load() {
  const s = await one<{ data: LiveFeed | null; token_id: string | null; version: number }>("select data, token_id, version from public.live_state");
  const f = await one<{ data: LiveFeed }>("select data from public.live_feed");
  return { version: Number(s?.version ?? 0), raw: s?.data ?? null, shown: f?.data ?? null };
}
async function put(version: number, raw: LiveFeed | null, feed: LiveFeed | null | undefined) {
  const r = await as<{ ok: boolean }>("service", "select public._put_live($1, $2, $3, $4, null) as ok", [version, raw && JSON.stringify(raw), feed ? JSON.stringify(feed) : null, feed === null]);
  return r[0].ok;
}
const save = async (m: Match, known: boolean) => (await as<{ id: string | null }>("service", "select public._save_live_game($1, $2) as id", [JSON.stringify(m), known]))[0].id;

const T0 = 1_800_000_000_000;
let t = T0;
const PLAYERS: Player[] = NAMES.map((name, i) => ({ id: P(i), name, riotId: `${name}#EUW`, active: true, createdAt: 0 }));
const rid = (...n: string[]) => n.map((x) => `${x}#EUW`);

/** Plays a whole game through the server code and the database. */
async function play(sim: Sim, how: "nexus" | "ff" | "none", winner: 100 | 200 = 100) {
  let state: ServerState = { raw: null, token: null, at: 0 };
  const tick = async () => {
    t += 2000;
    const { version, raw, shown } = await load();
    const s = step({ state: { ...state, raw }, shown, reading: sim.reading(t), token: "a", players: PLAYERS, solo: true, now: t });
    let feed = s.feed;
    if (s.save && feed) {
      const id = await save(s.save.match, s.save.known);
      if (id) feed = { ...feed, savedAs: id };
    }
    expect(await put(version, s.state.raw, feed)).toBe(true);
    state = s.state;
  };
  await tick();
  sim.load();
  await tick();
  sim.start();
  for (let i = 0; i < 12; i++) {
    sim.step(60);
    await tick();
  }
  sim.finish(how, winner);
  await tick();
  sim.history = how !== "none";
  await tick();
  await tick();
  return { shown: (await load()).shown!, after: () => tick() };
}

describe("before the release: nothing changes for the site that is live today", () => {
  it("visitors still read games, and members still edit them", async () => {
    expect(await as("anon", "select id,played_at,mode,winner,sit_out,challenge,duration_min,game_id,live_id,surrender from public.matches")).toHaveLength(1);
    expect(await as("anon", "select match_id,player_id,team,slot,champion,kills,deaths,assists,items,damage from public.match_participants")).toHaveLength(2);
    expect(await as("anon", "select * from public.settings")).toHaveLength(1);
    await as(MEMBER, "update public.matches set winner = 'red' where id = $1", [U(9)]);
    expect((await one<{ winner: string }>("select winner from public.matches"))!.winner).toBe("red");
  });

  it("the live game is for members only, the state with Riot IDs for nobody", async () => {
    await refused(as("anon", "select * from public.live_feed"));
    expect(await as(PENDING, "select * from public.live_feed")).toHaveLength(0);
    for (const who of ["anon", PENDING, MEMBER, ADMIN]) await refused(as(who, "select * from public.live_state"));
    for (const who of ["anon", PENDING, MEMBER, ADMIN]) {
      await refused(as(who, "select public._put_live(0, null, null, false, null)"));
      await refused(as(who, "select public._save_live_game('{}', false)"));
      await refused(as(who, "insert into public.live_feed (data) values ('{}')"));
    }
    for (const who of [MEMBER, ADMIN]) await refused(as(who, "update public.settings set save_live_games = true"));
  });

  it("people without a member row get one and wait", async () => {
    await refused(as("anon", "select public.ensure_member()"));
    expect(await as(GHOST, "select public.ensure_member() as r")).toEqual([{ r: "pending" }]);
    expect(await as(ADMIN, "select public.ensure_member() as r")).toEqual([{ r: "admin" }]);
  });

  it("only admins link members to players, one player per member", async () => {
    await as(MEMBER, "update public.members set player_id = $1 where user_id = $2", [P(0), MEMBER]);
    expect((await one<{ player_id: string }>("select player_id from public.members where user_id = $1", [MEMBER]))!.player_id).toBeNull();
    await as(ADMIN, "update public.members set player_id = $1 where user_id = $2", [P(0), MEMBER]);
    await expect(as(ADMIN, "update public.members set player_id = $1 where user_id = $2", [P(0), ADMIN])).rejects.toThrow(/unique/);
  });
});

describe("live games", () => {
  it("a 3v3 from champ select to Past games, with everything", async () => {
    const g = await play(new Sim({ blue: rid("Tosh", "Samu", "Lenny"), red: rid("Artur", "Philip", "Nick"), seed: 11 }), "ff", 200);
    expect(g.shown).toMatchObject({ status: "ended", end: { winner: "red", reason: "ff" } });
    expect(JSON.stringify(g.shown)).not.toMatch(/#EUW|puuid/);
    const m = await one("select * from public.matches where game_id is not null");
    expect(m).toMatchObject({ id: g.shown.savedAs, mode: 3, winner: "red", surrender: "ff", end_reason: "ff", game_mode: "ARAM: Mayhem", map: "Howling Abyss" });
    expect(Number(m!.duration_sec)).toBeGreaterThan(600);
    const parts = (await db.query<{ champion: string; level: number; kills: number; items: number[]; spells: number[]; augments: number[] }>("select * from public.match_participants where match_id = $1", [g.shown.savedAs])).rows;
    expect(parts).toHaveLength(6);
    for (const p of parts) {
      expect(p.champion).toBeTruthy();
      expect(p.level).toBeGreaterThan(5);
      expect(p.items.length).toBeGreaterThan(0);
      expect(p.spells).toHaveLength(2);
      expect(p.augments.length).toBeGreaterThan(0);
    }
    // Saved once, however often the helper reports it.
    await g.after();
    expect(await db.query("select 1 from public.matches where game_id is not null").then((r) => r.rows.length)).toBe(1);
  });

  it("an admin's corrected winner stays, and a deleted game doesn't come back", async () => {
    const f = (await load()).shown!;
    const m: Match = { id: "x", gameId: f.gameId, playedAt: T0, mode: 3, blue: [P(0)], red: [P(3)], winner: "red", stats: {}, dodges: [], sitOut: [], end: "nexus" };
    await as(ADMIN, "update public.matches set winner = 'blue' where id = $1", [f.savedAs]);
    expect(await save(m, true)).toBe(f.savedAs);
    expect(await one("select winner, end_reason from public.matches where id = $1", [f.savedAs])).toEqual({ winner: "blue", end_reason: "ff" });
    await as(ADMIN, "delete from public.matches where id = $1", [f.savedAs]);
    expect(await save(m, true)).toBeNull();
  });

  it("5v5, uneven and solo games with guests and bots", async () => {
    await db.exec("delete from public.live_feed; delete from public.live_state");
    const five = await play(new Sim({ blue: rid("Tosh", "Samu", "Lenny", "Guest1", "Guest2"), red: rid("Artur", "Philip", "Nick", "Guest3", "Guest4"), seed: 12 }), "nexus");
    expect(await one("select mode, jsonb_array_length(guests) as n from public.matches where id = $1", [five.shown.savedAs])).toEqual({ mode: 5, n: 4 });
    expect((await one<{ g: string }>("select guests::text as g from public.matches where id = $1", [five.shown.savedAs]))!.g).not.toMatch(/Guest\d|#/);
    const uneven = await play(new Sim({ blue: rid("Tosh", "Samu", "Lenny"), red: rid("Artur", "Philip"), seed: 13 }), "nexus");
    const n = await db.query("select team, count(*)::int as n from public.match_participants where match_id = $1 group by team order by team", [uneven.shown.savedAs]);
    expect(n.rows).toEqual([{ team: "blue", n: 3 }, { team: "red", n: 2 }]);
    const solo = await play(new Sim({ blue: rid("Tosh"), red: [], redBots: 1, seed: 14 }), "nexus");
    expect(await one("select mode, winner from public.matches where id = $1", [solo.shown.savedAs])).toEqual({ mode: 1, winner: "blue" });
  });

  it("a game without a winner waits for a member, and saves their choice", async () => {
    const g = await play(new Sim({ blue: rid("Tosh"), red: rid("Nick"), seed: 15 }), "none");
    expect(g.shown).toMatchObject({ status: "ended" });
    expect(g.shown.savedAs).toBeUndefined();
    const d = decide(g.shown, g.shown.id, "red", true)!;
    const id = await save(d.save!.match, d.save!.known);
    expect(await one("select winner, end_reason from public.matches where id = $1", [id])).toEqual({ winner: "red", end_reason: "unknown" });
    expect(decide({ ...g.shown, choice: "red" }, g.shown.id, "blue", true)).toBeNull();
  });

  it("two updates at once: only the first one counts", async () => {
    const { version, raw, shown } = await load();
    expect(await put(version, raw, shown)).toBe(true);
    expect(await put(version, raw, null)).toBe(false);
    expect((await load()).shown).toEqual(shown);
    expect(await put(version + 1, null, null)).toBe(true);
    expect((await load()).shown).toBeNull();
  });

  it("replaces a result the old helper is still waiting with", async () => {
    await db.query("insert into public.pending_results (game_id, payload) values ('777', '{}')");
    await save({ id: "x", gameId: "777", playedAt: T0, mode: 1, blue: [P(0)], red: [P(1)], winner: "blue", stats: {}, dodges: [], sitOut: [] }, false);
    expect(await db.query("select 1 from public.pending_results").then((r) => r.rows.length)).toBe(0);
  });
});

describe("after the release: private", () => {
  beforeAll(async () => {
    await db.query("insert into public.test_games (game_id, data) values ('1', '{}')");
    await db.query("insert into public.helper_tokens (name, token_hash, created_by) values ('old', 'x', null), ('mine', 'y', $1)", [MEMBER]);
    await db.exec(readFileSync(`supabase/migrations/${PRIVATE}`, "utf8"));
  }, 60_000);

  const TABLES = ["players", "player_riot_ids", "matches", "match_participants", "dodge_log", "live_game", "live_feed", "settings", "test_games", "pending_results", "members", "helper_tokens"];
  const COLS: Record<string, string> = { helper_tokens: "id" };

  it("visitors, waiting and blocked people see no data at all", async () => {
    await db.query("insert into public.live_game (id, data) values ($1, '{}')", [U(8)]);
    await db.query("insert into public.live_feed (data) values ('{}') on conflict do nothing");
    for (const t of TABLES) await refused(as("anon", `select ${COLS[t] ?? "*"} from public.${t}`));
    await db.query("update public.members set role = 'blocked' where user_id = $1", [GHOST]);
    for (const who of [PENDING, GHOST])
      for (const t of TABLES) {
        const rows = await as<{ user_id?: string }>(who, `select ${COLS[t] ?? "*"} from public.${t}`);
        expect(rows.filter((r) => r.user_id !== who), `${t}`).toEqual([]);
      }
    for (const who of ["anon", PENDING, GHOST])
      for (const fn of ["set_live('{}')", "save_live_result(gen_random_uuid(), 'blue')", "create_helper_token('x')", "restore_backup('{}')", "confirm_pending_result(gen_random_uuid())"])
        await refused(as(who, `select public.${fn}`));
    await db.exec("delete from public.live_game; delete from public.live_feed");
  });

  it("members read everything they need", async () => {
    for (const t of ["players", "player_riot_ids", "matches", "match_participants", "settings"]) expect((await as(MEMBER, `select * from public.${t}`)).length).toBeGreaterThan(0);
  });

  it("only admins swap winners and delete games", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from public.matches");
    await as(MEMBER, "update public.matches set winner = 'blue'");
    await as(MEMBER, "delete from public.matches");
    expect(await one("select count(*)::int as n from public.matches")).toEqual(before);
    expect((await one<{ winner: string }>("select winner from public.matches where id = $1", [U(9)]))!.winner).toBe("red");
    await as(ADMIN, "update public.matches set winner = 'blue' where id = $1", [U(9)]);
    expect((await one<{ winner: string }>("select winner from public.matches where id = $1", [U(9)]))!.winner).toBe("blue");
  });

  it("blocked people stay blocked, nobody deletes rows or changes their own role, one admin stays", async () => {
    expect(await as(GHOST, "select public.ensure_member() as r")).toEqual([{ r: "blocked" }]);
    await refused(as(ADMIN, "delete from public.members where user_id = $1", [GHOST]));
    await as(GHOST, "update public.members set role = 'admin' where user_id = $1", [GHOST]);
    await as(PENDING, "update public.members set role = 'member' where user_id = $1", [PENDING]);
    expect((await db.query("select role from public.members where user_id in ($1, $2) order by role", [GHOST, PENDING])).rows).toEqual([{ role: "blocked" }, { role: "pending" }]);
    await expect(as(ADMIN, "update public.members set role = 'member' where user_id = $1", [ADMIN])).rejects.toThrow("own role");
    await as(ADMIN, "update public.members set role = 'member' where user_id = $1", [ADMIN2]);
    await expect(db.query("update public.members set role = 'member' where user_id = $1", [ADMIN])).rejects.toThrow("at least one admin");
    await as(ADMIN, "update public.members set role = 'pending' where user_id = $1", [GHOST]);
  });

  it("generated teams need a known shape and known players", async () => {
    const draft = { id: U(7), phase: "draft", size: 5, blue: [0, 1, 2].map(P), red: [3, 4].map(P), sitOut: [P(5)], style: "random", stats: {}, dodgeLog: [], createdAt: 1 };
    const set = (d: unknown) => as(MEMBER, "select public.set_live($1)", [JSON.stringify(d)]);
    await set(draft);
    expect(await as(MEMBER, "select 1 from public.live_game")).toHaveLength(1);
    await expect(set({ ...draft, extra: 1 })).rejects.toThrow("not a live game");
    await expect(set({ ...draft, phase: "hacked" })).rejects.toThrow("not a live game");
    await expect(set({ ...draft, blue: [U(1)] })).rejects.toThrow("Unknown player");
    await expect(set({ ...draft, blue: [0, 1, 2, 3, 4, 5].map(P) })).rejects.toThrow("At most 5");
    await as(MEMBER, "select public.set_live(null)");
    expect(await as(MEMBER, "select 1 from public.live_game")).toHaveLength(0);
  });

  it("test games are gone, saving is on, ownerless tokens are gone", async () => {
    expect(await one("select save_live_games, review_helper_results from public.settings")).toEqual({ save_live_games: true, review_helper_results: false });
    expect((await db.query("select 1 from public.test_games")).rows).toEqual([]);
    expect((await db.query("select name from public.helper_tokens")).rows).toEqual([{ name: "mine" }]);
    await db.query("delete from auth.users where id = $1", [MEMBER]);
    expect((await db.query("select name from public.helper_tokens")).rows).toEqual([]);
  });

  it("undo.sql brings back what the old site needs, and can run twice", async () => {
    const undo = readFileSync("supabase/release/undo.sql", "utf8");
    await db.exec(undo);
    await db.exec(undo);
    for (const t of ["players", "matches", "match_participants", "settings"]) expect((await as("anon", `select * from public.${t}`)).length).toBeGreaterThan(0);
    for (const t of ["live_feed", "live_state", "test_games", "members", "helper_tokens", "player_riot_ids"]) await refused(as("anon", `select ${COLS[t] ?? "*"} from public.${t}`));
    await as(ADMIN2, "update public.matches set winner = 'red' where id = $1", [U(9)]);
    expect((await one<{ winner: string }>("select winner from public.matches where id = $1", [U(9)]))!.winner).toBe("red");
    await as(PENDING, "delete from public.matches");
    await as(PENDING, "update public.matches set winner = 'blue'");
    expect((await one<{ winner: string }>("select winner from public.matches where id = $1", [U(9)]))!.winner).toBe("red");
    await as(ADMIN, "delete from public.members where user_id = $1", [PENDING]);
    expect((await db.query("select 1 from public.members where user_id = $1", [PENDING])).rows).toEqual([]);
  });

  it("a backup brings everything back, with links, guests and 5v5", async () => {
    await db.query("update public.members set player_id = $1 where user_id = $2", [P(2), ADMIN]);
    const backup = {
      app: "bridge-night",
      players: PLAYERS,
      settings: {},
      matches: [{ id: U(6), gameId: "5", playedAt: T0, mode: 5, blue: [P(0)], red: [P(1)], winner: "blue", stats: { [P(0)]: { champion: "Yone", kills: 1, level: 18, spells: [4, 32], augments: [7], items: [3031] } }, dodges: [], sitOut: [], end: "left", surrender: "ff", durationSec: 900, durationMin: 15, guests: [{ key: "s1", side: "red", bot: true, items: [], spells: [] }], gameMode: "ARAM: Mayhem", map: "Howling Abyss" }],
    };
    await as(ADMIN, "select public.restore_backup($1)", [JSON.stringify(backup)]);
    expect(await one("select mode, end_reason, surrender, duration_sec, game_mode, map, jsonb_array_length(guests) as guests from public.matches")).toEqual({ mode: 5, end_reason: "left", surrender: "ff", duration_sec: 900, game_mode: "ARAM: Mayhem", map: "Howling Abyss", guests: 1 });
    expect(await one("select level, spells, augments from public.match_participants where player_id = $1", [P(0)])).toEqual({ level: 18, spells: [4, 32], augments: [7] });
    expect((await one<{ player_id: string }>("select player_id from public.members where user_id = $1", [ADMIN]))!.player_id).toBe(P(2));
  });
});
