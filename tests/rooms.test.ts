import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptAction,
  acceptState,
  cleanMeta,
  cleanPresence,
  cleanRoomInfo,
  CODE_LETTERS,
  CLOSE_GRACE_MS,
  HOST_GRACE_MS,
  makeCode,
  MAX_PAYLOAD_BYTES,
  NO_HOST_MS,
  normalizeCode,
  openRoomsFrom,
  payloadBytes,
  pickHost,
  readEnvelope,
  roomPlayers,
  type RoomMeta,
} from "../src/minigames/room/logic";
import { RoomEngine } from "../src/minigames/room/engine";
import { Directory } from "../src/minigames/room/directory";
import { localTransport, type Transport, type TransportHandlers } from "../src/minigames/room/transport";
import type { RoomInfo, RoomPlayer } from "../src/minigames/room/types";

const P = (id: string, name = id): RoomPlayer => ({ id, name, avatar: null });
const meta = (role: "host" | "player", id: string, since = 1): RoomMeta => ({ role, player: P(id), since });

describe("room codes", () => {
  it("4 letters without I, L, O or U", () => {
    expect(CODE_LETTERS).not.toMatch(/[ILOU]/);
    for (let i = 0; i < 200; i++) expect(makeCode()).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
    expect(makeCode(() => 0)).toBe("AAAA");
    expect(makeCode(() => 0.9999999)).toBe("ZZZZ");
  });
  it("reads typed codes and pasted links", () => {
    expect(normalizeCode(" kqzd ")).toBe("KQZD");
    expect(normalizeCode("https://x.example/arcade/trivia?room=kqzd&a=1")).toBe("KQZD");
    for (const bad of ["KQZ", "KQZDA", "KQ1D", "KILO", "", null, undefined]) expect(normalizeCode(bad)).toBeNull();
  });
});

describe("room messages", () => {
  it("measures size in UTF-8 and refuses what can't be sent", () => {
    expect(payloadBytes({ a: "é" })).toBe(JSON.stringify({ a: "é" }).length + 1);
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(payloadBytes(cyc)).toBe(Infinity);
    expect(payloadBytes(undefined)).toBe(Infinity);
  });
  it("reads envelopes: needs a sender key, drops broken and oversized ones", () => {
    expect(readEnvelope({ from: "abc", s: 1 })).toEqual({ from: "abc", s: 1 });
    for (const bad of [null, "x", [], {}, { from: "" }, { from: "a b" }, { from: "a", to: 5 }]) expect(readEnvelope(bad)).toBeNull();
    expect(readEnvelope({ from: "a", s: "x".repeat(MAX_PAYLOAD_BYTES) })).toBeNull();
  });
  it("players only take state from the host", () => {
    expect(acceptState({ from: "h", s: { q: 1 } }, "h")).toBe(true);
    expect(acceptState({ from: "x", s: { q: 1 } }, "h")).toBe(false);
    expect(acceptState({ from: "h", s: null }, "h")).toBe(false);
    expect(acceptState({ from: "h", s: 1 }, null)).toBe(false);
  });
  it("the host only takes actions meant for it, from players in the room", () => {
    const presence = new Map([
      ["h", meta("host", "host")],
      ["p1", meta("player", "sam")],
    ]);
    expect(acceptAction({ from: "p1", to: "h", a: 1 }, "h", presence)).toEqual(P("sam"));
    expect(acceptAction({ from: "stranger", to: "h", a: 1 }, "h", presence)).toBeNull();
    expect(acceptAction({ from: "p1", to: "other-host", a: 1 }, "h", presence)).toBeNull();
    expect(acceptAction({ from: "h", to: "h", a: 1 }, "h", presence)).toBeNull();
    expect(acceptAction({ from: "p1", to: "h" }, "h", presence)).toBeNull();
  });
});

