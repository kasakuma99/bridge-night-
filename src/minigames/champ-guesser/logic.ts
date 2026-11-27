/* Pure logic for the Champion guesser: no DOM, no React. Tested in tests/champ-guesser.test.ts. */

export type Mode = "pixel" | "colours" | "mixed";

export interface Champ {
  name: string;
  id: string;
}

/* ---------- timing and scoring ---------- */

/** How long each reveal step lasts in solo play. */
export const STEP_MS = 2500;
/** Extra time on the last (easiest) step before the champion counts as missed. */
export const HOLD_MS = 7500;
export const ROUND_SIZE = 5;
export const MAX_CHAMP_POINTS = 1000;
export const MAX_ROUND_POINTS = ROUND_SIZE * MAX_CHAMP_POINTS;
/** Cost of a wrong guess (only real champion names count as guesses). */
export const WRONG_COST = 50;
/** A correct guess is always worth at least this much. */
export const MIN_CORRECT = 50;
export const MODE_MULT: Record<Mode, number> = { pixel: 1, colours: 1, mixed: 1.35 };

/* ---------- rules ----------
 * classic: 5 champions, points for guessing early (per-champion clock).
 * timed:   one clock for the whole run (solo only): name as many as you can, skipping is free.
 * skips:   10 champions, no clock; fewest skips wins (points break ties). Too many wrong names = a skip.
 */
export type Rules = "classic" | "timed" | "skips";
export const RULES: Rules[] = ["classic", "timed", "skips"];
export const RULES_LABEL: Record<Rules, string> = { classic: "Classic", timed: "Timed", skips: "Fewest skips" };
export const TIMED_MS = 90_000;
export const SKIPS_SIZE = 10;
/** Wrong names on one champion before it counts as a skip (skips rules). */
export const SKIP_WRONG = 3;
/** Highest possible Timed score (the database checks it too). */
export const TIMED_MAX = 200;

/**
 * Points for a correct guess at `step` (0 = hardest) out of `steps`, after `wrong` wrong guesses.
 * Runs from 1000 at the first step down to 200 at the last, times the mode multiplier, never above 1000.
 */
export function champPoints(step: number, steps: number, wrong: number, mode: Mode): number {
  const t = steps > 1 ? Math.min(1, Math.max(0, step / (steps - 1))) : 0;
  const base = (MAX_CHAMP_POINTS - 800 * t) * MODE_MULT[mode];
  const pts = Math.round(base / 10) * 10 - Math.max(0, wrong) * WRONG_COST;
  return Math.min(MAX_CHAMP_POINTS, Math.max(MIN_CORRECT, pts));
}

/** Round total: each champion clamped to 0..1000, the sum capped at 5000. */
export function roundTotal(points: number[]): number {
  const sum = points.slice(0, ROUND_SIZE).reduce((a, p) => a + Math.min(MAX_CHAMP_POINTS, Math.max(0, Math.round(p) || 0)), 0);
  return Math.min(MAX_ROUND_POINTS, sum);
}

/** Which step is showing after `elapsed` ms. */
export const stepAt = (elapsed: number, steps: number) => Math.min(steps - 1, Math.max(0, Math.floor(elapsed / STEP_MS)));
/** True once the last step has been held long enough. */
export const timedOut = (elapsed: number, steps: number) => elapsed >= steps * STEP_MS + HOLD_MS;

/* ---------- reveal steps per mode ---------- */

export interface Step {
  /** Width of the low-res image in blocks (0 = colour blobs only). */
  cols: number;
  /** true = soft blur when scaling up, false = hard pixel blocks. */
  smooth: boolean;
  /** Reduce to this many palette colours (0 = keep real colours). */
  colours: number;
  /** Colour blobs: how many palette blobs to draw instead of the image. */
  blobs?: number;
  /** 0..1 share of the champion's hue shift still applied (Mixed). */
  hue?: number;
}

