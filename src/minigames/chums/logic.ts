/* Chum's Revenge (low-poly web version of github.com/Leonhard-Richartz/Chums_revenge2).
   Pure game logic: no DOM, no three.js. The world is 2D (x, y); the renderer draws y as depth.
   Numbers follow the Unity project (player, Shooting, Enemy, AIChase, WanderEnemy, TurretEnemy, BossScript). */

export type EnemyKind = "chaser" | "wander" | "turret" | "boss";
export type Phase = "play" | "dead" | "won";

export interface Pillar {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomDef {
  kind: "fight" | "boss";
  enemies: { kind: EnemyKind; x: number; y: number }[];
  pillars: Pillar[];
  /** A vending machine at the top wall. */
  shop: boolean;
}

export interface Player {
  x: number;
  y: number;
  /** Aim angle in radians (0 = +x). */
  aim: number;
  hp: number;
  maxHp: number;
  /** Invincible for this many seconds after a hit. */
  inv: number;
  damage: number;
  projectiles: number;
  fireInterval: number;
  fireT: number;
  mag: number;
  ammo: number;
  reloadTime: number;
  /** -1 = not reloading, else seconds into the reload. */
  reloadT: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  /** Knockback velocity, decays fast. */
  kx: number;
  ky: number;
  /** Seconds of red hit flash left. */
  flash: number;
  /** General timer (wander legs, shooting). */
  t: number;
  /** Second timer (boss shotgun, burst gaps). */
  t2: number;
  dx: number;
  dy: number;
  moving: boolean;
  /** Boss: idle, intro, burst, chase. */
  state: "idle" | "intro" | "burst" | "chase";
  /** Boss: shotgun blasts left in the current burst. */
  burst: number;
  /** Seconds since death (turret/boss play a short death before vanishing), -1 = alive. */
  dead: number;
}

export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  enemy: boolean;
  dmg: number;
  life: number;
}

