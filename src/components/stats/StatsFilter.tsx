import { useId, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useData, usePrefs } from "../../data/context";
import { Avatar } from "../ui";
import { MODES, PERIODS, asMode, asPeriod, modeLabel, periodLabel, type Filter } from "../../lib/statsPage";

/**
 * The mode and period, kept in the link. `chosen`: a mode was picked (always on a player page).
 * The period without one in the link is what this device chose last.
 */
export function useStatsFilter(alwaysChosen = false) {
  const { prefs, setPrefs } = usePrefs();
  const [params, setParams] = useSearchParams();
  const chosen = alwaysChosen || params.has("mode");
  const f: Filter = {
    mode: asMode(params.get("mode")),
    period: asPeriod(params.get("period"), asPeriod(prefs.period, 30)),
  };
  const set = (x: Partial<Filter>) => {
    const next = { ...f, ...x };
    if (x.period !== undefined) setPrefs({ period: next.period });
    setParams({ mode: String(next.mode), period: String(next.period) }, { replace: true });
  };
  /** The same filter in a link. */
  const query = `?mode=${f.mode}&period=${f.period}`;
  return { f, chosen, set, query };
}

/** Always shown: find a player, or pick a mode. */
export function StatsFilter({ f, chosen, set, query }: { f: Filter; chosen: boolean; set: (x: Partial<Filter>) => void; query: string }) {
  const { active } = useData();
  const nav = useNavigate();
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
    nav(`/stats/${pid}${query}`);
  };

  return (
    <div className="sf panel">
      <div className="sf-search">
        <label htmlFor={`${id}-q`}>Player</label>
        <span className="sf-q">
          <Search aria-hidden />
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
        </span>
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
            <button key={m} type="button" aria-pressed={chosen && f.mode === m} onClick={() => set({ mode: m })}>
              {modeLabel(m)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The time, in a card of its own. Shown once a mode or a player is chosen. */
export function TimeFilter({ f, set }: { f: Filter; set: (x: Partial<Filter>) => void }) {
  const id = useId();
  return (
    <div className="sf sf-time panel">
      <div className="sf-row">
        <span className="sf-l" id={id}>
          Time
        </span>
        <div className="seg" role="group" aria-labelledby={id}>
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={f.period === p} onClick={() => set({ period: p })}>
              {periodLabel(p)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
