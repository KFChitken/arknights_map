import { describe, expect, it } from "vitest";
import type { InkPoint } from "@/lib/siTiles";
import { inkTappedAt } from "./inkTap";
import { INK_PX, INK_SIZE, interp, NEAR_FROM } from "./siLook";
import type { SiMapData } from "./types";

const ink = (lng: number, size = 1, tap = 7): InkPoint => ({ lng, lat: 30, look: 0, state: 1, left: false, size, tilt: 0, ink: 0.8, x: 0, y: 0, fx: 0, fy: 0, tap });
const si = (inks: InkPoint[], mineAt: number | null = null): SiMapData => ({
  inn: null,
  inks,
  mine: mineAt === null ? null : { at: { lng: mineAt, lat: 30 }, look: "hood", variant: "standL", color: "cyan", size: 1, tilt: 0, ink: 0.9, brushFrom: null },
  tier: 0,
  innKey: "",
  inksKey: 0,
  mineKey: "",
});
// a flat screen: a thousandth of a degree east is 100 px, everything at y = 500 (the feet)
const toScreen = (p: { lng: number; lat: number }) => ({ x: (p.lng - 118) * 100_000, y: 500 });
const Z = 19;
const h = INK_PX * interp(INK_SIZE, Z, 2);

describe("a tap on 缘缘庄's ink roaches", () => {
  it("is on one close up only, measured from the middle of its figure, which stands up from its feet", () => {
    const one = ink(118.001);
    expect(inkTappedAt(si([one]), Z, { x: 100, y: 500 - h / 2 }, toScreen)).toEqual({ kind: "other", ink: one });
    // just above its feet, about half its height from the middle: still on it; a little below them, not
    expect(inkTappedAt(si([one]), Z, { x: 100, y: 499.5 }, toScreen)).toEqual({ kind: "other", ink: one });
    expect(inkTappedAt(si([one]), Z, { x: 100, y: 500 + 13 }, toScreen)).toBeNull();
    // from afar they are drawn as one, and taken no tap
    expect(inkTappedAt(si([one]), NEAR_FROM - 0.01, { x: 100, y: 500 - h / 2 }, toScreen)).toBeNull();
    expect(inkTappedAt(undefined, Z, { x: 100, y: 500 }, toScreen)).toBeNull();
  });

  it("takes a fingertip's width however small one is drawn, and the nearest of two", () => {
    const small = ink(118.001, 0.2);
    expect(inkTappedAt(si([small]), NEAR_FROM, { x: 110, y: 500 }, toScreen)).toEqual({ kind: "other", ink: small });
    expect(inkTappedAt(si([small]), NEAR_FROM, { x: 113, y: 500 }, toScreen)).toBeNull();
    const a = ink(118.001, 1, 1);
    const b = ink(118.0012, 1, 2);
    expect(inkTappedAt(si([a, b]), Z, { x: 112, y: 500 - h / 2 }, toScreen)).toEqual({ kind: "other", ink: b });
    expect(inkTappedAt(si([b, a]), Z, { x: 108, y: 500 - h / 2 }, toScreen)).toEqual({ kind: "other", ink: a });
  });

  it("is on your own first, drawn over the others", () => {
    const other = ink(118.001);
    expect(inkTappedAt(si([other], 118.0011), Z, { x: 105, y: 500 - h / 2 }, toScreen)).toEqual({ kind: "mine" });
    // off the screen (behind the globe): never
    expect(inkTappedAt(si([other]), Z, { x: 100, y: 500 }, () => null)).toBeNull();
  });
});
