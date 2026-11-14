import { describe, expect, it } from "vitest";
import {
  byDistance,
  nearestOf,
  slidTo,
  STACK_ABOVE_PX,
  STACK_GAP_PX,
  STACK_ROWS,
  STACK_TOP_PX,
  stackPick,
  stackRows,
  stackSlide,
} from "./stackPick";
import { screenDelta } from "./touchArt";

const near = (...ds: number[]) => ds.map((d, i) => ({ ref: `r${i}`, d }));

describe("a tap on roaches drawn on top of each other", () => {
  it("opens nothing on none, and the one on one", () => {
    expect(stackPick(near())).toBeNull();
    expect(nearestOf(near())).toBeNull();
    expect(stackPick(near(7))).toBeNull();
    expect(nearestOf(near(7))).toBe("r0");
  });

  it("offers two to pick from while the nearer is less than 10 px nearer, nearest first", () => {
    expect(stackPick(near(9, 3))).toEqual(["r1", "r0"]);
    expect(stackPick(near(0, 0))).toEqual(["r0", "r1"]);
    expect(stackPick(near(4, 4 + STACK_GAP_PX - 0.01))).toEqual(["r0", "r1"]);
  });

  it("opens the nearer of two at 10 px nearer or more", () => {
    expect(STACK_GAP_PX).toBe(10);
    expect(stackPick(near(4, 14))).toBeNull();
    expect(stackPick(near(16, 2))).toBeNull();
    expect(nearestOf(near(16, 2))).toBe("r1");
  });

  it("goes by the nearest two of many, and offers them all", () => {
    // the nearest two 4 px apart: all six, nearest first, however far the rest are
    const many = near(30, 2, 17, 6, 25, 11);
    expect(stackPick(many)).toEqual(["r1", "r3", "r5", "r2", "r4", "r0"]);
    // the nearest well clear of the next: just that one
    expect(stackPick(near(30, 1, 17, 12, 25))).toBeNull();
    expect(nearestOf(near(30, 1, 17, 12, 25))).toBe("r1");
  });

  it("keeps the order given among those as near", () => {
    expect(byDistance(near(5, 5, 1, 5)).map((n) => n.ref)).toEqual(["r2", "r0", "r1", "r3"]);
    expect(nearestOf(near(5, 5))).toBe("r0");
  });

  it("lists eight and counts the rest", () => {
    expect(STACK_ROWS).toBe(8);
    expect(stackRows(2)).toEqual({ rows: 2, more: 0 });
    expect(stackRows(8)).toEqual({ rows: 8, more: 0 });
    expect(stackRows(23)).toEqual({ rows: 8, more: 15 });
  });
});

describe("the map as the list opens", () => {
  // a phone (390 × 844) at 上海, the list along the bottom from 329 px down
  const size = { w: 390, h: 844 };
  const view = { lng: 121.47, lat: 31.23, zoom: 15 };
  const list = { top: 329, bottom: 748, left: 12, right: 378 };
  // where a spot shows on the map (px from its top left)
  const shown = (v: typeof view, at: { lng: number; lat: number }) => {
    const d = screenDelta(v, at, v.zoom);
    return { x: size.w / 2 + d.x, y: size.h / 2 + d.y };
  };
  // the spot shown y px down the middle of the map, halving the way to it
  const spotAt = (y: number) => {
    let [south, north] = [view.lat - 0.1, view.lat + 0.1];
    for (let i = 0; i < 60; i++) {
      const lat = (south + north) / 2;
      if (shown(view, { lng: view.lng, lat }).y > y) south = lat;
      else north = lat;
    }
    return { lng: view.lng, lat: (south + north) / 2 };
  };

  it("slides straight up till what lies under the tap is 56 px above the list", () => {
    expect(STACK_ABOVE_PX).toBe(56);
    const at = spotAt(422);
    const to = stackSlide(view, at, size, list);
    expect(to).not.toBeNull();
    expect(to!.lng).toBe(view.lng);
    expect(to!.zoom).toBe(view.zoom);
    expect(to!.lat).toBeLessThan(view.lat);
    const now = shown(to!, at);
    expect(now.x).toBeCloseTo(195, 6);
    expect(now.y).toBeCloseTo(329 - 56, 3);
    // far down the list too, or at its foot
    expect(shown(stackSlide(view, spotAt(740), size, list)!, spotAt(740)).y).toBeCloseTo(273, 3);
  });

  it("goes no higher than 90 px down the map, however tall the list", () => {
    expect(STACK_TOP_PX).toBe(90);
    const tall = { ...list, top: 120 };
    const at = spotAt(422);
    expect(shown(stackSlide(view, at, size, tall)!, at).y).toBeCloseTo(90, 3);
    // up there already: left as it is
    expect(stackSlide(view, spotAt(95), size, tall)).toBeNull();
  });

  it("leaves the map be when the list does not hide it", () => {
    // 56 px or more above the list, or nearly
    expect(stackSlide(view, spotAt(273), size, list)).toBeNull();
    expect(stackSlide(view, spotAt(279), size, list)).toBeNull();
    expect(stackSlide(view, spotAt(290), size, list)).not.toBeNull();
    // below it
    expect(stackSlide(view, spotAt(790), size, list)).toBeNull();
    // beside it: a list in the middle of a wide screen
    const desk = { w: 1280, h: 800 };
    const mid = { top: 285, bottom: 704, left: 430, right: 850 };
    const left = { lng: view.lng - (300 / (512 * 2 ** view.zoom)) * 360, lat: view.lat };
    expect(stackSlide(view, left, desk, mid)).toBeNull();
    const under = { lng: view.lng, lat: view.lat };
    expect(stackSlide(view, under, desk, mid)).not.toBeNull();
  });

  it("knows the map came to rest where it slid it", () => {
    const to = stackSlide(view, spotAt(422), size, list)!;
    expect(slidTo(to, to)).toBe(true);
    expect(slidTo({ ...to, lat: to.lat + 2e-6 }, to)).toBe(true);
    // moved on by a finger, or zoomed
    expect(slidTo({ ...to, lat: to.lat + 1e-4 }, to)).toBe(false);
    expect(slidTo({ ...to, lng: to.lng + 1e-4 }, to)).toBe(false);
    expect(slidTo({ ...to, zoom: to.zoom + 1 }, to)).toBe(false);
  });
});
