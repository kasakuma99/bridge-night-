import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Dices } from "lucide-react";
import { useAuth, useData, useDDragon, usePrefs } from "../data/context";
import { RuleInfo, rivalryText, useDodges } from "../components/bits";
import { Avatar, ChampAvatar, Empty, useConfirm, useToast } from "../components/ui";
import { CHALLENGES } from "../lib/champions";
import { FEATURES, pointsLabel } from "../lib/features";
import { compute, rating, rivalries, teamAvg } from "../lib/stats";
import type { LiveGame, LivePhase, ParticipantStats, Side } from "../lib/types";
import { mmss, rndInt } from "../lib/util";

const PHASES: [LivePhase, string][] = [
  ["select", "Champ select"],
  ["playing", "In game"],
  ["result", "Result"],
];

function Timer({ from }: { from: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="timer" role="timer" aria-label="Game time">
      {mmss(now - from)}
    </div>
  );
}

export default function LiveClassic() {
  const { data, c, store, pname, isActive } = useData();
  const { isMember } = useAuth();
  const { setPrefs } = usePrefs();
  const { dd } = useDDragon();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const dodges = useDodges();
  const [saving, setSaving] = useState(false);
  const L = data.live && data.live.phase !== "draft" ? data.live : null;

  const steps = (
    <ol className="steps" aria-label="Game steps">
      {PHASES.map(([p, label], k) => {
        const i = L ? PHASES.findIndex(([x]) => x === L.phase) : -1;
        return (
          <li key={p} className={k === i ? "on" : k < i ? "done" : ""} aria-current={k === i ? "step" : undefined}>
            <em>{k < i ? <Check aria-label="done" /> : k + 1}</em>
            {label}
          </li>
        );
      })}
    </ol>
  );

  if (!L)
    return (
      <section>
        <div className="head">
          <div>
            <h1>Live game</h1>
            {steps}
          </div>
        </div>
        <RuleInfo />
        <Empty title="No game running" text={
            FEATURES.classicTeams
              ? "Make teams first, then lock them to start champ select."
              : "Make teams first. Your game shows up here once the helper app sees it in League."
          }>
          <Link className="btn pri" to="/">
            Make teams
          </Link>
        </Empty>
      </section>
    );

  const set = (patch: Partial<LiveGame>) => store.setLive({ ...L, ...patch });
  const setStat = (id: string, patch: Partial<ParticipantStats>) =>
    set({ stats: { ...L.stats, [id]: { ...L.stats[id], ...patch } } });
  const sideOf = (id: string): Side => (L.blue.includes(id) ? "blue" : "red");

  const dodge = (id: string) => {
    const s = sideOf(id);
    // The champion may be unknown here: the helper only fills champions in once the game loads (fair play).
    const champ = L.stats[id]?.champion ?? "";
    if (dodges.left[s] <= 0) return;
    // A dodge restarts champ select: everyone gets new random champions, so all picks are cleared.
    // It still costs one dodge of the dodger's team.
    const stats = Object.fromEntries(
      Object.entries(L.stats).map(([pid, st]) => {
        const { champion: _drop, ...rest } = st;
        void _drop;
        return [pid, rest];
      }),
    );
    set({
      stats,
      dodgeLog: [...L.dodgeLog, { playerId: id, champion: champ, side: s, at: Date.now() }],
    });
    toast(`${pname(id)} dodged${champ ? ` ${champ}` : ""}. New champions for everyone. ${s === "blue" ? "Blue" : "Red"} has ${dodges.left[s] - 1} left tonight`);
  };

  const spin = () => {
    const opts = CHALLENGES.filter((x) => x !== L.challenge);
    const ch = opts[rndInt(opts.length)];
    set({ challenge: ch });
    toast(`Challenge: ${ch}`);
  };

  const cancel = async () => {
    const yes = await confirm({
      title: "Cancel this game?",
      text: `${FEATURES.dodges ? "Teams, picks and dodges" : "Teams and picks"} are thrown away. Nothing is saved.`,
      yes: "Cancel game",
    });
    if (!yes) return;
    await store.setLive(null);
    setPrefs({ rerolls: {} });
    nav("/");
    toast("Game cancelled");
  };

  const finish = async (winner: Side) => {
    if (saving) return;
    setSaving(true);
    try {
      const losers = winner === "blue" ? L.red : L.blue;
      const hunted = FEATURES.bounties
        ? losers.filter((id) => (c.st[id]?.streak ?? 0) >= 3).sort((a, b) => c.st[b].streak - c.st[a].streak)[0]
        : undefined;
      const huntedStreak = hunted ? c.st[hunted].streak : 0;
      const m = await store.saveResult(L.id, winner);
      if (!m) {
        toast("This game was already saved");
        nav("/history");
        return;
      }
      // Did a rivalry between two opponents of this game grow?
      const after = compute([...data.matches, m], data.players);
      const winners = winner === "blue" ? m.blue : m.red;
      const grew = FEATURES.rivals
        ? rivalries(after, isActive).find(
            (f) => winners.includes(f.leader) && (m.blue.includes(f.a) ? m.red : m.blue).includes(f.a === f.leader ? f.b : f.a),
          )
        : undefined;
      nav("/history");
      toast(
        hunted
          ? `Bounty claimed! ${pname(hunted)}'s ${huntedStreak}-win streak is over`
          : grew
            ? `${rivalryText(grew, pname).title}!`
            : `${winner === "blue" ? "Blue" : "Red"} side win saved`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the result", { err: true });
    } finally {
      setSaving(false);
    }
  };

  const pips = (s: Side) =>
    dodges.off ? (
      <small>no dodges</small>
    ) : (
      <span className="pips" aria-label={`${dodges.left[s]} dodges left tonight`}>
        {Array.from({ length: dodges.perTeam }, (_, k) => (
          <i key={k} className={k < dodges.left[s] ? "full" : ""} />
        ))}{" "}
        {dodges.left[s]} left
      </span>
    );

  const row = (id: string) => {
    const s = L.stats[id] ?? {};
    const champ = s.champion;
    if (L.phase === "select")
      return (
        <div className="pl" key={id}>
          {champ ? <ChampAvatar name={champ} /> : <Avatar id={id} />}
          <div>
            <b>{pname(id)}</b>
            <div className="rt">{champ ? `Locked in · ${champ}` : "Picking…"}</div>
          </div>
          {isMember && FEATURES.dodges ? (
            <button
              className="dodge"
              type="button"
              disabled={dodges.left[sideOf(id)] <= 0}
              onClick={() => dodge(id)}
              aria-label={`Dodge for ${pname(id)}`}
            >
              Dodge
            </button>
          ) : (
            <span />
          )}
          {isMember && (
            <select
              className="full"
              aria-label={`Champion for ${pname(id)}`}
              value={champ ?? ""}
              onChange={(e) => setStat(id, { champion: e.target.value || undefined })}
            >
              <option value="">Pick champion</option>
              {dd.champions.map((ch) => (
                <option key={ch.name}>{ch.name}</option>
              ))}
            </select>
          )}
        </div>
      );
    if (L.phase === "playing")
      return (
        <div className="pl" key={id}>
          <Avatar id={id} />
          <div>
            <b>{pname(id)}</b>
            <div className="rt">{pointsLabel(rating(c, id))}</div>
          </div>
          <span className="champ">
            {champ && <ChampAvatar name={champ} size={24} sq />}
            {champ ?? "–"}
          </span>
        </div>
      );
    return (
      <div className="pl" key={id}>
        {champ ? <ChampAvatar name={champ} /> : <Avatar id={id} />}
        <div>
          <b>{pname(id)}</b>
          <div className="rt">{champ ?? "No champion"}</div>
        </div>
        <span />
        {isMember && (
          <div className="kda">
            {(["kills", "deaths", "assists"] as const).map((k) => (
              <label key={k}>
                {k[0].toUpperCase() + k.slice(1)}
                <input
                  type="number"
                  min={0}
                  max={99}
                  inputMode="numeric"
                  value={s[k] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? undefined : Math.max(0, Math.min(99, Math.floor(+e.target.value) || 0));
                    setStat(id, { [k]: v });
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    );
  };

  const side = (ids: string[], k: Side) => (
    <div className={`side ${k === "blue" ? "b" : "r"}`}>
      <h3>
        {k === "blue" ? "Blue side" : "Red side"}
        {L.phase === "select"
          ? FEATURES.dodges && pips(k)
          : FEATURES.ratings && <small title="Average Elo of the players in this team">Team Elo {teamAvg(c, ids)}</small>}
      </h3>
      {ids.map(row)}
    </div>
  );

  const all = [...L.blue, ...L.red];
  const picked = all.filter((id) => L.stats[id]?.champion).length;
  const showChallenge = FEATURES.challenges && (data.settings.challengesEnabled || !!L.challenge);

  return (
    <section>
      <div className="head">
        <div>
          <h1>{L.phase === "select" ? "Champ select" : L.phase === "playing" ? "Game in progress" : "Enter the result"}</h1>
          {steps}
        </div>
        {L.phase === "playing" && L.startedAt && <Timer from={L.startedAt} />}
      </div>
      <RuleInfo inGame />
      {showChallenge &&
        (L.challenge ? (
          <div className="info">
            <Dices aria-hidden />
            <div>
              Challenge this game: <b>{L.challenge}</b>
            </div>
            {L.phase === "select" && isMember && (
              <div className="acts2">
                <button className="btn sm ghost" type="button" onClick={spin}>
                  Spin again
                </button>
                <button className="btn sm ghost" type="button" onClick={() => set({ challenge: undefined })}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ) : (
          L.phase === "select" &&
          isMember && (
            <button className="linkbtn" type="button" onClick={spin}>
              <Dices aria-hidden />
              Spin a random challenge (optional)
            </button>
          )
        ))}
      <div className="board">
        {side(L.blue, "blue")}
        <div className="vs">VS</div>
        {side(L.red, "red")}
      </div>
      {L.sitOut.length > 0 && <p className="sit">Sitting out: {L.sitOut.map(pname).join(", ")}</p>}
      {FEATURES.dodges && L.dodgeLog.length > 0 && (
        <p className="sit" data-testid="dodgelog">
          {L.dodgeLog.map((d) => `${pname(d.playerId)} dodged${d.champion ? ` ${d.champion}` : ""}`).join(" · ")}
        </p>
      )}
      {isMember ? (
        <div className="win">
          {L.phase === "select" && (
            <>
              <button className="btn pri" type="button" onClick={() => set({ phase: "playing", startedAt: Date.now() })}>
                {picked < all.length ? `Start game (${picked}/${all.length} picked)` : "All locked in, start game"}
              </button>
              <button className="btn ghost" type="button" onClick={cancel}>
                Cancel game
              </button>
            </>
          )}
          {L.phase === "playing" && (
            <>
              <button
                className="btn pri"
                type="button"
                onClick={() =>
                  set({ phase: "result", durationMin: Math.max(1, Math.round((Date.now() - (L.startedAt ?? Date.now())) / 6e4)) })
                }
              >
                Game over, enter result
              </button>
              <button className="btn ghost" type="button" onClick={() => set({ phase: "select" })}>
                Back to champ select
              </button>
            </>
          )}
          {L.phase === "result" && (
            <>
              <button className="btn blue" type="button" disabled={saving} onClick={() => finish("blue")}>
                Blue won
              </button>
              <button className="btn red" type="button" disabled={saving} onClick={() => finish("red")}>
                Red won
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="note">You're watching live. Members fill in picks and results.</p>
      )}
      {L.phase === "result" && isMember && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            type="checkbox"
            checked={!!L.surrender}
            onChange={(e) => set({ surrender: e.target.checked ? "ff" : undefined })}
          />
          <span>The losing team surrendered (FF)</span>
        </label>
      )}
      {L.phase === "result" && isMember && (
        <p className="note">
          K/D/A is optional. Leave it empty if you didn't check the scoreboard. <button className="linkbtn" style={{ margin: 0, minHeight: 0 }} type="button" onClick={() => set({ phase: "playing" })}>Back to the game</button>
        </p>
      )}
    </section>
  );
}
