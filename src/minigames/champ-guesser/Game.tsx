/* Champion guesser: one game. The setup picks the picture (Pixelated / Colours / Both) and Solo or Versus. */
import { useState } from "react";
import type { MinigameProps } from "../types";
import VersusHost from "./Host";
import VersusJoin from "./Join";
import { HOLD_MS, HOST_SAVE_KEY, MODE_LABEL, MODE_MULT, MODE_STEPS, MODES, ROOM_HOST_KEY, ROUND_SIZE, RULES, RULES_LABEL, SKIPS_SIZE, SKIP_WRONG, STEP_MS, TIMED_MS, WRONG_COST, parseHostSave, type Mode, type Rules } from "./logic";
import Solo from "./Solo";
import { RoomBoundary } from "./VersusViews";
import "./champ-guesser.css";

const MODE_HELP: Record<Mode, string> = {
  pixel: "Huge pixel blocks that sharpen step by step.",
  colours: "Only the main colours at first, then a blurry flat-colour picture.",
  mixed: "Pixel blocks in the wrong colours. Harder, worth more.",
};
const INTRO: Record<Mode, string> = {
  pixel: "as a few huge pixel blocks",
  colours: "as just a few blobs of its main colours",
  mixed: "as big blocks in the wrong colours",
};
const RULES_HELP: Record<Rules, string> = {
  classic: `${ROUND_SIZE} champions. Guess early for more points.`,
  timed: `${TIMED_MS / 1000} seconds. Name as many as you can, skipping is free. Solo only.`,
  skips: `${SKIPS_SIZE} champions, no clock. Fewest skips wins.`,
};
type Play = "solo" | "versus";
const PREF = "bn-champ-guesser";

/** After a refresh while hosting: the engine still has the room code, so go straight back into the host view. */
function hostResume(): { mode: Mode; rules: Rules } | null {
  try {
    const room = JSON.parse(sessionStorage.getItem(ROOM_HOST_KEY) ?? "null") as { code?: unknown } | null;
    if (!room || typeof room.code !== "string" || !room.code) return null;
    const game = parseHostSave(sessionStorage.getItem(HOST_SAVE_KEY));
    return { mode: game?.vs.mode ?? loadPref().mode, rules: game?.vs.rules ?? "classic" };
  } catch {
    return null;
  }
}

function loadPref(): { mode: Mode; play: Play; rules: Rules } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? "{}");
    return { mode: MODES.includes(p.mode) ? p.mode : "pixel", play: p.play === "versus" ? "versus" : "solo", rules: RULES.includes(p.rules) ? p.rules : "classic" };
  } catch {
    return { mode: "pixel", play: "solo", rules: "classic" };
  }
}

export default function ChampGuesser({ onScore, onExit, onPlay, joinCode }: MinigameProps) {
  // Opened from a join link or "Open rooms": straight into that room as a player.
  if (joinCode)
    return (
      <RoomBoundary key={joinCode} onBack={onExit}>
        <VersusJoin code={joinCode} onExit={onExit} onPlay={onPlay} />
      </RoomBoundary>
    );
  return <Main onScore={onScore} onExit={onExit} onPlay={onPlay} />;
}

