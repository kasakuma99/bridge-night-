import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { RatingChange } from "../../lib/stats";

/** "+16", "−14" (real minus sign) or "0". */
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** Why a player's Elo moved in one game, e.g. ["Game +13", "Win streak +1"]. */
export const reasons = (rc: RatingChange) =>
  [
    `Game ${signed(rc.base)}`,
    rc.streak ? `Win streak ${signed(rc.streak)}` : "",
    rc.bounty ? `Bounty ${signed(rc.bounty)}` : "",
    rc.ff ? `Surrender ${signed(rc.ff)}` : "",
  ].filter(Boolean);

/** An Elo change: ice when up, muted red when down. */
export function EloDelta({ d, arrow, why }: { d: number; arrow?: boolean; why?: string }) {
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={`elo-d ${d > 0 ? "up" : d < 0 ? "down" : "flat"}`} title={why}>
      {arrow && <Icon aria-hidden />}
      <span className="sr-only">Elo </span>
      {signed(d)}
      {why && <span className="sr-only"> ({why})</span>}
    </span>
  );
}

/** Elo line for the last 30 games, with a dashed line at the 1000 start when it is in view. */
export function EloChart({ hist, start }: { hist: number[]; start: number }) {
  const h = hist.slice(-31);
  const lo = Math.min(...h) - 8;
  const hi = Math.max(...h) + 8;
  const y = (v: number) => 100 - ((v - lo) / (hi - lo)) * 66 - 8;
  const pts = h.map((v, i) => `${((i / Math.max(1, h.length - 1)) * 300).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = h[h.length - 1] >= h[0];
  const showStart = start > lo && start < hi;
  return (
    <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden className={up ? "up" : "down"}>
      {showStart && <line x1="0" x2="300" y1={y(start)} y2={y(start)} className="base" vectorEffect="non-scaling-stroke" />}
      <polygon points={`0,100 ${pts} 300,100`} className="area" />
      <polyline points={pts} className="ln" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
