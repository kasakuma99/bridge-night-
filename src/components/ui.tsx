import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { useData, useDDragon } from "../data/context";
import { champIcon, itemIcon, loadAugments, spellIcon, type Augment } from "../lib/champions";
import { SPELL_IDS } from "../lib/live";
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

interface Choice {
  value: string;
  label: string;
  kind?: "pri" | "red";
}
interface Ask {
  title: string;
  text: string;
  choices: Choice[];
  resolve: (value: string | null) => void;
}
interface Confirm {
  title: string;
  text: string;
  yes: string;
  danger?: boolean;
}
type Choose = (o: Omit<Ask, "resolve">) => Promise<string | null>;
const ChooseCtx = createContext<Choose>(async () => null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const choose = useCallback<Choose>((o) => new Promise((resolve) => setAsk({ ...o, resolve })), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);
  const done = (value: string | null) => {
    ask?.resolve(value);
    setAsk(null);
  };
  const cancel = (
    <button className="btn ghost" type="button" autoFocus onClick={() => done(null)}>
      Cancel
    </button>
  );
  return (
    <ChooseCtx.Provider value={choose}>
      {children}
      <dialog
        ref={ref}
        className="modal"
        aria-labelledby="dlg-t"
        aria-describedby="dlg-d"
        onCancel={(e) => {
          e.preventDefault();
          done(null);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) done(null);
        }}
      >
        {ask && (
          <div className="panel">
            <h3 id="dlg-t">{ask.title}</h3>
            <p className="sub" id="dlg-d">
              {ask.text}
            </p>
            <div className="win">
              {ask.choices.length < 2 && cancel}
              {ask.choices.map((c) => (
                <button key={c.value} className={`btn ${c.kind ?? ""}`} type="button" onClick={() => done(c.value)}>
                  {c.label}
                </button>
              ))}
              {ask.choices.length >= 2 && cancel}
            </div>
          </div>
        )}
      </dialog>
    </ChooseCtx.Provider>
  );
}
/** Several options. Resolves to the chosen value, or null when cancelled. */
export const useChoose = () => useContext(ChooseCtx);

/** Yes or cancel. */
export function useConfirm() {
  const choose = useChoose();
  return useCallback(
    async (o: Confirm) =>
      (await choose({ title: o.title, text: o.text, choices: [{ value: "yes", label: o.yes, kind: o.danger === false ? "pri" : "red" }] })) ===
      "yes",
    [choose],
  );
}

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

/** The Discord picture of the linked member, or initials. */
export function Avatar({ id, lg }: { id: string; lg?: boolean }) {
  const { pname, player } = useData();
  const color = usePlayerColor();
  const src = player(id)?.avatarUrl;
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className={`ava${lg ? " lg" : ""}`} style={{ background: color(id) }} aria-hidden>
      {src && broken !== src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(src)} /> : initials(pname(id))}
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

export function SpellIcon({ id }: { id: number }) {
  const { dd } = useDDragon();
  const [broken, setBroken] = useState(false);
  const spell = dd.spells[id];
  const name = spell?.name ?? Object.keys(SPELL_IDS).find((k) => SPELL_IDS[k] === id)?.replace(/^Summoner/, "") ?? "Unknown spell";
  const src = spell ? spellIcon(dd.version, spell.id) : null;
  return (
    <span className="item spell" title={name} role="img" aria-label={name}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : id ? initials(name) : "?"}
    </span>
  );
}

let augmentsOnce: Promise<Record<number, Augment>> | null = null;
/** Loaded the first time an augment is shown. */
function useAugments() {
  const [all, setAll] = useState<Record<number, Augment>>({});
  useEffect(() => {
    let on = true;
    augmentsOnce ??= loadAugments();
    augmentsOnce.then((a) => on && setAll(a)).catch(() => (augmentsOnce = null));
    return () => {
      on = false;
    };
  }, []);
  return all;
}

export function AugmentIcon({ id }: { id: number }) {
  const a = useAugments()[id];
  const [broken, setBroken] = useState(false);
  const name = a?.name ?? `Augment ${id}`;
  return (
    <span className={`item aug ${a?.rarity ?? ""}`} title={name} role="img" aria-label={name}>
      {a?.icon && !broken ? <img src={a.icon} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/** The name of an augment, with its icon. */
export function AugmentLabel({ id }: { id: number }) {
  const a = useAugments()[id];
  return (
    <span className="who">
      <AugmentIcon id={id} />
      <span>{a?.name ?? `Augment ${id}`}</span>
    </span>
  );
}

/** Last games as pips: from all games, or the results given (oldest first). */
export function Form({ id, n, results }: { id: string; n: number; results?: boolean[] }) {
  const { data } = useData();
  const f = results ? results.slice(-n) : formOf(data.matches, id, n);
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
