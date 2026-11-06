import { describe, expect, it } from "vitest";
import { distanceKm } from "./geo";
import {
  FIRE_AT,
  FIRE_RADIUS_M,
  fireCount,
  HER_SPOT_M,
  fireLevel,
  handshakeLine,
  pickSeat,
  ringRadius,
  ringSeats,
  ringSpots,
  SEAT_TAKEN_M,
  talulahText,
  talulahTouchLine,
} from "./talulah";

const M_PER_DEG = 111_320;
/** A spot so many metres east and north of the fire */
const at = (x: number, y: number) => ({
  lng: FIRE_AT.lng + x / (M_PER_DEG * Math.cos((FIRE_AT.lat * Math.PI) / 180)),
  lat: FIRE_AT.lat + y / M_PER_DEG,
});
const metres = (p: { lng: number; lat: number }) => distanceKm(p, FIRE_AT) * 1000;

/** Every seat of the rings up to k, as roaches sitting on them */
const fill = (rings: number) =>
  Array.from({ length: rings }, (_, k) => ringSpots(k).map((s) => at(s.x, s.y))).flat();

describe("塔露拉干员's fire", () => {
  it("counts real players' roaches within 300 m, never show roaches", () => {
    const roaches = [at(0, 0), at(299, 0), at(0, -295), at(305, 0), { ...at(10, 10), bot: true as const }];
    expect(fireCount(roaches)).toBe(3);
    expect(fireCount([])).toBe(0);
  });

  it("burns in four sizes, from 10, 50 and 200 roaches", () => {
    expect([0, 9, 10, 49, 50, 199, 200, 5000].map(fireLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("lays its seats out in rings 15 m apart, each seat about 15 m from the next", () => {
    expect([0, 1, 2].map(ringRadius)).toEqual([10, 25, 40]);
    expect([0, 1, 2].map(ringSeats)).toEqual([4, 10, 16]);
    for (const k of [0, 1, 5]) {
      const spots = ringSpots(k);
      expect(spots).toHaveLength(ringSeats(k));
      for (const s of spots) expect(Math.hypot(s.x, s.y)).toBeCloseTo(ringRadius(k), 6);
      // 15 m apart along the ring, a little less in a straight line
      expect(Math.hypot(spots[0].x - spots[1].x, spots[0].y - spots[1].y)).toBeGreaterThan(14);
    }
  });

  it("seats the next roach in the innermost ring with room, never by another roach", () => {
    let flip = 0;
    const random = () => (flip++ % 7) / 7;
    // nobody yet: the first ring
    expect(metres(pickSeat([], random))).toBeGreaterThan(10 - 2);
    expect(metres(pickSeat([], random))).toBeLessThan(10 + 2);
    // the first ring full: the second
    const one = pickSeat(fill(1), random);
    expect(Math.abs(metres(one) - 25)).toBeLessThan(2);
    // two rings full and one seat of the third taken: anywhere else in the third
    const third = ringSpots(2).map((s) => at(s.x, s.y));
    const taken = [...fill(2), third[0]];
    for (let i = 0; i < 30; i++) {
      const seat = pickSeat(taken);
      expect(Math.abs(metres(seat) - 40)).toBeLessThan(2);
      expect(taken.every((r) => distanceKm(r, seat) * 1000 >= SEAT_TAKEN_M - 1.5)).toBe(true);
    }
    // never behind her, where nobody would see them
    for (let i = 0; i < 100; i++) {
      const seat = pickSeat([]);
      const x = (seat.lng - FIRE_AT.lng) * M_PER_DEG * Math.cos((FIRE_AT.lat * Math.PI) / 180);
      const y = (seat.lat - FIRE_AT.lat) * M_PER_DEG;
      expect(Math.hypot(x - HER_SPOT_M.x, y - HER_SPOT_M.y)).toBeGreaterThan(HER_SPOT_M.r - 1.5);
    }
    // every seat within 300 m taken: on outwards, where they no longer count
    const all = fill(20);
    expect(ringRadius(19)).toBeLessThanOrEqual(FIRE_RADIUS_M);
    expect(metres(pickSeat(all))).toBeGreaterThan(FIRE_RADIUS_M);
  });

  it("says 博士 only in the handshake, and 管理员 to those who play only Endfield", () => {
    const doctor = "你好！终于见到你了，罗德岛的博士，我很荣幸。重新认识一下，塔露拉·雅特利亚斯，一名来自乌萨斯的感染者。来，握个手吧。";
    expect(handshakeLine(["arknights"])).toBe(doctor);
    expect(handshakeLine(["arknights", "endfield"])).toBe(doctor);
    expect(handshakeLine([])).toBe(doctor);
    expect(handshakeLine(["endfield"])).toMatch(/^你好！终于见到你了，管理员，我很荣幸。/);
    expect(talulahTouchLine("touch", false, [])).toBe("我看见你了。不用躲，过来坐吧，火边暖和。");
    expect(talulahTouchLine("touch", true, ["endfield"])).toBe("来得正好，火刚添过柴。");
    expect(talulahText({ line: "touch", bold: true }, [])).toBe("塔露拉干员回了你：「来得正好，火刚添过柴。」");
    expect(talulahText({ line: "welcome", bold: false }, [])).toBe(
      "你的克隆体坐到了火边，塔露拉干员说：「一起在篝火边休息一下吧。」",
    );
    expect(talulahText({ line: "handshake", bold: true }, ["endfield"])).toMatch(/^塔露拉干员和你握了握手：「你好！终于见到你了，管理员/);
    expect(talulahText({ line: "birthday", bold: false }, [])).toMatch(/除了晖洁的生日，现在我也记住你的了。」$/);
  });
});
