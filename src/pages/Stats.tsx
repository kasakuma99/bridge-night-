import { useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useData } from "../data/context";
import { AugmentLabel, Avatar, ChampAvatar, Empty } from "../components/ui";
import { StatsFilter, useStatsFilter } from "../components/stats/StatsFilter";
import { POINTS_NAME, fmtPoints } from "../lib/features";
import {
  board,
  clock,
  groupName,
  groupSizes,
  MIN_AUGMENT_PICKS,
  MIN_RIVALRY_GAMES,
  MIN_SYNERGY_GAMES,
  modeLabel,
  hours,
  overview,
  pct,
  periodLabel,
  signed,
  rivalryTop,
  sortBoard,
  statsFor,
  stomps,
  synergies,
  synergyTop,
  type BoardRow,
  type Pairing,
  type SortKey,
  type Synergy,
} from "../lib/statsPage";
import { plural } from "../lib/util";
import "../styles/stats.css";


const COLS: { key: SortKey; label: string; short: string }[] = [
  { key: "points", label: POINTS_NAME, short: "Pts" },
  { key: "g", label: "Games", short: "G" },
  { key: "w", label: "Wins", short: "W" },
  { key: "l", label: "Losses", short: "L" },
  { key: "wr", label: "Win %", short: "Win %" },
];
const cell = (r: BoardRow, k: SortKey) => (k === "points" ? fmtPoints(r.points) : k === "wr" ? pct(r.w, r.g) : String(r[k]));

