import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { CATEGORY_LABEL, CATEGORY_SHORT, DIFFICULTY_LABEL, LETTERS, countdownLeft, isControlTarget, isTypingTarget, podium, type Ranked } from "./logic";
import type { TriviaCategory } from "./types";

/* Small pieces shared by Solo, Versus host and Versus player. */

/* ---------- storage (every access wrapped: private mode and full storage must not break the game) ---------- */

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

/* ---------- time ---------- */

export function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * Milliseconds left until `endsAt` (a Date.now() time). Ticks only while the tab is visible and time is left;
 * after the tab comes back it jumps to the right value. 0 when endsAt is 0.
 */
export function useCountdown(endsAt: number): number {
  const visible = usePageVisible();
  const [now, setNow] = useState(() => Date.now());
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  const running = visible && endsAt > 0 && endsAt > now;
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [running, endsAt]);
  // A new deadline or coming back to the tab: read the clock once.
  useEffect(() => {
    if (visible) setNow(Date.now());
  }, [visible, endsAt]);
  return left;
}

/**
 * Player side: counts down from `msLeft` (sent by the host) starting when that state arrived, using performance.now(),
 * so a phone clock that is off doesn't matter. `stamp` changes with every state that arrives (the state object).
 */
export function useArrivalCountdown(msLeft: number, stamp: unknown): number {
  const visible = usePageVisible();
  const base = useRef<{ at: number; msLeft: number; stamp: unknown } | null>(null);
  const [now, setNow] = useState(() => performance.now());
  if (base.current === null) base.current = { at: now, msLeft, stamp };
  useEffect(() => {
    if (base.current && base.current.stamp === stamp && base.current.msLeft === msLeft) return;
    const t = performance.now();
    base.current = { at: t, msLeft, stamp };
    setNow(t);
  }, [stamp, msLeft]);
  const left = countdownLeft(base.current.msLeft, base.current.at, now);
  const running = visible && left > 0;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (visible) setNow(performance.now());
  }, [visible]);
  return left;
}

export function Timer({ leftMs, totalMs }: { leftMs: number; totalMs: number }) {
  const secs = Math.ceil(leftMs / 1000);
  const f = totalMs > 0 ? Math.max(0, Math.min(1, leftMs / totalMs)) : 0;
  return (
    <div className="arc-tv-timer">
      <div
        className={"arc-timer" + (secs <= 5 ? " low" : "")}
        style={{ "--arc-left": f } as CSSProperties}
        role="progressbar"
        aria-label="Time left"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalMs / 1000)}
        aria-valuenow={secs}
        aria-valuetext={leftMs === 0 ? "Time is up" : `${secs} seconds left`}
      >
        <i />
      </div>
      <span className={"arc-tv-secs num" + (secs <= 5 ? " is-low" : "")} aria-hidden>
        {leftMs === 0 ? "0" : secs}
      </span>
    </div>
  );
}

/* ---------- question parts ---------- */

export function QuestionHead({ index, total, category, topic, difficulty }: { index: number; total: number; category: TriviaCategory | null; topic?: string; difficulty?: 1 | 2 | 3 }) {
  return (
    <div className="arc-tv-top">
      <span className="arc-kicker">
        Question {index + 1} of {total}
      </span>
      {category && (
        <span className={"arc-tv-chip is-" + category}>
          {CATEGORY_SHORT[category]}
          {topic && ![CATEGORY_SHORT[category], CATEGORY_LABEL[category]].some((l) => l.toLowerCase() === topic.toLowerCase()) ? ` · ${topic}` : ""}
          {difficulty ? ` · ${DIFFICULTY_LABEL[difficulty]}` : ""}
        </span>
      )}
    </div>
  );
}

export type ChoiceState = "picked" | "correct" | "wrong" | "dim" | undefined;

/** The 4 answer tiles. `stateOf` decides the look of each; `onPick` undefined = not clickable. */
export function Choices({ choices, stateOf, onPick, disabled }: { choices: string[]; stateOf: (i: number) => ChoiceState; onPick?: (i: number) => void; disabled?: boolean }) {
  return (
    <div className="arc-choices arc-tv-choices" role={onPick ? "group" : "list"} aria-label="Choices">
      {choices.map((c, i) => {
        const st = stateOf(i);
        return (
          <button
            key={c}
            type="button"
            role={onPick ? undefined : "listitem"}
            className="arc-choice"
            data-state={st}
            disabled={disabled || !onPick}
            aria-pressed={onPick ? st === "picked" : undefined}
            aria-label={`${LETTERS[i]}: ${c}${st === "correct" ? ", correct" : st === "wrong" ? ", wrong" : ""}`}
            onClick={onPick ? () => onPick(i) : undefined}
          >
            <b>{st === "correct" ? <Check aria-hidden /> : st === "wrong" ? <X aria-hidden /> : LETTERS[i]}</b>
            <span>{c}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- keyboard ---------- */

/**
 * Window shortcuts. `handle` returns true when it used the key. Ignored while typing, with modifier keys,
 * and for Enter/Space on a keyboard-focused button or link (it keeps its own click). After a mouse click the button
 * stays focused but isn't :focus-visible, so Space/Enter shortcuts still work then.
 */
export function useShortcuts(handle: (e: KeyboardEvent) => boolean) {
  const ref = useRef(handle);
  useEffect(() => {
    ref.current = handle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t)) return;
      const activates = e.key === " " || e.code === "Space" || e.key === "Enter";
      if (activates && isControlTarget(t) && t?.matches?.(":focus-visible")) return;
      if (ref.current(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/* ---------- podium ---------- */

export function Podium({ rows, unit = "pts", meId }: { rows: Ranked[]; unit?: string; meId?: string }) {
  const top = podium(rows);
  // Top three as plain rows, 1st first. Ties share a row.
  const steps = ([1, 2, 3] as const).map((rank) => ({ rank, people: top.filter((r) => r.rank === rank) })).filter((s) => s.people.length > 0);
  return (
    <>
      <div className="arc-tv-podium">
        {steps.map((s) => (
          <div key={s.rank} className={"arc-tv-step is-" + s.rank}>
            <div className="arc-tv-names">
              {s.people.map((p) => (
                <span key={p.id} className={p.id === meId ? "is-me" : undefined}>
                  {p.name}
                </span>
              ))}
            </div>
            <div className="arc-tv-block">
              <span className="arc-tv-place num">{s.rank}</span>
              <span className="arc-tv-pts num">
                {s.people[0].score.toLocaleString("en-US")} {unit}
              </span>
            </div>
          </div>
        ))}
      </div>
      {rows.length > 3 && (
        <ol className="arc-standings arc-tv-final">
          {rows.map((r) => (
            <li key={r.id} className={r.rank === 1 ? "lead" : r.id === meId ? "arc-tv-me" : undefined} value={r.rank}>
              <span>{r.name}</span>
              <b>{r.score.toLocaleString("en-US")}</b>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export const fmt = (n: number) => n.toLocaleString("en-US");
