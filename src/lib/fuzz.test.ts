import { describe, expect, it } from "vitest";
import { cellOf, distanceKm, fuzz, type Point } from "./fuzz";

const SECRET = "test-secret";
const KM = 1;

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPoints(n: number, seed = 1): Point[] {
  const r = rand(seed);
  return Array.from({ length: n }, () => ({ lng: r() * 360 - 180, lat: r() * 160 - 80 }));
}

describe("fuzz", () => {
  it("is deterministic", () => {
    const p = { lng: 121.4737, lat: 31.2304 };
    expect(fuzz(p, "u1:0", SECRET, KM)).toEqual(fuzz(p, "u1:0", SECRET, KM));
  });

  it("gives the same public point anywhere inside one cell", () => {
    const p = { lng: 121.4737, lat: 31.2304 };
    const { row, col, dLat, dLng } = cellOf(p, KM);
    const r = rand(7);
    const out = fuzz(p, "u1:0", SECRET, KM);
    for (let i = 0; i < 200; i++) {
      const q = { lng: (col + r()) * dLng - 180, lat: (row + r()) * dLat };
      expect(cellOf(q, KM)).toMatchObject({ row, col });
      expect(fuzz(q, "u1:0", SECRET, KM)).toEqual(out);
    }
  });

  it("stays inside the true point's cell, so never more than a cell diagonal away", () => {
    for (const p of randomPoints(5000)) {
      const out = fuzz(p, "u1:0", SECRET, KM);
      const a = cellOf(p, KM);
      const b = cellOf(out, KM);
      expect([b.row, b.col]).toEqual([a.row, a.col]);
      expect(distanceKm(p, out)).toBeLessThan(KM * Math.SQRT2 + 0.05);
    }
  });

  it("moves points about half a cell on average, not zero", () => {
    const pts = randomPoints(5000, 3);
    const mean = pts.reduce((s, p) => s + distanceKm(p, fuzz(p, "u1:0", SECRET, KM)), 0) / pts.length;
    // mean distance between two uniform points in a unit square is ~0.52
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.65);
  });

  it("keeps cells about 1 km wide at high latitudes", () => {
    const { dLng } = cellOf({ lng: 25, lat: 69.6 }, KM);
    const west = { lng: 25, lat: 69.6 };
    const east = { lng: 25 + dLng, lat: 69.6 };
    expect(distanceKm(west, east)).toBeGreaterThan(0.9);
    expect(distanceKm(west, east)).toBeLessThan(1.1);
  });

  it("puts different roaches in one cell at different spots", () => {
    const p = { lng: 116.3974, lat: 39.9093 };
    const spots = new Set(
      Array.from({ length: 50 }, (_, i) => JSON.stringify(fuzz(p, `user-${i}:0`, SECRET, KM))),
    );
    expect(spots.size).toBe(50);
    expect(fuzz(p, "u1:0", SECRET, KM)).not.toEqual(fuzz(p, "u1:1", SECRET, KM));
  });

  it("depends on the secret", () => {
    const p = { lng: -0.1276, lat: 51.5072 };
    expect(fuzz(p, "u1:0", SECRET, KM)).not.toEqual(fuzz(p, "u1:0", "other", KM));
  });

  it("returns valid coordinates near the antimeridian and the poles", () => {
    for (const p of [
      { lng: 179.9999, lat: -16.5 },
      { lng: -179.9999, lat: 64.8 },
      { lng: 180, lat: 0 },
      { lng: 12, lat: 89.9 },
      { lng: 12, lat: -89.9 },
    ]) {
      const out = fuzz(p, "u1:0", SECRET, KM);
      expect(out.lng).toBeGreaterThanOrEqual(-180);
      expect(out.lng).toBeLessThan(180);
      expect(Math.abs(out.lat)).toBeLessThanOrEqual(85.01);
    }
  });
});
