import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Code, Download, Eye, FastForward, LifeBuoy, Monitor, ShieldCheck, Swords, Trophy } from "lucide-react";
import { SAMPLE_MODE, useAuth } from "../data/context";
import { HelperTokensPanel } from "../components/HelperAdmin";
import { Logo } from "../components/ui";
import "../styles/helper.css";

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

/** Breadcrumb of what to click; the last chip is the one that matters. */
function Path({ items }: { items: string[] }) {
  return (
    <p className="hg-path" aria-label={`Click: ${items.join(", then ")}`}>
      {items.map((t, i) => (
        <Fragment key={t}>
          {i > 0 && <ChevronRight aria-hidden />}
          <span className={i === items.length - 1 ? "on" : undefined}>{t}</span>
        </Fragment>
      ))}
    </p>
  );
}

function Step({ n, title, text, path, aside, children }: { n: number; title: string; text: ReactNode; path?: string[]; aside?: ReactNode; children?: ReactNode }) {
  return (
    <li className="hg-step">
      <span className="hg-num" aria-hidden>
        {n}
      </span>
      <div className="hg-body">
        <h3>
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <p className="hg-text">{text}</p>
        {path && <Path items={path} />}
        {children}
      </div>
      {aside && <div className="hg-aside">{aside}</div>}
    </li>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="hg-box">
      <h3>{title}</h3>
      <ul>{children}</ul>
    </div>
  );
}

