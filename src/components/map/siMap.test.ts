import { describe, expect, it } from "vitest";
import { expression, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { MILESTONES } from "@/lib/siInn";
import { siLayers, siSources } from "./siMap";
import { BLOT_RADIUS, butterflyAt, INK_SIZE, interp, QUEUE_OPACITY, scrollAt, SCROLL_OPEN_FROM, zoomExpr } from "./siLook";
import type { SiMapData } from "./types";

const si: SiMapData = {
  inn: { queue: MILESTONES.ring1, drawn: 40_000, full: true, homesReach: 600 },
  inks: [
    { lng: 117.984, lat: 30.004, look: 2, state: 2, left: true, sealed: false, size: 1, tilt: 3, ink: 0.8, x: 0, y: 0, fx: 0.5, fy: 0.5, tap: 1 },
    { lng: 117.985, lat: 30.003, look: 4, state: 0, left: false, sealed: true, size: 1, tilt: -3, ink: 0.9, x: 0, y: 0, fx: 0.6, fy: 0.4, tap: 2 },
  ],
  mine: { at: { lng: 117.9841, lat: 30.0041 }, look: "gugu", variant: "standL", color: "pink", sealed: true, size: 1.05, tilt: -2, ink: 0.9, brushFrom: null },
  tier: 3,
  innKey: "",
  inksKey: 0,
  mineKey: "",
};

describe("缘缘庄 on MapLibre", () => {
  it("is a style MapLibre takes, full or not", () => {
    for (const full of [false, true]) {
      const errors = validateStyleMin({ version: 8, sources: siSources(si), layers: siLayers(full) } as never);
      expect(errors.map((e) => e.message)).toEqual([]);
    }
    expect(validateStyleMin({ version: 8, sources: siSources(undefined), layers: siLayers(false) } as never)).toEqual([]);
  });

  it("draws each ink roach as it is, her seal on the ones whose 集章本 was full", () => {
    const inks = (siSources(si)["si-inks"] as { data: GeoJSON.FeatureCollection }).data.features;
    expect(inks.map((f) => f.properties?.icon)).toEqual(["si-ink-endmin-lieL", "si-ink-gugu-standR-sealed"]);
  });

  it("works out sizes on 高德 as MapLibre does from the same stops", () => {
    const at = (stops: [number, number][], base: number, z: number) => {
      const e = expression.createExpression(zoomExpr(stops, base));
      if (e.result !== "success") throw new Error("expression");
      return e.value.evaluate({ zoom: z });
    };
    for (const z of [2, 12.9, 13.2, 16.5, 17.3, 18.5, 19.7, 21]) {
      expect(interp(INK_SIZE, z, 2)).toBeCloseTo(at(INK_SIZE, 2, z) as number, 9);
      expect(interp(QUEUE_OPACITY, z)).toBeCloseTo(at(QUEUE_OPACITY, 1, z) as number, 9);
      expect(interp(BLOT_RADIUS, z)).toBeCloseTo(at(BLOT_RADIUS, 1, z) as number, 9);
    }
  });

  it("hangs the scroll to her right, rolled from afar and open close up, with butterflies round it", () => {
    expect(scrollAt(4)).toBeNull();
    expect(scrollAt(10)).toMatchObject({ open: false });
    const open = scrollAt(15)!;
    expect(open.open).toBe(true);
    expect(open.dx - open.w / 2).toBeGreaterThan(20);
    for (let i = 0; i < 3; i++) {
      for (const t of [null, 0, 1234, 98_765]) {
        const b = butterflyAt(i, t, SCROLL_OPEN_FROM);
        // round the scroll, never on her
        expect(Math.hypot(b.dx - open.dx, b.dy - open.dy)).toBeLessThan(open.h);
        expect(b.dx).toBeGreaterThan(0);
      }
    }
  });
});
