import { describe, expect, it } from "vitest";
import { circlePath, MapPulse, metresPerPx, spotAbove, zoomFor } from "./zoneAim";

/** Metres between two spots on a sphere the size of the Earth */
function metresBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const r = 6371008.8;
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

describe("圈禁放区's sums", () => {
  it("knows how much ground a pixel covers, and the zoom for a size", () => {
    // MapLibre's own figure: at zoom 0 a 512-pixel world, about 78 km a pixel at the equator
    expect(metresPerPx(0, 0)).toBeCloseTo(78271.5, 0);
    expect(metresPerPx(60, 0)).toBeCloseTo(78271.5 / 2, 0);
    expect(metresPerPx(30, 15)).toBeCloseTo(metresPerPx(30, 14) / 2, 6);
    // and back: 200 metres as 100 pixels in Chengdu
    const z = zoomFor(200, 30.66, 100);
    expect(200 / metresPerPx(30.66, z)).toBeCloseTo(100, 6);
  });

  it("finds the spot a crosshair above the middle of the map points at", () => {
    const view = { lng: 104.0657, lat: 30.6595, zoom: 15 };
    expect(spotAbove(view, 0).lat).toBeCloseTo(view.lat, 9);
    const up = spotAbove(view, 150);
    expect(up.lng).toBe(view.lng);
    expect(up.lat).toBeGreaterThan(view.lat);
    // 150 pixels at that zoom, on the ground, within a metre
    expect(Math.abs(metresBetween(view, up) - 150 * metresPerPx(view.lat, 15))).toBeLessThan(1);
    // and down again
    expect(spotAbove({ ...up, zoom: 15 }, -150).lat).toBeCloseTo(view.lat, 9);
  });

  it("draws a circle as a closed path, every point the radius from the middle", () => {
    const at = { lng: 135.5, lat: 34.69 };
    const path = circlePath(at, 500);
    expect(path).toHaveLength(73);
    expect(path[0]).toEqual(path[72]);
    for (const p of path) expect(Math.abs(metresBetween(at, p) - 500)).toBeLessThan(5);
  });

  it("tells whoever listens where the map came to rest, and when it moves", () => {
    const pulse = new MapPulse({ lng: 0, lat: 0, zoom: 2 });
    let heard = 0;
    const off = pulse.on(() => heard++);
    pulse.moving(true);
    pulse.moving(true);
    expect(pulse.get()).toEqual({ view: { lng: 0, lat: 0, zoom: 2 }, moving: true });
    pulse.rest({ lng: 1, lat: 2, zoom: 3 });
    expect(pulse.get()).toEqual({ view: { lng: 1, lat: 2, zoom: 3 }, moving: false });
    expect(heard).toBe(2);
    off();
    pulse.moving(true);
    expect(heard).toBe(2);
  });
});
