// Starts Vitest from its real path on disk.
// On Windows a terminal can open in "c:\..." instead of "C:\...". Node treats those as different files, so Vitest
// gets loaded twice and stops with "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The native version also corrects the drive letter; plain realpathSync keeps it as typed.
const root = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), ".."));
const vitest = join(root, "node_modules", "vitest", "vitest.mjs");
const { status, error } = spawnSync(process.execPath, [vitest, ...process.argv.slice(2)], { cwd: root, stdio: "inherit" });
if (error) throw error;
process.exit(status ?? 1);
