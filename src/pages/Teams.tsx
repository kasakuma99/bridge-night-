import { useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Search, Shuffle, X } from "lucide-react";
import { useAuth, useData } from "../data/context";
import { Avatar, Empty, useChoose, useConfirm, useToast } from "../components/ui";
import { POINTS_NAME, pointsLabel, pointsOf, shownPoints } from "../lib/features";
import { rating } from "../lib/stats";
import { TEAM_SIZES, makeTeams, sitPriority, teamPlan, type Sizes } from "../lib/teams";
import type { LiveGame, Side, TeamSize, TeamStyle } from "../lib/types";
import { plural } from "../lib/util";

/** "balanced" is what the generator calls Weighted. */
const FILTERS: [TeamStyle, string][] = [
  ["random", "True Random"],
  ["balanced", "Weighted"],
];
const filterName = (s?: TeamStyle) => FILTERS.find(([x]) => x === s)?.[1];

interface Setup {
  step: "start" | "mode" | "players";
  size: TeamSize;
  selected: string[];
  style: TeamStyle;
}
const fresh: Setup = { step: "start", size: 3, selected: [], style: "random" };

// Kept while you visit other pages, but not after a reload: the site always opens with "Create random teams".
let kept: Setup = fresh;

const vs = ([a, b]: Sizes) => `${a}v${b}`;