export default function Stats() {
  const { data, c: full, now, pname, isActive } = useData();
  const { f, set, query } = useStatsFilter();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "points", desc: true });
  const [params] = useSearchParams();

  const { ms, c } = useMemo(() => statsFor(data.matches, data.players, f, now), [data.matches, data.players, f.mode, f.period, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => sortBoard(board(c, full, isActive), sort.key, sort.desc, pname), [c, full, isActive, sort, pname]);
  const o = useMemo(() => overview(ms, data.rerolls ?? [], f, now), [ms, data.rerolls, f.mode, f.period, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const syn = useMemo(() => synergyTop(synergies(c, groupSizes(f.mode), isActive), 3), [c, f.mode, isActive]);
  const stomp = useMemo(() => stomps(c, isActive), [c, isActive]);
  const rival = useMemo(() => rivalryTop(c, isActive), [c, isActive]);

  // Older links: /stats?player=id
  const asked = params.get("player");
  if (asked) return <Navigate to={`/stats/${asked}${query}`} replace />;

  const scope = `${modeLabel(f.mode)} · ${periodLabel(f.period)}`;
  const toggle = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const who = (id: string) => (
    <Link className="who" to={`/stats/${id}${query}`}>
      <Avatar id={id} />
      <span>{pname(id)}</span>
    </Link>
  );
  const kpi = (l: string, v: ReactNode, s: string) => (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </div>
  );
  const card = (title: string, sub: string, body: ReactNode, empty: string) => (
    <section className="panel" aria-label={title}>
      <div className="ph">
        <h3>{title}</h3>
        <p className="sub">{sub}</p>
      </div>
      <div className="list">{body || <p className="sub">{empty}</p>}</div>
    </section>
  );
  const list = <T,>(xs: T[], render: (x: T, i: number) => ReactNode) => (xs.length ? xs.map(render) : null);
  const pair = (p: Pairing, i: number, right: ReactNode) => (
    <div className="row" key={`${p.a}-${p.b}`}>
      <span className="pair">
        <span className="rank">{i + 1}</span>
        {who(p.a)}
        <small>vs</small>
        {who(p.b)}
      </span>
      <span className="m">{right}</span>
    </div>
  );
  const group = (s: Synergy, i: number) => (
    <div className="row" key={s.ids.join()}>
      <span className="pair grp">
        <span className="rank">{i + 1}</span>
        <span className="avas">
          {s.ids.map((id) => (
            <Link key={id} to={`/stats/${id}${query}`} title={pname(id)}>
              <Avatar id={id} />
            </Link>
          ))}
        </span>
        <span className="names">{s.ids.map(pname).join(" + ")}</span>
      </span>
      <span className="m">
        <b className={s.score >= 0 ? "syn-up" : "syn-down"}>{signed(s.score)}</b>
        <small>
          {s.w}–{s.g - s.w} · {pct(s.w, s.g)}
        </small>
      </span>
    </div>
  );
  const sizes = f.mode ? `${groupName(f.mode)}s` : "duos, trios and teams";

  return (
    <section className="stats">
      <div className="head">
        <div>
          <h1>Stats</h1>
          <p className="sub">
            {plural(o.games, "game")} · {scope}
          </p>
        </div>
      </div>
      <StatsFilter f={f} set={set} query={query} />

      <section className="panel" aria-labelledby="lb-h">
        <div className="ph">
          <h2 id="lb-h">Leaderboard</h2>
          <p className="sub">Tap a column to sort</p>
        </div>
        {rows.length ? (
          <div className="lb" role="table" aria-labelledby="lb-h">
            <div className="lb-row lb-head" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Player</span>
              {COLS.map((col) => (
                <span
                  key={col.key}
                  role="columnheader"
                  className={sort.key === col.key ? "on" : col.key === "points" ? "" : "md"}
                  aria-sort={sort.key === col.key ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button type="button" onClick={() => toggle(col.key)} aria-label={`Sort by ${col.label}`} title={`Sort by ${col.label}`}>
                    <span className="lg">{col.label}</span>
                    <span className="sm">{col.short}</span>
                    {sort.key === col.key && (sort.desc ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />)}
                  </button>
                </span>
              ))}
            </div>
            {rows.map((r, i) => (
              <div className="lb-row" role="row" key={r.id}>
                <span role="cell" className="pos">
                  {i + 1}
                </span>
                <span role="cell" className="lb-pl">
                  <Link to={`/stats/${r.id}${query}`} className="who">
                    <Avatar id={r.id} />
                    <span>
                      <b>{pname(r.id)}</b>
                      <small>
                        {r.w}–{r.l} · {pct(r.w, r.g)}
                      </small>
                    </span>
                  </Link>
                </span>
                {COLS.map((col) => (
                  <span key={col.key} role="cell" className={sort.key === col.key ? "on" : col.key === "points" ? "" : "md"}>
                    {cell(r, col.key)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No games here" text={`Nobody played ${modeLabel(f.mode)} in this time. Try another mode or a longer time.`} />
        )}
      </section>

      <h2 className="sec">The group</h2>
      <div className="kpis kpis5">
        {kpi("Games played", o.games, scope)}
        {kpi("Average game", o.avgSec ? clock(o.avgSec) : "–", o.avgSec ? "minutes per game" : "No game lengths yet")}
        {kpi("Won by FF", o.ffWins, o.games ? `${pct(o.ffWins, o.games)} of games` : "No games yet")}
        {kpi("Rerolls", o.rerolls, "Champ selects that went back to the lobby")}
        {kpi("Time played", o.totalSec ? hours(o.totalSec) : "–", o.totalSec ? "in game, all of us together" : "No game lengths yet")}
      </div>

      <div className="grid4">
        {card(
          "Most picked augments",
          "Times picked",
          list(o.augments, (a) => (
            <div className="row" key={a.key}>
              <AugmentLabel id={+a.key} />
              <span className="m">{plural(a.picks, "pick")}</span>
            </div>
          )),
          "No augments in these games.",
        )}
        {card(
          "Highest win rate augments",
          `${MIN_AUGMENT_PICKS}+ picks`,
          list(o.bestAugments, (a) => (
            <div className="row" key={a.key}>
              <AugmentLabel id={+a.key} />
              <span className="m">
                {pct(a.wins, a.picks)} · {plural(a.picks, "pick")}
              </span>
            </div>
          )),
          `No augment picked ${MIN_AUGMENT_PICKS} times yet.`,
        )}
        {card(
          "Most picked champions",
          "Times picked",
          list(o.champions, (x) => (
            <div className="row" key={x.key}>
              <span className="who">
                <ChampAvatar name={x.key} />
                {x.key}
              </span>
              <span className="m">
                {plural(x.picks, "pick")} · {pct(x.wins, x.picks)}
              </span>
            </div>
          )),
          "No champions in these games.",
        )}
        {card(
          "Biggest stomp",
          "Largest gap in wins against each other",
          list(stomp, (p, i) => pair(p, i, `${p.wa}–${p.wb}`)),
          "Nobody is ahead of anyone yet.",
        )}
        {card(
          "Biggest rivalry",
          `Closest to even, ${MIN_RIVALRY_GAMES}+ games`,
          list(rival, (p, i) => pair(p, i, `${p.wa}–${p.wb}`)),
          `Play ${MIN_RIVALRY_GAMES} games against someone to start a rivalry.`,
        )}
        {card(
          "Best synergy",
          `${sizes} that win more together`,
          list(syn.best, group),
          `No ${sizes} with ${MIN_SYNERGY_GAMES}+ games together who win more than expected.`,
        )}
        {card(
          "Worst synergy",
          `${sizes} that win less together`,
          list(syn.worst, group),
          `No ${sizes} with ${MIN_SYNERGY_GAMES}+ games together who win less than expected.`,
        )}
      </div>
      <p className="note">
        Synergy: how much more a group wins together than its players win on their own, in points of win rate. Groups need {MIN_SYNERGY_GAMES} games
        together.
      </p>
    </section>
  );
}
