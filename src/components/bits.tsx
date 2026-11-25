import { useMemo } from "react";
import { Clock } from "lucide-react";
import { useData } from "../data/context";
import { dodgeStatus } from "../lib/dodges";
import { blueWinChance, rivalryVerb, type HeadToHead } from "../lib/stats";
import { fmtDuration, plural, seeded } from "../lib/util";
import { Avatar } from "./ui";

export function rivalryText(f: HeadToHead, pname: (id: string) => string) {
  const loser = f.leader === f.a ? f.b : f.a;
  return { title: `${pname(f.leader)} ${rivalryVerb(f.streak)} ${pname(loser)}`, sub: `${f.streak} wins in a row head-to-head` };
}

export function FeudBanner({ f }: { f: HeadToHead }) {
  const { pname } = useData();
  const t = rivalryText(f, pname);
  const lw = f.leader === f.a ? f.wa : f.wb;
  return (
    <div className="feud pop">
      <Avatar id={f.leader} />
      <div>
        <b>{t.title}</b>
        <br />
        <span>{t.sub}</span>
      </div>
      <div className="rec">
        <b>
          {lw}–{f.g - lw}
        </b>
        <span>all time</span>
      </div>
    </div>
  );
}

export function useDodges() {
  const { data, now } = useData();
  return useMemo(() => dodgeStatus(data.matches, data.settings, now, data.live), [data.matches, data.settings, now, data.live]);
}

/** Dodge rule status for Teams and Live. */
export function RuleInfo({ inGame }: { inGame?: boolean }) {
  const { data } = useData();
  const d = useDodges();
  if (d.off) return null;
  const hours = data.settings.dodgeHours;
  const ago = d.lastGameAt == null ? null : fmtDuration(d.sinceLast);
  if (d.freshNight && !(inGame && (d.used.blue || d.used.red)))
    return (
      <div className="info fresh" data-testid="rule">
        <Clock aria-hidden />
        <div>
          <b>Dodges are on.</b> {ago ? `Last game was ${ago} ago, so` : "First game ever, so"} each team gets{" "}
          {plural(d.perTeam, "dodge")} for tonight, whatever the team size.
        </div>
      </div>
    );
  if (d.left.blue || d.left.red)
    return (
      <div className="info fresh" data-testid="rule">
        <Clock aria-hidden />
        <div>
          <b>Dodges tonight:</b> Blue side {d.left.blue} left, Red side {d.left.red} left. They reset after a {hours}h break.
        </div>
      </div>
    );
  return (
    <div className="info" data-testid="rule">
      <Clock aria-hidden />
      <div>
        No dodges left tonight. They come back after a {hours}h break{ago ? ` (in ${fmtDuration(d.untilFresh)})` : ""}.
      </div>
    </div>
  );
}

export function WinChance({ blue, red }: { blue: string[]; red: string[] }) {
  const { c } = useData();
  const pb = Math.round(blueWinChance(c, blue, red) * 100);
  return (
    <div className="prob">
      <span className="bl">Blue {pb}%</span>
      <div className="track" role="img" aria-label={`Win chance Blue ${pb} percent, Red ${100 - pb} percent`}>
        <i style={{ width: `${pb}%` }} />
      </div>
      <span className="rl">{100 - pb}% Red</span>
      <small>Win chance from ratings</small>
    </div>
  );
}

/** The night-bridge banner. */
export function HeroArt() {
  const { snow, lamps } = useMemo(() => {
    const r = seeded(7);
    const snow = Array.from({ length: 70 }, () => ({
      cx: Math.round(r() * 1200),
      cy: Math.round(r() * 225),
      r: +(r() * 1.6 + 0.4).toFixed(1),
      o: +(r() * 0.6 + 0.2).toFixed(2),
    }));
    const lamps: number[] = [];
    for (let x = 70; x < 1200; x += 140) lamps.push(x);
    return { snow, lamps };
  }, []);
  return (
    <svg viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16314f" />
          <stop offset=".7" stopColor="#0e1a29" />
          <stop offset="1" stopColor="#0b0f14" />
        </linearGradient>
        <linearGradient id="icel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9f0ff" />
          <stop offset="1" stopColor="#6f93b3" />
        </linearGradient>
        <radialGradient id="moon" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#e6f5ff" />
          <stop offset=".55" stopColor="#bfe6ff" stopOpacity=".35" />
          <stop offset="1" stopColor="#bfe6ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1200" height="260" fill="url(#sky)" />
      <circle cx="930" cy="62" r="70" fill="url(#moon)" />
      <circle cx="930" cy="62" r="22" fill="#e9f6ff" />
      <path d="M0 170 L90 120 L160 150 L250 95 L330 140 L420 110 L520 160 L600 125 L700 150 L800 100 L880 135 L980 105 L1080 145 L1200 115 V260 H0Z" fill="#1a2c42" />
      <path d="M150 95 L250 95 L230 108 Z M780 100 L800 100 L820 112 Z" fill="#cfe7fb" opacity=".5" />
      <path d="M0 200 L120 160 L210 185 L330 150 L460 190 L560 165 L690 195 L820 160 L950 190 L1070 165 L1200 185 V260 H0Z" fill="#14233a" />
      <g fill="#0a1018" stroke="#2a3d55" strokeWidth="2">
        <path d="M-10 214 H1210 V230 H-10Z" />
        <path d="M140 230 Q210 175 280 230Z M420 230 Q490 175 560 230Z M700 230 Q770 175 840 230Z M980 230 Q1050 175 1120 230Z" />
      </g>
      <path d="M-10 214 H1210" stroke="url(#icel)" strokeWidth="3" />
      <g>
        {lamps.map((x) => (
          <g key={x}>
            <rect x={x - 2} y="196" width="4" height="18" fill="#2a3d55" />
            <circle cx={x} cy="194" r="9" fill="#bfe6ff" opacity=".18" />
            <circle cx={x} cy="194" r="3.5" fill="#e9f6ff" />
          </g>
        ))}
      </g>
      <rect y="230" width="1200" height="30" fill="#0b0f14" />
      <g fill="#e9f6ff">
        {snow.map((s, i) => (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} opacity={s.o} />
        ))}
      </g>
    </svg>
  );
}
