// Small pure helpers for the quality-of-life parts (tested in tests/qol.test.ts).

export const SITE = "Bridge Night";
const DAY = 864e5;

const TITLES: Record<string, string> = {
  "/live": "Live",
  "/history": "Past games",
  "/stats": "Stats",
  "/rivals": "Rivals",
  "/builds": "Builds",
  "/players": "Players",
  "/helper": "Helper app",
};

/** "Stats · Bridge Night"; the home page keeps the title from index.html. */
export function pageTitle(pathname: string) {
  const p = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  if (p === "/") return `${SITE} · Custom games hub`;
  if (p.startsWith("/stats/")) return `Player stats · ${SITE}`;
  return `${TITLES[p] ?? "Page not found"} · ${SITE}`;
}

/* ---------- login prompt ---------- */

export const LOGIN_PROMPT_KEY = "bn-login-prompt";
export const ASK_AGAIN_MS = 7 * DAY;

/** True while Supabase is finishing (or failed) a Discord login redirect. */
export const isOAuthReturn = (search: string, hash: string) => /[?&#](code|access_token|refresh_token|error|error_description)=/.test(search + hash);

export function shouldAskLogin(o: {
  sample: boolean;
  canLogin: boolean;
  ready: boolean;
  loggedIn: boolean;
  search: string;
  hash: string;
  /** when this device last answered the prompt (ms), or null */
  answeredAt: number | null;
  now: number;
}) {
  // Sample mode has no real login: only show it on purpose, for testing the design.
  if (o.sample) return /[?&]login-preview(=|&|$)/.test(o.search);
  if (!o.canLogin || !o.ready || o.loggedIn || isOAuthReturn(o.search, o.hash)) return false;
  return o.answeredAt === null || o.now - o.answeredAt >= ASK_AGAIN_MS;
}

export function readAnsweredAt(raw: string | null) {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------- new version check ---------- */

/** The entry script of a built index.html ("/assets/index-abc123.js"), or null. */
export function entryScript(html: string) {
  return html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1] ?? null;
}

/* ---------- helper release from the GitHub API ---------- */

export interface GhRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body?: string | null;
  draft: boolean;
  assets: { name: string; browser_download_url: string; digest?: string | null }[];
}

export interface Release {
  version: string;
  url: string;
  sha256: string | null;
  date: string;
  page: string;
}

/** Newest helper release whose links really point at our repo on GitHub (never trust a URL just because the API sent it). */
export function pickHelperRelease(list: unknown, repo: string): Release | null {
  if (!Array.isArray(list)) return null;
  const base = `https://github.com/${repo}/releases/`;
  for (const rel of list as GhRelease[]) {
    if (!rel || rel.draft || typeof rel.tag_name !== "string" || !/^helper-v[0-9][0-9A-Za-z.-]*$/.test(rel.tag_name)) continue;
    const exe = rel.assets?.find((a) => a.name === "bridge-night-helper.exe");
    if (!exe || !exe.browser_download_url?.startsWith(base + "download/") || !rel.html_url?.startsWith(base)) continue;
    const fromDigest = exe.digest?.startsWith("sha256:") ? exe.digest.slice(7) : null;
    const fromNotes = rel.body?.match(/SHA-256:\*\*\s*`([0-9a-f]{64})`/i)?.[1] ?? null;
    const sha = (fromDigest ?? fromNotes)?.toLowerCase() ?? null;
    const when = new Date(rel.published_at);
    return {
      version: rel.tag_name.replace(/^helper-v/, ""),
      url: exe.browser_download_url,
      sha256: sha && /^[0-9a-f]{64}$/.test(sha) ? sha : null,
      date: isNaN(+when) ? "" : when.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }),
      page: rel.html_url,
    };
  }
  return null;
}
