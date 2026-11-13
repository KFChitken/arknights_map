import { describe, expect, it } from "vitest";
import type { LngLat } from "../types";
import { countPlayers, drawnWith, inkDrawn } from "./onlyMains";
import type { MapRoach } from "./types";

const roach = (id: string, at: LngLat, more: Partial<MapRoach> = {}): MapRoach => ({ id, ...at, clone: false, avatar: "hood", color: "cyan", ...more });
const SHANGHAI: [LngLat, LngLat] = [
  { lng: 121, lat: 31 },
  { lng: 122, lat: 32 },
];

describe("只看本体 on the page", () => {
  it("draws every roach while off; while on, others' clones are left out, 触须之交's kept", () => {
    const main = { clone: false };
    const clone = { clone: true };
    expect([drawnWith(main, false, false), drawnWith(clone, false, false), drawnWith(clone, true, false)]).toEqual([true, true, true]);
    expect([drawnWith(main, false, true), drawnWith(clone, false, true), drawnWith(clone, true, true), drawnWith(main, true, true)]).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it("draws 祀's ink roaches but your own (drawn apart); with 只看本体 on, your 触须之交's only", () => {
    const taps = [1, 2, 3];
    expect(taps.filter((t) => inkDrawn(t, null, null))).toEqual([1, 2, 3]);
    expect(taps.filter((t) => inkDrawn(t, 2, null))).toEqual([1, 3]);
    expect(taps.filter((t) => inkDrawn(t, 2, new Set([2, 3])))).toEqual([3]);
    expect(taps.filter((t) => inkDrawn(t, null, new Set()))).toEqual([]);
  });

  it("counts players close up as the main roaches in view, the player's own too, clones and show roaches never", () => {
    const drawn = [
      roach("a", { lng: 121.47, lat: 31.23 }),
      roach("b", { lng: 121.3, lat: 31.1 }),
      // a 触须之交's clone, drawn but nobody more
      { ...roach("c", { lng: 121.31, lat: 31.11 }, { clone: true }), friend: true },
      roach("bot", { lng: 121.32, lat: 31.12 }, { bot: true }),
      // out of view
      roach("d", { lng: 139.7, lat: 35.68 }),
    ];
    const own = [
      { lng: 121.5, lat: 31.5, slot: 0 },
      { lng: 121.6, lat: 31.6, slot: 1 },
    ];
    expect(countPlayers(drawn, SHANGHAI, false, own)).toBe(3);
    expect(countPlayers(drawn, SHANGHAI, false, [])).toBe(2);
    // the main roach out of view: only others'
    expect(countPlayers(drawn, SHANGHAI, false, [{ lng: 139.7, lat: 35.68, slot: 0 }])).toBe(2);
  });

  it("counts the overview by what each of its roaches stands for, 触须之交's drawn besides (n 0) as nobody", () => {
    const drawn = [
      roach("a", { lng: 121.47, lat: 31.23 }, { n: 5 }),
      roach("b", { lng: 121.3, lat: 31.1 }),
      { ...roach("c", { lng: 121.31, lat: 31.11 }, { clone: true, n: 0 }), friend: true },
      roach("d", { lng: 139.7, lat: 35.68 }, { n: 7 }),
    ];
    // the player's own are among their squares' already
    expect(countPlayers(drawn, SHANGHAI, true, [{ lng: 121.5, lat: 31.5, slot: 0 }])).toBe(6);
    // across the 180° meridian
    const fiji: [LngLat, LngLat] = [
      { lng: 179, lat: -18 },
      { lng: -179, lat: -16 },
    ];
    expect(countPlayers([roach("e", { lng: 179.5, lat: -17 }, { n: 2 }), roach("f", { lng: -179.5, lat: -17 })], fiji, true, [])).toBe(3);
  });
});
