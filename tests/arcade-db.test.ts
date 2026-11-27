/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

/* The Arcade scores (20261126120000_minigame_scores.sql) in a small Postgres, after the private release.
   Supabase's own parts (roles, auth) are stand-ins, the same as in db.test.ts. */

const SUPABASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema extensions; create schema auth;
  grant usage on schema extensions, auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
  create function auth.claims() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.claims() ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select auth.claims() ->> 'role' $$;
  create publication supabase_realtime;
  -- Realtime's message table and topic, so the channel policies run here too (Supabase has RLS on it).
  create schema realtime; grant usage on schema realtime to authenticated;
  create table realtime.messages (id bigserial primary key, topic text not null default '', extension text not null, payload jsonb);
  alter table realtime.messages enable row level security;
  grant select, insert on realtime.messages to authenticated; grant usage on sequence realtime.messages_id_seq to authenticated;
  create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const U = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const P = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const [ADMIN, MEMBER, PENDING, BLOCKED, UNLINKED] = [1, 2, 3, 4, 5].map(U);

let db: PGlite;
const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows[0];

async function as<T = Record<string, unknown>>(who: string, sql: string, args: unknown[] = []): Promise<T[]> {
  const role = who === "anon" ? "anon" : "authenticated";
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
const refused = (p: Promise<unknown>) => expect(p).rejects.toThrow(/permission denied|row-level security|members only/i);
const post = (who: string, game: string, score: number) =>
  as(who, "insert into public.minigame_scores (game_id, score) values ($1, $2)", [game, score]);
/** The 10-second limit: pretend the last rounds were a while ago. */
const later = () => db.exec("update public.minigame_scores set created_at = created_at - interval '1 minute'");

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE);
  for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const [id, name] of [[ADMIN, "Admin"], [MEMBER, "Member"], [PENDING, "New"], [BLOCKED, "Out"], [UNLINKED, "Free"]])
    await db.query("insert into auth.users (id, raw_user_meta_data) values ($1, $2)", [id, JSON.stringify({ full_name: name })]);
  await db.query("update public.members set role = 'admin' where user_id = $1", [ADMIN]);
  await db.query("update public.members set role = 'member' where user_id in ($1, $2)", [MEMBER, UNLINKED]);
  await db.query("update public.members set role = 'blocked' where user_id = $1", [BLOCKED]);
  for (const [i, n] of ["Tosh", "Samu", "Lenny", "Artur"].entries()) await db.query("insert into public.players (id, name) values ($1, $2)", [P(i), n]);
  for (const [u, i] of [[ADMIN, 0], [MEMBER, 1], [PENDING, 2], [BLOCKED, 3]] as const)
    await db.query("update public.members set player_id = $2 where user_id = $1", [u, P(i)]);
}, 60_000);

