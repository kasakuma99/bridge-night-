import { Flame } from "lucide-react";
import { useData } from "../data/context";
import { rivalryText } from "../components/bits";
import { Avatar, Empty, usePlayerColor } from "../components/ui";
import { rivalries, type HeadToHead } from "../lib/stats";
import { plural } from "../lib/util";
import "../styles/stats.css";

const tier = (streak: number) => (streak >= 6 ? "Owns" : streak >= 4 ? "Dominating" : "Upper hand");

function RivalCard({ f }: { f: HeadToHead }) {
  const { pname } = useData();
  const t = rivalryText(f, pname);
  const loser = f.leader === f.a ? f.b : f.a;
  const lw = f.leader === f.a ? f.wa : f.wb;
  const last = f.res.slice(-10);
  return (
    <article className="feud rv-card pop">
      <div className="rv-top">
        <span className="rv-vs" aria-hidden>
          <Avatar id={f.leader} />
          <small>vs</small>
          <span className="lose">
            <Avatar id={loser} />
          </span>
        </span>
        <span className={`rv-tier t${Math.min(f.streak, 6)}`}>
          <Flame aria-hidden />
          {tier(f.streak)}
        </span>
      </div>
      <b>{t.title}</b>
      <span className="rv-sub">{t.sub}</span>
      <div className="rv-foot">
        <span className="rv-pips" role="img" aria-label={`Last ${last.length} head-to-head games: ${last.filter((w) => w === f.leader).length} won by ${pname(f.leader)}`}>
          {last.map((w, i) => (
            <i key={i} className={w === f.leader ? "w" : ""} />
          ))}
        </span>
        <span className="rv-rec">
          <strong>
            {lw}–{f.g - lw}
          </strong>{" "}
          all time
        </span>
      </div>
    </article>
  );
}

export default function Rivals() {
  const { c, pname, isActive } = useData();
  const color = usePlayerColor();
  const feuds = rivalries(c, isActive);
  const rows = c.h2h.filter((f) => isActive(f.a) && isActive(f.b)).sort((a, b) => b.g - a.g || Math.abs(b.wa - b.wb) - Math.abs(a.wa - a.wb));
  return (
    <section>
      <div className="head">
        <div>
          <h1>Rivals</h1>
          <p className="sub">
            Head-to-head results whenever two players ended up on opposite sides. A rivalry is called out once someone wins 3 in a row.
          </p>
        </div>
      </div>
      {!rows.length ? (
        <Empty title="No matchups yet" text="Head-to-head records show up once two players have been on opposite sides." />
      ) : (
        <>
          <div className="ph">
            <h2>Active rivalries</h2>
            <p className="sub">{feuds.length ? `${plural(feuds.length, "streak")} of 3+ wins in a row` : "Win 3 in a row against someone to start one"}</p>
          </div>
          {feuds.length ? (
            <div className="rv-grid">
              {feuds.map((f) => (
                <RivalCard key={f.a + f.b} f={f} />
              ))}
            </div>
          ) : (
            <Empty compact text="No streaks right now. Somebody win three in a row." />
          )}
          <div className="panel rv-table">
            <div className="ph">
              <h2>All matchups</h2>
              <p className="sub">{plural(rows.length, "matchup")} · most played first</p>
            </div>
            <div className="h2h">
              {rows.map((f) => (
                  <div className="h2hrow" key={f.a + f.b}>
                    <span className={`p${f.wa > f.wb ? " lead" : ""}`}>
                      <Avatar id={f.a} />
                      <span>{pname(f.a)}</span>
                      <b>{f.wa}</b>
                    </span>
                    <span className="split" role="img" aria-label={`${pname(f.a)} ${f.wa}, ${pname(f.b)} ${f.wb}`}>
                      <i style={{ width: `${(f.wa / f.g) * 100}%`, background: color(f.a) }} />
                      <i style={{ width: `${(f.wb / f.g) * 100}%`, background: color(f.b) }} />
                    </span>
                    <span className={`p r${f.wb > f.wa ? " lead" : ""}`}>
                      <b>{f.wb}</b>
                      <span>{pname(f.b)}</span>
                      <Avatar id={f.b} />
                    </span>
                    <span className="st">
                      {plural(f.g, "game")} · {pname(f.leader)} won the last {f.streak > 1 ? f.streak : "one"}
                    </span>
                  </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
