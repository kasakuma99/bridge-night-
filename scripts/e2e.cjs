// End-to-end test: clicks through every feature of the site with sample data.
// 1) start the dev server:  npm run dev:sample
// 2) run:                   npm run e2e         (BASE=http://localhost:5173 by default)
// Uses the locally installed Playwright + Chromium. Screenshots go to SHOTS (optional).
const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:5173";
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource|ddragon|ERR_/.test(m.text()) && errors.push(m.text()));
  const shot = async (name) => SHOTS && p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const toastText = async () => (await p.locator(".toast").last().textContent({ timeout: 3000 }).catch(() => "")) || "";
  const btn = (name) => p.getByRole("button", { name, exact: true });
  const genBtn = () => p.locator(".controls .btn.pri");
  const confirmYes = async () => {
    await p.locator("dialog.modal[open]").waitFor();
    await p.locator("dialog.modal[open] .btn").last().click();
  };

  await p.goto(BASE + "/");
  await p.evaluate(() => localStorage.clear());
  await p.reload();

  step("Teams: player picker and sizes");
  const chips = p.locator('[aria-label="Who is playing"] .chip:not(.add)');
  const chip = (n) => p.locator('[aria-label="Who is playing"]').getByRole("button", { name: n, exact: true });
  ok((await chips.count()) === 10, "10 players listed");
  ok((await btn("3v3").getAttribute("aria-pressed")) === "true", "default size is 3v3");
  ok(await btn("4v4").isEnabled(), "4v4 enabled with 10 players");
  for (const n of ["Phillip", "Lenny", "Francesco", "Tosh", "Arthur", "Mantas", "Ilia"]) await chip(n).click();
  ok((await btn("1v1").getAttribute("aria-pressed")) === "true", "3 players -> 1v1");
  ok(await btn("2v2").isDisabled(), "2v2 disabled with 3 players");
  for (const n of ["Phillip", "Lenny", "Francesco", "Tosh", "Arthur", "Mantas", "Ilia"]) await chip(n).click();
  ok((await btn("3v3").getAttribute("aria-pressed")) === "true", "back to 3v3 with 10 players");

  step("Teams: add a custom name");
  await p.getByRole("button", { name: "Add player" }).click();
  await p.getByLabel("New player name").fill("Guest Gary");
  await p.getByRole("button", { name: "Add", exact: true }).click();
  ok((await toastText()).includes("Guest Gary added"), "toast confirms the new player");
  ok((await chip("Guest Gary").getAttribute("aria-pressed")) === "true", "new player is selected for tonight");
  await p.getByRole("button", { name: "Add player" }).click();
  await p.getByLabel("New player name").fill("samu");
  await p.getByRole("button", { name: "Add", exact: true }).click();
  ok((await toastText()).includes("already on the list"), "duplicate names are refused");
  await p.getByRole("button", { name: "Cancel", exact: true }).click();

  step("Teams: make teams, sit-outs, reroll limit");
  await genBtn().click();
  await p.locator('[data-testid="board"]').waitFor();
  ok((await p.locator(".side.b .pl").count()) === 3 && (await p.locator(".side.r .pl").count()) === 3, "3v3 board shown");
  ok((await p.locator(".sit").textContent()).startsWith("Sitting out:"), "sit-outs listed");
  ok((await p.locator(".prob").count()) === 1, "win chance bar shown");
  ok((await genBtn().textContent()) === "Reroll · 2 left", 'button shows "Reroll · 2 left"');
  await shot("01-teams-draft");
  await genBtn().click();
  ok((await genBtn().textContent()) === "Reroll · 1 left", "after one reroll: 1 left");
  await genBtn().click();
  ok((await genBtn().textContent()) === "No rerolls left", "after two rerolls: No rerolls left");
  ok(await genBtn().isDisabled(), "no more rerolls possible");
  await chip("Guest Gary").click();
  await chip("Guest Gary").click();
  ok((await genBtn().textContent()) === "No rerolls left", "toggling a player off and on keeps the count");
  await btn("2v2").click();
  ok((await genBtn().textContent()) === "Make teams", "a different size starts a fresh count");

  step("Teams: more options");
  await p.locator(".opts summary").click();
  ok((await p.locator(".opts .cnt").textContent()) === "1 on", '"1 on" with avoid-last-teams');
  await p.getByLabel("First player to keep apart").selectOption({ label: "Samu" });
  await p.getByLabel("Second player to keep apart").selectOption({ label: "Nick" });
  ok((await p.locator(".opts .cnt").textContent()) === "2 on", '"2 on" with keep apart');
  let apartOk = true;
  await btn("3v3").click();
  for (const n of ["Phillip", "Lenny", "Francesco", "Arthur", "Ilia", "Guest Gary", "Emilian"]) await chip(n).click(); // 4 left: Samu Nick Tosh Mantas
  await btn("2v2").click();
  for (let i = 0; i < 3; i++) {
    await genBtn().click();
    const blue = await p.locator(".side.b").textContent();
    if (blue.includes("Samu") === blue.includes("Nick")) apartOk = false;
  }
  ok(apartOk, "Samu and Nick always on opposite teams");

  step("Teams: captains");
  await btn("Captains").click();
  await btn("4v4").isDisabled();
  for (const n of ["Phillip", "Lenny", "Francesco", "Emilian"]) await chip(n).click(); // 8 players
  await btn("4v4").click();
  await genBtn().click();
  const caps = [await p.locator(".side.b .pl b").first().textContent(), await p.locator(".side.r .pl b").first().textContent()].join(" ");
  ok(caps.includes("Samu") && caps.includes("Nick") && caps.includes("Captain"), "keep-apart players are the captains");
  ok((await p.locator(".draft-pick, .panel h3").filter({ hasText: "picks for" }).count()) === 1, "captain pick panel shown");
  ok((await p.locator("[data-testid=captain-pick] .chip small").count()) === 6, "remaining players show their rating");
  await p.locator("[data-testid=captain-pick] .chip").first().click();
  ok(await btn("Undo last pick").isEnabled(), "undo enabled after a pick");
  await btn("Undo last pick").click();
  ok((await p.locator("[data-testid=captain-pick] .chip").count()) === 6, "undo puts the player back");
  while ((await p.locator("[data-testid=captain-pick] .chip").count()) > 0) await p.locator("[data-testid=captain-pick] .chip").first().click();
  ok((await p.locator(".side.b .pl").count()) === 4 && (await p.locator(".side.r .pl").count()) === 4, "captains draft fills both teams");
  await shot("02-captains-done");

  step("Live: lock teams, champ select, dodges, challenge");
  await p.getByRole("button", { name: "Lock teams and go to champ select" }).click();
  await p.waitForURL("**/live");
  await p.locator("h1", { hasText: "Champ select" }).waitFor({ timeout: 3000 }).catch(() => {});
  const h1 = await p.locator("h1").textContent();
  ok(h1 === "Champ select", `champ select opens (${h1})`);
  ok((await p.locator(".tab .live-dot").count()) === 1, "red dot on the Live tab");
  ok((await p.locator('[data-testid="rule"]').count()) === 1, "dodge rule status shown on Live");
  const selects = p.locator(".pl select");
  const n = await selects.count();
  ok(n === 8, "a champion picker per player");
  const champs = ["Ahri", "Lux", "Yuumi", "Jinx", "Garen", "Sona", "Zed", "Teemo"];
  for (let i = 0; i < n; i++) await selects.nth(i).selectOption(champs[i]);
  ok((await p.getByRole("button", { name: /start game/i }).textContent()).includes("All locked in"), "start button says all locked in");
  const bluePips = p.locator(".side.b .pips");
  const before = await bluePips.textContent();
  await p.locator(".side.b .dodge").first().click();
  const t = await toastText();
  ok(/dodged Ahri/.test(t), `dodge toast: "${t}"`);
  ok((await bluePips.textContent()) !== before && (await bluePips.textContent()).includes("left"), "Blue pips go down");
  ok((await p.locator('[data-testid="dodgelog"]').textContent()).includes("dodged Ahri"), 'log shows "X dodged Ahri"');
  ok((await selects.first().inputValue()) === "", "dodging clears the pick");
  await selects.first().selectOption("Braum");
  await p.getByRole("button", { name: /Spin a random challenge/ }).click();
  ok((await p.locator(".info").filter({ hasText: "Challenge this game" }).count()) === 1, "challenge shown");
  await btn("Spin again").click();
  await btn("Remove").click();
  ok((await p.locator(".info").filter({ hasText: "Challenge this game" }).count()) === 0, "challenge removed");
  await p.getByRole("button", { name: /Spin a random challenge/ }).click();
  const challenge = (await p.locator(".info b").filter({ hasNotText: "Dodges" }).last().textContent()).trim();
  await shot("03-champ-select");

  step("Live: in game and result");
  await p.getByRole("button", { name: /start game/i }).click();
  ok((await p.locator(".timer").count()) === 1, "timer runs in game");
  const t1 = await p.locator(".timer").textContent();
  await p.waitForTimeout(1200);
  ok((await p.locator(".timer").textContent()) !== t1, "timer ticks");
  await p.getByRole("button", { name: "Game over, enter result" }).click();
  ok((await p.locator("h1").textContent()) === "Enter the result", "result step");
  const kda = p.locator(".kda input");
  ok((await kda.count()) === 24, "K/D/A inputs for every player");
  for (let i = 0; i < 24; i++) await kda.nth(i).fill(String((i * 7) % 15));
  await btn("Blue won").click();
  await p.waitForURL("**/history");
  ok((await toastText()).length > 0, `save toast: "${await toastText()}"`);
  const top = p.locator(".match").first();
  ok((await top.locator(".team.w .tag").textContent()).includes("Blue"), "newest game first, Blue highlighted as winner");
  ok((await top.textContent()).includes(challenge), "challenge saved with the match");
  ok((await top.textContent()).includes("Dodged:") && (await top.textContent()).includes("Ahri"), "dodge saved with the match");
  ok((await p.locator(".tab .live-dot").count()) === 0, "live dot gone after saving");

  step("Dodges last the whole night");
  await p.goto(BASE + "/live");
  const rule = await p.locator('[data-testid="rule"]').textContent();
  ok(/Blue side 1 left, Red side 2 left/.test(rule), `rule carries over: "${rule.trim()}"`);

  step("Running game: Make teams asks first");
  await p.goto(BASE + "/");
  await btn("Random").click();
  await genBtn().click();
  await p.getByRole("button", { name: "Lock teams and go to champ select" }).click();
  await p.goto(BASE + "/");
  ok((await p.locator(".empty h3").textContent()) === "A game is running", "Teams shows the running game");
  await genBtn().click();
  ok((await p.locator("dialog.modal[open] h3").textContent()) === "A game is still running", "confirm dialog appears");
  await p.keyboard.press("Escape");
  ok((await p.locator("dialog.modal[open]").count()) === 0, "Escape closes the dialog");
  await p.getByRole("button", { name: "Cancel game" }).click();
  await confirmYes();
  ok((await toastText()).includes("Game cancelled"), "game cancelled");

  step("History: filters, swap, delete");
  await p.goto(BASE + "/history");
  const total = await p.locator(".match").count();
  await p.getByLabel("Filter by mode").selectOption("4");
  ok((await p.locator(".match").count()) === 1, "mode filter shows only 4v4 games");
  await p.getByLabel("Filter by mode").selectOption("");
  await p.getByLabel("Filter by player").selectOption({ label: "Emilian" });
  const em = await p.locator(".match").count();
  ok(em > 0 && em <= total, "player filter works");
  await p.getByLabel("Filter by player").selectOption("");
  const winBefore = await p.locator(".match").first().locator(".team.w .tag").textContent();
  await p.locator(".match").first().getByRole("button", { name: "Swap winner" }).click();
  await confirmYes();
  ok((await p.locator(".match").first().locator(".team.w .tag").textContent()) !== winBefore, "winner swapped");
  const count0 = (await p.locator(".head .sub").textContent()).match(/\d+/)[0];
  await p.locator(".match").first().getByRole("button", { name: "Delete match" }).click();
  await confirmYes();
  const count1 = (await p.locator(".head .sub").textContent()).match(/\d+/)[0];
  ok(+count1 === +count0 - 1, "game deleted after confirmation");

  step("Stats");
  await p.goto(BASE + "/stats");
  ok(/has the most wins in the last 30 days/.test(await p.locator("h1").textContent()), "30-day title");
  ok((await p.locator(".lbhead").textContent()).includes("Wins"), "sorted by wins");
  await btn("All time").click();
  ok((await p.locator("h1").textContent()) === "Stats" && (await p.locator(".lbhead").textContent()).includes("Win rate"), "all-time view");
  const second = p.locator(".lbrow").nth(1);
  const nm = await second.locator(".who b").textContent();
  await second.click();
  await p.locator(".pcard h2", { hasText: nm }).waitFor({ timeout: 3000 }).catch(() => {});
  const h2 = await p.locator(".pcard h2").textContent();
  ok(h2 === nm, `tapping a row opens that profile (${nm} / ${h2})`);
  ok((await p.locator(".chart svg polyline").count()) === 1, "rating chart drawn");
  for (const h of ["Records", "Best duos", "Best trios", "Group favourites", "Awards this week", "Monthly champions"])
    ok((await p.getByRole("heading", { name: h }).count()) === 1, `${h} panel`);
  await shot("04-stats");

  step("Rivals");
  await p.goto(BASE + "/rivals");
  ok((await p.locator(".h2hrow").count()) > 5, "head-to-head table");
  const banners = await p.locator(".feud b").allTextContents();
  ok(banners.some((b) => / (owns|is dominating|has the upper hand on) /.test(b)), "rivalry banners");

  step("Builds");
  await p.goto(BASE + "/builds");
  await p.getByLabel("Search champion").fill("kai");
  await p.locator(".ch", { hasText: "Kai'Sa" }).click();
  ok((await p.getByRole("link", { name: /U\.GG/ }).getAttribute("href")) === "https://u.gg/lol/champions/aram-mayhem/kaisa-aram-mayhem", "U.GG link for Kai'Sa");
  ok((await p.getByRole("link", { name: /Mobalytics/ }).getAttribute("href")) === "https://mobalytics.gg/lol/champions/kaisa/mayhem-builds", "Mobalytics link for Kai'Sa");
  ok((await p.getByRole("link", { name: /U\.GG/ }).getAttribute("target")) === "_blank", "opens in a new tab");
  await p.getByLabel("Search champion").fill("zzzz");
  ok((await p.locator(".champs .sub").textContent()).includes("No champion matches"), "empty search state");

  step("Players & settings");
  await p.goto(BASE + "/players");
  const riot = p.getByLabel("Riot ID of Lenny");
  await riot.fill("lenny");
  await riot.press("Enter");
  ok((await toastText()).includes("Name#TAG"), "invalid Riot ID rejected");
  await riot.fill("Lenny#EUW");
  await riot.press("Enter");
  ok((await toastText()).includes("Riot ID saved"), "Riot ID saved");
  await p.getByLabel("Remove Guest Gary").click();
  await confirmYes();
  ok((await p.getByLabel("Name of Guest Gary").count()) === 0, "player removed");
  await p.getByLabel("Rerolls per game").selectOption("-1");
  await p.getByLabel(/Offer a random challenge/).uncheck();
  await p.getByRole("button", { name: "Save rules" }).click();
  ok((await toastText()).includes("House rules saved"), "house rules saved");
  await p.goto(BASE + "/");
  ok((await chip("Guest Gary").count()) === 0, "removed player gone from the picker");
  await genBtn().click();
  ok((await genBtn().textContent()) === "Reroll", 'no-limit shows plain "Reroll"');
  await p.getByRole("button", { name: "Lock teams and go to champ select" }).click();
  ok((await p.getByRole("button", { name: /Spin a random challenge/ }).count()) === 0, "challenge link hidden when switched off");
  const download = p.waitForEvent("download");
  await p.goto(BASE + "/players");
  await p.getByRole("button", { name: /Download backup/ }).click();
  ok(/bridge-night-backup-.*\.json/.test((await download).suggestedFilename()), "backup downloads as JSON");

  step("Visitors");
  await p.getByLabel("Preview the site as").selectOption("visitor");
  ok((await p.locator("input.riot").count()) === 0 && !(await p.content()).includes("Lenny#EUW"), "Riot IDs hidden from visitors");
  ok((await p.getByRole("button", { name: "Save rules" }).isDisabled()), "house rules read-only");
  await p.goto(BASE + "/live");
  ok((await p.locator(".pl select").count()) === 0 && (await p.getByText("You're watching live").count()) === 1, "Live is view-only");
  await p.goto(BASE + "/history");
  ok((await p.getByRole("button", { name: "Delete match" }).count()) === 0, "no delete buttons for visitors");
  await p.goto(BASE + "/");
  ok(await chips.first().isDisabled(), "visitors can't change the picker");
  await p.getByLabel("Preview the site as").selectOption("admin");

  step("Routing, 404, keyboard, manifest");
  await p.goto(BASE + "/stats?player=p1");
  ok((await p.locator(".pcard h2").textContent()) === "Nick", "deep link opens a profile");
  await p.goto(BASE + "/does-not-exist");
  ok((await p.locator("h1").textContent()) === "Lost on the bridge", "custom 404 page");
  await p.keyboard.press("Tab");
  ok((await p.evaluate(() => document.activeElement.textContent)) === "Skip to content", "skip link is first in tab order");
  const man = await (await p.request.get(BASE + "/manifest.webmanifest")).json();
  ok(man.display === "standalone" && man.icons.length === 3, "web app manifest");
  ok((await p.locator('meta[property="og:image"]').getAttribute("content")) === "/og.png", "Open Graph image tag");
  ok((await p.locator("footer").textContent()).includes('Bridge Night was created under Riot Games\' "Legal Jibber Jabber" policy'), "Riot notice in footer");
  ok((await p.locator('a[href="https://discord.gg/mEAF2C9Qq"]').count()) === 2, "Discord link in header and footer");

  step("Phone layout");
  const m = await browser.newPage({ viewport: { width: 375, height: 780 }, deviceScaleFactor: 1 });
  m.on("pageerror", (e) => errors.push(String(e)));
  await m.goto(BASE + "/");
  for (const r of ["/", "/live", "/history", "/stats", "/rivals", "/builds", "/players", "/helper"]) {
    await m.goto(BASE + r);
    await m.waitForTimeout(150);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, `no sideways scrolling on ${r}`);
  }

  step("Reduced motion");
  const rm = await browser.newContext({ reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(BASE + "/");
  const dur = await rp.evaluate(() => getComputedStyle(document.querySelector(".hero")).transitionDuration);
  ok(parseFloat(dur) < 0.01, "animations off with reduced motion");

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
