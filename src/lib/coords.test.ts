import { describe, expect, it } from "vitest";
import { fromGcj, fromTencent, shifted, tencentShifted, toGcj, toTencent } from "./coords";
import { distanceKm } from "./geo";

const metresMoved = (p: { lng: number; lat: number }) => {
  const [lng, lat] = toGcj(p);
  return distanceKm(p, { lng, lat }) * 1000;
};

const PLACES = {
  beijing: { lng: 116.3975, lat: 39.9087 },
  hongKong: { lng: 114.1694, lat: 22.3193 },
  macau: { lng: 113.5439, lat: 22.1987 },
  xiamen: { lng: 118.0894, lat: 24.4798 }, // an island, too small for the outlines' scale
  dandong: { lng: 124.3546, lat: 40.1291 }, // across the Yalu from North Korea
  heihe: { lng: 127.48, lat: 50.22 }, // across the Amur from Russia, a little way from the river
  taipei: { lng: 121.5654, lat: 25.033 },
  kinmen: { lng: 118.3171, lat: 24.4321 },
  seoul: { lng: 126.978, lat: 37.5665 },
  osaka: { lng: 135.5023, lat: 34.6937 },
  sinuiju: { lng: 124.398, lat: 40.1006 },
  hanoi: { lng: 105.8342, lat: 21.0278 },
  tokyo: { lng: 139.6917, lat: 35.6895 },
  newYork: { lng: -74.006, lat: 40.7128 },
};

describe("Amap's coordinates", () => {
  it("shifts mainland China, Hong Kong, Macau and Taiwan, the islands included", () => {
    for (const p of [PLACES.beijing, PLACES.hongKong, PLACES.macau, PLACES.xiamen, PLACES.dandong, PLACES.heihe, PLACES.taipei, PLACES.kinmen]) {
      expect(shifted(p)).toBe(true);
      expect(metresMoved(p)).toBeGreaterThan(200);
    }
    expect(metresMoved(PLACES.beijing)).toBeGreaterThan(500);
    expect(metresMoved(PLACES.beijing)).toBeLessThan(620);
  });

  it("leaves every other country where it is", () => {
    for (const p of [PLACES.seoul, PLACES.osaka, PLACES.sinuiju, PLACES.hanoi, PLACES.tokyo, PLACES.newYork]) {
      expect(shifted(p)).toBe(false);
      expect(toGcj(p)).toEqual([p.lng, p.lat]);
      expect(fromGcj(p.lng, p.lat)).toEqual(p);
    }
  });

  it("puts Taipei 101 where Amap has it", () => {
    // Amap's own position for 台北101大楼, asked on 2026-11-06
    const [lng, lat] = toGcj({ lng: 121.564468, lat: 25.033964 });
    expect(distanceKm({ lng, lat }, { lng: 121.568341, lat: 25.030941 }) * 1000).toBeLessThan(30);
  });

  it("comes back to within a metre of where it started", () => {
    for (const p of [PLACES.beijing, PLACES.hongKong, PLACES.xiamen]) {
      const [lng, lat] = toGcj(p);
      expect(distanceKm(p, fromGcj(lng, lat)) * 1000).toBeLessThan(1);
    }
  });
});

