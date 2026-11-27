import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useDDragon } from "../../data/context";
import { champIcon } from "../../lib/champions";
import { ArtCache, prepareMode, type Art } from "./art";
import {
  MAX_ROUND_POINTS,
  RULES_LABEL,
  SKIPS_SIZE,
  SKIP_WRONG,
  TIMED_MS,
  boardFor,
  MODE_LABEL,
  MODE_STEPS,
  ROUND_SIZE,
  STEP_MS,
  HOLD_MS,
  WRONG_COST,
  champPoints,
  hueShiftFor,
  resolveGuess,
  roundTotal,
  shuffled,
  stepAt,
  timedOut,
  type Champ,
  type Mode,
  type Rules,
} from "./logic";
import { ArtView, GuessBox, StepDots, useTicker } from "./shared";
import "./champ-guesser.css";

interface Result {
  champ: Champ;
  points: number;
  guessed: boolean;
  /** Step it was guessed or skipped at. */
  step: number;
}

/** Give up after this many images in a row fail to load. */
const MAX_FAILS = 6;
const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;

const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * One solo run. Starts right away (the rules are on the setup screen).
 * classic: 5 champions, points. timed: as many as you can in 90 s. skips: 10 champions, fewest skips.
 */
export default function Solo({ mode, rules = "classic", onScore, onExit, onSetup }: { mode: Mode; rules?: Rules; onScore: (boardId: string, score: number) => void; onExit: () => void; onSetup: () => void }) {
  const { dd } = useDDragon();
  const steps = MODE_STEPS[mode].length;
  const size = rules === "classic" ? ROUND_SIZE : rules === "skips" ? SKIPS_SIZE : Infinity;
  const [total_ms, setTotalMs] = useState(0);
  const cache = useMemo(() => new ArtCache(), []);
  useEffect(() => () => cache.clear(), [cache]);

  const [phase, setPhase] = useState<"play" | "summary" | "error">("play");
  const [seed, setSeed] = useState(newSeed);
  // The whole list in random order; the round walks along it, so nothing repeats.
  const [queue, setQueue] = useState<Champ[]>(() => shuffled(dd.champions, seed));
  const [pos, setPos] = useState(0);
  const [art, setArt] = useState<Art | null>(null);
  const [status, setStatus] = useState<"loading" | "guess" | "revealed">("loading");
  const [elapsed, setElapsed] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [msg, setMsg] = useState<{ text: string; tone: "bad" | "good" | "info" } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const fails = useRef(0);
  const scored = useRef(false);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const champ = queue[pos];
  const step = stepAt(elapsed, steps);
  const worth = champPoints(step, steps, wrong, mode);
  const hue = hueShiftFor(seed + pos);

  // Load the current champion and preload the next one.
  useEffect(() => {
    if (phase !== "play") return;
    if (!champ) {
      setPhase("error");
      return;
    }
    let live = true;
    setArt(null);
    setStatus("loading");
    cache
      .get(champ)
      .then((a) => {
        if (!live) return;
        prepareMode(a, mode);
        fails.current = 0;
        setArt(a);
        setElapsed(0);
        setWrong(0);
        setStatus("guess");
        const next = queue[pos + 1];
        if (next) cache.get(next).catch(() => {});
      })
      .catch(() => {
        if (!live) return;
        // Broken or blocked image: drop this champion and take the next one in the queue.
        fails.current++;
        if (fails.current >= MAX_FAILS) setPhase("error");
        else setPos((p) => p + 1);
      });
    return () => {
      live = false;
    };
    // phase is only read to skip summary/error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [champ, cache, mode, phase === "summary" || phase === "error"]);

  useTicker(phase === "play" && status === "guess", 200, (dt) => {
    setElapsed((e) => e + dt);
    if (rules === "timed") setTotalMs((t) => t + dt);
  });

  const finish = useCallback(
    (guessed: boolean) => {
      if (status !== "guess" || !champ) return;
      const points = guessed ? champPoints(step, steps, wrong, mode) : 0;
      setResults((r) => [...r, { champ, points, guessed, step }]);
      setStatus("revealed");
      const why = rules === "classic" && elapsed > 0 && timedOut(elapsed, steps) ? "Time's up" : rules === "skips" && wrong >= SKIP_WRONG ? `${SKIP_WRONG} wrong: that's a skip` : "Skipped";
      setMsg(guessed ? { text: rules === "classic" ? `+${points}` : "Got it!", tone: "good" } : { text: why, tone: "info" });
    },
    [status, champ, step, steps, wrong, mode, elapsed, rules],
  );

  // Classic: each champion has its own clock. The other rules keep the clearest picture up until you guess or skip.
  useEffect(() => {
    if (rules === "classic" && phase === "play" && status === "guess" && timedOut(elapsed, steps)) finish(false);
  }, [elapsed, steps, phase, status, finish, rules]);
  // Skips: too many wrong names count as a skip.
  useEffect(() => {
    if (rules === "skips" && status === "guess" && wrong >= SKIP_WRONG) finish(false);
  }, [rules, status, wrong, finish]);
  // Timed: the run ends when the big clock runs out.
  const timeUp = rules === "timed" && total_ms >= TIMED_MS;
  useEffect(() => {
    if (timeUp && phase === "play") setPhase("summary");
  }, [timeUp, phase]);
  // Timed: no Next button, the next champion comes right away.
  useEffect(() => {
    if (rules !== "timed" || status !== "revealed" || phase !== "play") return;
    const t = setTimeout(() => setPos((p) => p + 1), 900);
    return () => clearTimeout(t);
  }, [rules, status, phase]);

  useEffect(() => {
    if (status === "revealed") nextBtn.current?.focus({ preventScroll: true });
  }, [status]);

  const onGuess = (text: string) => {
    if (!champ) return "unknown" as const;
    const hit = resolveGuess(text, queue);
    if (!hit) {
      setMsg({ text: `"${text.trim()}" isn't a champion`, tone: "info" });
      return "unknown" as const;
    }
    if (hit.id === champ.id) {
      finish(true);
      return "right" as const;
    }
    setWrong((w) => w + 1);
    setMsg({ text: rules === "classic" ? `Not ${hit.name} (−${WRONG_COST})` : rules === "skips" ? `Not ${hit.name} (${wrong + 1}/${SKIP_WRONG})` : `Not ${hit.name}`, tone: "bad" });
    return "wrong" as const;
  };

  const next = () => {
    setMsg(null);
    if (results.length >= size) setPhase("summary");
    else setPos((p) => p + 1);
  };

  const total = roundTotal(results.map((r) => r.points));
  const named = results.filter((r) => r.guessed).length;
  const skipped = results.length - named;
  const score = rules === "timed" ? named : rules === "skips" ? skipped : total;

  useEffect(() => {
    if (phase === "summary" && !scored.current) {
      scored.current = true;
      onScore(boardFor(mode, rules), score);
    }
  }, [phase, score, onScore, mode, rules]);

  const again = () => {
    const s = newSeed();
    const played = new Set(results.map((r) => r.champ.id));
    const q = shuffled(dd.champions, s);
    setSeed(s);
    // Last round's champions go to the back, so a new round shows new faces.
    setQueue([...q.filter((c) => !played.has(c.id)), ...q.filter((c) => played.has(c.id))]);
    setPos(0);
    setResults([]);
    setTotalMs(0);
    setMsg(null);
    scored.current = false;
    fails.current = 0;
    setPhase("play");
  };

  if (phase === "error")
    return (
      <div className="arc-stage arc-cg arc-cg-card">
        <h2 className="arc-cg-title">Couldn't load champion art</h2>
        <p className="sub">The splash images didn't load. Check your connection and try again.</p>
        <div className="arc-cg-row">
          <button className="btn pri" onClick={again}>
            Try again
          </button>
          <button className="btn ghost" onClick={onExit}>
            Back to Arcade
          </button>
        </div>
      </div>
    );

  if (phase === "summary")
    return (
      <div className="arc-stage arc-cg arc-cg-card">
        <div className="arc-cg-sumhead">
          <span className="arc-kicker">
            {MODE_LABEL[mode]} · {RULES_LABEL[rules]}
          </span>
          <h2 className="arc-cg-title">{rules === "timed" ? "Time's up" : "Round over"}</h2>
          <div className="arc-score arc-cg-total">
            {score}
            <small>
              {rules === "timed" ? (named === 1 ? "champion named" : "champions named") : rules === "skips" ? `${skipped === 1 ? "skip" : "skips"} / ${results.length}` : `/ ${MAX_ROUND_POINTS} points`}
            </small>
          </div>
        </div>
        <ol className="arc-cg-summary">
          {results.map((r) => {
            const icon = champIcon(dd.version, r.champ.id);
            return (
              <li key={r.champ.id} className={r.guessed ? "" : "miss"}>
                {icon ? <img src={icon} alt="" width={40} height={40} loading="lazy" /> : <span className="arc-cg-letter">{r.champ.name[0]}</span>}
                <span className="arc-cg-name">{r.champ.name}</span>
                <span className="arc-cg-when">{r.guessed ? `hint ${r.step + 1}/${steps}` : rules === "classic" ? "missed" : "skipped"}</span>
                <span className="arc-cg-pts num">{rules === "classic" ? r.points : r.guessed ? "✓" : "–"}</span>
              </li>
            );
          })}
        </ol>
        <div className="arc-cg-row">
          <button className="btn pri" onClick={again} autoFocus>
            Play again
          </button>
          <button className="btn ghost" onClick={onSetup}>
            Change mode
          </button>
          <button className="btn ghost" onClick={onExit}>
            Back to Arcade
          </button>
        </div>
      </div>
    );

  const limit = steps * STEP_MS + HOLD_MS;
  const left = rules === "timed" ? Math.max(0, 1 - total_ms / TIMED_MS) : status === "guess" ? Math.max(0, 1 - elapsed / limit) : 0;
  return (
    <div className="arc-stage arc-cg arc-cg-fill">
      <div className="arc-cg-top">
        {rules === "timed" ? (
          <span className="arc-kicker arc-cg-count">
            Named <b className="num">{named}</b> · <b className="num">{clock(TIMED_MS - total_ms)}</b> left
          </span>
        ) : (
          <span className="arc-kicker arc-cg-count">
            Champion <b className="num">{Math.min(results.length + (status === "revealed" ? 0 : 1), size)}</b> / {size}
          </span>
        )}
        <span className="arc-cg-score num">{rules === "classic" ? `${total} pts` : rules === "skips" ? `${skipped} ${skipped === 1 ? "skip" : "skips"}` : RULES_LABEL[rules]}</span>
      </div>
      <ArtView art={art} mode={mode} step={step} revealed={status === "revealed"} hue={hue} loading={status === "loading"} />
      <div className="arc-cg-meta">
        <StepDots mode={mode} step={status === "revealed" ? steps - 1 : step} />
        {rules !== "skips" && (
          <div className={`arc-timer arc-cg-timer${left < 0.25 && (status === "guess" || rules === "timed") ? " low" : ""}`} role="progressbar" aria-label="Time left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left * 100)} style={{ "--arc-left": left } as CSSProperties}>
            <i />
          </div>
        )}
        <span className="arc-cg-worth num" aria-live="off">
          {status === "guess" && rules === "classic" ? `worth ${worth}` : status === "guess" && rules === "skips" && wrong > 0 ? `${SKIP_WRONG - wrong} wrong left` : " "}
        </span>
      </div>
      <p className={`arc-cg-msg ${msg?.tone ?? ""}`} aria-live="polite">
        {status === "revealed" && champ ? (
          <>
            It was <b>{champ.name}</b>. {msg?.text}
          </>
        ) : (
          (msg?.text ?? " ")
        )}
      </p>
      {status === "revealed" && rules !== "timed" ? (
        <div className="arc-cg-row">
          <button ref={nextBtn} className="btn pri" onClick={next}>
            {results.length >= size ? "See results" : "Next champion"}
          </button>
        </div>
      ) : (
        <GuessBox champions={queue} onGuess={onGuess} onSkip={() => finish(false)} disabled={status !== "guess"} />
      )}
    </div>
  );
}