describe("arcade scores", () => {
  it("a member saves a score for their own player, whatever player they claim", async () => {
    await post(MEMBER, "champ-pixel", 1200);
    await later();
    await as(MEMBER, "insert into public.minigame_scores (game_id, score) values ('champ-pixel', 1500)");
    const rows = await db.query<{ player_id: string; score: number }>("select player_id, score from public.minigame_scores order by score");
    expect(rows.rows).toEqual([{ player_id: P(1), score: 1200 }, { player_id: P(1), score: 1500 }]);
    // Naming someone else's player, an id or a time: not even allowed to try.
    await refused(as(MEMBER, "insert into public.minigame_scores (game_id, score, player_id) values ('champ-pixel', 10, $1)", [P(0)]));
    await refused(as(MEMBER, "insert into public.minigame_scores (game_id, score, created_at) values ('champ-pixel', 10, now() - interval '1 day')"));
  });

  it("unknown games, negative and impossible scores are refused", async () => {
    await later();
    await expect(post(MEMBER, "nope", 10)).rejects.toThrow(/Unknown game/);
    await expect(post(MEMBER, "champ-colours", -1)).rejects.toThrow(/not possible/);
    await expect(post(MEMBER, "champ-colours", 5001)).rejects.toThrow(/not possible/);
    await expect(post(MEMBER, "champ-colours", 999999)).rejects.toThrow(/not possible/);
    await post(MEMBER, "champ-colours", 5000);
  });

  it("one score per player and game every 10 seconds", async () => {
    await later();
    await post(MEMBER, "champ-mixed", 100);
    await expect(post(MEMBER, "champ-mixed", 200)).rejects.toThrow(/Too fast/);
    await post(MEMBER, "champ-pixel", 300); // another game is fine
    await post(ADMIN, "champ-mixed", 400); // and another player
  });

  it("visitors, waiting, blocked and unlinked people can't save, and only members read", async () => {
    await later();
    for (const who of ["anon", PENDING, BLOCKED]) await refused(post(who, "champ-pixel", 10));
    await expect(post(UNLINKED, "champ-pixel", 10)).rejects.toThrow(/not linked to a player/);
    await refused(as("anon", "select * from public.minigame_scores"));
    await refused(as("anon", "select * from public.minigame_best"));
    await refused(as("anon", "select * from public.minigame_games"));
    for (const who of [PENDING, BLOCKED]) {
      expect(await as(who, "select * from public.minigame_scores")).toEqual([]);
      expect(await as(who, "select * from public.minigame_best")).toEqual([]);
    }
    expect((await as(UNLINKED, "select * from public.minigame_scores")).length).toBeGreaterThan(0);
  });

  it("nobody changes scores; only admins delete them", async () => {
    const before = await one<{ n: number }>("select count(*)::int as n from public.minigame_scores");
    await refused(as(MEMBER, "update public.minigame_scores set score = 5000"));
    await refused(as(ADMIN, "update public.minigame_scores set score = 5000"));
    await as(MEMBER, "delete from public.minigame_scores");
    expect(await one("select count(*)::int as n from public.minigame_scores")).toEqual(before);
    await refused(as(MEMBER, "insert into public.minigame_games values ('cheat', 999999, false)"));
    await as(ADMIN, "delete from public.minigame_scores where score = 400");
    expect((await one<{ n: number }>("select count(*)::int as n from public.minigame_scores"))!.n).toBe(before!.n - 1);
  });

  it("the leaderboard view: each player's best per game", async () => {
    await later();
    await post(ADMIN, "champ-pixel", 1500);
    const best = await as<{ player_id: string; score: number }>(
      MEMBER,
      "select player_id, score from public.minigame_best where game_id = 'champ-pixel' order by score desc, created_at",
    );
    expect(best).toEqual([{ player_id: P(1), score: 1500 }, { player_id: P(0), score: 1500 }]);
  });
});

/* ---------- 20261127100000_arcade_rooms_trivia.sql ---------- */

const addQ = (who: string, id: string, extra = "") =>
  as(
    who,
    `insert into public.trivia_questions (id, category, topic, difficulty, question, answer${extra ? ", choices" : ""})
     values ($1, 'general', 'test', 1, 'What is 2 + 2?', '4'${extra ? `, ${extra}` : ""})`,
    [id],
  );

describe("trivia leaderboard", () => {
  it("trivia-solo takes scores up to 10000", async () => {
    await later();
    await post(MEMBER, "trivia-solo", 10000);
    await later();
    await expect(post(MEMBER, "trivia-solo", 10001)).rejects.toThrow(/not possible/);
    expect(await one("select max_score, lower_is_better from public.minigame_games where game_id = 'trivia-solo'")).toEqual({
      max_score: 10000,
      lower_is_better: false,
    });
  });
});