describe("Amap's coordinates by China's land borders", () => {
  // Around each border town, the spot the borders before (Natural Earth's) judged wrong deepest, on China's side and
  // across: from scripts comparing them with OpenStreetMap's (geo-maps countries-land-100m), on a 0.002° grid
  const CHINA_SIDE: [string, number, number][] = [
    ["Dandong", 124.438, 40.148],
    ["Ji'an", 126.164, 41.096],
    ["Changbai", 128.196, 41.418],
    ["Tumen", 129.848, 42.932],
    ["Hunchun", 130.254, 42.856],
    ["Heihe", 127.59, 50.182],
    ["Tongjiang", 132.452, 47.716],
    ["Fuyuan", 134.212, 48.366],
    ["Suifenhe", 131.144, 44.436],
    ["Manzhouli", 117.428, 49.616],
    ["Hekou", 103.986, 22.558],
    ["Pingxiang", 106.71, 21.992],
    ["Ruili", 97.866, 24.0],
    ["Mohe, Beiji Village", 122.34, 53.49],
  ];
  const ACROSS: [string, number, number][] = [
    ["Sinuiju", 124.388, 40.052],
    ["Manpo", 126.122, 41.072],
    ["Hyesan", 128.172, 41.396],
    ["Namyang", 129.888, 42.988],
    ["across from Hunchun", 130.252, 42.884],
    ["Zamyn-Uud", 111.938, 43.706],
    ["across from Khorgos", 80.344, 44.136],
    ["Lao Cai", 103.926, 22.532],
    ["Mong Cai", 108.004, 21.492],
    ["Dong Dang", 106.682, 22.076],
    ["Muse", 97.824, 23.968],
    ["Boten", 101.662, 21.182],
    ["across from Zhangmu", 85.952, 27.988],
    ["across from Beiji Village", 122.45, 53.46],
  ];

  it("shifts China's side of the border towns, to about 100 m of the border", () => {
    for (const [name, lng, lat] of CHINA_SIDE) expect(shifted({ lng, lat }), name).toBe(true);
  });

  it("leaves the towns across the border where they are", () => {
    for (const [name, lng, lat] of ACROSS) expect(shifted({ lng, lat }), name).toBe(false);
  });

  it("shifts what China draws as its own, as Amap does: 藏南 too", () => {
    // Tawang and Itanagar
    for (const p of [
      { lng: 91.86, lat: 27.59 },
      { lng: 93.62, lat: 27.08 },
    ]) {
      expect(shifted(p)).toBe(true);
    }
  });
});

describe("Tencent's coordinates", () => {
  // the county halls of Penghu, Kinmen and Lienchiang (Matsu), and Wuqiu
  const ISLANDS = [
    PLACES.taipei,
    PLACES.kinmen,
    { lng: 119.5664, lat: 23.5697 },
    { lng: 118.3187, lat: 24.4369 },
    { lng: 119.9231, lat: 26.1598 },
    { lng: 119.4519, lat: 24.9887 },
  ];
  // the mainland across the straits from them: Xiamen's island, Dadeng (the new airport), Huangqi, Fuzhou
  const COAST = [PLACES.xiamen, { lng: 118.335, lat: 24.556 }, { lng: 119.893, lat: 26.331 }, { lng: 119.2965, lat: 26.0745 }];

  it("shifts mainland China, Hong Kong and Macau as Amap does", () => {
    for (const p of [PLACES.beijing, PLACES.hongKong, PLACES.macau, PLACES.dandong, PLACES.heihe, ...COAST]) {
      expect(tencentShifted(p)).toBe(true);
      expect(toTencent(p)).toEqual(toGcj(p));
    }
  });

  it("leaves Taiwan and its islands where they are, unlike Amap", () => {
    for (const p of ISLANDS) {
      expect(shifted(p)).toBe(true);
      expect(tencentShifted(p)).toBe(false);
      expect(toTencent(p)).toEqual([p.lng, p.lat]);
      expect(fromTencent(p.lng, p.lat)).toEqual(p);
    }
  });

  it("leaves every other country where it is", () => {
    for (const p of [PLACES.seoul, PLACES.osaka, PLACES.sinuiju, PLACES.hanoi, PLACES.tokyo, PLACES.newYork]) {
      expect(tencentShifted(p)).toBe(false);
      expect(toTencent(p)).toEqual([p.lng, p.lat]);
    }
  });

  it("comes back to within a metre of where it started", () => {
    for (const p of [PLACES.beijing, PLACES.hongKong, PLACES.xiamen, ...ISLANDS]) {
      const [lng, lat] = toTencent(p);
      expect(distanceKm(p, fromTencent(lng, lat)) * 1000).toBeLessThan(1);
    }
  });
});
