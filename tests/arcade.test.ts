import { describe, expect, it } from "vitest";
import {
  bestPerPlayer,
  checkScore,
  checkTriviaQuestion,
  checkTriviaSettings,
  compareScores,
  dedupeOnline,
  LOBBY_GONE_MS,
  lobbyFromFeed,
  readTriviaQuestion,
  type RawScore,
} from "../src/lib/arcade";
import { scoreError, triviaError } from "../src/data/arcadeStore";
import type { FeedPlayer, LiveFeed } from "../src/lib/types";

const r = (playerId: string, score: number, at: number): RawScore => ({ playerId, score, at });

describe("arcade leaderboards", () => {
  const rows = [r("a", 100, 1), r("b", 300, 2), r("a", 400, 3), r("c", 300, 1), r("a", 50, 4), r("b", 250, 5)];

  it("keeps each player's best round, best first, earlier wins a tie", () => {
    expect(bestPerPlayer(rows)).toEqual([r("a", 400, 3), r("c", 300, 1), r("b", 300, 2)]);
  });
  it("sorts times the other way round", () => {
    expect(bestPerPlayer(rows, true)).toEqual([r("a", 50, 4), r("b", 250, 5), r("c", 300, 1)]);
  });
  it("cuts the list, and skips broken rows", () => {
    expect(bestPerPlayer(rows, false, 2).map((x) => x.playerId)).toEqual(["a", "c"]);
    expect(bestPerPlayer(rows, false, 0)).toEqual([]);
    expect(bestPerPlayer([r("", 5, 1), r("a", NaN, 1), r("b", 1, 1)])).toEqual([r("b", 1, 1)]);
  });
  it("the same best score twice: the first time counts", () => {
    expect(bestPerPlayer([r("a", 10, 5), r("a", 10, 2)])).toEqual([r("a", 10, 2)]);
    expect([r("x", 1, 2), r("y", 1, 1)].sort(compareScores())[0].playerId).toBe("y");
  });
});

describe("arcade score checks", () => {
  it("accepts 0 up to the game's maximum, rounded", () => {
    expect(checkScore(0, 5000)).toBe(0);
    expect(checkScore(5000, 5000)).toBe(5000);
    expect(checkScore(1234.4, 5000)).toBe(1234);
    expect(checkScore(99_999, undefined)).toBe(99_999);
  });
  it("refuses negative, too high and broken scores", () => {
    expect(() => checkScore(-1, 5000)).toThrow(/not possible/);
    expect(() => checkScore(5001, 5000)).toThrow(/not possible/);
    expect(() => checkScore(999_999, 5000)).toThrow(/not possible/);
    expect(() => checkScore(NaN, 5000)).toThrow(/can't be saved/);
    expect(() => checkScore(Infinity, 5000)).toThrow(/can't be saved/);
  });
  it("turns database errors into readable messages", () => {
    expect(scoreError({ code: "42501", message: "new row violates row-level security policy" }).message).toMatch(/approved members/);
    expect(scoreError({ code: "P0001", message: "Too fast: wait a few seconds before saving another score" }).message).toBe(
      "Too fast: wait a few seconds before saving another score.",
    );
    expect(scoreError({ code: "P0001", message: "Unknown game" }).message).toBe("Unknown game.");
    expect(scoreError({ code: "08006", message: "connection lost" }).message).toMatch(/try again/);
    expect(scoreError(null).message).toMatch(/try again/);
  });
});

describe("arcade waiting room", () => {
  it("one entry per person, sorted by name, no strange avatars", () => {
    const list = dedupeOnline([
      { id: "p1", name: "Samu", avatar: "https://cdn.discordapp.com/a.png", presence_ref: "1" },
      { id: "p1", name: "Samu", avatar: null, presence_ref: "2" },
      { id: "u2", name: "Artur", avatar: "https://evil.example/x.png" },
      { id: "", name: "Nobody" },
      { id: "p3" },
      null,
      "junk",
      { id: "p4", name: "  " + "L".repeat(80) },
    ]);
    expect(list).toEqual([
      { id: "u2", name: "Artur", avatar: null },
      { id: "p4", name: "L".repeat(40), avatar: null },
      { id: "p1", name: "Samu", avatar: "https://cdn.discordapp.com/a.png" },
    ]);
  });
});

describe("arcade lobby from the live feed", () => {
  const NOW = 1_800_000_000_000;
  const fp = (n: number): FeedPlayer[] => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, side: i % 2 ? "red" : "blue", items: [], spells: [] }));
  const feed = (status: LiveFeed["status"], n: number, extra: Partial<LiveFeed> = {}): LiveFeed => ({
    id: "f1",
    status,
    players: fp(n),
    events: [],
    startedAt: NOW - 60_000,
    updatedAt: NOW - 5_000,
    ...extra,
  });

  it("no feed, no lobby", () => {
    expect(lobbyFromFeed(null, NOW)).toBeNull();
    expect(lobbyFromFeed(undefined, NOW)).toBeNull();
  });
  it("champ select, loading and the game itself", () => {
    expect(lobbyFromFeed(feed("select", 0), NOW)).toEqual({ inLobby: 0, of: 10, phase: "Waiting for players" });
    expect(lobbyFromFeed(feed("select", 6), NOW)).toEqual({ inLobby: 6, of: 10, phase: "Champ select" });
    expect(lobbyFromFeed(feed("loading", 10), NOW)).toEqual({ inLobby: 10, of: 10, phase: "Loading in" });
    expect(lobbyFromFeed(feed("playing", 8), NOW)).toEqual({ inLobby: 8, of: 10, phase: "In game" });
    expect(lobbyFromFeed(feed("select", 12), NOW)?.of).toBe(12);
  });
  it("a finished, skipped or abandoned game is no lobby", () => {
    expect(lobbyFromFeed(feed("ended", 10, { end: { at: NOW - 1000, winner: "blue" } }), NOW)).toBeNull();
    expect(lobbyFromFeed(feed("select", 4, { choice: "skip" }), NOW)).toBeNull();
    expect(lobbyFromFeed(feed("select", 4, { updatedAt: NOW - LOBBY_GONE_MS - 1 }), NOW)).toBeNull();
    expect(lobbyFromFeed(feed("select", 4, { updatedAt: NOW - LOBBY_GONE_MS + 1000 }), NOW)?.inLobby).toBe(4);
  });
});

