import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Award, Crown, Flame, Shield, Sparkles, Swords, Target } from "lucide-react";
import { useData, usePrefs } from "../data/context";
import { Avatar, ChampAvatar, Empty, Form, ItemIcon } from "../components/ui";
import { EloChart, EloDelta, reasons } from "../components/stats/Elo";
import { FEATURES, POINTS_NAME, byWins, shownPoints, visibleBadges } from "../lib/features";
import { sizeLabel } from "../lib/live";
import {
  badges,
  eloLog,
  eloTrend,
  kdaRatio,
  periodStats,
  PLACEMENT_GAMES,
  profile,
  rating,
  records,
  START_RATING,
  topEntries,
  weeklyAwards,
  type Badge,
  type Computed,
} from "../lib/stats";
import { DAY, fmtMonth, plural, TZ } from "../lib/util";
import "../styles/stats.css";

const pct = (w: number, g: number) => (g ? Math.round((w / g) * 100) : 0);
const f1 = (v: number) => v.toFixed(1);
const streakText = (s: number) => (s > 0 ? `W${s}` : s < 0 ? `L${-s}` : "–");
const shortDay = (t: number) => new Date(t).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

const BADGE_ICON: Record<string, typeof Award> = {
  "Monthly champion": Crown,
  "On fire": Flame,
  "Bounty hunter": Target,
  "Giant slayer": Swords,
  "Champion pool": Sparkles,
};

