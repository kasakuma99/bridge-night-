import { Suspense, lazy, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Maximize, Minimize } from "lucide-react";
import { Skeleton, useToast } from "../components/ui";
import { MINIGAMES, findGame } from "../minigames/registry";
import { submitScore, useArcadeOnline, useLeaderboard, useLobby } from "../minigames/data";
import { useOpenRooms } from "../minigames/room";
import { Ava } from "../minigames/room/RoomLobby";
import type { RoomInfo } from "../minigames/room/types";
import type { Board, LobbyState, MinigameDef, OnlineUser, ScoreRow } from "../minigames/types";
import NotFound from "./NotFound";
import "../styles/arcade.css";

/**
 * /arcade                   the list: waiting room (lobby fill, who is here, open Versus rooms) and the games
 * /arcade/:game             one game (its own setup screen picks Solo or Versus)
 * /arcade/:game?room=CODE   the same, joining that Versus room right away
 * Layout and looks: src/styles/arcade.css (shared arc-* primitives for game builders are documented there).
 * Data: src/minigames/data.ts. Rooms: src/minigames/room/ (RoomLobby.tsx is the shared lobby UI).
 */
export default function Arcade() {
  const { game } = useParams();
  if (!game) return <ArcadeHome />;
  const def = findGame(game);
  return def ? <GameScreen key={def.id} def={def} /> : <NotFound />;
}

/* ------------------------------------------------------------------ home */

