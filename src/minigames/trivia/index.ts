import type { MinigameDef } from "../types";
import { SOLO_MAX } from "./logic";

export const triviaDefs: MinigameDef[] = [
  {
    id: "trivia-night",
    name: "Trivia night",
    blurb: "League, music, film, games and more. Play solo for the board or host a live room on Discord.",
    boards: [{ id: "trivia-solo", label: "Trivia", maxScore: SOLO_MAX, scoreLabel: "points" }],
    load: () => import("./Game"),
  },
];
