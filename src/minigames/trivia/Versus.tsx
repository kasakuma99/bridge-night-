import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowRight, Check, Eye, Flag, RotateCcw, Settings2, SkipForward, X } from "lucide-react";
import { useHostRoom, useJoinRoom } from "../room";
import { RoomBar, RoomLobby } from "../room/RoomLobby";
import type { Room } from "../room/types";
import type { TriviaQuestion } from "./types";
import {
  MAX_ANSWER_LENGTH,
  choiceKey,
  rankScores,
  vsAddPlayers,
  vsAllAnswered,
  vsAnswer,
  vsCreate,
  vsEnd,
  vsNext,
  vsOverride,
  vsPublic,
  vsResume,
  vsReveal,
  vsSkip,
  vsStart,
  type Setup,
  type VsAction,
  type VsGame,
  type VsState,
} from "./logic";
import { Choices, Podium, QuestionHead, Timer, fmt, newSeed, readSession, useArrivalCountdown, useCountdown, useShortcuts, writeSession } from "./ui";

export const GAME_ID = "trivia-night";
/** The host's private game, kept across a refresh (sessionStorage, this tab only). See parseSavedHost. */
export const HOST_GAME_KEY = "bn-trivia-host";
/** Where the room engine keeps the code of the room this tab hosts (src/minigames/room/index.ts). */
export const HOST_ROOM_KEY = `bn-room-host:${GAME_ID}`;
/** True when this tab was hosting a trivia room before a refresh. */
export const hostRoomSaved = () => readSession(HOST_ROOM_KEY) !== null;

/** Timer that re-renders only itself (the host screen stays still while it ticks). */
function LiveTimer({ endsAt, seconds }: { endsAt: number; seconds: number }) {
  const left = useCountdown(endsAt);
  return <Timer leftMs={left} totalMs={seconds * 1000} />;
}

/* =====================================================================================
   HOST: holds the questions, runs the clock, checks answers. Streamed on Discord.
   ===================================================================================== */

