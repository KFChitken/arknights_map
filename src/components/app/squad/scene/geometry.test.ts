import { describe, expect, it } from "vitest";
import { isPhrase, SCENE_EGGS, sceneOf, SCENES } from "@/lib/squad";
import {
  ASPECT,
  behindB,
  bossAt,
  bossHp,
  BOSSES,
  bossWidth,
  cloudR,
  rimC,
  seatA,
  seatB,
  seatC,
  sideOf,
  sizesOf,
  slips,
  stopA,
  targetA,
} from "./geometry";

describe("the fight on the map", () => {
  it("is one of three a round, the same for everyone in the room, and each comes up", () => {
    const room = "cde11df6-ac55-4a27-bc3b-e042b66cbef3";
    expect(sceneOf(room, 1794980492803)).toBe(sceneOf(room, 1794980492803));
    const seen = new Set<number>();
    for (let t = 0; t < 30; t++) {
      const v = sceneOf(room, 1794980492800 + t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(SCENES);
      seen.add(v);
    }
    expect(seen.size).toBe(3);
    // another room, the same start: its own pick
    expect(new Set(Array.from({ length: 30 }, (_, i) => sceneOf(`room-${i}`, 1794980492803))).size).toBe(3);
  });

  it("plays its eggs on set lines only, by their numbers", () => {
    expect(Object.keys(SCENE_EGGS).map(Number).every(isPhrase)).toBe(true);
    expect(SCENE_EGGS[14]).toBe("boss");
    expect(SCENE_EGGS[25]).toBe(SCENE_EGGS[31]);
  });

  it("sizes the roaches by the stage, 38–70 px, and the monsters 1.4 times that", () => {
    expect(sizesOf(359, 333)).toEqual({ rs: 54, ss: 76 });
    expect(sizesOf(100, 100).rs).toBe(38);
    expect(sizesOf(2000, 2000).rs).toBe(70);
    expect(Object.values(ASPECT).every((a) => a > 0.5 && a < 1)).toBe(true);
  });
});

describe("A: slugs from both sides", () => {
  const g = { W: 400, H: 300, rs: 50, ss: 70 };
  it("stands 1 and 2 on the left, 3 and 4 on the right, each slug stopping in front of its own", () => {
    expect([1, 2, 3, 4].map(sideOf)).toEqual([-1, -1, 1, 1]);
    expect(seatA(1, 400, 300)).toEqual([144, 114]);
    const [x4, y4] = seatA(4, 400, 300);
    expect(x4).toBeCloseTo(256);
    expect(y4).toBeCloseTo(207);
    // a slug for 1 stops on its left, one for 3 on its right; a big one further out
    expect(stopA(1, 400, 50, 70, false)).toBeLessThan(144);
    expect(stopA(3, 400, 50, 70, false)).toBeGreaterThan(256);
    expect(stopA(1, 400, 50, 70, true)).toBeLessThan(stopA(1, 400, 50, 70, false));
  });

  it("hits the nearest slug of its own side within reach; wider while the other of its side sleeps", () => {
    const [x1, y1] = seatA(1, g.W, g.H);
    const near = { x: x1 - 60, y: y1 + 21, side: -1, big: false, sneak: false };
    const far = { x: x1 - 75, y: y1 + 21, side: -1, big: false, sneak: false };
    const other = { x: x1 - 50, y: y1 + 21, side: 1, big: false, sneak: false };
    const slipping = { x: x1 - 10, y: y1 + 21, side: -1, big: false, sneak: true };
    expect(targetA(1, [far, near, other, slipping], g, false)).toBe(near);
    // out of reach: none
    expect(targetA(1, [{ ...near, x: x1 - 200 }], g, false)).toBeNull();
    // the one of 2's height: only while 2 sleeps (or in a frenzy)
    const low = { x: x1 - 60, y: seatA(2, g.W, g.H)[1] + 21, side: -1, big: false, sneak: false };
    expect(targetA(1, [low], g, false)).toBeNull();
    expect(targetA(1, [low], g, true)).toBe(low);
  });

  it("lets a slug left alone slip past after 3.4 s, never a big one", () => {
    expect(slips(3.3, false)).toBe(false);
    expect(slips(3.5, false)).toBe(true);
    expect(slips(30, true)).toBe(false);
  });
});

describe("B: one big monster", () => {
  it("takes 源石虫, 酸液源石虫 and 高能源石虫 in turn, 24, 27 and 30 hits, half as many again grown", () => {
    expect([0, 1, 2, 3, 4, 5].map(bossAt)).toEqual([...BOSSES, ...BOSSES]);
    expect(BOSSES.map((k) => bossHp(k, false))).toEqual([24, 27, 30]);
    expect(bossHp("infused", true)).toBe(45);
  });

  it("stands the four at its corners: 1 and 3 behind it, 2 and 4 in front, wider as it grows", () => {
    const g = { cx: 200, gy: 210, bw: bossWidth(400, 300), rs: 50, grow: 1 };
    expect(g.bw).toBe(150);
    expect(bossWidth(100, 100)).toBe(100);
    expect(bossWidth(2000, 2000)).toBe(240);
    const [x1, y1] = seatB(1, g);
    const [x2, y2] = seatB(2, g);
    const [x3, y3] = seatB(3, g);
    const [x4, y4] = seatB(4, g);
    expect(x1 < g.cx && x2 < g.cx && x3 > g.cx && x4 > g.cx).toBe(true);
    expect(y1 < y2 && y3 < y4).toBe(true);
    expect([1, 2, 3, 4].map(behindB)).toEqual([true, false, true, false]);
    expect(seatB(4, { ...g, grow: 1.3 })[0]).toBeGreaterThan(x4);
  });
});

describe("C: the brawl cloud", () => {
  it("sizes the cloud by the stage, 54–140 px, the four at its rim, one asleep further out", () => {
    expect(cloudR(400, 300)).toBe(81);
    expect(cloudR(100, 100)).toBe(54);
    expect(cloudR(2000, 2000)).toBe(140);
    const g = { cx: 200, cy: 168, R: 81 };
    const [ax, ay] = seatC(1, g, true);
    const [sx, sy] = seatC(1, g, false);
    expect(Math.hypot(sx - g.cx, sy - g.cy)).toBeGreaterThan(Math.hypot(ax - g.cx, ay - g.cy) * 1.3);
    // 1 and 2 on the left, 3 and 4 on the right
    expect([1, 2, 3, 4].map((h) => Math.sign(seatC(h, g, true)[0] - g.cx))).toEqual([-1, -1, 1, 1]);
    // its rim: straight up is above the middle, k times out
    const [, top] = rimC(-Math.PI / 2, 1, g);
    expect(top).toBeCloseTo(g.cy - g.R * 0.82);
  });
});
