import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(async ({ command, mode }) => ({
  // The live reader is for npm run dev:live only, never part of a build.
  plugins: [react(), tailwindcss(), ...(command === "serve" && mode === "sample" && process.env.VITE_LIVE ? [(await import("./scripts/live-reader.mjs")).liveReader()] : [])],
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
})) as never;
