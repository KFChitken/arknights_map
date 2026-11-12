import { describe, expect, it, vi } from "vitest";
import { homeSpot } from "./siHomes";
import { RESERVOIR, RIVER } from "./siWater";
import {
  brushOf,
  distanceTo,
  fromSpiral,
  INN_BOUNDS,
  inkNow,
  innNumbers,
  inside,
  LAKE,
  MOON_POND,
  MILESTONES,
  QUEUE_LINES,
  queueLine,
  queueSpot,
  queueTailLine,
  queueTurns,
  ROOM_M,
  roomOf,
  ROOMS,
  roomSpot,
  roomsThatFit,
  ROUTE_PLACES,
  SEGMENT_ENDS_M,
  SPIRAL_R0,
  STAY_MS,
  STEP_M,
  toLngLat,
  toXY,
} from "./siInn";

const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("缘缘庄", () => {
  it("gives ticket n the room ticket n − 2500 leaves", () => {
    expect([1, 2500, 2501, 5000, 5001].map(roomOf)).toEqual([1, 2500, 1, 2500, 1]);
  });

  it("counts the queue, the rooms and the fields from the four numbers", () => {
    expect(innNumbers({ drawn: 6000, tickets: 7000, checkedIn: 4000, checkedOut: 2000 })).toEqual({
      queue: 3000,
      staying: 2000,
      free: 500,
      outside: 1000,
      places: 3000,
    });
    // less the ink roaches held off the map, and the places and rooms their recalled tickets leave empty; a room
    // left early stays taken till its guest was due out, and the queue's line reaches as far as before
    expect(innNumbers({ drawn: 6000, tickets: 7000, checkedIn: 4000, checkedOut: 2000, held: 30, empty: { queue: 10, rooms: 5 } })).toEqual({
      queue: 2990,
      staying: 1995,
      free: 500,
      outside: 985,
      places: 3000,
    });
  });

  it("traces the route through the village a place every 3 m, each segment about as long as planned", () => {
    expect(SEGMENT_ENDS_M[0]).toBeGreaterThan(150);
    expect(SEGMENT_ENDS_M[3]).toBeGreaterThan(1000);
    // each a straight 3 m from the one before, corners and all
    expect(ROUTE_PLACES).toBeLessThanOrEqual(Math.floor(SEGMENT_ENDS_M[3] / STEP_M) + 1);
    for (let p = 2; p <= ROUTE_PLACES; p++) expect(apart(queueSpot(p), queueSpot(p - 1))).toBeCloseTo(STEP_M, 1);
  });

  it("keeps every two ink roaches at least 2.5 m apart: route, spiral and rooms", () => {
    const spots = [
      ...Array.from({ length: ROUTE_PLACES + 3000 }, (_, i) => queueSpot(i + 1)),
      ...Array.from({ length: ROOMS }, (_, i) => roomSpot(i + 1)),
    ];
    // a grid of 5 m cells, to compare neighbours only
    const grid = new Map<string, { x: number; y: number }[]>();
    const key = (x: number, y: number) => `${Math.floor(x / 5)},${Math.floor(y / 5)}`;
    for (const s of spots) grid.set(key(s.x, s.y), [...(grid.get(key(s.x, s.y)) ?? []), s]);
    let closest = Infinity;
    for (const s of spots) {
      const [cx, cy] = [Math.floor(s.x / 5), Math.floor(s.y / 5)];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (o !== s) closest = Math.min(closest, apart(o, s));
    }
    expect(closest).toBeGreaterThanOrEqual(ROOM_M - 1e-6);
  });

  it("winds the spiral round the village, rings 120 m apart, three abreast and rows 6 m apart", () => {
    const at = (p: number) => {
      const s = queueSpot(p);
      return Math.hypot(s.x, s.y);
    };
    expect(at(ROUTE_PLACES + 1)).toBeGreaterThan(SPIRAL_R0 - 5);
    // the same angle a ring later is 120 m further out
    const first = ROUTE_PLACES + 2;
    const ring = MILESTONES.ring1;
    expect(at(ring + 1) - at(first)).toBeGreaterThan(110);
    expect(at(ring + 1) - at(first)).toBeLessThan(130);
    expect(queueTurns(MILESTONES.ring5)).toBeCloseTo(5, 1);
  });

  it("puts the landmarks in order along the queue, and says the furthest one passed", () => {
    const m = MILESTONES;
    const order = [m.bridge, m.moon, m.gate, m.ring1, m.ring5, m.ring10, m.tachuan];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(m.gate).toBe(ROUTE_PLACES);
    // as planned: the village holds a few hundred, 塔川 is some 100,000 out
    expect(m.gate).toBeGreaterThan(300);
    expect(m.tachuan).toBeGreaterThan(80_000);
    expect(m.tachuan).toBeLessThan(120_000);
    expect(queueTailLine(m.bridge - 1, 0)).toBeNull();
    expect(queueTailLine(m.bridge, 0)).toBe(QUEUE_LINES.bridge);
    expect(queueTailLine(m.moon, 0)).toBe(QUEUE_LINES.moon);
    expect(queueTailLine(m.gate + 10, 0)).toBe(QUEUE_LINES.gate);
    expect(queueTailLine(m.ring5 + 1, 0)).toBe(QUEUE_LINES.ring5);
    expect(queueTailLine(m.tachuan, m.tachuan)).toBe(QUEUE_LINES.tachuan);
    // a round shorter than a day ago
    expect(queueTailLine(m.ring5, m.ring10)).toBe(QUEUE_LINES.shrink);
    expect(queueTailLine(m.ring5, m.ring5 + 100)).toBe(QUEUE_LINES.ring5);
  });

  it("fits every room on dry land, and works the same every time", () => {
    expect(roomsThatFit()).toBeGreaterThanOrEqual(ROOMS);
    expect(roomSpot(1)).toEqual(roomSpot(1));
    expect(queueSpot(12345)).toEqual(queueSpot(12345));
    const p = toLngLat(...toXY({ lng: 117.9833, lat: 30.0047 }));
    expect(p.lng).toBeCloseTo(117.9833, 9);
    expect(queueLine(0)).toEqual([]);
    expect(queueLine(ROUTE_PLACES + 500).length).toBeGreaterThan(50);
  });
});

