// Renders the favicon PNGs, home-screen icons and the Open Graph preview image.
// Run: node scripts/make-icons.cjs   (uses the locally installed Playwright + Chromium)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "..", "public");
const font = (f) => "data:font/woff2;base64," + fs.readFileSync(require.resolve("@fontsource/outfit/files/" + f)).toString("base64");

const mark = (s, pad, rx) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">
<rect width="32" height="32" rx="${rx}" fill="#121820"/>
<g transform="translate(${pad} ${pad}) scale(${(32 - 2 * pad) / 32})"><path d="M6 22h20M9 22v-6l7-6 7 6v6" fill="none" stroke="#bfe6ff" stroke-width="2.4" stroke-linejoin="round"/><circle cx="16" cy="17" r="2.6" fill="#ff5a6e"/></g></svg>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (html, w, h, file) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(out, file), omitBackground: true });
  };
  await shot(mark(32, 1, 8), 32, 32, "favicon-32.png");
  await shot(mark(180, 2, 0), 180, 180, "apple-touch-icon.png");
  await shot(mark(192, 2, 7), 192, 192, "icon-192.png");
  await shot(mark(512, 2, 7), 512, 512, "icon-512.png");
  await shot(mark(512, 6, 0), 512, 512, "icon-maskable-512.png");

  const hero = fs.readFileSync(path.join(__dirname, "og-art.svg"), "utf8");
  await shot(`<style>@font-face{font-family:O;src:url(${font("outfit-latin-700-normal.woff2")})}@font-face{font-family:O5;src:url(${font("outfit-latin-500-normal.woff2")})}</style>
  <div style="position:relative;width:1200px;height:630px;overflow:hidden;background:#0b0f14">${hero}
  <div style="position:absolute;left:80px;top:150px;display:flex;align-items:center;gap:28px">${mark(112, 1, 9)}<span style="font:700 104px O;color:#eef2f6;letter-spacing:-2px">Bridge Night</span></div>
  <div style="position:absolute;left:84px;top:300px;font:500 42px O5;color:#bfe6ff">Who plays tonight?</div>
  <div style="position:absolute;left:84px;top:362px;font:500 30px O5;color:#97a4b3">Teams · Live games · Stats · Rivals</div></div>`, 1200, 630, "og.png");
  await b.close();
  console.log("icons written");
})();
