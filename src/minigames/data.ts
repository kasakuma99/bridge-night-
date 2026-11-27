import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { SAMPLE_MODE, useAuth, useData } from "../data/context";
import { fetchBest, fetchMyPlayerId, insertScore } from "../data/arcadeStore";
import { localScores } from "../data/store";
import { bestPerPlayer, checkScore, dedupeOnline, lobbyFromFeed, type RawScore } from "../lib/arcade";
import { supabase } from "../lib/supabase";
import type { Player } from "../lib/types";
import { findBoard } from "./registry";
import type { LobbyState, OnlineUser, ScoreRow } from "./types";

/**
 * Data hooks for the Arcade.
 * - With Supabase: presence on the private Realtime channel "bn-arcade", scores in public.minigame_scores
 *   (supabase/migrations/20261126120000_minigame_scores.sql). The database checks every score.
 * - Without (local dev, `npm run dev:sample`): you plus a few sample people online, scores in localStorage.
 */

/** null = local mode. Same choice as the data store in src/data/context.tsx. */
const sb = supabase && !SAMPLE_MODE ? supabase : null;

/* ---------- "scores changed": after submitScore, and when another tab saves one locally ---------- */

let version = 0;
const listeners = new Set<() => void>();
function scoresChanged() {
  version++;
  listeners.forEach((f) => f());
}
const onScores = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const scoresVersion = () => version;
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === localScores.key && scoresChanged());

/* ---------- who you are ---------- */

/** The player linked to your login (Supabase only; an admin links them on the Players page). */
function useMyPlayerId(): string | null {
  const { user, isMember } = useAuth();
  const uid = user?.id;
  const [got, setGot] = useState<{ uid: string; pid: string | null } | null>(null);
  useEffect(() => {
    if (!sb || !uid || !isMember) return;
    let live = true;
    void fetchMyPlayerId(sb, uid).then((pid) => live && setGot({ uid, pid }));
    return () => {
      live = false;
    };
  }, [uid, isMember]);
  return sb && uid && got?.uid === uid ? got.pid : null;
}

/** Local mode: who is logged in, the same way SampleAuth in src/data/context.tsx decides it. */
function localUser(): { id: string; name: string } | null {
  try {
    if (localStorage.getItem("bn-role") === "visitor") return null;
  } catch {
    /* no storage: SampleAuth's default is logged in */
  }
  return { id: "local", name: "Preview" };
}

/* ---------- people on the Arcade page ---------- */

/** The last leave of "bn-arcade"; a new join waits for it. */
let leaving: Promise<void> = Promise.resolve();

/**
 * You as others see you on the Arcade page and in Versus rooms: your player (name from the players list) when your
 * login is linked to one, otherwise your Discord name. null = not an approved member (or not logged in).
 * The object only changes when one of the values does.
 */
export function useArcadeMe(): OnlineUser | null {
  const { user, isMember } = useAuth();
  const { player } = useData();
  const pid = useMyPlayerId();
  const meKey =
    user && isMember ? JSON.stringify({ id: pid ?? user.id, name: (pid && player(pid)?.name) || user.name, avatar: user.avatar ?? null }) : null;
  return useMemo(() => (meKey ? (JSON.parse(meKey) as OnlineUser) : null), [meKey]);
}

/** People on the Arcade page right now. */
export function useArcadeOnline(): OnlineUser[] {
  const { user } = useAuth();
  const { data } = useData();
  const uid = user?.id;
  const me = useArcadeMe();
  const [others, setOthers] = useState<{ uid: string; list: unknown[] } | null>(null);
  const [joined, setJoined] = useState<RealtimeChannel | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const canJoin = !!me;

  // One channel per login: `me` changing (player id or name loading) must not re-join.
  // realtime-js hands back a channel with the same topic while it is still leaving, and subscribe()
  // on that does nothing, so a new join waits until the previous leave has finished.
  useEffect(() => {
    const client = sb;
    if (!client || !uid || !canJoin) return;
    let dead = false;
    let ch: RealtimeChannel | null = null;
    void leaving.then(() => {
      if (dead) return;
      // Private: only approved members may join (RLS on realtime.messages, see the migration).
      const c = client.channel("bn-arcade", { config: { private: true, presence: { key: uid } } });
      ch = c;
      // One entry per login (the presence key), the newest tab's; dedupeOnline then merges by player.
      const sync = () => setOthers({ uid, list: Object.values(c.presenceState()).map((tabs) => tabs[tabs.length - 1]) });
      c.on("presence", { event: "sync" }, sync).subscribe((status) => {
        if (status !== "SUBSCRIBED" || dead) return;
        setJoined(c);
        if (meRef.current) void c.track(meRef.current);
      });
    });
    return () => {
      dead = true;
      setJoined(null);
      setOthers(null);
      if (ch) leaving = client.removeChannel(ch).then(() => undefined, () => undefined);
    };
  }, [uid, canJoin]);

  // Name or player id changed after joining: update what the others see.
  useEffect(() => {
    if (joined && me) void joined.track(me);
  }, [joined, me]);

  return useMemo(() => {
    if (!me) return [];
    if (sb) return dedupeOnline([me, ...(others && others.uid === uid ? others.list : [])]);
    // Local preview: you and two sample people, so the waiting room has something to show.
    const extra = SAMPLE_MODE ? data.players.filter((p) => p.active).slice(1, 3).map((p) => ({ id: p.id, name: p.name })) : [];
    return dedupeOnline([me, ...extra]);
  }, [me, uid, others, data.players]);
}

