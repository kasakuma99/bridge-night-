// npm run dev:live [-- --replay file.jsonl] [vite options]
// The local site with sample data, plus the live game from League on this PC. Never touches Supabase.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const i = args.indexOf("--replay");
const replay = i >= 0 ? args.splice(i, 2)[1] : undefined;

const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--mode", "sample", ...args], {
  stdio: "inherit",
  env: { ...process.env, VITE_LIVE: "1", ...(replay ? { VITE_LIVE_REPLAY: resolve(replay) } : {}) },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
