-- Chum's Revenge (low-poly shooter): its solo leaderboard.
-- MUST MATCH the board in src/minigames/chums/index.ts (id, maxScore, lowerIsBetter).
insert into public.minigame_games (game_id, max_score, lower_is_better) values
  ('chums-run', 5000, false)
on conflict (game_id) do nothing;
