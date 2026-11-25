import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Shuffle } from "lucide-react";
import { useAuth, useData, usePrefs } from "../data/context";
import { FeudBanner, HeroArt, RuleInfo, useDodges } from "../components/bits";
import { Avatar, Empty, useConfirm, useToast } from "../components/ui";
import { Board } from "../components/teams/Board";
import { SitOut } from "../components/teams/SitOut";
import { rating, rivalries } from "../lib/stats";
import {
  canDraft,
  defaultSize,
  extraPlayers,
  makeTeams,
  maxSize,
  planSitOut,
  rerollKey,
  rerollsLeft,
  sitPriority,
  strSeed,
  toggleSitPick,
  validPicks,
  type SitMode,
} from "../lib/teams";
import type { TeamSize, TeamStyle } from "../lib/types";
import { DAY, fmtDuration, plural, seeded } from "../lib/util";
import { StoreError } from "../data/store";
import "../styles/teams.css";

const STYLES: [TeamStyle, string, string][] = [
  ["random", "Random", "Any split, fully random."],
  ["balanced", "Balanced", "The closest Team Elo, picked at random among near-equal splits."],
  ["captains", "Captains", "Two captains pick in turns (A-B-B-A). The lower rated captain picks first."],
];

const freshSeed = () => strSeed(String(Math.random()));

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
  const [seed, setSeed] = useState(freshSeed);

  const L = data.live;
  const busy = !!L && L.phase !== "draft";
  const draft = L && L.phase === "draft" ? L : null;
  const left = rerollsLeft(limit, made);
  const ok = canDraft(limit, made);
  const extra = extraPlayers(n, size);

  // Who sits out. Fair rotation uses a seed from the selection + game count, so every device shows the same preview.
  const prio = sitPriority(data.matches, selected);
  const picks = validPicks(prefs.sitPick, selected);
  const planWith = (s: number) => {
    try {
      const rng = seeded(prefs.sitMode === "fair" ? strSeed(`${key}|${data.matches.length}`) : s ^ strSeed(key));
      return planSitOut({ selected, size, mode: prefs.sitMode, sitPriority: prio, picked: picks, rng });
    } catch {
      return null; // "pick" mode, not enough picked yet
    }
  };
  const plan = planWith(seed);
  const outNow = draft ? draft.sitOut : (plan ?? []);
  const [a1, a2] = prefs.apart;
  const apartOn = !!(a1 && a2 && a1 !== a2);
  const apartOut = apartOn ? outNow.filter((id) => id === a1 || id === a2) : [];

  const clearDraft = () => draft && store.setLive(null);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setPrefs({ selected: next });
    clearDraft();
  };
  const setMode = (m: SitMode) => {
    setPrefs({ sitMode: m });
    clearDraft();
  };
  const pickSit = (id: string) => {
    setPrefs({ sitPick: toggleSitPick(picks, id, extra) });
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
    // A reroll in Random mode may pick someone else to sit out.
    let sitOut = plan;
    if (draft && prefs.sitMode === "random") {
      const s = freshSeed();
      setSeed(s);
      sitOut = planWith(s);
    }
    if (!sitOut) {
      toast(`Pick ${plural(extra, "player")} to sit out`, { err: true });
      return;
    }
    const last = data.matches.slice().sort((a, b) => b.playedAt - a.playedAt)[0];
    try {
      const live = makeTeams({
        selected,
        size,
        style: prefs.style,
        ratingOf: (id) => rating(c, id),
        sitPriority: prio,
        sitOut,
        apart: apartOn ? [a1, a2] : null,
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
    setSeed(freshSeed());
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
  const optCount = (prefs.avoidLast ? 1 : 0) + (apartOn ? 1 : 0);
  const pickMissing = !busy && !draft && plan === null;

  const btnLabel = busy
    ? "Make teams"
    : !ok
      ? "No rerolls left"
      : draft
        ? left === Infinity
          ? "Reroll"
          : `Reroll · ${left} left`
        : pickMissing
          ? "Pick who sits out"
          : "Make teams";
  const styleInfo = STYLES.find(([s]) => s === prefs.style)!;

  return (
    <section aria-labelledby="t-h" className="tm">
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
                Top Elo <b>{pname(lead.id)}</b>
              </span>
            )}
          </div>
        </div>
      </div>

      {feud && <FeudBanner f={feud} />}
      <RuleInfo />

      <div className="panel tm-setup">
        <div className="tm-top">
          <h2>Players</h2>
          <p className="hint" aria-live="polite">
            {n < 2
              ? "Pick at least 2 players."
              : extra
                ? `${n} players in, ${extra} ${extra > 1 ? "sit" : "sits"} out this game.`
                : `${n} players, ${size}v${size}.`}
          </p>
        </div>

        <div className="chips tm-chips" role="group" aria-label="Who is playing">
          {active.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={selected.includes(p.id)}
              aria-describedby={`elo-${p.id}`}
              disabled={!isMember}
              onClick={() => toggle(p.id)}
            >
              <Avatar id={p.id} />
              <span className="tm-nm">{p.name}</span>
              <small id={`elo-${p.id}`} className="num" aria-hidden title="Elo">
                {rating(c, p.id)}
                <span className="tm-sr"> Elo</span>
              </small>
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

        <div className="tm-fields">
          <div className="tm-field">
            <span className="tm-label" id="t-size">
              Team size
            </span>
            <div className="seg" role="group" aria-labelledby="t-size">
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
          </div>
          <div className="tm-field">
            <span className="tm-label" id="t-style">
              Team style
            </span>
            <div className="seg" role="group" aria-labelledby="t-style">
              {STYLES.map(([s, label]) => (
                <button key={s} type="button" aria-pressed={prefs.style === s} disabled={!isMember} onClick={() => setPrefs({ style: s })}>
                  {label}
                </button>
              ))}
            </div>
            <p className="tm-desc">{styleInfo[2]}</p>
          </div>
        </div>

        {extra > 0 && (
          <SitOut
            mode={prefs.sitMode}
            onMode={setMode}
            extra={extra}
            selected={selected}
            out={outNow}
            picks={picks}
            onPick={pickSit}
            apartOut={apartOut}
            disabled={!isMember}
          />
        )}

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

        <div className="controls tm-go">
          <p className="tm-sum">
            {n >= 2 ? (
              <>
                <b>
                  {size}v{size}
                </b>{" "}
                · {styleInfo[1]}
                {extra > 0 && ` · ${extra} out`}
              </>
            ) : (
              "Nobody picked yet"
            )}
          </p>
          <button className="btn pri" type="button" disabled={!isMember || n < 2 || (!busy && (!ok || pickMissing))} onClick={generate}>
            {draft && ok && !busy && <Shuffle aria-hidden />}
            {btnLabel}
          </button>
        </div>
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
        <Board key={draft.id} L={draft} onLock={lock} />
      )}
    </section>
  );
}