export default function Stats() {
  const { data, c, now, pname, isActive } = useData();
  const { prefs, setPrefs } = usePrefs();
  const [params, setParams] = useSearchParams();
  const period = prefs.period;
  const since = period ? now - period * DAY : 0;
  const per = period ? `the last ${period} days` : "all time";

  const { rows, count } = useMemo(() => periodStats(data.matches, since, isActive), [data.matches, since, isActive]);
  const inPeriod = new Map(rows.map((r) => [r.id, r]));
  // The list has everyone who has played; W–L and win rate follow the switch.
  // Elo is always all-time. Without Elo, the order is wins in the chosen period.
  const ranked = rankedPlayers(c, isActive, pname, inPeriod);
  const topW = rows.slice().sort((a, b) => b.w - a.w || a.g - b.g)[0];
  const topR = ranked[0];
  const topS = ranked.filter((x) => x.bestStreak > 0).sort((a, b) => b.bestStreak - a.bestStreak)[0];
  const hot = ranked.filter((x) => x.streak > 0).sort((a, b) => b.streak - a.streak)[0];
  const asked = params.get("player");
  const focus = asked && c.st[asked]?.g && isActive(asked) ? asked : ranked[0]?.id;

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
        {kpi("Most wins", topW ? who(topW.id) : "–", topW ? `${plural(topW.w, "win")} in ${per}` : "No games yet")}
        {FEATURES.ratings
          ? kpi("Top Elo", topR ? who(topR.id) : "–", topR ? `${rating(c, topR.id)} Elo` : "Everyone starts at 1000")
          : kpi("Best win streak", topS ? who(topS.id) : "–", topS ? `${plural(topS.bestStreak, "win")} in a row, all time` : "No games yet")}
        {kpi("Hottest streak", hot ? who(hot.id) : "–", hot ? `${hot.streak} wins in a row` : "Nobody is on a streak")}
      </div>

      <div className="statgrid">
        <section className="panel" aria-labelledby="lb-h">
          <div className="ph">
            <h2 id="lb-h">{FEATURES.ratings ? "Elo ranking" : "Leaderboard"}</h2>
            <p className="sub">{!FEATURES.ratings ? "Sorted by wins" : period ? `W–L and win rate: last ${period} days` : "All games"}</p>
          </div>
          {ranked.length ? (
            <>
              <div className={`lbhead rk-head${FEATURES.ratings ? "" : " noelo"}`} aria-hidden>
                <span>#</span>
                <span>Player</span>
                <span>{FEATURES.ratings ? "Elo" : POINTS_NAME}</span>
                {FEATURES.ratings && <span>Last 5</span>}
                <span className="md">W–L</span>
                <span className="md">Win rate</span>
                <span className="md">Streak</span>
              </div>
              <ol className="rk">
                {ranked.map((x, i) => {
                  const p = inPeriod.get(x.id);
                  const trend = eloTrend(eloLog(c, x.id));
                  const wl = p ? `${p.w}–${p.g - p.w}` : "–";
                  const wr = p ? `${pct(p.w, p.g)}%` : "–";
                  return (
                    <li key={x.id}>
                      <button
                        type="button"
                        className={`lbrow rk-row${FEATURES.ratings ? "" : " noelo"}`}
                        aria-pressed={x.id === focus}
                        onClick={() => {
                          setParams({ player: x.id }, { replace: true });
                          if (window.innerWidth <= 1000) document.getElementById("pcard")?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <span className="pos">{i + 1}</span>
                        <span className="who">
                          <Avatar id={x.id} />
                          <span>
                            <b>{pname(x.id)}</b>
                            <small>
                              <Form id={x.id} n={5} />
                              {FEATURES.ratings && x.g < PLACEMENT_GAMES && <span className="plc">Placement {x.g}/{PLACEMENT_GAMES}</span>}
                            </small>
                            <small className="rk-meta">
                              {wl} · {wr} · {streakText(x.streak)}
                            </small>
                          </span>
                        </span>
                        <span className="elo">{shownPoints(rating(c, x.id))}</span>
                        {FEATURES.ratings && (
                          <span className="tr">
                            <EloDelta d={trend} arrow />
                          </span>
                        )}
                        <span className="md">{wl}</span>
                        <span className="md">{wr}</span>
                        <span className={`md stk${x.streak > 0 ? " hot" : ""}`}>{streakText(x.streak)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <Empty title="No ranked players yet" text={FEATURES.ratings ? "Everyone starts at 1000 Elo. Finish a game and the ranking shows up here." : "Finish a game and the leaderboard shows up here."} />
          )}
          {FEATURES.ratings && (
            <details className="elo-how">
              <summary>How Elo works</summary>
              <p>
                Everyone starts at {START_RATING}. After each game you're compared with every opponent: beating stronger players gives more,
                beating weaker players less, and losing to stronger players costs less. A 100 point gap means about 13 for the favourite and 17
                for the underdog. The first {PLACEMENT_GAMES} games (placement) count a bit more. Losers who surrender lose 5 extra; 3+ wins in
                a row and ending someone's streak (bounty) give a small bonus. Every game counts at least 3. Kills and deaths don't change Elo,
                and Elo always counts all games.
              </p>
            </details>
          )}
        </section>
        <aside className="panel pcard" id="pcard" aria-label="Player profile">
          {focus ? (
            <Profile id={focus} />
          ) : (
            <Empty compact title="Player profiles" text="Click a player in the list to see their profile. Profiles appear after the first game." />
          )}
        </aside>
      </div>

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

/** Everyone who has played: by Elo, or by wins (in the period, then all time) when Elo is hidden. */
function rankedPlayers(c: Computed, isActive: (id: string) => boolean, name: (id: string) => string, inPeriod?: Map<string, { g: number; w: number }>) {
  const all = Object.values(c.st).filter((x) => isActive(x.id) && x.g);
  if (FEATURES.ratings) return all.sort((a, b) => b.rating - a.rating || b.w - a.w);
  const wins = byWins(name);
  const row = (x: (typeof all)[number]) => {
    const p = inPeriod ? inPeriod.get(x.id) : x;
    return { id: x.id, g: p?.g ?? 0, w: p?.w ?? 0 };
  };
  return all.sort((a, b) => wins(row(a), row(b)));
}

function BadgeChip({ b }: { b: Badge }) {
  const Icon = BADGE_ICON[b.title] ?? Shield;
  return (
    <span className={`bd${b.gold ? " gold" : ""}`} title={b.detail}>
      <Icon aria-hidden />
      {b.title}
      <span className="sr-only">: {b.detail}</span>
    </span>
  );
}

function Profile({ id }: { id: string }) {
  const { c, pname, player, isActive } = useData();
  const x = c.st[id];
  const p = player(id);
  const rankList = rankedPlayers(c, isActive, pname);
  const rank = rankList.findIndex((s) => s.id === id) + 1;
  const pr = profile(c, id, isActive);
  const champs = topEntries(x.champs, 3);
  const items = topEntries(x.items, 6);
  const log = eloLog(c, id);
  const trend = eloTrend(log);
  const shown = Math.min(30, log.length);
  const peak = Math.round(Math.max(...x.hist));
  const bs = visibleBadges(badges(x));

  return (
    <>
      <div className="pc-top">
        <Avatar id={id} lg />
        <div>
          <h2>{p?.name ?? pname(id)}</h2>
          <p className="sub">
            <span>#{rank} {FEATURES.ratings ? "in Elo" : "in wins"}</span> · <Form id={id} n={10} />
          </p>
        </div>
      </div>
      <div className="pc-elo">
        <div>
          <small>{FEATURES.ratings ? "Elo" : POINTS_NAME}</small>
          <b>{shownPoints(rating(c, id))}</b>
        </div>
        {FEATURES.ratings && (
          <div className="pc-elo-tr">
            <EloDelta d={trend} arrow />
            <small>last {Math.min(5, log.length)} games</small>
          </div>
        )}
        {FEATURES.ratings && x.g < PLACEMENT_GAMES && <span className="plc">Placement {x.g}/{PLACEMENT_GAMES}</span>}
      </div>
      {bs.length > 0 && (
        <div className="badges" aria-label="Badges">
          {bs.map((b) => (
            <BadgeChip key={b.title} b={b} />
          ))}
        </div>
      )}
      <div className="pc-stats">
        <div>
          <small>{FEATURES.ratings ? "Peak Elo" : "Best streak"}</small>
          <b>{FEATURES.ratings ? peak : x.bestStreak}</b>
        </div>
        <div>
          <small>Win rate</small>
          <b>{pct(x.w, x.g)}%</b>
        </div>
        <div>
          <small>Games</small>
          <b>{x.g}</b>
        </div>
        <div>
          <small>Avg KDA</small>
          <b>{x.kdaGames ? kdaRatio(x.k, x.d, x.a).toFixed(2) : "–"}</b>
        </div>
      </div>
      {FEATURES.ratings && (
        <>
          <div className="chart elo-chart" role="img" aria-label={`Elo over the last ${plural(shown, "game")}: from ${Math.round(x.hist[x.hist.length - 1 - shown])} to ${rating(c, id)}`}>
            <span className="cl">Elo, last {plural(shown, "game")}</span>
            <EloChart hist={x.hist} start={START_RATING} />
          </div>
          <div>
            <h3 className="pc-h">Recent Elo changes</h3>
            <ol className="elo-log">
              {log
                .slice(-5)
                .reverse()
                .map((e) => (
                  <li key={e.match.id}>
                    <span className={`res${e.won ? " w" : ""}`}>{e.won ? "W" : "L"}</span>
                    <span className="what">
                      <b>
                        {e.won ? "Won" : "Lost"} · {shortDay(e.match.playedAt)} · {sizeLabel(e.match)}
                      </b>
                      <small>{reasons(e.change).join(" · ")}</small>
                    </span>
                    <span className="aft">
                      <EloDelta d={e.change.delta} />
                      <small>{e.after} Elo</small>
                    </span>
                  </li>
                ))}
            </ol>
          </div>
        </>
      )}
      <div>
        <div className="fact">
          <span>Record</span>
          <b>
            {x.w}–{x.l}
            {x.streak > 1 ? ` · ${x.streak} win streak` : x.streak < -1 ? ` · ${-x.streak} losses in a row` : ""}
          </b>
        </div>
        <div className="fact">
          <span>Best teammate</span>
          <b>{pr.mate ? `${pname(pr.mate.id)} · ${pct(pr.mate.w, pr.mate.g)}% together` : "Not enough games"}</b>
        </div>
        <div className="fact">
          <span>Favourite victim</span>
          <b>{pr.victim ? `${pname(pr.victim.o)} · ${pr.victim.w}–${pr.victim.l}` : "Nobody yet"}</b>
        </div>
        <div className="fact">
          <span>Toughest opponent</span>
          <b>{pr.nemesis ? `${pname(pr.nemesis.o)} · ${pr.nemesis.w}–${pr.nemesis.l}` : "Nobody yet"}</b>
        </div>
        <div className="fact">
          <span>Most played</span>
          <b>{champs.length ? champs.map(([n, v]) => `${n} (${v})`).join(", ") : "No champions logged"}</b>
        </div>
        {x.kdaGames > 0 && (
          <div className="fact">
            <span>Average K / D / A</span>
            <b>
              {f1(x.k / x.kdaGames)} / {f1(x.d / x.kdaGames)} / {f1(x.a / x.kdaGames)}
            </b>
          </div>
        )}
        {items.length > 0 && (
          <div className="fact">
            <span>Most bought items</span>
            <span className="itemrow">
              {items.map(([it]) => (
                <ItemIcon key={it} id={+it} />
              ))}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
