import type { CSSProperties } from "react";
import { Lock, Target, Undo2 } from "lucide-react";
import { useAuth, useData } from "../../data/context";
import { WinChance } from "../bits";
import { Avatar } from "../ui";
import { FEATURES, pointsLabel, shownPoints } from "../../lib/features";
import { bountyTarget, rating, teamAvg } from "../../lib/stats";
import { captainPick, captainUndo, draftOpen } from "../../lib/teams";
import type { LiveGame, Side } from "../../lib/types";
import { plural } from "../../lib/util";

/** The Blue side vs Red side reveal, the captains' draft, and "Lock teams". */
export function Board({ L, onLock }: { L: LiveGame; onLock: () => void }) {
  const { c, store, pname } = useData();
  const { isMember } = useAuth();
  const open = draftOpen(L);
  const cp = L.captains;
  const turn: Side | "" = open ? cp!.order[cp!.i] : "";
  const rankList = FEATURES.ratings
    ? Object.values(c.st)
        .filter((x) => x.g)
        .sort((a, b) => b.rating - a.rating)
        .map((x) => x.id)
    : [];

  const side = (ids: string[], k: Side) => (
    <div className={`side tm-side ${k === "blue" ? "b" : "r"}${turn === k ? " turn" : ""}${open ? "" : " reveal"}`}>
      <div className="tm-sh">
        <h3>{k === "blue" ? "Blue side" : "Red side"}</h3>
        {turn === k ? (
          <span className="picking">Picking</span>
        ) : (
          FEATURES.ratings && (
            <span className="tm-telo" title="Average Elo of the players in this team">
              <small>Team Elo</small>
              <b className="num">{teamAvg(c, ids)}</b>
            </span>
          )
        )}
      </div>
      {ids.map((id, j) => {
        const r = rankList.indexOf(id) + 1;
        return (
          <div className="pl" key={id} style={{ "--i": j } as CSSProperties}>
            <Avatar id={id} />
            <div>
              <b>
                {pname(id)}
                {cp && j === 0 && <span className="tag2">Captain</span>}
                {r > 0 && r <= 3 && <span className="rank">#{r}</span>}
              </b>
              <div className="rt">
                {plural(c.st[id]?.w ?? 0, "win")} · {plural(c.st[id]?.l ?? 0, "loss", "losses")}
              </div>
            </div>
            <span className="tm-r num" title={pointsLabel(rating(c, id))}>
              {shownPoints(rating(c, id))}
            </span>
          </div>
        );
      })}
      {open &&
        Array.from({ length: L.size - ids.length }, (_, j) => (
          <div className="tm-slot" key={j} aria-hidden>
            <span className="ava" />
            Open slot
          </div>
        ))}
    </div>
  );

  const hunt = FEATURES.bounties ? bountyTarget(c, [...L.blue, ...L.red]) : undefined;
  return (
    <div className="tm-result">
      <div className="board" data-testid="board">
        {side(L.blue, "blue")}
        <div className={`vs${open ? "" : " reveal"}`} aria-hidden>
          <span>VS</span>
        </div>
        {side(L.red, "red")}
      </div>
      {!open && <WinChance blue={L.blue} red={L.red} />}
      {L.sitOut.length > 0 && (
        <p className="sit">
          <span>Sitting out:</span>{" "}
          {L.sitOut.map((id) => (
            <span key={id} className="tm-sitp">
              <Avatar id={id} />
              {pname(id)}
            </span>
          ))}
        </p>
      )}
      {open ? (
        <div className="panel tm-draft" data-testid="captain-pick">
          <div className="ph">
            <h3>
              {pname(turn === "blue" ? L.blue[0] : L.red[0])} picks for {turn === "blue" ? "Blue" : "Red"}
            </h3>
            <p className="sub">
              Pick {cp!.i + 1} of {cp!.order.length}
              {FEATURES.ratings && cp!.i === 0 && " · lower rated captain goes first"}
            </p>
          </div>
          <div className="chips">
            {cp!.pool.map((id) => (
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
                {FEATURES.ratings && <small>{rating(c, id)}</small>}
              </button>
            ))}
          </div>
          <div className="win">
            <button className="btn ghost" type="button" disabled={!isMember || !cp!.i} onClick={() => store.setLive(captainUndo(L))}>
              <Undo2 aria-hidden />
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
          {isMember && (
            <div className="win">
              <button className="btn pri" type="button" onClick={onLock}>
                <Lock aria-hidden />
                Lock teams and go to champ select
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
