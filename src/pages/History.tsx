import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight, ChevronDown, Trash2 } from "lucide-react";
import { useAuth, useData } from "../data/context";
import { GameTable, usePlayerName } from "../components/GameBoard";
import { EloDelta, reasons } from "../components/stats/Elo";
import { ChampAvatar, Empty, useConfirm, useToast } from "../components/ui";
import { FEATURES } from "../lib/features";
import { hasAugments, matchEnd, matchPlayers, sizeLabel } from "../lib/live";
import { hasKda } from "../lib/stats";
import { TEAM_SIZES } from "../lib/teams";
import type { Match, Side } from "../lib/types";
import { DAY, dayKey, fmtDayLong, fmtTime, mmss, plural } from "../lib/util";
import "../styles/stats.css";

export default function History() {
  const { data, store, pname, active, now, c } = useData();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  // /history?game=... opens that game (linked from the Live page).
  const asked = params.get("game");
  const [open, setOpen] = useState<string | null>(asked);
  const [fp, setFp] = useState("");
  const [fm, setFm] = useState("");
  const [shown, setShown] = useState(20);
  const name = usePlayerName();

  useEffect(() => {
    if (asked) document.getElementById(`game-${asked}`)?.scrollIntoView({ block: "center" });
  }, [asked]);

  const list = data.matches
    .slice()
    .sort((a, b) => b.playedAt - a.playedAt)
    .filter((m) => (!fp || m.blue.includes(fp) || m.red.includes(fp)) && (!fm || String(m.mode) === fm));
  const page = list.slice(0, Math.max(shown, list.findIndex((m) => m.id === asked) + 1));
  const today = dayKey(now);
  const yest = dayKey(now - DAY);
  const perDay = new Map<string, number>();
  for (const m of list) perDay.set(dayKey(m.playedAt), (perDay.get(dayKey(m.playedAt)) ?? 0) + 1);

  const points = FEATURES.ratings ? "Elo and stats" : "Stats";
  const del = async (m: Match) => {
    const yes = await confirm({ title: "Delete this game?", text: `${points} are recalculated without it. This can't be undone.`, yes: "Delete" });
    if (!yes) return;
    try {
      await store.deleteMatch(m.id);
      toast("Game deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete the game", { err: true });
    }
  };
  const flip = async (m: Match) => {
    const yes = await confirm({
      title: "Swap the winner?",
      text: `${m.winner === "blue" ? "Red" : "Blue"} side will be saved as the winner. ${points} are recalculated.`,
      yes: "Swap winner",
      danger: false,
    });
    if (!yes) return;
    try {
      await store.flipWinner(m.id);
      toast("Winner swapped");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not swap the winner", { err: true });
    }
  };

  const team = (m: Match, s: Side) => (
    <div className={`team ${s === "blue" ? "bt" : "rt"}${m.winner === s ? " w" : ""}`}>
      <span className="tag">
        {s === "blue" ? "Blue" : "Red"}
        {m.winner === s && " · won"}
      </span>
      {matchPlayers(m)
        .filter((p) => p.side === s)
        .map((p) => {
          const rc = FEATURES.ratings && p.playerId ? c.changes[m.id]?.[p.playerId] : undefined;
          return (
            <div key={p.key} className="tp">
              {p.champion ? <ChampAvatar name={p.champion} sq size={28} /> : <span className="ava sq unknown small" aria-hidden>?</span>}
              <span>{name(p)}</span>
              {rc && <EloDelta d={rc.delta} why={reasons(rc).join(", ")} />}
              {p.champion && <span className="c">{p.champion}</span>}
              {hasKda(p) && (
                <span className="k">
                  {p.kills}/{p.deaths}/{p.assists}
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
            {TEAM_SIZES.map((k) => (
              <option key={k} value={k}>
                {k}v{k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="panel hist" style={{ padding: 0 }}>
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
            const length = m.durationSec ? mmss(m.durationSec * 1000) : m.durationMin ? `${m.durationMin} min` : "";
            const extra = [
              matchEnd(m),
              m.gameMode,
              FEATURES.challenges && m.challenge && `Challenge: ${m.challenge}`,
              FEATURES.dodges && m.dodges.length > 0 && `Dodged: ${m.dodges.map((d) => `${pname(d.playerId)}${d.champion ? ` (${d.champion})` : ""}`).join(", ")}`,
            ].filter(Boolean);
            const isOpen = open === m.id;
            return (
              <div key={m.id} id={`game-${m.id}`}>
                {head}
                <article className="match" aria-label={`${sizeLabel(m)} at ${fmtTime(m.playedAt)}, ${m.winner} won`}>
                  <div className="when">
                    <b>{fmtTime(m.playedAt)}</b>
                    {sizeLabel(m)}
                    {length && ` · ${length}`}
                  </div>
                  {team(m, "blue")}
                  {team(m, "red")}
                  <div className="acts">
                    <button
                      className="btn sm ghost dd"
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`details-${m.id}`}
                      aria-label={`Details of the game at ${fmtTime(m.playedAt)}`}
                      onClick={() => setOpen(isOpen ? null : m.id)}
                    >
                      Details
                      <ChevronDown aria-hidden />
                    </button>
                    {isAdmin && (
                      <>
                        <button className="icon" type="button" onClick={() => void flip(m)} aria-label="Swap winner" title="Swap winner">
                          <ArrowLeftRight aria-hidden />
                        </button>
                        <button className="icon" type="button" onClick={() => void del(m)} aria-label="Delete game" title="Delete game">
                          <Trash2 aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                  {extra.length > 0 && <div className="dl">{extra.join(" · ")}</div>}
                  {isOpen && (
                    <div className="details" id={`details-${m.id}`}>
                      <GameTable players={matchPlayers(m)} winner={m.winner} augments={hasAugments(m.gameMode, matchPlayers(m))} />
                    </div>
                  )}
                </article>
              </div>
            );
          })
        )}
        {list.length > page.length && (
          <div className="more">
            <button className="btn" type="button" onClick={() => setShown((n) => n + 20)}>
              Show {Math.min(20, list.length - page.length)} more games
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
