import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { DataStore } from "./store";
import { LocalStore } from "./store";
import { compute, type Computed } from "../lib/stats";
import type { AppData, Player, TeamSize, TeamStyle } from "../lib/types";
import { fallbackDDragon, loadDDragon, type DDragon } from "../lib/champions";

export const SAMPLE_MODE = import.meta.env.DEV || import.meta.env.VITE_SAMPLE_DATA === "true";

/* ---------- data ---------- */

interface DataCtx {
  store: DataStore;
  status: "loading" | "ready" | "error";
  error?: string;
  data: AppData;
  c: Computed;
  now: number;
  player: (id: string) => Player | undefined;
  pname: (id: string) => string;
  isActive: (id: string) => boolean;
  active: Player[];
}

const Data = createContext<DataCtx | null>(null);
const defaultStore = new LocalStore(SAMPLE_MODE && import.meta.env.VITE_SAMPLE_DATA !== "false");

/** A clock that ticks every 30s so "Xh ago" and the dodge rule stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function DataProvider({ children, store = defaultStore }: { children: ReactNode; store?: DataStore }) {
  const st = useSyncExternalStore(store.subscribe, store.getState);
  const now = useNow();
  const value = useMemo<DataCtx>(() => {
    const { players, matches } = st.data;
    const byId = new Map(players.map((p) => [p.id, p]));
    const c = compute(matches, players, now);
    return {
      store,
      status: st.status,
      error: st.error,
      data: st.data,
      c,
      now,
      player: (id) => byId.get(id),
      pname: (id) => byId.get(id)?.name ?? "Former player",
      isActive: (id) => !!byId.get(id)?.active,
      active: players.filter((p) => p.active),
    };
  }, [st, store, now]);
  return <Data.Provider value={value}>{children}</Data.Provider>;
}

export function useData() {
  const v = useContext(Data);
  if (!v) throw new Error("DataProvider missing");
  return v;
}

/* ---------- Data Dragon (champion + item names and icons) ---------- */

const DDCtx = createContext<{ dd: DDragon; loading: boolean; failed: boolean }>({
  dd: fallbackDDragon(),
  loading: false,
  failed: false,
});

export function DDragonProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ dd: fallbackDDragon(), loading: true, failed: false });
  useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    loadDDragon(ac.signal)
      .then((dd) => setState({ dd, loading: false, failed: false }))
      .catch(() => setState((s) => ({ ...s, loading: false, failed: true })))
      .finally(() => clearTimeout(t));
    return () => ac.abort();
  }, []);
  return <DDCtx.Provider value={state}>{children}</DDCtx.Provider>;
}
export const useDDragon = () => useContext(DDCtx);

/* ---------- per-device preferences (team picker state etc.) ---------- */

export interface Prefs {
  selected: string[] | null;
  size: TeamSize | null;
  style: TeamStyle;
  avoidLast: boolean;
  apart: [string, string];
  /** reroll key -> number of drafts made */
  rerolls: Record<string, number>;
  period: 30 | 0;
}

const PREFS_KEY = "bn-prefs-v1";
const defaultPrefs: Prefs = { selected: null, size: null, style: "random", avoidLast: true, apart: ["", ""], rerolls: {}, period: 30 };

function readPrefs(): Prefs {
  try {
    return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return defaultPrefs;
  }
}

const PrefsCtx = createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => void } | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, set] = useState(readPrefs);
  const setPrefs = useCallback((p: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) => {
    set((old) => {
      const next = { ...old, ...(typeof p === "function" ? p(old) : p) };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return <PrefsCtx.Provider value={{ prefs, setPrefs }}>{children}</PrefsCtx.Provider>;
}
export function usePrefs() {
  const v = useContext(PrefsCtx);
  if (!v) throw new Error("PrefsProvider missing");
  return v;
}

/* ---------- auth (Phase 1: local preview switch; Phase 2: Discord login via Supabase) ---------- */

export type Role = "visitor" | "member" | "admin";
const AuthCtx = createContext<{ role: Role; isMember: boolean; isAdmin: boolean; setRole: (r: Role) => void }>({
  role: "visitor",
  isMember: false,
  isAdmin: false,
  setRole: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    if (!SAMPLE_MODE) return "visitor";
    const r = localStorage.getItem("bn-role");
    return r === "visitor" || r === "member" ? r : "admin";
  });
  const setRole = useCallback((r: Role) => {
    localStorage.setItem("bn-role", r);
    setRoleState(r);
  }, []);
  return (
    <AuthCtx.Provider value={{ role, isMember: role !== "visitor", isAdmin: role === "admin", setRole }}>{children}</AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);