export default function Helper() {
  const { loading, release } = useHelperRelease();
  const { isMember, pending, user, canLogin } = useAuth();
  return (
    <section className="hg" aria-labelledby="hg-h">
      <div className="hg-card">
        <div className="hg-top">
          <span className="hg-brand">
            <Logo size={26} /> Bridge Night
          </span>
          <span className="hg-pill">Setup guide</span>
        </div>
        <h1 id="hg-h" className="hg-title">
          Helper app
        </h1>
        <p className="hg-lead">
          Optional. Fills in picks, K/D/A, items and the winner by itself, so nobody has to type. Just one player per game needs it; if
          two people run it, the game is still only saved once.
        </p>

        <ul className="hg-facts" aria-label="What it does">
          <li>
            <Monitor aria-hidden />
            <span>
              <b>A small tray app for Windows.</b> No admin rights, no background service, no autostart unless you turn it on.
            </span>
          </li>
          <li>
            <Eye aria-hidden />
            <span>
              <b>Reads, never controls.</b> It reads the League client's local data on your own PC (the same things you already see on
              screen) and never sends commands to the client.
            </span>
          </li>
          <li>
            <Swords aria-hidden />
            <span>
              <b>Champ select:</b> both teams' picks appear on the <Link to="/live">Live</Link> page automatically.
            </span>
          </li>
          <li>
            <FastForward aria-hidden />
            <span>
              <b>Moves the game along:</b> champ select, in game and result switch by themselves. The buttons on the site still work for
              games where nobody runs the helper.
            </span>
          </li>
          <li>
            <Trophy aria-hidden />
            <span>
              <b>After the game:</b> sends K/D/A, items, damage and the winner for everyone. Players are matched by Riot ID; unknown
              accounts are ignored.
            </span>
          </li>
        </ul>

        <h2 className="hg-label">On the website</h2>
        <ol className="hg-steps">
          <Step
            n={1}
            title="Log in with Discord and get approved"
            text="Log in at the top right. An admin approves new members, then the helper can send games for you."
            path={["Log in", "Discord", "Wait for approval"]}
          />
          <Step
            n={2}
            title="Download the helper"
            text={
              release ? (
                <>
                  Version {release.version}, published {release.date}.{" "}
                  <a href={release.page} target="_blank" rel="noopener noreferrer">
                    Release notes on GitHub
                  </a>
                </>
              ) : loading ? (
                "Looking for the latest version…"
              ) : (
                "No release found right now. Try again later, or see the releases on GitHub."
              )
            }
            aside={
              release?.sha256 && (
                <div className="hg-code">
                  <span className="hg-code-k">SHA-256</span>
                  <code>{release.sha256.match(/.{1,16}/g)!.join(" ")}</code>
                  <span className="hg-code-k">Fingerprint of this download</span>
                </div>
              )
            }
          >
            {release ? (
              <a className="btn pri" href={release.url}>
                <Download aria-hidden /> Download bridge-night-helper.exe
              </a>
            ) : (
              !loading && (
                <a className="btn" href={`https://github.com/${REPO}/releases`} target="_blank" rel="noopener noreferrer">
                  <Download aria-hidden /> Releases on GitHub
                </a>
              )
            )}
          </Step>
        </ol>

        <h2 className="hg-label">On your PC</h2>
        <ol className="hg-steps" start={3}>
          <Step
            n={3}
            title="If Windows warns you"
            text={`Double-click the file. If Windows says "Windows protected your PC", click More info, then Run anyway. The app isn't signed with a paid certificate; that is all the warning means.`}
            path={["More info", "Run anyway"]}
          />
          <Step
            n={4}
            title="Make your token and paste it"
            text="Make a helper token here and copy it (it's shown only once). Paste it into the helper's window and save."
            path={["Helper window", "Helper token", "Save and test connection"]}
          >
            {isMember && !SAMPLE_MODE ? (
              <HelperTokensPanel />
            ) : (
              <p className="note">
                {pending
                  ? `You're logged in as ${user?.name}. As soon as an admin approves you, you can make your token here.`
                  : canLogin
                    ? "Log in with Discord (top right) to make your helper token here."
                    : "Helper tokens are made on the live site."}
              </p>
            )}
          </Step>
        </ol>

        <h2 className="hg-label">In League</h2>
        <ol className="hg-steps" start={5}>
          <Step
            n={5}
            title="Play"
            text={
              <>
                Leave it running (BN icon next to the clock). It only does something in custom games: picks show on the{" "}
                <Link to="/live">Live</Link> page, the result is sent after the game.
              </>
            }
            path={["BN tray icon", "Custom game"]}
          />
        </ol>
      </div>

      <div className="hg-card">
        <h2 className="hg-h2">
          <ShieldCheck aria-hidden /> How to check it's safe
        </h2>
        <div className="hg-boxes">
          <Box title="Read the source">
            <li>
              <b>All of its code is public</b> in our GitHub repository, next to this website.
            </li>
          </Box>
          <Box title="Compare the fingerprint">
            <li>
              In PowerShell run <code>Get-FileHash .\bridge-night-helper.exe</code>
            </li>
            <li>
              It must <b>match the SHA-256</b> shown on this page and on the GitHub release.
            </li>
          </Box>
          <Box title="Scan it">
            <li>
              Upload the file to <b>VirusTotal</b> if you want a second opinion.
            </li>
          </Box>
          <Box title="Unknown publisher?">
            <li>
              It isn't signed with a paid certificate, so <b>SmartScreen</b> or antivirus may warn. That is about the missing certificate,
              not about what the app does.
            </li>
            <li>
              <b>No ads, no tracking, no crypto.</b> It only talks to this site.
            </li>
          </Box>
        </div>
      </div>

      <div className="hg-card">
        <h2 className="hg-h2">
          <LifeBuoy aria-hidden /> Helper not working?
        </h2>
        <p className="hg-lead">What to check, quickest first.</p>
        <div className="hg-boxes">
          <Box title="Connection test fails">
            <li>
              Check the token for a <b>typo</b>, or make a new one: it may be <b>revoked</b>.
            </li>
            <li>
              Still failing? <b>Ask an admin.</b>
            </li>
          </Box>
          <Box title="Nothing shows up in champ select">
            <li>
              It works in <b>custom games only</b>, and <b>League must be open</b>.
            </li>
            <li>
              Champions appear <b>when the game loads</b>, never during champ select (fair play).
            </li>
          </Box>
          <Box title="Result not counted">
            <li>
              Check <b>Pending results</b> on the <Link to="/live">Live</Link> tab.
            </li>
            <li>
              A <b>member confirms</b> it there, then it counts.
            </li>
          </Box>
          <Box title="Windows blocks it">
            <li>
              <b>SmartScreen:</b> More info, then Run anyway.
            </li>
            <li>
              Unsure? <b>Compare the SHA-256</b> with Get-FileHash first.
            </li>
          </Box>
        </div>
      </div>

      <p className="hg-foot">
        <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener noreferrer">
          <Code aria-hidden /> Source: github.com/{REPO}
        </a>
        <span>Free and open source</span>
      </p>
    </section>
  );
}
