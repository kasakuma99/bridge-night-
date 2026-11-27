import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Pencil, Plus, Save, Trash2 } from "lucide-react";
import type { TriviaCategory, TriviaQuestion, TriviaSettings } from "./types";
import { QUESTIONS } from "./questions";
import { deleteTriviaQuestion, saveTriviaQuestion, saveTriviaSettings } from "./data";
import {
  ANSWER_MAX,
  CATEGORY_IDS,
  CATEGORY_LABEL,
  DIFFICULTY_LABEL,
  FACT_MAX,
  LETTERS,
  QUESTION_MAX,
  QUESTION_SOFT_MAX,
  TOPIC_MAX,
  draftFromQuestion,
  emptyDraft,
  validateDraft,
  type QuestionDraft,
} from "./logic";

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Saving failed. Try again.");

/** Admin-only "Trivia settings": custom questions, categories on/off, "What we like" notes. The database checks admin too. */
export default function Admin({ questions, settings, loading, onBack }: { questions: TriviaQuestion[]; settings: TriviaSettings; loading: boolean; onBack: () => void }) {
  const [editing, setEditing] = useState<QuestionDraft | null>(null);
  const [filter, setFilter] = useState<TriviaCategory | "all">("all");

  const builtInCounts = useMemo(() => countBy(QUESTIONS), []);
  const customCounts = useMemo(() => countBy(questions), [questions]);
  const shown = filter === "all" ? questions : questions.filter((q) => q.category === filter);

  if (editing) return <QuestionForm initial={editing} onDone={() => setEditing(null)} />;

  return (
    <div className="arc-tv-admin">
      <header className="arc-tv-adminhead">
        <button type="button" className="btn ghost sm" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <h2 className="arc-tv-title">Trivia settings</h2>
        <span className="arc-tv-badge">Admins only</span>
      </header>

      <CategorySwitches settings={settings} builtIn={builtInCounts} custom={customCounts} />

      <section className="arc-tv-card" aria-labelledby="tv-custom-h">
        <div className="arc-tv-cardhead">
          <h3 id="tv-custom-h">
            Your questions <span className="num">({questions.length})</span>
          </h3>
          <button type="button" className="btn pri sm" onClick={() => setEditing(emptyDraft(filter === "all" ? "league" : filter))}>
            <Plus /> New question
          </button>
        </div>
        <p className="arc-tv-hint">They mix in with the built-in questions in Solo and Versus. The built-in ones live in the code.</p>
        {questions.length > 0 && (
          <label className="arc-tv-inline">
            Show
            <select value={filter} onChange={(e) => setFilter(e.target.value as TriviaCategory | "all")}>
              <option value="all">All categories</option>
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]} ({customCounts[c] ?? 0})
                </option>
              ))}
            </select>
          </label>
        )}
        {loading ? (
          <p className="arc-tv-hint">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="arc-tv-hint">{questions.length === 0 ? "No custom questions yet." : "None in this category."}</p>
        ) : (
          <ul className="arc-tv-qlist">
            {shown.map((q) => (
              <QuestionRow key={q.id} q={q} onEdit={() => setEditing(draftFromQuestion(q))} />
            ))}
          </ul>
        )}
      </section>

      <Notes settings={settings} />
    </div>
  );
}

function countBy(list: readonly TriviaQuestion[]): Partial<Record<TriviaCategory, number>> {
  const out: Partial<Record<TriviaCategory, number>> = {};
  for (const q of list) out[q.category] = (out[q.category] ?? 0) + 1;
  return out;
}

/* ---------- categories on / off ---------- */

