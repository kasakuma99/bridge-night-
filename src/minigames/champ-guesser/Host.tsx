/* Versus, host side. This browser picks the champions, runs the clock, checks every guess and sends the public state.
   The answer lives only in refs here; the room only ever gets VsState (see logic.ts), whose pictures are drawn steps. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDDragon } from "../../data/context";
import { useHostRoom } from "../room";
import { RoomBar, RoomLobby } from "../room/RoomLobby";
import { ArtCache, prepareMode, snapshot, type Art } from "./art";
import {
  HINT_SPEEDS,
  HOST_SAVE_KEY,
  MODE_LABEL,
  WRONG_COST,
  champPoints,
  hueShiftFor,
  makeHostSave,
  parseHostSave,
  resolveGuess,
  shuffled,
  vsAddPlayers,
  vsAllDone,
  vsEnd,
  vsGuess,
  vsIsLastRound,
  vsLobby,
  vsSettingsOf,
  vsParticipants,
  vsPass,
  vsReveal,
  vsSetStep,
  vsSettings,
  vsStartRound,
  vsStatus,
  vsStepAt,
  vsTimedOut,
  type Champ,
  type HostSave,
  type Mode,
  type Rules,
  type VsAction,
  type VsGuessResult,
  type VsPlayer,
  type VsSettings,
  type VsState,
} from "./logic";
import { ArtView, GuessBox, StepDots, useTicker } from "./shared";
import { EndView, RevealInfo, RoundLine, Scoreboard, SettingsView, TimerBar } from "./VersusViews";
import "./champ-guesser.css";

const GAME_ID = "champ-guesser";
const MAX_FAILS = 6;
const titleFor = (mode: Mode) => `Champion guesser · ${MODE_LABEL[mode]}`;
const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

const store = () => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};
const readSave = () => parseHostSave(store()?.getItem(HOST_SAVE_KEY) ?? null);
const writeSave = (s: HostSave) => {
  try {
    store()?.setItem(HOST_SAVE_KEY, JSON.stringify(s));
  } catch {
    /* full or blocked: a refresh just won't resume */
  }
};
export const clearHostSave = () => {
  try {
    store()?.removeItem(HOST_SAVE_KEY);
  } catch {
    /* ignore */
  }
};
const roomPhase = (p: VsState["phase"]) => (p === "lobby" ? "lobby" : p === "end" ? "ended" : "playing");

/** Actions come from other browsers: check the shape before trusting them. */
function validAction(a: unknown): a is VsAction {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  if (typeof x.round !== "number") return false;
  return (x.type === "guess" && typeof x.name === "string" && x.name.length <= 60) || x.type === "pass";
}

/**
 * `resume`: this tab was hosting before a refresh (the room engine kept the code), so pick the saved game back up.
 * Otherwise any old save is dropped and a new lobby opens.
 */
