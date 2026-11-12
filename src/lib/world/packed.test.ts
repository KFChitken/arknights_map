import { describe, expect, it } from "vitest";
import { OVERVIEW_CELLS, overviewCell } from "./area";
import { feedIdsOf, nearMetre, packRoaches, sameRoach, shortIds, shortOf, squareMiddle, squareSpot, unpackRoaches } from "./packed";
import type { MapRoach } from "./types";

const roach = (id: string, lng: number, lat: number, more: Partial<MapRoach> = {}): MapRoach => ({
  id,
  clone: false,
  avatar: "hood",
  color: "cyan",
  lng: nearMetre(lng),
  lat: nearMetre(lat),
  ...more,
});

const byId = (list: MapRoach[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

describe("packed roaches", () => {
  it("come back just as they went, looks, sleep and rides included", () => {
    const list = [
      roach("0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b", 121.473712345, 31.230416789),
      roach("ffffffff-0000-4000-8000-000000000001", -73.98551, 40.75797, { clone: true, avatar: "hood", color: "white", ride: true }),
      roach("00000000-0000-4000-8000-000000000000", 139.6917, 35.6895, { avatar: "imp", color: "red", asleep: true }),
      roach("a1b2c3d4-e5f6-4789-8abc-def012345678", -0.12763, -51.50735, { avatar: "doctor", color: "gold" }),
    ];
    expect(byId(unpackRoaches(packRoaches(list)))).toEqual(byId(list));
  });

  it("keep places to about a metre", () => {
    expect(nearMetre(121.473712345)).toBe(121.47371);
    expect(nearMetre(-0.000004)).toBe(-0);
    const [back] = unpackRoaches(packRoaches([roach("0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b", 121.473712345, 31.230416789)]));
    expect([back.lng, back.lat]).toEqual([121.47371, 31.23042]);
  });

  it("go from west to east, each longitude a step from the last, whatever order they came in", () => {
    const p = packRoaches([
      roach("00000000-0000-4000-8000-000000000003", 30, 0),
      roach("00000000-0000-4000-8000-000000000001", 10, 0),
      roach("00000000-0000-4000-8000-000000000002", 20, 0),
    ]);
    expect(p.x).toEqual([1_000_000, 1_000_000, 1_000_000]);
    expect(p.looks).toEqual([["hood", "cyan"]]);
  });

  it("leave the show roaches, whose ids are not uuids, as they are", () => {
    const bot = roach("bot-7", 116.4, 39.9, { bot: true });
    const p = packRoaches([bot, roach("00000000-0000-4000-8000-000000000001", 10, 0)]);
    expect(p.rest).toEqual([bot]);
    expect(unpackRoaches(p)).toHaveLength(2);
    expect(packRoaches([]).rest).toBeUndefined();
    expect(unpackRoaches(packRoaches([]))).toEqual([]);
  });

  it("in the short form keep four bytes of each id, and the rest as they are", () => {
    const list = [
      roach("0f6b2a52", 121.473712345, 31.230416789),
      roach("ffffffff", -73.98551, 40.75797, { clone: true, color: "white", ride: true }),
      roach("aaaaaaaa-0000-4000-8000-000000000001", 139.6917, 35.6895, { asleep: true }),
      roach("bot-7", 116.4, 39.9, { bot: true }),
    ];
    const p = packRoaches(list, 4);
    expect(p.w).toBe(4);
    expect(atob(p.ids)).toHaveLength(8);
    expect(p.rest!.map((r) => r.id)).toEqual(["aaaaaaaa-0000-4000-8000-000000000001", "bot-7"]);
    expect(byId(unpackRoaches(p))).toEqual(byId(list));
  });

  it("give each roach a short id of its own, its whole public id where two start alike", () => {
    const ids = shortIds([
      "0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b",
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-ffff-4000-8000-000000000002",
      "bot-7",
    ]);
    expect([...ids.values()]).toEqual([
      "0f6b2a52",
      "aaaaaaaa-0000-4000-8000-000000000001",
      "aaaaaaaa-ffff-4000-8000-000000000002",
      "bot-7",
    ]);
    expect(shortOf("0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b")).toBe("0f6b2a52");
    expect(shortOf("bot-7")).toBe("bot-7");
    expect(feedIdsOf("0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b")).toEqual(["0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b", "0f6b2a52"]);
    expect(feedIdsOf("amiya")).toEqual(["amiya"]);
    expect(sameRoach("0f6b2a52", "0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b")).toBe(true);
    expect(sameRoach("0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b", "0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b")).toBe(true);
    expect(sameRoach("0f6b2a53", "0f6b2a52-3c1d-4e0f-9a8b-7c6d5e4f3a2b")).toBe(false);
    expect(sameRoach("amiya", "amiya")).toBe(true);
  });

  it("take up far less room than the list", () => {
    const list = Array.from({ length: 2000 }, (_, i) =>
      roach(crypto.randomUUID(), 73 + ((i * 7919) % 6000) / 100, 18 + ((i * 104729) % 3500) / 100, { clone: i % 3 === 0 }),
    );
    const packed = JSON.stringify(packRoaches(list)).length;
    expect(packed).toBeLessThan(JSON.stringify(list).length * 0.4);
    const short = JSON.stringify(packRoaches(list.map((r) => ({ ...r, id: r.id.slice(0, 8) })), 4)).length;
    expect(short).toBeLessThan(packed * 0.6);
  });
});

describe("the overview's tiles, each roach as its square", () => {
  it("gives every roach back at the middle of its square, with its id, look and weight, in a tenth of the bytes for places", () => {
    const list: MapRoach[] = [
      { id: "aaaa0001", clone: false, avatar: "hood", color: "cyan", lng: 121.4737, lat: 31.2304, n: 5 },
      { id: "aaaa0002", clone: true, avatar: "doctor", color: "pink", lng: 116.40741, lat: 39.90421 },
      { id: "aaaa0003", clone: false, avatar: "hood", color: "cyan", lng: -73.98, lat: 40.75, asleep: true },
      { id: "dddddddd-0000-4000-8000-000000000001", clone: false, avatar: "imp", color: "gold", lng: 139.7, lat: 35.68 },
    ];
    const p = packRoaches(list, 4, true);
    expect(p.x).toEqual([]);
    const back = unpackRoaches(p);
    for (const r of list) {
      const got = back.find((b) => b.id === r.id)!;
      const cell = overviewCell(r);
      expect(overviewCell(got)).toBe(cell);
      expect(got).toEqual({ ...r, ...squareMiddle(cell % OVERVIEW_CELLS, Math.floor(cell / OVERVIEW_CELLS)) });
    }
  });

  it("scattered for the map: each roach at a spot of its own in its square, the same every time, not in rows", () => {
    // a crowded square's worth of neighbours, one roach a square, side by side
    const list: MapRoach[] = Array.from({ length: 400 }, (_, i) => ({
      id: `b${String(i).padStart(7, "0")}`,
      clone: false,
      avatar: "hood",
      color: "cyan",
      lng: 121.4 + (i % 20) * 0.022,
      lat: 31.1 + Math.floor(i / 20) * 0.019,
    }));
    const p = packRoaches(list, 4, true);
    const middles = unpackRoaches(p);
    const spots = unpackRoaches(p, true);
    expect(unpackRoaches(p, true)).toEqual(spots);
    for (const [i, r] of spots.entries()) {
      const cell = overviewCell(middles[i]);
      expect(overviewCell(r)).toBe(cell);
      expect(r).toEqual({ ...middles[i], ...squareSpot(cell % OVERVIEW_CELLS, Math.floor(cell / OVERVIEW_CELLS), r.id) });
    }
    // no longer on a lattice: where in its square each one stands differs from roach to roach
    const across = new Set(spots.map((r, i) => Math.round((r.lng - middles[i].lng) * 1e4)));
    expect(across.size).toBeGreaterThan(50);
    // and only the squares' form moves: places as they are stay as they are
    const exact = packRoaches(list, 4);
    expect(unpackRoaches(exact, true)).toEqual(unpackRoaches(exact));
  });
});
