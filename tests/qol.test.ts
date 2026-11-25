import { describe, expect, it } from "vitest";
import envProduction from "../.env.production?raw";
import { ASK_AGAIN_MS, entryScript, isOAuthReturn, pageTitle, pickHelperRelease, readAnsweredAt, shouldAskLogin } from "../src/components/qol/logic";

describe("page titles", () => {
  it("names each page, keeps the home title, and falls back to 'Page not found'", () => {
    expect(pageTitle("/")).toBe("Bridge Night · Custom games hub");
    expect(pageTitle("/stats")).toBe("Stats · Bridge Night");
    expect(pageTitle("/Stats/")).toBe("Stats · Bridge Night");
    expect(pageTitle("/history")).toBe("Past games · Bridge Night");
    expect(pageTitle("/stats/p0")).toBe("Player stats · Bridge Night");
    expect(pageTitle("/helper")).toBe("Helper app · Bridge Night");
    expect(pageTitle("/nope")).toBe("Page not found · Bridge Night");
  });
});

describe("login prompt", () => {
  const base = { sample: false, canLogin: true, ready: true, loggedIn: false, search: "", hash: "", answeredAt: null, now: 1e12 };
  it("asks visitors once, then again after 7 days", () => {
    expect(shouldAskLogin(base)).toBe(true);
    expect(shouldAskLogin({ ...base, answeredAt: base.now - 1000 })).toBe(false);
    expect(shouldAskLogin({ ...base, answeredAt: base.now - ASK_AGAIN_MS + 1 })).toBe(false);
    expect(shouldAskLogin({ ...base, answeredAt: base.now - ASK_AGAIN_MS })).toBe(true);
  });
  it("never asks logged-in people, before auth is known, or during a login redirect", () => {
    expect(shouldAskLogin({ ...base, loggedIn: true })).toBe(false);
    expect(shouldAskLogin({ ...base, ready: false })).toBe(false);
    expect(shouldAskLogin({ ...base, canLogin: false })).toBe(false);
    expect(shouldAskLogin({ ...base, hash: "#access_token=x&refresh_token=y" })).toBe(false);
    expect(shouldAskLogin({ ...base, search: "?code=abc" })).toBe(false);
    expect(shouldAskLogin({ ...base, search: "?error=access_denied&error_description=x" })).toBe(false);
  });
  it("in sample mode only shows with ?login-preview", () => {
    const s = { ...base, sample: true, canLogin: false, loggedIn: true };
    expect(shouldAskLogin(s)).toBe(false);
    expect(shouldAskLogin({ ...s, search: "?login-preview" })).toBe(true);
    expect(shouldAskLogin({ ...s, search: "?shot&login-preview=1" })).toBe(true);
    expect(shouldAskLogin({ ...s, search: "?login-previews" })).toBe(false);
  });
  it("reads the stored answer safely", () => {
    expect(readAnsweredAt(null)).toBe(null);
    expect(readAnsweredAt("garbage")).toBe(null);
    expect(readAnsweredAt("-5")).toBe(null);
    expect(readAnsweredAt("1700000000000")).toBe(1700000000000);
    expect(isOAuthReturn("?tab=1", "#top")).toBe(false);
  });
});

describe("new version check", () => {
  it("finds the entry script of a built index.html", () => {
    expect(entryScript('<script type="module" crossorigin src="/assets/index-Ab12.js"></script>')).toBe("/assets/index-Ab12.js");
    expect(entryScript("<html></html>")).toBe(null);
  });
});

describe("helper release", () => {
  const repo = "me/repo-";
  const rel = (over: Record<string, unknown> = {}, exe: Record<string, unknown> = {}) => ({
    tag_name: "helper-v0.3.0",
    html_url: `https://github.com/${repo}/releases/tag/helper-v0.3.0`,
    published_at: "2026-11-25T16:21:00Z",
    draft: false,
    body: "",
    assets: [{ name: "bridge-night-helper.exe", browser_download_url: `https://github.com/${repo}/releases/download/helper-v0.3.0/bridge-night-helper.exe`, digest: "sha256:" + "AB".repeat(32), ...exe }],
    ...over,
  });
  it("picks the newest helper release with the exe and a valid fingerprint", () => {
    const r = pickHelperRelease([rel({ tag_name: "helper-v0.3.1", assets: [] }), rel()], repo);
    expect(r?.version).toBe("0.3.0");
    expect(r?.sha256).toBe("ab".repeat(32));
    expect(r?.date).toBe("25.11.2026");
  });
  it("ignores drafts, other tags and download links that don't point at our repo", () => {
    expect(pickHelperRelease([rel({ draft: true })], repo)).toBe(null);
    expect(pickHelperRelease([rel({ tag_name: "v1.0.0" })], repo)).toBe(null);
    expect(pickHelperRelease([rel({}, { browser_download_url: "https://evil.example/x.exe" })], repo)).toBe(null);
    expect(pickHelperRelease([rel({ html_url: "javascript:alert(1)" })], repo)).toBe(null);
    expect(pickHelperRelease({ message: "rate limited" }, repo)).toBe(null);
    expect(pickHelperRelease([rel({}, { digest: "sha256:nothex" })], repo)?.sha256).toBe(null);
  });
});

describe("no secrets in the website", () => {
  const looksSecret = (v: string) => {
    if (/^sb_secret_/.test(v)) return true;
    const part = v.split(".")[1];
    if (!part) return false;
    try {
      return /service_role/.test(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return false;
    }
  };
  it("detects secret-looking values", () => {
    const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.y`;
    expect(looksSecret("sb_secret_abc")).toBe(true);
    expect(looksSecret(jwt("service_role"))).toBe(true);
    expect(looksSecret(jwt("anon"))).toBe(false);
    expect(looksSecret("sb_publishable_abc")).toBe(false);
  });
  it("only public values are exposed to the browser (VITE_ variables and .env.production)", () => {
    // Values are never printed: a failure only names the variable.
    const bad = Object.entries(import.meta.env).filter(([k, v]) => k.startsWith("VITE_") && typeof v === "string" && looksSecret(v)).map(([k]) => k);
    const prod = envProduction
      .split(/\r?\n/)
      .filter((l) => /^VITE_\w+=/.test(l) && looksSecret(l.slice(l.indexOf("=") + 1).trim()))
      .map((l) => l.slice(0, l.indexOf("=")));
    expect([...bad, ...prod]).toEqual([]);
  });
});
