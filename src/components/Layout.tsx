import { Suspense, createContext, lazy, useContext, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { SAMPLE_MODE, useAuth, useData, type Role } from "../data/context";
import { FEATURES } from "../lib/features";
import { showFeed } from "../lib/live";
import { Skeleton } from "./ui";
import { Globe } from "./Globe";
import { PendingResults } from "./HelperAdmin";
import { AccountMenu } from "./qol/AccountMenu";
import { Gate } from "./qol/Gate";
import { LoginPrompt } from "./qol/LoginPrompt";
import { OfflineBanner, UpdateNotice } from "./qol/Notices";
import { pageTitle } from "./qol/logic";
import "../styles/qol.css";
import "../styles/kit.css";

// npm run dev:live only: not in the production build.
const LiveBridge =
  import.meta.env.DEV && SAMPLE_MODE && import.meta.env.VITE_LIVE
    ? lazy(() => import("../dev/LiveTools").then((m) => ({ default: m.LiveBridge })))
    : null;

function PendingNote() {
  const { pending, user } = useAuth();
  if (!pending || !user) return null;
  return (
    <p className="preview" role="status">
      <i />
      Hi {user.name}! You're logged in. An admin needs to approve you before you can make changes. This page unlocks by itself.
    </p>
  );
}

export const SITE_NAME = "Bridge Night";

export const NAV: [to: string, label: string][] = [
  ["/", "Teams"],
  ["/live", "Live"],
  ["/history", "Past games"],
  ["/stats", "Stats"],
  ...(FEATURES.rivals ? [["/rivals", "Rivals"] as [string, string]] : []),
  ...(FEATURES.builds ? [["/builds", "Builds"] as [string, string]] : []),
  ["/players", "Players"],
  ...(FEATURES.arcade ? [["/arcade", "Arcade"] as [string, string]] : []),
];

/** An extra button on the taskbar (the Arcade puts the open game there). */
type Task = { to: string; label: string };
const TaskContext = createContext<(t: Task | null) => void>(() => {});

/** Show `task` on the taskbar while the calling page is open. */
export function useTask(task: Task | null) {
  const set = useContext(TaskContext);
  const to = task?.to;
  const label = task?.label;
  useEffect(() => {
    set(to && label ? { to, label } : null);
    return () => set(null);
  }, [set, to, label]);
}

/** The section a path belongs to, for the title bar, the globe and the taskbar. */
function section(path: string): [string, string] | null {
  if (path === "/helper") return ["/helper", "Helper"];
  const hit = NAV.filter(([to]) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/")));
  return hit[0] ?? null;
}

function useClock() {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 15_000);
    return () => clearInterval(id);
  }, []);
  return t;
}

function Taskbar({ here, extra }: { here: [string, string] | null; extra: Task | null }) {
  const clock = useClock();
  return (
    <nav className="k-taskbar" aria-label="Taskbar">
      <Link className="k-start" to="/" aria-label={`Start: ${SITE_NAME} home`}>
        start
      </Link>
      <div className="k-tasks">
        {here && (
          <NavLink className="k-task" to={here[0]} end>
            {here[1]}
          </NavLink>
        )}
        {extra && (
          <NavLink className="k-task" to={extra.to} end>
            {extra.label}
          </NavLink>
        )}
      </div>
      <div className="k-tray">{clock}</div>
    </nav>
  );
}

/**
 * Every page sits in one olive window (the old Steam UI kit, src/styles/kit.css): title bar, globe header with the
 * account menu, section tabs, the page, an etched line, the footer. The XP taskbar is fixed at the bottom.
 */