export const MODE_STEPS: Record<Mode, Step[]> = {
  pixel: [5, 8, 12, 17, 24, 34, 50, 80].map((cols) => ({ cols, smooth: false, colours: 0 })),
  colours: [
    { cols: 0, smooth: true, colours: 3, blobs: 3 },
    { cols: 0, smooth: true, colours: 5, blobs: 5 },
    { cols: 0, smooth: true, colours: 8, blobs: 8 },
    { cols: 5, smooth: true, colours: 5 },
    { cols: 8, smooth: true, colours: 6 },
    { cols: 13, smooth: true, colours: 8 },
    { cols: 22, smooth: true, colours: 10 },
    { cols: 40, smooth: true, colours: 12 },
  ],
  mixed: [
    { cols: 6, smooth: false, colours: 3, hue: 1 },
    { cols: 9, smooth: false, colours: 4, hue: 1 },
    { cols: 13, smooth: false, colours: 4, hue: 1 },
    { cols: 18, smooth: false, colours: 5, hue: 0.8 },
    { cols: 26, smooth: false, colours: 6, hue: 0.6 },
    { cols: 38, smooth: false, colours: 8, hue: 0.4 },
    { cols: 56, smooth: false, colours: 10, hue: 0.2 },
    { cols: 80, smooth: false, colours: 12, hue: 0 },
  ],
};

/** Every palette size a mode needs, so they can be worked out once per image. */
export const paletteSizes = (mode: Mode) => [...new Set(MODE_STEPS[mode].map((s) => s.colours).filter((k) => k > 0))];

export const MODE_LABEL: Record<Mode, string> = { pixel: "Pixelated", colours: "Colours", mixed: "Both" };
export const MODES: Mode[] = ["pixel", "colours", "mixed"];
/** Solo leaderboard per picture mode (must match public.minigame_games). */
export const BOARD_ID: Record<Mode, string> = { pixel: "champ-pixel", colours: "champ-colours", mixed: "champ-mixed" };
/** The board a solo run goes on: Classic per picture mode, Timed and Fewest skips one board each. */
export const boardFor = (mode: Mode, rules: Rules) => (rules === "timed" ? "champ-timed" : rules === "skips" ? "champ-skips" : BOARD_ID[mode]);

/* ---------- names and guesses ---------- */

/** Lowercase, no accents, letters and digits only: "Kai'Sa" -> "kaisa", "Nunu & Willump" -> "nunuwillump". */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Common short names (already normalised) -> display name. */
export const NICKNAMES: Record<string, string> = {
  j4: "Jarvan IV",
  jarvan: "Jarvan IV",
  mf: "Miss Fortune",
  tf: "Twisted Fate",
  mundo: "Dr. Mundo",
  nunu: "Nunu & Willump",
  willump: "Nunu & Willump",
  asol: "Aurelion Sol",
  aurelion: "Aurelion Sol",
  ez: "Ezreal",
  cait: "Caitlyn",
  kass: "Kassadin",
  kat: "Katarina",
  heimer: "Heimerdinger",
  donger: "Heimerdinger",
  gp: "Gangplank",
  ww: "Warwick",
  yi: "Master Yi",
  lb: "LeBlanc",
  xin: "Xin Zhao",
  tk: "Tahm Kench",
  tahm: "Tahm Kench",
  morde: "Mordekaiser",
  fiddle: "Fiddlesticks",
  blitz: "Blitzcrank",
  noc: "Nocturne",
  panth: "Pantheon",
  sej: "Sejuani",
  ori: "Orianna",
  trynd: "Tryndamere",
  vlad: "Vladimir",
  voli: "Volibear",
  liss: "Lissandra",
  malz: "Malzahar",
  naut: "Nautilus",
  ali: "Alistar",
  cass: "Cassiopeia",
  cho: "Cho'Gath",
  kha: "Kha'Zix",
  kog: "Kog'Maw",
  rek: "Rek'Sai",
  lee: "Lee Sin",
  renata: "Renata Glasc",
  shyv: "Shyvana",
  hec: "Hecarim",
  aphe: "Aphelios",
  smol: "Smolder",
  sera: "Seraphine",
  monkeyking: "Wukong",
  wu: "Wukong",
};

/** The champion a typed guess means (full name, Data Dragon id or nickname), or null if it isn't one. */
export function resolveGuess<C extends Champ>(guess: string, champions: C[]): C | null {
  const q = normalize(guess);
  if (!q) return null;
  const exact = champions.find((c) => normalize(c.name) === q || normalize(c.id) === q);
  if (exact) return exact;
  const nick = NICKNAMES[q];
  return nick ? (champions.find((c) => c.name === nick) ?? null) : null;
}

