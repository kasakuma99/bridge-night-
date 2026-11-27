import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Settings2 } from "lucide-react";
import type { MinigameProps } from "../types";
import type { TriviaCategory, TriviaQuestion } from "./types";
import { QUESTIONS } from "./questions";
import { useTriviaAdmin } from "./data";
import { useAuth } from "../../data/context";
import {
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  SOLO_COUNT,
  SOLO_SECONDS,
  categoryCounts,
  enabledCategories,
  filterQuestions,
  markSeen,
  mergeQuestions,
  parseSavedHost,
  parseSeen,
  parseSetup,
  pickQuestions,
  rng,
  roundPlan,
  unseenCount,
  type DifficultyFilter,
  type Mode,
  type Setup,
  type VsGame,
} from "./logic";
import { newSeed, readLocal, readSession, writeLocal, writeSession } from "./ui";
import Solo from "./Solo";
import { HOST_GAME_KEY, VersusHost, VersusPlayer, hostRoomSaved } from "./Versus";
import Admin from "./Admin";
import "./trivia.css";

const SEEN_KEY = "bn-trivia-seen";
const SETUP_KEY = "bn-trivia-setup";

function loadSetup(): Setup {
  try {
    return parseSetup(JSON.parse(readLocal(SETUP_KEY) ?? "null"));
  } catch {
    return parseSetup(null);
  }
}

type View =
  | { k: "setup" }
  | { k: "solo"; questions: TriviaQuestion[]; seed: number; round: number }
  | { k: "host"; setup: Setup; initial: VsGame | null }
  | { k: "join"; code: string }
  | { k: "admin" };

/** First screen: a join link joins; a refresh while hosting goes back to the room with the game as it was. */
function firstView(joinCode: string | null): View {
  if (joinCode) return { k: "join", code: joinCode };
  const saved = hostRoomSaved() ? parseSavedHost(readSession(HOST_GAME_KEY)) : null;
  if (saved) return { k: "host", setup: saved.setup, initial: saved.game };
  writeSession(HOST_GAME_KEY, null);
  return { k: "setup" };
}

export default function TriviaGame({ onScore, onExit, onPlay, joinCode }: MinigameProps) {
  const admin = useTriviaAdmin();
  const { isAdmin } = useAuth();
  const all = useMemo(() => mergeQuestions(QUESTIONS, admin.questions), [admin.questions]);
  const disabled = admin.settings.disabled;
  const [setup, setSetup] = useState(loadSetup);
  const [view, setView] = useState<View>(() => firstView(joinCode));

  // Solo round, room lobby or joining starts: the page scrolls the game frame into view.
  const onPlayRef = useRef(onPlay);
  useEffect(() => {
    onPlayRef.current = onPlay;
  });
  const playKey = view.k === "solo" ? `solo-${view.round}` : view.k === "host" || view.k === "join" ? view.k : "";
  useEffect(() => {
    if (playKey) onPlayRef.current?.();
  }, [playKey]);

  useEffect(() => writeLocal(SETUP_KEY, JSON.stringify(setup)), [setup]);
  // Opened with another ?room=CODE while mounted.
  const [lastJoin, setLastJoin] = useState(joinCode);
  if (joinCode !== lastJoin) {
    setLastJoin(joinCode);
    if (joinCode) setView({ k: "join", code: joinCode });
  }

  /** Picks a round for these settings, preferring questions not seen on this device, and remembers them. */
  const pick = useCallback(
    (s: Setup): TriviaQuestion[] => {
      const pool = filterQuestions(all, s, disabled);
      const picked = pickQuestions(pool, roundPlan(s).count, new Set(parseSeen(readLocal(SEEN_KEY))), rng(newSeed()));
      writeLocal(
        SEEN_KEY,
        JSON.stringify(
          markSeen(
            parseSeen(readLocal(SEEN_KEY)),
            picked.map((q) => q.id),
            pool.map((q) => q.id),
          ),
        ),
      );
      return picked;
    },
    [all, disabled],
  );

  const toSetup = () => setView({ k: "setup" });
  const round = useRef(0);
  const startSolo = (s: Setup) => {
    const questions = pick(s);
    round.current += 1;
    setView({ k: "solo", questions, seed: newSeed(), round: round.current });
  };
  const start = (s: Setup) => {
    setSetup(s);
    if (s.mode === "solo") startSolo(s);
    else setView({ k: "host", setup: s, initial: null });
  };
  const saveScore = useCallback((total: number) => onScore("trivia-solo", total), [onScore]);

  return <div className="arc-tv">{screen()}</div>;

  function screen() {
    switch (view.k) {
      case "solo":
        return <Solo key={view.round} questions={view.questions} seed={view.seed} onScore={saveScore} onAgain={() => startSolo(setup)} onSetup={toSetup} />;
      case "host": {
        const s = view.setup;
        const plan = roundPlan(s);
        return (
          <VersusHost
            setup={s}
            initial={view.initial}
            title={roomTitle(s.categories, disabled)}
            summary={summaryLine(s, plan)}
            seconds={plan.seconds}
            pick={() => pick(s)}
            onLeave={toSetup}
            onPlay={() => onPlayRef.current?.()}
          />
        );
      }
      case "join":
        return <VersusPlayer code={view.code} onLeave={onExit} />;
      case "admin":
        // Only admins see it; the database checks it again on every save.
        if (isAdmin) return <Admin questions={admin.questions} settings={admin.settings} loading={admin.loading} onBack={toSetup} />;
        return <SetupScreen setup={setup} all={all} disabled={disabled} isAdmin={false} onStart={start} onExit={onExit} onAdmin={toSetup} />;
      default:
        return <SetupScreen setup={setup} all={all} disabled={disabled} isAdmin={isAdmin} onStart={start} onExit={onExit} onAdmin={() => setView({ k: "admin" })} />;
    }
  }
}