describe("trivia questions and settings", () => {
  it("admins add, change and delete questions; who and when come from the database", async () => {
    await addQ(ADMIN, "custom-a1");
    // Who and when can't be set by hand (not in the column grants).
    await refused(as(ADMIN, "update public.trivia_questions set created_at = now() - interval '9 days' where id = 'custom-a1'"));
    await refused(as(ADMIN, "update public.trivia_questions set created_by = $1 where id = 'custom-a1'", [MEMBER]));
    await as(ADMIN, "update public.trivia_questions set answer = 'four' where id = 'custom-a1'");
    expect(await one("select answer, created_by from public.trivia_questions where id = 'custom-a1'")).toEqual({ answer: "four", created_by: ADMIN });
    await addQ(ADMIN, "custom-a2");
    await as(ADMIN, "delete from public.trivia_questions where id = 'custom-a2'");
    expect(await one("select count(*)::int as n from public.trivia_questions")).toEqual({ n: 1 });
  });

  it("members (admins too) read; non-admin members can't write", async () => {
    for (const who of [MEMBER, UNLINKED, ADMIN]) expect((await as(who, "select id from public.trivia_questions")).length).toBe(1);
    await refused(addQ(MEMBER, "custom-m1"));
    await as(MEMBER, "update public.trivia_questions set answer = 'five'");
    await as(MEMBER, "delete from public.trivia_questions");
    expect(await one("select answer from public.trivia_questions where id = 'custom-a1'")).toEqual({ answer: "four" });
    expect(await as(MEMBER, "select disabled, notes from public.trivia_settings")).toEqual([{ disabled: [], notes: "" }]);
    await as(MEMBER, "update public.trivia_settings set notes = 'hacked'");
    await refused(as(MEMBER, "insert into public.trivia_settings (id) values (1)"));
    expect(await one("select notes from public.trivia_settings")).toEqual({ notes: "" });
  });

  it("visitors, waiting and blocked people get nothing", async () => {
    await refused(as("anon", "select * from public.trivia_questions"));
    await refused(as("anon", "select * from public.trivia_settings"));
    await refused(addQ("anon", "custom-x"));
    for (const who of [PENDING, BLOCKED]) {
      expect(await as(who, "select id, question, answer from public.trivia_questions")).toEqual([]);
      expect(await as(who, "select disabled, notes from public.trivia_settings")).toEqual([]);
      await refused(addQ(who, "custom-x"));
    }
  });

  it("nobody on the site sees who wrote trivia (admins' login ids); the backup does", async () => {
    for (const who of [MEMBER, ADMIN]) {
      await refused(as(who, "select created_by from public.trivia_questions"));
      await refused(as(who, "select updated_by from public.trivia_settings"));
      await refused(as(who, "select * from public.trivia_questions"));
      await refused(as(who, "select * from public.trivia_settings"));
      // What the site asks for still works.
      expect((await as(who, "select id, category, topic, difficulty, question, answer, accept, choices, fact from public.trivia_questions order by created_at")).length).toBe(1);
      expect(await as(who, "select disabled, notes from public.trivia_settings where id = 1")).toHaveLength(1);
    }
    await db.exec("set role service_role");
    try {
      expect((await db.query("select created_by from public.trivia_questions")).rows).toEqual([{ created_by: ADMIN }]);
    } finally {
      await db.exec("reset role");
    }
  });

  it("admins change the settings; only known categories and short notes", async () => {
    await as(ADMIN, "update public.trivia_settings set disabled = '{music,sport}', notes = 'More 2000s music'");
    expect(await one("select disabled, notes, updated_by from public.trivia_settings")).toEqual({
      disabled: ["music", "sport"],
      notes: "More 2000s music",
      updated_by: ADMIN,
    });
    await expect(as(ADMIN, "update public.trivia_settings set disabled = '{nope}'")).rejects.toThrow(/check constraint/);
    await expect(as(ADMIN, "update public.trivia_settings set notes = repeat('x', 4001)")).rejects.toThrow(/check constraint/);
    await refused(as(ADMIN, "delete from public.trivia_settings"));
    await expect(as(ADMIN, "insert into public.trivia_settings (id) values (2)")).rejects.toThrow();
  });

  it("the database checks questions: category, length, difficulty, id, 4 choices with the answer", async () => {
    const bad = (sql: string) => expect(as(ADMIN, sql)).rejects.toThrow(/check constraint|violates/);
    const q = (cols: string, vals: string) =>
      `insert into public.trivia_questions (id, category, topic, difficulty, question, answer${cols}) values ${vals}`;
    await bad(q("", "('custom-b1', 'cooking', '', 1, 'Q?', 'A')"));
    await bad(q("", "('custom-b2', 'general', '', 4, 'Q?', 'A')"));
    await bad(q("", `('custom-b3', 'general', '', 1, '${"x".repeat(201)}', 'A')`));
    await bad(q("", "('custom-b4', 'general', '', 1, '   ', 'A')"));
    await bad(q("", "('league-0001', 'general', '', 1, 'Q?', 'A')"));
    await bad(q(", choices", "('custom-b5', 'general', '', 1, 'Q?', 'A', '{B,C,D}')"));
    await bad(q(", choices", "('custom-b6', 'general', '', 1, 'Q?', 'A', '{B,C,D,E}')"));
    await addQ(ADMIN, "custom-b7", "'{1,2,3,4}'"); // the answer '4' is one of them
    expect(await one("select choices from public.trivia_questions where id = 'custom-b7'")).toEqual({ choices: ["1", "2", "3", "4"] });
    await bad(q(", accept", `('custom-b8', 'general', '', 1, 'Q?', 'A', '{${Array(11).fill("x").join(",")}}')`));
  });

  it("the backup can read the new tables", async () => {
    await db.exec("set role service_role");
    try {
      expect((await db.query("select * from public.trivia_questions")).rows.length).toBeGreaterThan(0);
      expect((await db.query("select * from public.trivia_settings")).rows.length).toBe(1);
    } finally {
      await db.exec("reset role");
    }
  });
});

