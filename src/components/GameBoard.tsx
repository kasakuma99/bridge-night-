import { useData } from "../data/context";
import type { FeedPlayer, Side } from "../lib/types";
import { AugmentIcon, Avatar, ChampAvatar, ItemIcon, SpellIcon } from "./ui";

/** Name on the site, or what we know about someone who isn't on it. */
export function usePlayerName() {
  const { pname } = useData();
  return (p?: FeedPlayer) => (!p ? undefined : p.playerId ? pname(p.playerId) : p.bot ? `Bot${p.champion ? ` ${p.champion}` : ""}` : "Guest");
}

const SLOTS = 6;

/** Both teams, side by side: while playing and right after the game. */
export function GameBoard({ players, finished, winner, augments, augmentsPending }: {
  players: FeedPlayer[];
  /** Also show augments and Papi Points. */
  finished?: boolean;
  winner?: Side;
  /** The game has augments (ARAM: Mayhem). */
  augments?: boolean;
  augmentsPending?: boolean;
}) {
  const name = usePlayerName();

  const row = (p: FeedPlayer) => {
    const hasKda = p.kills != null && p.deaths != null && p.assists != null;
    // Empty slots keep the rows aligned while items are bought.
    const empty = p.champion && p.level != null ? Math.max(0, SLOTS - p.items.length) : 0;
    return (
      <li className={`gp${p.dead ? " dead" : ""}`} key={p.key}>
        <span className="gp-champ">
          {p.champion ? <ChampAvatar name={p.champion} sq size={46} /> : p.playerId ? <Avatar id={p.playerId} /> : <span className="ava unknown" aria-hidden>?</span>}
          {p.level != null && <em aria-label={`Level ${p.level}`}>{p.level}</em>}
        </span>
        <div className="gp-name">
          <b>{name(p)}</b>
          <small>{p.champion ? `${p.champion}${p.dead ? ", dead" : ""}` : "Champion not shown yet"}</small>
        </div>
        {hasKda && (
          <span className="gp-kda" aria-label={`${p.kills} kills, ${p.deaths} deaths, ${p.assists} assists`}>
            {p.kills}/{p.deaths}/{p.assists}
          </span>
        )}
        {finished && (
          <span className="gp-points" title="Papi Points from this game">
            -<small> PP</small>
          </span>
        )}
        {(p.spells.length > 0 || p.items.length > 0 || empty > 0) && (
          <div className="gp-gear">
            {p.spells.length > 0 && (
              <span className="itemrow spells" role="group" aria-label="Summoner spells">
                {p.spells.map((s, i) => (
                  <SpellIcon key={i} id={s} />
                ))}
              </span>
            )}
            <span className="itemrow" role="group" aria-label="Items">
              {p.items.map((it, i) => (
                <ItemIcon key={i} id={it} />
              ))}
              {Array.from({ length: empty }, (_, i) => (
                <span key={`e${i}`} className="item none" aria-hidden />
              ))}
            </span>
          </div>
        )}
        {finished && augments && (p.augments?.length || (augmentsPending && !p.bot)) ? (
          <div className="gp-augs">
            <small>Augments</small>
            {p.augments?.length ? p.augments.map((a, i) => <AugmentIcon key={i} id={a} />) : <small className="dim">waiting for League</small>}
          </div>
        ) : null}
      </li>
    );
  };

  const side = (s: Side) => {
    const list = players.filter((p) => p.side === s);
    return (
      <div className={`side ${s === "blue" ? "b" : "r"}`} data-testid={`side-${s}`}>
        <h3>
          {s === "blue" ? "Blue side" : "Red side"}
          <small>
            {winner && <b className={winner === s ? "won" : "lost"}>{winner === s ? "Won" : "Lost"}</b>}
          </small>
        </h3>
        {list.length ? <ul className="gps">{list.map(row)}</ul> : <p className="sub">Nobody</p>}
      </div>
    );
  };

  return (
    <div className="board game" data-testid="gameboard">
      {side("blue")}
      <div className="vs" aria-hidden>
        VS
      </div>
      {side("red")}
    </div>
  );
}

/** Everyone's stats of a past game. */
export function GameTable({ players, winner, augments }: { players: FeedPlayer[]; winner: Side; augments: boolean }) {
  const name = usePlayerName();
  const cols = augments ? 6 : 5;
  return (
    <div className="gtwrap">
      <table className="gt">
        <thead>
          <tr>
            <th>Player</th>
            <th>Champion</th>
            <th className="n">Level</th>
            <th className="n">K/D/A</th>
            <th>Items</th>
            {augments && <th>Augments</th>}
          </tr>
        </thead>
        {(["blue", "red"] as Side[]).map((s) => {
          const list = players.filter((p) => p.side === s);
          return (
            <tbody key={s} className={s === "blue" ? "b" : "r"}>
              <tr className="teamrow">
                <th colSpan={cols} scope="rowgroup">
                  {s === "blue" ? "Blue side" : "Red side"} · {winner === s ? "Won" : "Lost"}
                </th>
              </tr>
              {list.map((p) => (
                <tr key={p.key}>
                  <td className="nm">{name(p)}</td>
                  <td>
                    {p.champion ? (
                      <span className="chc">
                        <ChampAvatar name={p.champion} sq size={34} />
                        {p.champion}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="n">{p.level ?? "-"}</td>
                  <td className="n">{p.kills != null && p.deaths != null && p.assists != null ? `${p.kills}/${p.deaths}/${p.assists}` : "-"}</td>
                  <td>
                    {p.items.length ? (
                      <span className="itemrow">
                        {p.items.map((it, i) => (
                          <ItemIcon key={i} id={it} />
                        ))}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  {augments && (
                    <td>
                      {p.augments?.length ? (
                        <span className="itemrow">
                          {p.augments.map((a, i) => (
                            <AugmentIcon key={i} id={a} />
                          ))}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={cols} className="dimtd">
                    Nobody
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