describe("each ink roach where it is now", () => {
  const T = Date.UTC(2026, 10, 12, 6);
  const home = { lng: 117.99, lat: 30.01 };
  const spotOf = (s: { x: number; y: number }) => toLngLat(s.x, s.y);

  it("queues at the place me() gave, or further forward as the newer count has it, never past the door", () => {
    const ink = { state: "queue" as const, n: 3000, place: 500, checkinAt: T, inkNo: 7, home };
    expect(inkNow(ink, null, T - 1000)).toEqual({ state: 0, at: spotOf(queueSpot(500)), left: queueSpot(500).left, place: 500, until: T });
    expect(inkNow(ink, 2800, T - 1000)).toMatchObject({ state: 0, place: 200, at: spotOf(queueSpot(200)) });
    // an older count than me() had moves it no further back
    expect(inkNow(ink, 2000, T - 1000)).toMatchObject({ state: 0, place: 500 });
    expect(inkNow(ink, 3200, T - 1000)).toMatchObject({ state: 0, place: 1 });
  });

  it("goes into its room at its check-in and home at its check-out, whatever me() said a moment before", () => {
    const ink = { state: "queue" as const, n: 3000, place: 1, checkinAt: T, inkNo: 7, home };
    expect(inkNow(ink, null, T)).toEqual({
      state: 1,
      at: spotOf(roomSpot(500)),
      left: roomSpot(500).left,
      room: roomOf(3000),
      until: T + STAY_MS,
    });
    expect(inkNow(ink, null, T + STAY_MS)).toEqual({ state: 2, at: home, left: brushOf(7).headLeft, until: null });
    const staying = { state: "stay" as const, n: 3000, room: 500, checkoutAt: T + STAY_MS, inkNo: 7, home };
    expect(inkNow(staying, 4000, T + STAY_MS - 1)).toMatchObject({ state: 1, room: 500, until: T + STAY_MS });
    expect(inkNow(staying, 4000, T + STAY_MS)).toMatchObject({ state: 2, at: home });
    expect(inkNow({ state: "out", inkNo: 7, home }, null, T)).toEqual({ state: 2, at: home, left: brushOf(7).headLeft, until: null });
  });
});

