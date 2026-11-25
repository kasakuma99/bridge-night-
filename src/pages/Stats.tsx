import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useData, usePrefs } from "../data/context";
import { Avatar, ChampAvatar, Form } from "../components/ui";
import { FEATURES, POINTS_NAME, byWins, shownPoints } from "../lib/features";
import { kdaRatio, periodStats, rating, records, weeklyAwards } from "../lib/stats";
import { DAY, fmtMonth, plural } from "../lib/util";

const pct = (w: number, g: number) => (g ? Math.round((w / g) * 100) : 0);
const f1 = (v: number) => v.toFixed(1);

export default function Stats() {
  const { data, c, now, pname, isActive } = useData();
  const { prefs, setPrefs } = usePrefs();
  const period = prefs.period;
  const since = period ? now - period * DAY : 0;
  const per = period ? `the last ${period} days` : "all time";

  const { rows, count } = useMemo(() => periodStats(data.matches, since, isActive), [data.matches, since, isActive]);
  const sorted = rows
    .slice()
    .sort(
      !FEATURES.ratings
        ? byWins(pname)
        : period
          ? (a, b) => b.w - a.w || b.w / b.g - a.w / a.g || rating(c, b.id) - rating(c, a.id)
          : (a, b) => rating(c, b.id) - rating(c, a.id),
    );
  const all = Object.values(c.st).filter((x) => isActive(x.id) && x.g);
  const topW = rows.slice().sort((a, b) => b.w - a.w)[0];
  const topR = all.slice().sort((a, b) => b.rating - a.rating)[0];
  const topS = all.filter((x) => x.bestStreak > 0).sort((a, b) => b.bestStreak - a.bestStreak)[0];
  const hot = all.filter((x) => x.streak > 0).sort((a, b) => b.streak - a.streak)[0];

  const rec = useMemo(() => records(data.matches, since, isActive), [data.matches, since, isActive]);
  const aw = useMemo(() => weeklyAwards(data.matches, now, isActive), [data.matches, now, isActive]);
  const groups = (k: number) =>
    c.groups
      .filter((g) => g.ids.length === k && g.g >= 3 && g.ids.every(isActive))
      .sort((a, b) => b.w / b.g - a.w / a.g || b.g - a.g)
      .slice(0, 4);
  const favs = Object.entries(c.champ)
    .sort((a, b) => b[1].g - a[1].g)
    .slice(0, 5);

  const kpi = (l: string, v: React.ReactNode, s: string) => (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
      <span className="s">{s}</span>
    </div>
  );
  const who = (id: string) => (
    <>
      <Avatar id={id} />
      <span>{pname(id)}</span>
    </>
  );
  const row = (l: string, v: string) => (
    <div className="row" key={l}>
      <span>{l}</span>
      <span className="m">{v}</span>
    </div>
  );

  const groupList = (k: number) => {
    const g = groups(k);
    return g.length ? (
      g.map((x) => row(x.ids.map(pname).join(" + "), `${pct(x.w, x.g)}% · ${x.w}–${x.g - x.w}`))
    ) : (
      <p className="sub">Not enough games together yet.</p>
    );
  };

  const recRows = [
    rec.bestGame && row("Most kills in a game", `${pname(rec.bestGame.id)} · ${rec.bestGame.k}${rec.bestGame.champion ? ` on ${rec.bestGame.champion}` : ""}`),
    rec.bestKda && row("Best KDA (3+ games)", `${pname(rec.bestKda.id)} · ${rec.bestKda.r.toFixed(2)}`),
    rec.mostKills && row("Most kills overall", `${pname(rec.mostKills.id)} · ${rec.mostKills.k}`),
    rec.mostWins && row("Most wins", `${pname(rec.mostWins.id)} · ${rec.mostWins.w}`),
  ].filter(Boolean);

  return (
    <section>
      <div className="head">
        <div>
          <h1>{period && topW ? `${pname(topW.id)} has the most wins in the last ${period} days` : "Stats"}</h1>
          <p className="sub">
            {plural(count, "game")} in {per}.
          </p>
        </div>
        <div className="seg" role="group" aria-label="Time period">
          <button type="button" aria-pressed={period === 30} onClick={() => setPrefs({ period: 30 })}>
            Last 30 days
          </button>
          <button type="button" aria-pressed={period === 0} onClick={() => setPrefs({ period: 0 })}>
            All time
          </button>
        </div>
      </div>

      <div className="kpis">
        {kpi("Games played", count, period ? `in the last ${period} days` : "since the start")}
        {kpi("Most wins", topW ? who(topW.id) : "–", topW ? `${topW.w} wins in ${per}` : "No games yet")}
        {FEATURES.ratings
          ? kpi("Highest rating", topR ? who(topR.id) : "–", topR ? `${rating(c, topR.id)} rating` : "No games yet")
          : kpi("Best win streak", topS ? who(topS.id) : "–", topS ? `${plural(topS.bestStreak, "win")} in a row, all time` : "No games yet")}
        {kpi("Hottest streak", hot ? who(hot.id) : "–", hot ? `${hot.streak} wins in a row` : "Nobody is on a streak")}
      </div>

        <section className="panel" aria-labelledby="lb-h">
          <div className="ph">
            <h2 id="lb-h">Leaderboard</h2>
            <p className="sub">{period || !FEATURES.ratings ? "Sorted by wins" : "Sorted by rating"}</p>
          </div>
          <div className="lbhead" aria-hidden>
            <span />
            <span>Player</span>
            <span>Last 5</span>
            <span className="xs">Avg K/D/A</span>
            <span>{POINTS_NAME}</span>
            <span className="xs">Streak</span>
            <span>{period ? "Wins" : "Win rate"}</span>
          </div>
          <ol className="lb">
            {sorted.length ? (
              sorted.map((x, i) => {
                const s = c.st[x.id];
                return (
                  <li key={x.id}>
                    <Link className="lbrow" to={`/stats/${x.id}`}>
                      <span className="pos">{i + 1}</span>
                      <span className="who">
                        <Avatar id={x.id} />
                        <span>
                          <b>{pname(x.id)}</b>
                          <small>
                            {x.w}–{x.g - x.w} · {pct(x.w, x.g)}%
                          </small>
                        </span>
                      </span>
                      <span className="c fm">
                        <Form id={x.id} n={5} />
                      </span>
                      <span className="c s xs">
                        <b>{x.kn ? `${f1(x.k / x.kn)}/${f1(x.d / x.kn)}/${f1(x.a / x.kn)}` : "–"}</b>
                      </span>
                      <span className="c r">
                        <b>{shownPoints(rating(c, x.id))}</b>
                      </span>
                      <span className="c s xs">
                        <b>{s.streak > 0 ? `W${s.streak}` : s.streak < 0 ? `L${-s.streak}` : "–"}</b>
                      </span>
                      <span className="c w">
                        <b>{period ? x.w : `${pct(x.w, x.g)}%`}</b>
                        <small>{period ? "wins" : "win rate"}</small>
                      </span>
                    </Link>
                  </li>
                );
              })
            ) : (
              <li className="empty" style={{ margin: 0 }}>
                No games in this period yet.
              </li>
            )}
          </ol>
          <p className="note">
            Click a player to see all their stats.
            {FEATURES.ratings &&
              " Everyone starts at 1000. After each game you're compared with every opponent: beating stronger players gives more, beating weaker players less, and losing to stronger players costs less. The first 10 games count a bit more. Losers who surrender lose 5 extra; 3+ wins in a row and ending a bounty give a small bonus. Every game counts at least 3. Kills and deaths don't change the rating. It always counts all games."}
          </p>
        </section>

      <h2 className="sec">Highlights</h2>
      <div className="grid4">
        <div className="panel">
          <div className="ph">
            <h3>Records</h3>
            <p className="sub">{period ? `Last ${period} days` : "All time"}</p>
          </div>
          <div className="list">{recRows.length ? recRows : <p className="sub">Enter K/D/A after games to unlock records.</p>}</div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Best duos</h3>
            <p className="sub">3+ games together</p>
          </div>
          <div className="list">{groupList(2)}</div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Best trios</h3>
            <p className="sub">3+ games together</p>
          </div>
          <div className="list">{groupList(3)}</div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Group favourites</h3>
            <p className="sub">Most played champions</p>
          </div>
          <div className="list">
            {favs.length ? (
              favs.map(([n, v]) => (
                <div className="row" key={n}>
                  <span className="who">
                    <ChampAvatar name={n} />
                    {n}
                  </span>
                  <span className="m">
                    {plural(v.g, "game")} · {pct(v.w, v.g)}%
                  </span>
                </div>
              ))
            ) : (
              <p className="sub">Pick champions in live games to see this.</p>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Awards this week</h3>
            <p className="sub">Last 7 days</p>
          </div>
          <div className="list">
            {aw.any ? (
              [
                aw.mvp && row("MVP", `${pname(aw.mvp.id)} · ${plural(aw.mvp.w, "win")}`),
                aw.kills && row("Most kills", `${pname(aw.kills.id)} · ${aw.kills.k}`),
                aw.kda && row("Best KDA", `${pname(aw.kda.id)} · ${kdaRatio(aw.kda.k, aw.kda.d, aw.kda.a).toFixed(2)}`),
                aw.deaths && row("Most deaths", `${pname(aw.deaths.id)} · ${aw.deaths.d}`),
              ]
            ) : (
              <p className="sub">No games in the last 7 days.</p>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="ph">
            <h3>Monthly champions</h3>
            <p className="sub">Most wins each month</p>
          </div>
          <div className="list">
            {c.monthly.length ? (
              c.monthly.slice(0, 4).map((x) => (
                <div className="row" key={x.month}>
                  <span className="who">
                    <Avatar id={x.id} />
                    <span>
                      {pname(x.id)}
                      <br />
                      <small style={{ color: "var(--color-mute)", fontWeight: 500 }}>
                        {fmtMonth(x.month)}
                        {x.current && " so far"}
                      </small>
                    </span>
                  </span>
                  <span className="m">
                    {plural(x.w, "win")} · {plural(x.g, "game")}
                  </span>
                </div>
              ))
            ) : (
              <p className="sub">Play 3+ games in a month to crown a champion.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
