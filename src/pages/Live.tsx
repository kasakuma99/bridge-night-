import { Fragment, lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Crown, Hourglass, WifiOff } from "lucide-react";
import { SAMPLE_MODE, useAuth, useData, useNow } from "../data/context";
import { GameBoard, usePlayerName } from "../components/GameBoard";
import { Empty, useConfirm, useToast } from "../components/ui";
import { RECENT_MS, clockOf, endText, eventText, hasAugments, isStale, needsWinner, showFeed, waitingForResult } from "../lib/live";
import type { FeedStatus, LiveFeed, Side } from "../lib/types";
import { fmtTime, mmss } from "../lib/util";

// Only on localhost with sample data: the fake game isn't in the production build.
const SimPanel =
  import.meta.env.DEV && SAMPLE_MODE && !import.meta.env.VITE_LIVE
    ? lazy(() => import("../dev/LiveTools").then((m) => ({ default: m.SimPanel })))
    : null;

const STEPS: [FeedStatus[], string][] = [
  [["select"], "Champ Select"],
  [["loading", "playing"], "In Game"],
  [["ended"], "Recently Ended"],
];
const TITLE: Record<FeedStatus, string> = { select: "Champ Select", loading: "In Game", playing: "In Game", ended: "Recently Ended" };

export default function Live() {
  const { data } = useData();
  const now = useNow(1000);
  const f = showFeed(data.feed, now) ? data.feed : null;
  const at = f ? STEPS.findIndex(([s]) => s.includes(f.status)) : -1;

  return (
    <section>
      <div className="head">
        <div>
          <h1>{f ? TITLE[f.status] : "Live game"}</h1>
          <ol className="steps" aria-label="Game status">
            {STEPS.map(([, label], k) => (
              <li key={label} className={k === at ? "on" : k < at ? "done" : ""} aria-current={k === at ? "step" : undefined}>
                <em>{k < at ? <Check aria-label="done" /> : k + 1}</em>
                {label}
              </li>
            ))}
          </ol>
        </div>
        {f && <Clock f={f} now={now} />}
      </div>
      {f ? (
        <Game f={f} now={now} />
      ) : (
        <Empty title="No game running" text="Start a custom game in League. It shows up here on its own, as long as one player runs the helper app.">
          <Link className="btn pri" to="/">
            Make teams
          </Link>
          <Link className="btn ghost" to="/history">
            Past games
          </Link>
        </Empty>
      )}
      {SimPanel && (
        <Suspense fallback={null}>
          <SimPanel />
        </Suspense>
      )}
    </section>
  );
}

function Clock({ f, now }: { f: LiveFeed; now: number }) {
  const where = [f.mode, f.map].filter(Boolean).join(" · ");
  const sec = f.status === "playing" ? clockOf(f, now) : f.status === "ended" ? f.end?.durationSec : undefined;
  return (
    <div className="gameclock">
      {sec != null && (
        <div className="timer" role="timer" aria-label={f.status === "ended" ? "Game length" : "Game time"}>
          {mmss(sec * 1000)}
        </div>
      )}
      {f.status === "loading" && <span className="sub">Loading screen</span>}
      {where && <span className="sub">{where}</span>}
    </div>
  );
}

function Game({ f, now }: { f: LiveFeed; now: number }) {
  const ended = f.status === "ended";
  const winner = f.choice === "blue" || f.choice === "red" ? f.choice : f.end?.winner;
  const augments = hasAugments(f.mode, f.players);
  const pending = augments && !f.players.some((p) => p.augments?.length) && !f.end?.aborted && now - (f.end?.at ?? now) < RECENT_MS;
  return (
    <>
      {isStale(f, now) && (
        <div className="info warn" role="status">
          <WifiOff aria-hidden />
          <div>
            No updates since <b>{fmtTime(f.updatedAt)}</b>. The player running the helper may have left or closed League.
          </div>
        </div>
      )}
      {ended && <Outcome f={f} now={now} winner={winner} />}
      <GameBoard players={f.players} finished={ended} winner={ended ? winner : undefined} augments={augments} augmentsPending={ended && pending} />
      {f.status === "select" && <p className="note">Champions show up on the loading screen, when both teams can see them.</p>}
      {ended && f.savedAs && (
        <p className="sit">
          Saved in <Link to={`/history?game=${encodeURIComponent(f.savedAs)}`}>Past games</Link>.
        </p>
      )}
      {f.status === "playing" && <Log f={f} />}
    </>
  );
}

function Outcome({ f, now, winner }: { f: LiveFeed; now: number; winner?: Side }) {
  const { store } = useData();
  const { isMember } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const decide = async (choice: Side | "skip") => {
    if (choice === "skip" && !(await confirm({ title: "Don't count this game?", text: "It won't be in Past games or Stats.", yes: "Don't count it" }))) return;
    setBusy(true);
    try {
      await store.decideFeed(f.id, choice);
      toast(choice === "skip" ? "Game not counted" : `${choice === "blue" ? "Blue" : "Red"} side win saved`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the result", { err: true });
    } finally {
      setBusy(false);
    }
  };

  if (winner) {
    const why = f.choice ? "" : endText(winner, f.end?.reason);
    return (
      <div className={`outcome ${winner === "blue" ? "b" : "r"}`} role="status">
        <Crown aria-hidden />
        <div>
          <b>{winner === "blue" ? "Blue" : "Red"} side won</b>
          <span>{why || (f.choice ? "Result entered by a member" : "How it ended is not known yet")}</span>
        </div>
      </div>
    );
  }
  if (waitingForResult(f, now))
    return (
      <div className="info" role="status">
        <Hourglass aria-hidden />
        <div>The game is over. Waiting for the result from League.</div>
      </div>
    );
  return (
    <div className="info warn" role="status">
      <Hourglass aria-hidden />
      <div>
        <b>Ended, no result.</b> League didn't name a winner.{isMember ? " Who won?" : " A member can enter it."}
      </div>
      {isMember && needsWinner(f, now) && (
        <div className="acts2">
          <button className="btn sm blue" type="button" disabled={busy} onClick={() => void decide("blue")}>
            Blue won
          </button>
          <button className="btn sm red" type="button" disabled={busy} onClick={() => void decide("red")}>
            Red won
          </button>
          <button className="btn sm ghost" type="button" disabled={busy} onClick={() => void decide("skip")}>
            Don't count
          </button>
        </div>
      )}
    </div>
  );
}

function Log({ f }: { f: LiveFeed }) {
  const name = usePlayerName();
  const by = new Map(f.players.map((p) => [p.key, p]));
  const label = (key?: string) => {
    const p = key ? by.get(key) : undefined;
    return name(p);
  };
  const sideOf = (key?: string) => (key ? by.get(key)?.side : undefined);
  const list = f.events.slice(-30).reverse();
  return (
    <div className="panel gamelog">
      <h2>Log</h2>
      {list.length ? (
        <ol>
          {list.map((e) => {
            const s = e.type === "ace" ? e.side : sideOf(e.by);
            return (
              <Fragment key={e.id}>
                <li className={s === "blue" ? "b" : s === "red" ? "r" : ""}>
                  <time>{mmss(e.time * 1000)}</time>
                  <span>{eventText(e, label)}</span>
                </li>
              </Fragment>
            );
          })}
        </ol>
      ) : (
        <p className="sub">Nothing has happened yet.</p>
      )}
    </div>
  );
}
