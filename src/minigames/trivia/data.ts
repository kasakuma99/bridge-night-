import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SAMPLE_MODE, useAuth } from "../../data/context";
import { fetchTrivia, removeTriviaQuestion, writeTriviaQuestion, writeTriviaSettings } from "../../data/arcadeStore";
import { checkTriviaQuestion, checkTriviaSettings, readTriviaQuestion } from "../../lib/arcade";
import { supabase } from "../../lib/supabase";
import type { TriviaQuestion, TriviaSettings } from "./types";

/**
 * Admin-managed trivia: extra questions and settings.
 * - Supabase: public.trivia_questions and public.trivia_settings (20261127100000_arcade_rooms_trivia.sql).
 *   Approved members read, only admins write (RLS); the database checks the same rules as checkTriviaQuestion.
 * - Local mode (no Supabase or `npm run dev:sample`): localStorage "bn-trivia-admin"; the sample "admin" role
 *   (View as, default) can edit, "member" can only read.
 */

export const DEFAULT_TRIVIA_SETTINGS: TriviaSettings = { disabled: [], notes: "" };

/** null = local mode. Same choice as the data store in src/data/context.tsx. */
const sb = supabase && !SAMPLE_MODE ? supabase : null;
const ADMINS_ONLY = "Only admins can change trivia.";

/* ---------- "trivia changed": after a save here, or in another tab (local) ---------- */

let version = 0;
const listeners = new Set<() => void>();
function changed() {
  version++;
  listeners.forEach((f) => f());
}
const onChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const getVersion = () => version;

/* ---------- local mode ---------- */

const LOCAL_KEY = "bn-trivia-admin";
if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === LOCAL_KEY && changed());

interface LocalTrivia {
  questions: unknown[];
  settings: unknown;
}
function readLocal(): { questions: TriviaQuestion[]; settings: TriviaSettings } {
  let raw: Partial<LocalTrivia> = {};
  try {
    raw = (JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") as Partial<LocalTrivia>) ?? {};
  } catch {
    /* broken or no storage: start empty */
  }
  return { questions: readQuestions(raw.questions), settings: readSettings(raw.settings) };
}
function writeLocal(next: { questions: TriviaQuestion[]; settings: TriviaSettings }) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    throw new Error("Could not save in this browser.");
  }
}
/** Same rule as SampleAuth in src/data/context.tsx: no role saved = admin. */
function localAdmin(): boolean {
  try {
    const r = localStorage.getItem("bn-role");
    return r !== "visitor" && r !== "member";
  } catch {
    return true;
  }
}

/* ---------- reading ---------- */

function readQuestions(rows: unknown): TriviaQuestion[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(readTriviaQuestion).filter((q): q is TriviaQuestion => !!q);
}
function readSettings(x: unknown): TriviaSettings {
  const o = (x ?? {}) as Partial<TriviaSettings>;
  try {
    return checkTriviaSettings({ disabled: o.disabled, notes: typeof o.notes === "string" ? o.notes.slice(0, 4000) : "" });
  } catch {
    return DEFAULT_TRIVIA_SETTINGS;
  }
}

const EMPTY: TriviaQuestion[] = [];

/** Admin-added questions and the settings. Refreshes after a save. Empty for people who aren't approved members. */
export function useTriviaAdmin(): { questions: TriviaQuestion[]; settings: TriviaSettings; loading: boolean } {
  const { isMember } = useAuth();
  const v = useSyncExternalStore(onChange, getVersion, getVersion);
  const [got, setGot] = useState<{ v: number; questions: TriviaQuestion[]; settings: TriviaSettings } | null>(null);

  useEffect(() => {
    if (!sb || !isMember) return;
    let live = true;
    fetchTrivia(sb)
      .then((r) => live && setGot({ v, questions: readQuestions(r.questions), settings: readSettings(r.settings) }))
      .catch((e: { message?: string }) => {
        if (!live) return;
        console.error("[bridge-night] could not load trivia settings", e?.message);
        setGot({ v, questions: EMPTY, settings: DEFAULT_TRIVIA_SETTINGS });
      });
    return () => {
      live = false;
    };
  }, [v, isMember]);

  const local = useMemo(() => {
    void v; // read again after a save
    return sb ? null : readLocal();
  }, [v]);

  return useMemo(() => {
    if (local) return isMember ? { ...local, loading: false } : { questions: EMPTY, settings: DEFAULT_TRIVIA_SETTINGS, loading: false };
    if (!isMember) return { questions: EMPTY, settings: DEFAULT_TRIVIA_SETTINGS, loading: false };
    // After a save keep showing the old list until the new one is in, instead of flashing "loading".
    if (!got) return { questions: EMPTY, settings: DEFAULT_TRIVIA_SETTINGS, loading: true };
    return { questions: got.questions, settings: got.settings, loading: false };
  }, [local, got, isMember]);
}

/* ---------- writing (admins only) ---------- */

function newId(): string {
  const c = globalThis.crypto;
  const uuid = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-${uuid.toLowerCase()}`;
}

/** Admin only. New question when id is empty ("custom-<uuid>" is made for you). Throws a readable Error. */
export async function saveTriviaQuestion(q: Omit<TriviaQuestion, "id"> & { id?: string }): Promise<TriviaQuestion> {
  const clean = checkTriviaQuestion(q);
  const isNew = !q.id;
  const id = q.id || newId();
  if (!/^custom-[a-z0-9-]{1,60}$/.test(id)) throw new Error("Only questions added on the site can be changed here.");
  const saved: TriviaQuestion = { id, ...clean };
  if (sb) {
    await writeTriviaQuestion(
      sb,
      id,
      {
        category: clean.category,
        topic: clean.topic,
        difficulty: clean.difficulty,
        question: clean.question,
        answer: clean.answer,
        accept: clean.accept ?? [],
        choices: clean.choices ?? null,
        fact: clean.fact ?? null,
      },
      isNew,
    );
  } else {
    if (!localAdmin()) throw new Error(ADMINS_ONLY);
    const cur = readLocal();
    const at = cur.questions.findIndex((x) => x.id === id);
    if (!isNew && at < 0) throw new Error("That question is gone.");
    const questions = at < 0 ? [...cur.questions, saved] : cur.questions.map((x) => (x.id === id ? saved : x));
    writeLocal({ ...cur, questions });
  }
  changed();
  return saved;
}

/** Admin only. */
export async function deleteTriviaQuestion(id: string): Promise<void> {
  if (sb) await removeTriviaQuestion(sb, id);
  else {
    if (!localAdmin()) throw new Error(ADMINS_ONLY);
    const cur = readLocal();
    writeLocal({ ...cur, questions: cur.questions.filter((q) => q.id !== id) });
  }
  changed();
}

/** Admin only. */
export async function saveTriviaSettings(s: TriviaSettings): Promise<void> {
  const clean = checkTriviaSettings(s);
  if (sb) await writeTriviaSettings(sb, clean.disabled, clean.notes);
  else {
    if (!localAdmin()) throw new Error(ADMINS_ONLY);
    writeLocal({ ...readLocal(), settings: clean });
  }
  changed();
}
