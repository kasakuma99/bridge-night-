export const HOUR = 36e5;
export const DAY = 864e5;
export const TZ = "Europe/Berlin";

export type Rng = () => number;

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const rndInt = (n: number, rng: Rng = Math.random) => Math.floor(rng() * n);

export function shuffle<T>(a: readonly T[], rng: Rng = Math.random): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rndInt(i + 1, rng);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function combos<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...combos(t, k - 1).map((c) => [h, ...c]), ...combos(t, k)];
}

/** Seeded PRNG (Park–Miller) for sample data and tests. */
export function seeded(seed: number): Rng {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** "3h", "40 min", "2 days" */
export function fmtDuration(ms: number): string {
  const h = Math.floor(ms / HOUR);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  if (h >= 1) return `${h}h`;
  return `${Math.max(1, Math.round(ms / 6e4))} min`;
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1e3));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in Berlin, "2026-11-25". */
export const dayKey = (t: number) => partsFmt.format(new Date(t));
/** Calendar month in Berlin, "2026-11". */
export const monthKey = (t: number) => dayKey(t).slice(0, 7);

export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const fmtDayLong = (t: number) =>
  new Date(t).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

export const fmtMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export const isDiscordInvite = (u: string) => /^https:\/\/(discord\.gg|discord\.com)\/\S+$/.test(u.trim());

export const RIOT_ID_RE = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/;
