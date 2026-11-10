import { describe, expect, it } from "vitest";
import { nearMetre, packRoaches, unpackRoaches } from "./packed";
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

  it("take up far less room than the list", () => {
    const list = Array.from({ length: 2000 }, (_, i) =>
      roach(crypto.randomUUID(), 73 + ((i * 7919) % 6000) / 100, 18 + ((i * 104729) % 3500) / 100, { clone: i % 3 === 0 }),
    );
    const packed = JSON.stringify(packRoaches(list)).length;
    expect(packed).toBeLessThan(JSON.stringify(list).length * 0.4);
  });
});