describe("trivia that admins edit", () => {
  const q = { category: "general" as const, topic: " maths ", difficulty: 1 as const, question: " What is 2 + 2? ", answer: "4" };

  it("tidies a question and leaves out empty extras", () => {
    expect(checkTriviaQuestion({ ...q, accept: [" four ", "", "4", "four"], choices: ["", "", "", ""] as never, fact: " " })).toEqual({
      category: "general",
      topic: "maths",
      difficulty: 1,
      question: "What is 2 + 2?",
      answer: "4",
      accept: ["four"],
    });
    expect(checkTriviaQuestion({ ...q, choices: ["1", "2", "3", "4"] }).choices).toEqual(["1", "2", "3", "4"]);
  });
  it("explains what is wrong, with the same rules as the database", () => {
    expect(() => checkTriviaQuestion({ ...q, category: "cooking" as never })).toThrow(/category/);
    expect(() => checkTriviaQuestion({ ...q, question: "x".repeat(201) })).toThrow(/200 characters/);
    expect(() => checkTriviaQuestion({ ...q, answer: " " })).toThrow(/answer/);
    expect(() => checkTriviaQuestion({ ...q, difficulty: 4 as never })).toThrow(/difficulty/);
    expect(() => checkTriviaQuestion({ ...q, choices: ["1", "2", "3"] as never })).toThrow(/exactly 4/);
    expect(() => checkTriviaQuestion({ ...q, choices: ["1", "2", "3", "5"] })).toThrow(/has to be the answer/);
    expect(() => checkTriviaQuestion({ ...q, choices: ["4", "2", "2", "3"] })).toThrow(/different/);
    expect(() => checkTriviaQuestion({ ...q, accept: Array.from({ length: 11 }, (_, i) => `a${i}`) })).toThrow(/At most 10/);
    expect(() => checkTriviaQuestion({ ...q, fact: "x".repeat(301) })).toThrow(/300/);
  });
  it("settings: known categories only, in order; notes up to 4000 characters", () => {
    expect(checkTriviaSettings({ disabled: ["sport", "nope" as never, "music", "sport"], notes: "x" })).toEqual({ disabled: ["music", "sport"], notes: "x" });
    expect(() => checkTriviaSettings({ disabled: [], notes: "x".repeat(4001) })).toThrow(/4000/);
  });
  it("stored questions that don't fit any more are skipped", () => {
    expect(readTriviaQuestion({ id: "custom-1", ...q, accept: [], choices: null, fact: null })).toMatchObject({ id: "custom-1", answer: "4" });
    expect(readTriviaQuestion({ id: "league-0001", ...q })).toBeNull();
    expect(readTriviaQuestion({ id: "custom-2", ...q, category: "x" })).toBeNull();
    expect(readTriviaQuestion(null)).toBeNull();
  });
  it("turns database errors into readable messages", () => {
    expect(triviaError({ code: "42501", message: "new row violates row-level security policy" }).message).toBe("Only admins can change trivia.");
    expect(triviaError({ code: "23514", message: "check" }).message).toMatch(/rules/);
    expect(triviaError(null).message).toMatch(/try again/);
  });
});
