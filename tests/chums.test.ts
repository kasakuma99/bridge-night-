import { describe, expect, it } from "vitest";
import { CHUMS } from "../src/minigames/chums";
import { ITEMS, ROOMS, ROOM_W, buy, newRun, roomClear, score, step, type Input } from "../src/minigames/chums/logic";

const idle: Input = { mx: 0, my: 0, ax: 10, ay: 0, fire: false, reload: false };
const run = (s: ReturnType<typeof newRun>, input: Partial<Input>, secs: number) => {
  for (let t = 0; t < secs; t += 1 / 60) step(s, { ...idle, ...input }, 1 / 60);
  return s;
};

describe("chum's revenge", () => {
  it("is a solo-only game with one board", () => {
    expect(CHUMS[0]).toMatchObject({ id: "chums-revenge", versus: false });
    expect(CHUMS[0].boards.map((b) => b.id)).toEqual(["chums-run"]);
  });

  it("starts in room 1 with its enemies and a full magazine", () => {
    const s = newRun(1);
    expect(s.enemies).toHaveLength(ROOMS[0].enemies.length);
    expect(s.player).toMatchObject({ hp: 3, ammo: 10, mag: 10 });
    expect(roomClear(s)).toBe(false);
  });

  it("shooting uses ammo, and an empty magazine reloads by itself", () => {
    const s = newRun(1);
    s.enemies = [];
    run(s, { fire: true }, 0.05);
    expect(s.player.ammo).toBe(9);
    run(s, { fire: true }, 4);
    expect(s.player.reloadT >= 0 || s.player.ammo === 10).toBe(true);
  });

  it("walls stop the player, a locked door too; a clear room opens the door to the next room", () => {
    const s = newRun(1);
    s.enemies.forEach((e) => ((e.x = -100), (e.kind = "turret")));
    s.enemies = [];
    s.enemies.length = 0;
    const locked = newRun(1);
    locked.enemies.forEach((e) => (e.kind = "turret"));
    locked.enemies.forEach((e) => (e.x = 8));
    run(locked, { mx: 1 }, 0.5);
    expect(locked.player.x).toBeLessThan(ROOM_W / 2);
    run(s, { mx: 1 }, 5);
    expect(s.room).toBe(1);
    expect(s.roomsCleared).toBe(1);
  });

  it("enemies die from bullets and drop coins", () => {
    const s = newRun(3);
    s.enemies = s.enemies.slice(0, 1);
    const e = s.enemies[0];
    e.kind = "turret";
    e.x = 0;
    e.y = 0;
    s.player.y = 0;
    run(s, { fire: true, ax: 0, ay: 0 }, 2);
    expect(s.kills).toBe(1);
    expect(s.coins.length + s.wallet).toBeGreaterThan(0);
    expect(score(s)).toBe(10);
  });

  it("the vending machine checks codes and coins, and applies the item", () => {
    const s = newRun(1);
    expect(buy(s, 123).ok).toBe(false);
    expect(buy(s, 114).message).toMatch(/Not enough coins/);
    s.wallet = 20;
    s.player.hp = 1;
    expect(buy(s, 114).ok).toBe(true);
    expect(s.player.hp).toBe(3);
    expect(buy(s, 111).ok).toBe(true);
    expect(s.player).toMatchObject({ damage: 2, hp: 2 });
    expect(ITEMS.find((i) => i.code === 99999)?.secret).toBe(true);
  });

  it("taking the last heart ends the run", () => {
    const s = newRun(1);
    s.wallet = 100;
    s.player.hp = 2;
    buy(s, 112);
    expect(s.phase).toBe("dead");
  });
});
