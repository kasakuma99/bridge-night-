import { FILM_TV_QUESTIONS } from "./film-tv";
import { FOOD_QUESTIONS } from "./food";
import { GAMES_QUESTIONS } from "./games";
import { GENERAL_QUESTIONS } from "./general";
import { GEOGRAPHY_QUESTIONS } from "./geography";
import { HISTORY_QUESTIONS } from "./history";
import { LEAGUE_QUESTIONS } from "./league";
import { MUSIC_QUESTIONS } from "./music";
import { SCIENCE_QUESTIONS } from "./science";
import { SPORT_QUESTIONS } from "./sport";
import type { TriviaQuestion } from "../types";

/**
 * All built-in questions. general.ts holds the round-1 mixed bank ("general-0001".."general-0080", already
 * tagged with their real categories) plus the round-2 general-knowledge questions; every other file holds one category.
 */
export const QUESTIONS: TriviaQuestion[] = [
  ...LEAGUE_QUESTIONS,
  ...MUSIC_QUESTIONS,
  ...FILM_TV_QUESTIONS,
  ...GAMES_QUESTIONS,
  ...GEOGRAPHY_QUESTIONS,
  ...SCIENCE_QUESTIONS,
  ...HISTORY_QUESTIONS,
  ...SPORT_QUESTIONS,
  ...FOOD_QUESTIONS,
  ...GENERAL_QUESTIONS,
];
