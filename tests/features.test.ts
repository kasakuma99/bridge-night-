import { describe, expect, it } from "vitest";
import {
  FEATURES,
  PAPI_POINTS,
  byWins,
  fmtPoints,
  pointsLabel,
  pointsOf,
  shownPoints,
  usedRerollLimit,
  usedTeamStyle,
  visibleBadges,
  type Features,
} from "../src/lib/features";
import { canDraft, rerollsLeft } from "../src/lib/teams";

const all = (on: boolean) => Object.fromEntries(Object.keys(FEATURES).map((k) => [k, on])) as unknown as Features;
const OFF = all(false);
const ON = all(true);

describe("feature flags", () => {
  it("everything extra is off (solo games are on while testing)", () => {
    const { soloGames, ...extras } = FEATURES;
    expect(soloGames).toBe(true);
    expect(Object.values(extras).every((v) => v === false)).toBe(true);
    expect(Object.keys(FEATURES).sort()).toEqual(
      ["bounties", "builds", "challenges", "classicTeams", "dodges", "ratings", "rerollLimit", "rivals", "soloGames", "teamModes"],
    );
  });

  it("hides only the badges of hidden features", () => {
    const bs = ["Monthly champion", "On fire", "Bounty hunter", "Giant slayer", "25 games"].map((title) => ({ title, detail: "" }));
    const names = (f: Features) => visibleBadges(bs, f).map((b) => b.title);
    expect(names(OFF)).toEqual(["Monthly champion", "On fire", "25 games"]);
    expect(names({ ...OFF, bounties: true })).toContain("Bounty hunter");
    expect(names({ ...OFF, bounties: true })).not.toContain("Giant slayer");
    expect(names(ON)).toHaveLength(5);
  });

  it("teams are random, even if a browser remembers another mode", () => {
    for (const s of ["random", "balanced", "captains"] as const) {
      expect(usedTeamStyle(s, OFF)).toBe("random");
      expect(usedTeamStyle(s, ON)).toBe(s);
    }
  });

  it("rerolls are unlimited, whatever the saved setting and count", () => {
    for (const setting of [0, 2, 10]) {
      expect(rerollsLeft(usedRerollLimit(setting, OFF), 50)).toBe(Infinity);
      expect(canDraft(usedRerollLimit(setting, OFF), 50)).toBe(true);
    }
    expect(canDraft(usedRerollLimit(2, ON), 3)).toBe(false);
  });
});

describe("Papi Points", () => {
  it("everyone has 1,000, whatever their rating", () => {
    expect(PAPI_POINTS).toBe(1000);
    expect(fmtPoints(PAPI_POINTS)).toBe("1,000");
    for (const r of [0, 987, 1000, 1432]) {
      expect(shownPoints(r, OFF)).toBe("1,000");
      expect(pointsLabel(r, OFF)).toBe("1,000 Papi Points");
      expect(pointsOf(r, OFF)).toBe(1000);
    }
    expect(shownPoints(987, ON)).toBe("987");
    expect(pointsOf(987, ON)).toBe(987);
    expect(pointsLabel(987, ON)).toBe("Rating 987");
  });

  it("the leaderboard sorts by wins, win rate, games, then name", () => {
    const rows = [
      { id: "zoe", g: 10, w: 5 },
      { id: "amy", g: 10, w: 5 },
      { id: "top", g: 20, w: 9 },
      { id: "rate", g: 8, w: 5 },
      { id: "many", g: 4, w: 0 },
      { id: "few", g: 1, w: 0 },
    ];
    expect(rows.sort(byWins((id) => id)).map((r) => r.id)).toEqual(["top", "rate", "amy", "zoe", "many", "few"]);
  });
});
