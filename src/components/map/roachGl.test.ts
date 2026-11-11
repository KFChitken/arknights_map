import { describe, expect, it } from "vitest";
import { iconPx } from "@/lib/swarm";
import { crowdOf, thinMasks } from "./roachGl";

// 高德 zoom 2..7: which square of the screen half an icon wide a roach is in
const cellOf = (r: { lng: number; lat: number }, zoom: number) => {
  const per = (256 * 2 ** zoom) / Math.max(4, iconPx(zoom - 1) / 2);
  const sin = Math.sin((r.lat * Math.PI) / 180);
  const x = Math.floor(((r.lng + 180) / 360) * per);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * per);
  return `${x},${y}`;
};

describe("thinMasks", () => {
  // a crowd in and around Shanghai, and a few far apart
  const roaches = [
    ...Array.from({ length: 400 }, (_, i) => ({ lng: 121.2 + ((i * 37) % 97) / 200, lat: 31.0 + ((i * 53) % 89) / 200 })),
    { lng: 87.6, lat: 43.8 },
    { lng: 126.6, lat: 45.8 },
    { lng: 110.3, lat: 20.0 },
  ];
  const masks = thinMasks(roaches, 7);
  const kept = (i: number, zoom: number) => Math.floor(masks[i] / 2 ** (zoom - 2)) % 2 === 1;

  it("draws one roach of each pile at every far zoom, and every pile", () => {
    for (let zoom = 2; zoom <= 7; zoom++) {
      const cells = new Map<string, number>();
      roaches.forEach((r, i) => {
        const c = cellOf(r, zoom);
        cells.set(c, (cells.get(c) ?? 0) + (kept(i, zoom) ? 1 : 0));
      });
      expect([...cells.values()].every((n) => n === 1)).toBe(true);
    }
  });

  it("keeps the roach drawn on top of a pile, so 触须之交 (drawn last) stay", () => {
    const pile = [{ lng: 121.47, lat: 31.23 }, { lng: 121.4701, lat: 31.2301 }, { lng: 121.4702, lat: 31.2302 }];
    const m = thinMasks(pile, 7);
    expect(m[2]).toBe(2 ** 6 - 1);
    expect(m[0]).toBe(0);
    expect(m[1]).toBe(0);
  });

  it("leaves a lone roach at every zoom", () => {
    for (const i of [400, 401, 402]) expect(masks[i]).toBe(2 ** 6 - 1);
  });
});

describe("crowdOf", () => {
  it("counts the roaches in the 3×3 cells around each, a kilometre or so across at Shanghai", () => {
    const here = { lng: 121.47, lat: 31.23 };
    const list = [
      ...Array.from({ length: 9 }, (_, i) => ({ lng: here.lng + i * 1e-5, lat: here.lat })),
      { lng: 116.4, lat: 39.9 },
    ];
    const c = crowdOf(list);
    // nine together: 9 / 9 for each of them; the one in Beijing alone: 1 / 9
    expect([...c.slice(0, 9)].every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    expect(c[9]).toBeCloseTo(1 / 9);
    expect(crowdOf([])).toHaveLength(0);
  });
});
