import { describe, expect, it } from "vitest";
import { crawl, iconPx } from "@/lib/swarm";
import { crowdOf, roachesAt, thinMasks, type DrawnView } from "./roachGl";

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

describe("roachesAt (what a tap on the GPU layer is on)", () => {
  const W = 400;
  const H = 800;
  // a view whose map coordinates are the container's pixels
  const mvp = new Float32Array(16);
  mvp[0] = 2 / W;
  mvp[5] = -2 / H;
  mvp[12] = -1;
  mvp[13] = 1;
  const view = (more: Partial<DrawnView> = {}): DrawnView => ({ mvp, W, H, size: 36, thinPow: 0, now: 1234, crawling: false, ...more });
  // four roaches: two on one spot, one 5 px to the right of it, one 30 px
  const at = [
    [100, 100],
    [105, 100],
    [130, 100],
    [100, 100],
  ];
  const xy = new Float64Array(at.flat());
  const list = at.map((_, i) => ({ seed: 1000 + i * 7919, still: false }));
  const all = new Float32Array([1, 1, 1, 1]);

  it("finds every roach within half an icon of the tap, the last drawn (on top) first, with how far each is", () => {
    // (the view is in 32-bit floats, as the GPU has it: to a hundredth of a px or so)
    const near = (d: number) => expect.closeTo(d, 2);
    expect(roachesAt(view(), list, xy, all, -1, 100, 100)).toEqual([
      { i: 3, d: near(0) },
      { i: 1, d: near(5) },
      { i: 0, d: near(0) },
    ]);
    // the top one only, as a tap opened before
    expect(roachesAt(view(), list, xy, all, -1, 100, 100, { first: true })).toEqual([{ i: 3, d: near(0) }]);
    // further, when asked: the one 30 px off too
    expect(roachesAt(view(), list, xy, all, -1, 100, 100, { reach: 40 }).map((h) => h.i)).toEqual([3, 2, 1, 0]);
    // at least 14 px however small the icons are drawn
    expect(roachesAt(view({ size: 10 }), list, xy, all, -1, 100, 113).map((h) => h.i)).toEqual([3, 1, 0]);
    expect(roachesAt(view({ size: 10 }), list, xy, all, -1, 100, 115)).toEqual([]);
  });

  it("leaves out the one off stage, and those not drawn at a far-out zoom", () => {
    expect(roachesAt(view(), list, xy, all, 3, 100, 100).map((h) => h.i)).toEqual([1, 0]);
    // thinPow 2: the second bit of each mask says whether it is drawn
    expect(roachesAt(view({ thinPow: 2 }), list, xy, new Float32Array([2, 1, 3, 0]), -1, 100, 100).map((h) => h.i)).toEqual([0]);
  });

  it("finds a crawling roach where its crawl has it, and a sleeping one where it lies", () => {
    const crawling = view({ crawling: true, now: 5000 });
    const one = [{ seed: 424242, still: false }];
    const c = crawl(424242, 5000, "cartoon", 36 / 24);
    const spot = new Float64Array([200, 300]);
    expect(Math.hypot(c.dx, c.dy)).toBeGreaterThan(0.5);
    expect(roachesAt(crawling, one, spot, all, -1, 200 + c.dx, 300 + c.dy)[0].d).toBeCloseTo(0, 2);
    expect(roachesAt(crawling, [{ seed: 424242, still: true }], spot, all, -1, 200, 300)[0].d).toBeCloseTo(0, 2);
  });
});
