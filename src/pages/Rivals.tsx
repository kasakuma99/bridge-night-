import { useData } from "../data/context";
import { FeudBanner } from "../components/bits";
import { Avatar, Empty, usePlayerColor } from "../components/ui";
import { rivalries } from "../lib/stats";

export default function Rivals() {
  const { c, pname, isActive } = useData();
  const color = usePlayerColor();
  const feuds = rivalries(c, isActive);
  const rows = c.h2h.filter((f) => isActive(f.a) && isActive(f.b)).sort((a, b) => b.g - a.g);
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
      {feuds.length ? feuds.map((f) => <FeudBanner key={f.a + f.b} f={f} />) : <Empty compact text="No streaks right now. Somebody win three in a row." />}
      <div className="panel">
        <div className="ph">
          <h2>All matchups</h2>
          <p className="sub">Most played first</p>
        </div>
        <div className="h2h">
          {rows.length ? (
            rows.map((f) => (
              <div className="h2hrow" key={f.a + f.b}>
                <span className="p">
                  <Avatar id={f.a} />
                  <span>{pname(f.a)}</span>
                  <b>{f.wa}</b>
                </span>
                <span className="split" role="img" aria-label={`${pname(f.a)} ${f.wa}, ${pname(f.b)} ${f.wb}`}>
                  <i style={{ width: `${(f.wa / f.g) * 100}%`, background: color(f.a) }} />
                  <i style={{ width: `${(f.wb / f.g) * 100}%`, background: color(f.b) }} />
                </span>
                <span className="p r">
                  <b>{f.wb}</b>
                  <span>{pname(f.b)}</span>
                  <Avatar id={f.b} />
                </span>
                <span className="st">
                  {f.g} games · {pname(f.leader)} won the last {f.streak > 1 ? f.streak : "one"}
                </span>
              </div>
            ))
          ) : (
            <p className="sub">Play some games to see matchups.</p>
          )}
        </div>
      </div>
    </section>
  );
}
