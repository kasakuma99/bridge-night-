import { Link } from "react-router-dom";
import { Download, ShieldCheck } from "lucide-react";

export default function Helper() {
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
          <p className="sub">The helper is coming soon. When it's ready, the download and its fingerprint (SHA-256) appear here.</p>
          <div>
            <button className="btn pri" type="button" disabled>
              <Download aria-hidden /> Download for Windows (coming soon)
            </button>
          </div>
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