function CategorySwitches({ settings, builtIn, custom }: { settings: TriviaSettings; builtIn: Partial<Record<TriviaCategory, number>>; custom: Partial<Record<TriviaCategory, number>> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggle = async (c: TriviaCategory) => {
    const off = settings.disabled.includes(c);
    const disabled = off ? settings.disabled.filter((x) => x !== c) : [...settings.disabled, c];
    if (disabled.length >= CATEGORY_IDS.length) {
      setError("Keep at least one category on.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveTriviaSettings({ ...settings, disabled });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="arc-tv-card" aria-labelledby="tv-cat-h">
      <h3 id="tv-cat-h">Categories</h3>
      <p className="arc-tv-hint">Switched-off categories don't show in the setup for anyone.</p>
      <ul className="arc-tv-switches">
        {CATEGORY_IDS.map((c) => {
          const on = !settings.disabled.includes(c);
          const n = (builtIn[c] ?? 0) + (custom[c] ?? 0);
          return (
            <li key={c}>
              <label className={"arc-tv-switch" + (on ? " is-on" : "")}>
                <input type="checkbox" checked={on} disabled={busy} onChange={() => void toggle(c)} />
                <span className="arc-tv-switch-name">{CATEGORY_LABEL[c]}</span>
                <span className="arc-tv-switch-n num" title={`${builtIn[c] ?? 0} built in, ${custom[c] ?? 0} custom`}>
                  {n}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="arc-tv-err" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/* ---------- "What we like" ---------- */

function Notes({ settings }: { settings: TriviaSettings }) {
  const [text, setText] = useState(settings.notes);
  const [base, setBase] = useState(settings.notes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  // Pick up a newer value from the server unless the admin is typing.
  if (settings.notes !== base && text === base) {
    setBase(settings.notes);
    setText(settings.notes);
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    try {
      await saveTriviaSettings({ ...settings, notes: text.trim().slice(0, 2000) });
      setBase(text.trim().slice(0, 2000));
      setState("saved");
    } catch (err) {
      setError(errText(err));
      setState("error");
    }
  };
  return (
    <form className="arc-tv-card" aria-labelledby="tv-notes-h" onSubmit={save}>
      <h3 id="tv-notes-h">What we like</h3>
      <label className="arc-tv-hint" htmlFor="tv-notes">
        Tell us what to write more of: e.g. more Arcane, fewer esports. Whoever writes the next batch reads this.
      </label>
      <textarea
        id="tv-notes"
        rows={5}
        maxLength={2000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (state !== "saving") setState("idle");
        }}
        placeholder="More Arcane and 2000s music, fewer esports dates…"
      />
      <div className="arc-tv-formfoot">
        {state === "saved" && <span className="arc-tv-ok" role="status">Saved.</span>}
        {state === "error" && (
          <span className="arc-tv-err" role="alert">
            {error}
          </span>
        )}
        <button type="submit" className="btn pri sm" disabled={state === "saving" || text.trim() === base.trim()}>
          <Save /> {state === "saving" ? "Saving…" : "Save notes"}
        </button>
      </div>
    </form>
  );
}

/* ---------- list row ---------- */

function QuestionRow({ q, onEdit }: { q: TriviaQuestion; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const del = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    try {
      await deleteTriviaQuestion(q.id);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <li>
      <div className="arc-tv-qrow-text">
        <b>{q.question}</b>
        <span>
          {q.answer} · {CATEGORY_LABEL[q.category]} · {q.topic} · {DIFFICULTY_LABEL[q.difficulty]}
          {q.choices ? " · 4 choices" : ""}
        </span>
        {error && (
          <span className="arc-tv-err" role="alert">
            {error}
          </span>
        )}
      </div>
      <button type="button" className="btn ghost sm" onClick={onEdit} aria-label={`Edit: ${q.question}`}>
        <Pencil /> Edit
      </button>
      <button type="button" className={"btn sm " + (confirm ? "red" : "ghost")} onClick={() => void del()} onBlur={() => setConfirm(false)} disabled={busy} aria-label={confirm ? "Really delete" : `Delete: ${q.question}`}>
        <Trash2 /> {confirm ? "Sure?" : "Delete"}
      </button>
    </li>
  );
}

/* ---------- add / edit form ---------- */

function Count({ n, soft, max }: { n: number; soft?: number; max: number }) {
  // Shows the hard limit; above `soft` it turns gold (a warning, not a cap), above `max` red (refused).
  return (
    <span className={"arc-tv-count" + (n > max ? " is-bad" : soft && n > soft ? " is-warn" : "")} title={soft ? `Up to ${soft} reads best on stream, ${max} at most` : undefined}>
      {n}/{max}
    </span>
  );
}

function QuestionForm({ initial, onDone }: { initial: QuestionDraft; onDone: () => void }) {
  const [d, setD] = useState(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const check = useMemo(() => validateDraft(d), [d]);
  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const err = (f: keyof typeof check.errors) => (tried ? check.errors[f] : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!check.value) return;
    setBusy(true);
    setError("");
    try {
      await saveTriviaQuestion(check.value);
      onDone();
    } catch (e2) {
      setError(errText(e2));
      setBusy(false);
    }
  };

  const field = ({ id, label, error: e, warn, children, extra }: { id: string; label: string; error?: string; warn?: string; children: ReactNode; extra?: ReactNode }) => (
    <div className={"arc-tv-ffield" + (e ? " is-bad" : "")}>
      <label htmlFor={id}>
        {label} {extra}
      </label>
      {children}
      {e ? (
        <p className="arc-tv-err" id={id + "-msg"}>
          {e}
        </p>
      ) : warn ? (
        <p className="arc-tv-warn" id={id + "-msg"}>
          {warn}
        </p>
      ) : null}
    </div>
  );

  return (
    <form className="arc-tv-admin" onSubmit={submit} noValidate>
      <header className="arc-tv-adminhead">
        <button type="button" className="btn ghost sm" onClick={onDone}>
          <ArrowLeft /> Cancel
        </button>
        <h2 className="arc-tv-title">{d.id ? "Edit question" : "New question"}</h2>
      </header>

      <section className="arc-tv-card arc-tv-form">
        <div className="arc-tv-frow">
          {field({
            id: "tvq-cat",
            label: "Category",
            error: err("category"),
            children: (
              <select id="tvq-cat" value={d.category} onChange={(e) => set("category", e.target.value as TriviaCategory)}>
                {CATEGORY_IDS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            ),
          })}
          {field({
            id: "tvq-topic",
            label: "Topic",
            error: err("topic"),
            extra: <Count n={d.topic.trim().length} max={TOPIC_MAX} />,
            children: <input id="tvq-topic" value={d.topic} onChange={(e) => set("topic", e.target.value)} placeholder="lore, 80s, capitals…" maxLength={TOPIC_MAX + 10} />,
          })}
          <div className="arc-tv-ffield" role="group" aria-labelledby="tvq-diff-l">
            <span id="tvq-diff-l" className="arc-tv-flabel">
              Difficulty
            </span>
            <div className="arc-tv-seg">
              {([1, 2, 3] as const).map((v) => (
                <button key={v} type="button" aria-pressed={d.difficulty === v} onClick={() => set("difficulty", v)}>
                  {DIFFICULTY_LABEL[v]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {field({
          id: "tvq-q",
          label: "Question",
          error: err("question"),
          warn: check.warnings.question,
          extra: <Count n={d.question.trim().length} soft={QUESTION_SOFT_MAX} max={QUESTION_MAX} />,
          children: (
            <textarea id="tvq-q" rows={2} value={d.question} onChange={(e) => set("question", e.target.value)} maxLength={QUESTION_MAX + 20} aria-describedby="tvq-q-msg" />
          ),
        })}

        {field({
          id: "tvq-a",
          label: "Answer",
          error: err("answer"),
          children: <input id="tvq-a" value={d.answer} onChange={(e) => set("answer", e.target.value)} maxLength={ANSWER_MAX + 10} aria-describedby="tvq-a-msg" />,
        })}

        <label className="arc-tv-check">
          <input type="checkbox" checked={d.multipleChoice} onChange={(e) => set("multipleChoice", e.target.checked)} />
          Multiple choice (4 options)
        </label>

        {d.multipleChoice ? (
          <div className={"arc-tv-ffield" + (err("choices") ? " is-bad" : "")} role="group" aria-label="Choices">
            <span className="arc-tv-flabel">Choices (one must be the answer; the order is shuffled in the game)</span>
            <div className="arc-tv-choicegrid">
              {d.choices.map((c, i) => (
                <label key={i} className={c.trim() && c.trim().toLowerCase() === d.answer.trim().toLowerCase() ? "is-answer" : undefined}>
                  <b>{LETTERS[i]}</b>
                  <input
                    value={c}
                    maxLength={ANSWER_MAX + 10}
                    onChange={(e) => {
                      const next = [...d.choices] as QuestionDraft["choices"];
                      next[i] = e.target.value;
                      set("choices", next);
                    }}
                    aria-label={`Choice ${LETTERS[i]}`}
                  />
                </label>
              ))}
            </div>
            {d.answer.trim() && !d.choices.some((c) => c.trim()) && (
              <button type="button" className="arc-tv-link" onClick={() => set("choices", [d.answer, "", "", ""])}>
                Put the answer in A
              </button>
            )}
            {err("choices") && <p className="arc-tv-err">{err("choices")}</p>}
          </div>
        ) : (
          field({
            id: "tvq-acc",
            label: "Other spellings that count (one per line, optional)",
            error: err("accept"),
            children: <textarea id="tvq-acc" rows={3} value={d.accept} onChange={(e) => set("accept", e.target.value)} placeholder={"UK\nGreat Britain"} />,
          })
        )}

        {field({
          id: "tvq-fact",
          label: "Fun fact after the reveal (optional)",
          error: err("fact"),
          extra: <Count n={d.fact.trim().length} max={FACT_MAX} />,
          children: <textarea id="tvq-fact" rows={2} value={d.fact} onChange={(e) => set("fact", e.target.value)} maxLength={FACT_MAX + 20} />,
        })}

        <p className="arc-tv-hint">Open answers are checked forgivingly: case, accents, punctuation, a leading "the" and small typos in longer answers don't matter.</p>

        <div className="arc-tv-formfoot">
          {tried && !check.value && (
            <span className="arc-tv-err" role="alert">
              Fix the marked fields first.
            </span>
          )}
          {error && (
            <span className="arc-tv-err" role="alert">
              {error}
            </span>
          )}
          <button type="button" className="btn ghost" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn pri" disabled={busy}>
            <Save /> {busy ? "Saving…" : d.id ? "Save changes" : "Add question"}
          </button>
        </div>
      </section>
    </form>
  );
}
