import { useId, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, Search } from "lucide-react";
import { useData, usePrefs } from "../../data/context";
import { Avatar } from "../ui";
import { MODES, PERIODS, asMode, asPeriod, modeLabel, periodLabel, type Filter } from "../../lib/statsPage";

/** The mode and period: from the link when it has them, else what this device chose last. */
export function useStatsFilter() {
  const { prefs, setPrefs } = usePrefs();
  const [params, setParams] = useSearchParams();
  const f: Filter = {
    mode: params.has("mode") ? asMode(params.get("mode")) : asMode(prefs.mode),
    period: asPeriod(params.get("period"), asPeriod(prefs.period, 30)),
  };
  const set = (x: Partial<Filter>) => {
    const next = { ...f, ...x };
    setPrefs(next);
    setParams({ mode: String(next.mode), period: String(next.period) }, { replace: true });
  };
  /** The same filter in a link. */
  const query = `?mode=${f.mode}&period=${f.period}`;
  return { f, set, query };
}

/** A big box, closed at first: find a player, pick the mode and the period. */
export function StatsFilter({ f, set, query, current }: { f: Filter; set: (x: Partial<Filter>) => void; query: string; current?: string }) {
  const { active, pname } = useData();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const id = useId();
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return active
      .filter((p) => p.name.toLowerCase().includes(t) || p.riotId?.toLowerCase().includes(t) || p.discordName?.toLowerCase().includes(t))
      .sort((a, b) => +!a.name.toLowerCase().startsWith(t) - +!b.name.toLowerCase().startsWith(t) || a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [q, active]);
  const go = (pid: string) => {
    setQ("");
    setOpen(false);
    nav(`/stats/${pid}${query}`);
  };

  return (
    <div className={`sf panel${open ? " open" : ""}`}>
      <button type="button" className="sf-top" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="sf-sum">
          <Search aria-hidden />
          <span>
            <b>
              {current ? `${pname(current)} · ` : ""}
              {modeLabel(f.mode)} · {periodLabel(f.period)}
            </b>
            <small>{open ? "Find a player, or change the mode and the time" : "Tap to find a player or filter"}</small>
          </span>
        </span>
        <ChevronDown className="sf-chev" aria-hidden />
      </button>
      {open && (
        <div className="sf-body" id={id}>
          <div className="sf-search">
            <label htmlFor={`${id}-q`}>Player</label>
            <input
              id={`${id}-q`}
              className="f"
              type="search"
              placeholder="Name or Riot ID"
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) go(hits[0].id);
              }}
            />
            {q.trim() && (
              <ul className="sf-hits" aria-label="Players found">
                {hits.length ? (
                  hits.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => go(p.id)}>
                        <Avatar id={p.id} />
                        <span>
                          <b>{p.name}</b>
                          {p.riotId && <small>{p.riotId}</small>}
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="sub">Nobody with that name.</li>
                )}
              </ul>
            )}
          </div>
          <div className="sf-row">
            <span className="sf-l" id={`${id}-m`}>
              Mode
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-m`}>
              {MODES.map((m) => (
                <button key={m} type="button" aria-pressed={f.mode === m} onClick={() => set({ mode: m })}>
                  {modeLabel(m)}
                </button>
              ))}
            </div>
          </div>
          <div className="sf-row">
            <span className="sf-l" id={`${id}-p`}>
              Time
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-p`}>
              {PERIODS.map((p) => (
                <button key={p} type="button" aria-pressed={f.period === p} onClick={() => set({ period: p })}>
                  {periodLabel(p)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
