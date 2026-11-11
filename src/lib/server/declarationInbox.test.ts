import { describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import { cellsNear, spotCell } from "./declarationInbox";

/** Where one gets going `km` from a place on a bearing (degrees), on a sphere */
function away(p: { lng: number; lat: number }, km: number, bearing: number) {
  const R = 6371;
  const d = km / R;
  const b = (bearing * Math.PI) / 180;
  const lat1 = (p.lat * Math.PI) / 180;
  const lng1 = (p.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lng: ((((lng2 * 180) / Math.PI + 540) % 360) - 180), lat: (lat2 * 180) / Math.PI };
}

describe("the squares of the map declarations are kept by", () => {
  it("reach every spot within 10 km of a place, anywhere from the equator to the far north and across ±180°", () => {
    const rand = mulberry32(20261111);
    const places = [
      { lng: 121.4737, lat: 31.2304 },
      { lng: 179.97, lat: 0 },
      { lng: -179.99, lat: 64.8 },
      { lng: 0, lat: -33.9 },
      { lng: 18.06, lat: 59.33 },
      ...Array.from({ length: 200 }, () => ({ lng: rand() * 360 - 180, lat: rand() * 150 - 75 })),
    ];
    for (const p of places) {
      const cells = new Set(cellsNear([p]));
      for (let i = 0; i < 64; i++) {
        const spot = away(p, 9.999 * Math.sqrt(rand()), rand() * 360);
        expect(cells.has(spotCell(spot)), `${JSON.stringify(spot)} from ${JSON.stringify(p)}`).toBe(true);
      }
      // and not many more: at most 3 rows, and as many columns as the circle is wide, plus one
      const wide = (2 * 10) / (111.195 * Math.cos((Math.min(89, Math.abs(p.lat) + 0.1) * Math.PI) / 180));
      expect(cells.size).toBeLessThanOrEqual(3 * (Math.ceil(wide / 0.1) + 1));
    }
  });

  it("puts a spot in one square, the same for the same place", () => {
    expect(spotCell({ lng: 121.4737, lat: 31.2304 })).toBe(spotCell({ lng: 121.4799, lat: 31.2001 }));
    expect(spotCell({ lng: 121.4737, lat: 31.2304 })).not.toBe(spotCell({ lng: 121.5001, lat: 31.2304 }));
    expect(spotCell({ lng: 180, lat: 0 })).toBe(spotCell({ lng: -180, lat: 0 }));
  });
});
