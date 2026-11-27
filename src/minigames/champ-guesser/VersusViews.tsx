/* Pieces shared by the Versus host screen (Host.tsx) and the player screen (Join.tsx). Presentational only. */
import { Component, type CSSProperties, type ReactNode } from "react";
import { champIcon, champSplash } from "../../lib/champions";
import { HINT_LABEL, HINT_SPEEDS, MODE_LABEL, MODES, RULES_LABEL, VS_ROUNDS, fmtSecs, vsRanking, vsStatus, type HintSpeed, type VsRoundResult, type VsSettings, type VsState } from "./logic";

/** Catches a room that can't open (e.g. rooms not set up yet) so the rest of the Arcade keeps working. */
export class RoomBoundary extends Component<{ onBack: () => void; children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Notice title="Versus isn't available right now" text={this.state.error}>
        <button className="btn pri" onClick={this.props.onBack} autoFocus>
          Back
        </button>
      </Notice>
    );
  }
}

/** A centred card with a title, a line of text and buttons. */
export function Notice({ title, text, busy, children }: { title: string; text?: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div className="arc-stage arc-cg arc-cg-card" role={busy ? "status" : undefined}>
      {busy && <span className="arc-cg-spin" aria-hidden="true" />}
      <h2 className="arc-cg-title">{title}</h2>
      {text && <p className="sub">{text}</p>}
      {children && <div className="arc-cg-row">{children}</div>}
    </div>
  );
}

export function TimerBar({ left }: { left: number }) {
  const l = Math.min(1, Math.max(0, left));
  return (
    <div className={`arc-timer arc-cg-timer${l < 0.25 && l > 0 ? " low" : ""}`} role="progressbar" aria-label="Time left" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(l * 100)} style={{ "--arc-left": l } as CSSProperties}>
      <i />
    </div>
  );
}

/** "Champion 3 / 10 · Pixelated" */
export function RoundLine({ vs, children }: { vs: VsState; children?: ReactNode }) {
  return (
    <div className="arc-cg-top">
      <span className="arc-kicker arc-cg-count">
        Champion <b className="num">{Math.max(1, vs.round)}</b> / {vs.rounds} · {MODE_LABEL[vs.mode]}
        {vs.rules === "skips" && ` · ${RULES_LABEL.skips}`}
      </span>
      {children}
    </div>
  );
}