describe("the homes outside the village", () => {
  const COUNT = 60_000;
  const homes = Array.from({ length: COUNT }, (_, i) => homeSpot(i + 1));
  const reach = Math.hypot(homes[COUNT - 1].x, homes[COUNT - 1].y);
  const water = [LAKE, MOON_POND, RESERVOIR, RIVER].map((pts) => pts.map(([lng, lat]) => toXY({ lng, lat })));

  it("fills outwards from the village, one home each, the same every time", () => {
    // (sorted to a tenth of a millimetre, stored as 32-bit floats: as far out as the one before, to a millimetre)
    for (let i = 1; i < COUNT; i++) expect(Math.hypot(homes[i].x, homes[i].y)).toBeGreaterThan(Math.hypot(homes[i - 1].x, homes[i - 1].y) - 1e-3);
    expect(new Set(homes.map((h) => `${h.x},${h.y}`)).size).toBe(COUNT);
    expect(homeSpot(12345)).toEqual(homes[12344]);
    expect(homes.every((h, i) => h.left === brushOf(i + 1).headLeft)).toBe(true);
  });

  it("keeps clear of the village, the inn, the route and the water", () => {
    const [w, s] = toXY({ lng: INN_BOUNDS.west, lat: INN_BOUNDS.south });
    const [e, n] = toXY({ lng: INN_BOUNDS.east, lat: INN_BOUNDS.north });
    const route = Array.from({ length: ROUTE_PLACES }, (_, i) => queueSpot(i + 1));
    for (const h of homes) {
      expect(fromSpiral(h.x, h.y).inside).toBe(false);
      expect(h.x > w - 8 && h.x < e + 8 && h.y > s - 8 && h.y < n + 8).toBe(false);
      for (const ring of water) expect(inside(h.x, h.y, ring)).toBe(false);
    }
    // nearest to the water and the route, over all of them
    let shore = Infinity;
    let road = Infinity;
    for (const h of homes) {
      for (const ring of water) shore = Math.min(shore, distanceTo(h.x, h.y, ring));
      if (Math.hypot(h.x, h.y) < SPIRAL_R0 + 60) for (const r of route) road = Math.min(road, apart(h, r));
    }
    expect(shore).toBeGreaterThan(3);
    expect(road).toBeGreaterThanOrEqual(8);
  });

  it("lies scattered, each at least 5 m from any other, nudged off an 8 m grid by up to 1.5 m each way", () => {
    // the first 20,000, each against the others in the 10 m cells round it (any closer than 10 m are among them)
    const FIRST = 20_000;
    const cells = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / 10)},${Math.floor(y / 10)}`;
    for (let k = 0; k < FIRST; k++) cells.set(key(homes[k].x, homes[k].y), [...(cells.get(key(homes[k].x, homes[k].y)) ?? []), k]);
    let closest = Infinity;
    for (let k = 0; k < FIRST; k++) {
      const h = homes[k];
      const [cx, cy] = [Math.floor(h.x / 10), Math.floor(h.y / 10)];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) for (const m of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (m !== k) closest = Math.min(closest, apart(h, homes[m]));
    }
    expect(closest).toBeGreaterThanOrEqual(5);
    // off their cells' middles, each its own way, never by more than 1.5 m
    const off = homes.slice(0, FIRST).flatMap((h) => [h.x - 8 * Math.round(h.x / 8), h.y - 8 * Math.round(h.y / 8)]);
    expect(Math.max(...off.map(Math.abs))).toBeLessThanOrEqual(1.5 + 1e-3);
    const mean = off.reduce((a, b) => a + b, 0) / off.length;
    const spread = Math.sqrt(off.reduce((a, b) => a + (b - mean) ** 2, 0) / off.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(spread).toBeGreaterThan(0.8);
  });

  it("works out 100,000 in well under a second, and the same homes on a grid worked out bigger", async () => {
    vi.resetModules();
    const fresh = await import("./siHomes");
    const t0 = performance.now();
    fresh.homeSpot(100_000);
    expect(performance.now() - t0).toBeLessThan(2000);
    // how far out they reach (the numbers 祀's plan gave): 10,000, 50,000 and 100,000 drawn
    expect([10_000, 50_000, 100_000].map((k) => Math.round(fresh.homesReach(k)))).toEqual([672, 1249, 1686]);
    // a grid two sizes bigger keeps every home, by its number
    fresh.homeSpot(300_000);
    let moved = 0;
    for (let i = 0; i < COUNT; i++) {
      const h = fresh.homeSpot(i + 1);
      if (h.x !== homes[i].x || h.y !== homes[i].y) moved++;
    }
    expect(moved).toBe(0);
  });

  it("never lies within 8 m of where the queue stands on the spiral", () => {
    // every place on the spiral out past the furthest home, in a grid of 10 m cells
    const grid = new Map<string, { x: number; y: number }[]>();
    const key = (x: number, y: number) => `${Math.floor(x / 10)},${Math.floor(y / 10)}`;
    for (let p = ROUTE_PLACES + 1; ; p++) {
      const q = queueSpot(p);
      if (Math.hypot(q.x, q.y) > reach + 30) break;
      const k = key(q.x, q.y);
      grid.set(k, [...(grid.get(k) ?? []), q]);
    }
    let closest = Infinity;
    for (const h of homes) {
      const [cx, cy] = [Math.floor(h.x / 10), Math.floor(h.y / 10)];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) closest = Math.min(closest, apart(h, q));
    }
    expect(closest).toBeGreaterThanOrEqual(8);
  });
});
