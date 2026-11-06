import { describe, expect, it } from "vitest";
import { chinaCover, clearOfChina, seesChina, viewAround } from "./chinaView";
import { inArea, area, type Ring } from "./shapes";

/** A phone's view of a city (MapLibre zoom 11 on a 375×812 screen) */
const city = (lng: number, lat: number, zoom = 11) => viewAround({ lng, lat }, zoom, 375, 812);

describe("where visitors from mainland China must see Amap", () => {
  it("leaves cities abroad to our own map", () => {
    const abroad = {
      seoul: [126.978, 37.5665],
      tokyo: [139.6917, 35.6895],
      bangkok: [100.5018, 13.7563],
      manila: [120.9842, 14.5995],
      hanoi: [105.8342, 21.0278],
      newDelhi: [77.209, 28.6139],
      kathmandu: [85.324, 27.7172],
      ulaanbaatar: [106.9057, 47.8864],
    };
    for (const [name, [lng, lat]] of Object.entries(abroad)) {
      expect([name, seesChina(city(lng, lat))]).toEqual([name, false]);
      expect([name, clearOfChina(city(lng, lat))]).toEqual([name, true]);
    }
  });

  it("keeps Amap wherever China as its standard map draws it is in view", () => {
    const china = {
      taipei: [121.5654, 25.033],
      hongKong: [114.1694, 22.3193],
      diaoyu: [123.47, 25.74],
      woodyIsland: [112.33, 16.83],
      fieryCross: [112.89, 9.55],
      scarborough: [117.75, 15.15],
      midSouthChinaSea: [114.0, 12.0],
      itanagar: [93.61, 27.08],
      aksaiChin: [79.4, 35.2],
    };
    for (const [name, [lng, lat]] of Object.entries(china)) expect([name, seesChina(city(lng, lat))]).toEqual([name, true]);
    // all of East Asia
    expect(seesChina(viewAround({ lng: 125, lat: 30 }, 3, 375, 812))).toBe(true);
  });

  it("copes with views across the 180° meridian, and does not flicker at the edge", () => {
    expect(seesChina([{ lng: 170, lat: -20 }, { lng: 200, lat: 20 }])).toBe(false);
    expect(seesChina([{ lng: 170, lat: -20 }, { lng: -160, lat: 20 }])).toBe(false);
    // across the meridian from Japan's east: China only once the view reaches back to Hunchun
    expect(seesChina([{ lng: 140, lat: 20 }, { lng: -170, lat: 45 }])).toBe(false);
    expect(seesChina([{ lng: 130, lat: 20 }, { lng: -170, lat: 45 }])).toBe(true);
    // and a view whose longitudes have run on past 180 the other way
    expect(seesChina([{ lng: -230, lat: 20 }, { lng: -190, lat: 45 }])).toBe(true);
    // Seoul zoomed out a little: just clear of China, but not clear enough to leave Amap for
    let zoom = 11;
    while (zoom > 3 && clearOfChina(city(126.978, 37.5665, zoom))) zoom -= 0.25;
    const edge = city(126.978, 37.5665, zoom);
    expect(clearOfChina(edge)).toBe(false);
    expect(seesChina(edge)).toBe(false);
  });

  it("covers China with rectangles that hold every cell", () => {
    const cover = chinaCover();
    const multi = cover.features[0].geometry as GeoJSON.MultiPolygon;
    const rings = multi.coordinates.map((p) => p[0] as Ring);
    expect(rings.length).toBeLessThan(800);
    const a = area(rings);
    for (const [lng, lat] of [
      [116.4, 39.9],
      [121.5654, 25.033],
      [112.33, 16.83],
      [93.61, 27.08],
    ]) {
      expect(inArea({ lng, lat }, a)).toBe(true);
    }
    expect(inArea({ lng: 126.978, lat: 37.5665 }, a)).toBe(false);
  });
});
