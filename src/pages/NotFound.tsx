import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { FEATURES } from "../lib/features";

const PAGES: [to: string, label: string][] = [
  ["/live", "Live game"],
  ["/history", "Past games"],
  ["/stats", "Stats"],
  ...(FEATURES.rivals ? [["/rivals", "Rivals"] as [string, string]] : []),
  ...(FEATURES.builds ? [["/builds", "Builds"] as [string, string]] : []),
];

export default function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // React Router counts in-app steps: only offer "Go back" when there is a page of ours to go back to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const shown = pathname.length > 60 ? pathname.slice(0, 57) + "…" : pathname;
  return (
    <section className="qol-nf">
      <p className="qol-nf-code num" aria-hidden>
        404
      </p>
      <h1>Lost on the bridge</h1>
      <p className="sub">
        There's no page at <b className="qol-nf-path">{shown}</b>. Maybe it fell in the river.
      </p>
      <div className="qol-nf-acts">
        <Link className="btn pri" to="/">
          Go to Teams
        </Link>
        {canGoBack && (
          <button className="btn ghost" type="button" onClick={() => navigate(-1)}>
            <ArrowLeft aria-hidden /> Go back
          </button>
        )}
      </div>
      <nav className="qol-nf-links" aria-label="Other pages">
        {PAGES.map(([to, label]) => (
          <Link key={to} to={to}>
            {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
