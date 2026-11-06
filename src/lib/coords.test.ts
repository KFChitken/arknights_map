import { describe, expect, it } from "vitest";
import { fromGcj, shifted, toGcj } from "./coords";
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