describe("room presence", () => {
  it("cleans what people track", () => {
    expect(cleanMeta({ role: "player", player: { id: "a", name: " Sam ", avatar: "https://evil.example/x.png" }, since: 5 })).toEqual({
      role: "player",
      player: { id: "a", name: "Sam", avatar: null },
      since: 5,
    });
    expect(cleanMeta({ role: "admin", player: P("a") })).toBeNull();
    expect(cleanMeta({ role: "host", player: { id: "a" } })).toBeNull();
    expect([...cleanPresence({ k: { role: "host", player: P("a") }, bad: 1 }).keys()]).toEqual(["k"]);
  });
  it("picks the earliest host, then sticks to it", () => {
    const pres = new Map([
      ["h2", meta("host", "b", 5)],
      ["h1", meta("host", "a", 2)],
      ["p", meta("player", "c", 1)],
    ]);
    expect(pickHost(pres, null)).toBe("h1");
    expect(pickHost(pres, "h2")).toBe("h2");
    pres.delete("h2");
    expect(pickHost(pres, "h2")).toBeNull(); // the pinned host is gone: no stand-in
    expect(pickHost(new Map([["p", meta("player", "c")]]), null)).toBeNull();
  });
  it("lists the host first, then players by join time, each person once", () => {
    const pres = new Map([
      ["p2", meta("player", "b", 3)],
      ["p1", meta("player", "a", 2)],
      ["p1b", meta("player", "a", 4)],
      ["h", meta("host", "host", 9)],
    ]);
    expect(roomPlayers(pres, "h").map((p) => p.id)).toEqual(["host", "a", "b"]);
    expect(roomPlayers(pres, null).map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("open rooms: cleaned, one per code, lobby first", () => {
    const info = (code: string, phase: RoomInfo["phase"], title = "T"): RoomInfo => ({ code, gameId: "trivia", title, host: P("h"), players: 2, phase });
    expect(cleanRoomInfo({ ...info("KQZD", "lobby"), players: 1e9, title: " x " })).toEqual({ ...info("KQZD", "lobby", "x"), players: 99 });
    expect(cleanRoomInfo({ ...info("kqzd", "lobby") })).toBeNull();
    expect(cleanRoomInfo({ ...info("KQZD", "lobby"), gameId: "../x" })).toBeNull();
    const list = openRoomsFrom([{ rooms: [info("BBBB", "playing"), info("AAAA", "lobby")] }, { rooms: [{ ...info("AAAA", "ended"), title: "dupe" }] }, null, { rooms: "x" }]);
    expect(list.map((r) => [r.code, r.phase])).toEqual([["AAAA", "lobby"], ["BBBB", "playing"]]);
  });
});

/* ---------- a host and players over an in-memory channel ---------- */

class Bus {
  peers = new Map<string, { meta: unknown; h: TransportHandlers; prev: Set<string> }>();
  open = true;
  transport(key: string): Transport {
    let me: { meta: unknown; h: TransportHandlers; prev: Set<string> } | null = null;
    return {
      connect: (h) => {
        me = { meta: null, h, prev: new Set() };
        this.peers.set(key, me);
        h.status("open");
        this.sync();
      },
      track: (m) => {
        if (me) me.meta = m;
        this.sync();
      },
      send: (event, payload) => {
        for (const [k, p] of this.peers) if (k !== key) p.h.broadcast(event, JSON.parse(JSON.stringify(payload)));
      },
      close: async () => {
        if (this.peers.get(key) === me) this.peers.delete(key);
        this.sync();
      },
    };
  }
  /** Someone joins the channel and sends anything they like. */
  rogue(key: string) {
    const t = this.transport(key);
    const got: [string, unknown][] = [];
    t.connect({ status: () => {}, presence: () => {}, broadcast: (e, p) => got.push([e, p]) });
    return { t, got };
  }
  sync() {
    const state: Record<string, unknown> = {};
    for (const [k, p] of this.peers) if (p.meta != null) state[k] = p.meta;
    for (const p of [...this.peers.values()]) {
      const now = new Set(Object.keys(state));
      const joined = [...now].filter((k) => !p.prev.has(k));
      const left = [...p.prev].filter((k) => !now.has(k));
      p.prev = now;
      p.h.presence(state, joined, left);
    }
  }
}

type S = { q: number; pic?: string };
type A = { answer: string };

describe("rooms", () => {
  let bus: Bus;
  beforeEach(() => {
    vi.useFakeTimers();
    bus = new Bus();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const host = (key = "hostkey", extra: Partial<ConstructorParameters<typeof RoomEngine>[0]> = {}) => {
    const e = new RoomEngine<S, A>({ role: "host", code: "KQZD", key, me: P("lenny", "Lenny"), transport: bus.transport(key), gameId: "trivia", title: "Trivia", ...extra });
    e.start();
    return e;
  };
  const player = (key: string, id = key) => {
    const e = new RoomEngine<S, A>({ role: "player", code: "KQZD", key, me: P(id), transport: bus.transport(key) });
    e.start();
    return e;
  };

  it("players see the host, everyone in the room, and the state", () => {
    const h = host();
    const p = player("p1", "sam");
    expect(p.getSnapshot().status).toBe("open");
    expect(p.getSnapshot().host?.name).toBe("Lenny");
    expect(p.getSnapshot().players.map((x) => x.id)).toEqual(["lenny", "sam"]);
    expect(h.getSnapshot().players.map((x) => x.id)).toEqual(["lenny", "sam"]);
    h.setState({ q: 1 });
    expect(p.getSnapshot().state).toEqual({ q: 1 });
  });

  it("late joiners get the latest state right away; states are sent at most every 100 ms, newest last", () => {
    const h = host();
    h.setState({ q: 1 });
    h.setState({ q: 2 });
    vi.advanceTimersByTime(200);
    const late = player("p2");
    vi.advanceTimersByTime(200);
    expect(late.getSnapshot().state).toEqual({ q: 2 });
  });

  it("actions reach the host with the player from presence; strangers and other hosts' actions don't", () => {
    const h = host();
    const p = player("p1", "sam");
    const got: [string, A][] = [];
    h.onAction((from, a) => got.push([from.id, a]));
    p.send({ answer: "B" });
    const r = bus.rogue("stranger");
    r.t.send("action", { from: "stranger", to: "hostkey", a: { answer: "C" } }); // not in the room's presence
    r.t.send("action", { from: "p1", to: "someone-else", a: { answer: "D" } }); // meant for another host
    expect(got).toEqual([["sam", { answer: "B" }]]);
  });

  it("players ignore state that isn't from the host", () => {
    const h = host();
    const p = player("p1");
    h.setState({ q: 1 });
    bus.rogue("x").t.send("state", { from: "x", s: { q: 99 } });
    expect(p.getSnapshot().state).toEqual({ q: 1 });
    // A second tab claiming to be host later doesn't take over.
    const fake = new RoomEngine<S, A>({ role: "host", code: "KQZD", key: "fake", me: P("fake"), transport: bus.transport("fake"), since: 0 });
    fake.start();
    expect(p.getSnapshot().host?.id).toBe("lenny");
  });

  it("a host refresh: players wait, and carry on when the same host comes back", async () => {
    const h = host("hostkey", { since: 10 });
    const p = player("p1");
    h.setState({ q: 3 });
    expect(p.send({ answer: "A" })).toBe(true);
    await h.stop(false); // the tab went away without saying goodbye
    expect(p.getSnapshot().status).toBe("reconnecting");
    expect(p.getSnapshot().host?.id).toBe("lenny"); // still shown while we wait
    expect(p.send({ answer: "B" })).toBe(false); // nobody to send it to
    vi.advanceTimersByTime(HOST_GRACE_MS - 1000);
    expect(p.getSnapshot().status).toBe("reconnecting");
    const back = host("hostkey", { since: 10 });
    const got: A[] = [];
    back.onAction((_f, a) => got.push(a));
    expect(p.getSnapshot().status).toBe("open");
    back.setState({ q: 4 });
    vi.advanceTimersByTime(HOST_GRACE_MS);
    expect(p.getSnapshot().status).toBe("open");
    expect(p.getSnapshot().state).toEqual({ q: 4 });
    expect(p.send({ answer: "C" })).toBe(true);
    expect(got).toEqual([{ answer: "C" }]);
    expect(bus.peers.has("p1")).toBe(true);
  });

  it("the host gone for good: 'The host left.', and the player leaves the channel", async () => {
    const h = host();
    const p = player("p1");
    await h.stop(false);
    vi.advanceTimersByTime(HOST_GRACE_MS + 1);
    expect(p.getSnapshot()).toMatchObject({ status: "closed", error: "The host left." });
    expect(bus.peers.has("p1")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(p.send({ answer: "A" })).toBe(false);
    // Closed is final: a host showing up later doesn't bring it back (the channel is gone).
    host();
    expect(p.getSnapshot().status).toBe("closed");
  });

  it("the host ends the room: players are told after a short wait", async () => {
    const h = host();
    const p = player("p1");
    await h.stop(true);
    expect(p.getSnapshot().status).toBe("reconnecting");
    expect(p.send({ answer: "A" })).toBe(false);
    vi.advanceTimersByTime(CLOSE_GRACE_MS + 1);
    expect(p.getSnapshot()).toMatchObject({ status: "closed", error: "The host closed the room." });
    expect(bus.peers.has("p1")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a close right before the same host mounts again (StrictMode, a view switch) keeps the room", async () => {
    const h = host();
    const p = player("p1");
    h.setState({ q: 1 });
    await h.stop(true);
    const again = host();
    expect(p.getSnapshot().status).toBe("open");
    again.setState({ q: 2 });
    expect(p.getSnapshot().state).toEqual({ q: 2 });
    vi.advanceTimersByTime(CLOSE_GRACE_MS + HOST_GRACE_MS);
    expect(p.getSnapshot().status).toBe("open");
  });

  it("a code nobody hosts closes after a few seconds", () => {
    const p = player("p1");
    expect(p.getSnapshot().status).toBe("connecting");
    expect(p.send({ answer: "A" })).toBe(false);
    vi.advanceTimersByTime(NO_HOST_MS + 1);
    expect(p.getSnapshot()).toMatchObject({ status: "closed", error: "No room with this code is open right now." });
    expect(bus.peers.has("p1")).toBe(false);
  });

  it("states over the size limit are not sent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = host();
    const p = player("p1");
    h.setState({ q: 1, pic: "x".repeat(MAX_PAYLOAD_BYTES) });
    expect(warn).toHaveBeenCalled();
    expect(p.getSnapshot().state).toBeNull();
    h.setState({ q: 2, pic: "data:image/jpeg;base64," + "A".repeat(4000) });
    expect(p.getSnapshot().state?.q).toBe(2);
  });

  it("two hosts with the same code: the newer one picks another code", () => {
    host("first");
    const conflict = vi.fn();
    host("second", { onConflict: conflict });
    expect(conflict).toHaveBeenCalledOnce();
  });

  it("the host lists the room with the number of people in it", () => {
    const infos: (RoomInfo | null)[] = [];
    const h = host("hostkey", { onInfo: (i) => infos.push(i) });
    player("p1");
    h.setPhase("playing", "Trivia · Music");
    expect(infos.at(-1)).toMatchObject({ code: "KQZD", gameId: "trivia", title: "Trivia · Music", players: 2, phase: "playing" });
    void h.stop(true);
    expect(infos.at(-1)).toBeNull();
  });
});

describe("open rooms directory", () => {
  it("shares one channel, lists your own rooms, and leaves a moment after the last user", () => {
    vi.useFakeTimers();
    const closed = vi.fn();
    const tracked: unknown[] = [];
    const make = vi.fn(
      (): Transport => ({ connect: () => {}, track: (m) => tracked.push(m), send: () => {}, close: async () => closed() }),
    );
    const d = new Directory(make, 500);
    const a = d.acquire();
    const b = d.acquire();
    const info: RoomInfo = { code: "KQZD", gameId: "trivia", title: "T", host: P("h"), players: 1, phase: "lobby" };
    d.publish("KQZD", info);
    expect(d.getSnapshot()).toEqual([info]);
    expect(tracked.at(-1)).toEqual({ rooms: [info] });
    a();
    b();
    const c = d.acquire(); // StrictMode: back before the release
    vi.advanceTimersByTime(1000);
    expect(make).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
    d.publish("KQZD", null);
    expect(tracked.at(-1)).toBeNull();
    c();
    vi.advanceTimersByTime(1000);
    expect(closed).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe("local rooms (BroadcastChannel)", () => {
  it.runIf(typeof BroadcastChannel !== "undefined")("two tabs see each other and talk", async () => {
    const name = `bn-room-test-${Math.random()}`;
    const a = localTransport(name, "tab-a");
    const b = localTransport(name, "tab-b");
    let bState: Record<string, unknown> = {};
    const bGot: unknown[] = [];
    a.connect({ status: () => {}, presence: () => {}, broadcast: () => {} });
    b.connect({ status: () => {}, presence: (s) => (bState = s), broadcast: (_e, p) => bGot.push(p) });
    a.track({ role: "host" });
    b.track({ role: "player" });
    await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(bState).sort()).toEqual(["tab-a", "tab-b"]);
    a.send("state", { from: "tab-a", s: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(bGot).toEqual([{ from: "tab-a", s: 1 }]);
    await a.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(bState)).toEqual(["tab-b"]);
    await b.close();
  });
});
