import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { drawStep, type Art } from "./art";
import { MODE_STEPS, suggest, type Champ, type Mode } from "./logic";

/** false while the tab is hidden, so timers can stop. */
export function useVisible() {
  const [v, setV] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const f = () => setV(!document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return v;
}

/** Calls `tick(ms since last tick)` every `every` ms while `on` and the tab is visible. */
export function useTicker(on: boolean, every: number, tick: (dt: number) => void) {
  const visible = useVisible();
  const cb = useRef(tick);
  useEffect(() => {
    cb.current = tick;
  });
  useEffect(() => {
    if (!on || !visible) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      // Cap the step so a throttled background tab can't jump ahead.
      cb.current(Math.min(1000, now - last));
      last = now;
    }, every);
    return () => clearInterval(id);
  }, [on, visible, every]);
}

/** The picture: a canvas showing one reveal step, or a spinner while loading. */
export function ArtView({ art, mode, step, revealed, hue, loading, label }: { art: Art | null; mode: Mode; step: number; revealed: boolean; hue: number; loading: boolean; label?: string; big?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && art) drawStep(ref.current, art, mode, step, revealed, hue);
  }, [art, mode, step, revealed, hue]);
  // The box takes the height that's left in the stage; the 4:3 picture fits inside it.
  return (
    <div className="arc-cg-picbox">
      <div className={`arc-cg-frame${revealed ? " revealed" : ""}`}>
        <canvas ref={ref} key={revealed ? "clear" : "hidden"} className={`arc-cg-canvas${revealed ? " arc-reveal" : ""}`} role="img" aria-label={revealed && art ? `Splash art of ${art.champ.name}` : "Hidden champion art"} hidden={!art || loading} />
        {(loading || !art) && (
          <div className="arc-cg-loading" role="status">
            <span className="arc-cg-spin" aria-hidden="true" />
            <span>Loading champion…</span>
          </div>
        )}
        {label && art && !loading && <div className="arc-cg-badge">{label}</div>}
      </div>
    </div>
  );
}

/** Small dots showing how far the reveal has gone. */
export function StepDots({ mode, step }: { mode: Mode; step: number }) {
  const n = MODE_STEPS[mode].length;
  return (
    <div className="arc-cg-dots" aria-label={`Hint ${step + 1} of ${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={i <= step ? "on" : ""} />
      ))}
    </div>
  );
}

/** Text box with champion-name autocomplete. Enter guesses, arrows pick, Tab completes, Esc clears (then skips on an empty box). */
export function GuessBox({
  champions,
  onGuess,
  onSkip,
  disabled,
  badKey = 0,
  skipLabel = "Skip",
}: {
  champions: Champ[];
  onGuess: (text: string) => "right" | "wrong" | "unknown";
  onSkip: () => void;
  disabled?: boolean;
  /** Bump to show the "wrong" shake from outside (Versus: the host's answer arrives later). */
  badKey?: number;
  skipLabel?: string;
}) {
  const [text, setText] = useState("");
  const [hi, setHi] = useState(-1);
  const [shake, setShake] = useState(0);
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const list = suggest(text, champions, 6);
  const open = list.length > 0 && !(list.length === 1 && list[0].name.toLowerCase() === text.trim().toLowerCase());

  // Focus without scrolling the page (autoFocus would jump to the box); again after the "wrong" shake remounts it.
  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true });
  }, [disabled, shake]);
  useEffect(() => {
    if (!badKey) return;
    setShake((s) => s + 1);
    setBad(true);
  }, [badKey]);
  useEffect(() => {
    if (!bad) return;
    const t = setTimeout(() => setBad(false), 600);
    return () => clearTimeout(t);
  }, [bad, shake]);

  const submit = (value: string) => {
    if (!value.trim() || disabled) return;
    const r = onGuess(value);
    if (r === "wrong") {
      setText("");
      setShake((s) => s + 1);
      setBad(true);
    } else if (r === "right") setText("");
    setHi(-1);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHi((h) => (h + 1) % list.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHi((h) => (h <= 0 ? list.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit(open && hi >= 0 ? list[hi].name : text);
    } else if (e.key === "Tab" && open && !e.shiftKey) {
      e.preventDefault();
      setText(list[Math.max(0, hi)].name);
      setHi(-1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setHi(-1);
      // First Esc clears what you typed (and closes the list); Esc on an empty box skips.
      if (text) setText("");
      else onSkip();
    }
  };

  return (
    <div className="arc-guess arc-cg-guess">
      <div className="arc-cg-combo">
        <input
          ref={input}
          key={shake}
          className={`arc-input arc-cg-input${bad ? " bad" : ""}`}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            setHi(-1);
          }}
          onKeyDown={onKey}
          placeholder="Type a champion…"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-label="Your guess"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hi >= 0 ? `${listId}-${hi}` : undefined}
        />
        {open && !disabled && (
          <ul id={listId} role="listbox" className="arc-cg-list">
            {list.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                className={i === hi ? "on" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  submit(c.name);
                }}
              >
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="arc-cg-actions">
        <button type="button" className="btn pri" disabled={disabled || !text.trim()} onClick={() => submit(hi >= 0 && open ? list[hi].name : text)}>
          Guess
        </button>
        <button type="button" className="btn ghost" disabled={disabled} onClick={onSkip} title={`${skipLabel} (Esc on an empty box)`}>
          {skipLabel}
        </button>
      </div>
    </div>
  );
}