/* ---------- the League lobby ---------- */

/** The League lobby, from the helper's live data (data.feed). See lobbyFromFeed in src/lib/arcade.ts for the mapping. */
export function useLobby(): LobbyState | null {
  const { data, now } = useData();
  return useMemo(() => lobbyFromFeed(data.feed, now), [data.feed, now]);
}

/* ---------- leaderboards ---------- */

const T0 = Date.now();
/** Sample mode only: a few made-up rounds of the sample players, so a fresh leaderboard isn't empty. Never saved. */
function sampleRows(boardId: string, players: Player[], max = 5000): RawScore[] {
  let h = 7;
  for (const c of boardId) h = (h * 31 + c.charCodeAt(0)) | 0;
  return players.slice(0, 4).map((p, i) => {
    h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff;
    return { playerId: p.id, score: Math.round((0.2 + ((h % 1000) / 1000) * 0.6) * max), at: T0 - (i + 1) * 864e5 };
  });
}

/** Top scores of one leaderboard (a Board id from the registry), best first: each player's best round. */
export function useLeaderboard(boardId: string, limit = 10): { rows: ScoreRow[]; loading: boolean } {
  const { player, data } = useData();
  const { isMember } = useAuth();
  const v = useSyncExternalStore(onScores, scoresVersion, scoresVersion);
  const board = findBoard(boardId)?.board;
  const lower = !!board?.lowerIsBetter;
  const key = `${boardId}|${limit}|${lower}`;
  const [got, setGot] = useState<{ key: string; rows: RawScore[] } | null>(null);
  const [tick, setTick] = useState(0);

  // Others' new scores: look again every minute while the page is visible, and when you come back to it.
  useEffect(() => {
    if (!sb) return;
    const again = () => document.visibilityState === "visible" && setTick((x) => x + 1);
    const t = setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", again);
    };
  }, []);

  useEffect(() => {
    if (!sb || !isMember) return;
    let live = true;
    fetchBest(sb, boardId, lower, limit)
      .then((rows) => live && setGot({ key, rows: bestPerPlayer(rows, lower, limit) }))
      .catch((e: { message?: string }) => {
        if (!live) return;
        console.error("[bridge-night] could not load the leaderboard", e?.message);
        setGot({ key, rows: [] });
      });
    return () => {
      live = false;
    };
  }, [key, boardId, lower, limit, v, tick, isMember]);

  const local = useMemo(() => {
    if (sb) return null;
    void v; // re-read localStorage after a new score
    const rows = localScores.list(boardId);
    return bestPerPlayer(SAMPLE_MODE ? [...sampleRows(boardId, data.players, board?.maxScore), ...rows] : rows, lower, limit);
  }, [boardId, lower, limit, v, data.players, board?.maxScore]);

  return useMemo(() => {
    const raw = local ?? (sb && !isMember ? [] : got?.key === key ? got.rows : null);
    const rows: ScoreRow[] = (raw ?? []).map((r) => ({
      playerId: r.playerId,
      name: player(r.playerId)?.name ?? r.name ?? "Former player",
      score: r.score,
      at: new Date(r.at).toISOString(),
    }));
    return { rows, loading: raw === null };
  }, [local, got, key, isMember, player]);
}

/** Save the current player's score on one leaderboard (a Board id). Throws a readable Error when it can't be saved. */
export async function submitScore(boardId: string, score: number): Promise<void> {
  const found = findBoard(boardId);
  if (!found) throw new Error("This game has no leaderboard.");
  const s = checkScore(score, found.board.maxScore);
  if (sb) await insertScore(sb, boardId, s);
  else {
    const me = localUser();
    if (!me) throw new Error("Log in to save your score.");
    localScores.add(boardId, { playerId: me.id, name: me.name, score: s, at: Date.now() });
  }
  scoresChanged();
}