export interface Coin {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface State {
  phase: Phase;
  time: number;
  /** Seconds in the current room. */
  roomTime: number;
  room: number;
  rooms: RoomDef[];
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  coins: Coin[];
  wallet: number;
  kills: number;
  roomsCleared: number;
  bossKilled: boolean;
  nextId: number;
  seed: number;
  /** Things that happened this step, for sounds and screen shake: "shoot", "hit", "hurt", "coin", "kill", "door", "reload", "buy". */
  events: string[];
}

export interface Input {
  /** -1..1 each, from WASD / arrows. */
  mx: number;
  my: number;
  /** Aim point in world space. */
  ax: number;
  ay: number;
  fire: boolean;
  reload: boolean;
}

/* ---------- constants ---------- */

export const ROOM_W = 18;
export const ROOM_H = 11;
export const DOOR_HALF = 1.3;
export const PLAYER_R = 0.4;
export const PLAYER_SPEED = 5;
export const BULLET_SPEED = 14;
export const SPREAD_DEG = 8;
export const SHOP_RANGE = 1.8;
/** Where the vending machine stands (shop rooms). */
export const SHOP_POS = { x: 0, y: -ROOM_H / 2 + 0.7 };
export const MAX_SCORE = 5000;

const ENEMY: Record<EnemyKind, { hp: number; r: number }> = {
  chaser: { hp: 5, r: 0.45 },
  wander: { hp: 4, r: 0.45 },
  turret: { hp: 5, r: 0.5 },
  boss: { hp: 50, r: 1.05 },
};

const P = (x: number, y: number, w: number, h: number): Pillar => ({ x, y, w, h });

/** The run: five fight rooms (two with a vending machine), then the boss. */
export const ROOMS: RoomDef[] = [
  { kind: "fight", shop: false, pillars: [P(-2, -2, 1, 1), P(3, 2, 1, 1)], enemies: [
    { kind: "chaser", x: 5, y: -3 }, { kind: "chaser", x: 6, y: 3 }, { kind: "chaser", x: 2, y: 0 },
  ] },
  { kind: "fight", shop: false, pillars: [P(0, -2.5, 4, 0.8), P(0, 2.5, 4, 0.8)], enemies: [
    { kind: "chaser", x: 6, y: -3 }, { kind: "chaser", x: 6, y: 3 }, { kind: "wander", x: 2, y: 0 }, { kind: "wander", x: -1, y: 3.5 },
  ] },
  { kind: "fight", shop: true, pillars: [P(-3, 1.5, 1, 1), P(3, 1.5, 1, 1)], enemies: [
    { kind: "turret", x: 7, y: -3.5 }, { kind: "turret", x: 7, y: 3.5 }, { kind: "chaser", x: 4, y: 0 }, { kind: "chaser", x: 0, y: 4 },
  ] },
  { kind: "fight", shop: false, pillars: [P(-4, 0, 1, 3), P(1, -3, 1, 1), P(1, 3, 1, 1), P(5, 0, 1, 1)], enemies: [
    { kind: "chaser", x: 3, y: -1 }, { kind: "chaser", x: 3, y: 1 }, { kind: "chaser", x: 7, y: -4 }, { kind: "chaser", x: 7, y: 4 },
    { kind: "turret", x: 7.5, y: 0 }, { kind: "wander", x: -1, y: -3.5 }, { kind: "wander", x: -1, y: 3.5 },
  ] },
  { kind: "fight", shop: true, pillars: [P(-5, 2, 1, 1), P(5, 2, 1, 1), P(0, 1, 1.5, 1.5)], enemies: [
    { kind: "turret", x: -6, y: 4 }, { kind: "turret", x: 7, y: 4 }, { kind: "turret", x: 7, y: -2 },
    { kind: "chaser", x: 4, y: -3 }, { kind: "chaser", x: 3, y: 4 }, { kind: "chaser", x: 6, y: 0 },
  ] },
  { kind: "boss", shop: false, pillars: [P(-4, -2.5, 1, 1), P(-4, 2.5, 1, 1), P(4, -2.5, 1, 1), P(4, 2.5, 1, 1)], enemies: [{ kind: "boss", x: 5, y: 0 }] },
];

/* ---------- shop (vending machine codes from the Unity project) ---------- */

export interface Item {
  code: number;
  name: string;
  text: string;
  effects: string;
  cost: number;
  /** Hidden from the list (you have to know the code). */
  secret?: boolean;
  apply: (p: Player) => { hurt?: number };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const heal = (p: Player, n: number) => {
  p.hp = clamp(p.hp + n, 0, p.maxHp);
};
const fire = (p: Player, f: number) => {
  // "+0.3 Firerate" = 0.03 s less between shots (Shooting.AddFireRate, scaled for a mouse)
  p.fireInterval = clamp(p.fireInterval - f * 0.1, 0.05, 1.5);
};
const reload = (p: Player, f: number) => {
  p.reloadTime = clamp(p.reloadTime - f, 0.1, 5);
};
const magBy = (p: Player, n: number) => {
  p.mag = Math.max(1, p.mag + n);
  p.ammo = clamp(p.ammo, 0, p.mag);
};
const dmgBy = (p: Player, n: number) => {
  p.damage = Math.max(1, p.damage + n);
};

export const ITEMS: Item[] = [
  { code: 111, name: "Cigarettes", text: "Can cause cancer, but you have bigger problems right now", effects: "+1 Damage, -1 Health", cost: 10, apply: (p) => (dmgBy(p, 1), { hurt: 1 }) },
  { code: 112, name: "Cigarette Bud", text: "Desperate times call for desperate measures", effects: "+1 Damage, -2 Health", cost: 10, apply: (p) => (dmgBy(p, 1), { hurt: 2 }) },
  { code: 113, name: "Can of Spezi", text: "Great return on investment!", effects: "+1 Health", cost: 10, apply: (p) => (heal(p, 1), {}) },
  { code: 114, name: "Bottle of Spezi", text: "Germany's best invention", effects: "+2 Health", cost: 10, apply: (p) => (heal(p, 2), {}) },
  { code: 115, name: "Suspiciously Green Glasses", text: "The lenses glow with a strange light...", effects: "+1 Projectile, +0.3 Firerate", cost: 15, apply: (p) => ((p.projectiles += 1), fire(p, 0.3), {}) },
  { code: 116, name: "Red Hot Chilli Pepper", text: "Found under a bridge, then multiplied in a lab environment.", effects: "+1 Damage, -0.2 Firerate", cost: 15, apply: (p) => (dmgBy(p, 1), fire(p, -0.2), {}) },
  { code: 117, name: "Apple", text: "The cornerstone of any nutritious breakfast", effects: "+20 Max Ammo, +0.5 Reload Speed", cost: 10, apply: (p) => (magBy(p, 20), reload(p, 0.5), {}) },
  { code: 118, name: "COOL Apple", text: "He used to bully me in school", effects: "-5 Max Ammo, -0.5 Reload Speed", cost: 10, apply: (p) => (magBy(p, -5), reload(p, -0.5), {}) },
  { code: 119, name: "Slice of Pizza", text: "Delivered fresh from the place at the corner.. 2 weeks ago", effects: "+2 Max Health, +1 Health", cost: 10, apply: (p) => ((p.maxHp += 2), heal(p, 1), {}) },
  { code: 120, name: "Bottle of Water", text: "Necessary hydration for humans, but you're... something more", effects: "+2 Projectiles, -1 Health", cost: 10, apply: (p) => ((p.projectiles += 2), { hurt: 1 }) },
  { code: 121, name: "Hip Hop Cigarette", text: "Legalization saves lives", effects: "+2 Projectiles, -1 Damage", cost: 10, apply: (p) => ((p.projectiles += 2), dmgBy(p, -1), {}) },
  { code: 99999, name: "Sturdy Lighter", text: "Runs on nuclear power. No wind or water can extinguish it.", effects: "+1 Damage, +0.2 Reload Speed", cost: 10, secret: true, apply: (p) => (dmgBy(p, 1), reload(p, 0.2), {}) },
];

/* ---------- random ---------- */

/** mulberry32 on the state's seed, so a run with the same seed plays the same. */
function rnd(s: State) {
  s.seed = (s.seed + 0x6d2b79f5) >>> 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ---------- setup ---------- */

export function newPlayer(): Player {
  return { x: -ROOM_W / 2 + 1.6, y: 0, aim: 0, hp: 3, maxHp: 3, inv: 0, damage: 1, projectiles: 1, fireInterval: 0.3, fireT: 0, mag: 10, ammo: 10, reloadTime: 1.2, reloadT: -1 };
}

function spawn(s: State, kind: EnemyKind, x: number, y: number): Enemy {
  const d = ENEMY[kind];
  return { id: s.nextId++, kind, x, y, r: d.r, hp: d.hp, maxHp: d.hp, kx: 0, ky: 0, flash: 0, t: rnd(s) * 1.5, t2: 0, dx: 0, dy: 0, moving: false, state: "idle", burst: 0, dead: -1 };
}

function enterRoom(s: State, room: number) {
  s.room = room;
  s.roomTime = 0;
  s.bullets = [];
  s.coins = [];
  s.player.x = -ROOM_W / 2 + 1.6;
  s.player.y = 0;
  s.player.inv = Math.max(s.player.inv, 0.6);
  s.enemies = s.rooms[room].enemies.map((e) => spawn(s, e.kind, e.x, e.y));
}

export function newRun(seed = 1): State {
  const s: State = {
    phase: "play",
    time: 0,
    roomTime: 0,
    room: 0,
    rooms: ROOMS,
    player: newPlayer(),
    enemies: [],
    bullets: [],
    coins: [],
    wallet: 0,
    kills: 0,
    roomsCleared: 0,
    bossKilled: false,
    nextId: 1,
    seed: seed >>> 0,
    events: [],
  };
  enterRoom(s, 0);
  return s;
}

/* ---------- queries ---------- */

export const alive = (e: Enemy) => e.dead < 0;
export const roomClear = (s: State) => !s.enemies.some(alive);
export const nearShop = (s: State) => s.rooms[s.room].shop && Math.hypot(s.player.x - SHOP_POS.x, s.player.y - SHOP_POS.y) <= SHOP_RANGE;
export const boss = (s: State) => s.enemies.find((e) => e.kind === "boss");

/** Score: 10 per kill, 100 per room cleared, 1000 for the boss, 100 per heart left on a win. */
export function score(s: State) {
  const win = s.phase === "won" ? 100 * s.player.hp : 0;
  return Math.min(MAX_SCORE, s.kills * 10 + s.roomsCleared * 100 + (s.bossKilled ? 1000 : 0) + win);
}

/* ---------- collision ---------- */

/** Push a circle out of the walls and pillars. `door`: the right wall has a gap (open door). */
function collide(s: State, o: { x: number; y: number }, r: number, door = false) {
  const hw = ROOM_W / 2 - r;
  const hh = ROOM_H / 2 - r;
  o.y = clamp(o.y, -hh, hh);
  if (!(door && Math.abs(o.y) < DOOR_HALF - r * 0.5)) o.x = clamp(o.x, -hw, hw);
  else o.x = clamp(o.x, -hw, ROOM_W / 2 + 1);
  for (const p of s.rooms[s.room].pillars) {
    const nx = clamp(o.x, p.x - p.w / 2, p.x + p.w / 2);
    const ny = clamp(o.y, p.y - p.h / 2, p.y + p.h / 2);
    const dx = o.x - nx;
    const dy = o.y - ny;
    const d = Math.hypot(dx, dy);
    if (d < r) {
      if (d > 1e-6) {
        o.x = nx + (dx / d) * r;
        o.y = ny + (dy / d) * r;
      } else {
        // centre inside the pillar: push out along the shortest side
        const left = o.x - (p.x - p.w / 2);
        const right = p.x + p.w / 2 - o.x;
        const top = o.y - (p.y - p.h / 2);
        const bottom = p.y + p.h / 2 - o.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) o.x = p.x - p.w / 2 - r;
        else if (m === right) o.x = p.x + p.w / 2 + r;
        else if (m === top) o.y = p.y - p.h / 2 - r;
        else o.y = p.y + p.h / 2 + r;
      }
    }
  }
}

function inWall(s: State, x: number, y: number) {
  if (Math.abs(x) > ROOM_W / 2 || Math.abs(y) > ROOM_H / 2) return true;
  return s.rooms[s.room].pillars.some((p) => Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2);
}

/* ---------- step ---------- */

function enemyShot(s: State, x: number, y: number, angle: number, speed: number) {
  s.bullets.push({ id: s.nextId++, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, enemy: true, dmg: 1, life: 4 });
}

function shotgun(s: State, e: Enemy) {
  const base = Math.atan2(s.player.y - e.y, s.player.x - e.x);
  const spread = (35 * Math.PI) / 180;
  for (let i = 0; i < 5; i++) enemyShot(s, e.x, e.y, base - spread / 2 + (spread / 4) * i, 8);
  s.events.push("blast");
}

export function hurtPlayer(s: State, n: number) {
  const p = s.player;
  if (p.inv > 0 || n <= 0 || s.phase !== "play") return;
  p.hp = Math.max(0, p.hp - n);
  p.inv = 1;
  s.events.push("hurt");
  if (p.hp <= 0) s.phase = "dead";
}

function hitEnemy(s: State, e: Enemy, dmg: number) {
  e.hp -= dmg;
  e.flash = 0.1;
  if (e.kind !== "turret") {
    const dx = e.x - s.player.x;
    const dy = e.y - s.player.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = e.kind === "boss" ? 1 : 5;
    e.kx = (dx / d) * f;
    e.ky = (dy / d) * f;
  }
  s.events.push("hit");
  if (e.hp <= 0) {
    e.dead = 0;
    s.kills++;
    s.events.push("kill");
    const n = e.kind === "boss" ? 12 : 1 + Math.floor(rnd(s) * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd(s) * Math.PI * 2;
      const v = 2 + rnd(s) * 3;
      s.coins.push({ id: s.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
    }
    if (e.kind === "boss") s.bossKilled = true;
  }
}

function moveEnemy(s: State, e: Enemy, dt: number) {
  const p = s.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  let vx = 0;
  let vy = 0;
  if (e.kind === "chaser") {
    if (dist <= 7) {
      vx = (dx / dist) * 2.2;
      vy = (dy / dist) * 2.2;
    }
  } else if (e.kind === "wander") {
    e.t -= dt;
    if (e.t <= 0) {
      e.moving = !e.moving;
      if (e.moving) {
        const a = rnd(s) * Math.PI * 2;
        e.dx = Math.cos(a);
        e.dy = Math.sin(a);
      }
      e.t = e.moving ? 1.5 : 0.5;
    }
    if (e.moving) {
      vx = e.dx * 2;
      vy = e.dy * 2;
    }
  } else if (e.kind === "turret") {
    e.t += dt;
    if (e.t >= 2) {
      e.t = 0;
      enemyShot(s, e.x, e.y, Math.atan2(dy, dx), 5);
    }
  } else {
    // Boss (BossScript): wait, walk in, 3 shotgun blasts, then chase with single shots and a blast every 15 s.
    if (e.state === "idle") {
      if (dist <= 8 || s.roomTime > 1.5) {
        e.state = "intro";
        e.t = 1.2;
        s.events.push("boss");
      }
    } else if (e.state === "intro") {
      e.t -= dt;
      vx = (dx / dist) * 2;
      vy = (dy / dist) * 2;
      if (e.t <= 0) {
        e.state = "burst";
        e.burst = 3;
        e.t = 0;
      }
    } else if (e.state === "burst") {
      e.t -= dt;
      if (e.t <= 0) {
        if (e.burst > 0) {
          shotgun(s, e);
          e.burst--;
          e.t = 0.6;
        } else {
          e.state = "chase";
          e.t = 2;
          e.t2 = 15;
        }
      }
    } else {
      vx = (dx / dist) * 1.5;
      vy = (dy / dist) * 1.5;
      e.t -= dt;
      e.t2 -= dt;
      if (e.t <= 0) {
        e.t = 2;
        enemyShot(s, e.x, e.y, Math.atan2(dy, dx), 7);
      }
      if (e.t2 <= 0) {
        e.state = "burst";
        e.burst = 1;
        e.t = 0;
        e.t2 = 15;
      }
    }
  }
  e.x += (vx + e.kx) * dt;
  e.y += (vy + e.ky) * dt;
  const damp = Math.max(0, 1 - dt * 12);
  e.kx *= damp;
  e.ky *= damp;
  collide(s, e, e.r);
}

/** Advance the run by dt seconds (capped, so a hidden tab can't teleport things). */
export function step(s: State, input: Input, dtRaw: number): State {
  s.events = [];
  if (s.phase !== "play") return s;
  const dt = Math.min(0.05, Math.max(0, dtRaw));
  s.time += dt;
  s.roomTime += dt;
  const p = s.player;

  // move and aim
  let mx = input.mx;
  let my = input.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  p.x += mx * PLAYER_SPEED * dt;
  p.y += my * PLAYER_SPEED * dt;
  const open = roomClear(s) && s.room < s.rooms.length - 1;
  collide(s, p, PLAYER_R, open);
  p.aim = Math.atan2(input.ay - p.y, input.ax - p.x);
  p.inv = Math.max(0, p.inv - dt);

  // through the door
  if (open && p.x > ROOM_W / 2 - 0.2) {
    s.wallet += s.coins.length;
    s.roomsCleared++;
    enterRoom(s, s.room + 1);
    s.events.push("door");
    return s;
  }

  // shooting (Shooting.cs)
  if (p.reloadT >= 0) {
    p.reloadT += dt;
    if (p.reloadT >= p.reloadTime) {
      p.reloadT = -1;
      p.ammo = p.mag;
      p.fireT = 0;
    }
  } else {
    p.fireT = Math.max(0, p.fireT - dt);
    if (input.reload && p.ammo < p.mag) {
      p.reloadT = 0;
      s.events.push("reload");
    } else if (input.fire && p.fireT <= 0 && p.ammo > 0) {
      const n = Math.max(1, p.projectiles);
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : ((SPREAD_DEG * Math.PI) / 180) * (i - (n - 1) / 2);
        const a = p.aim + off;
        s.bullets.push({ id: s.nextId++, x: p.x + Math.cos(a) * 0.5, y: p.y + Math.sin(a) * 0.5, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED, enemy: false, dmg: p.damage, life: 1.2 });
      }
      p.ammo--;
      p.fireT = p.fireInterval;
      s.events.push("shoot");
      if (p.ammo <= 0) {
        p.reloadT = 0;
        s.events.push("reload");
      }
    }
  }

  // enemies
  for (const e of s.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    if (!alive(e)) {
      e.dead += dt;
      continue;
    }
    moveEnemy(s, e, dt);
    if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + PLAYER_R) hurtPlayer(s, 1);
  }
  s.enemies = s.enemies.filter((e) => alive(e) || e.dead < 0.6);

  // bullets
  const keep: Bullet[] = [];
  for (const b of s.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || inWall(s, b.x, b.y)) continue;
    if (b.enemy) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < PLAYER_R + 0.12) {
        hurtPlayer(s, b.dmg);
        continue;
      }
    } else {
      const e = s.enemies.find((x) => alive(x) && Math.hypot(b.x - x.x, b.y - x.y) < x.r + 0.12);
      if (e) {
        hitEnemy(s, e, b.dmg);
        continue;
      }
    }
    keep.push(b);
  }
  s.bullets = keep;

  // coins: slide, then get pulled in when close
  const coins: Coin[] = [];
  for (const c of s.coins) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.6) {
      s.wallet++;
      s.events.push("coin");
      continue;
    }
    if (d < 2.2) {
      c.vx += (dx / d) * 30 * dt;
      c.vy += (dy / d) * 30 * dt;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    const damp = Math.max(0, 1 - dt * 5);
    c.vx *= damp;
    c.vy *= damp;
    collide(s, c, 0.2);
    coins.push(c);
  }
  s.coins = coins;

  if (s.bossKilled && s.phase === "play" && !s.enemies.some(alive)) {
    s.roomsCleared++;
    s.wallet += s.coins.length;
    s.phase = "won";
  }
  return s;
}

/** Buy from the vending machine by code (VendingMachine.TryBuyByCode). */
export function buy(s: State, code: number): { ok: boolean; message: string; item?: Item } {
  const item = ITEMS.find((i) => i.code === code);
  if (!item) return { ok: false, message: "Invalid code" };
  if (s.wallet < item.cost) return { ok: false, message: `Not enough coins (${item.cost} needed)` };
  s.wallet -= item.cost;
  const r = item.apply(s.player);
  if (r.hurt) {
    // Heal(-n) in Unity goes through TakeDamage: it can kill you. Items ignore the hit invincibility.
    s.player.inv = 0;
    hurtPlayer(s, r.hurt);
  }
  s.events.push("buy");
  return { ok: true, message: `${item.name}: ${item.effects}`, item };
}