export function VersusHost({
  setup,
  initial,
  title,
  summary,
  seconds,
  pick,
  onLeave,
  onPlay,
}: {
  /** Saved with the game so a refresh comes back with the same settings. */
  setup: Setup;
  /** The game from before a refresh, if any. */
  initial: VsGame | null;
  title: string;
  /** One line for the lobby, e.g. "10 questions · 20 s · Music, Film & TV". */
  summary: string;
  seconds: number;
  /** New questions for a round (called on start and on "Play again"). */
  pick: () => TriviaQuestion[];
  onLeave: () => void;
  /** The page scrolls the game frame into view. */
  onPlay: () => void;
}) {
  const room = useHostRoom<VsState, VsAction>(GAME_ID, title);
  const [game, setGame] = useState<VsGame>(() => (initial ? vsResume(initial, Date.now()) : vsCreate([], seconds, 0)));
  const [confirmEnd, setConfirmEnd] = useState(false);

  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });

  const others = useMemo(() => room.players.filter((p) => p.id !== room.me.id), [room.players, room.me.id]);
  const otherIds = useMemo(() => others.map((p) => p.id), [others]);

  // Everyone in the room gets a score line (late joiners start at 0).
  useEffect(() => {
    setGame((g) => vsAddPlayers(g, others));
  }, [others]);

  // Keep the game across a refresh (the room engine keeps the code). Cleared on leave.
  useEffect(() => writeSession(HOST_GAME_KEY, JSON.stringify({ v: 1, setup, game })), [setup, game]);

  // Player answers. The host's own clock decides the speed points. Never from the host's own id.
  useEffect(
    () =>
      room.onAction((from, a) => {
        if (from.id === roomRef.current.me.id) return;
        const at = Date.now();
        setGame((g) => vsAnswer(g, from, a, at));
      }),
    [room.onAction],
  );

  // Publish the public state (never the answer before the reveal). Also when someone joins, so their msLeft is fresh.
  const whoKey = otherIds.join();
  useEffect(() => {
    const r = roomRef.current;
    if (r.status !== "closed" && r.status !== "error") r.setState(vsPublic(game, Date.now()));
  }, [game, room.status, whoKey]);

  // Open rooms list.
  useEffect(() => {
    roomRef.current.setPhase(game.phase === "lobby" ? "lobby" : game.phase === "ended" ? "ended" : "playing", title);
  }, [game.phase === "lobby", game.phase === "ended", title]);

  // Question ends when time runs out...
  useEffect(() => {
    if (game.phase !== "question") return;
    const idx = game.index;
    const t = window.setTimeout(() => setGame((g) => (g.phase === "question" && g.index === idx ? vsReveal(g) : g)), Math.max(0, game.endsAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [game.phase, game.index, game.endsAt]);

  // ...or when everyone in the room has answered.
  useEffect(() => {
    if (vsAllAnswered(game, otherIds)) setGame(vsReveal);
  }, [game, otherIds]);

  useEffect(() => {
    if (!confirmEnd) return;
    const t = window.setTimeout(() => setConfirmEnd(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmEnd]);

  const reveal = () => setGame(vsReveal);
  const next = () => setGame((g) => vsNext(g, Date.now()));
  const skip = () => setGame((g) => vsSkip(g, Date.now()));
  const end = () => (confirmEnd ? setGame(vsEnd) : setConfirmEnd(true));
  // Also "Play again": a new set of questions, scores back to 0, same people.
  const start = () => {
    setGame(vsStart(vsCreate(pick(), seconds, newSeed(), others), Date.now()));
    onPlay();
  };
  const leave = () => {
    writeSession(HOST_GAME_KEY, null);
    room.leave();
    onLeave();
  };
  // After a mouse click, drop focus: otherwise the next Space/Enter would press the same button again
  // (Chrome treats it as keyboard focus then) instead of running the shortcut.
  const click = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail > 0) e.currentTarget.blur();
    fn();
  };

  const state = useMemo(() => vsPublic(game, 0), [game]);
  const q = game.questions[game.index] as TriviaQuestion | undefined;
  const isOpen = (game.choices[game.index]?.length ?? 0) === 0;
  // Rows for keys 1-9: everyone with a score, in a stable order (join order).
  const rowIds = useMemo(() => Object.keys(game.names), [game.names]);

  const toggle = useCallback(
    (id: string) =>
      setGame((g) => {
        const a = g.answers[id];
        return a ? vsOverride(g, id, !a.correct) : g;
      }),
    [],
  );

  useShortcuts((e) => {
    if (game.phase === "question" && (e.key === " " || e.code === "Space")) {
      reveal();
      return true;
    }
    if (game.phase === "reveal" && (e.key === "Enter" || e.key === "ArrowRight")) {
      next();
      return true;
    }
    if (game.phase === "reveal" && isOpen && /^[1-9]$/.test(e.key)) {
      const id = rowIds[Number(e.key) - 1];
      if (id && game.answers[id]) {
        toggle(id);
        return true;
      }
    }
    return false;
  });

  if (game.phase === "lobby") {
    return (
      <div className="arc-stage">
        <RoomLobby
          room={room}
          gameId={GAME_ID}
          title={title}
          canStart={others.length > 0 && room.status === "open"}
          onStart={start}
          onLeave={leave}
          startHint="Share the invite link in Discord. You can start once someone has joined."
        >
          <p className="arc-tv-lobbyline">{summary}</p>
          <p className="arc-tv-hint">You run the screen and see no answers before the reveal. Everyone else answers on their own phone or PC.</p>
        </RoomLobby>
      </div>
    );
  }

  if (game.phase === "ended") {
    const rows = rankScores(state.scores, state.names);
    return (
      <div className="arc-stage arc-tv-end">
        <RoomBar room={room} onLeave={leave} />
        <p className="arc-kicker">Final scores</p>
        {rows.length > 0 ? <Podium rows={rows} /> : <p className="arc-tv-sub">Nobody scored this time.</p>}
        <div className="arc-hostbar inline">
          <button type="button" onClick={leave}>
            <Settings2 /> Close room
          </button>
          <button type="button" className="pri" onClick={start}>
            <RotateCcw /> Play again
          </button>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const revealed = game.phase === "reveal";
  const answerIndex = (game.choices[game.index] ?? []).indexOf(q.answer);
  const rows = revealed ? rankScores(state.scores, state.names) : rowIds.map((id) => ({ id, name: game.names[id], score: state.scores[id] ?? 0, rank: 0 }));
  const last = game.index + 1 >= game.questions.length;

  return (
    <div className="arc-stage arc-tv-host">
      <RoomBar room={room} onLeave={leave} />
      <div className="arc-tv-hostgrid">
        <section className="arc-tv-main" aria-label="Question">
          <QuestionHead index={game.index} total={game.questions.length} category={q.category} topic={q.topic} difficulty={q.difficulty} />
          {revealed ? <Timer leftMs={0} totalMs={game.seconds * 1000} /> : <LiveTimer endsAt={game.endsAt} seconds={game.seconds} />}
          <h2 className={"arc-big arc-tv-q" + (q.question.length > 60 ? " sm" : "")}>{q.question}</h2>
          {!isOpen ? (
            <Choices choices={game.choices[game.index]} stateOf={(i) => (!revealed ? undefined : i === answerIndex ? "correct" : "dim")} />
          ) : !revealed ? (
            <p className="arc-tv-open">Type your answer on your device</p>
          ) : null}
          {revealed && (
            <div className="arc-tv-reveal arc-reveal" key={game.index} aria-live="polite">
              {isOpen && (
                <p className="arc-tv-answer">
                  <span className="arc-tv-label">Answer</span>
                  {q.answer}
                </p>
              )}
              {q.fact && <p className="arc-tv-fact">{q.fact}</p>}
            </div>
          )}
        </section>

        <aside className="arc-tv-side" aria-label={revealed ? "Answers and scores" : "Who has answered"}>
          <p className="arc-tv-sidehead">
            {revealed ? (
              "Scores"
            ) : (
              <>
                Answered <b className="num">{state.answered.filter((id) => otherIds.includes(id)).length}</b> / <span className="num">{otherIds.length}</span>
              </>
            )}
          </p>
          <ol className="arc-tv-board">
            {rows.map((r) => {
              const a = game.answers[r.id];
              const key = rowIds.indexOf(r.id) + 1;
              const away = !otherIds.includes(r.id);
              return (
                <li key={r.id} className={(revealed ? (a?.correct ? "is-got" : a ? "is-lost" : "is-none") : a ? "is-in" : "") + (away ? " is-away" : "")}>
                  <span className="arc-tv-pname">{r.name}</span>
                  {revealed ? (
                    <>
                      {a && a.points > 0 && <span className="arc-tv-delta num">+{fmt(a.points)}</span>}
                      <span className="arc-tv-score num">{fmt(r.score)}</span>
                      <span className="arc-tv-given">
                        {a ? (
                          <>
                            {a.correct ? <Check aria-label="Right" /> : <X aria-label="Wrong" />}
                            <span>{a.value}</span>
                          </>
                        ) : (
                          <span className="arc-tv-noans">No answer</span>
                        )}
                        {isOpen && a && (
                          <button type="button" className="arc-tv-mark-btn" onClick={click(() => toggle(r.id))} title={key <= 9 ? `Key ${key}` : undefined}>
                            {key <= 9 && <kbd>{key}</kbd>}
                            {a.correct ? "Mark wrong" : "Mark right"}
                          </button>
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="arc-tv-score num">{fmt(r.score)}</span>
                      <span className="arc-tv-tick" aria-label={a ? "Answered" : "Thinking"}>
                        {a ? <Check /> : "…"}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {rows.length === 0 && <p className="arc-tv-hint">Nobody in the room yet.</p>}
          {revealed && isOpen && game.answers && Object.keys(game.answers).length > 0 && <p className="arc-tv-tip">The check is forgiving. Fix it with the buttons or keys.</p>}
        </aside>
      </div>

      <nav className="arc-hostbar" aria-label="Host controls">
        {!revealed && (
          <button type="button" onClick={click(reveal)} title="Reveal now (Space)">
            <Eye /> Reveal <kbd>Space</kbd>
          </button>
        )}
        {revealed && (
          <button type="button" className="pri" onClick={click(next)} title="Next (Enter or Right arrow)">
            {last ? "Finish" : "Next"} <ArrowRight /> <kbd>Enter</kbd>
          </button>
        )}
        {!revealed && !last && (
          <button type="button" onClick={click(skip)} title="Skip this question, no points">
            <SkipForward /> Skip
          </button>
        )}
        <button type="button" className={confirmEnd ? "is-danger" : ""} onClick={click(end)}>
          <Flag /> {confirmEnd ? "Sure? End now" : "End"}
        </button>
      </nav>
    </div>
  );
}

/* =====================================================================================
   PLAYER: phone-friendly answer pad.
   ===================================================================================== */

export function VersusPlayer({ code, onLeave }: { code: string; onLeave: () => void }) {
  const room = useJoinRoom<VsState, VsAction>(code);
  if (!room) {
    return (
      <div className="arc-stage">
        <p className="arc-big sm">Joining room {code}…</p>
        <button type="button" className="btn ghost" onClick={onLeave}>
          Back
        </button>
      </div>
    );
  }
  return <PlayerScreen room={room} onLeave={onLeave} />;
}

/** An answer the host hasn't confirmed (in `answered`) after this long counts as lost: the pad opens again. */
const PENDING_MS = 4000;

function PlayerScreen({ room, onLeave }: { room: Room<VsState, VsAction>; onLeave: () => void }) {
  const s = room.state;
  // What I sent for which question. It only locks the pad until the host confirms it or PENDING_MS passes.
  const [mine, setMine] = useState<{ index: number; value: string } | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const leave = () => {
    room.leave();
    onLeave();
  };

  // New question: clear the text box and any note.
  const qKey = s && s.phase === "question" ? s.index : -1;
  useEffect(() => {
    setText("");
    setNote("");
  }, [qKey]);

  const reconnecting = room.status === "reconnecting";
  const down = room.status === "closed" || room.status === "error";
  const confirmed = !!s && s.phase !== "lobby" && s.answered.includes(room.me.id);
  const myAnswer = mine && s && mine.index === s.index ? mine.value : null;
  const pending = myAnswer !== null && !confirmed && s?.phase === "question";
  const locked = confirmed || pending;
  // Counts down from the host's msLeft, from when this state arrived: the phone's clock doesn't matter.
  const left = useArrivalCountdown(s?.phase === "question" ? s.msLeft : 0, s);
  const canAnswer = !!s && s.phase === "question" && !locked && left > 0 && !reconnecting && !down;

  // Not confirmed in time, or the host dropped out meanwhile: the answer was lost, so let them send it again.
  useEffect(() => {
    if (!pending) return;
    const lost = () => {
      setMine(null);
      setNote("Your answer didn't reach the host. Send it again.");
    };
    if (reconnecting) {
      lost();
      return;
    }
    const t = window.setTimeout(lost, PENDING_MS);
    return () => window.clearTimeout(t);
  }, [pending, reconnecting]);

  const send = (value: string) => {
    if (!s || !canAnswer) return;
    const v = value.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER_LENGTH);
    if (!v) return;
    // send() returns false when the answer can't go out (the engineer's version); older versions return nothing.
    const ok = (room.send({ type: "answer", value: v, at: Date.now() }) as unknown) !== false;
    if (!ok) {
      setNote("Couldn't send your answer. Try again.");
      return;
    }
    setNote("");
    setMine({ index: s.index, value: v });
  };

  useShortcuts((e) => {
    if (!s?.choices || !canAnswer) return false;
    const i = choiceKey(e.key);
    if (i < 0 || i >= s.choices.length) return false;
    send(s.choices[i]);
    return true;
  });

  if (!s || s.phase === "lobby") {
    return (
      <div className="arc-stage">
        <RoomLobby room={room} gameId={GAME_ID} title={room.host ? `${room.host.name}'s trivia` : "Trivia night"} canStart={false} onLeave={leave}>
          {s && <p className="arc-tv-lobbyline">{s.total} questions · {s.seconds} s each</p>}
        </RoomLobby>
      </div>
    );
  }

  const rows = rankScores(s.scores, s.names);
  const me = rows.find((r) => r.id === room.me.id);

  if (s.phase === "ended") {
    return (
      <div className="arc-stage arc-tv-end">
        <RoomBar room={room} onLeave={leave} />
        <p className="arc-kicker">Final scores</p>
        {me && (
          <p className="arc-tv-sub">
            You finished <b>#{me.rank}</b> with <b className="num">{fmt(me.score)}</b> points.
          </p>
        )}
        <Podium rows={rows} meId={room.me.id} />
        {down && (
          <button type="button" className="btn pri" onClick={leave}>
            Back to Arcade
          </button>
        )}
      </div>
    );
  }

  const result = s.reveal?.results[room.me.id];
  const answerIndex = s.reveal && s.choices ? s.choices.indexOf(s.reveal.answer) : -1;
  const picked = s.choices && myAnswer !== null ? s.choices.indexOf(myAnswer) : -1;
  const given = result?.given ?? myAnswer;

  return (
    <div className="arc-stage arc-tv-pad">
      <RoomBar room={room} onLeave={leave} />
      {down && (
        <p className="arc-tv-down" role="alert">
          {room.error ?? "The room closed."}{" "}
          <button type="button" className="btn sm" onClick={leave}>
            Leave
          </button>
        </p>
      )}
      <QuestionHead index={s.index} total={s.total} category={s.category} topic={s.topic} difficulty={s.difficulty} />
      <Timer leftMs={s.phase === "question" ? left : 0} totalMs={s.seconds * 1000} />
      {s.question && <h2 className="arc-big sm arc-tv-q">{s.question}</h2>}

      {s.choices ? (
        <Choices
          choices={s.choices}
          onPick={canAnswer ? (i) => send(s.choices![i]) : undefined}
          stateOf={(i) => {
            if (s.reveal) return i === answerIndex ? "correct" : i === picked ? "wrong" : "dim";
            if (locked) return i === picked ? "picked" : "dim";
            return undefined;
          }}
        />
      ) : s.phase === "question" && !locked ? (
        <form
          className="arc-guess"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            className="arc-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer"
            aria-label="Your answer"
            maxLength={MAX_ANSWER_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={s.phase !== "question" || left === 0 || down}
          />
          <button type="submit" className="btn pri" disabled={!canAnswer || !text.trim()}>
            Send
          </button>
        </form>
      ) : null}

      {s.phase === "question" && (
        <p className="arc-tv-status" role="status">
          {confirmed ? (
            <>
              Locked in{myAnswer && !s.choices ? <>: <b>{myAnswer}</b></> : ""}. Waiting for the others ({s.answered.length}).
            </>
          ) : pending ? (
            "Sending…"
          ) : reconnecting ? (
            "Host reconnecting… you can answer again when they're back."
          ) : left === 0 ? (
            "Time's up."
          ) : note ? (
            <span className="arc-tv-warn">{note}</span>
          ) : (
            "Answer before the time runs out. Faster = more points."
          )}
        </p>
      )}

      {s.reveal && (
        <div className="arc-tv-reveal arc-reveal" key={s.index} aria-live="polite">
          <p className={"arc-verdict " + (result?.correct ? "ok" : "bad")}>{result ? (result.correct ? `Right! +${fmt(result.points)}` : "Not quite") : "No answer"}</p>
          {!s.choices && given && !result?.correct && <p className="arc-tv-sub">You said: {given}</p>}
          {(!s.choices || !result?.correct) && (
            <p className="arc-tv-answer">
              <span className="arc-tv-label">Answer</span>
              {s.reveal.answer}
            </p>
          )}
          {s.reveal.fact && <p className="arc-tv-fact">{s.reveal.fact}</p>}
          {me && (
            <p className="arc-tv-status">
              You: <b className="num">{fmt(me.score)}</b> points, #{me.rank} of {rows.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