function roomTitle(cats: readonly TriviaCategory[], disabled: readonly TriviaCategory[]): string {
  const on = cats.filter((c) => !disabled.includes(c));
  const all = enabledCategories(disabled);
  if (on.length === all.length || on.length === 0) return "Trivia night · All categories";
  if (on.length <= 2) return "Trivia night · " + on.map((c) => CATEGORY_SHORT[c]).join(", ");
  return `Trivia night · ${on.length} categories`;
}

function summaryLine(s: Setup, plan: { count: number; seconds: number }): string {
  const diff = s.difficulty === "any" ? "any difficulty" : ["", "easy", "medium", "hard"][s.difficulty];
  return `${plan.count} questions · ${plan.seconds} s each · ${diff}`;
}

/* ---------- setup ---------- */

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="arc-tv-field" role="group" aria-label={label}>
      <span className="arc-tv-label">{label}</span>
      <div className="arc-tv-seg">
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SetupScreen({
  setup: initial,
  all,
  disabled,
  isAdmin,
  onStart,
  onExit,
  onAdmin,
}: {
  setup: Setup;
  all: TriviaQuestion[];
  disabled: TriviaCategory[];
  isAdmin: boolean;
  onStart: (s: Setup) => void;
  onExit: () => void;
  onAdmin: () => void;
}) {
  const [s, setS] = useState(initial);
  const [seenTick, setSeenTick] = useState(0);
  const set = <K extends keyof Setup>(k: K, v: Setup[K]) => setS((x) => ({ ...x, [k]: v }));

  const enabled = useMemo(() => enabledCategories(disabled), [disabled]);
  const pickedKey = s.categories.filter((c) => enabled.includes(c)).join();
  const picked = useMemo(() => (pickedKey ? (pickedKey.split(",") as TriviaCategory[]) : []), [pickedKey]);
  const counts = useMemo(() => categoryCounts(all, s.difficulty, disabled), [all, s.difficulty, disabled]);
  const pool = useMemo(() => filterQuestions(all, { categories: picked, difficulty: s.difficulty }, disabled), [all, picked, s.difficulty, disabled]);
  // seenTick forces a re-read after "reset seen questions".
  const fresh = useMemo(() => unseenCount(pool, new Set(parseSeen(readLocal(SEEN_KEY)))), [pool, seenTick]);
  const plan = roundPlan(s);
  const allOn = enabled.length > 0 && enabled.every((c) => picked.includes(c));

  const toggleCat = (c: TriviaCategory) => set("categories", picked.includes(c) ? picked.filter((x) => x !== c) : enabled.filter((x) => x === c || picked.includes(x)));
  const need = s.mode === "solo" ? SOLO_COUNT : 1;
  const canStart = pool.length >= need;
  const startState: Setup = { ...s, categories: picked };

  return (
    <div className="arc-tv-setup">
      <header className="arc-tv-head">
        <div>
          <h2 className="arc-tv-title">Trivia night</h2>
          <p className="arc-tv-sub">{s.mode === "solo" ? "10 questions, 20 seconds each. Right answers score 500, plus up to 500 for speed." : "Open a room, stream your screen on Discord. Friends join on the site and answer on their own device."}</p>
        </div>
        {isAdmin && (
          <button type="button" className="btn ghost sm" onClick={onAdmin}>
            <Settings2 /> Trivia settings
          </button>
        )}
      </header>

      <div className="arc-tv-modes" role="group" aria-label="Mode">
        {(
          [
            ["solo", "Solo", "Play alone for the leaderboard"],
            ["versus", "Versus", "A live room with friends"],
          ] as const
        ).map(([m, name, text]) => (
          <button key={m} type="button" className="arc-tv-mode" aria-pressed={s.mode === m} onClick={() => set("mode", m as Mode)}>
            <b>{name}</b>
            <span>{text}</span>
          </button>
        ))}
      </div>

      <section className="arc-tv-card" aria-labelledby="tv-cats-h">
        <div className="arc-tv-cardhead">
          <span className="arc-tv-label" id="tv-cats-h">
            Categories <span className="num">({picked.length} of {enabled.length})</span>
          </span>
          <button type="button" className="arc-tv-link" onClick={() => set("categories", allOn ? [] : [...enabled])}>
            {allOn ? "Clear" : "Pick all"}
          </button>
        </div>
        <div className="arc-tv-chips arc-tv-cats">
          {enabled.map((c) => (
            <button key={c} type="button" aria-pressed={picked.includes(c)} onClick={() => toggleCat(c)} disabled={counts[c] === 0 && !picked.includes(c)}>
              {picked.includes(c) && <Check aria-hidden />}
              {CATEGORY_LABEL[c]}
              <span className="arc-tv-n num" aria-label={`${counts[c]} questions`}>
                {counts[c]}
              </span>
            </button>
          ))}
        </div>
        {enabled.length === 0 && <p className="arc-tv-hint">All categories are switched off right now.</p>}
      </section>

      <section className="arc-tv-card arc-tv-opts" aria-label="Options">
        <Seg<DifficultyFilter> label="Difficulty" value={s.difficulty} onChange={(v) => set("difficulty", v)} options={[[1, "Easy"], [2, "Medium"], [3, "Hard"], ["any", "Any"]]} />
        {s.mode === "versus" ? (
          <>
            <Seg label="Questions" value={s.count} onChange={(v) => set("count", v)} options={[[10, "10"], [20, "20"], [30, "30"]]} />
            <Seg label="Answer time" value={s.seconds} onChange={(v) => set("seconds", v)} options={[[15, "15 s"], [20, "20 s"], [30, "30 s"]]} />
          </>
        ) : (
          <p className="arc-tv-hint arc-tv-fixed">
            Solo is always {SOLO_COUNT} questions with {SOLO_SECONDS} s each, so the leaderboard is fair.
          </p>
        )}
      </section>

      <p className="arc-tv-match" aria-live="polite">
        {all.length === 0 ? (
          "No questions yet. They are still being written."
        ) : picked.length === 0 ? (
          "Pick at least one category."
        ) : pool.length === 0 ? (
          "No questions match. Try another category or difficulty."
        ) : (
          <>
            <b className="num">{pool.length}</b> questions match, <b className="num">{fresh}</b> not seen on this device yet.
            {s.mode === "solo" && pool.length < SOLO_COUNT && <> Solo needs at least {SOLO_COUNT}: pick more categories or any difficulty.</>}
            {s.mode === "versus" && pool.length < plan.count && <> This game will have {pool.length}.</>}
          </>
        )}{" "}
        <button
          type="button"
          className="arc-tv-link"
          onClick={() => {
            writeLocal(SEEN_KEY, null);
            setSeenTick((t) => t + 1);
          }}
        >
          Reset seen questions
        </button>
      </p>

      <div className="arc-tv-actions">
        <button type="button" className="btn ghost" onClick={onExit}>
          <ArrowLeft /> Back to Arcade
        </button>
        <button type="button" className="btn pri" disabled={!canStart} onClick={() => onStart(startState)}>
          {s.mode === "solo" ? "Start solo" : `Open a room (${Math.min(plan.count, pool.length)} questions)`}
        </button>
      </div>
    </div>
  );
}
