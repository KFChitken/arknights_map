import { describe, expect, it } from "vitest";
import { AMIYA_AT } from "./amiya";
import { distanceKm } from "./geo";
import { queueSpots, ROUTE } from "./minghe";
import { isOffLimits, OFF_LIMITS, OFF_LIMITS_REACH, offLimitsAt, outsideOffLimits } from "./offLimits";
import { mulberry32 } from "./prng";
import { FIRE_AT, FIRE_RADIUS_M, pickSeat } from "./talulah";
import type { LngLat } from "./types";

const at = (lng: number, lat: number): LngLat => ({ lng, lat });
const metres = (a: LngLat, b: LngLat) => distanceKm(a, b) * 1000;

describe("禁放的地方", () => {
  it("hold the sites themselves, read in WGS-84", () => {
    const inside: [string, LngLat][] = [
      ["tiananmen", at(116.3915, 39.9011)], // the Mausoleum
      ["tiananmen", at(116.3913, 39.9031)], // the Monument
      ["tiananmen", at(116.3912, 39.908)], // the gate, its front
      ["tiananmen", at(116.3912, 39.9091)], // and its back
      ["tiananmen", at(116.3875, 39.9035)], // the Great Hall
      ["zhongnanhai", at(116.3815, 39.9065)], // Xinhua Gate
      ["zhongnanhai", at(116.38, 39.915)],
      ["babaoshan-cemetery", at(116.2235, 39.9083)],
      ["lugou-bridge", at(116.2129, 39.849)],
      ["lugou-bridge", at(116.2198, 39.8509)],
      ["nanjing-massacre-memorial", at(118.738, 32.0374)],
      ["yuhuatai", at(118.7735, 32.0036)],
      ["sun-yat-sen-mausoleum", at(118.8483, 32.0644)],
      ["first-cpc-congress-site", at(121.4708, 31.2221)],
      ["shaoshan", at(112.4864, 27.9086)], // the former residence, as two sources put it
      ["shaoshan", at(112.4948, 27.9098)], // and as a third does
      ["shaoshan", at(112.5006, 27.9096)], // the memorial hall
      ["september-18-museum", at(123.4604, 41.8322)],
      ["unit-731-site", at(126.6335, 45.6069)],
    ];
    for (const [id, p] of inside) expect(offLimitsAt(p), `${id} ${p.lng},${p.lat}`).toBe(id);
  });

  it("leave the places around them alone", () => {
    const outside = [
      at(116.3836, 39.903), // the National Centre for the Performing Arts
      at(116.3875, 39.909), // Zhongshan Park
      at(116.3913, 39.9135), // the Meridian Gate of the Palace Museum
      at(116.388, 39.9245), // Beihai Park's south gate
      at(116.3929, 39.8983), // Qianmen station
      at(116.4103, 39.9139), // Wangfujing
      at(116.4, 39.9),
      at(116.2297, 39.9062), // Babaoshan station
      at(121.4745, 31.2195), // Xintiandi, south block
      at(121.4737, 31.2304), // People's Square, Shanghai
      at(121.4856, 31.2393), // the Bund
      at(139.7, 35.68),
    ];
    for (const p of outside) expect(offLimitsAt(p), `${p.lng},${p.lat}`).toBeNull();
  });

  it("each hold their own middle, within the reach the server looks through", () => {
    for (const [i, r] of OFF_LIMITS_REACH.entries()) {
      expect(r.id).toBe(OFF_LIMITS[i].id);
      expect(offLimitsAt(r.at)).toBe(r.id);
      expect(isOffLimits(at(r.at.lng, r.at.lat + (r.m * 1.02) / 111_320))).toBe(false);
    }
  });

  it("are not where the site puts anyone itself", () => {
    expect(isOffLimits(AMIYA_AT)).toBe(false);
    for (const p of OFF_LIMITS_REACH) expect(metres(p.at, FIRE_AT)).toBeGreaterThan(p.m + FIRE_RADIUS_M);
    for (const s of ROUTE) expect(isOffLimits(s.at), s.name).toBe(false);
  });
});

describe("outsideOffLimits", () => {
  it("leaves an allowed spot as it is", () => {
    const p = at(121.4737, 31.2304);
    expect(outsideOffLimits(p)).toBe(p);
  });

  it("takes a spot inside out the short way, a little past the edge", () => {
    const random = mulberry32(7);
    for (const place of OFF_LIMITS_REACH) {
      // a spread of spots inside the place
      for (let i = 0; i < 40; i++) {
        const a = random() * 2 * Math.PI;
        const d = random() * place.m;
        const p = at(place.at.lng + (d * Math.sin(a)) / (111_320 * Math.cos((place.at.lat * Math.PI) / 180)), place.at.lat + (d * Math.cos(a)) / 111_320);
        if (!isOffLimits(p)) continue;
        const q = outsideOffLimits(p, random);
        expect(isOffLimits(q)).toBe(false);
        // never further than across the place and the 300 m past it, with room for the sideways turn
        expect(metres(p, q)).toBeLessThan(2 * place.m + 350);
      }
    }
  });

  it("spreads the roaches of one spot instead of piling them up", () => {
    const random = mulberry32(11);
    const mausoleum = at(116.3915, 39.9011);
    const moved = Array.from({ length: 100 }, () => outsideOffLimits(mausoleum, random));
    // apart by 5 m or more, in pairs
    let close = 0;
    for (let i = 0; i < moved.length; i++) for (let j = i + 1; j < moved.length; j++) if (metres(moved[i], moved[j]) < 5) close++;
    expect(close).toBeLessThan(10);
    const far = moved.map((q) => metres(mausoleum, q));
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(150);
  });
});

describe("座位和排队", () => {
  it("never seats a guest inside, even by a roach on the edge", () => {
    // just east of the square, across the street from the National Museum
    const host = at(116.3979, 39.903);
    expect(isOffLimits(host)).toBe(false);
    const random = mulberry32(3);
    const taken: LngLat[] = [];
    for (let i = 0; i < 60; i++) {
      const seat = pickSeat(taken, random, { center: host });
      expect(isOffLimits(seat)).toBe(false);
      expect(metres(seat, host)).toBeLessThan(150);
      taken.push(seat);
    }
  });

  it("keeps 明河都尉's queues out, however long they grow", () => {
    for (let stop = 0; stop < ROUTE.length; stop++) {
      expect(queueSpots(stop, 3000).some(isOffLimits), ROUTE[stop].name).toBe(false);
    }
  });
});