function Main({ onScore, onExit, onPlay }: Pick<MinigameProps, "onScore" | "onExit" | "onPlay">) {
  const [resume] = useState(hostResume);
  const [pref] = useState(loadPref);
  const [mode, setMode] = useState<Mode>(resume?.mode ?? pref.mode);
  const [play, setPlay] = useState<Play>(resume ? "versus" : pref.play);
  const [pickedRules, setRules] = useState<Rules>(resume?.rules ?? pref.rules);
  // Timed is solo only: a Versus room falls back to Classic.
  const rules: Rules = play === "versus" && pickedRules === "timed" ? "classic" : pickedRules;
  const [screen, setScreen] = useState<"setup" | "play">(resume ? "play" : "setup");
  // Only the first host view after a refresh resumes; a room opened later from the setup starts fresh.
  const [resuming, setResuming] = useState(!!resume);
  const setup = () => {
    setResuming(false);
    setScreen("setup");
  };

  if (screen === "play" && play === "solo") return <Solo mode={mode} rules={rules} onScore={onScore} onExit={onExit} onSetup={setup} />;
  if (screen === "play")
    return (
      <RoomBoundary onBack={setup}>
        <VersusHost mode={mode} rules={rules === "skips" ? "skips" : "classic"} resume={resuming} onBack={setup} onPlay={onPlay} />
      </RoomBoundary>
    );

  const go = () => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ mode, play, rules: pickedRules }));
    } catch {
      /* private mode: fine */
    }
    setResuming(false);
    setScreen("play");
    onPlay();
  };

  return (
    <div className="arc-stage arc-cg arc-cg-setup">
      <h2 className="arc-cg-title">Champion guesser</h2>
      <fieldset className="arc-cg-pick">
        <legend>Picture</legend>
        <div className="arc-cg-opts three">
          {MODES.map((m) => (
            <label key={m} className={`arc-cg-opt${mode === m ? " on" : ""}`}>
              <input type="radio" className="arc-visually-hidden" name="cg-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
              <b>{MODE_LABEL[m]}</b>
              <span>{MODE_HELP[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="arc-cg-pick">
        <legend>Rules</legend>
        <div className="arc-cg-opts three">
          {RULES.map((r) => {
            const off = r === "timed" && play === "versus";
            return (
              <label key={r} className={`arc-cg-opt${rules === r ? " on" : ""}${off ? " off" : ""}`}>
                <input type="radio" className="arc-visually-hidden" name="cg-rules" value={r} checked={rules === r} disabled={off} onChange={() => setRules(r)} />
                <b>{RULES_LABEL[r]}</b>
                <span>{RULES_HELP[r]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="arc-cg-pick">
        <legend>Play</legend>
        <div className="arc-cg-opts">
          <label className={`arc-cg-opt${play === "solo" ? " on" : ""}`}>
            <input type="radio" className="arc-visually-hidden" name="cg-play" value="solo" checked={play === "solo"} onChange={() => setPlay("solo")} />
            <b>Solo</b>
            <span>Your score goes on the {rules === "classic" ? MODE_LABEL[mode] : RULES_LABEL[rules]} leaderboard.</span>
          </label>
          <label className={`arc-cg-opt${play === "versus" ? " on" : ""}`}>
            <input type="radio" className="arc-visually-hidden" name="cg-play" value="versus" checked={play === "versus"} onChange={() => setPlay("versus")} />
            <b>Versus</b>
            <span>Open a room and stream it. Friends join on the site and race you from their own device.</span>
          </label>
        </div>
      </fieldset>
      <ul className="arc-cg-rules">
        {rules === "timed" ? (
          <>
            <li>One clock for the whole run: {TIMED_MS / 1000} seconds. Each picture still gets clearer every {STEP_MS / 1000} s.</li>
            <li>Name a champion or skip it, the next one comes right away. Wrong names and skips cost nothing but time.</li>
            <li>Your score is how many champions you named. Tab completes a name, Esc on an empty box skips.</li>
          </>
        ) : rules === "skips" ? (
          <>
            <li>{play === "solo" ? SKIPS_SIZE : "Each"} champion{play === "solo" ? "s" : ""}, no clock: the picture gets clearer and then stays until you name it or skip.</li>
            <li>{SKIP_WRONG} wrong names on one champion count as a skip. Fewest skips wins{play === "versus" ? ", points (for guessing early) break ties" : ""}.</li>
            <li>{play === "solo" ? "Your skips go on the Fewest skips leaderboard (lowest wins)." : "Versus scores don't go on the leaderboard."}</li>
          </>
        ) : play === "solo" ? (
          <>
            <li>
              Each champion starts {INTRO[mode]} and gets clearer every {STEP_MS / 1000} s ({(MODE_STEPS[mode].length * STEP_MS + HOLD_MS) / 1000} s in all).
            </li>
            <li>The sooner you guess, the more points: up to 1000 per champion{MODE_MULT[mode] > 1 ? `, ×${MODE_MULT[mode]} in this mode (still max 1000)` : ""}.</li>
            <li>Wrong names cost {WRONG_COST}. Enter guesses, Tab completes a name, Esc clears, Esc on an empty box skips.</li>
          </>
        ) : (
          <>
            <li>You host: pick the number of champions and the hint speed in the room, then send the link in Discord.</li>
            <li>Everyone guesses on their own screen. Same points as solo: the earlier the hint, the more you get.</li>
            <li>Versus scores don't go on the leaderboard.</li>
          </>
        )}
      </ul>
      <div className="arc-cg-row">
        <button className="btn pri" onClick={go} autoFocus>
          {play === "solo" ? "Start" : "Open a room"}
        </button>
        <button className="btn ghost" onClick={onExit}>
          Back
        </button>
      </div>
    </div>
  );
}
