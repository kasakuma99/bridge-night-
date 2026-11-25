import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useData, useDDragon } from "../data/context";
import { champIcon, itemIcon } from "../lib/champions";
import { formOf } from "../lib/stats";

/* ---------- toasts ---------- */

type Toast = { id: number; text: string; err?: boolean };
const ToastCtx = createContext<(text: string, opts?: { err?: boolean }) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const n = useRef(0);
  const toast = useCallback((text: string, opts?: { err?: boolean }) => {
    const id = ++n.current;
    setList((l) => [...l.slice(-2), { id, text, err: opts?.err }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), opts?.err ? 4500 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast${t.err ? " err" : ""}`}>
            {t.err ? <AlertTriangle aria-hidden /> : <Check aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- confirm dialog ---------- */

interface Ask {
  title: string;
  text: string;
  yes: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
const ConfirmCtx = createContext<(o: Omit<Ask, "resolve">) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useCallback(
    (o: Omit<Ask, "resolve">) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })),
    [],
  );
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);
  const done = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <dialog
        ref={ref}
        className="modal"
        aria-labelledby="dlg-t"
        aria-describedby="dlg-d"
        onCancel={(e) => {
          e.preventDefault();
          done(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) done(false);
        }}
      >
        {ask && (
          <div className="panel">
            <h3 id="dlg-t">{ask.title}</h3>
            <p className="sub" id="dlg-d">
              {ask.text}
            </p>
            <div className="win">
              <button className="btn ghost" type="button" autoFocus onClick={() => done(false)}>
                Cancel
              </button>
              <button className={`btn ${ask.danger === false ? "pri" : "red"}`} type="button" onClick={() => done(true)}>
                {ask.yes}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- avatars & icons ---------- */

/** One colour per player, in roster order. */
const PAL = ["#3b74d6", "#c8496a", "#2f9c86", "#8e63d2", "#c66a3a", "#4f9a3e", "#b8478f", "#3e8db8", "#a3633f", "#6d6fd8", "#5f8f2f", "#b5546a"];
const hue = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
export const initials = (n: string) =>
  n
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export function usePlayerColor() {
  const { data } = useData();
  return (id: string) => {
    const i = data.players.findIndex((p) => p.id === id);
    return i >= 0 ? PAL[i % PAL.length] : "#4a5563";
  };
}

export function Avatar({ id, lg }: { id: string; lg?: boolean }) {
  const { pname } = useData();
  const color = usePlayerColor();
  return (
    <span className={`ava${lg ? " lg" : ""}`} style={{ background: color(id) }} aria-hidden>
      {initials(pname(id))}
    </span>
  );
}

export function ChampAvatar({ name, sq, size }: { name: string; sq?: boolean; size?: number }) {
  const { dd } = useDDragon();
  const [broken, setBroken] = useState(false);
  const champ = dd.champions.find((c) => c.name === name);
  const src = champ ? champIcon(dd.version, champ.id) : null;
  const style = { background: `hsl(${hue(name)} 35% 30%)`, ...(size ? { width: size, height: size, fontSize: size * 0.36 } : {}) };
  return (
    <span className={`ava${sq ? " sq" : ""}`} style={style} aria-hidden>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

export function ItemIcon({ id }: { id: number }) {
  const { dd } = useDDragon();
  const [broken, setBroken] = useState(false);
  const name = dd.items[id] ?? `Item ${id}`;
  const src = itemIcon(dd.version, id);
  return (
    <span className="item" title={name} role="img" aria-label={name}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

export function Form({ id, n }: { id: string; n: number }) {
  const { data } = useData();
  const f = formOf(data.matches, id, n);
  return (
    <span className="form" role="img" aria-label={`Last ${f.length} games: ${f.filter(Boolean).length} wins`}>
      {f.map((w, i) => (
        <i key={i} className={w ? "w" : ""} />
      ))}
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden style={{ width: size, height: size }}>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#18202a" stroke="#313d4b" />
      <path d="M6 22h20M9 22v-6l7-6 7 6v6" fill="none" stroke="#bfe6ff" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="16" cy="17" r="2.4" fill="#ff5a6e" />
    </svg>
  );
}

export function Empty({ title, text, children, compact }: { title?: string; text: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className="empty" style={compact ? { minHeight: 110, margin: "0 0 16px" } : undefined}>
      <div>
        {title && <h3>{title}</h3>}
        <p className="sub">{text}</p>
        {children && <div className="win">{children}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ h = 120, className = "" }: { h?: number; className?: string }) {
  return <div className={`skel ${className}`} style={{ height: h }} aria-hidden />;
}

/** Shown to visitors where members would see edit controls. */
export function MembersOnly({ what }: { what: string }) {
  return <p className="note">Only logged-in members can {what}.</p>;
}
