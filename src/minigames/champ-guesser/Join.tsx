/* Versus, player side: shows the host's state and sends guesses. Knows nothing the other players don't. */
import { useEffect, useRef, useState } from "react";
import { useDDragon } from "../../data/context";
import { useJoinRoom } from "../room";
import { RoomBar, RoomLobby } from "../room/RoomLobby";
import { MODE_LABEL, WRONG_COST, champPoints, resolveGuess, vsStatus, type VsAction, type VsState } from "./logic";
import { GuessBox, StepDots, useTicker } from "./shared";
import { EndView, Notice, RevealInfo, RoomPicture, RoundLine, Scoreboard, SettingsView, TimerBar } from "./VersusViews";
import "./champ-guesser.css";

const GAME_ID = "champ-guesser";
/** Give up waiting for the host's answer to a guess after this long. */
const PENDING_MS = 3000;

export default function VersusJoin({ code, onExit, onPlay }: { code: string; onExit: () => void; onPlay: () => void }) {
  const { dd } = useDDragon();
  const room = useJoinRoom<VsState, VsAction>(code);
  const vs = room?.state ?? null;
  const meId = room?.me.id;
  const reconnecting = room?.status === "reconnecting";

  // Joining a room: bring the game frame into view (once).
  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    onPlay();
  }, [onPlay]);
  // And again when the host starts the game (the lobby is shorter than the game screen).
  const phase = vs?.phase;
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === "lobby" && phase === "round") onPlay();
    lastPhase.current = phase;
  }, [phase, onPlay]);

  // Timer: the host sends "ms left" with each step; count down locally from when it arrived (no clock sync needed).
  const base = useRef({ at: 0, msLeft: 0 });
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!vs) return;
    base.current = { at: performance.now(), msLeft: vs.msLeft };
    setNow(performance.now());
    // Only a new step/round carries a fresh time; other updates (someone guessed) keep the same msLeft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs?.round, vs?.step, vs?.msLeft, vs?.phase]);
  useTicker(vs?.phase === "round", 250, () => setNow(performance.now()));

  // Guess feedback arrives later, in the state.
  const [pending, setPending] = useState<string | null>(null);
  const [badKey, setBadKey] = useState(0);
  const [msg, setMsg] = useState<{ text: string; tone: "bad" | "good" | "info" } | null>(null);
  const myWrong = (meId && vs?.wrong[meId]) || 0;
  const myStatus = vs && meId ? vsStatus(vs, meId) : "guessing";
  const myHit = vs && meId ? vs.hits.find((h) => h.id === meId) : undefined;
  const prevWrong = useRef(0);

  useEffect(() => {
    setPending(null);
    setMsg(null);
    prevWrong.current = 0;
  }, [vs?.round]);
  useEffect(() => {
    if (myWrong > prevWrong.current) {
      setMsg({ text: pending ? `Not ${pending} (−${WRONG_COST})` : `Wrong (−${WRONG_COST})`, tone: "bad" });
      setBadKey((k) => k + 1);
      setPending(null);
    }
    prevWrong.current = myWrong;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myWrong]);
  useEffect(() => {
    if (myStatus === "right" && myHit) setMsg({ text: `Got it! +${myHit.points}`, tone: "good" });
    else if (myStatus === "out") setMsg((m) => (m?.tone === "bad" && myWrong > 0 ? { text: `${m.text}. Out of guesses for this one.`, tone: "bad" } : { text: "You passed. Waiting for the others…", tone: "info" }));
    if (myStatus !== "guessing") setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myStatus]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const leave = () => {
    room?.leave();
    onExit();
  };

  if (!room || room.status === "connecting")
    return (
      <Notice title={`Joining room ${code}…`} busy>
        <button className="btn ghost" onClick={onExit}>
          Cancel
        </button>
      </Notice>
    );
  if (room.status === "error" || room.status === "closed")
    return (
      <Notice title={room.status === "closed" ? "The room closed" : "Couldn't join the room"} text={room.error}>
        <button className="btn pri" onClick={onExit} autoFocus>
          Back to Arcade
        </button>
      </Notice>
    );
  if (!vs)
    return (
      <div className="arc-stage arc-cg arc-cg-vs">
        <RoomBar room={room} onLeave={leave} />
        <Notice title="Waiting for the host…" busy />
      </div>
    );

  if (vs.phase === "lobby")
    return (
      <div className="arc-stage arc-cg">
        <RoomLobby room={room} gameId={GAME_ID} title={`Champion guesser · ${MODE_LABEL[vs.mode]}`} canStart={false} onLeave={leave} />
        <SettingsView vs={vs} />
      </div>
    );

  const live = room.players.map((p) => p.id);
  if (vs.phase === "end")
    return (
      <div className="arc-stage arc-cg arc-cg-vs">
        <RoomBar room={room} onLeave={leave} />
        <EndView vs={vs} version={dd.version} meId={meId} hostId={room.host?.id}>
          <p className="note">Stay here: the host can start a new game.</p>
          <button className="btn ghost" onClick={leave}>
            Leave room
          </button>
        </EndView>
      </div>
    );

  const revealed = vs.phase === "reveal";
  const left = revealed ? 0 : (base.current.msLeft - (now - base.current.at)) / vs.limit;
  const worth = champPoints(vs.step, vs.steps, myWrong, vs.mode);
  const canGuess = vs.phase === "round" && myStatus === "guessing" && !!vs.image && !reconnecting;

  const onGuess = (text: string) => {
    if (!canGuess || pending) return "unknown" as const;
    const hit = resolveGuess(text, dd.champions);
    if (!hit) {
      setMsg({ text: `"${text.trim()}" isn't a champion`, tone: "info" });
      return "unknown" as const;
    }
    // send() returns false when it can't deliver (host gone for a moment): then don't wait for a verdict.
    const sent: unknown = room.send({ type: "guess", round: vs.round, name: hit.name });
    if (sent === false) {
      setMsg({ text: "Couldn't reach the host. Try again in a moment.", tone: "bad" });
      return "unknown" as const;
    }
    setPending(hit.name);
    setMsg({ text: `${hit.name}…`, tone: "info" });
    // Clears the box; the host's verdict shows up in the state.
    return "right" as const;
  };
  const onPass = () => {
    if (!canGuess) return;
    const sent: unknown = room.send({ type: "pass", round: vs.round });
    if (sent === false) setMsg({ text: "Couldn't reach the host. Try again in a moment.", tone: "bad" });
  };

  return (
    <div className="arc-stage arc-cg arc-cg-vs arc-cg-fill">
      <RoomBar room={room} onLeave={leave} />
      <div className="arc-cg-vsgrid">
        <div className="arc-cg-show">
          <RoundLine vs={vs}>
            <StepDots mode={vs.mode} step={revealed ? vs.steps - 1 : vs.step} />
          </RoundLine>
          <RoomPicture vs={vs} />
          {revealed && vs.reveal ? (
            <RevealInfo result={vs.reveal} names={vs.names} steps={vs.steps} players={live.filter((id) => vs.hostPlays || id !== room.host?.id).length} />
          ) : (
            <>
              {vs.rules !== "skips" && (
                <div className="arc-cg-meta">
                  <TimerBar left={left} />
                  {myStatus === "guessing" && <span className="arc-cg-worth num">worth {worth}</span>}
                </div>
              )}
              <p className={`arc-cg-msg ${reconnecting ? "info" : (msg?.tone ?? "")}`} aria-live="polite">
                {reconnecting ? "Host reconnecting…" : (msg?.text ?? " ")}
              </p>
              {myStatus === "guessing" && <GuessBox key={vs.round} champions={dd.champions} onGuess={onGuess} onSkip={onPass} disabled={!canGuess || !!pending} badKey={badKey} skipLabel={vs.rules === "skips" ? "Skip" : "Pass"} />}
            </>
          )}
          {revealed && <p className="note arc-cg-msg">{reconnecting ? "Host reconnecting…" : "Next champion when the host is ready."}</p>}
        </div>
        <Scoreboard vs={vs} live={live} meId={meId} hostId={room.host?.id} />
      </div>
    </div>
  );
}