/** Does the guess name this champion? */
export const isMatch = (guess: string, champ: Champ, champions: Champ[] = [champ]) => {
  const r = resolveGuess(guess, champions.includes(champ) ? champions : [...champions, champ]);
  return !!r && r.id === champ.id;
};

/** Autocomplete: names starting with the text first, then a word starting with it, then nicknames, then anywhere. */
export function suggest<C extends Champ>(query: string, champions: C[], limit = 6): C[] {
  const q = normalize(query);
  if (!q) return [];
  const ranked: { c: C; r: number }[] = [];
  for (const c of champions) {
    const n = normalize(c.name);
    let r = -1;
    if (n.startsWith(q)) r = 0;
    else if (c.name.split(/[\s'.&-]+/).some((w) => normalize(w).startsWith(q))) r = 1;
    else if (NICKNAMES[q] === c.name || normalize(c.id).startsWith(q)) r = 2;
    else if (n.includes(q)) r = 3;
    if (r >= 0) ranked.push({ c, r });
  }
  ranked.sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name));
  return ranked.slice(0, limit).map((x) => x.c);
}

/* ---------- seeded random and picking ---------- */

/** Small fast seeded random (mulberry32). Returns numbers in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The whole list in a seeded random order (Fisher-Yates), unique by id. */
export function shuffled<C extends Champ>(champions: C[], seed: number): C[] {
  const seen = new Set<string>();
  const out = champions.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** `n` different champions for a round, skipping ids in `exclude`. */
export const pickChampions = <C extends Champ>(champions: C[], n: number, seed: number, exclude: Iterable<string> = []) => {
  const ex = new Set(exclude);
  return shuffled(champions, seed)
    .filter((c) => !ex.has(c.id))
    .slice(0, n);
};

/** Hue shift in degrees for Mixed mode, 90..270 so it always looks clearly wrong. */
export const hueShiftFor = (seed: number) => 90 + Math.round(rng(seed)() * 180);

/* ---------- image maths ---------- */

/** Crop box of the given aspect (w/h) inside a w x h image, leaning right by `biasX` (0 = left, 1 = right). */
export function cropRect(w: number, h: number, aspect: number, biasX = 0.6) {
  let cw = w;
  let ch = Math.round(w / aspect);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * aspect);
  }
  return { x: Math.round((w - cw) * biasX), y: Math.round((h - ch) * 0.35), w: cw, h: ch };
}

export interface Swatch {
  r: number;
  g: number;
  b: number;
  /** Share of the pixels, 0..1. */
  weight: number;
  /** Average position of its pixels, 0..1 (only when a width was given). */
  x: number;
  y: number;
}

const dist2 = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  // Weighted a little towards green, which the eye sees best.
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
};

/**
 * Dominant colours of RGBA pixels with k-means (k-means++ start, seeded so it's repeatable).
 * Pixels with alpha below 128 are ignored. Result is sorted by weight, biggest first.
 */
