import type { MinigameDef } from "../types";
import { MAX_SCORE } from "./logic";

export const CHUMS: MinigameDef[] = [
  {
    id: "chums-revenge",
    name: "Chum's Revenge",
    blurb: "Low-poly top-down shooter. Clear the rooms, spend coins at the vending machine, beat the boss.",
    boards: [{ id: "chums-run", label: "Chum's Revenge", maxScore: MAX_SCORE, scoreLabel: "points" }],
    versus: false,
    load: () => import("./Game"),
  },
];
