import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Target } from "lucide-react";
import { useAuth, useData, usePrefs } from "../data/context";
import { FeudBanner, HeroArt, RuleInfo, WinChance, useDodges } from "../components/bits";
import { Avatar, Empty, useConfirm, useToast } from "../components/ui";
import { bountyTarget, rating, rivalries, teamAvg } from "../lib/stats";
import {
  canDraft,
  captainPick,
  captainUndo,
  defaultSize,
  draftOpen,
  makeTeams,
  maxSize,
  rerollKey,
  rerollsLeft,
  sitPriority,
} from "../lib/teams";
import type { LiveGame, Side, TeamSize, TeamStyle } from "../lib/types";
import { DAY, fmtDuration, plural } from "../lib/util";
import { StoreError } from "../data/store";

const STYLES: [TeamStyle, string][] = [
  ["random", "Random"],
  ["balanced", "Balanced"],
  ["captains", "Captains"],
];

export function useTeamPicker() {
  const { data, active } = useData();
  const { prefs } = usePrefs();
  const activeIds = active.map((p) => p.id);
  const selected = (prefs.selected ?? activeIds).filter((id) => activeIds.includes(id));
  const n = selected.length;
  const size: TeamSize = prefs.size && prefs.size <= maxSize(n) ? prefs.size : defaultSize(n);
  const key = rerollKey(selected, size);
  const made = prefs.rerolls[key] || 0;
  return { selected, n, size, key, made, limit: data.settings.rerollLimit };
}

