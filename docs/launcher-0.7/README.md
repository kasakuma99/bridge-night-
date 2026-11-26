# Helper 0.7: design handover

Everything that was decided for the next helper (the Windows tray app in `helper/`), so it can be built from here.
Open `mockup.html` in a browser: it is clickable, with a screen picker at the bottom. `all-screens.jpg` shows every screen at once.

> This is a **design mockup with sample data**, not working code. The current helper is 0.6.0 (C# WinForms, built with
> `helper/build.ps1`). Build 0.7 on a `<topic>-dev` branch first, e.g. `launcher-dev`; `main` is the live site.

## Ground rules

- **Light on the PC.** Nothing animates in the background. Every live view stops measuring when its page or the window is
  closed. In the tray it only watches the League client. The only thing that runs continuously is instant replay, and only if
  the user switches it on.
- **Don't copy the site.** The helper only does what needs the PC. Teams, history, stats, rivals and builds stay on the site; the
  helper shows a short note and an "Open on the site" button (see `screens/18-map.jpg`).
- **Fair play stays.** Read-only towards League: never clicks, picks or changes anything. Custom games only. Champions only from
  the loading screen on.
- **No admin rights.** CPU temperature and an FPS counter would need admin or a driver (and may conflict with Vanguard), so they
  are left out. AMD Adrenalin already has an FPS overlay.
- **We all use AMD graphics cards.** GPU temperature comes from the AMD driver (no admin needed; test it on one PC).

## Look

- Near-black violet base with thin borders (Windows 11 style: Mica, rounded corners, Segoe UI Variable).
- The sunset gradient (#ff4f8e → #ff7466 → #ff9c4a) only on the logo, the main button of a screen, active tiles and switches.
  The switches keep the gradient.
- Few descriptions under features; explanations live on the **Help** page and in the **first-start tour** (skippable,
  replayable from Help). Each page title has a small "?" that opens Help.
- New logo: a suspension bridge in front of a striped retro sunset. Files in `logo/`: full and small SVGs (the small one for
  16 to 24 px), an outline SVG for the faint window watermark, PNGs from 16 to 1024 px, `bridge-night.ico` (could replace
  `helper/app.ico`), wordmarks and a 1200×630 banner.

## Screens

| Screen | What it does |
|---|---|
| Home | One status line (League → helper → site), game night check-in ("I'm in"), tiles for mic, headset, game mode, Discord status, last sent, ping, this PC, newest clip. In game: timer and build buttons for your champion. |
| Clips | Built-in **instant replay** (Windows Graphics Capture + the AMD encoder): Ctrl+Alt+S saves the last 15/30/60 s, named after champion and score, "Discord-ready" under 10 MB. **Off by default** (about 1–3 % GPU while League runs). No ReLive, Game Bar, Medal or DaVinci folders. |
| Performance | Tabs **Live** (big chart for CPU, GPU, memory, VRAM; CPU threads; memory split; disk and network; tips), **Last game** (chart of the whole game, peaks, what limited the PC, last 5 games), **Apps** (what uses the most with Close, what starts with Windows, drives, uptime). A small switch to turn live measuring off and a **1s / 5s / 10s** picker, also in Settings. |
| Network | Ping, jitter, packet loss to EUW, and where lag comes from (PC, router, provider, Riot). |
| Game mode | Before game night: pending Windows restart, League patch. When a game starts: high-performance power plan, music quieter, optional break reminder. Gamer fixes: monitor stuck at 60 Hz, mouse acceleration, Sticky Keys pop-up. |
| Audio | Compact mic row with mute (**Ctrl+Alt+M**, mutes in Windows so every app goes quiet), output switch headset/speakers/monitor (**Ctrl+Alt+H**), mute sound and on-screen "Muted" badge. Not Ctrl+Shift+M (Discord) or Ctrl+Shift+O (AMD overlay). |
| Settings | Connection (token), alerts, start with Windows, Discord status, pause sending, Performance (live on/off, 1s/5s/10s, record last game), version and update. |
| Help | Explanations per page, hotkeys, "launcher or site", log (moved here from Settings), "still stuck? ask in Discord". |
| Mini window | Slim always-on-top strip: status or game timer, mic, headset, ping, GPU, back to the full window. Updates every 5 s. Button in the title bar. |
| Tray panel, pop-ups | Flyout by the clock (status, quick buttons). Pop-ups: teams locked, loading screen with builds, win saved with rating change, game night reminder. |
| Update | In-app update check: on start and once a day, the helper asks GitHub for the newest release. If there is one, a banner shows the new version and what it changes. "Update and restart" downloads it, checks the SHA-256 against the release, replaces the old file and restarts. Nothing installs without a click; "Later" hides the banner until the next version. |
| Share card, Discord status | A picture of your own game to paste into Discord; Rich Presence "Bridge Night · 3v3 · Blue side" (needs a free Discord app ID). |

**Removed on purpose:** lobby password, "quiet Windows pop-ups", lock the Windows key, shut down after the game, pin window on
top, keep PC awake, reading other recorders' clip folders.

## Needs the site too

- "I'm in" and the game night time need a small addition to the site and the database (the site still shows who's playing).
- The share card and pop-ups use data the site already has (result, rating change, rivalries).

## Notes from the design

- In the mockup the site address reads `bridge-night.pages.dev`; the real one is `bridge-night.bridge-night.workers.dev`.
- The mockup is HTML; in WinForms some effects (blur, smooth motion) are limited. A WebView2 window could reuse the design 1:1
  but adds a dependency to the build.
