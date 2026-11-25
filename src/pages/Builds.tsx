import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useData, useDDragon } from "../data/context";
import { ChampAvatar, ItemIcon, Skeleton } from "../components/ui";
import { mobaUrl, uggUrl } from "../lib/champions";
import { topEntries } from "../lib/stats";
import { plural } from "../lib/util";

export default function Builds() {
  const { c, active } = useData();
  const { dd, loading, failed } = useDDragon();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  const list = dd.champions.filter((ch) => norm(ch.name).includes(norm(q)));
  const choose = (n: string) => {
    setChosen(n);
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const v = chosen ? c.champ[chosen] : null;
  const mine = chosen
    ? active.map((p) => ({ p, n: c.st[p.id]?.champs[chosen] ?? 0 })).filter((x) => x.n).sort((a, b) => b.n - a.n)
    : [];
  const fav = Object.entries(c.champ)
    .sort((a, b) => b[1].g - a[1].g)
    .slice(0, 6);
  const items = v ? topEntries(v.items, 6) : [];

  return (
    <section>
      <div className="head">
        <div>
          <h1>Builds</h1>
          <p className="sub">Pick a champion to open its ARAM Mayhem build on U.GG or Mobalytics.</p>
        </div>
        <input className="f" type="search" placeholder="Search champion" aria-label="Search champion" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="panel" ref={panel} aria-live="polite">
        {!chosen ? (
          <>
            <h3>Your group plays these most</h3>
            {fav.length ? (
              <div className="chips" style={{ marginTop: 12 }}>
                {fav.map(([n]) => (
                  <button key={n} type="button" className="chip" onClick={() => choose(n)}>
                    <ChampAvatar name={n} />
                    {n}
                  </button>
                ))}
              </div>
            ) : (
              <p className="sub">Nothing yet. Champions picked in live games show up here.</p>
            )}
          </>
        ) : (
          <>
            <div className="who" style={{ gap: 14 }}>
              <ChampAvatar name={chosen} size={56} sq />
              <div>
                <h2>{chosen}</h2>
                <p className="sub" style={{ margin: "2px 0 0" }}>
                  {v
                    ? `${plural(v.g, "group game")} · ${Math.round((v.w / v.g) * 100)}% wins${mine.length ? ` · most by ${mine[0].p.name}` : ""}`
                    : "Nobody in the group has played this yet."}
                </p>
              </div>
            </div>
            {items.length > 0 && (
              <div className="fact" style={{ borderTop: 0, marginTop: 8 }}>
                <span>Our most bought items</span>
                <span className="itemrow">
                  {items.map(([it]) => (
                    <ItemIcon key={it} id={+it} />
                  ))}
                </span>
              </div>
            )}
            <div className="links">
              <a className="btn pri" href={uggUrl(chosen)} target="_blank" rel="noopener noreferrer">
                Build on U.GG <ExternalLink aria-hidden />
              </a>
              <a className="btn" href={mobaUrl(chosen)} target="_blank" rel="noopener noreferrer">
                Build on Mobalytics <ExternalLink aria-hidden />
              </a>
            </div>
          </>
        )}
      </div>
      {loading ? (
        <div className="champs" aria-busy="true" aria-label="Loading champions">
          {Array.from({ length: 18 }, (_, i) => (
            <Skeleton key={i} h={98} />
          ))}
        </div>
      ) : (
        <div className="champs">
          {list.length ? (
            list.map((ch) => (
              <button key={ch.id} type="button" className="ch" aria-pressed={ch.name === chosen} onClick={() => choose(ch.name)}>
                <ChampAvatar name={ch.name} />
                {ch.name}
              </button>
            ))
          ) : (
            <p className="sub">No champion matches "{q}".</p>
          )}
        </div>
      )}
      <p className="note">
        {failed
          ? "Champion icons couldn't be loaded from Riot's Data Dragon right now, so initials are shown instead."
          : `Champion and item icons from Riot's Data Dragon${dd.version ? ` (patch ${dd.version})` : ""}.`}{" "}
        Builds open on the external site in a new tab.
      </p>
    </section>
  );
}
