// End-to-end test: clicks through every page of the site with sample data.
// 1) start the dev server:  npm run dev:sample -- --port 5174
// 2) run:                   npm run e2e         (BASE=http://localhost:5174 by default)
// Uses the Chrome that is installed on this PC (E2E_BROWSER=msedge for Edge). Screenshots go to SHOTS (optional).
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:5174";
const SHOTS = process.env.SHOTS || "";

let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
}
const step = (s) => console.log(`\n${s}`);

(async () => {
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER || "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ctx.setDefaultTimeout(8000);
  const p = await ctx.newPage();
  const errors = [];
  const hosts = new Set();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|ddragon|ERR_/.test(m.text()) && errors.push(m.text()));
  p.on("request", (r) => hosts.add(new URL(r.url()).host));
  const shot = async (name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const main = () => p.locator("main");
  const btn = (name) => main().getByRole("button", { name, exact: true });
  const h1 = async () => (await p.locator("main h1").first().textContent()).trim();
  const dialogBtn = (name) => p.locator("dialog[open]").getByRole("button", { name });
  const toast = (text) => p.locator(".toast").filter({ hasText: text }).first().waitFor().then(() => true, () => false);
  const role = async (r) => p.getByLabel("Preview the site as").selectOption(r);
  const data = () => p.evaluate(() => JSON.parse(localStorage.getItem("bn-data-v4")));
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await p.goto(BASE + "/");
  // Never click through real data.
  const preview = await p.getByText("Local preview with sample players").count().catch(() => 0);
  if (!preview || hosts.size > 4 || [...hosts].some((h) => /supabase/.test(h))) {
    console.error(`\n${BASE} doesn't show the sample data. Start it with: npm run dev:sample -- --port 5174`);
    await browser.close();
    process.exit(1);
  }
  await p.evaluate(() => localStorage.clear());
  await p.reload();

  step("Private site");
  await role("visitor");
  for (const r of ["/", "/live", "/history", "/stats", "/rivals", "/players", "/helper", "/does-not-exist"]) {
    await p.goto(BASE + r);
    await p.getByText("This site is private").waitFor();
    ok((await p.locator("nav.k-tabs a").count()) === 0 && !/Samu|Lenny|Artur/.test(await p.locator("#root").innerText()), `${r} shows only the login`);
  }
  await shot("00-login");
  await p.goto(BASE + "/");
  await btn("Log in with Discord").click();
  await p.locator("nav.k-tabs a").first().waitFor();
  ok((await p.locator("nav.k-tabs a").allInnerTexts()).join() === "Teams,Live,Past games,Stats,Rivals,Players,Arcade", "menu after logging in");
  await p.locator(".qol-acct-btn").click();
  ok(await p.locator(".qol-acct-pop").getByText("Log out").isVisible(), "account menu");
  await p.keyboard.press("Escape");
  ok((await p.locator(".qol-acct-pop").count()) === 0, "Escape closes it");
  await role("admin");

  step("Teams: modes and players");
  await btn("Create random teams").click();
  ok((await main().locator(".mode").count()) === 5, "1v1 to 5v5");
  await main().locator(".mode", { hasText: "3v3" }).click();
  const chip = (n) => main().locator('[aria-label="Players"] .chip', { hasText: n });
  ok((await main().locator('[aria-label="Players"] .chip').count()) === 6, "6 sample players");
  ok(await btn("Generate teams").isDisabled(), "needs at least 2 players");
  await p.getByLabel("Search for a name").fill("len");
  ok((await main().locator('[aria-label="Players"] .chip').count()) === 1, "search finds Lenny");
  await p.keyboard.press("Enter");
  ok((await main().locator(".ptable tbody tr", { hasText: "Lenny" }).count()) === 1, "Enter adds Lenny");
  for (const n of ["Tosh", "Samu", "Artur", "Philip", "Nick"]) await chip(n).click();
  ok((await main().locator(".ptable tbody tr").count()) === 6, "6 players in the table");
  ok((await main().locator(".ptable tbody").innerText()).includes("1,000"), "Papi Points");
  await main().getByLabel("Remove Nick").click();
  ok((await main().locator(".ptable tbody tr").count()) === 5, "a player can be removed again");
  await shot("01-teams-players");

  step("Teams: uneven, equal, smaller, rerolls");
  await btn("Generate teams").click();
  await dialogBtn(/Play uneven \(3v2\)/).click();
  const board = main().locator('[data-testid="board"]');
  await board.waitFor();
  const sizes = async () => [await board.locator(".side.b .pl").count(), await board.locator(".side.r .pl").count()].sort().join("v");
  ok((await sizes()) === "2v3", "3v2 teams");
  await shot("02-teams-uneven");
  let different = false;
  const one = await board.innerText();
  for (let i = 0; i < 6 && !different; i++) {
    await btn("Reroll").click();
    await p.waitForTimeout(150);
    different = (await board.innerText()) !== one;
  }
  ok(different && (await sizes()) === "2v3", "rerolls as often as you like");
  await btn("Reset").click();
  const setup = async (mode, names) => {
    await p.goto(BASE + "/");
    await btn("Create random teams").click();
    await main().locator(".mode", { hasText: mode }).click();
    for (const n of names) await chip(n).click();
    await btn("Generate teams").click();
  };
  await setup("3v3", ["Tosh", "Samu", "Lenny", "Artur", "Philip"]);
  await dialogBtn(/Keep it equal \(2v2/).click();
  await board.waitFor();
  ok((await sizes()) === "2v2" && (await main().locator(".sit").innerText()).startsWith("Sitting out:"), "equal teams, one sits out");
  await btn("Reset").click();
  await setup("3v3", ["Tosh", "Samu", "Lenny", "Artur"]);
  await dialogBtn("Play 2v2").click();
  await board.waitFor();
  ok((await sizes()) === "2v2", "a smaller game with too few players");
  await btn("Reset").click();

  step("Live: a whole game (simulated)");
  await p.goto(BASE + "/live");
  ok((await h1()) === "Live game", "no game yet");
  await main().locator(".simpanel summary").click();
  const sim = async (kind) => {
    await p.getByLabel("Simulated size").selectOption(kind);
    await btn("1. Champ select").click();
  };
  await sim("3v2");
  await main().locator("h1", { hasText: "Champ Select" }).waitFor();
  const champIcons = () => main().locator('.ava.sq:not(.unknown) img, img.ava.sq').count();
  ok((await main().innerText()).includes("Champions show up on the loading screen"), "no champions in champ select");
  ok((await p.locator("nav.k-tabs .live-dot").count()) === 1, "red dot on the Live tab");
  await btn("2. Loading screen").click();
  await main().getByText("Loading screen", { exact: true }).first().waitFor();
  ok((await h1()) === "In Game", "loading screen");
  await p.getByLabel("Simulated speed").selectOption("30");
  await btn("3. Start game").click();
  await main().locator(".timer").waitFor();
  await p.waitForTimeout(8000);
  ok(/^\d+:\d\d$/.test((await main().locator(".timer").innerText()).trim()) && (await main().locator(".timer").innerText()) !== "0:00", "the clock runs");
  ok((await main().locator(".gamelog li").count()) > 1, "log");
  ok((await champIcons()) >= 5, "champion icons");
  await shot("03-live");
  await btn("Surrender").click();
  await main().locator("h1", { hasText: "Recently Ended" }).waitFor();
  ok(/(Blue|Red) side won/.test(await main().innerText()) && (await main().innerText()).includes("surrendered (FF)"), "winner and why");
  await btn("Augments arrive").click();
  await p.waitForTimeout(800);
  await shot("04-ended");
  ok((await p.locator("nav.k-tabs .live-dot").count()) === 0, "the dot is gone");
  await main().getByRole("link", { name: "Past games" }).first().click();
  await main().locator("h1", { hasText: "Past games" }).waitFor();
  ok((await h1()) === "Past games" && (await main().locator(".match").count()) === 1, "saved in Past games");

  step("Live: no winner, a member decides");
  await p.goto(BASE + "/live");
  await main().locator(".simpanel summary").click();
  await sim("2v2");
  await btn("3. Start game").click();
  await p.waitForTimeout(2500);
  await btn("Everyone leaves").click();
  await main().getByText("Waiting for the result from League").waitFor();
  // Three minutes later: the site asks.
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("bn-data-v4"));
    d.feed.end.at -= 200_000;
    localStorage.setItem("bn-data-v4", JSON.stringify(d));
  });
  await p.reload();
  await btn("Red won").click();
  ok((await toast("Red side win saved")) && (await main().innerText()).includes("Result entered by a member"), "a member chooses the winner");
  for (const kind of ["5v5", "solo", "bots"]) {
    await p.goto(BASE + "/live");
    await main().locator(".simpanel summary").click();
    await sim(kind);
    await btn("3. Start game").click();
    await p.waitForTimeout(2200);
    await btn("Nexus").click();
    await main().locator("h1", { hasText: "Recently Ended" }).waitFor();
    ok((await main().innerText()).includes("nexus was destroyed"), `${kind} ends with the nexus`);
  }
  ok((await data()).matches.length === 5, "5 games saved, each once");

  step("Past games: details, filters, admin only");
  await p.goto(BASE + "/history");
  const top = main().locator(".match", { hasText: "3v2" });
  await top.getByRole("button", { name: /Details/ }).click();
  const table = top.locator(".details table");
  ok((await table.locator("th").allInnerTexts()).join().includes("Augments") && (await table.locator("tbody tr").count()) >= 5, "details with augments");
  await shot("05-past-games");
  ok((await top.innerText()).includes("3v2"), "uneven game");
  await p.getByLabel("Filter by mode").selectOption("5");
  ok((await main().locator(".match").count()) === 1, "mode filter");
  await p.getByLabel("Filter by mode").selectOption("");
  const winners = async () => (await data()).matches.map((m) => m.winner).join();
  const before = await winners();
  await main().getByRole("button", { name: "Swap winner" }).first().click();
  await dialogBtn("Swap winner").click();
  ok((await toast("Winner swapped")) && (await winners()) !== before, "admin swaps the winner");
  await main().getByRole("button", { name: "Delete game" }).first().click();
  await p.keyboard.press("Escape");
  ok((await data()).matches.length === 5, "Escape deletes nothing");
  await main().getByRole("button", { name: "Delete game" }).first().click();
  await dialogBtn("Delete").click();
  ok((await toast("Game deleted")) && (await data()).matches.length === 4, "admin deletes a game");
  await role("member");
  ok((await main().getByRole("button", { name: /Swap winner|Delete game/ }).count()) === 0, "members have no such buttons");
  await role("admin");

  step("Stats");
  await p.goto(BASE + "/stats");
  await btn("All time").click();
  ok((await h1()) === "Stats" && (await main().locator(".lbhead").innerText()).includes("Papi Points"), "leaderboard");
  ok(!/\b(Elo|rating|dodge|bounty|challenge)/i.test(await main().innerText()), "hidden features stay hidden");
  const second = main().locator(".rk-row").nth(1);
  const name = (await second.locator(".who b").innerText()).trim();
  await second.click();
  await p.locator(".pcard h2", { hasText: name }).waitFor();
  ok(true, "a click opens that profile");
  for (const h of ["Records", "Best duos", "Best trios", "Group favourites", "Awards this week", "Monthly champions"])
    ok((await main().getByRole("heading", { name: h }).count()) === 1, `${h} panel`);
  await shot("06-stats");
  await p.goto(BASE + "/stats?player=p1");
  ok((await p.locator(".pcard h2").innerText()).length > 0, "link to a profile");

  step("Rivals");
  await p.goto(BASE + "/rivals");
  ok((await h1()) === "Rivals" && (await main().locator(".h2hrow").count()) > 0, "head-to-head list");

  step("Players");
  await p.goto(BASE + "/players");
  const riot = p.getByLabel("Riot ID of Lenny");
  await riot.fill("lenny");
  await riot.press("Enter");
  ok(await toast("Name#TAG"), "invalid Riot ID rejected");
  await riot.fill("Lenny#TEST");
  await riot.press("Enter");
  ok(await toast("Riot ID saved"), "Riot ID saved");
  await p.getByLabel("New player name").fill("samu");
  await btn("Add player").click();
  ok(await toast("already on the list"), "duplicate names are refused");
  await p.getByLabel("New player name").fill("Guest Gary");
  await btn("Add player").click();
  await p.getByLabel("Remove Guest Gary").click();
  await dialogBtn("Remove").click();
  ok((await toast("Guest Gary removed")) && (await p.getByLabel("Name of Guest Gary").count()) === 0, "player added and removed");
  const download = p.waitForEvent("download");
  await main().getByRole("button", { name: /Download backup/ }).click();
  ok(/bridge-night-backup-.*\.json/.test((await download).suggestedFilename()), "backup downloads as JSON");
  await shot("07-players");
  await role("member");
  ok((await main().getByRole("button", { name: /Download backup|Add player/ }).count()) === 0, "members can't do that");
  await role("admin");

  step("Helper, 404, hidden pages, keyboard, manifest");
  await p.goto(BASE + "/helper");
  ok((await h1()) === "Helper app" && !/Pending results/.test(await main().innerText()), "helper page");
  for (const r of ["/does-not-exist", "/builds", "/stats/p0"]) {
    await p.goto(BASE + r);
    ok((await h1()) === "Lost on the bridge", `${r} doesn't exist`);
  }
  await p.keyboard.press("Tab");
  ok((await p.evaluate(() => document.activeElement.textContent)).trim() === "Skip to content", "skip link is first in tab order");
  const man = await (await p.request.get(BASE + "/manifest.webmanifest")).json();
  ok(man.display === "standalone" && man.icons.length === 3, "web app manifest");
  ok((await p.locator("footer").innerText()).includes("Legal Jibber Jabber"), "Riot notice in the footer");

  step("Phone layout");
  await p.setViewportSize({ width: 375, height: 780 });
  for (const r of ["/", "/live", "/history", "/stats", "/rivals", "/players", "/helper"]) {
    await p.goto(BASE + r);
    await p.waitForTimeout(250);
    ok((await overflow()) <= 0, `no sideways scrolling on ${r}`);
  }

  step("Reduced motion");
  const rm = await browser.newContext({ reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(BASE + "/");
  ok(parseFloat(await rp.evaluate(() => getComputedStyle(document.querySelector(".btn")).transitionDuration)) < 0.01, "animations off with reduced motion");

  ok(![...hosts].some((h) => /supabase/.test(h)), "the real database was never asked");
  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n - " + failures.join("\n - "));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
