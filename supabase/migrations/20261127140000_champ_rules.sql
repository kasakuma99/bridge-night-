-- Champion guesser: two more solo leaderboards for the new rules (Timed and Fewest skips).
-- MUST MATCH the boards in src/minigames/champ-guesser/index.ts (id, maxScore, lowerIsBetter).
insert into public.minigame_games (game_id, max_score, lower_is_better) values
  ('champ-timed', 200, false),
  ('champ-skips', 10,  true)
on conflict (game_id) do nothing;