export function Layout() {
  const { data, status, error, now } = useData();
  const { role, setRole, isMember } = useAuth();
  const closed = FEATURES.privateSite && !isMember;
  const loc = useLocation();
  const nav = useRef<HTMLElement>(null);
  const [task, setTask] = useState<Task | null>(null);
  const live = FEATURES.classicTeams ? data.live && data.live.phase !== "draft" : showFeed(data.feed, now) && data.feed.status !== "ended";
  const here = closed ? null : section(loc.pathname);

  useEffect(() => {
    document.title = closed ? SITE_NAME : pageTitle(loc.pathname);
    window.scrollTo(0, 0);
    // Keep the active tab visible on phones.
    const n = nav.current;
    const t = n?.querySelector<HTMLElement>('[aria-current="page"]');
    if (n && t && n.scrollWidth > n.clientWidth) n.scrollTo({ left: t.offsetLeft - n.clientWidth / 2 + t.offsetWidth / 2 });
  }, [loc.pathname, closed]);

  return (
    <TaskContext.Provider value={setTask}>
      {LiveBridge && !closed && (
        <Suspense fallback={null}>
          <LiveBridge />
        </Suspense>
      )}
      <a className="btn pri skip" href="#main">
        Skip to content
      </a>
      <div className="k-win">
        <div className="k-title">
          <span>{here ? `${SITE_NAME} - ${here[1]}` : SITE_NAME}</span>
          <span className="k-ctrls" aria-hidden>
            <span>_</span>
            <span>&times;</span>
          </span>
        </div>
        <div className="k-inner">
          <header className="k-head">
            <Globe text={(here?.[1] ?? "Bridge").toUpperCase()} size={80} />
            <div className="k-headtext">
              <Link className="k-h1" to="/" aria-label={`${SITE_NAME} home`}>
                {SITE_NAME}
              </Link>
              <p>Random teams, live scores and stats for our League custom games.</p>
            </div>
            <div className="k-acct">
              <AccountMenu />
            </div>
          </header>
          {!closed && (
            <nav className="k-tabs" aria-label="Sections" ref={nav}>
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"}>
                  {to === "/live" && live && <span className="live-dot" role="img" aria-label="Game running" />}
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
          <main className="k-page" id="main" tabIndex={-1}>
            {SAMPLE_MODE && !loc.search.includes("shot") && (
              <p className="preview">
                <i />
                Local preview with sample players. Changes are saved in this browser only.
                <label>
                  <span className="sr-only">View as</span>
                  <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Preview the site as">
                    <option value="admin">View as admin</option>
                    <option value="member">View as member</option>
                    <option value="visitor">View as visitor</option>
                  </select>
                </label>
              </p>
            )}
            <OfflineBanner />
            {!closed && <PendingNote />}
            {closed ? (
              <Gate />
            ) : status === "loading" ? (
              <div role="status" aria-busy="true" aria-label="Loading">
                <Skeleton h={48} />
                <div style={{ height: 16 }} />
                <Skeleton h={260} />
              </div>
            ) : status === "error" ? (
              <section className="panel" role="alert">
                <h2>Something went wrong</h2>
                <p className="sub">{error}</p>
                <button className="btn pri" type="button" onClick={() => window.location.reload()}>
                  Reload
                </button>
              </section>
            ) : (
              <>
                {(loc.pathname === "/live" || loc.pathname === "/history") && <PendingResults />}
                <Outlet />
              </>
            )}
          </main>
          <hr className="k-sep" />
          <footer className="k-foot">
            {!closed && (
              <nav aria-label="More">
                <Link className="k-link" to="/stats">
                  Stats
                </Link>
                {FEATURES.rivals && (
                  <Link className="k-link" to="/rivals">
                    Rivals
                  </Link>
                )}
                {FEATURES.builds && (
                  <Link className="k-link" to="/builds">
                    Builds
                  </Link>
                )}
                <Link className="k-link" to="/helper">
                  Helper app
                </Link>
              </nav>
            )}
            <p>{SITE_NAME}. Fan project, made by friends for friends.</p>
            <p>
              {SITE_NAME} was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot
              Games does not endorse or sponsor this project.
            </p>
            <div className="k-badges" aria-hidden>
              <span className="k-badge">
                5 VS 5
                <br />
                CUSTOMS
              </span>
              <span className="k-badge">
                BEST AT
                <br />
                1280x720
              </span>
            </div>
          </footer>
        </div>
      </div>
      <Taskbar here={here} extra={task} />
      {!FEATURES.privateSite && <LoginPrompt />}
      <UpdateNotice />
    </TaskContext.Provider>
  );
}
