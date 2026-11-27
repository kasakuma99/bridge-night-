/**
 * Live rooms for Versus games. CONTRACT: the realtime-engineer implements it in ./index.ts;
 * the games only use what is declared here.
 *
 * How a room works
 * - The host's browser runs the game: it is the only one that knows the answers. It sends the public
 *   state (`S`) to everyone with setState; late joiners get the latest state automatically.
 * - Players send actions (`A`, e.g. "my answer is B") to the host with send(); only the host receives them.
 * - Never put the answer (or anything that gives it away, like a champion id or an image URL with the
 *   champion name) in the state before the reveal. Pictures go as small data: URLs drawn by the host.
 * - Only approved members logged in with Discord can host or join (private Realtime channel + RLS).
 * - Local dev (`npm run dev:sample`): the same API over BroadcastChannel, so two tabs can play together.
 */

export interface RoomPlayer {
  /** Player id when the login is linked to a player, otherwise the auth user id. */
  id: string;
  name: string;
  avatar?: string | null;
}

/** A room shown in "Open rooms" on the Arcade page. */
export interface RoomInfo {
  code: string;
  gameId: string;
  /** e.g. "Trivia night · Music". */
  title: string;
  host: RoomPlayer;
  players: number;
  phase: "lobby" | "playing" | "ended";
}

/** "reconnecting" = the host dropped out (refresh, network) and has a few seconds to come back; actions sent now are lost. */
export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface Room<S, A> {
  /** 4 letters, e.g. "KQZD". Join link: /arcade/<gameId>?room=KQZD */
  code: string;
  role: "host" | "player";
  me: RoomPlayer;
  /** Everyone in the room right now, host first. */
  players: RoomPlayer[];
  host: RoomPlayer | null;
  /** The latest public state from the host (null until the first one arrives). */
  state: S | null;
  status: RoomStatus;
  /** Readable text when status is "error" or "closed" (e.g. "The host left."). */
  error?: string;
  /** Host only: send the new public state to everyone. */
  setState: (s: S) => void;
  /** Host only: update what "Open rooms" shows. */
  setPhase: (phase: RoomInfo["phase"], title?: string) => void;
  /**
   * Player only: send an action to the host. Returns false when it could not go out (no host right now: "connecting",
   * "reconnecting", "closed"; not connected; over the size limit), so the game can say "not sent" or let them retry.
   * true = sent; Realtime gives no delivery receipt, so an action can still be lost if the host drops out at that moment.
   */
  send: (a: A) => boolean;
  /** Host only: called for every player action. Returns an unsubscribe function. */
  onAction: (fn: (from: RoomPlayer, a: A) => void) => () => void;
  leave: () => void;
}

/*
 * Hooks exported by ./index.ts:
 *   useHostRoom<S, A>(gameId: string, title: string): Room<S, A>    open a new room (stays open while mounted)
 *   useJoinRoom<S, A>(code: string | null): Room<S, A> | null       join one; null code = not joining
 *   useOpenRooms(): RoomInfo[]                                       rooms open right now (Arcade page)
 *   roomLink(gameId: string, code: string): string                   full join URL to paste in Discord
 */
