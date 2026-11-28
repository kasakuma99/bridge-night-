/* Chum's Revenge: the game screen (start, play, vending machine, game over). The 3D view is scene.ts, the rules logic.ts. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MinigameProps } from "../types";
import { ITEMS, ROOMS, boss, buy, nearShop, newRun, roomClear, score, step, type Input, type State } from "./logic";
import { Chiptune, loadAudioPref, type Sfx } from "./music";
import type { ChumsView } from "./scene";
import "./chums.css";

export const BOARD = "chums-run";

interface Hud {
  hp: number;
  maxHp: number;
  ammo: number;
  mag: number;
  reload: number;
  coins: number;
  room: number;
  clear: boolean;
  shop: boolean;
  boss: number;
  score: number;
}

const hudOf = (s: State): Hud => {
  const b = boss(s);
  const p = s.player;
  return {
    hp: p.hp,
    maxHp: p.maxHp,
    ammo: p.ammo,
    mag: p.mag,
    reload: p.reloadT >= 0 ? p.reloadT / p.reloadTime : -1,
    coins: s.wallet,
    room: s.room,
    clear: roomClear(s),
    shop: nearShop(s),
    boss: b ? Math.max(0, b.hp / b.maxHp) : -1,
    score: score(s),
  };
};

const SFX = new Set<string>(["shoot", "hit", "kill", "hurt", "coin", "door", "reload", "buy", "blast"]);

const KEYS: Record<string, [number, number]> = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };

export default function ChumsRevenge({ onScore, onExit, onPlay }: MinigameProps) {
  const [screen, setScreen] = useState<"start" | "play" | "over">("start");
  const [result, setResult] = useState<{ won: boolean; score: number; kills: number; rooms: number } | null>(null);
  const [run, setRun] = useState(0);

  const start = () => {
    setResult(null);
    setRun((r) => r + 1);
    setScreen("play");
    onPlay();
  };

  if (screen === "play")
    return (
      <Play
        key={run}
        onOver={(s) => {
          const r = { won: s.phase === "won", score: score(s), kills: s.kills, rooms: s.roomsCleared };
          setResult(r);
          setScreen("over");
          onScore(BOARD, r.score);
        }}
        onQuit={() => setScreen("start")}
      />
    );

  if (screen === "over" && result)
    return (
      <div className="arc-stage arc-chums-card">
        <span className="arc-kicker">{result.won ? "Boss down" : "You died"}</span>
        <h2 className="arc-chums-title">{result.won ? "Chum's revenge is complete" : "Game over"}</h2>
        <div className="arc-score">
          {result.score}
          <small>points</small>
        </div>
        <p className="sub">
          {result.kills} {result.kills === 1 ? "enemy" : "enemies"} · {result.rooms} of {ROOMS.length} rooms
        </p>
        <div className="arc-chums-row">
          <button className="btn pri" onClick={start} autoFocus>
            Play again
          </button>
          <button className="btn ghost" onClick={onExit}>
            Back to Arcade
          </button>
        </div>
      </div>
    );

  return (
    <div className="arc-stage arc-chums-card">
      <h2 className="arc-chums-title">Chum's Revenge</h2>
      <p className="sub">Fight through {ROOMS.length - 1} rooms and the boss. Doors open when a room is clear. Coins buy items from the vending machine.</p>
      <ul className="arc-chums-keys">
        <li>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move
        </li>
        <li>
          <kbd>Mouse</kbd> aim, hold to shoot
        </li>
        <li>
          <kbd>R</kbd> reload
        </li>
        <li>
          <kbd>E</kbd> vending machine
        </li>
        <li>
          <kbd>Esc</kbd> pause
        </li>
        <li>
          <kbd>M</kbd> music on / off
        </li>
      </ul>
      <p className="arc-chums-note">Needs a keyboard and mouse.</p>
      <div className="arc-chums-row">
        <button className="btn pri" onClick={start} autoFocus>
          Start
        </button>
        <button className="btn ghost" onClick={onExit}>
          Back
        </button>
      </div>
    </div>
  );
}

function Play({ onOver, onQuit }: { onOver: (s: State) => void; onQuit: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<State>(newRun((Date.now() ^ (Math.random() * 1e9)) >>> 0));
  const view = useRef<ChumsView | null>(null);
  const keys = useRef(new Set<string>());
  const mouse = useRef({ u: 0.7, v: 0.5, down: false });
  const reloadPress = useRef(false);
  const [hud, setHud] = useState<Hud>(() => hudOf(game.current));
  const [shop, setShop] = useState(false);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<Chiptune | null>(null);
  const [sound, setSound] = useState(loadAudioPref);
  const shopRef = useRef(shop);
  shopRef.current = shop;
  const halt = useRef(false);
  halt.current = shop || paused;
  const over = useRef(onOver);
  over.current = onOver;

  // Music and sound effects (Web Audio). The Start click already counts as the click browsers want before sound.
  useEffect(() => {
    let a: Chiptune | null = null;
    try {
      a = new Chiptune();
      a.resume();
      a.play("main");
    } catch {
      a = null; // no Web Audio: play without sound
    }
    audio.current = a;
    return () => {
      a?.dispose();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    if (paused) audio.current?.pause();
    else audio.current?.resume();
  }, [paused]);

  // three.js is big: load it only when a run starts.
  useEffect(() => {
    let live = true;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    import("./scene")
      .then(({ ChumsView }) => {
        if (!live || !canvas.current) return;
        let v: ChumsView;
        try {
          v = new ChumsView(canvas.current);
        } catch {
          setFailed("This browser can't run 3D (WebGL is off or not supported).");
          return;
        }
        view.current = v;
        const fit = () => {
          const r = canvas.current!.getBoundingClientRect();
          v.resize(r.width, r.height);
        };
        fit();
        ro = new ResizeObserver(fit);
        ro.observe(canvas.current);
        let last = performance.now();
        let hudAt = 0;
        let ended = false;
        const frame = (now: number) => {
          raf = requestAnimationFrame(frame);
          const dt = (now - last) / 1000;
          last = now;
          const s = game.current;
          if (!halt.current && !ended) {
            let mx = 0;
            let my = 0;
            for (const k of keys.current) {
              const d = KEYS[k];
              if (d) {
                mx += d[0];
                my += d[1];
              }
            }
            const aim = v.toWorld(mouse.current.u, mouse.current.v) ?? { x: s.player.x + 1, y: s.player.y };
            const input: Input = { mx: Math.sign(mx), my: Math.sign(my), ax: aim.x, ay: aim.y, fire: mouse.current.down, reload: reloadPress.current };
            reloadPress.current = false;
            step(s, input, dt);
            const a = audio.current;
            if (a) {
              for (const ev of new Set(s.events)) if (SFX.has(ev)) a.sfx(ev as Sfx);
              if (s.events.includes("boss")) a.play("boss");
              if (s.phase !== "play") {
                a.stopMusic(s.phase === "won" ? 0.4 : 0.8);
                a.sfx(s.phase === "won" ? "win" : "lose");
              }
            }
            if (s.phase !== "play") {
              ended = true;
              setTimeout(() => live && over.current(s), 1200);
            }
          } else {
            // Buying happens while the loop is halted: play its sounds here.
            if (audio.current) for (const ev of new Set(s.events)) if (SFX.has(ev)) audio.current.sfx(ev as Sfx);
            s.events = [];
          }
          v.render(s, halt.current ? 0 : Math.min(dt, 0.05));
          if (now - hudAt > 80) {
            hudAt = now;
            setHud(hudOf(s));
          }
        };
        raf = requestAnimationFrame(frame);
      })
      .catch(() => live && setFailed("The 3D engine didn't load. Check your connection and try again."));
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      view.current?.dispose();
      view.current = null;
    };
  }, []);

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const k = e.key.toLowerCase();
      // Typing a code in the vending machine: only E / Esc (close) get through.
      if (t && t.tagName === "INPUT" && !(shopRef.current && (k === "e" || k === "escape"))) return;
      if (k === "escape") {
        if (shopRef.current) setShop(false);
        else setPaused((p) => !p);
        e.preventDefault();
        return;
      }
      if (k === "e") {
        if (shopRef.current) setShop(false);
        else if (nearShop(game.current)) {
          setShop(true);
          mouse.current.down = false;
        }
        e.preventDefault();
        return;
      }
      if (k === "m") {
        const a = audio.current;
        if (a) {
          a.toggleMute();
          setSound({ volume: a.volume, muted: a.muted });
        }
        return;
      }
      if (k === "r") reloadPress.current = true;
      if (KEYS[k]) {
        keys.current.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => {
      keys.current.clear();
      mouse.current.down = false;
    };
    const vis = () => document.hidden && setPaused(true);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  const pointer = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    mouse.current.u = (e.clientX - r.left) / r.width;
    mouse.current.v = (e.clientY - r.top) / r.height;
  };

  if (failed)
    return (
      <div className="arc-stage arc-chums-card">
        <h2 className="arc-chums-title">Can't start the game</h2>
        <p className="sub">{failed}</p>
        <div className="arc-chums-row">
          <button className="btn pri" onClick={onQuit}>
            Back
          </button>
        </div>
      </div>
    );

  return (
    <div className="arc-stage arc-chums">
      <div ref={wrap} className="arc-chums-screen">
        <canvas
          ref={canvas}
          className="arc-chums-canvas"
          onPointerMove={pointer}
          onPointerDown={(e) => {
            pointer(e);
            if (e.button === 0) mouse.current.down = true;
            audio.current?.resume();
            canvas.current?.focus({ preventScroll: true });
          }}
          onPointerUp={() => (mouse.current.down = false)}
          onPointerLeave={() => (mouse.current.down = false)}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={0}
          aria-label="Chum's Revenge game screen"
        />
        <HudView hud={hud} />
        <button
          type="button"
          className="arc-chums-mute"
          onClick={(e) => {
            e.currentTarget.blur();
            const a = audio.current;
            if (!a) return;
            a.resume();
            a.toggleMute();
            setSound({ volume: a.volume, muted: a.muted });
          }}
          aria-pressed={sound.muted}
          title="Music on / off (M)"
        >
          {sound.muted ? "♪ off" : "♪ on"}
        </button>
        {hud.shop && !shop && <p className="arc-chums-hint">Press E for the vending machine</p>}
        {hud.clear && hud.room < ROOMS.length - 1 && !hud.shop && <p className="arc-chums-hint">Room clear · door is open ▸</p>}
        {shop && <Shop state={game.current} onClose={() => setShop(false)} onChange={() => setHud(hudOf(game.current))} />}
        {paused && !shop && (
          <div className="arc-chums-overlay">
            <h3>Paused</h3>
            <label className="arc-chums-vol">
              Volume
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(sound.volume * 100)}
                onChange={(e) => {
                  const a = audio.current;
                  if (!a) return;
                  a.setVolume(Number(e.target.value) / 100);
                  if (a.muted) a.toggleMute();
                  setSound({ volume: a.volume, muted: a.muted });
                }}
              />
            </label>
            <div className="arc-chums-row">
              <button className="btn pri" onClick={() => setPaused(false)} autoFocus>
                Resume
              </button>
              <button className="btn ghost" onClick={onQuit}>
                Quit run
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HudView({ hud }: { hud: Hud }) {
  return (
    <div className="arc-chums-hud" aria-hidden>
      <div className="arc-chums-hearts">
        {Array.from({ length: hud.maxHp }, (_, i) => (
          <i key={i} className={i < hud.hp ? "on" : ""} />
        ))}
      </div>
      <div className="arc-chums-ammo">
        {hud.reload >= 0 ? (
          <span className="arc-chums-reload">
            <i style={{ width: `${Math.round(hud.reload * 100)}%` }} />
          </span>
        ) : (
          <b className="num">
            {hud.ammo}
            <small>/{hud.mag}</small>
          </b>
        )}
      </div>
      <div className="arc-chums-coins num">● {hud.coins}</div>
      <div className="arc-chums-room">
        {hud.room < ROOMS.length - 1 ? `Room ${hud.room + 1}/${ROOMS.length - 1}` : "Boss"} · <span className="num">{hud.score}</span>
      </div>
      {hud.boss >= 0 && (
        <div className="arc-chums-boss">
          <span>Boss</span>
          <i style={{ width: `${Math.round(hud.boss * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function Shop({ state, onClose, onChange }: { state: State; onClose: () => void; onChange: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const tryBuy = (c: number) => {
    const r = buy(state, c);
    setMsg({ text: r.message, ok: r.ok });
    setCode("");
    onChange();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(code);
    if (Number.isFinite(n) && code) tryBuy(n);
  };
  return (
    <div className="arc-chums-overlay arc-chums-shop" role="dialog" aria-label="Vending machine">
      <div className="arc-chums-shophead">
        <h3>Vending machine</h3>
        <span className="num">● {state.wallet}</span>
      </div>
      <ul className="arc-chums-items">
        {ITEMS.filter((i) => !i.secret).map((i) => (
          <li key={i.code}>
            <button type="button" onClick={() => tryBuy(i.code)} disabled={state.wallet < i.cost} title={i.text}>
              <b className="num">{i.code}</b>
              <span>
                {i.name}
                <small>{i.effects}</small>
              </span>
              <em className="num">● {i.cost}</em>
            </button>
          </li>
        ))}
      </ul>
      <form className="arc-chums-pad" onSubmit={submit}>
        <input inputMode="numeric" maxLength={5} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus aria-label="Item code" />
        <button className="btn pri" type="submit">
          Buy
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Close (E)
        </button>
      </form>
      <p className={`arc-chums-msg${msg ? (msg.ok ? " ok" : " bad") : ""}`} aria-live="polite">
        {msg?.text ?? "Type a code or click an item."}
      </p>
    </div>
  );
}