export default function Teams() {
  const { data, c, store, now, pname, isActive, active } = useData();
  const { isMember, isAdmin } = useAuth();
  const { prefs, setPrefs } = usePrefs();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const dodges = useDodges();
  const { selected, n, size, key, made, limit } = useTeamPicker();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const L = data.live;
  const busy = !!L && L.phase !== "draft";
  const draft = L && L.phase === "draft" ? L : null;
  const left = rerollsLeft(limit, made);
  const ok = canDraft(limit, made);
  const need = size * 2;

  const clearDraft = () => draft && store.setLive(null);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setPrefs({ selected: next });
    clearDraft();
  };

  const generate = async () => {
    if (busy) {
      const yes = await confirm({
        title: "A game is still running",
        text: "Cancel it and make new teams? The running game is not saved.",
        yes: "Cancel game and make teams",
      });
      if (!yes) return;
      setPrefs({ rerolls: {} });
    } else if (!ok) return;
    const last = data.matches.slice().sort((a, b) => b.playedAt - a.playedAt)[0];
    const [a1, a2] = prefs.apart;
    try {
      const live = makeTeams({
        selected,
        size,
        style: prefs.style,
        ratingOf: (id) => rating(c, id),
        sitPriority: sitPriority(data.matches, selected),
        apart: a1 && a2 ? [a1, a2] : null,
        avoid: prefs.avoidLast && last ? last : null,
        current: draft && !draft.captains ? draft : null,
      });
      await store.setLive(live);
      setPrefs((p) => ({ rerolls: { ...(busy ? {} : p.rerolls), [key]: (busy ? 0 : made) + 1 } }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not make teams", { err: true });
    }
  };

  const lock = async () => {
    if (!draft) return;
    await store.setLive({ ...draft, phase: "select", captains: undefined, lockedAt: Date.now() });
    setPrefs({ rerolls: {} });
    nav("/live");
    toast(dodges.off ? "Champ select started" : `Champ select: ${plural(dodges.perTeam, "dodge")} per team tonight`);
  };

  const cancel = async () => {
    const yes = await confirm({
      title: "Cancel this game?",
      text: "Teams, picks and dodges are thrown away. Nothing is saved to the history.",
      yes: "Cancel game",
    });
    if (!yes) return;
    await store.setLive(null);
    setPrefs({ rerolls: {} });
    toast("Game cancelled");
  };

  const addPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await store.addPlayer(newName);
      setPrefs({ selected: [...selected, p.id] });
      clearDraft();
      setNewName("");
      setAdding(false);
      toast(`${p.name} added. Add their Riot ID on the Players page.`);
    } catch (err) {
      toast(err instanceof StoreError ? err.message : "Could not add the player", { err: true });
    }
  };

  const lastAt = dodges.lastGameAt;
  const month = data.matches.filter((m) => m.playedAt >= now - 30 * DAY).length;
  const lead = Object.values(c.st)
    .filter((x) => isActive(x.id) && x.g)
    .sort((a, b) => b.rating - a.rating)[0];
  const feud = rivalries(c, isActive)[0];
  const apartOn = !!(prefs.apart[0] && prefs.apart[1] && prefs.apart[0] !== prefs.apart[1]);
  const optCount = (prefs.avoidLast ? 1 : 0) + (apartOn ? 1 : 0);

  const btnLabel = busy ? "Make teams" : !ok ? "No rerolls left" : draft ? (left === Infinity ? "Reroll" : `Reroll · ${left} left`) : "Make teams";

  return (
    <section aria-labelledby="t-h">
      <div className="hero">
        <HeroArt />
        <div className="in">
          <h1 id="t-h">Who plays tonight?</h1>
          <div className="hchips">
            {busy ? (
              <span className="hchip">
                <i className="on" />
                Game in progress
              </span>
            ) : !dodges.off ? (
              dodges.freshNight || dodges.left.blue || dodges.left.red ? (
                <span className="hchip">
                  <i className="on" />
                  Dodges on ·{" "}
                  <b>
                    {dodges.freshNight
                      ? `${dodges.perTeam} per team`
                      : `${dodges.left.blue} Blue · ${dodges.left.red} Red`}
                  </b>
                </span>
              ) : (
                <span className="hchip">
                  <i />
                  Dodges back in <b>{fmtDuration(dodges.untilFresh)}</b>
                </span>
              )
            ) : null}
            {lastAt != null && (
              <span className="hchip">
                Last game <b>{fmtDuration(now - lastAt)}</b> ago
              </span>
            )}
            <span className="hchip">
              <b>{month}</b> games in 30 days
            </span>
            {lead && (
              <span className="hchip">
                Top rated <b>{pname(lead.id)}</b>
              </span>
            )}
          </div>
        </div>
      </div>

      {feud && <FeudBanner f={feud} />}
      <RuleInfo />

      <p className="hint" aria-live="polite">
        {n < 2
          ? "Pick at least 2 players."
          : n > need
            ? `${n} players in, ${n - need} ${n - need > 1 ? "sit" : "sits"} out this game. Sit-outs rotate.`
            : `${n} players, ${size}v${size}.`}
      </p>

      <div className="panel">
        <div className="chips" role="group" aria-label="Who is playing">
          {active.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={selected.includes(p.id)}
              disabled={!isMember}
              onClick={() => toggle(p.id)}
            >
              <Avatar id={p.id} />
              {p.name}
            </button>
          ))}
          {isAdmin &&
            (adding ? (
              <form className="addchip" onSubmit={addPlayer}>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  aria-label="New player name"
                  maxLength={20}
                  onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                />
                <button className="btn sm pri" type="submit" disabled={!newName.trim()}>
                  Add
                </button>
                <button className="btn sm ghost" type="button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="chip add" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add player
              </button>
            ))}
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Team size">
            {([1, 2, 3, 4] as TeamSize[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={k === size}
                disabled={n < 2 * k || !isMember}
                onClick={() => {
                  setPrefs({ size: k });
                  clearDraft();
                }}
              >
                {k}v{k}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Team style">
            {STYLES.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={prefs.style === s} disabled={!isMember} onClick={() => setPrefs({ style: s })}>
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <button className="btn pri" type="button" disabled={!isMember || n < 2 || (!busy && !ok)} onClick={generate}>
            {btnLabel}
          </button>
        </div>
        {isMember && (
          <details className="opts">
            <summary>
              More options {optCount > 0 && <span className="cnt">{optCount} on</span>}
            </summary>
            <div className="optin">
              <label className="check">
                <input type="checkbox" checked={prefs.avoidLast} onChange={(e) => setPrefs({ avoidLast: e.target.checked })} /> Avoid
                the teams from the last game
              </label>
              <span className="pair">
                Keep apart
                {[0, 1].map((j) => (
                  <span key={j} style={{ display: "contents" }}>
                    {j === 1 && " and "}
                    <select
                      aria-label={j ? "Second player to keep apart" : "First player to keep apart"}
                      value={prefs.apart[j]}
                      onChange={(e) => {
                        const a = [...prefs.apart] as [string, string];
                        a[j] = e.target.value;
                        if (a[0] && a[0] === a[1]) {
                          a[1 - j] = "";
                          toast("Pick two different players");
                        }
                        setPrefs({ apart: a });
                      }}
                    >
                      <option value="">Nobody</option>
                      {active.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </span>
                ))}
              </span>
              <p className="note">Keep apart puts two players on opposite teams. In Captains mode they become the two captains.</p>
            </div>
          </details>
        )}
        {!isMember && <p className="note">Log in as a member to make teams.</p>}
      </div>

      {busy && L ? (
        <Empty title="A game is running" text={`${L.blue.map(pname).join(", ")} vs ${L.red.map(pname).join(", ")}`}>
          <Link className="btn pri" to="/live">
            Open live game
          </Link>
          {isMember && (
            <button className="btn ghost" type="button" onClick={cancel}>
              Cancel game
            </button>
          )}
        </Empty>
      ) : !draft ? (
        <Empty title="No teams yet" text="Pick who's playing and hit Make teams." />
      ) : (
        <Draft L={draft} onLock={lock} />
      )}
    </section>
  );
}

function Draft({ L, onLock }: { L: LiveGame; onLock: () => void }) {
  const { c, store, pname } = useData();
  const { isMember } = useAuth();
  const open = draftOpen(L);
  const turn: Side | "" = open ? L.captains!.order[L.captains!.i] : "";
  const rankList = Object.values(c.st)
    .filter((x) => x.g)
    .sort((a, b) => b.rating - a.rating)
    .map((x) => x.id);

  const side = (ids: string[], k: Side) => (
    <div className={`side ${k === "blue" ? "b" : "r"}${turn === k ? " turn" : ""}${open ? "" : " reveal"}`}>
      <h3>
        {k === "blue" ? "Blue side" : "Red side"}
        {turn === k ? <span className="picking">Picking</span> : <small>avg {teamAvg(c, ids)}</small>}
      </h3>
      {ids.map((id, j) => {
        const r = rankList.indexOf(id) + 1;
        return (
          <div className="pl" key={id}>
            <Avatar id={id} />
            <div>
              <b>
                {pname(id)}
                {L.captains && j === 0 && <span className="tag2">Captain</span>}
                {r > 0 && r <= 3 && <span className="rank">#{r}</span>}
              </b>
              <div className="rt">
                Rating {rating(c, id)} · {c.st[id]?.w ?? 0}–{c.st[id]?.l ?? 0}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const hunt = bountyTarget(c, [...L.blue, ...L.red]);
  return (
    <div key={L.id}>
      <div className="board" data-testid="board">
        {side(L.blue, "blue")}
        <div className={`vs${open ? "" : " reveal"}`}>VS</div>
        {side(L.red, "red")}
      </div>
      {L.sitOut.length > 0 && <p className="sit">Sitting out: {L.sitOut.map(pname).join(", ")}</p>}
      {open ? (
        <div className="panel" style={{ marginTop: 16 }} data-testid="captain-pick">
          <div className="ph">
            <h3>
              {pname(turn === "blue" ? L.blue[0] : L.red[0])} picks for {turn === "blue" ? "Blue" : "Red"}
            </h3>
            <p className="sub">
              Pick {L.captains!.i + 1} of {L.captains!.order.length}
              {L.captains!.i === 0 && " · lower rated captain goes first"}
            </p>
          </div>
          <div className="chips">
            {L.captains!.pool.map((id) => (
              <button
                key={id}
                type="button"
                className="chip"
                aria-pressed="false"
                disabled={!isMember}
                onClick={() => store.setLive(captainPick(L, id))}
              >
                <Avatar id={id} />
                {pname(id)}
                <small>{rating(c, id)}</small>
              </button>
            ))}
          </div>
          <div className="win">
            <button className="btn ghost" type="button" disabled={!isMember || !L.captains!.i} onClick={() => store.setLive(captainUndo(L))}>
              Undo last pick
            </button>
          </div>
        </div>
      ) : (
        <>
          {hunt && (
            <div className="info bounty">
              <Target aria-hidden />
              <div>
                <b>Bounty on {pname(hunt)}.</b> {c.st[hunt].streak} wins in a row. {L.blue.includes(hunt) ? "Red" : "Blue"} side can
                end it tonight.
              </div>
            </div>
          )}
          <WinChance blue={L.blue} red={L.red} />
          {isMember && (
            <div className="win">
              <button className="btn pri" type="button" onClick={onLock}>
                Lock teams and go to champ select
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
