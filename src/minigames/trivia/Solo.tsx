import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Flag, RotateCcw, Settings2, X } from "lucide-react";
import type { TriviaQuestion } from "./types";
import { SOLO_SECONDS, choiceKey, isCorrect, shuffleChoices, soloTotal, speedPoints, MAX_ANSWER_LENGTH, type SoloResult } from "./logic";
import { Choices, QuestionHead, Timer, fmt, useCountdown, useShortcuts } from "./ui";

const TOTAL_MS = SOLO_SECONDS * 1000;

/** One solo round: 10 questions, 20 s each, 500 + up to 500 speed points per right answer. */
export default function Solo({
  questions,
  seed,
  onScore,
  onAgain,
  onSetup,
}: {
  questions: TriviaQuestion[];
  seed: number;
  onScore: (total: number) => void;
  onAgain: () => void;
  onSetup: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<SoloResult[]>([]);
  const [endsAt, setEndsAt] = useState(() => Date.now() + TOTAL_MS);
  const [text, setText] = useState("");
  const [confirmQuit, setConfirmQuit] = useState(false);
  const done = results.length >= questions.length && questions.length > 0;
  const q = questions[Math.min(index, questions.length - 1)];
  const result = results[index] as SoloResult | undefined;
  const revealed = !!result;
  const { choices, answerIndex } = useMemo(() => shuffleChoices(q, seed), [q, seed]);
  const left = useCountdown(revealed || done ? 0 : endsAt);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const answer = (given: string) => {
    if (revealed || done) return;
    const leftMs = Math.max(0, endsAt - Date.now());
    const correct = leftMs > 0 && isCorrect(q, given);
    setResults((r) => (r.length === index ? [...r, { id: q.id, given, correct, points: speedPoints(correct, leftMs, TOTAL_MS) }] : r));
  };

  // Time is up: counts as wrong.
  useEffect(() => {
    if (revealed || done || left > 0) return;
    if (Date.now() < endsAt) return;
    setResults((r) => (r.length === index ? [...r, { id: q.id, given: "", correct: false, points: 0 }] : r));
  }, [left, revealed, done, endsAt, index, q.id]);

  const next = () => {
    if (!revealed) return;
    if (index + 1 >= questions.length) {
      setIndex(questions.length); // done
      return;
    }
    setIndex((i) => i + 1);
    setText("");
    setEndsAt(Date.now() + TOTAL_MS);
  };

  // Focus: the text box on open questions, the Next button after the reveal.
  useEffect(() => {
    if (done) return;
    if (revealed) nextBtn.current?.focus({ preventScroll: true });
    else if (choices.length === 0) input.current?.focus({ preventScroll: true });
  }, [revealed, done, index, choices.length]);

  // Save the score once.
  const total = soloTotal(results);
  const saved = useRef(false);
  const finished = done && index >= questions.length;
  useEffect(() => {
    if (!finished || saved.current) return;
    saved.current = true;
    onScore(total);
  }, [finished, total, onScore]);

  useEffect(() => {
    if (!confirmQuit) return;
    const t = window.setTimeout(() => setConfirmQuit(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmQuit]);

  useShortcuts((e) => {
    if (finished) return false;
    if (!revealed && choices.length > 0) {
      const i = choiceKey(e.key);
      if (i >= 0 && i < choices.length) {
        answer(choices[i]);
        return true;
      }
    }
    if (revealed && (e.key === "Enter" || e.key === "ArrowRight")) {
      next();
      return true;
    }
    return false;
  });

  if (finished) return <Summary questions={questions} results={results} total={total} onAgain={onAgain} onSetup={onSetup} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) answer(text);
  };

  return (
    <div className="arc-stage arc-tv-solo">
      <QuestionHead index={index} total={questions.length} category={q.category} topic={q.topic} difficulty={q.difficulty} />
      <Timer leftMs={revealed ? 0 : left} totalMs={TOTAL_MS} />
      <h2 className={"arc-big arc-tv-q" + (q.question.length > 60 ? " sm" : "")}>{q.question}</h2>

      {choices.length > 0 ? (
        <Choices
          choices={choices}
          onPick={revealed ? undefined : (i) => answer(choices[i])}
          stateOf={(i) => {
            if (!revealed) return undefined;
            if (i === answerIndex) return "correct";
            if (choices[i] === result?.given) return "wrong";
            return "dim";
          }}
        />
      ) : (
        <form className="arc-guess" onSubmit={submit}>
          <input
            ref={input}
            className={"arc-input" + (revealed ? (result?.correct ? " ok" : " bad") : "")}
            value={revealed ? result?.given || "" : text}
            onChange={(e) => setText(e.target.value)}
            placeholder={revealed ? "No answer" : "Type your answer"}
            aria-label="Your answer"
            maxLength={MAX_ANSWER_LENGTH}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={revealed}
          />
          {!revealed && (
            <button type="submit" className="btn pri" disabled={!text.trim()}>
              Answer
            </button>
          )}
        </form>
      )}

      {revealed && result && (
        <div className="arc-tv-reveal arc-reveal" aria-live="polite" key={index}>
          <p className={"arc-verdict " + (result.correct ? "ok" : "bad")}>
            {result.correct ? `Right! +${fmt(result.points)}` : result.given ? "Not quite" : "Time's up"}
          </p>
          {(!result.correct || choices.length === 0) && (
            <p className="arc-tv-answer">
              <span className="arc-tv-label">Answer</span>
              {q.answer}
            </p>
          )}
          {q.fact && <p className="arc-tv-fact">{q.fact}</p>}
        </div>
      )}

      <div className="arc-hostbar inline arc-tv-solobar">
        <span className="arc-tv-running num" aria-label={`Score ${total}`}>
          {fmt(total)} <small>points</small>
        </span>
        {!revealed && (
          <button type="button" className="btn ghost sm" onClick={() => answer("")}>
            Skip
          </button>
        )}
        {revealed && (
          <button ref={nextBtn} type="button" className="btn pri" onClick={next}>
            {index + 1 >= questions.length ? "See score" : "Next"} <ArrowRight />
          </button>
        )}
        <button type="button" className={"btn sm " + (confirmQuit ? "red" : "ghost")} onClick={() => (confirmQuit ? onSetup() : setConfirmQuit(true))}>
          <Flag /> {confirmQuit ? "Quit? No score" : "Quit"}
        </button>
      </div>
      {!revealed && choices.length > 0 && <p className="arc-tv-hint arc-tip">Click or press A-D (or 1-4).</p>}
    </div>
  );
}

function Summary({ questions, results, total, onAgain, onSetup }: { questions: TriviaQuestion[]; results: SoloResult[]; total: number; onAgain: () => void; onSetup: () => void }) {
  const right = results.filter((r) => r.correct).length;
  return (
    <div className="arc-stage arc-tv-summary">
      <p className="arc-kicker">Round over</p>
      <p className="arc-score">
        {fmt(total)}
        <small>points</small>
      </p>
      <p className="arc-tv-sub">
        {right} of {questions.length} right
      </p>
      <ol className="arc-tv-recap">
        {questions.map((q, i) => {
          const r = results[i];
          return (
            <li key={q.id} className={r?.correct ? "is-right" : "is-wrong"}>
              <span className="arc-tv-mark">{r?.correct ? <Check aria-label="Right" /> : <X aria-label="Wrong" />}</span>
              <span className="arc-tv-recap-q">
                {q.question}
                <small>{q.answer}</small>
              </span>
              <b className="num">{r?.points ? `+${fmt(r.points)}` : "0"}</b>
            </li>
          );
        })}
      </ol>
      <div className="arc-tv-actions">
        <button type="button" className="btn ghost" onClick={onSetup}>
          <Settings2 /> Change settings
        </button>
        <button type="button" className="btn pri" onClick={onAgain}>
          <RotateCcw /> Play again
        </button>
      </div>
    </div>
  );
}

