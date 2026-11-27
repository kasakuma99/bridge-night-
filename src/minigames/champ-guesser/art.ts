/* Loading splash art and drawing each reveal step on a canvas. */
import { champSplash } from "../../lib/champions";
import { MODE_STEPS, cropRect, hueRotate, hueRotatePixels, kMeans, posterize, type Champ, type Mode, type Step, type Swatch } from "./logic";

/** Shape of the picture on screen (width / height). */
export const ASPECT = 4 / 3;
const OUT_W = 960;
const BASE_W = 160;
const BASE_H = Math.round(BASE_W / ASPECT);
const PAL_W = 64;
const PAL_H = Math.round(PAL_W / ASPECT);

export interface Art {
  champ: Champ;
  img: HTMLImageElement;
  crop: { x: number; y: number; w: number; h: number };
  /** The crop at 160 px wide: every effect starts from this. */
  base: HTMLCanvasElement;
  /** Pixels of a 64 px wide copy, for palettes. */
  small: Uint8ClampedArray;
  palettes: Map<number, Swatch[]>;
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;

function loadImage(url: string, ms = 15000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const t = setTimeout(() => {
      img.src = "";
      reject(new Error("timeout"));
    }, ms);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

/** Load a champion's splash and get it ready. Rejects if the image can't be loaded or read. */
export async function loadArt(champ: Champ): Promise<Art> {
  const img = await loadImage(champSplash(champ.id));
  if (!img.naturalWidth) throw new Error("empty image");
  const crop = cropRect(img.naturalWidth, img.naturalHeight, ASPECT, 0.6);
  const base = canvas(BASE_W, BASE_H);
  const b = ctx2d(base);
  b.imageSmoothingQuality = "high";
  b.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, BASE_W, BASE_H);
  const pal = canvas(PAL_W, PAL_H);
  const p = ctx2d(pal);
  p.imageSmoothingQuality = "high";
  p.drawImage(base, 0, 0, PAL_W, PAL_H);
  // Throws a SecurityError if CORS failed: the caller then picks another champion.
  const small = p.getImageData(0, 0, PAL_W, PAL_H).data;
  return { champ, img, crop, base, small, palettes: new Map() };
}

export function palette(art: Art, k: number): Swatch[] {
  let pal = art.palettes.get(k);
  if (!pal) {
    pal = kMeans(art.small, k, { seed: 7, width: PAL_W });
    art.palettes.set(k, pal);
  }
  return pal;
}

/** Warm the palettes a mode will need (cheap, but better before the timer starts). */
export function prepareMode(art: Art, mode: Mode) {
  for (const s of MODE_STEPS[mode]) if (s.colours) palette(art, s.colours);
}

/** The low-res picture for a pixel step (cols x rows), or null for blob steps. Exactly what gets scaled up. */
function tinyFor(art: Art, mode: Mode, stepIndex: number, hue: number): { tiny: HTMLCanvasElement | null; step: Step; pal: Swatch[] } {
  const steps = MODE_STEPS[mode];
  const step = steps[Math.min(steps.length - 1, Math.max(0, stepIndex))];
  const deg = Math.round(hue * (step.hue ?? 0));
  let pal = step.colours ? palette(art, step.colours) : [];
  if (deg && pal.length) pal = pal.map((s) => ({ ...s, ...rgb(hueRotate(s.r, s.g, s.b, deg)) }));
  if (step.blobs) return { tiny: null, step, pal: pal.slice(0, step.blobs) };
  const cols = step.cols;
  const rows = Math.max(1, Math.round(cols / ASPECT));
  const tiny = canvas(cols, rows);
  const t = ctx2d(tiny);
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = "high";
  t.drawImage(art.base, 0, 0, cols, rows);
  if (pal.length || deg) {
    const data = t.getImageData(0, 0, cols, rows);
    if (pal.length) posterize(data.data, pal);
    else hueRotatePixels(data.data, deg);
    t.putImageData(data, 0, 0);
  }
  return { tiny, step, pal };
}

/**
 * Draw reveal `stepIndex` of `mode` (or the clear picture when `revealed`). `hue` = the champion's hue shift for Mixed.
 * `w` = output width in px (height follows the 4:3 shape).
 */
export function drawStep(out: HTMLCanvasElement, art: Art, mode: Mode, stepIndex: number, revealed: boolean, hue = 0, w = OUT_W) {
  const W = w;
  const H = Math.round(w / ASPECT);
  if (out.width !== W) out.width = W;
  if (out.height !== H) out.height = H;
  const o = out.getContext("2d")!;
  o.clearRect(0, 0, W, H);
  if (revealed) {
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "high";
    o.drawImage(art.img, art.crop.x, art.crop.y, art.crop.w, art.crop.h, 0, 0, W, H);
    return;
  }
  const { tiny, step, pal } = tinyFor(art, mode, stepIndex, hue);
  if (!tiny) {
    drawBlobs(o, pal, W, H);
    return;
  }
  if (step.smooth) {
    // Two soft scale-ups give a round blur instead of a grid of diamonds.
    const mid = canvas(tiny.width * 4, tiny.height * 4);
    const m = mid.getContext("2d")!;
    m.imageSmoothingEnabled = true;
    m.imageSmoothingQuality = "high";
    m.drawImage(tiny, 0, 0, mid.width, mid.height);
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "high";
    o.drawImage(mid, 0, 0, W, H);
  } else {
    o.imageSmoothingEnabled = false;
    o.drawImage(tiny, 0, 0, W, H);
  }
}

/** Width of the smooth pictures sent to a Versus room. */
const SNAP_W = 320;
/** Keep each picture well under ~30 KB (base64 data: URL length). */
const SNAP_MAX = 40_000;

/**
 * The current step as a small data: URL for a Versus room (never the clear picture).
 * Pixel steps go as the tiny cols x rows PNG (exact and tiny; players scale it up with hard pixels),
 * smooth steps as a 320 px JPEG.
 */
export function snapshot(art: Art, mode: Mode, stepIndex: number, hue = 0): { image: string; pixelated: boolean } {
  const { tiny, step } = tinyFor(art, mode, stepIndex, hue);
  if (tiny && !step.smooth) {
    const png = tiny.toDataURL("image/png");
    if (png.length <= SNAP_MAX) return { image: png, pixelated: true };
  }
  const c = canvas(SNAP_W, Math.round(SNAP_W / ASPECT));
  drawStep(c, art, mode, stepIndex, false, hue, SNAP_W);
  let url = "";
  for (const q of [0.72, 0.55, 0.4]) {
    url = c.toDataURL("image/jpeg", q);
    if (url.length <= SNAP_MAX) break;
  }
  return { image: url, pixelated: !step.smooth };
}

const rgb = ([r, g, b]: [number, number, number]) => ({ r, g, b });
const css = (s: Pick<Swatch, "r" | "g" | "b">, a = 1) => `rgba(${s.r},${s.g},${s.b},${a})`;

/** Soft colour blobs where each dominant colour sits in the picture, sized by how much of it there is. */
function drawBlobs(o: CanvasRenderingContext2D, pal: Swatch[], W: number, H: number) {
  if (!pal.length) return;
  const total = pal.reduce((a, s) => a + s.weight, 0) || 1;
  const avg = pal.reduce((a, s) => ({ r: a.r + (s.r * s.weight) / total, g: a.g + (s.g * s.weight) / total, b: a.b + (s.b * s.weight) / total }), { r: 0, g: 0, b: 0 });
  o.fillStyle = css({ r: Math.round(avg.r), g: Math.round(avg.g), b: Math.round(avg.b) });
  o.fillRect(0, 0, W, H);
  for (const s of pal) {
    const cx = s.x * W;
    const cy = s.y * H;
    const rad = W * (0.16 + 0.75 * Math.sqrt(s.weight / total));
    const g = o.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, css(s));
    g.addColorStop(0.45, css(s, 0.85));
    g.addColorStop(1, css(s, 0));
    o.fillStyle = g;
    o.fillRect(0, 0, W, H);
  }
}

/** Keeps loaded art by champion id, so the next one can be preloaded. */
export class ArtCache {
  private map = new Map<string, Promise<Art>>();
  get(champ: Champ): Promise<Art> {
    let p = this.map.get(champ.id);
    if (!p) {
      p = loadArt(champ);
      p.catch(() => this.map.delete(champ.id));
      this.map.set(champ.id, p);
      if (this.map.size > 8) this.map.delete(this.map.keys().next().value!);
    }
    return p;
  }
  clear() {
    this.map.clear();
  }
}
