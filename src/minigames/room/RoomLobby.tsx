import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { initials, usePlayerColor } from "../../components/ui";
import { roomLink } from "./index";
import type { Room } from "./types";

/**
 * Shared, presentational room UI for Versus games. Styles: src/styles/arcade.css (arc-room-*).
 *
 *   <RoomLobby room={room} gameId="trivia-night" title="Trivia night · Music" canStart={room.players.length > 1}
 *              onStart={start} onLeave={leave}>
 *     ...host-only settings (category, rounds)...
 *   </RoomLobby>
 *
 *   <RoomBar room={room} onLeave={leave} />   thin bar above the game while a Versus round runs
 *
 * Both only read the fields in LobbyRoom, so any Room<S, A> can be passed in.
 */

/** The part of a Room these components read. Any Room<S, A> fits. */
export type LobbyRoom = Pick<Room<unknown, unknown>, "code" | "role" | "me" | "players" | "host" | "status" | "error">;

export interface RoomLobbyProps {
  room: LobbyRoom;
  gameId: string;
  title: string;
  /** Host only: enables the Start button. */
  canStart: boolean;
  onStart?: () => void;
  onLeave: () => void;
  /** Optional: a short line under the Start button while it is disabled (e.g. "Waiting for one more player"). */
  startHint?: string;
  /** Game-specific host settings, shown to the host only. */
  children?: ReactNode;
}

export function RoomLobby({ room, gameId, title, canStart, onStart, onLeave, startHint, children }: RoomLobbyProps) {
  const host = room.role === "host";
  const hostName = room.host?.name ?? "the host";
  const down = room.status === "closed" || room.status === "error";
  const link = room.code ? roomLink(gameId, room.code) : "";

  return (
    <section className="arc-room" aria-labelledby="arc-room-h">
      <header className="arc-room-head">
        <div>
          <p className="arc-room-kicker">{host ? "Your Versus room" : "Versus room"}</p>
          <h2 id="arc-room-h">{title}</h2>
        </div>
        <button type="button" className="btn ghost arc-room-leave" onClick={onLeave}>
          <LogOut aria-hidden /> Leave
        </button>
      </header>

      {room.status === "connecting" && (
        <p className="arc-room-status" role="status">
          Connecting to the room…
        </p>
      )}
      {room.status === "reconnecting" && (
        <p className="arc-room-status" role="status">
          The host dropped out. Waiting for them to come back…
        </p>
      )}
      {down && (
        <p className={`arc-room-status ${room.status}`} role="alert">
          {room.error ?? (room.status === "closed" ? "This room is closed." : "Something went wrong with the room.")}
        </p>
      )}

      <div className="arc-room-grid">
        <div className="arc-room-join">
          <span className="arc-room-label">Room code</span>
          <RoomCode code={room.code} />
          {link && !down && <InviteLink link={link} />}
        </div>

        <div className="arc-room-people">
          <h3 className="arc-room-label">Players ({room.players.length})</h3>
          {room.players.length ? (
            <ul className="arc-room-players">
              {room.players.map((p) => {
                const isHost = p.id === room.host?.id;
                return (
                  <li key={p.id} className={isHost ? "host" : ""}>
                    <Ava id={p.id} name={p.name} avatar={p.avatar} />
                    <span className="arc-room-name">{p.name}</span>
                    {isHost && <small className="arc-room-tag">(host)</small>}
                    {p.id === room.me.id && <small className="arc-room-tag">(you)</small>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="arc-room-none">Nobody here yet.</p>
          )}
        </div>
      </div>

      {!down &&
        (host ? (
          <div className="arc-room-host">
            {children && <div className="arc-room-settings">{children}</div>}
            <div className="arc-room-start">
              <button type="button" className="btn pri arc-room-go" disabled={!canStart || !onStart} onClick={onStart}>
                Start
              </button>
              {!canStart && startHint && <p className="arc-room-hint">{startHint}</p>}
            </div>
          </div>
        ) : (
          room.status === "open" && (
            <p className="arc-room-wait" role="status">
              Waiting for <b>{hostName}</b> to start…
            </p>
          )
        ))}
    </section>
  );
}

/** The 4-letter code as large plain text, so it reads on a shrunk Discord stream. */
function RoomCode({ code }: { code: string }) {
  if (!code) return <span className="arc-room-code empty">····</span>;
  return (
    <span className="arc-room-code num">
      <span className="arc-visually-hidden">{code.split("").join(" ")}</span>
      <span aria-hidden>{code}</span>
    </span>
  );
}

function InviteLink({ link }: { link: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  useEffect(() => {
    if (state !== "copied") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setState("copied");
    } catch {
      // No clipboard access (http, old browser, denied): select the text so Ctrl+C works.
      setState("manual");
      input.current?.focus();
      input.current?.select();
    }
  };

  return (
    <div className="arc-room-invite">
      <button type="button" className="btn arc-room-copy" onClick={copy}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
        {state === "copied" ? "Copied" : "Copy invite link"}
      </button>
      <input
        ref={input}
        className="arc-room-url"
        readOnly
        value={link}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <span className="arc-room-copied" role="status">
        {state === "copied" ? "Link copied. Paste it in Discord." : state === "manual" ? "Press Ctrl+C to copy the link." : ""}
      </span>
    </div>
  );
}

export interface RoomBarProps {
  room: LobbyRoom;
  onLeave: () => void;
}

/** Thin bar for during a Versus game: code, who is in, Leave. */
export function RoomBar({ room, onLeave }: RoomBarProps) {
  const down = room.status === "closed" || room.status === "error";
  return (
    <div className={`arc-room-bar${down ? " down" : ""}`}>
      <span className="arc-room-bar-code">
        Room <b className="num">{room.code || "····"}</b>
      </span>
      <span className="arc-room-bar-people" title={room.players.map((p) => p.name).join(", ")}>
        <b className="num">{room.players.length}</b> {room.players.length === 1 ? "player" : "players"}
      </span>
      {room.status === "connecting" && <span className="arc-room-bar-note">Connecting…</span>}
      {room.status === "reconnecting" && (
        <span className="arc-room-bar-note" role="status">
          Host reconnecting… answers sent now are lost
        </span>
      )}
      {down && (
        <span className="arc-room-bar-note bad" role="alert">
          {room.error ?? "Room closed"}
        </span>
      )}
      <button type="button" className="arc-room-bar-leave" onClick={onLeave}>
        <LogOut aria-hidden /> Leave
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- avatar */

const FALLBACK = "#4a5563";
const hue = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/** Discord picture if there is one, otherwise initials in the player's roster colour (or a colour from the name). */
export function Ava({ id, name, avatar }: { id: string; name: string; avatar?: string | null }) {
  const color = usePlayerColor();
  const [broken, setBroken] = useState(false);
  const c = color(id);
  return (
    <span className="ava arc-ava" style={{ background: c === FALLBACK ? `hsl(${hue(name)} 38% 34%)` : c }} aria-hidden>
      {avatar && !broken ? <img src={avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}
