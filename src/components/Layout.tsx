import { Suspense, lazy, useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { SAMPLE_MODE, useAuth, useData, type Role } from "../data/context";
import { FEATURES } from "../lib/features";
import { showFeed } from "../lib/live";
import { isDiscordInvite } from "../lib/util";
import { Logo, Skeleton } from "./ui";
import { PendingResults } from "./HelperAdmin";
import { AccountMenu } from "./qol/AccountMenu";
import { Gate } from "./qol/Gate";
import { LoginPrompt } from "./qol/LoginPrompt";
import { OfflineBanner, UpdateNotice } from "./qol/Notices";
import { pageTitle } from "./qol/logic";
import "../styles/qol.css";

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

const NAV: [to: string, label: string][] = [
  ["/", "Teams"],
  ["/live", "Live"],
  ["/history", "Past games"],
  ["/stats", "Stats"],
  ...(FEATURES.rivals ? [["/rivals", "Rivals"] as [string, string]] : []),
  ...(FEATURES.builds ? [["/builds", "Builds"] as [string, string]] : []),
  ["/players", "Players"],
];

function DiscordLink({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  const { data } = useData();
  const url = data.settings.discordUrl;
  if (!isDiscordInvite(url)) return null;
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
    </a>
  );
}

export function Layout() {
  const { data, status, error, now } = useData();
  const { role, setRole, isMember } = useAuth();
  const closed = FEATURES.privateSite && !isMember;
  const loc = useLocation();
  const nav = useRef<HTMLElement>(null);
  const live = FEATURES.classicTeams ? data.live && data.live.phase !== "draft" : showFeed(data.feed, now) && data.feed.status !== "ended";

  useEffect(() => {
    document.title = closed ? SITE_NAME : pageTitle(loc.pathname);
    window.scrollTo(0, 0);
    // Keep the active tab visible on phones.
    const n = nav.current;
    const t = n?.querySelector<HTMLElement>('[aria-current="page"]');
    if (n && t && n.scrollWidth > n.clientWidth) n.scrollTo({ left: t.offsetLeft - n.clientWidth / 2 + t.offsetWidth / 2 });
  }, [loc.pathname, closed]);

  return (
    <>
      {LiveBridge && !closed && (
        <Suspense fallback={null}>
          <LiveBridge />
        </Suspense>
      )}
      <a className="btn pri skip" href="#main">
        Skip to content
      </a>
      <header className="bar">
        <div className="wrap">
          <Link className="mark" to="/" aria-label={`${SITE_NAME} home`}>
            <Logo />
            {SITE_NAME}
          </Link>
          <nav className="tabs" aria-label="Sections" ref={nav}>
            {(closed ? [] : NAV).map(([to, label]) => (
              <NavLink key={to} className="tab" to={to} end={to === "/"}>
                {to === "/live" && live && <span className="live-dot" role="img" aria-label="Game running" />}
                {label}
              </NavLink>
            ))}
          </nav>
          {!closed && (
            <DiscordLink className="btn sm dis" label="Join our Discord (opens in a new tab)">
              <MessageCircle aria-hidden />
              <span>Join our Discord</span>
            </DiscordLink>
          )}
          <AccountMenu />
        </div>
      </header>
      <main className="wrap" id="main" tabIndex={-1}>
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
      <footer>
        <div className="wrap">
          <div className="foot">
            <span className="mark" style={{ fontSize: 18 }}>
              <Logo size={24} />
              {SITE_NAME}
            </span>
            {!closed && (
              <>
                <DiscordLink>Join our Discord</DiscordLink>
                <Link to="/stats">Stats</Link>
                {FEATURES.rivals && <Link to="/rivals">Rivals</Link>}
                {FEATURES.builds && <Link to="/builds">Builds</Link>}
                <Link to="/helper">Helper app</Link>
              </>
            )}
            <span>Fan project, made by friends for friends.</span>
          </div>
          <p>
            {SITE_NAME} was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot
            Games does not endorse or sponsor this project.
          </p>
        </div>
      </footer>
      {!FEATURES.privateSite && <LoginPrompt />}
      <UpdateNotice />
    </>
  );
}
