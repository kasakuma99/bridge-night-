/* Chum's Revenge: the three.js view. Reads the game State every frame and keeps one low-poly object per thing.
   Rendered at a low resolution and scaled up with hard pixels (the PS2 look). World (x, y) -> three (x, z). */
import * as THREE from "three";
import { DOOR_HALF, ROOM_H, ROOM_W, SHOP_POS, alive, roomClear, type Enemy, type State } from "./logic";

/** Internal render height in pixels; the width follows the canvas aspect. */
const RES_H = 270;

const flat = (color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const COLORS = {
  floorA: 0x2a2f55,
  floorB: 0x232848,
  wall: 0x4b3f7a,
  wallTop: 0x8a7bd1,
  pillar: 0x3a6f86,
  doorLocked: 0xff4f6a,
  doorOpen: 0x2ee6a6,
  player: 0xf2e6d0,
  shirt: 0x16f4d0,
  chaser: 0xff4fa3,
  wander: 0xc6ff3d,
  turret: 0x7b8cff,
  boss: 0xff7a2f,
  bullet: 0xfff3a0,
  enemyBullet: 0xff4f6a,
  coin: 0xffd23f,
  vend: 0xd8344f,
};

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function makePlayer() {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.45, 5), flat(0x2b3a8f));
  legs.position.y = 0.22;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.5, 6), flat(COLORS.shirt));
  body.position.y = 0.68;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), flat(COLORS.player));
  head.position.y = 1.15;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.2, 6), flat(0x111111));
  cap.position.y = 1.36;
  const gun = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.12), flat(0x222222));
  barrel.position.x = 0.45;
  gun.add(barrel);
  gun.position.y = 0.75;
  gun.name = "gun";
  g.add(legs, body, head, cap, gun);
  return shadowed(g);
}

function makeEnemy(e: Enemy) {
  const g = new THREE.Group();
  let mat: THREE.MeshLambertMaterial;
  if (e.kind === "chaser") {
    mat = flat(COLORS.chaser);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), mat);
    m.position.y = 0.55;
    m.scale.y = 1.25;
    g.add(m);
  } else if (e.kind === "wander") {
    mat = flat(COLORS.wander);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), mat);
    m.position.y = 0.45;
    g.add(m);
  } else if (e.kind === "turret") {
    mat = flat(COLORS.turret);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.5, 6), mat);
    base.position.y = 0.25;
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), mat);
    top.position.y = 0.72;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.14), flat(0x222244));
    barrel.position.set(0.35, 0.72, 0);
    const aim = new THREE.Group();
    aim.add(top, barrel);
    aim.name = "aim";
    g.add(base, aim);
  } else {
    mat = flat(COLORS.boss);
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), mat);
    body.position.y = 1.1;
    g.add(body);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 4), flat(0x2a1a10));
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.95, 1.4, Math.sin(a) * 0.95);
      spike.lookAt(Math.cos(a) * 3, 2.2, Math.sin(a) * 3);
      spike.rotateX(Math.PI / 2);
      g.add(spike);
    }
  }
  g.userData.mat = mat;
  g.userData.base = mat.color.getHex();
  return shadowed(g);
}

