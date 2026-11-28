import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Minimize } from "lucide-react";
import { Skeleton, useToast } from "../components/ui";
import { useTask } from "../components/Layout";
import { MINIGAMES, findGame } from "../minigames/registry";
import { submitScore, useArcadeOnline, useLeaderboard, useLobby } from "../minigames/data";
import { useOpenRooms } from "../minigames/room";
import { Ava } from "../minigames/room/RoomLobby";
import type { RoomInfo } from "../minigames/room/types";
import type { Board, LobbyState, MinigameDef, ScoreRow } from "../minigames/types";
import NotFound from "./NotFound";
import "../styles/arcade.css";

/**
 * /arcade                   the list: League lobby, who is here, the games, open Versus rooms
 * /arcade/:game             one game (its own setup screen picks Solo or Versus)
 * /arcade/:game?room=CODE   the same, joining that Versus room right away
 * The window, tabs, footer and taskbar come from Layout.tsx (the old Steam UI kit, src/styles/kit.css).
 * Styles: src/styles/arcade.css. Data: src/minigames/data.ts. Rooms: src/minigames/room/.
 */
export default function Arcade() {
  const { game } = useParams();
  const def = game ? findGame(game) : undefined;
  useTask(def ? { to: `/arcade/${def.id}`, label: def.name } : null);
  if (game && !def) return <NotFound />;
  return (
    <section className="arc">
      <div className="head">
        <div>
          {def && (
            <p className="k-dim">
              <Link className="k-link" to="/arcade">
                Arcade
              </Link>{" "}
              &rsaquo; {def.name}
            </p>
          )}
          <h1>{def ? def.name : "Arcade"}</h1>
          <p className="sub">
            {def
              ? def.blurb
              : "Small games for while the League lobby fills up. Solo rounds go on the leaderboard, Versus rooms are for playing together on the stream."}
          </p>
        </div>
      </div>
      {def ? <GameScreen key={def.id} def={def} /> : <ArcadeHome />}
    </section>
  );
}

/* ------------------------------------------------------------------ home */