export function kMeans(pixels: ArrayLike<number>, k: number, opts: { seed?: number; width?: number; iterations?: number } = {}): Swatch[] {
  const { seed = 1, width = 0, iterations = 12 } = opts;
  const idx: number[] = [];
  for (let i = 0; i + 3 < pixels.length; i += 4) if (pixels[i + 3] >= 128) idx.push(i);
  if (!idx.length || k < 1) return [];
  const r = rng(seed);
  // k-means++ start: each next centre is picked far from the ones so far.
  const cents: [number, number, number][] = [];
  const first = idx[Math.floor(r() * idx.length)];
  cents.push([pixels[first], pixels[first + 1], pixels[first + 2]]);
  const d = new Float64Array(idx.length).fill(Infinity);
  while (cents.length < k) {
    const c = cents[cents.length - 1];
    let sum = 0;
    for (let j = 0; j < idx.length; j++) {
      const p = idx[j];
      d[j] = Math.min(d[j], dist2(pixels[p], pixels[p + 1], pixels[p + 2], c[0], c[1], c[2]));
      sum += d[j];
    }
    if (sum === 0) break; // fewer distinct colours than k
    let t = r() * sum;
    let pick = idx.length - 1;
    for (let j = 0; j < idx.length; j++) if ((t -= d[j]) <= 0) {
      pick = j;
      break;
    }
    const p = idx[pick];
    cents.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
  }
  const n = cents.length;
  const assign = new Int32Array(idx.length).fill(-1);
  for (let it = 0; it < iterations; it++) {
    let changed = false;
    const acc = new Float64Array(n * 4);
    for (let j = 0; j < idx.length; j++) {
      const p = idx[j];
      const best = nearestIndex(cents, pixels[p], pixels[p + 1], pixels[p + 2]);
      if (assign[j] !== best) {
        assign[j] = best;
        changed = true;
      }
      acc[best * 4] += pixels[p];
      acc[best * 4 + 1] += pixels[p + 1];
      acc[best * 4 + 2] += pixels[p + 2];
      acc[best * 4 + 3]++;
    }
    for (let c = 0; c < n; c++) if (acc[c * 4 + 3]) cents[c] = [acc[c * 4] / acc[c * 4 + 3], acc[c * 4 + 1] / acc[c * 4 + 3], acc[c * 4 + 2] / acc[c * 4 + 3]];
    if (!changed) break;
  }
  const stats = Array.from({ length: n }, () => ({ count: 0, x: 0, y: 0 }));
  for (let j = 0; j < idx.length; j++) {
    const s = stats[assign[j]];
    s.count++;
    if (width > 0) {
      const px = idx[j] / 4;
      s.x += (px % width) + 0.5;
      s.y += Math.floor(px / width) + 0.5;
    }
  }
  const height = width > 0 ? Math.ceil(pixels.length / 4 / width) : 1;
  return cents
    .map((c, i) => ({
      r: Math.round(c[0]),
      g: Math.round(c[1]),
      b: Math.round(c[2]),
      weight: stats[i].count / idx.length,
      x: width > 0 && stats[i].count ? stats[i].x / stats[i].count / width : 0.5,
      y: width > 0 && stats[i].count ? stats[i].y / stats[i].count / height : 0.5,
    }))
    .filter((s) => s.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

function nearestIndex(cents: ArrayLike<ArrayLike<number>>, r: number, g: number, b: number) {
  let best = 0;
  let bd = Infinity;
  for (let c = 0; c < cents.length; c++) {
    const dd = dist2(r, g, b, cents[c][0], cents[c][1], cents[c][2]);
    if (dd < bd) {
      bd = dd;
      best = c;
    }
  }
  return best;
}

/** Replace every pixel (RGBA, in place) with the nearest palette colour. */
export function posterize(pixels: Uint8ClampedArray | number[], palette: Pick<Swatch, "r" | "g" | "b">[]) {
  if (!palette.length) return pixels;
  const cents = palette.map((s) => [s.r, s.g, s.b]);
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const c = cents[nearestIndex(cents, pixels[i], pixels[i + 1], pixels[i + 2])];
    pixels[i] = c[0];
    pixels[i + 1] = c[1];
    pixels[i + 2] = c[2];
  }
  return pixels;
}

/** Rotate the hue of one colour by `deg` degrees (HSL), keeping lightness and saturation. */
export function hueRotate(r: number, g: number, b: number, deg: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [r, g, b];
  const dd = max - min;
  const s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  let h = max === R ? (G - B) / dd + (G < B ? 6 : 0) : max === G ? (B - R) / dd + 2 : (R - G) / dd + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** Hue-rotate every pixel (RGBA, in place). */
export function hueRotatePixels(pixels: Uint8ClampedArray | number[], deg: number) {
  if (!deg) return pixels;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b] = hueRotate(pixels[i], pixels[i + 1], pixels[i + 2], deg);
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
  return pixels;
}

/* ---------- versus (live room) ----------
 * The host's browser owns the game: it knows the champion and runs these reducers.
 * VsState is the PUBLIC state sent to every player, so it must never hold the answer before the reveal:
 * only vsReveal writes a champion name or id into it (`reveal` and `history`).
 */

export const VS_ROUNDS = [5, 10, 15] as const;
export const HINT_SPEEDS = { slow: 4000, normal: 2500, fast: 1600 } as const;
export type HintSpeed = keyof typeof HINT_SPEEDS;
export const HINT_LABEL: Record<HintSpeed, string> = { slow: "Slow", normal: "Normal", fast: "Fast" };
/** After this many wrong names in one round a player is out for that round (stops guessing every name). */
export const VS_MAX_WRONG = 5;

export interface VsSettings {
  mode: Mode;
  /** classic (default) or skips (timed is solo only). */
  rules?: Rules;
  rounds: number;
  /** ms per reveal step. */
  stepMs: number;
  /** The host guesses too, from the streamed screen. */
  hostPlays: boolean;
}

export interface VsHit {
  id: string;
  points: number;
  /** ms after the round started. */
  ms: number;
  step: number;
}

export interface VsRoundResult {
  round: number;
  /** The champion: only ever set by vsReveal. */
  name: string;
  id: string;
  hits: VsHit[];
  /** Who skipped it (skips rules). */
  skipped?: string[];
}

export interface VsState extends VsSettings {
  phase: "lobby" | "round" | "reveal" | "end";
  /** 1-based; 0 in the lobby. */
  round: number;
  step: number;
  steps: number;
  /** The current step's picture as a small data: URL (null while loading and after the round). */
  image: string | null;
  /** true: draw `image` with hard pixels; false: let it scale smoothly. */
  pixelated: boolean;
  /** Time left in the round when this state was sent, and the round's full length (ms). */
  msLeft: number;
  limit: number;
  /** Everyone who has been in the room, so leavers stay on the table. */
  names: Record<string, string>;
  scores: Record<string, number>;
  /** Correct guesses this round, fastest first. */
  hits: VsHit[];
  /** Players who passed (or ran out of wrong guesses) this round. */
  passed: string[];
  /** Wrong guesses this round per player. */
  wrong: Record<string, number>;
  /** Skips so far per player (skips rules: passed, out of guesses, or not done at the reveal). */
  skips: Record<string, number>;
  /** The last revealed round (set in "reveal", kept in "end"). */
  reveal: VsRoundResult | null;
  /** Every revealed round, oldest first. */
  history: VsRoundResult[];
}

export type VsAction = { type: "guess"; round: number; name: string } | { type: "pass"; round: number };

export interface VsPlayer {
  id: string;
  name: string;
}

export const vsLimit = (steps: number, stepMs: number) => steps * stepMs + HOLD_MS;

/** A fresh lobby. Keeps the names of people who were already in the room. */
export function vsLobby(settings: VsSettings, names: Record<string, string> = {}): VsState {
  const steps = MODE_STEPS[settings.mode].length;
  return {
    ...settings,
    phase: "lobby",
    round: 0,
    step: 0,
    steps,
    image: null,
    pixelated: false,
    msLeft: vsLimit(steps, settings.stepMs),
    limit: vsLimit(steps, settings.stepMs),
    names: { ...names },
    scores: Object.fromEntries(Object.keys(names).map((id) => [id, 0])),
    hits: [],
    passed: [],
    wrong: {},
    skips: Object.fromEntries(Object.keys(names).map((id) => [id, 0])),
    reveal: null,
    history: [],
  };
}

/** The wrong-guess limit for a room: lower under the skips rules, so guessing every name isn't a strategy. */
export const vsMaxWrong = (s: Pick<VsSettings, "rules">) => (s.rules === "skips" ? SKIP_WRONG : VS_MAX_WRONG);

/** Change settings (lobby only). */
export function vsSettings(s: VsState, patch: Partial<VsSettings>): VsState {
  if (s.phase !== "lobby") return s;
  return vsLobby({ ...vsSettingsOf(s), ...patch }, s.names);
}

export const vsSettingsOf = (s: VsSettings): VsSettings => ({ mode: s.mode, rules: s.rules ?? "classic", rounds: s.rounds, stepMs: s.stepMs, hostPlays: s.hostPlays });

/** Make sure everyone has a name and a score. Returns the same object when nothing changed. */
export function vsAddPlayers(s: VsState, players: VsPlayer[]): VsState {
  const fresh = players.filter((p) => s.names[p.id] !== p.name || !(p.id in s.scores));
  if (!fresh.length) return s;
  const names = { ...s.names };
  const scores = { ...s.scores };
  const skips = { ...s.skips };
  for (const p of fresh) {
    names[p.id] = p.name;
    scores[p.id] ??= 0;
    skips[p.id] ??= 0;
  }
  return { ...s, names, scores, skips };
}

/** Start the next round with the first step's picture. */
export function vsStartRound(s: VsState, image: string, pixelated: boolean): VsState {
  return { ...s, phase: "round", round: s.round + 1, step: 0, image, pixelated, msLeft: s.limit, hits: [], passed: [], wrong: {}, reveal: null };
}

/** Which step shows `elapsed` ms into a round. */
export const vsStepAt = (s: Pick<VsState, "steps" | "stepMs">, elapsed: number) => Math.min(s.steps - 1, Math.max(0, Math.floor(elapsed / s.stepMs)));
export const vsTimedOut = (s: Pick<VsState, "limit" | "rules">, elapsed: number) => s.rules !== "skips" && elapsed >= s.limit;

/** A new step (with its picture). */
export function vsSetStep(s: VsState, step: number, elapsed: number, image: string, pixelated: boolean): VsState {
  if (s.phase !== "round") return s;
  return { ...s, step: Math.min(s.steps - 1, Math.max(0, step)), msLeft: Math.max(0, s.limit - elapsed), image, pixelated };
}

/** Where a player stands in the current round. */
export function vsStatus(s: VsState, id: string): "guessing" | "right" | "out" {
  if (s.hits.some((h) => h.id === id)) return "right";
  if (s.passed.includes(id)) return "out";
  return "guessing";
}

export type VsGuessResult = "right" | "wrong" | "unknown" | "ignored";

/**
 * A player's guess, checked by the host. Points as in solo (by step, minus wrong guesses);
 * a wrong champion counts against that player, a non-champion is ignored.
 */
export function vsGuess(s: VsState, answer: Champ, champions: Champ[], player: VsPlayer, text: string, elapsed: number): { state: VsState; result: VsGuessResult; points: number } {
  if (s.phase !== "round" || vsStatus(s, player.id) !== "guessing") return { state: s, result: "ignored", points: 0 };
  const list = champions.some((c) => c.id === answer.id) ? champions : [...champions, answer];
  const hit = resolveGuess(text, list);
  if (!hit) return { state: s, result: "unknown", points: 0 };
  const base = vsAddPlayers(s, [player]);
  const wrong = base.wrong[player.id] ?? 0;
  if (hit.id === answer.id) {
    const points = champPoints(s.step, s.steps, wrong, s.mode);
    return {
      state: {
        ...base,
        hits: [...base.hits, { id: player.id, points, ms: Math.max(0, Math.round(elapsed)), step: s.step }],
        scores: { ...base.scores, [player.id]: (base.scores[player.id] ?? 0) + points },
      },
      result: "right",
      points,
    };
  }
  const n = wrong + 1;
  return {
    state: { ...base, wrong: { ...base.wrong, [player.id]: n }, passed: n >= vsMaxWrong(s) ? [...base.passed, player.id] : base.passed },
    result: "wrong",
    points: 0,
  };
}

/** A player gives up on this round. */
export function vsPass(s: VsState, id: string): VsState {
  if (s.phase !== "round" || vsStatus(s, id) !== "guessing") return s;
  return { ...s, passed: [...s.passed, id] };
}

/** Everyone still in the room has guessed or passed. */
export const vsAllDone = (s: VsState, ids: string[]) => s.phase === "round" && ids.length > 0 && ids.every((id) => vsStatus(s, id) !== "guessing");

/** Who has to answer: everyone in the room, minus the host unless the host plays. */
export const vsParticipants = (players: VsPlayer[], hostId: string | undefined, hostPlays: boolean) => players.map((p) => p.id).filter((id) => hostPlays || id !== hostId);

/**
 * End the round: show the champion and who got it.
 * Skips rules: everyone in `players` who didn't get it gets a skip (passed, out of guesses, or still guessing).
 */
export function vsReveal(s: VsState, answer: Champ, players: string[] = []): VsState {
  if (s.phase !== "round") return s;
  const result: VsRoundResult = { round: s.round, name: answer.name, id: answer.id, hits: s.hits };
  let skips = s.skips ?? {};
  if (s.rules === "skips") {
    const got = new Set(s.hits.map((h) => h.id));
    const skipped = [...new Set([...players, ...s.passed])].filter((id) => !got.has(id) && id in s.names);
    result.skipped = skipped;
    skips = { ...skips };
    for (const id of skipped) skips[id] = (skips[id] ?? 0) + 1;
  }
  return { ...s, phase: "reveal", image: null, msLeft: 0, skips, reveal: result, history: [...s.history, result] };
}

export const vsIsLastRound = (s: VsState) => s.round >= s.rounds;

/** Game over. A round still running ends without a reveal (its champion stays secret). */
export function vsEnd(s: VsState): VsState {
  if (s.phase === "end") return s;
  return { ...s, phase: "end", image: null, msLeft: 0, hits: s.phase === "round" ? [] : s.hits };
}

export interface VsRank {
  id: string;
  name: string;
  score: number;
  skips: number;
  /** 1-based, ties share a place. */
  place: number;
}

/** Players by score, best first. `only` limits it to those ids (plus anyone with points). */
export function vsRanking(s: VsState, only?: string[]): VsRank[] {
  const ids = Object.keys(s.names).filter((id) => !only || only.includes(id) || (s.scores[id] ?? 0) > 0);
  const bySkips = s.rules === "skips";
  const rows = ids
    .map((id) => ({ id, name: s.names[id], score: s.scores[id] ?? 0, skips: s.skips?.[id] ?? 0 }))
    .sort((a, b) => (bySkips ? a.skips - b.skips : 0) || b.score - a.score || a.name.localeCompare(b.name));
  let place = 0;
  return rows.map((r, i) => {
    if (i === 0 || r.score !== rows[i - 1].score || r.skips !== rows[i - 1].skips) place = i + 1;
    return { ...r, place };
  });
}

/** "3.4 s" */
export const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/* ---------- host refresh: the private game kept in sessionStorage ---------- */

/** The engine's own key for "this tab hosts a room" (src/minigames/room/index.ts). */
export const ROOM_HOST_KEY = "bn-room-host:champ-guesser";
/** Ours: the host's full private game, so a refresh carries on where it was. */
export const HOST_SAVE_KEY = "bn-cg-host-game";

export interface HostSave {
  v: 1;
  /** Public state, without the picture (it's redrawn from the champion). */
  vs: VsState;
  /** The secret order of champions and how far along it the game is. */
  queue: Champ[];
  pos: number;
  /** The champion of the current round (null in the lobby / at the end). */
  answer: Champ | null;
  hue: number;
  /** ms into the current round. */
  elapsed: number;
}

export const makeHostSave = (vs: VsState, queue: Champ[], pos: number, answer: Champ | null, hue: number, elapsed: number): HostSave => ({
  v: 1,
  vs: { ...vs, image: null },
  queue: queue.map((c) => ({ name: c.name, id: c.id })),
  pos,
  answer: answer ? { name: answer.name, id: answer.id } : null,
  hue,
  elapsed: Math.max(0, Math.round(elapsed)),
});

const isChamp = (c: unknown): c is Champ => !!c && typeof c === "object" && typeof (c as Champ).name === "string" && typeof (c as Champ).id === "string";
const PHASES: VsState["phase"][] = ["lobby", "round", "reveal", "end"];

/** Read a saved host game back; null for anything that doesn't look right. */
export function parseHostSave(raw: string | null): HostSave | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as HostSave;
    const vs = x?.vs;
    if (x?.v !== 1 || !vs || typeof vs !== "object") return null;
    if (!PHASES.includes(vs.phase) || !MODES.includes(vs.mode) || typeof vs.round !== "number" || typeof vs.step !== "number") return null;
    if (!vs.names || !vs.scores || !Array.isArray(vs.hits) || !Array.isArray(vs.passed) || !Array.isArray(vs.history) || !vs.wrong) return null;
    if (!Array.isArray(x.queue) || !x.queue.every(isChamp) || typeof x.pos !== "number") return null;
    if (x.answer !== null && !isChamp(x.answer)) return null;
    // A running round needs its champion.
    if ((vs.phase === "round" || vs.phase === "reveal") && !x.answer) return null;
    return {
      v: 1,
      vs: { ...vs, image: null, steps: MODE_STEPS[vs.mode].length, rules: vs.rules === "skips" ? "skips" : vs.rules === undefined ? undefined : "classic", skips: vs.skips && typeof vs.skips === "object" ? vs.skips : {} },
      queue: x.queue,
      pos: Math.max(0, Math.min(x.queue.length, Math.floor(x.pos))),
      answer: x.answer,
      hue: Number(x.hue) || 0,
      elapsed: Math.max(0, Number(x.elapsed) || 0),
    };
  } catch {
    return null;
  }
}
