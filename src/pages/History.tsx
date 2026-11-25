import { useState } from "react";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useAuth, useData } from "../data/context";
import { Empty, ItemIcon, useConfirm, useToast } from "../components/ui";
import { FEATURES } from "../lib/features";
import { hasKda } from "../lib/stats";
import type { Match, Side } from "../lib/types";
import { DAY, dayKey, fmtDayLong, fmtTime, plural } from "../lib/util";

export default function History() {
  const { data, store, pname, active, now, c } = useData();
  const { isMember } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [fp, setFp] = useState("");
  const [fm, setFm] = useState("");
  const [shown, setShown] = useState(20);

  const list = data.matches
    .slice()
    .sort((a, b) => b.playedAt - a.playedAt)
    .filter((m) => (!fp || m.blue.includes(fp) || m.red.includes(fp)) && (!fm || String(m.mode) === fm));
  const page = list.slice(0, shown);
  const today = dayKey(now);
  const yest = dayKey(now - DAY);
  const perDay = new Map<string, number>();
  for (const m of list) perDay.set(dayKey(m.playedAt), (perDay.get(dayKey(m.playedAt)) ?? 0) + 1);

  const del = async (m: Match) => {
    if (await confirm({ title: "Delete this game?", text: `${FEATURES.ratings ? "Ratings and stats" : "Stats"} are recalculated without it.`, yes: "Delete" })) {
      await store.deleteMatch(m.id);
      toast("Game deleted");
    }
  };
  const flip = async (m: Match) => {
    const yes = await confirm({
      title: "Swap the winner?",
      text: `${m.winner === "blue" ? "Red" : "Blue"} side will be saved as the winner. ${FEATURES.ratings ? "Ratings" : "Stats"} are recalculated.`,
      yes: "Swap winner",
      danger: false,
    });
    if (yes) {
      await store.flipWinner(m.id);
      toast("Winner swapped");
    }
  };

  const team = (m: Match, s: Side) => (
    <div className={`team ${s === "blue" ? "bt" : "rt"}${m.winner === s ? " w" : ""}`}>
      <span className="tag">
        {s === "blue" ? "Blue" : "Red"}
        {m.winner === s && " · won"}
      </span>
      {m[s].map((id) => {
        const st = m.stats[id];
        const rc = FEATURES.ratings ? c.changes[m.id]?.[id] : undefined;
        const why = rc
          ? [
              `Game ${rc.base > 0 ? "+" : ""}${rc.base}`,
              rc.streak ? `win streak +${rc.streak}` : "",
              rc.bounty ? `bounty +${rc.bounty}` : "",
              rc.ff ? `surrender ${rc.ff}` : "",
            ]
              .filter(Boolean)
              .join(", ")
          : "";
        return (
          <div key={id} className="tp">
            <span>{pname(id)}</span>
            {rc && (
              <span
                className="k"
                title={`Rating ${rc.delta > 0 ? "+" : ""}${rc.delta} (${why})`}
                aria-label={`Rating change ${rc.delta > 0 ? "plus" : "minus"} ${Math.abs(rc.delta)}`}
                style={{ color: rc.delta > 0 ? "var(--color-ice)" : "var(--color-mute)", fontWeight: 600 }}
              >
                {rc.delta > 0 ? "+" : "−"}
                {Math.abs(rc.delta)}
              </span>
            )}
            {st?.champion && <span className="c">{st.champion}</span>}
            {hasKda(st) && (
              <span className="k">
                {st.kills}/{st.deaths}/{st.assists}
              </span>
            )}
            {st?.items && st.items.length > 0 && (
              <span className="itemrow" aria-label={`Items of ${pname(id)}`}>
                {st.items.map((it, i) => (
                  <ItemIcon key={i} id={it} />
                ))}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  let prevDay = "";
  return (
    <section>
      <div className="head">
        <div>
          <h1>Past games</h1>
          <p className="sub">
            {plural(data.matches.length, "game")} logged{list.length !== data.matches.length && `, ${list.length} match the filter`}.
          </p>
        </div>
        <div className="filters">
          <select className="f" aria-label="Filter by player" value={fp} onChange={(e) => (setFp(e.target.value), setShown(20))}>
            <option value="">All players</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select className="f" aria-label="Filter by mode" value={fm} onChange={(e) => (setFm(e.target.value), setShown(20))}>
            <option value="">All modes</option>
            {[1, 2, 3, 4].map((k) => (
              <option key={k} value={k}>
                {k}v{k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        {list.length === 0 ? (
          <Empty
            title={data.matches.length ? "No games here" : "No games yet"}
            text={data.matches.length ? "Try another player or mode." : "Finish a live game and it shows up here."}
          />
        ) : (
          page.map((m) => {
            const k = dayKey(m.playedAt);
            const head =
              k !== prevDay ? (
                <div className="day">
                  {k === today ? "Today" : k === yest ? "Yesterday" : fmtDayLong(m.playedAt)} · {plural(perDay.get(k) ?? 0, "game")}
                </div>
              ) : null;
            prevDay = k;
            const loser = m.winner === "blue" ? "Red" : "Blue";
            const extra = [
              m.surrender && `${loser} surrendered${m.surrender === "early" ? " early" : ""} (FF)`,
              FEATURES.challenges && m.challenge && `Challenge: ${m.challenge}`,
              FEATURES.dodges && m.dodges.length > 0 && `Dodged: ${m.dodges.map((d) => `${pname(d.playerId)}${d.champion ? ` (${d.champion})` : ""}`).join(", ")}`,
            ].filter(Boolean);
            return (
              <div key={m.id}>
                {head}
                <article className="match" aria-label={`${m.mode}v${m.mode} at ${fmtTime(m.playedAt)}, ${m.winner} won`}>
                  <div className="when">
                    <b>{fmtTime(m.playedAt)}</b>
                    {m.mode}v{m.mode}
                    {m.durationMin ? ` · ${m.durationMin} min` : ""}
                  </div>
                  {team(m, "blue")}
                  {team(m, "red")}
                  <div className="acts">
                    {isMember && (
                      <>
                        <button className="icon" type="button" onClick={() => flip(m)} aria-label="Swap winner" title="Swap winner">
                          <ArrowLeftRight aria-hidden />
                        </button>
                        <button className="icon" type="button" onClick={() => del(m)} aria-label="Delete match" title="Delete match">
                          <Trash2 aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                  {extra.length > 0 && <div className="dl">{extra.join(" · ")}</div>}
                </article>
              </div>
            );
          })
        )}
        {list.length > shown && (
          <div className="more">
            <button className="btn" type="button" onClick={() => setShown((n) => n + 20)}>
              Show {Math.min(20, list.length - shown)} more games
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
