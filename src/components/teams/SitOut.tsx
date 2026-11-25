import { Check, Dices, Hand, RotateCcw } from "lucide-react";
import { useData } from "../../data/context";
import { Avatar } from "../ui";
import type { SitMode } from "../../lib/teams";

const WHY: Record<SitMode, string> = {
  fair: "Fair rotation: whoever sat out last time plays first.",
  random: "Picked at random. Shuffle again for someone else.",
  pick: "Tap who sits out.",
};

/** One simple line: who sits out, plus Shuffle (random), Choose (tap) and Fair (back to the default). */
export function SitOut(props: {
  mode: SitMode;
  onMode: (m: SitMode) => void;
  /** Random pick; pressing it again picks someone else. */
  onShuffle: () => void;
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
  const { mode, extra, disabled } = props;
  const choosing = mode === "pick";
  return (
    <div className="tm-sit2" aria-live="polite">
      <div className="tm-sit2-row">
        <span className="tm-label">{extra > 1 ? `${extra} sit out` : "Sits out"}</span>
        {choosing ? (
          <span className={`tm-badge${props.picks.length === extra ? " ok" : ""}`}>
            {props.picks.length} of {extra} picked
          </span>
        ) : (
          <ul className="tm-outs">
            {props.out.map((p) => (
              <li key={p}>
                <Avatar id={p} />
                {pname(p)}
              </li>
            ))}
          </ul>
        )}
        <div className="tm-sit2-act">
          <button type="button" className="btn sm" disabled={disabled} onClick={props.onShuffle}>
            <Dices aria-hidden /> {mode === "random" ? "Shuffle again" : "Shuffle"}
          </button>
          <button type="button" className="btn sm ghost" aria-pressed={choosing} disabled={disabled} onClick={() => props.onMode("pick")}>
            <Hand aria-hidden /> Choose
          </button>
          {mode !== "fair" && (
            <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => props.onMode("fair")}>
              <RotateCcw aria-hidden /> Fair
            </button>
          )}
        </div>
      </div>
      <p className="tm-why">{WHY[mode]}</p>
      {choosing && (
        <div className="chips" role="group" aria-label="Pick who sits out">
          {props.selected.map((p) => {
            const on = props.picks.includes(p);
            return (
              <button key={p} type="button" className="chip tm-pick" aria-pressed={on} disabled={disabled} onClick={() => props.onPick(p)}>
                <Avatar id={p} />
                {pname(p)}
                {on && <Check aria-hidden className="tm-tick" />}
              </button>
            );
          })}
        </div>
      )}
      {props.apartOut.length > 0 && (
        <p className="note">
          Keep apart is skipped this game: {props.apartOut.map(pname).join(" and ")} {props.apartOut.length > 1 ? "sit" : "sits"} out.
        </p>
      )}
    </div>
  );
}
