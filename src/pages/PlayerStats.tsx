import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Award, Crown, Flame, HeartCrack, Shield, Skull, Sparkles, Swords, Target, Users } from "lucide-react";
import { useData } from "../data/context";
import { Avatar, ChampAvatar, Empty, Form } from "../components/ui";
import { FEATURES, POINTS_NAME, shownPoints, visibleBadges } from "../lib/features";
import { MIN_TOGETHER, badges, playerSummary, rating, type Badge, type Computed, type Versus } from "../lib/stats";
import { plural } from "../lib/util";

const pct = (w: number, g: number) => (g ? `${Math.round((w / g) * 100)}%` : "–");
const f1 = (v: number) => v.toFixed(1);

const BADGE_ICON: Record<string, typeof Award> = {
  "Monthly champion": Crown,
  "On fire": Flame,
  "Bounty hunter": Target,
  "Giant slayer": Swords,
  "Champion pool": Sparkles,
};

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

function RatingChart({ c, id }: { c: Computed; id: string }) {
  const h = c.st[id].hist.slice(-31);
  const change = Math.round(h[h.length - 1] - h[Math.max(0, h.length - 6)]);
  const mn = Math.min(...h) - 8;
  const mx = Math.max(...h) + 8;
  const line = h.map((v, i) => `${((i / Math.max(1, h.length - 1)) * 300).toFixed(1)},${(100 - ((v - mn) / (mx - mn)) * 66 - 8).toFixed(1)}`).join(" ");
  const up = change >= 0;
  return (
    <div className="chart" style={{ marginBottom: 16 }}>
      <span className="cl">Rating, last {h.length - 1} games</span>
      <span className="cr" style={{ color: up ? "var(--color-ice)" : "var(--color-red)" }}>
        {up ? "+" : ""}
        {change} last 5
      </span>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label={`Rating chart, now ${rating(c, id)}`}>
        <polygon points={`0,100 ${line} 300,100`} fill={up ? "rgba(191,230,255,.10)" : "rgba(255,90,110,.10)"} />
        <polyline points={line} fill="none" stroke={up ? "var(--color-ice)" : "var(--color-red)"} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Everything about one player, all time. */
export default function PlayerStats() {
  const { id = "" } = useParams();
  const { c, player, pname, active, isActive } = useData();
  const nav = useNavigate();
  const p = player(id);
  const s = useMemo(() => playerSummary(c, id, isActive, pname), [c, id, isActive, pname]);

  const back = (
    <Link className="linkbtn" to="/stats" style={{ margin: 0 }}>
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

  const kpi = (l: string, v: React.ReactNode, sub?: string) => (
    <div className="kpi">
      <span className="l">{l}</span>
      <span className="v">{v}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  );

  const person = (label: string, Icon: typeof Award, v: Versus | null, none: string, kind: "good" | "bad") => (
    <div className={`vsp ${v ? kind : ""}`}>
      <span className="l">
        <Icon aria-hidden />
        {label}
      </span>
      {v ? (
        <>
          <Link className="who" to={`/stats/${v.id}`}>
            <Avatar id={v.id} />
            <b>{pname(v.id)}</b>
          </Link>
          <span className="r">
            <b>{pct(v.w, v.g)}</b>
            <small>
              {v.w}–{v.g - v.w} in {plural(v.g, "game")}
            </small>
          </span>
        </>
      ) : (
        <span className="sub">{none}</span>
      )}
    </div>
  );
  const few = (v: Versus | null) => !!v && v.g < MIN_TOGETHER;

  // Everyone you can pick, plus this player if they were removed.
  const list = active.some((x) => x.id === id) ? active : [...active, p];
  const bs = visibleBadges(badges(c.st[id]));

  return (
    <section>
      {back}
      <div className="head">
        <div className="pc-top">
          <Avatar id={id} lg />
          <div>
            <h1>{p.name}</h1>
            {s.g > 0 && (
              <p className="sub">
                Last games <Form id={id} n={10} />
              </p>
            )}
          </div>
        </div>
        <select className="f" aria-label="Show another player" value={id} onChange={(e) => nav(`/stats/${e.target.value}`)}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {bs.length > 0 && (
        <div className="badges" aria-label="Badges" style={{ marginBottom: 16 }}>
          {bs.map((b) => (
            <BadgeChip key={b.title} b={b} />
          ))}
        </div>
      )}

      <div className="kpis">
        {kpi("Games played", s.g)}
        {kpi("Wins and losses", s.g ? `${s.w}–${s.l}` : "–", s.g ? `${plural(s.w, "win")}, ${plural(s.l, "loss", "losses")}` : undefined)}
        {kpi("Win %", pct(s.w, s.g))}
        {kpi(POINTS_NAME, shownPoints(rating(c, id)))}
      </div>

      {FEATURES.ratings && s.g > 0 && <RatingChart c={c} id={id} />}
      <div className="pgrid">
        <section className="panel" aria-labelledby="ps-kda">
          <div className="ph">
            <h2 id="ps-kda">K/D/A</h2>
            {s.kdaGames > 0 && s.kdaGames < s.g && <p className="sub">From {plural(s.kdaGames, "game")}</p>}
          </div>
          <div className="bigkda">
            <b>{s.kdaGames ? `${f1(s.k / s.kdaGames)} / ${f1(s.d / s.kdaGames)} / ${f1(s.a / s.kdaGames)}` : "–"}</b>
            <small>Average kills, deaths and assists per game</small>
          </div>
          <div className="totals">
            {(
              [
                ["Kills", s.k],
                ["Deaths", s.d],
                ["Assists", s.a],
              ] as [string, number][]
            ).map(([l, v]) => (
              <div key={l}>
                <b>{s.kdaGames ? v.toLocaleString("en-GB") : "–"}</b>
                <small>{l}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="ps-champs">
          <div className="ph">
            <h2 id="ps-champs">Most played champions</h2>
          </div>
          <div className="list">
            {s.champs.length ? (
              s.champs.slice(0, 5).map((x) => (
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

        <section className="panel" aria-labelledby="ps-duo">
          <div className="ph">
            <h2 id="ps-duo">With teammates</h2>
            {(few(s.bestDuo) || few(s.worstDuo)) && <p className="sub">Few games so far</p>}
          </div>
          {person("Best duo", Users, s.bestDuo, "Not enough games yet", "good")}
          {person("Worst duo", HeartCrack, s.worstDuo, "Not enough games yet", "bad")}
        </section>

        <section className="panel" aria-labelledby="ps-foe">
          <div className="ph">
            <h2 id="ps-foe">Against opponents</h2>
            {(few(s.victim) || few(s.toughest)) && <p className="sub">Few games so far</p>}
          </div>
          {person("Victim", Skull, s.victim, "Not enough games yet", "good")}
          {person("Toughest opponent", Swords, s.toughest, "Not enough games yet", "bad")}
        </section>
      </div>
      <p className="note">
        Duos and opponents need {MIN_TOGETHER} games together. Until someone has that many, the few games played are used.
      </p>
    </section>
  );
}
