import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { DataStore } from "./store";
import { LocalStore } from "./store";
import { SupabaseStore } from "./supabaseStore";
import { supabase } from "../lib/supabase";
import { compute, type Computed } from "../lib/stats";
import type { AppData, Player, TeamSize, TeamStyle } from "../lib/types";
import { fallbackDDragon, loadDDragon, type DDragon } from "../lib/champions";
import type { SitMode } from "../lib/teams";

/** Sample data: forced with VITE_SAMPLE_DATA=true, or automatic in local dev when Supabase isn't configured. */
export const SAMPLE_MODE = import.meta.env.VITE_SAMPLE_DATA === "true" || (!supabase && import.meta.env.DEV);

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
const defaultStore: DataStore = supabase && !SAMPLE_MODE ? new SupabaseStore(supabase) : new LocalStore(SAMPLE_MODE);

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
  /** Who sits out when too many players are in. */
  sitMode: SitMode;
  /** Players tapped to sit out in "pick" mode. */
  sitPick: string[];
}

const PREFS_KEY = "bn-prefs-v1";
const defaultPrefs: Prefs = {
  selected: null,
  size: null,
  style: "random",
  avoidLast: true,
  apart: ["", ""],
  rerolls: {},
  period: 30,
  sitMode: "fair",
  sitPick: [],
};

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

/* ---------- auth: Discord login via Supabase (sample mode: a local "View as" switch) ---------- */

export type Role = "visitor" | "member" | "admin";
export interface AuthUser {
  id: string;
  name: string;
  avatar?: string;
}
interface AuthState {
  role: Role;
  isMember: boolean;
  isAdmin: boolean;
  /** Logged in, but an admin hasn't approved them yet. */
  pending: boolean;
  user: AuthUser | null;
  /** false until we know whether someone is logged in */
  ready: boolean;
  /** true when real login is available (Supabase configured, not sample mode) */
  canLogin: boolean;
  setRole: (r: Role) => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}
const AuthCtx = createContext<AuthState>({
  role: "visitor",
  isMember: false,
  isAdmin: false,
  pending: false,
  user: null,
  ready: true,
  canLogin: false,
  setRole: () => {},
  signIn: async () => {},
  signOut: async () => {},
});

function SampleAuth({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const r = localStorage.getItem("bn-role");
    return r === "visitor" || r === "member" ? r : "admin";
  });
  const setRole = useCallback((r: Role) => {
    localStorage.setItem("bn-role", r);
    setRoleState(r);
  }, []);
  const value: AuthState = {
    role,
    isMember: role !== "visitor",
    isAdmin: role === "admin",
    pending: false,
    user: role === "visitor" ? null : { id: "local", name: "Preview" },
    ready: true,
    canLogin: false,
    setRole,
    signIn: async () => {},
    signOut: async () => {},
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

function SupabaseAuth({ children }: { children: ReactNode }) {
  const sb = supabase!;
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberRole, setMemberRole] = useState<"pending" | "member" | "admin" | null>(null);

  const loadRole = useCallback(
    async (uid: string | undefined) => {
      if (!uid) {
        setMemberRole(null);
        return;
      }
      const { data, error } = await sb.from("members").select("role").eq("user_id", uid).maybeSingle();
      if (error) console.error("[bridge-night] could not load member role", error);
      setMemberRole((data?.role as "pending" | "member" | "admin" | undefined) ?? "pending");
    },
    [sb],
  );

  useEffect(() => {
    const apply = (session: import("@supabase/supabase-js").Session | null) => {
      const u = session?.user;
      const md = (u?.user_metadata ?? {}) as Record<string, unknown>;
      const claims = (md.custom_claims ?? {}) as Record<string, unknown>;
      setUser(
        u
          ? {
              id: u.id,
              name: String(claims.global_name || md.full_name || md.name || md.user_name || u.email?.split("@")[0] || "Member"),
              avatar: typeof md.avatar_url === "string" ? md.avatar_url : undefined,
            }
          : null,
      );
      // Don't call Supabase inside the auth callback itself (it can deadlock); do it right after.
      setTimeout(() => void loadRole(u?.id).finally(() => setReady(true)), 0);
    };
    void sb.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_ev, session) => apply(session));
    return () => sub.subscription.unsubscribe();
  }, [sb, loadRole]);

  // While waiting for approval, check again now and then, so the page unlocks by itself.
  useEffect(() => {
    if (memberRole !== "pending" || !user) return;
    const t = setInterval(() => void loadRole(user.id), 20_000);
    const vis = () => document.visibilityState === "visible" && void loadRole(user.id);
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [memberRole, user, loadRole]);

  const role: Role = memberRole === "admin" ? "admin" : memberRole === "member" ? "member" : "visitor";
  const value: AuthState = {
    role,
    isMember: role !== "visitor",
    isAdmin: role === "admin",
    pending: !!user && memberRole === "pending",
    user,
    ready,
    canLogin: true,
    setRole: () => {},
    signIn: async () => {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
    },
    signOut: async () => {
      await sb.auth.signOut();
    },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return supabase && !SAMPLE_MODE ? <SupabaseAuth>{children}</SupabaseAuth> : <SampleAuth>{children}</SampleAuth>;
}
export const useAuth = () => useContext(AuthCtx);
