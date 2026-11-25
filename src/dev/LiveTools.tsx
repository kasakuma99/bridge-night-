import { useEffect, useRef, useState } from "react";
import { useData } from "../data/context";
import { nextFeed } from "../lib/live";
import { shuffle } from "../lib/util";
import type { LiveFeed, TeamSize } from "../lib/types";
import { Sim, type SimEnd } from "./sim";

/* Development only (see Live.tsx and Layout.tsx): never part of the production build. */

/** npm run dev:live: shows what the local reader sees in League. */
export function LiveBridge() {
  const { store } = useData();
  useEffect(() => {
    let stop = false;
    const look = async () => {
      try {
        const res = await fetch("/__live");
        if (!res.ok) return;
        const body = (await res.json()) as { feed: LiveFeed | null };
        if (!stop) await store.setFeed(body.feed);
      } catch {
        /* the dev server is restarting */
      }
    };
    void look();
    const t = setInterval(() => void look(), 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [store]);
  return null;
}

/** Survives visiting other pages, but not a reload. */
let sim: Sim | null = null;
let feed: LiveFeed | null = null;
let seed = Date.now() % 100_000;

const ENDS: [SimEnd, string][] = [
  ["nexus", "Nexus"],
  ["ff", "Surrender"],
  ["early", "Early surrender"],
  ["left", "Team leaves"],
  ["none", "Everyone leaves"],
  ["quit", "Only helper leaves"],
];

/** Plays a fake game, through the same code as a real one. */
export function SimPanel() {
  const { store, active } = useData();
  const [, redraw] = useState(0);
  const [kind, setKind] = useState("3v3");
  const [speed, setSpeed] = useState(10);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const push = async () => {
    if (!sim) return;
    const ids = new Map(active.map((p) => [`${p.name}#SIM`, p.id]));
    feed = nextFeed(feed, sim.reading(Date.now()));
    // Fake Riot IDs, so nobody needs a real one to try this.
    await store.setFeed(feed && { ...feed, players: feed.players.map((p) => ({ ...p, playerId: ids.get(p.riotId ?? "") })) });
    redraw((n) => n + 1);
  };
  const pushRef = useRef(push);
  pushRef.current = push;
  useEffect(() => {
    const t = setInterval(() => {
      if (!sim || sim.ended) return;
      sim.step(speedRef.current);
      void pushRef.current();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const begin = () => {
    const names = shuffle(active.map((p) => `${p.name}#SIM`));
    const solo = kind === "solo" || kind === "bots";
    const [b, r] = solo ? [1, 0] : kind.split("v").map(Number);
    const full = Array.from({ length: 10 }, (_, i) => names[i] ?? `Guest ${i}#SIM`) as string[];
    const size = kind === "bots" ? 4 : 0;
    sim = new Sim({ blue: full.slice(0, b), red: full.slice(b, b + r), blueBots: 0, redBots: size as TeamSize | 0, seed: ++seed });
    feed = null;
    void push();
  };
  const act = (f: (s: Sim) => void) => {
    if (!sim) return;
    f(sim);
    void push();
  };

  return (
    <details className="panel simpanel">
      <summary>Simulated game (only on localhost)</summary>
      <div className="controls">
        <select className="f" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Simulated size">
          {["1v1", "2v2", "3v3", "3v2", "4v4", "5v5", "solo", "bots"].map((k) => (
            <option key={k} value={k}>
              {k === "solo" ? "Alone" : k === "bots" ? "Alone against bots" : k}
            </option>
          ))}
        </select>
        <button className="btn sm" type="button" onClick={begin}>
          1. Champ select
        </button>
        <button className="btn sm" type="button" disabled={!sim || !!sim.ended} onClick={() => act((s) => s.load())}>
          2. Loading screen
        </button>
        <button className="btn sm" type="button" disabled={!sim || !!sim.ended} onClick={() => act((s) => s.start())}>
          3. Start game
        </button>
        <select className="f" value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Simulated speed">
          {[1, 10, 30].map((x) => (
            <option key={x} value={x}>
              {x}x speed
            </option>
          ))}
        </select>
      </div>
      <div className="controls">
        <span className="sub">End it:</span>
        {ENDS.map(([e, label]) => (
          <button
            key={e}
            className="btn sm ghost"
            type="button"
            disabled={!sim || !sim.clock || !!sim.ended}
            onClick={() => act((s) => s.finish(e, Math.random() < 0.5 ? 100 : 200))}
          >
            {label}
          </button>
        ))}
        {sim?.ended && !sim.history && sim.ended !== "none" && (
          <button className="btn sm" type="button" onClick={() => act((s) => (s.ended === "quit" ? s.othersFinish() : (s.history = true)))}>
            {sim.ended === "quit" ? "The others finish" : "Augments arrive"}
          </button>
        )}
      </div>
    </details>
  );
}