function ArcadeHome() {
  const online = useArcadeOnline();
  const lobby = useLobby();
  const rooms = useOpenRooms().filter((r) => r.phase !== "ended");
  return (
    <section className="arc arc-home">
      <ArcadeHero online={online.length} rooms={rooms.length} lobby={lobby} />
      <WaitingRoom online={online} lobby={lobby} rooms={rooms} />
      <section className="arc-sec" aria-labelledby="arc-games-h">
        <h2 id="arc-games-h" className="arc-h2">
          Games <span className="arc-h2-jp" aria-hidden>ゲーム</span>
        </h2>
        <ul className="arc-cards">
          {MINIGAMES.map((g, i) => (
            <li key={g.id}>
              <GameCard def={g} n={i + 1} />
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

/** The hero, styled like a game case: black band, the art, stacked outline tags and a sticker strip. Decoration only. */
function ArcadeHero({ online, rooms, lobby }: { online: number; rooms: number; lobby: LobbyState | null }) {
  return (
    <header className="arc-hero">
      <div className="arc-hero-band">
        <span className="arc-hero-brand">Bridge Night</span>
        <span className="arc-syms" aria-hidden>
          <i className="tri" />
          <i className="cir" />
          <i className="crs" />
          <i className="sq" />
        </span>
      </div>
      <div className="arc-hero-art">
        <p className="arc-hero-tags" aria-hidden>
          <span>Wait</span>
          <span>Play</span>
          <span>Win</span>
        </p>
        <h1 className="arc-hero-logo" data-text="ARCADE">
          Arcade
        </h1>
        <p className="arc-hero-sub">Small games for while the lobby fills up. Play solo for the leaderboard, or open a room and play together.</p>
        <p className="arc-hero-jp" aria-hidden>
          ブリッジナイト・ゲームセンター
        </p>
      </div>
      <div className="arc-hero-strip">
        <span className="arc-stat">
          <b className="num">{online}</b> here now
        </span>
        <span className="arc-stat">
          <b className="num">{rooms}</b> {rooms === 1 ? "room" : "rooms"} open
        </span>
        <span className="arc-stat">{lobby ? <>Lobby <b className="num">{Math.min(lobby.inLobby, lobby.of)}/{lobby.of}</b></> : "No lobby yet"}</span>
        <span className="arc-barcode" aria-hidden>
          <i />
          Limited edition
        </span>
      </div>
    </header>
  );
}

function WaitingRoom({ online, lobby, rooms }: { online: OnlineUser[]; lobby: LobbyState | null; rooms: RoomInfo[] }) {
  const of = lobby?.of ?? 10;
  const n = Math.min(lobby?.inLobby ?? 0, of);
  const full = !!lobby && n >= of;
  return (
    <section className="panel arc-wait" aria-labelledby="arc-wait-h">
      <div className="arc-wait-lobby">
        <div className="arc-wait-head">
          <h2 id="arc-wait-h" className="arc-h2">
            Waiting room
          </h2>
          <span className={`arc-phase${lobby ? " on" : ""}${full ? " full" : ""}`}>{lobby ? (full ? "Lobby full" : lobby.phase || "Lobby open") : "Offline"}</span>
        </div>
        <div className="arc-fill" role="status" aria-label={lobby ? `League lobby: ${n} of ${of}` : "No lobby open right now"}>
          <span className={`arc-fill-n num${lobby ? "" : " off"}`}>
            {lobby ? n : "–"}
            <small>/{of}</small>
          </span>
          <div className="arc-slots" aria-hidden>
            {Array.from({ length: of }, (_, i) => (
              <i key={i} className={i < n ? "on" : ""} />
            ))}
          </div>
        </div>
        <p className="arc-wait-note">
          {lobby
            ? full
              ? "Everyone is in. Finish your round, the game starts soon."
              : `Waiting for ${of - n} more. Play something meanwhile.`
            : "No League lobby yet. It shows up here once someone with the helper app is in a custom lobby."}
        </p>
      </div>
      <div className="arc-wait-here">
        <h3 className="arc-h3">
          Here now <span className="arc-count num">{online.length}</span>
        </h3>
        {online.length ? (
          <ul className="arc-here">
            {online.map((u) => (
              <li key={u.id} title={u.name}>
                <Ava id={u.id} name={u.name} avatar={u.avatar} />
                <span>{u.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="arc-none">Nobody else on this page yet. Drop the link in Discord.</p>
        )}
      </div>
      <OpenRooms rooms={rooms} />
    </section>
  );
}

function OpenRooms({ rooms }: { rooms: RoomInfo[] }) {
  return (
    <div className="arc-rooms">
      <h3 className="arc-h3">
        Open rooms <span className="arc-count num">{rooms.length}</span>
      </h3>
      {rooms.length ? (
        <ul className="arc-rooms-list">
          {rooms.map((r) => {
            const game = findGame(r.gameId);
            const playing = r.phase === "playing";
            return (
              <li key={r.code}>
                <Ava id={r.host.id} name={r.host.name} avatar={r.host.avatar} />
                <div className="arc-rooms-what">
                  <b>{r.title || game?.name || "Versus room"}</b>
                  <span>
                    {game && r.title !== game.name ? `${game.name} · ` : ""}hosted by {r.host.name}
                  </span>
                </div>
                <span className="arc-rooms-n num">
                  {r.players} {r.players === 1 ? "player" : "players"}
                </span>
                <span className={`arc-phase on${playing ? " full" : ""}`}>{playing ? "Playing" : "In lobby"}</span>
                <Link
                  className={`btn sm${playing ? "" : " pri"} arc-rooms-join`}
                  to={`/arcade/${r.gameId}?room=${encodeURIComponent(r.code)}`}
                  aria-label={`${playing ? "Join next round of" : "Join"} ${r.title || game?.name || "room"}, hosted by ${r.host.name}`}
                >
                  {playing ? "Join next round" : "Join"}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="arc-none">No rooms open. Start one from a game's Versus mode.</p>
      )}
    </div>
  );
}

/** A game as a little game case: art on top, stickers, name, blurb, modes. */
function GameCard({ def, n }: { def: MinigameDef; n: number }) {
  return (
    <Link className="arc-card" to={`/arcade/${def.id}`}>
      <div className={`arc-art arc-art-${def.id}`} aria-hidden>
        <CardArt id={def.id} />
        <span className="arc-art-no num">{String(n).padStart(2, "0")}</span>
      </div>
      <div className="arc-card-body">
        <div className="arc-card-tags">
          {def.boards.length > 0 && <span className="arc-tag solo">Solo</span>}
          {def.versus !== false && <span className="arc-tag versus">Versus</span>}
        </div>
        <h3>{def.name}</h3>
        <p>{def.blurb}</p>
        {def.boards.length > 1 && (
          <p className="arc-card-modes">
            <span className="arc-visually-hidden">Modes: </span>
            {def.boards.map((b) => (
              <span key={b.id}>{b.label}</span>
            ))}
          </p>
        )}
        <span className="arc-card-go">Play ▸</span>
      </div>
    </Link>
  );
}

/** Small deterministic random, so the decorative art is the same on every render. */
function rand(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const PIXEL_COLS = ["#16f4d0", "#7b5cff", "#c6ff3d", "#ff4fa3", "#1b2a6b", "#0b1240", "#3d7bff", "#e9eeff"];

function CardArt({ id }: { id: string }) {
  if (id === "chums-revenge")
    return (
      <div className="arc-art-poly">
        <i />
        <i />
        <i />
      </div>
    );
  if (id === "champ-guesser") {
    const r = rand(id);
    return (
      <div className="arc-art-pixels">
        {Array.from({ length: 64 }, (_, i) => (
          <i key={i} style={{ background: PIXEL_COLS[Math.floor(r() * r() * PIXEL_COLS.length)] }} />
        ))}
      </div>
    );
  }
  return (
    <div className="arc-art-quiz">
      <b>?</b>
      <span className="arc-syms big">
        <i className="tri" />
        <i className="cir" />
        <i className="crs" />
        <i className="sq" />
      </span>
    </div>
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
  // A round or room started: bring the whole frame into view (the setup screen may have been scrolled).
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
    <section className="arc arc-game">
      <div className="arc-game-head">
        <Link className="arc-back" to="/arcade">
          <ArrowLeft aria-hidden /> Arcade
        </Link>
        <h1>{def.name}</h1>
        <p className="sub">{def.blurb}</p>
      </div>

      <div className={board ? "arc-play" : "arc-play solo-less"}>
        <div ref={frame} className={`arc-frame${fs.on ? " is-fs" : ""}`}>
          {(fs.can || fs.on) && (
            <div className="arc-frame-bar">
              {fs.on && <span className="arc-frame-title">{def.name}</span>}
              <button type="button" className="arc-fs" onClick={toggleFs} aria-pressed={fs.on}>
                {fs.on ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
                {fs.on ? "Exit full screen" : "Full screen"}
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
        {board && <Leaderboard boards={def.boards} board={board} onPick={setActive} rows={lb.rows} loading={lb.loading} />}
      </div>
    </section>
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
    <aside className="panel arc-lb" aria-labelledby="arc-lb-h">
      <div className="ph">
        <h2 id="arc-lb-h">Leaderboard</h2>
        {rows.length > 0 && <span className="sub">Top {rows.length}</span>}
      </div>
      {boards.length > 1 && (
        <div className="seg arc-lb-tabs" role="group" aria-label="Leaderboard">
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
            <Skeleton key={i} h={36} />
          ))}
        </div>
      ) : rows.length ? (
        <ol className="arc-lb-list" key={board.id}>
          {rows.map((r, i) => (
            <li key={r.playerId + r.at} className={i === 0 ? "first" : undefined}>
              <span className="arc-lb-pos num" aria-label={`Rank ${i + 1}`}>
                {i + 1}
              </span>
              <span className="arc-lb-name">{r.name}</span>
              <span className="arc-lb-score num" title={new Date(r.at).toLocaleString()}>
                {r.score.toLocaleString()}
                {board.scoreLabel && <small> {board.scoreLabel}</small>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="arc-none">No scores yet. Finish a solo round to take first place.</p>
      )}
    </aside>
  );
}
