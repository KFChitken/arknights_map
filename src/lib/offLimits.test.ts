import { describe, expect, it } from "vitest";
import { AMIYA_AT } from "./amiya";
import { distanceKm } from "./geo";
import { queueSpots, ROUTE } from "./minghe";
import { isOffLimits, OFF_LIMITS, OFF_LIMITS_REACH, offLimitsAt, offLimitsReach, outsideOffLimits, setExtraOffLimits } from "./offLimits";
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
      // the later ones, at the sites' own buildings and monuments as OpenStreetMap has them
      ["longhua-martyrs-cemetery", at(121.4447, 31.1775)],
      ["longhua-martyrs-cemetery", at(121.4463, 31.1808)], // the execution ground
      ["guangzhou-uprising-cemetery", at(113.2806, 23.1316)],
      ["huanghuagang-cemetery", at(113.2892, 23.1433)], // the memorial to the 72 martyrs
      ["huanghuagang-cemetery", at(113.2901, 23.1438)], // the tombs of the 1911 Revolution's martyrs
      ["gele-mountain-martyrs-cemetery", at(106.4382, 29.5748)],
      ["zhazidong-prison", at(106.4285, 29.5887)],
      ["baigongguan-prison", at(106.4281, 29.5792)],
      ["north-china-martyrs-cemetery", at(114.4595, 38.0443)], // its memorial hall
      ["shenyang-korean-war-cemetery", at(123.4456, 41.8527)],
      ["dandong-korean-war-museum", at(124.3597, 40.1174)],
      ["dandong-korean-war-museum", at(124.3586, 40.1162)], // the tower
      ["northeast-martyrs-museum", at(126.6367, 45.7642)],
      ["yang-jingyu-cemetery", at(125.9564, 41.7272)],
      ["langya-mountain-peak", at(115.1702, 39.1374)],
      ["langya-mountain-museum", at(115.1791, 39.1333)],
      ["qiu-shaoyun-memorial", at(106.0476, 29.8503)],
      ["huang-jiguang-memorial", at(104.6805, 31.0373)],
      ["dong-cunrui-cemetery", at(117.724, 41.3225)],
      ["dong-cunrui-cemetery", at(117.7216, 41.3196)], // where he fell
      ["liu-hulan-memorial", at(112.1917, 37.393)],
      ["lei-feng-memorial", at(123.7975, 41.8487)], // his tomb
      ["south-lake-island", at(120.7559, 30.7575)],
      ["south-lake-memorial", at(120.7569, 30.7499)],
      ["south-lake-old-memorial", at(120.7573, 30.7603)],
      ["jinggang-martyrs-cemetery", at(114.1605, 26.5799)],
      ["jinggang-martyrs-cemetery", at(114.1624, 26.5747)], // the martyrs' tomb
      ["jinggang-revolution-museum", at(114.1602, 26.571)],
      ["zunyi-conference-site", at(106.9169, 27.692)],
      ["baota-hill", at(109.4923, 36.593)], // the pagoda
      ["zaoyuan", at(109.4146, 36.6271)],
      ["yangjialing", at(109.4633, 36.6194)],
      ["wangjiaping", at(109.4752, 36.6074)],
      ["wangjiaping", at(109.4719, 36.6095)], // the Yan'an Revolutionary Memorial Hall
      ["xibaipo", at(113.935, 38.3398)],
      ["ruijin-yeping", at(116.0677, 25.9094)], // the provisional central government
      ["ruijin-red-well", at(116.0062, 25.8869)],
      ["ruijin-second-congress", at(115.9946, 25.8861)],
      ["ruijin-soviet-memorial-park", at(116.0096, 25.8764)],
      ["gutian-conference-site", at(116.8215, 25.2196)],
      ["gutian-conference-museum", at(116.8182, 25.2248)],
      ["nanchang-uprising-museum", at(115.8846, 28.6781)],
      ["zhou-enlai-memorial", at(119.1444, 33.5172)],
      ["zhou-enlai-residence", at(119.1369, 33.5084)],
      ["deng-xiaoping-hometown", at(106.6327, 30.5219)],
      ["liu-shaoqi-hometown", at(112.6409, 28.0387)],
      ["zhu-de-residence", at(106.6071, 31.4722)],
      ["zhu-de-birthplace", at(106.5969, 31.4642)],
      ["pingdingshan-massacre-memorial", at(123.9208, 41.8321)],
      ["chongqing-tunnel-massacre-site", at(106.5699, 29.5555)],
      ["songhu-war-memorial", at(121.4907, 31.412)],
      ["taierzhuang-memorial", at(117.7258, 34.5582)],
      ["pingxing-pass-victory-site", at(113.9675, 39.3433)],
      ["hundred-regiments-memorial", at(113.5246, 37.8512)], // the monument
      ["lushun-wanzhong-tomb", at(121.2564, 38.8163)],
      ["lushun-prison", at(121.2599, 38.8246)],
      ["lijixiang-comfort-station", at(118.7925, 32.0411)],
      ["yingxiu-quake-memorial", at(103.4866, 31.0575)], // the Xuankou Middle School ruins
      ["yingxiu-quake-memorial", at(103.4844, 31.0578)], // the victims' cemetery
      ["old-beichuan-quake-ruins", at(104.453, 31.8256)],
      ["beichuan-quake-museum", at(104.4476, 31.8127)],
      ["tangshan-quake-memorial-park", at(118.1805, 39.5961)],
      ["yellow-emperor-mausoleum", at(109.2671, 35.5859)], // Qiao Mountain
      ["yellow-emperor-mausoleum", at(109.27, 35.5861)], // the temple's main hall
    ];
    for (const [id, p] of inside) expect(offLimitsAt(p), `${id} ${p.lng},${p.lat}`).toBe(id);
    // every place has a spot of its own here
    for (const { id } of OFF_LIMITS) expect(inside.some(([i]) => i === id), id).toBe(true);
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
      // and round the later ones
      at(113.291, 23.1404), // Huanghuagang police station, across Xianlie Middle Road from the cemetery
      at(113.2884, 23.1392), // a community health centre south of Huanghuagang
      at(115.9934, 25.8848), // Shazhouba town, Ruijin
      at(116.0088, 25.8902), // Hongjing primary school, Ruijin
      at(116.0729, 25.9125), // Yeping middle school, Ruijin
      at(116.8176, 25.2226), // a hotel in Gutian
      at(115.8997, 28.676), // the Bayi Square monument, Nanchang
      at(119.1479, 33.5169), // a school by the Zhou Enlai Memorial Hall
      at(119.1478, 33.5209), // a hospital by it
      at(109.4584, 36.6206), // Yan'an University's Yangjialing campus
      at(109.4919, 36.6001), // below Baota Hill
      at(113.9344, 38.3531), // Xibaipo town
      at(112.189, 37.3966), // Liuhulan town
      at(112.6292, 28.0454), // Huaminglou town
      at(104.6832, 31.0299), // a primary school by the Huang Jiguang Memorial Hall
      at(123.7931, 41.847), // a primary school by the Lei Feng Memorial Hall
      at(121.2578, 38.8153), // Lushun bus station
      at(103.4796, 31.0499), // Yingxiu middle school
      at(118.1763, 39.6231), // the Anti-Earthquake Monument, Tangshan
      at(109.2596, 35.5829), // Huangling town
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
      // the places near enough to be walked into on the way out, and on through
      const across = OFF_LIMITS_REACH.filter((o) => o !== place && metres(o.at, place.at) - o.m < 3 * place.m + 310).reduce((sum, o) => sum + 2 * o.m, 0);
      // a spread of spots inside the place
      for (let i = 0; i < 40; i++) {
        const a = random() * 2 * Math.PI;
        const d = random() * place.m;
        const p = at(place.at.lng + (d * Math.sin(a)) / (111_320 * Math.cos((place.at.lat * Math.PI) / 180)), place.at.lat + (d * Math.cos(a)) / 111_320);
        if (!isOffLimits(p)) continue;
        const q = outsideOffLimits(p, random);
        expect(isOffLimits(q)).toBe(false);
        // never further than across the place and the 300 m past it, with room for the sideways turn,
        // and across those
        expect(metres(p, q)).toBeLessThan(2 * place.m + 350 + across);
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

describe("站长圈的地方", () => {
  // a park in Chengdu, far from any place in the code
  const MIDDLE = at(104.0657, 30.6595);
  const zone = { id: "zone:test", at: MIDDLE, m: 200 };

  it("are refused, walked round and looked through like the code's, until they are lifted", () => {
    try {
      expect(isOffLimits(MIDDLE)).toBe(false);
      setExtraOffLimits([zone]);
      expect(offLimitsAt(MIDDLE)).toBe("zone:test");
      // 150 m east of the middle is inside, 250 m east is not
      const east = (m: number) => at(MIDDLE.lng + m / (111_320 * Math.cos((MIDDLE.lat * Math.PI) / 180)), MIDDLE.lat);
      expect(isOffLimits(east(150))).toBe(true);
      expect(isOffLimits(east(250))).toBe(false);
      const out = outsideOffLimits(MIDDLE, mulberry32(3));
      expect(isOffLimits(out)).toBe(false);
      // out past the edge, by 60 to 300 m
      expect(metres(out, MIDDLE)).toBeGreaterThan(200 + 55);
      expect(metres(out, MIDDLE)).toBeLessThan(200 + 310);
      expect(offLimitsReach()).toEqual([...OFF_LIMITS_REACH, zone]);
      // the code's places all the same
      expect(offLimitsAt(at(116.3915, 39.9011))).toBe("tiananmen");

      setExtraOffLimits([]);
      expect(isOffLimits(MIDDLE)).toBe(false);
      expect(offLimitsReach()).toEqual(OFF_LIMITS_REACH);
    } finally {
      setExtraOffLimits([]);
    }
  });

  it("are left by the shortest way out of two that overlap, a big one included", () => {
    try {
      setExtraOffLimits([
        { id: "zone:a", at: MIDDLE, m: 3000 },
        { id: "zone:b", at: at(MIDDLE.lng + 0.04, MIDDLE.lat), m: 3000 },
      ]);
      const out = outsideOffLimits(at(MIDDLE.lng + 0.02, MIDDLE.lat), mulberry32(8));
      expect(isOffLimits(out)).toBe(false);
    } finally {
      setExtraOffLimits([]);
    }
  });
});