/** The picture a player sees: the host's current step, or the full splash after the reveal. */
export function RoomPicture({ vs }: { vs: VsState }) {
  if (vs.phase === "reveal" && vs.reveal)
    return (
      <div className="arc-cg-picbox">
        <div className="arc-cg-frame revealed">
          <img key={vs.reveal.id} className="arc-cg-splash arc-reveal" src={champSplash(vs.reveal.id)} alt={`Splash art of ${vs.reveal.name}`} />
        </div>
      </div>
    );
  return (
    <div className="arc-cg-picbox">
      <div className="arc-cg-frame">
        {vs.image ? (
          <img className={`arc-cg-shot${vs.pixelated ? " px" : ""}`} src={vs.image} alt="Hidden champion art" />
        ) : (
          <div className="arc-cg-loading" role="status">
            <span className="arc-cg-spin" aria-hidden="true" />
            <span>Next champion…</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Live scores. During a round: who got it (with points and time) and who passed. Never shows the answer. */
export function Scoreboard({ vs, live, meId, hostId }: { vs: VsState; live: string[]; meId?: string; hostId?: string }) {
  const rows = vsRanking(vs, live).filter((r) => vs.hostPlays || r.id !== hostId || (vs.scores[r.id] ?? 0) > 0);
  const inRound = vs.phase === "round" || vs.phase === "reveal";
  const hits = vs.phase === "reveal" && vs.reveal ? vs.reveal.hits : vs.hits;
  const lead = rows[0]?.score ?? 0;
  const bySkips = vs.rules === "skips";
  return (
    <aside className="arc-cg-board" aria-label="Scoreboard">
      <h3>{bySkips ? "Skips (fewest wins)" : "Scores"}</h3>
      {rows.length === 0 ? (
        <p className="note">Waiting for players.</p>
      ) : (
        <ol className="arc-cg-vsboard">
          {rows.map((r) => {
            const hit = hits.find((h) => h.id === r.id);
            const status = vs.phase === "round" ? vsStatus(vs, r.id) : hit ? "right" : "out";
            const away = !live.includes(r.id);
            return (
              <li key={r.id} className={`${(bySkips ? r.place === 1 && vs.round > 0 : r.score > 0 && r.score === lead) ? "lead" : ""}${away ? " away" : ""}${r.id === meId ? " me" : ""}`}>
                <span className="arc-cg-place num">{r.place}</span>
                <span className="arc-cg-name">
                  {r.name}
                  {r.id === meId && <small> (you)</small>}
                </span>
                {inRound && !away && (
                  <span className={`arc-cg-chip ${status}`}>
                    {hit ? (bySkips ? (vs.phase === "reveal" ? `✓ ${fmtSecs(hit.ms)}` : "✓") : vs.phase === "reveal" ? `+${hit.points} · ${fmtSecs(hit.ms)}` : `+${hit.points}`) : status === "out" ? (bySkips ? "skip" : vs.phase === "round" ? "out" : "missed") : "…"}
                  </span>
                )}
                <b className="arc-cg-pts num" title={bySkips ? `${r.score} points` : undefined}>{bySkips ? r.skips : r.score}</b>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

/** After a round: the champion's name, how many got it and who was fastest. Points per player are on the scoreboard. */
export function RevealInfo({ result, names, steps, players }: { result: VsRoundResult; names: Record<string, string>; steps: number; players: number }) {
  const first = result.hits[0];
  return (
    <div className="arc-cg-revealinfo">
      <div key={result.id} className="arc-cg-answer on arc-reveal">
        <span className="arc-kicker">It was</span> {result.name}
      </div>
      <p className="arc-cg-gotit">
        {result.hits.length === 0 ? (
          "Nobody got this one."
        ) : (
          <>
            {result.hits.length} of {Math.max(players, result.hits.length)} got it. Fastest: <b>{names[first.id] ?? "someone"}</b> ({fmtSecs(first.ms)}, hint {first.step + 1}/{steps}, +{first.points})
          </>
        )}
      </p>
    </div>
  );
}

/** Game over: podium and a table of every round. */
export function EndView({ vs, version, meId, hostId, children }: { vs: VsState; version: string | null; meId?: string; hostId?: string; children?: ReactNode }) {
  const ranked = vsRanking(vs).filter((r) => vs.hostPlays || r.id !== hostId || r.score > 0);
  const bySkips = vs.rules === "skips";
  const shown = (r: { score: number; skips: number }) => (bySkips ? `${r.skips} ${r.skips === 1 ? "skip" : "skips"}` : r.score);
  const podium = ranked.slice(0, 3);
  // Plain ranked rows, 1st first.
  const order = podium;
  const cols = ranked.slice(0, 8);
  return (
    <div className="arc-stage arc-cg arc-cg-end">
      <span className="arc-kicker">
        Game over · {MODE_LABEL[vs.mode]}
        {bySkips && ` · ${RULES_LABEL.skips}`}
      </span>
      {podium.length === 0 ? (
        <p className="sub">Nobody scored.</p>
      ) : (
        <ol className="arc-cg-podium" aria-label="Podium">
          {order.map((r) => (
            <li key={r.id} className={`p${r.place}${r.id === meId ? " me" : ""}`} aria-label={`Place ${r.place}: ${r.name}, ${bySkips ? `${r.skips} skips` : `${r.score} points`}`}>
              <span className="arc-cg-name">{r.name}</span>
              <b className="num">{shown(r)}</b>
              <i aria-hidden="true">{r.place}</i>
            </li>
          ))}
        </ol>
      )}
      {vs.history.length > 0 && cols.length > 0 && (
        <div className="arc-cg-tablewrap">
          <table className="arc-cg-table">
            <thead>
              <tr>
                <th scope="col">Champion</th>
                {cols.map((r) => (
                  <th key={r.id} scope="col" className={r.id === meId ? "me" : ""}>
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vs.history.map((h) => {
                const icon = champIcon(version, h.id);
                const best = h.hits[0]?.id;
                return (
                  <tr key={h.round}>
                    <th scope="row">
                      {icon ? <img src={icon} alt="" width={28} height={28} loading="lazy" /> : null}
                      <span>{h.name}</span>
                    </th>
                    {cols.map((r) => {
                      const hit = h.hits.find((x) => x.id === r.id);
                      return (
                        <td key={r.id} className={`num${hit ? (hit.id === best ? " best" : " ok") : " miss"}`}>
                          {hit ? hit.points : bySkips && h.skipped?.includes(r.id) ? "skip" : "–"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{bySkips ? "Skips" : "Total"}</th>
                {cols.map((r) => (
                  <td key={r.id} className="num">
                    {bySkips ? r.skips : r.score}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {ranked.length > 3 && (
        <ol className="arc-standings arc-cg-rest" start={4}>
          {ranked.slice(3).map((r) => (
            <li key={r.id} className={r.id === meId ? "me" : ""}>
              <span>{r.name}</span>
              <b className="num">{shown(r)}</b>
            </li>
          ))}
        </ol>
      )}
      {children && <div className="arc-cg-row">{children}</div>}
    </div>
  );
}

const speedOf = (ms: number): HintSpeed => (Object.keys(HINT_SPEEDS) as HintSpeed[]).find((k) => HINT_SPEEDS[k] === ms) ?? "normal";

/** Room settings shown in the lobby. With `onChange` (host) they can be changed, otherwise read-only (players). */
export function SettingsView({ vs, onChange }: { vs: VsState; onChange?: (patch: Partial<VsSettings>) => void }) {
  if (!onChange)
    return (
      <dl className="arc-cg-settings ro">
        <div>
          <dt>Picture</dt>
          <dd>{MODE_LABEL[vs.mode]}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>{RULES_LABEL[vs.rules ?? "classic"]}</dd>
        </div>
        <div>
          <dt>Champions</dt>
          <dd className="num">{vs.rounds}</dd>
        </div>
        <div>
          <dt>Hints</dt>
          <dd>
            {HINT_LABEL[speedOf(vs.stepMs)]} ({vs.stepMs / 1000} s)
          </dd>
        </div>
      </dl>
    );
  // Rendered inside RoomLobby's .arc-room-settings, which lays the rows out.
  return (
    <>
      <Seg label="Picture" value={vs.mode} options={MODES.map((m) => [m, MODE_LABEL[m]] as const)} onPick={(mode) => onChange({ mode })} />
      <Seg label="Rules" value={vs.rules ?? "classic"} options={(["classic", "skips"] as const).map((r) => [r, RULES_LABEL[r]] as const)} onPick={(rules) => onChange({ rules })} />
      <Seg label="Champions" value={String(vs.rounds)} options={VS_ROUNDS.map((n) => [String(n), String(n)] as const)} onPick={(n) => onChange({ rounds: Number(n) })} />
      <Seg
        label="Hints every"
        value={speedOf(vs.stepMs)}
        options={(Object.keys(HINT_SPEEDS) as HintSpeed[]).map((k) => [k, `${HINT_SPEEDS[k] / 1000} s`, HINT_LABEL[k]] as const)}
        onPick={(k) => onChange({ stepMs: HINT_SPEEDS[k] })}
      />
      <label className="arc-cg-check">
        <input type="checkbox" checked={vs.hostPlays} onChange={(e) => onChange({ hostPlays: e.target.checked })} /> I play too
      </label>
    </>
  );
}

/** One setting: a caption and the site's .seg toggle buttons. */
function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: (readonly [T, string, string?])[]; onPick: (v: T) => void }) {
  const id = `cg-set-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="arc-cg-field">
      <span id={id}>{label}</span>
      <div className="seg" role="group" aria-labelledby={id}>
        {options.map(([v, text, title]) => (
          <button key={v} type="button" aria-pressed={v === value} title={title} onClick={() => onPick(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
