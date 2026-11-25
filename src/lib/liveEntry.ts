import { FEATURES } from "./features";

/** Everything the "live" Edge Function needs (see scripts/build-live.mjs). */
export { decide, step } from "./liveServer";
/** Solo and bot games count? */
export const SOLO = FEATURES.soloGames;
