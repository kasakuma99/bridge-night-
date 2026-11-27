import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, HeartCrack, Skull, Swords, Users } from "lucide-react";
import { useData } from "../data/context";
import { AugmentLabel, Avatar, ChampAvatar, Empty, Form } from "../components/ui";
import { StatsFilter, TimeFilter, useStatsFilter } from "../components/stats/StatsFilter";
import { POINTS_NAME, fmtPoints } from "../lib/features";
import { kdaRatio, MIN_TOGETHER, type Versus } from "../lib/stats";
import { groupName, MIN_SYNERGY_GAMES, modeLabel, pct, periodLabel, playerView, signed, statsFor, type Synergy } from "../lib/statsPage";
import { plural } from "../lib/util";
import "../styles/stats.css";

const f1 = (v: number) => v.toFixed(1);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** One player, for the chosen mode and time. */
export default function PlayerStats() {
  const { id = "" } = useParams();
  const { data, c: full, now, player, pname, isActive } = useData();
  const { f, chosen, set, query } = useStatsFilter(true);
  const p = player(id);
  const v = useMemo(() => {
    const { ms, c } = statsFor(data.matches, data.players, f, now);
    return playerView({ id, ms, c, full, f, isActive, name: pname });
  }, [data.matches, data.players, f.mode, f.period, now, id, full, isActive, pname]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <Link className="linkbtn" to={`/stats${query}`} style={{ margin: 0 }}>
      <ArrowLeft aria-hidden />
      Leaderboard
    </Link>
  );
  if (!p)
    return (
      <section>
        {back}
        <h1 className="sr-only">Player stats</h1>
        <Empty title="Player not found" text="This player doesn't exist." />
      </section>
    );

  const scope = `${modeLabel(f.mode)} · ${periodLabel(f.period)}`;
  const kpi = (l: string, val: ReactNode, sub?: ReactNode) => (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{val}</span>
      {sub != null && <span className="s">{sub}</span>}
    </div>
  );
  const link = (pid: string) => (
    <Link className="who" to={`/stats/${pid}${query}`}>
      <Avatar id={pid} />
      <b>{pname(pid)}</b>
    </Link>
  );
  const person = (label: string, Icon: typeof Users, x: Versus | null, kind: "good" | "bad") => (
    <div className={`vsp ${x ? kind : ""}`}>
      <span className="l">
        <Icon aria-hidden />
        {label}
      </span>
      {x ? (
        <>
          {link(x.id)}
          <span className="r">
            <b>{pct(x.w, x.g)}</b>
            <small>
              {x.w}–{x.g - x.w} in {plural(x.g, "game")}
            </small>
          </span>
        </>
      ) : (
        <span className="sub">Not enough games yet</span>
      )}
    </div>
  );
  const partner = (label: string, Icon: typeof Users, s: Synergy | null, kind: "good" | "bad") => (
    <div className={`vsp ${s ? kind : ""}`}>
      <span className="l">
        <Icon aria-hidden />
        {label}
      </span>
      {s ? (
        <>
          <span className="who mates">
            {s.ids
              .filter((x) => x !== id)
              .map((x) => (
                <Link key={x} to={`/stats/${x}${query}`} className="who">
                  <Avatar id={x} />
                  <b>{pname(x)}</b>
                </Link>
              ))}
          </span>
          <span className="r">
            <b className={s.score >= 0 ? "syn-up" : "syn-down"}>{signed(s.score)}</b>
            <small>
              {s.w}–{s.g - s.w} · {pct(s.w, s.g)}
            </small>
          </span>
        </>
      ) : (
        <span className="sub">Not enough games together</span>
      )}
    </div>
  );
  const few = (x: Versus | null) => !!x && x.g < MIN_TOGETHER;

  return (
    <section className="stats">
      {back}
      <div className="head">
        <div className="pc-top">
          <Avatar id={id} lg />
          <div>
            <h1>{p.name}</h1>
            <p className="sub">{p.riotId ?? "No Riot ID yet"}</p>
          </div>
        </div>
      </div>
      <StatsFilter f={f} chosen={chosen} set={set} query={query} />
      <TimeFilter f={f} set={set} />

      {!v.g ? (
        <Empty title={`No games for ${p.name}`} text={`Nothing in ${scope}. Try another mode or a longer time.`} />
      ) : (
        <>
          <div className="kpis kpis3">
            {kpi("Games played", v.g, `${plural(v.w, "win")} / ${plural(v.l, "loss", "losses")}`)}
            {kpi("Win rate", pct(v.w, v.g), <Form id={id} n={10} results={v.form} />)}
            {kpi(POINTS_NAME, fmtPoints(v.points), f.period ? `${v.change > 0 ? "+" : v.change < 0 ? "−" : "±"}${Math.abs(v.change)} in ${periodLabel(f.period).toLowerCase()}` : undefined)}
            {kpi(
              "Average K / D / A",
              v.kdaGames ? `${f1(v.k / v.kdaGames)} / ${f1(v.d / v.kdaGames)} / ${f1(v.a / v.kdaGames)}` : "–",
              v.kdaGames ? `KDA ${kdaRatio(v.k, v.d, v.a).toFixed(2)}${v.kdaGames < v.g ? ` · from ${plural(v.kdaGames, "game")}` : ""}` : "No K/D/A yet",
            )}
            {kpi("FF %", pct(v.ff, v.g), `Their team surrendered ${plural(v.ff, "time")}`)}
            {kpi("Highest win streak", v.bestStreak, v.worstRun ? `Longest losing run: ${v.worstRun}` : "Never lost twice in a row")}
          </div>

          <div className="pgrid">
            <section className="panel" aria-labelledby="ps-mates">
              <div className="ph">
                <h2 id="ps-mates">Teammates</h2>
                <p className="sub">By synergy, {MIN_SYNERGY_GAMES}+ games together</p>
              </div>
              {v.partners.length ? (
                v.partners.map((x) => (
                  <div key={x.size} className="mates-size">
                    {!f.mode && <h3 className="pc-h">{cap(groupName(x.size))}</h3>}
                    {partner(`Best ${groupName(x.size)}`, Users, x.best, "good")}
                    {partner(`Worst ${groupName(x.size)}`, HeartCrack, x.worst, "bad")}
                  </div>
                ))
              ) : (
                <p className="sub">Not enough games together yet.</p>
              )}
            </section>

            <section className="panel" aria-labelledby="ps-foe">
              <div className="ph">
                <h2 id="ps-foe">Against opponents</h2>
                {(few(v.victim) || few(v.toughest)) && <p className="sub">Few games so far</p>}
              </div>
              {person("Victim", Skull, v.victim, "good")}
              {person("Toughest opponent", Swords, v.toughest, "bad")}
            </section>

            <section className="panel" aria-labelledby="ps-aug">
              <div className="ph">
                <h2 id="ps-aug">Most chosen augments</h2>
              </div>
              <div className="list">
                {v.augments.length ? (
                  v.augments.map((a) => (
                    <div className="row" key={a.key}>
                      <AugmentLabel id={+a.key} />
                      <span className="m">
                        {plural(a.picks, "pick")} · {pct(a.wins, a.picks)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="sub">No augments in these games.</p>
                )}
              </div>
            </section>

            <section className="panel" aria-labelledby="ps-champs">
              <div className="ph">
                <h2 id="ps-champs">Most played champions</h2>
                {v.avgDamage > 0 && <p className="sub">{Math.round(v.avgDamage).toLocaleString("en-GB")} damage per game</p>}
              </div>
              <div className="list">
                {v.champs.length ? (
                  v.champs.map((x) => (
                    <div className="row" key={x.name}>
                      <span className="who">
                        <ChampAvatar name={x.name} sq />
                        {x.name}
                      </span>
                      <span className="m">
                        {plural(x.g, "game")} · {pct(x.w, x.g)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="sub">No champions yet.</p>
                )}
              </div>
            </section>
          </div>
          <p className="note">
            Synergy: how much more {p.name} wins with these teammates than the players do on their own, in points of win rate. Opponents need{" "}
            {MIN_TOGETHER} games; until then, the few games played are used.
          </p>
        </>
      )}
    </section>
  );
}