function ArcadeHome() {
  const online = useArcadeOnline();
  const lobby = useLobby();
  const rooms = useOpenRooms().filter((r) => r.phase !== "ended");
  return (
    <div className="k-layout">
      <aside className="k-side">
        <div className="k-group">
          <h3 className="k-h3">Here now</h3>
          {online.length ? (
            <ul className="k-people">
              {online.map((u) => (
                <li key={u.id} title={u.name}>
                  <Ava id={u.id} name={u.name} avatar={u.avatar} />
                  <span>{u.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="k-dim">Nobody else on this page yet. Drop the link in Discord.</p>
          )}
        </div>
        <div className="k-sep" />
        <div className="k-group">
          <h3 className="k-h3">Arcade info</h3>
          <table className="k-stats">
            <tbody>
              <tr>
                <td>Here now</td>
                <td>
                  <span className="k-counter">{String(online.length).padStart(3, "0")}</span>
                </td>
              </tr>
              <tr>
                <td>Rooms open</td>
                <td>{rooms.length}</td>
              </tr>
              <tr>
                <td>Games</td>
                <td>{MINIGAMES.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </aside>

      <div className="k-main">
        <LobbyBox lobby={lobby} />

        <hr className="k-sep" />

        <h2 className="k-h2" id="arc-games-h">
          Games
        </h2>
        <table className="k-list k-games" aria-labelledby="arc-games-h">
          <thead>
            <tr>
              <th className="k-no">#</th>
              <th>Game</th>
              <th className="k-modes">Modes</th>
              <th>
                <span className="arc-visually-hidden">Play</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {MINIGAMES.map((g, i) => (
              <tr key={g.id}>
                <td className="date k-no">{String(i + 1).padStart(2, "0")}</td>
                <td>
                  <Link to={`/arcade/${g.id}`}>{g.name}</Link>
                  <span className="k-blurb">{g.blurb}</span>
                </td>
                <td className="k-modes">{[g.boards.length > 0 && "Solo", g.versus !== false && "Versus"].filter(Boolean).join(", ")}</td>
                <td className="k-go">
                  <Link className="btn k" to={`/arcade/${g.id}`} aria-label={`Play ${g.name}`}>
                    Play
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="k-sep" />

        <OpenRooms rooms={rooms} />
      </div>
    </div>
  );
}

/** The one special box on the home page: the League lobby, filling up. */
function LobbyBox({ lobby }: { lobby: LobbyState | null }) {
  const of = lobby?.of ?? 10;
  const n = Math.min(lobby?.inLobby ?? 0, of);
  const full = !!lobby && n >= of;
  return (
    <section className="k-box" aria-labelledby="arc-lobby-h">
      <div className="k-title">
        <span id="arc-lobby-h">League lobby</span>
        <span className="k-ctrls" aria-hidden>
          <span>_</span>
          <span>&times;</span>
        </span>
      </div>
      <div className="k-boxbody">
        <div className="k-screen k-lobby" role="status" aria-label={lobby ? `League lobby: ${n} of ${of}` : "No lobby open right now"}>
          <span className={`k-lobby-n${lobby ? "" : " off"}`}>
            {lobby ? n : "--"}
            <small>/{of}</small>
          </span>
          <div className="k-slots" aria-hidden>
            {Array.from({ length: of }, (_, i) => (
              <i key={i} className={i < n ? "on" : ""} />
            ))}
          </div>
          <span className="k-lobby-phase">{lobby ? (full ? "Lobby full" : lobby.phase || "Lobby open") : "Offline"}</span>
        </div>
        <p className="k-note">
          {lobby
            ? full
              ? "Everyone is in. Finish your round, the game starts soon."
              : `Waiting for ${of - n} more. Play something meanwhile.`
            : "No League lobby yet. It shows up here once someone with the helper app is in a custom lobby."}
        </p>
      </div>
    </section>
  );
}

function OpenRooms({ rooms }: { rooms: RoomInfo[] }) {
  return (
    <>
      <h2 className="k-h2" id="arc-rooms-h">
        Open rooms
      </h2>
      {rooms.length ? (
        <table className="k-list k-rooms" aria-labelledby="arc-rooms-h">
          <thead>
            <tr>
              <th>Room</th>
              <th className="k-modes">Players</th>
              <th>Status</th>
              <th>
                <span className="arc-visually-hidden">Join</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const game = findGame(r.gameId);
              const playing = r.phase === "playing";
              return (
                <tr key={r.code}>
                  <td>
                    <span className="k-room">
                      <Ava id={r.host.id} name={r.host.name} avatar={r.host.avatar} />
                      <span>
                        <b>{r.title || game?.name || "Versus room"}</b>
                        <span className="k-blurb">
                          {game && r.title !== game.name ? `${game.name}, ` : ""}hosted by {r.host.name}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="k-modes">{r.players}</td>
                  <td className={playing ? "k-hot" : "date"}>{playing ? "Playing" : "In lobby"}</td>
                  <td className="k-go">
                    <Link
                      className="btn k"
                      to={`/arcade/${r.gameId}?room=${encodeURIComponent(r.code)}`}
                      aria-label={`${playing ? "Join next round of" : "Join"} ${r.title || game?.name || "room"}, hosted by ${r.host.name}`}
                    >
                      {playing ? "Join next" : "Join"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="k-dim">No rooms open. Start one from a game's Versus mode.</p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ one game */

function GameScreen({ def }: { def: MinigameDef }) {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const joinCode = params.get("room")?.trim().toUpperCase() || null;
  const Game = useMemo(() => lazy(def.load), [def]);
  const [active, setActive] = useState(def.boards[0]?.id ?? "");
  const board = def.boards.find((b) => b.id === active) ?? def.boards[0];
  const lb = useLeaderboard(board?.id ?? "");
  const frame = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(frame);

  const onScore = (boardId: string, score: number) => {
    if (def.boards.some((b) => b.id === boardId)) setActive(boardId);
    // A round of skips isn't worth a place on the board.
    if (score <= 0) return;
    submitScore(boardId, score).catch((e: unknown) => toast(e instanceof Error ? e.message : "Could not save the score", { err: true }));
  };
  // A round or room started: bring the whole game window into view (the setup screen may have been scrolled).
  const onPlay = () => {
    const el = frame.current;
    if (!el || fs.on) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.25) el.scrollIntoView({ block: "start", behavior: "auto" });
  };
  // Drop focus after a mouse click, so the games' Space/Enter shortcuts don't press this button again.
  const toggleFs = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail > 0) e.currentTarget.blur();
    fs.toggle().catch(() => toast("Full screen is blocked in this browser", { err: true }));
  };

  return (
    <div className={board ? "k-play" : "k-play solo-less"}>
      <section className="k-box k-gamebox" aria-label={def.name}>
        <div className="k-title">
          <span>{def.name}</span>
          <span className="k-ctrls">
            {(fs.can || fs.on) && (
              <button type="button" className="k-ctrl" onClick={toggleFs} aria-pressed={fs.on} title="Full screen">
                Full screen
              </button>
            )}
            <Link className="k-ctrl" to="/arcade" title="Back to the Arcade" aria-label="Close, back to the Arcade">
              &times;
            </Link>
          </span>
        </div>
        <div className="k-boxbody">
          <div ref={frame} className={`arc-frame${fs.on ? " is-fs" : ""}`}>
            {fs.on && (
              <div className="arc-frame-bar">
                <span className="arc-frame-title">{def.name}</span>
                <button type="button" className="arc-fs" onClick={toggleFs} aria-pressed>
                  <Minimize aria-hidden />
                  Exit full screen
                </button>
              </div>
            )}
            <Suspense
              fallback={
                <div className="arc-loading" role="status">
                  Loading {def.name}…
                </div>
              }
            >
              <Game onScore={onScore} onExit={() => nav("/arcade")} onPlay={onPlay} joinCode={joinCode} />
            </Suspense>
          </div>
        </div>
      </section>
      {board && <Leaderboard boards={def.boards} board={board} onPick={setActive} rows={lb.rows} loading={lb.loading} />}
    </div>
  );
}

function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [ref]);
  const can = typeof document !== "undefined" && !!document.fullscreenEnabled;
  const toggle = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ref.current?.requestFullscreen();
  };
  return { on, can, toggle };
}

function Leaderboard({
  boards,
  board,
  onPick,
  rows,
  loading,
}: {
  boards: Board[];
  board: Board;
  onPick: (id: string) => void;
  rows: ScoreRow[];
  loading: boolean;
}) {
  return (
    <aside className="k-side arc-lb" aria-labelledby="arc-lb-h">
      <h3 className="k-h3" id="arc-lb-h">
        Leaderboard{rows.length > 0 && <span className="k-dim"> top {rows.length}</span>}
      </h3>
      {boards.length > 1 && (
        <div className="k-lbtabs" role="group" aria-label="Leaderboard">
          {boards.map((b) => (
            <button key={b.id} type="button" aria-pressed={b.id === board.id} onClick={() => onPick(b.id)}>
              {b.label}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div className="arc-lb-skel">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={22} />
          ))}
        </div>
      ) : rows.length ? (
        <ol className="arc-lb-list" key={board.id}>
          {rows.map((r, i) => (
            <li key={r.playerId + r.at} className={i === 0 ? "first" : undefined}>
              <span className="arc-lb-pos" aria-label={`Rank ${i + 1}`}>
                {i + 1}
              </span>
              <span className="arc-lb-name">{r.name}</span>
              <span className="arc-lb-score" title={new Date(r.at).toLocaleString()}>
                {r.score.toLocaleString()}
                {board.scoreLabel && <small> {board.scoreLabel}</small>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="k-dim">No scores yet. Finish a solo round to take first place.</p>
      )}
    </aside>
  );
}