export default function Teams() {
  const { data, c, store, pname, active } = useData();
  const { isMember } = useAuth();
  const toast = useToast();
  const choose = useChoose();
  const confirm = useConfirm();
  const [setup, setSetup] = useState(kept);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);

  const update = (patch: Partial<Setup>) => {
    kept = { ...kept, ...patch };
    setSetup(kept);
  };

  const L = data.live;
  const running = !!L && L.phase !== "draft";
  const draft = L && L.phase === "draft" ? L : null;
  const { size, style } = setup;
  const selected = setup.selected.filter((id) => active.some((p) => p.id === id));
  const n = selected.length;

  const make = async (players: string[], sizes: Sizes, how: TeamStyle, current: LiveGame | null) => {
    setWorking(true);
    try {
      await store.setLive(
        makeTeams({
          selected: players,
          size: Math.max(...sizes) as TeamSize,
          sizes,
          style: how,
          ratingOf: (id) => pointsOf(rating(c, id)),
          sitPriority: sitPriority(data.matches, players),
          current,
        }),
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not make teams", { err: true });
    } finally {
      setWorking(false);
    }
  };

  const generate = async () => {
    const plan = teamPlan(n, size);
    if (plan.kind === "none") return;
    if (plan.kind === "full") return make(selected, plan.sizes, style, null);
    if (plan.kind === "short") {
      const ok = await confirm({
        title: `Not enough players for ${size}v${size}`,
        text: `${size}v${size} needs ${size * 2} players and you picked ${n}. You can play ${vs(plan.sizes)} instead.`,
        yes: `Play ${vs(plan.sizes)}`,
        danger: false,
      });
      if (ok) await make(selected, plan.sizes, style, null);
      return;
    }
    const out = (k: number) => (k ? `, ${k} ${k > 1 ? "sit" : "sits"} out` : "");
    const pick = await choose({
      title: "The teams will not be equal",
      text: `You picked ${plural(n, "player")}, which can't be split into two equal teams.`,
      choices: [
        ...(plan.uneven ? [{ value: "uneven", label: `Play uneven (${vs(plan.uneven.sizes)}${out(plan.uneven.out)})` }] : []),
        { value: "sit", label: `Keep it equal (${vs(plan.sit.sizes)}${out(plan.sit.out)})`, kind: "pri" as const },
      ],
    });
    const chosen = pick === "uneven" ? plan.uneven : pick === "sit" ? plan.sit : null;
    if (chosen) await make(selected, chosen.sizes, style, null);
  };

  const reroll = (d: LiveGame) =>
    make([...d.blue, ...d.red, ...d.sitOut, ...(d.captains?.pool ?? [])], [d.blue.length, d.red.length], d.style ?? "random", d);

  const reset = async () => {
    update({ selected: [], step: "players" });
    setQuery("");
    try {
      await store.setLive(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reset", { err: true });
    }
  };

  const cancelGame = async () => {
    if (!(await confirm({ title: "Cancel this game?", text: "The running game is thrown away. Nothing is saved.", yes: "Cancel game" }))) return;
    await store.setLive(null);
    toast("Game cancelled");
  };

  if (running && L)
    return (
      <section>
        <div className="head">
          <h1>Create random teams</h1>
        </div>
        <Empty title="A game is running" text={`${L.blue.map(pname).join(", ")} vs ${L.red.map(pname).join(", ")}`}>
          <Link className="btn pri" to="/live">
            Open live game
          </Link>
          {isMember && (
            <button className="btn ghost" type="button" onClick={cancelGame}>
              Cancel game
            </button>
          )}
        </Empty>
      </section>
    );

  if (draft) return <Result L={draft} working={working} onReroll={() => void reroll(draft)} onReset={() => void reset()} />;

  if (setup.step === "start")
    return (
      <section className="start">
        <h1 className="sr-only">Teams</h1>
        <button className="btn pri xl" type="button" disabled={!isMember} onClick={() => update({ step: "mode" })}>
          <Shuffle aria-hidden />
          Create random teams
        </button>
        {!isMember && <p className="sub">Log in as a member to make teams.</p>}
      </section>
    );

  if (setup.step === "mode")
    return (
      <section>
        <div className="head">
          <div>
            <h1>Create random teams</h1>
            <p className="sub">Choose a game mode.</p>
          </div>
        </div>
        <div className="modes" role="group" aria-label="Game mode">
          {TEAM_SIZES.map((k) => (
            <button key={k} className="mode" type="button" disabled={!isMember} onClick={() => update({ size: k, step: "players" })}>
              <b>
                {k}v{k}
              </b>
              <small>{k * 2} players</small>
            </button>
          ))}
        </div>
      </section>
    );

  const toggle = (id: string) => update({ selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  const q = query.trim().toLowerCase();
  const found = active.filter((p) => p.name.toLowerCase().includes(q));
  const plan = teamPlan(n, size);
  const samePoints = new Set(selected.map((id) => pointsOf(rating(c, id)))).size <= 1;

  return (
    <section>
      <div className="head">
        <h1>Create random teams</h1>
      </div>
      <div className="panel">
        <div className="modebar">
          <div className="seg" role="group" aria-label="Game mode">
            {TEAM_SIZES.map((k) => (
              <button key={k} type="button" aria-pressed={k === size} disabled={!isMember} onClick={() => update({ size: k })}>
                {k}v{k}
              </button>
            ))}
          </div>
          <span className="sub" style={{ margin: 0 }} aria-live="polite">
            {n} of {size * 2} players
            {plan.kind === "full" && plan.out > 0 && `, ${plan.out} will sit out`}
          </span>
        </div>

        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const hit = q && found.find((p) => !selected.includes(p.id));
            if (!hit || !isMember) return;
            toggle(hit.id);
            setQuery("");
          }}
        >
          <Search aria-hidden />
          <input
            className="f"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a name"
            aria-label="Search for a name"
            autoComplete="off"
          />
        </form>
        <div className="chips" role="group" aria-label="Players">
          {found.map((p) => (
            <button key={p.id} type="button" className="chip" aria-pressed={selected.includes(p.id)} disabled={!isMember} onClick={() => toggle(p.id)}>
              <Avatar id={p.id} />
              {p.name}
            </button>
          ))}
          {!found.length && <p className="sub">{active.length ? `No player called "${query.trim()}".` : "Nobody has signed in yet."}</p>}
        </div>

        <table className="ptable" aria-label="Chosen players">
          <thead>
            <tr>
              <th className="n">#</th>
              <th>Player</th>
              <th className="p">{POINTS_NAME}</th>
              <th className="x">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {n === 0 ? (
              <tr>
                <td className="none" colSpan={4}>
                  No players yet. Click a name to add it.
                </td>
              </tr>
            ) : (
              selected.map((id, i) => (
                <tr key={id}>
                  <td className="n">{i + 1}</td>
                  <td>
                    <span className="who">
                      <Avatar id={id} />
                      {pname(id)}
                    </span>
                  </td>
                  <td className="p">{shownPoints(rating(c, id))}</td>
                  <td className="x">
                    <button className="icon" type="button" disabled={!isMember} aria-label={`Remove ${pname(id)}`} onClick={() => toggle(id)}>
                      <X aria-hidden />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="controls" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="seg" role="group" aria-label="How to sort the teams">
            {FILTERS.map(([s, label]) => (
              <button key={s} type="button" aria-pressed={style === s} disabled={!isMember} onClick={() => update({ style: s })}>
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <button className="btn pri" type="button" disabled={!isMember || n < 2 || working} onClick={() => void generate()}>
            Generate teams
          </button>
        </div>
        {style === "balanced" && n > 1 && samePoints && (
          <p className="note">Everyone here has the same {POINTS_NAME}, so Weighted works like True Random for now.</p>
        )}
      </div>
    </section>
  );
}

function Result({ L, working, onReroll, onReset }: { L: LiveGame; working: boolean; onReroll: () => void; onReset: () => void }) {
  const { c, pname } = useData();
  const { isMember } = useAuth();
  const side = (ids: string[], k: Side) => (
    <div className={`side ${k === "blue" ? "b" : "r"} reveal`}>
      <h3>
        {k === "blue" ? "Blue side" : "Red side"}
        <small>{plural(ids.length, "player")}</small>
      </h3>
      {ids.map((id) => (
        <div className="pl" key={id}>
          <Avatar id={id} />
          <div>
            <b>{pname(id)}</b>
            <div className="rt">{pointsLabel(rating(c, id))}</div>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <section>
      <div className="head">
        <div>
          <h1>Teams</h1>
          <p className="sub">{[vs([L.blue.length, L.red.length]), filterName(L.style)].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <div className="board" data-testid="board" key={L.id}>
        {side(L.blue, "blue")}
        <div className="vs reveal">VS</div>
        {side(L.red, "red")}
      </div>
      {L.sitOut.length > 0 && <p className="sit">Sitting out: {L.sitOut.map(pname).join(", ")}</p>}
      {isMember && (
        <div className="win">
          <button className="btn pri" type="button" disabled={working} onClick={onReroll}>
            <Shuffle aria-hidden />
            Reroll
          </button>
          <button className="btn ghost" type="button" disabled={working} onClick={onReset}>
            <RotateCcw aria-hidden />
            Reset
          </button>
        </div>
      )}
    </section>
  );
}