export default function VersusHost({ mode: initialMode, rules: initialRules = "classic", resume, onBack, onPlay }: { mode: Mode; rules?: Rules; resume: boolean; onBack: () => void; onPlay: () => void }) {
  const { dd } = useDDragon();
  const [saved] = useState<HostSave | null>(() => {
    if (resume) return readSave();
    clearHostSave();
    return null;
  });
  // The title is fixed for the hook (it opens the room once); later changes go through setPhase.
  const [openTitle] = useState(() => titleFor(saved?.vs.mode ?? initialMode));
  const room = useHostRoom<VsState, VsAction>(GAME_ID, openTitle);
  const cache = useMemo(() => new ArtCache(), []);
  useEffect(() => () => cache.clear(), [cache]);

  const [vs, setVs] = useState<VsState>(() => saved?.vs ?? vsLobby({ mode: initialMode, rules: initialRules, rounds: initialRules === "skips" ? 10 : 5, stepMs: HINT_SPEEDS.normal, hostPlays: true }));
  const vsRef = useRef(vs);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });

  /** Keep the whole private game in sessionStorage, so a refresh carries on (see `resume`). */
  const persist = useCallback(() => {
    writeSave(makeHostSave(vsRef.current, queue.current, pos.current, answer.current, hueRef.current, elapsed.current));
  }, []);

  /** Every change goes through here: local copy, render, out to the room, and saved for a refresh. */
  const commit = useCallback(
    (next: VsState) => {
      if (next === vsRef.current) return;
      vsRef.current = next;
      setVs(next);
      roomRef.current.setState(next);
      persist();
    },
    [persist],
  );

  // Private: never put these in the state.
  const answer = useRef<Champ | null>(saved?.answer ?? null);
  const queue = useRef<Champ[]>(saved?.queue ?? []);
  const pos = useRef(saved?.pos ?? 0);
  const seed = useRef(newSeed());
  const elapsed = useRef(saved?.elapsed ?? 0);
  const hueRef = useRef(saved?.hue ?? 0);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const [art, setArt] = useState<Art | null>(null);
  const [hue, setHue] = useState(saved?.hue ?? 0);
  const [shownElapsed, setShownElapsed] = useState(saved?.elapsed ?? 0);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: "bad" | "good" | "info" } | null>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Send the current state as soon as the room is open (late joiners get the latest one from the room).
  useEffect(() => {
    if (room.status !== "open") return;
    room.setState(vsRef.current);
    room.setPhase(roomPhase(vsRef.current.phase), titleFor(vsRef.current.mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status]);

  // The clock runs in a ref; save it when the page goes away (refresh, tab closed, hidden).
  useEffect(() => {
    persist();
    const save = () => persist();
    const onVis = () => document.hidden && persist();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [persist]);

  // Back after a refresh: bring the game frame into view again.
  useEffect(() => {
    if (saved) onPlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a refresh mid-game: reload the current champion's art and redraw the step the room is on.
  useEffect(() => {
    const champ = saved?.answer;
    if (!champ || (saved.vs.phase !== "round" && saved.vs.phase !== "reveal")) return;
    let live = true;
    cache
      .get(champ)
      .then((a) => {
        if (!live) return;
        prepareMode(a, vsRef.current.mode);
        setArt(a);
        const s = vsRef.current;
        if (s.phase === "round") {
          const step = vsStepAt(s, elapsed.current);
          const snap = snapshot(a, s.mode, step, hueRef.current);
          commit(vsSetStep(s, step, elapsed.current, snap.image, snap.pixelated));
        }
        const ahead = queue.current[pos.current];
        if (ahead) cache.get(ahead).catch(() => {});
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = useCallback(() => {
    const s = vsRef.current;
    if (s.phase !== "round" || !answer.current) return;
    commit(vsReveal(s, answer.current, participants()));
    setMsg(null);
  }, [commit]);

  const participants = () => vsParticipants(roomRef.current.players, roomRef.current.me?.id, vsRef.current.hostPlays);

  // New people get a name and a score; someone leaving can finish the round.
  useEffect(() => {
    const s = vsAddPlayers(vsRef.current, room.players.map((p) => ({ id: p.id, name: p.name })));
    commit(s);
    if (vsAllDone(s, participants())) reveal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.players, commit, reveal]);

  /** Apply a guess or pass from anyone (the host's own too). */
  const handle = (from: VsPlayer, a: VsAction): VsGuessResult => {
    const s = vsRef.current;
    if (s.phase !== "round" || a.round !== s.round || !answer.current) return "ignored";
    let next: VsState;
    let result: VsGuessResult = "ignored";
    if (a.type === "guess") {
      const r = vsGuess(s, answer.current, dd.champions, from, a.name, elapsed.current);
      next = r.state;
      result = r.result;
    } else next = vsPass(s, from.id);
    commit(next);
    if (vsAllDone(next, participants())) reveal();
    return result;
  };
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });

  useEffect(
    () =>
      room.onAction((from, a) => {
        if (from.id === roomRef.current.me?.id || !validAction(a)) return;
        handleRef.current({ id: from.id, name: from.name }, a);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.onAction],
  );

  /** The next champion whose art loads (skips broken images). */
  const loadNext = async (): Promise<{ champ: Champ; art: Art } | null> => {
    let fails = 0;
    while (fails < MAX_FAILS && pos.current < queue.current.length) {
      const c = queue.current[pos.current++];
      try {
        const a = await cache.get(c);
        prepareMode(a, vsRef.current.mode);
        return { champ: c, art: a };
      } catch {
        fails++;
      }
    }
    return null;
  };

  const startRound = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setLoadError(false);
    const got = await loadNext();
    busyRef.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (!got) {
      setLoadError(true);
      return;
    }
    const h = hueShiftFor(seed.current + pos.current);
    answer.current = got.champ;
    hueRef.current = h;
    elapsed.current = 0;
    setShownElapsed(0);
    setHue(h);
    setArt(got.art);
    setMsg(null);
    const snap = snapshot(got.art, vsRef.current.mode, 0, h);
    commit(vsStartRound(vsRef.current, snap.image, snap.pixelated));
    const ahead = queue.current[pos.current];
    if (ahead) cache.get(ahead).catch(() => {});
  };

  const start = () => {
    seed.current = newSeed();
    queue.current = shuffled(dd.champions, seed.current);
    pos.current = 0;
    room.setPhase("playing", titleFor(vsRef.current.mode));
    onPlay();
    void startRound();
  };

  useTicker(vs.phase === "round" && !!art, 200, (dt) => {
    elapsed.current += dt;
    setShownElapsed(elapsed.current);
    const s = vsRef.current;
    if (vsTimedOut(s, elapsed.current)) return reveal();
    const step = vsStepAt(s, elapsed.current);
    if (step !== s.step && art) {
      const snap = snapshot(art, s.mode, step, hue);
      commit(vsSetStep(s, step, elapsed.current, snap.image, snap.pixelated));
    }
  });

  const next = () => {
    const s = vsRef.current;
    if (s.phase !== "reveal" || busyRef.current) return;
    if (vsIsLastRound(s)) end();
    else void startRound();
  };
  const end = () => {
    answer.current = null;
    commit(vsEnd(vsRef.current));
    room.setPhase("ended");
  };
  const again = () => {
    const s = vsRef.current;
    commit(vsLobby(vsSettingsOf(s), s.names));
    setArt(null);
    room.setPhase("lobby", titleFor(s.mode));
  };
  const leave = () => {
    clearHostSave();
    room.leave();
    onBack();
  };
  const change = (patch: Partial<VsSettings>) => {
    const before = vsRef.current.mode;
    commit(vsSettings(vsRef.current, patch));
    if (patch.mode && patch.mode !== before) room.setPhase("lobby", titleFor(patch.mode));
  };

  // The host's own guesses: checked right here, same rules as everyone else.
  const me: VsPlayer | null = room.me ? { id: room.me.id, name: room.me.name } : null;
  const myGuess = (text: string) => {
    if (!me) return "unknown" as const;
    const hit = resolveGuess(text, dd.champions);
    if (!hit) {
      setMsg({ text: `"${text.trim()}" isn't a champion`, tone: "info" });
      return "unknown" as const;
    }
    const r = handle(me, { type: "guess", round: vsRef.current.round, name: hit.name });
    if (r === "right") {
      const h = vsRef.current.reveal?.hits.find((x) => x.id === me.id) ?? vsRef.current.hits.find((x) => x.id === me.id);
      setMsg({ text: vsRef.current.rules === "skips" ? "Got it!" : `Got it! +${h?.points ?? 0}`, tone: "good" });
      return "right" as const;
    }
    if (r === "wrong") {
      const skips = vsRef.current.rules === "skips";
      setMsg({ text: vsStatus(vsRef.current, me.id) === "out" ? `Not ${hit.name}. Out of guesses for this one${skips ? " (a skip)" : ""}.` : skips ? `Not ${hit.name}` : `Not ${hit.name} (−${WRONG_COST})`, tone: "bad" });
      return "wrong" as const;
    }
    return "unknown" as const;
  };
  const myPass = () => {
    if (me) handle(me, { type: "pass", round: vsRef.current.round });
  };

  // Host keys (not while typing): N next champion, S skip / reveal now.
  const keys = useRef({ next, reveal });
  useEffect(() => {
    keys.current = { next, reveal };
  });
  useEffect(() => {
    if (vs.phase !== "round" && vs.phase !== "reveal") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "n") keys.current.next();
      else if (k === "s") keys.current.reveal();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vs.phase]);

  useEffect(() => {
    if (vs.phase === "reveal") nextBtn.current?.focus({ preventScroll: true });
  }, [vs.phase]);

  const others = room.players.filter((p) => p.id !== room.me?.id).length;
  const live = room.players.map((p) => p.id);

  if (vs.phase === "lobby")
    return (
      <div className="arc-stage arc-cg">
        <RoomLobby
          room={room}
          gameId={GAME_ID}
          title={titleFor(vs.mode)}
          canStart={others >= 1 && !busy && room.status === "open"}
          onStart={start}
          onLeave={leave}
          startHint={busy ? "Loading the first champion…" : others < 1 ? "Waiting for at least one more player" : undefined}
        >
          <SettingsView vs={vs} onChange={change} />
        </RoomLobby>
        {loadError && <p className="arc-cg-msg bad">Champion art didn't load. Check the connection and press Start again.</p>}
      </div>
    );

  if (vs.phase === "end")
    return (
      <div className="arc-stage arc-cg arc-cg-vs">
        <RoomBar room={room} onLeave={leave} />
        <EndView vs={vs} version={dd.version} meId={vs.hostPlays ? room.me?.id : undefined} hostId={room.me?.id}>
          <button className="btn pri" onClick={again} autoFocus>
            New game
          </button>
          <button className="btn ghost" onClick={leave}>
            Close room
          </button>
        </EndView>
      </div>
    );

  const steps = vs.steps;
  const revealed = vs.phase === "reveal";
  const myStatus = me ? vsStatus(vs, me.id) : "out";
  const left = revealed ? 0 : 1 - shownElapsed / vs.limit;
  const worth = champPoints(vs.step, steps, 0, vs.mode);
  return (
    <div className="arc-stage arc-cg arc-cg-vs arc-cg-fill">
      <RoomBar room={room} onLeave={leave} />
      <div className="arc-cg-vsgrid">
        <div className="arc-cg-show">
          <RoundLine vs={vs}>
            <StepDots mode={vs.mode} step={revealed ? steps - 1 : vs.step} />
          </RoundLine>
          {loadError ? (
            <div className="arc-cg-picbox">
              <div className="arc-cg-frame">
                <div className="arc-cg-loading">
                  <span>{revealed ? "Champion art didn't load. Check the connection, then press Next." : "Champion art didn't load. Press Skip to reveal and go on."}</span>
                </div>
              </div>
            </div>
          ) : (
            <ArtView art={art} mode={vs.mode} step={vs.step} revealed={revealed} hue={hue} loading={!art} big />
          )}
          {revealed && vs.reveal ? (
            <RevealInfo result={vs.reveal} names={vs.names} steps={steps} players={participants().length} />
          ) : (
            <>
              {vs.rules !== "skips" && (
                <div className="arc-cg-meta">
                  <TimerBar left={left} />
                  <span className="arc-cg-worth num">worth {worth}</span>
                </div>
              )}
              {vs.hostPlays && me && myStatus === "guessing" ? (
                <>
                  <p className={`arc-cg-msg ${msg?.tone ?? ""}`} aria-live="polite">
                    {msg?.text ?? " "}
                  </p>
                  <GuessBox key={vs.round} champions={dd.champions} onGuess={myGuess} onSkip={myPass} skipLabel="Pass" />
                </>
              ) : (
                <p className={`arc-cg-msg ${msg?.tone ?? ""}`} aria-live="polite">
                  {msg?.text ?? (vs.hostPlays ? "You passed. Waiting for the others…" : "Who's that champion?")}
                </p>
              )}
            </>
          )}
        </div>
        <div className="arc-cg-side">
          <Scoreboard vs={vs} live={live} meId={vs.hostPlays ? room.me?.id : undefined} hostId={room.me?.id} />
          <div className="arc-hostbar inline arc-cg-hostbar">
            <button type="button" onClick={reveal} disabled={revealed} title="S">
              Skip
            </button>
            <button ref={nextBtn} type="button" className="pri" onClick={next} disabled={!revealed || busy} title="N">
              {busy ? "Loading…" : vsIsLastRound(vs) && revealed ? "See results" : "Next champion"}
            </button>
            <button type="button" onClick={end}>
              End
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
