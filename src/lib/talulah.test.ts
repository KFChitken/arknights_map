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
  unstack,
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

describe("roaches stacked by the fire, spread out", () => {
  /** A seat of ring k as a spot, nudged so many metres east and north */
  const seat = (k: number, i: number, dx = 0, dy = 0) => {
    const s = ringSpots(k)[i];
    return at(s.x + dx, s.y + dy);
  };
  const apart = (p: { lng: number; lat: number }, q: { lng: number; lat: number }) => distanceKm(p, q) * 1000;
  /** Where everyone is once the ones unstack moves have moved */
  const after = (roaches: { id: string; lng: number; lat: number; stays?: boolean }[], to: Map<string, { lng: number; lat: number }>) =>
    roaches.map((r) => ({ ...r, ...to.get(r.id) }));
  /** Whether a spot is right on one of the fire's seats */
  const onSeat = (p: { lng: number; lat: number }) =>
    Array.from({ length: 40 }, (_, k) => ringSpots(k)).some((ring) => ring.some((s) => apart(at(s.x, s.y), p) < 0.01));

  it("leaves the first on each seat, and moves the later ones to the free seat nearest each, right on it", () => {
    const roaches = [
      { id: "first", ...seat(0, 0, 0.3, -0.2) },
      { id: "second", ...seat(0, 0, -0.8, 0.5) },
      { id: "third", ...seat(0, 0) },
      // put down by hand 3 m off the first seat: stays, and holds the seats round it
      { id: "byHand", ...seat(0, 0, -3, 0) },
      { id: "north", ...seat(0, 1, 0.9, 0.9) },
      // riding with 明河都尉, or anything else that stays: holds its seat, and a later one on it moves
      { id: "stays", ...seat(0, 3), stays: true },
      { id: "onStays", ...seat(0, 3, 0.5, 0) },
    ];
    const to = unstack(roaches);
    expect([...to.keys()]).toEqual(["second", "third", "onStays"]);
    const now = after(roaches, to);
    for (const id of to.keys()) {
      const p = now.find((r) => r.id === id)!;
      expect(onSeat(p)).toBe(true);
      for (const o of now) if (o.id !== id) expect(apart(p, o)).toBeGreaterThanOrEqual(SEAT_TAKEN_M);
    }
    // the first ring is taken (its fourth seat is behind her): the second ring's seat nearest each
    const free = ringSpots(1).map((s) => at(s.x, s.y));
    const nearest = (p: { lng: number; lat: number }, among: { lng: number; lat: number }[]) =>
      among.reduce((a, b) => (apart(b, p) < apart(a, p) ? b : a));
    const second = nearest(roaches[1], free);
    expect(apart(to.get("second")!, second)).toBeLessThan(0.01);
    expect(apart(to.get("third")!, nearest(roaches[2], free.filter((s) => apart(s, second) > 1)))).toBeLessThan(0.01);
    // run again on what it gave: nobody moves
    expect(unstack(now).size).toBe(0);
  });

  it("moves a roach seated after one put down by hand within 6 m, never the one put down by hand", () => {
    const roaches = [
      { id: "byHand", ...seat(0, 1, 2, -3) },
      { id: "seated", ...seat(0, 1) },
      { id: "byHandLater", ...seat(0, 0, 0, 4) },
    ];
    expect([...unstack(roaches).keys()]).toEqual(["seated"]);
    expect(unstack([])).toEqual(new Map());
    expect(unstack(roaches.slice(0, 1))).toEqual(new Map());
  });

  it("spreads hundreds piled on the first ring by pages that saw nobody, then those past 300 m once it is full", () => {
    let n = 7;
    const random = () => ((n = (n * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    // 600 seated one at a time, each seeing all before it; then 100 from pages that saw nobody by the fire
    const seated: { id: string; lng: number; lat: number }[] = [];
    for (let i = 0; i < 600; i++) seated.push({ id: `s${i}`, ...pickSeat(seated, random) });
    const blind = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, ...pickSeat([], random) }));
    const roaches = [...seated, ...blind];
    const to = unstack(roaches);
    expect(to.size).toBe(100);
    const now = after(roaches, to);
    for (let i = 0; i < now.length; i++) {
      for (let j = i + 1; j < now.length; j++) expect(apart(now[i], now[j])).toBeGreaterThan(SEAT_TAKEN_M);
    }
    expect(now.every((r) => metres(r) <= FIRE_RADIUS_M)).toBe(true);
    expect(unstack(now).size).toBe(0);

    // every seat within 300 m taken and 30 more piled on: those 30 sit further out, one to a seat
    const full = fill(20).map((p, i) => ({ id: `f${i}`, ...p }));
    const more = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, ...pickSeat([], random) }));
    const spread = after([...full, ...more], unstack([...full, ...more]));
    const out = spread.filter((r) => r.id.startsWith("m"));
    expect(out.every((r) => metres(r) > FIRE_RADIUS_M && metres(r) < ringRadius(21) + 1)).toBe(true);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(apart(out[i], out[j])).toBeGreaterThan(SEAT_TAKEN_M);
    expect(unstack(spread).size).toBe(0);
  });
});
