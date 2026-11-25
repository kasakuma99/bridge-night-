import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Code, Download, Eye, FastForward, LifeBuoy, Monitor, ShieldCheck, Swords, Trophy } from "lucide-react";
import { SAMPLE_MODE, useAuth } from "../data/context";
import { HelperTokensPanel } from "../components/HelperAdmin";
import { Logo } from "../components/ui";
import { pickHelperRelease, type Release } from "../components/qol/logic";
import "../styles/helper.css";

export const REPO = "kasakuma99/bridge-night-";

/** Newest helper release from GitHub (public API, no key). */
function useHelperRelease() {
  const [state, setState] = useState<{ loading: boolean; release: Release | null }>({ loading: true, release: null });
  useEffect(() => {
    const ac = new AbortController();
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { signal: ac.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown) => setState({ loading: false, release: pickHelperRelease(list, REPO) }))
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
          Shows your custom games live on the site and saves the results, so nobody has to type. Just one player per game needs it; if
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
              <b>Reads, never controls.</b> It reads what the League client and the game offer to programs on your own PC, and never
              sends commands to them.
            </span>
          </li>
          <li>
            <Swords aria-hidden />
            <span>
              <b>Fair play:</b> during champ select the <Link to="/live">Live</Link> page only shows who plays on which side. Champions appear when the game loads, like on the loading screen.
            </span>
          </li>
          <li>
            <FastForward aria-hidden />
            <span>
              <b>Live:</b> both teams with champions, levels, K/D/A, items and summoner spells, the game clock and what happens.
            </span>
          </li>
          <li>
            <Trophy aria-hidden />
            <span>
              <b>After the game:</b> the winner, how it ended, final stats and augments. Players are matched by Riot ID; others show as
              guests, without their name.
            </span>
          </li>
        </ul>

        <h2 className="hg-label">On the website</h2>
        <ol className="hg-steps">
          <Step
            n={1}
            title="Log in with Discord and get approved"
            text="An admin approves new members, then the helper can send games for you. If you can read this on the live site, you're in."
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
                Leave it running (BN icon next to the clock). It only does something in custom games: they show up on the{" "}
                <Link to="/live">Live</Link> page by themselves and are saved when they end.
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
              Look at the <Link to="/live">Live</Link> page: if League named no winner, <b>a member chooses</b> there.
            </li>
            <li>
              At least one player needs a <b>Riot ID</b> on the Players page.
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
