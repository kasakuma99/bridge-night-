import { GONE, feedMatch, linkFeed, nextFeed, type Reading } from "./live";
import type { FeedEvent, FeedPlayer, LiveFeed, Match, Player, Side } from "./types";

/*
 * What the server does with one look at League from a helper. Pure, so the tests run the same code as the
 * "live" Edge Function (scripts/build-live.mjs bundles it into supabase/functions/live/core.js).
 */

/** Another helper's updates are ignored while the one in charge is still sending. */
export const TAKEOVER_MS = 20_000;
/** The clock and "last update" alone are only worth a write this often. Must stay below STALE_MS. */
export const HEARTBEAT_MS = 8_000;
const MAX_PLAYERS = 20;
const MAX_EVENTS = 80;

export interface ServerState {
  /** With Riot IDs: never leaves the server. */
  raw: LiveFeed | null;
  /** The helper in charge. */
  token: string | null;
  /** When it last sent something. */
  at: number;
  /** When what the site shows was last written. */
  shownAt?: number;
}

export interface Step {
  state: ServerState;
  /** undefined: nothing new to show. null: show nothing. */
  feed?: LiveFeed | null;
  /** Save this game (or add details to it). `known`: it was saved before. */
  save?: { match: Match; known: boolean };
  /** A champ select that went back to the lobby (a reroll). League doesn't say who left. */
  reroll?: Reroll;
  note: string;
}

export interface Reroll {
  liveId: string;
  /** Players per team, when the lobby had any. */
  size?: number;
  /** Players of the site who were in it. */
  players: string[];
}

/** The champ select of `was` ended without a game. Only counted when players of the site were in it. */
function rerollOf(was: LiveFeed, players: Player[]): Reroll | undefined {
  const linked = linkFeed(was, players).players;
  const ids = [...new Set(linked.flatMap((p) => (p.playerId ? [p.playerId] : [])))];
  if (!ids.length) return undefined;
  const per = (side: string) => linked.filter((p) => p.side === side).length;
  const size = Math.min(5, Math.max(per("blue"), per("red")));
  return { liveId: was.id, ...(size ? { size } : {}), players: ids };
}

const text = (v: string | undefined, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const cap = (v: number | undefined, max: number) => (v === undefined ? undefined : Math.max(0, Math.min(max, Math.round(v))));
const few = (v: number[] | undefined, n: number) => v?.filter((x) => Number.isInteger(x) && x > 0 && x < 1_000_000).slice(0, n);

const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Keeps what comes from a helper small and within what the database accepts. */
export function tidy(f: LiveFeed): LiveFeed {
  const players = f.players.slice(0, MAX_PLAYERS).map(
    (p): FeedPlayer =>
      drop({
        ...p,
        key: p.key.slice(0, 80),
        riotId: text(p.riotId, 60),
        champion: text(p.champion, 40),
        level: cap(p.level, 100),
        kills: cap(p.kills, 999),
        deaths: cap(p.deaths, 999),
        assists: cap(p.assists, 999),
        damage: cap(p.damage, 10_000_000),
        items: few(p.items, 10) ?? [],
        spells: few(p.spells, 2) ?? [],
        augments: few(p.augments, 6),
      }),
  );
  return drop({
    ...f,
    id: f.id.slice(0, 40),
    gameId: text(f.gameId, 40),
    mode: text(f.mode, 40),
    map: text(f.map, 40),
    players,
    events: f.events.slice(-MAX_EVENTS).map((e): FeedEvent => ({ ...e, ...(e.helpers ? { helpers: e.helpers.slice(0, 5) } : {}) })),
    ...(f.end ? { end: drop({ ...f.end, durationSec: cap(f.end.durationSec, 36_000) }) } : {}),
  });
}

/** Equal apart from the clock and the time of the update. */
function unchanged(a: LiveFeed, b: LiveFeed) {
  const look = (f: LiveFeed) => JSON.stringify({ ...f, clock: undefined, updatedAt: 0 });
  return look(a) === look(b);
}

/** The result of a finished game, for saving. */
function result(feed: LiveFeed, solo: boolean): Step["save"] {
  const match = feedMatch(feed, { solo });
  return match ? { match, known: !!feed.savedAs } : undefined;
}

export function step(o: {
  state: ServerState;
  /** What the site shows right now. */
  shown: LiveFeed | null;
  reading: Reading;
  token: string;
  players: Player[];
  solo: boolean;
  now: number;
}): Step {
  const { state, shown, token, now } = o;
  const other = !!state.token && state.token !== token && !!state.raw;
  if (other && state.raw!.status !== "ended" && now - state.at < TAKEOVER_MS) return { state, note: "another helper is in charge of the live game" };

  // The server's clock counts, not the PC's.
  const reading = { ...o.reading, at: now };
  // A helper that isn't in a game can't end the game of another one.
  if (other && !nextFeed(null, reading) && !sameGame(state.raw!, reading))
    return { state, note: "not in this game" };

  const next = nextFeed(state.raw, reading);
  const raw = next && tidy(next);
  const base: ServerState = { raw, token: raw ? token : null, at: now, shownAt: state.shownAt };

  if (!raw) {
    // A finished game stays on the Live page for a while after League has moved on.
    const gone = shown && shown.status !== "ended";
    const cancelled = !other && state.raw?.status === "select" && GONE.has(reading.phase) && reading.phase !== "ChampSelect";
    const reroll = cancelled ? rerollOf(state.raw!, o.players) : undefined;
    return { state: base, ...(gone ? { feed: null } : {}), ...(reroll ? { reroll } : {}), note: reroll ? "champ select cancelled" : "no custom game" };
  }

  const linked = linkFeed(raw, o.players);
  const prev = shown?.id === linked.id ? shown : null;
  const feed: LiveFeed = { ...linked, ...(prev?.choice ? { choice: prev.choice } : {}), ...(prev?.savedAs ? { savedAs: prev.savedAs } : {}) };
  const save = result(feed, o.solo);
  const quiet = !!prev && unchanged(prev, feed) && !(save && !feed.savedAs);
  if (quiet && (feed.status === "ended" || now - (state.shownAt ?? 0) < HEARTBEAT_MS)) return { state: base, note: feed.status };
  return { state: { ...base, shownAt: now }, feed, ...(save ? { save } : {}), note: feed.status };
}

/** Does this look belong to the game that is already running? */
function sameGame(f: LiveFeed, r: Reading) {
  const id = (x: unknown) => String((x as { gameId?: unknown } | undefined)?.gameId ?? "");
  const session = (r.session as { gameData?: unknown } | undefined)?.gameData;
  return !!f.gameId && [session, r.eog, r.history].some((x) => id(x) === f.gameId);
}

/** A member decides a game that League named no winner for. null: there is nothing to decide. */
export function decide(shown: LiveFeed | null, feedId: string, choice: Side | "skip", solo: boolean): Pick<Step, "feed" | "save"> | null {
  if (!shown || shown.id !== feedId || shown.status !== "ended" || shown.choice || shown.end?.winner) return null;
  const feed: LiveFeed = { ...shown, choice };
  const save = result(feed, solo);
  return { feed, ...(save ? { save } : {}) };
}
