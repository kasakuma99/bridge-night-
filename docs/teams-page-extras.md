# Teams page: what samu-dev has on top of ours

The `integration` branch uses the Teams page from `tosh` ([Teams.tsx](../src/pages/Teams.tsx)). This file lists what the
page on `samu-dev` (commit `64f648d`) can do that ours can't, so we can build those parts again after the merge.

**Nothing is lost.** The samu-dev page is still in the code, as [TeamsClassic.tsx](../src/pages/TeamsClassic.tsx) with
[Board.tsx](../src/components/teams/Board.tsx), [SitOut.tsx](../src/components/teams/SitOut.tsx) and
[teams.css](../src/styles/teams.css). To look at it locally, set `classicTeams: true` in
[features.ts](../src/lib/features.ts). That also brings back the old Live page. Captains and Balanced need `teamModes`,
Elo needs `ratings`, dodges need `dodges`, the reroll limit needs `rerollLimit` and bounties need `bounties`.

## To build again

### 1. Who sits out
Ours always uses the fair rotation, and only shows who sits out after the teams are made.

| Extra | How it works |
|---|---|
| Shown beforehand | One line shows who sits out before the teams are made |
| Fair (default) | Whoever sat out last plays first. The same players and game count give the same result on every device |
| Shuffle | Picks at random. Press again for someone else. Rerolling the teams also picks again |
| Choose | Tap who sits out. Shows "1 of 2 picked"; the oldest pick makes room. Teams can't be made until the number is right |
| Remembered | The chosen way and the picks stay after a reload |

**Ready to use:** `planSitOut`, `toggleSitPick`, `validPicks` and `strSeed` in [teams.ts](../src/lib/teams.ts). They now also
work with uneven teams (`sizes`) and 5v5, and are covered by tests. `makeTeams` takes the result as `sitOut`.

### 2. Options for making teams

| Extra | How it works |
|---|---|
| Captains | Two captains pick in turns (A-B-B-A), the lower rated one first. With undo, open slots and a "Captain" tag |
| Keep apart | Two players always end up on opposite teams. In Captains they become the captains. Skipped, with a note, if one sits out |
| Avoid the last teams | Doesn't repeat the teams of the last game |
| Reroll limit | Shows how many rerolls are left for the same players and size |

Balanced already exists on our page, as Weighted.

### 3. Choosing players

| Extra | How it works |
|---|---|
| Everyone is already picked | All active players are chosen at first; you tap out who isn't there |
| Choice is remembered | Players, size and style stay after a reload (ours starts over) |
| Elo on each name | Only when Elo is shown |
| Add a player | Admins can add one without leaving the page |
| Sizes that don't fit are greyed out | Ours offers a smaller game instead |
| Summary line | For example "3v3 · Random · 1 out" next to the button |

### 4. The result

| Extra | How it works |
|---|---|
| Win chance | A bar with both sides' chances, from Elo |
| Team Elo | Average Elo of each team |
| Top 3 | #1 to #3 next to the best players |
| Wins and losses | Under each name |
| Bounty | Names the player on a win streak that the other side can end |
| Lock teams | Starts champ select by hand and opens the Live page |
| Reveal | Players slide in one after another |

### 5. Top of the page

| Extra | How it works |
|---|---|
| Banner | The night bridge picture with "Who plays tonight?" |
| Facts | Game in progress, time since the last game, games in 30 days, top Elo, dodges left |
| Rivalry banner | The strongest current rivalry |
| Dodge info | How many dodges each team has tonight |

### 6. While a game is running
"Make teams" offers to cancel the running game and make new teams in one step. Ours first needs "Cancel game".

## What ours has and samu-dev doesn't
Keep these when building the extras:

- 5v5. samu-dev stops at 4v4.
- Uneven teams (such as 3v2), with a question when the number is odd.
- A smaller game is offered when there are too few players.
- Searching for a name, and a table of the chosen players.
- The steps Create random teams, mode, players, result.

## To agree on first
1. **Lock teams:** our Live page follows the real game in League by itself. Is locking by hand still needed, perhaps for
   games without the helper?
2. **Everyone already picked, or nobody?** samu-dev and ours start differently.
3. **Win chance, Team Elo, Top 3:** only make sense if Elo is shown.
4. **Captains with uneven teams:** not defined yet. The smaller team could pick first.

## Suggested order
1. Who sits out, because the logic is ready
2. Avoid the last teams, and keep apart
3. Remembering the players
4. Captains
5. Win chance, Team Elo and Top 3, if Elo is shown
6. The banner and facts