export class ChumsView {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
  private roomGroup = new THREE.Group();
  private door: THREE.Mesh | null = null;
  private builtRoom = -1;
  private player = makePlayer();
  private things = new Map<number, THREE.Object3D>();
  private geo = {
    bullet: new THREE.OctahedronGeometry(0.12, 0),
    coin: new THREE.CylinderGeometry(0.18, 0.18, 0.06, 6),
  };
  private mat = {
    bullet: new THREE.MeshBasicMaterial({ color: COLORS.bullet }),
    enemyBullet: new THREE.MeshBasicMaterial({ color: COLORS.enemyBullet }),
    coin: flat(COLORS.coin, { emissive: 0x332200 }),
  };
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private shake = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.scene.background = new THREE.Color(0x07081a);
    this.scene.fog = new THREE.Fog(0x07081a, 16, 30);
    const hemi = new THREE.HemisphereLight(0x9fd8ff, 0x2a1840, 1.4);
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.8);
    sun.position.set(-6, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    const sc = sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 9;
    sc.bottom = -9;
    this.scene.add(hemi, sun, this.roomGroup, this.player);
    this.camera.position.set(0, 15, 10.5);
    this.camera.lookAt(0, 0, 0.6);
  }

  /** Match the canvas size (CSS pixels) with a low internal resolution. */
  resize(w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const rh = RES_H;
    const rw = Math.round((RES_H * w) / h);
    this.renderer.setSize(rw, rh, false);
    this.camera.aspect = w / h;
    // Keep the whole room in view on narrow screens.
    this.camera.fov = w / h < 1.3 ? 60 : 44;
    this.camera.updateProjectionMatrix();
  }

  /** Mouse position (0..1 in the canvas) to a world point on the floor. */
  toWorld(u: number, v: number): { x: number; y: number } | null {
    this.ray.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, hit) ? { x: hit.x, y: hit.z } : null;
  }

  private buildRoom(s: State) {
    for (const c of [...this.roomGroup.children]) {
      this.roomGroup.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
    const room = s.rooms[s.room];
    // Floor: big checker tiles.
    const tiles = new THREE.Group();
    const tileGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const ma = flat(COLORS.floorA);
    const mb = flat(COLORS.floorB);
    for (let x = 0; x < ROOM_W; x++)
      for (let y = 0; y < ROOM_H; y++) {
        const t = new THREE.Mesh(tileGeo, (x + y) % 2 ? ma : mb);
        t.position.set(-ROOM_W / 2 + x + 0.5, -0.05, -ROOM_H / 2 + y + 0.5);
        t.receiveShadow = true;
        tiles.add(t);
      }
    this.roomGroup.add(tiles);
    // Walls (the right one has the door gap).
    const wallMat = flat(COLORS.wall);
    const H = 1.4;
    const T = 0.5;
    const wall = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      this.roomGroup.add(shadowed(m));
    };
    wall(0, -ROOM_H / 2 - T / 2, ROOM_W + T * 2, T);
    wall(0, ROOM_H / 2 + T / 2, ROOM_W + T * 2, T);
    wall(-ROOM_W / 2 - T / 2, 0, T, ROOM_H);
    const seg = ROOM_H / 2 - DOOR_HALF;
    wall(ROOM_W / 2 + T / 2, -DOOR_HALF - seg / 2, T, seg);
    wall(ROOM_W / 2 + T / 2, DOOR_HALF + seg / 2, T, seg);
    // Door
    const last = s.room >= s.rooms.length - 1;
    const door = new THREE.Mesh(new THREE.BoxGeometry(T * 0.6, H * 0.9, DOOR_HALF * 2), flat(last ? COLORS.wall : COLORS.doorLocked, { emissive: last ? 0 : 0x330008 }));
    door.position.set(ROOM_W / 2 + T / 2, (H * 0.9) / 2, 0);
    this.roomGroup.add(door);
    this.door = last ? null : door;
    // Pillars
    for (const p of room.pillars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.6, p.h), flat(COLORS.pillar));
      m.position.set(p.x, 0.8, p.y);
      this.roomGroup.add(shadowed(m));
    }
    // Vending machine
    if (room.shop) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2, 0.8), flat(COLORS.vend));
      box.position.y = 1;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.05), new THREE.MeshBasicMaterial({ color: 0x7ff0ff }));
      glass.position.set(-0.15, 1.15, 0.42);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
      pad.position.set(0.48, 1.1, 0.42);
      g.add(box, glass, pad);
      g.position.set(SHOP_POS.x, 0, SHOP_POS.y - 0.2);
      this.roomGroup.add(shadowed(g));
    }
    for (const o of this.things.values()) this.scene.remove(o);
    this.things.clear();
    this.builtRoom = s.room;
  }

  render(s: State, dt: number) {
    if (this.builtRoom !== s.room) this.buildRoom(s);
    if (s.events.includes("hurt")) this.shake = 0.25;
    if (s.events.includes("blast") || s.events.includes("kill")) this.shake = Math.max(this.shake, 0.12);

    // door colour
    if (this.door) {
      const open = roomClear(s);
      const m = this.door.material as THREE.MeshLambertMaterial;
      m.color.setHex(open ? COLORS.doorOpen : COLORS.doorLocked);
      m.emissive.setHex(open ? 0x003322 : 0x330008);
      this.door.visible = !open || Math.sin(s.time * 8) > -0.6;
      this.door.scale.y = open ? 0.15 : 1;
      this.door.position.y = open ? 0.1 : 0.63;
    }

    // player
    const p = s.player;
    this.player.position.set(p.x, 0, p.y);
    this.player.getObjectByName("gun")!.rotation.y = -p.aim;
    this.player.visible = p.inv <= 0 || Math.floor(p.inv * 10) % 2 === 0 || s.phase !== "play";
    this.player.rotation.z = s.phase === "dead" ? Math.PI / 2.4 : 0;

    const seen = new Set<number>();
    // enemies
    for (const e of s.enemies) {
      seen.add(e.id);
      let o = this.things.get(e.id);
      if (!o) {
        o = makeEnemy(e);
        this.things.set(e.id, o);
        this.scene.add(o);
      }
      o.position.set(e.x, 0, e.y);
      const mat = o.userData.mat as THREE.MeshLambertMaterial;
      mat.color.setHex(e.flash > 0 ? 0xffffff : (o.userData.base as number));
      if (!alive(e)) {
        const k = Math.max(0, 1 - e.dead / 0.6);
        o.scale.set(1 + (1 - k) * 0.4, k, 1 + (1 - k) * 0.4);
      } else if (e.kind === "turret") {
        o.getObjectByName("aim")!.rotation.y = -Math.atan2(p.y - e.y, p.x - e.x);
      } else {
        o.rotation.y += dt * (e.kind === "boss" ? 0.8 : 2);
        o.position.y = Math.abs(Math.sin(s.time * 6 + e.id)) * 0.12;
      }
    }
    // bullets
    for (const b of s.bullets) {
      seen.add(b.id);
      let o = this.things.get(b.id);
      if (!o) {
        o = new THREE.Mesh(this.geo.bullet, b.enemy ? this.mat.enemyBullet : this.mat.bullet);
        o.userData.shared = true;
        this.things.set(b.id, o);
        this.scene.add(o);
      }
      o.position.set(b.x, 0.7, b.y);
      o.rotation.y += dt * 10;
    }
    // coins
    for (const c of s.coins) {
      seen.add(c.id);
      let o = this.things.get(c.id);
      if (!o) {
        o = new THREE.Mesh(this.geo.coin, this.mat.coin);
        o.rotation.x = Math.PI / 2;
        o.userData.shared = true;
        o.castShadow = true;
        this.things.set(c.id, o);
        this.scene.add(o);
      }
      o.position.set(c.x, 0.3 + Math.sin(s.time * 5 + c.id) * 0.06, c.y);
      o.rotation.z += dt * 4;
    }
    for (const [id, o] of this.things)
      if (!seen.has(id)) {
        this.scene.remove(o);
        if (!o.userData.shared) disposeTree(o);
        this.things.delete(id);
      }

    // camera: follow the player a little, shake on hits
    this.shake = Math.max(0, this.shake - dt);
    const sx = (Math.random() - 0.5) * this.shake * 1.2;
    const sz = (Math.random() - 0.5) * this.shake * 1.2;
    const cx = THREE.MathUtils.clamp(p.x * 0.15, -1.2, 1.2);
    const cz = THREE.MathUtils.clamp(p.y * 0.2, -1, 1);
    this.camera.position.set(cx + sx, 16.5, 11.5 + cz + sz);
    this.camera.lookAt(cx + sx, 0, 0.6 + cz + sz);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const o of this.things.values()) if (!o.userData.shared) disposeTree(o);
    disposeTree(this.roomGroup);
    disposeTree(this.player);
    this.geo.bullet.dispose();
    this.geo.coin.dispose();
    Object.values(this.mat).forEach((m) => m.dispose());
    this.renderer.dispose();
  }
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mat = m.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    }
  });
}