describe("realtime channels (who may join which topic)", () => {
  /** Can `who` read / write messages of this kind on this topic? Realtime asks exactly this when someone joins. */
  async function can(who: string, topic: string, extension: "broadcast" | "presence") {
    await db.query("select set_config('realtime.topic', $1, false)", [topic]);
    try {
      const read = (await as(who, "select 1 from realtime.messages where extension = $1 limit 1", [extension])).length > 0;
      const write = await as(who, "insert into realtime.messages (topic, extension) values ($1, $2)", [topic, extension]).then(
        () => true,
        () => false,
      );
      return { read, write };
    } finally {
      await db.query("select set_config('realtime.topic', '', false)");
    }
  }
  beforeAll(async () => {
    for (const t of ["bn-room:KQZD", "bn-room:KILO", "bn-arcade", "bn-arcade-rooms", "other"])
      for (const e of ["broadcast", "presence"]) await db.query("insert into realtime.messages (topic, extension) values ($1, $2)", [t, e]);
  });

  it("members read and write rooms (broadcast and presence) and the open-rooms list", async () => {
    for (const who of [MEMBER, ADMIN]) {
      expect(await can(who, "bn-room:KQZD", "broadcast")).toEqual({ read: true, write: true });
      expect(await can(who, "bn-room:KQZD", "presence")).toEqual({ read: true, write: true });
      expect(await can(who, "bn-arcade-rooms", "presence")).toEqual({ read: true, write: true });
      expect(await can(who, "bn-arcade", "presence")).toEqual({ read: true, write: true }); // round 1, still there
    }
  });
  it("nobody else, and no other topics", async () => {
    for (const who of [PENDING, BLOCKED])
      for (const t of ["bn-room:KQZD", "bn-arcade-rooms", "bn-arcade"])
        for (const e of ["broadcast", "presence"] as const) expect(await can(who, t, e)).toEqual({ read: false, write: false });
    expect(await can(MEMBER, "bn-room:KILO", "broadcast")).toEqual({ read: false, write: false }); // not a room code
    expect(await can(MEMBER, "bn-arcade-rooms", "broadcast")).toEqual({ read: false, write: false });
    expect(await can(MEMBER, "other", "presence")).toEqual({ read: false, write: false });
  });
});
