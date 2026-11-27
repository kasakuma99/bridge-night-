import type { MinigameDef } from "../types";
import { MAX_ROUND_POINTS, SKIPS_SIZE, TIMED_MAX } from "./logic";

const board = { maxScore: MAX_ROUND_POINTS, scoreLabel: "points" };

export const CHAMP_GUESSER: MinigameDef[] = [
  {
    id: "champ-guesser",
    name: "Champion guesser",
    blurb: "A hidden splash art gets clearer every few seconds. Name the champion first. Solo or versus.",
    boards: [
      { id: "champ-pixel", label: "Pixelated", ...board },
      { id: "champ-colours", label: "Colours", ...board },
      { id: "champ-mixed", label: "Both", ...board },
      { id: "champ-timed", label: "Timed", maxScore: TIMED_MAX, scoreLabel: "named" },
      { id: "champ-skips", label: "Fewest skips", maxScore: SKIPS_SIZE, scoreLabel: "skips", lowerIsBetter: true },
    ],
    load: () => import("./Game"),
  },
];
