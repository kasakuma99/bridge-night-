import { useId } from "react";
import { Check } from "lucide-react";
import { useData } from "../../data/context";
import { Avatar } from "../ui";
import type { SitMode } from "../../lib/teams";
import { plural } from "../../lib/util";

const MODES: [SitMode, string][] = [
  ["fair", "Fair rotation"],
  ["random", "Random"],
  ["pick", "Pick"],
];

const WHY: Record<SitMode, string> = {
  fair: "Whoever sat out last time plays first.",
  random: "Picked at random. A reroll may pick someone else.",
  pick: "",
};

/** "Who sits out": the mode choice plus a clear preview of who is out this game. */
export function SitOut(props: {
  mode: SitMode;
  onMode: (m: SitMode) => void;
  extra: number;
  selected: string[];
  /** Who sits out right now (planned, or of the current draft). */
  out: string[];
  picks: string[];
  onPick: (id: string) => void;
  /** Kept-apart players that sit out, so Keep apart is skipped. */
  apartOut: string[];
  disabled: boolean;
}) {
  const { pname } = useData();
  const id = useId();
  const { mode, extra } = props;
  return (
    <div className="tm-sitbox">
      <div className="tm-field">
        <span className="tm-label" id={id}>
          Who sits out
        </span>
        <div className="seg tm-radio" role="radiogroup" aria-labelledby={id}>
          {MODES.map(([m, label]) => (
            <label key={m}>
              <input
                type="radio"
                name={`${id}-mode`}
                value={m}
                checked={mode === m}
                disabled={props.disabled}
                onChange={() => props.onMode(m)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="tm-sitlist" aria-live="polite">
        {mode === "pick" ? (
          <>
            <p className="tm-sithead">
              Tap who sits out{" "}
              <span className={`tm-badge${props.picks.length === extra ? " ok" : ""}`}>
                {props.picks.length} of {extra} picked
              </span>
            </p>
            <div className="chips" role="group" aria-label="Pick who sits out">
              {props.selected.map((p) => {
                const on = props.picks.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    className="chip tm-pick"
                    aria-pressed={on}
                    disabled={props.disabled}
                    onClick={() => props.onPick(p)}
                  >
                    <Avatar id={p} />
                    {pname(p)}
                    {on && <Check aria-hidden className="tm-tick" />}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <p className="tm-sithead">
              {extra > 1 ? `${plural(extra, "player")} sit out` : "Sits out"}
              <span className="tm-why">{WHY[mode]}</span>
            </p>
            <ul className="tm-outs">
              {props.out.map((p) => (
                <li key={p}>
                  <Avatar id={p} />
                  {pname(p)}
                </li>
              ))}
            </ul>
          </>
        )}
        {props.apartOut.length > 0 && (
          <p className="note">Keep apart is skipped this game: {props.apartOut.map(pname).join(" and ")} {props.apartOut.length > 1 ? "sit" : "sits"} out.</p>
        )}
      </div>
    </div>
  );
}
