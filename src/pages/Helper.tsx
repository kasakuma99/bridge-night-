import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ShieldCheck } from "lucide-react";

export const REPO = "kasakuma99/bridge-night-";

interface Release {
  version: string;
  url: string;
  sha256: string | null;
  date: string;
  page: string;
}

/** Newest helper release from GitHub (public API, no key). */
function useHelperRelease() {
  const [state, setState] = useState<{ loading: boolean; release: Release | null }>({ loading: true, release: null });
  useEffect(() => {
    const ac = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { signal: ac.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { tag_name: string; html_url: string; published_at: string; body?: string; draft: boolean; assets: { name: string; browser_download_url: string; digest?: string }[] }[]) => {
        const rel = list.find((r) => !r.draft && r.tag_name.startsWith("helper-v") && r.assets.some((a) => a.name === "bridge-night-helper.exe"));
        if (!rel) return setState({ loading: false, release: null });
        const exe = rel.assets.find((a) => a.name === "bridge-night-helper.exe")!;
        const fromDigest = exe.digest?.startsWith("sha256:") ? exe.digest.slice(7) : null;
        const fromNotes = rel.body?.match(/SHA-256:\*\*\s*`([0-9a-f]{64})`/i)?.[1] ?? null;
        setState({
          loading: false,
          release: {
            version: rel.tag_name.replace(/^helper-v/, ""),
            url: exe.browser_download_url,
            sha256: (fromDigest ?? fromNotes)?.toLowerCase() ?? null,
            date: new Date(rel.published_at).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" }),
            page: rel.html_url,
          },
        });
      })
      .catch(() => !ac.signal.aborted && setState({ loading: false, release: null }));
    return () => ac.abort();
  }, []);
  return state;
}

export default function Helper() {
  const { loading, release } = useHelperRelease();
  return (
    <section>
      <div className="head">
        <div>
          <h1>Helper app</h1>
          <p className="sub">Optional. Fills in picks, K/D/A, items and the winner by itself, so nobody has to type.</p>
        </div>
      </div>
      <div className="settings">
        <div className="panel prose">
          <h2>What it does</h2>
          <ul>
            <li>
              <b>A small tray app for Windows.</b> No admin rights, no background service, no autostart unless you turn it on.
            </li>
            <li>
              <b>Reads, never controls.</b> It reads the League client's local data on your own PC (the same things you already see
              on screen) and never sends commands to the client.
            </li>
            <li>
              <b>Champ select:</b> both teams' picks appear on the <Link to="/live">Live</Link> page automatically.
            </li>
            <li>
              <b>Moves the game along:</b> champ select, in game and result switch by themselves. The buttons on the site still work
              for games where nobody runs the helper.
            </li>
            <li>
              <b>After the game:</b> sends K/D/A, items, damage and the winner for everyone. Players are matched by Riot ID; unknown
              accounts are ignored.
            </li>
          </ul>
          <h2>Who needs it</h2>
          <p className="sub">Just one player per game. If two people run it, the game is still only saved once.</p>
          <h2>Download</h2>
          {release ? (
            <>
              <p className="sub">
                Version {release.version}, published {release.date}.{" "}
                <a href={release.page} target="_blank" rel="noopener noreferrer">
                  Release notes on GitHub
                </a>
              </p>
              <div>
                <a className="btn pri" href={release.url}>
                  <Download aria-hidden /> Download bridge-night-helper.exe
                </a>
              </div>
              {release.sha256 && (
                <p className="sub">
                  SHA-256: <span style={{ wordBreak: "break-all" }}>{release.sha256}</span>
                </p>
              )}
              <h2>Set it up</h2>
              <ol>
                <li>Download it and double-click it. If Windows says "unknown publisher", click More info, then Run anyway (see the right).</li>
                <li>Ask an admin for a helper token (Players page, "Helper tokens").</li>
                <li>Paste the token in the helper's window and click "Save and test connection".</li>
                <li>Leave it running (icon next to the clock). It does its thing in custom games only.</li>
              </ol>
            </>
          ) : (
            <>
              <p className="sub">
                {loading ? "Looking for the latest version…" : "No release found right now. Try again later, or see the releases on GitHub."}
              </p>
              <div>
                <a className="btn" href={`https://github.com/${REPO}/releases`} target="_blank" rel="noopener noreferrer">
                  <Download aria-hidden /> Releases on GitHub
                </a>
              </div>
            </>
          )}
        </div>
        <div className="panel prose">
          <h2 style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <ShieldCheck aria-hidden style={{ color: "var(--color-ice)" }} /> How to check it's safe
          </h2>
          <ol>
            <li>
              <b>Read the source.</b> All of its code is public in our GitHub repository, next to this website.
            </li>
            <li>
              <b>Compare the fingerprint.</b> In PowerShell run <q>Get-FileHash .\bridge-night-helper.exe</q> and check that it matches
              the SHA-256 shown on this page and on the GitHub release.
            </li>
            <li>
              <b>Scan it.</b> Upload the file to VirusTotal if you want a second opinion.
            </li>
          </ol>
          <p className="sub">
            The app isn't signed with a paid certificate, so Windows SmartScreen or antivirus may warn about an "unknown publisher". That
            warning is about the missing certificate, not about what the app does.
          </p>
          <p className="sub">No ads, no tracking, no crypto. It only talks to this site.</p>
        </div>
      </div>
    </section>
  );
}
