import { describe, expect, it } from "vitest";
import {
  advance,
  type Cell,
  type Crumb,
  type Dir,
  fitForCrumb,
  SNAKE,
  SNAKE_GOAL,
  type Snake,
  snakeStart,
  STEP,
  step,
  stepMsOf,
  turn,
} from "./snake325";
import { mulberry32 } from "../prng";

const SEEDS = ((r) => Array.from({ length: 200 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
/** A round as it starts, its crumbs put far away where none is in the way, unless some are given */
const round = (over: Partial<Snake> = {}): Snake => ({
  ...snakeStart(mulberry32(1)),
  crumbs: [
    { x: 0, y: 0, n: 5 },
    { x: 12, y: 0, n: 20 },
    { x: 0, y: 12, n: 50 },
    { x: 12, y: 12, n: 100 },
  ],
  ...over,
});
const at = (s: Snake) => s.body.map((c) => `${c.x},${c.y}`).join(" ");
const BACK: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
/** Whether a step that way runs into nothing: the edge, or the train but its end */
const safe = (s: Snake, d: Dir) => {
  const h = s.body[0];
  const c = { x: h.x + STEP[d].x, y: h.y + STEP[d].y };
  return c.x >= 0 && c.y >= 0 && c.x < SNAKE.size && c.y < SNAKE.size && !s.body.slice(0, -1).some((b) => b.x === c.x && b.y === c.y);
};
/** A round with a crumb of n just ahead of the head */
const aheadOf = (s: Snake, n: number): Snake => {
  const h = s.body[0];
  const d = STEP[s.dir];
  return { ...s, crumbs: s.crumbs.map((c) => (c.n === n ? { x: h.x + d.x, y: h.y + d.y, n } : c)) };
};

describe("贪吃小强's turns", () => {
  it("are not taken straight back or the way it goes, and wait two at most", () => {
    const s = round();
    expect(s.dir).toBe("right");
    expect(turn(s, "left")).toBe(s);
    expect(turn(s, "right")).toBe(s);
    const up = turn(s, "up");
    expect(up.turns).toEqual(["up"]);
    // as the last turn waiting leaves it: down is straight back from up, up the way it goes then
    expect(turn(up, "down")).toBe(up);
    expect(turn(up, "up")).toBe(up);
    const two = turn(up, "left");
    expect(two.turns).toEqual(["up", "left"]);
    expect(turn(two, "down")).toBe(two);
    expect(SNAKE.queue).toBe(2);
  });

  it("are taken one a step, so two quick ones turn it twice", () => {
    let s = turn(turn(round(), "up"), "left");
    const r = mulberry32(2);
    expect(at(s)).toBe("4,6 3,6 2,6");
    s = step(s, r);
    expect(s.dir).toBe("up");
    expect(at(s)).toBe("4,5 4,6 3,6");
    s = step(s, r);
    expect(s.dir).toBe("left");
    expect(at(s)).toBe("3,5 4,5 4,6");
    expect(s.turns).toEqual([]);
    s = step(s, r);
    expect(at(s)).toBe("2,5 3,5 4,5");
  });
});

describe("贪吃小强's steps", () => {
  it("move the roach a square the way it goes, each of the train where the one before it was", () => {
    const s = step(round(), mulberry32(3));
    expect(at(s)).toBe("5,6 4,6 3,6");
    expect(s.was.map((c) => `${c.x},${c.y}`).join(" ")).toBe("4,6 3,6 2,6");
    expect(s.end).toBe(null);
  });

  it("eat a crumb crawled onto: its number added, the train longer by 1, 1, 2 or 4", () => {
    for (const [n, longer] of [
      [5, 1],
      [20, 1],
      [50, 2],
      [100, 4],
    ] as const) {
      const r = mulberry32(n);
      let s = step(aheadOf(round(), n), r);
      expect(s.ate?.n).toBe(n);
      expect(s.eaten).toBe(n);
      expect(s.grow).toBe(longer);
      expect(SNAKE.grows[n]).toBe(longer);
      // the end of the train stays where it is as many steps, a roach longer each
      const lengths = [s.body.length];
      for (let k = 0; k < 5; k++) {
        s = step(s, r);
        lengths.push(s.body.length);
      }
      expect(lengths).toEqual(Array.from({ length: 6 }, (_, k) => 3 + Math.min(k, longer)));
      expect(s.end).toBe(null);
    }
  });

  it("pass the round at exactly 325, and burst the roach past it", () => {
    const r = mulberry32(4);
    expect(step(aheadOf(round({ eaten: 305 }), 20), r)).toMatchObject({ eaten: 325, end: "won" });
    expect(step(aheadOf(round({ eaten: 225 }), 100), r)).toMatchObject({ eaten: 325, end: "won" });
    expect(step(aheadOf(round({ eaten: 320 }), 20), r)).toMatchObject({ eaten: 340, end: "burst" });
    expect(step(aheadOf(round({ eaten: 300 }), 50), r)).toMatchObject({ eaten: 350, end: "burst" });
    expect(step(aheadOf(round({ eaten: 300 }), 20), r)).toMatchObject({ eaten: 320, end: null });
    expect(SNAKE_GOAL).toBe(325);
  });

  it("end the round at the grid's edge, the roach staying where it was", () => {
    const s = round({ body: [{ x: 12, y: 6 }, { x: 11, y: 6 }, { x: 10, y: 6 }] });
    const t = step(s, mulberry32(5));
    expect(t.end).toBe("wall");
    expect(at(t)).toBe(at(s));
    expect(step(round({ body: [{ x: 3, y: 0 }, { x: 3, y: 1 }], dir: "up" }), mulberry32(5)).end).toBe("wall");
  });

  it("end the round run into the train, but not into the square its end leaves that step", () => {
    // a ring: the head at 5,5 going right, into 6,5
    const ring: Cell[] = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
      { x: 6, y: 4 },
    ];
    expect(step(round({ body: ring }), mulberry32(6)).end).toBe("self");
    // 6,5 the end of the train: it goes on out of it, unless the train is growing
    const four = ring.slice(0, 4);
    const t = step(round({ body: four }), mulberry32(6));
    expect(t.end).toBe(null);
    expect(at(t)).toBe("6,5 5,5 5,6 6,6");
    expect(step(round({ body: four, grow: 1 }), mulberry32(6)).end).toBe("self");
  });
});

describe("贪吃小强's clock", () => {
  it("takes a step every 220 ms at first, less as more is eaten, 160 at 325", () => {
    expect(stepMsOf(0)).toBe(220);
    expect(stepMsOf(325)).toBe(160);
    expect(stepMsOf(162.5)).toBe(190);
    expect(stepMsOf(100)).toBeLessThan(stepMsOf(50));
    let s = round();
    const r = mulberry32(7);
    const stepsAt: number[] = [];
    for (let t = 0; t < 700; t += 10) {
      const before = s.body[0];
      s = advance(s, 10, r);
      if (s.body[0] !== before) stepsAt.push(s.ms);
    }
    expect(stepsAt).toEqual([220, 440, 660]);
  });

  it("ends the round once 90 seconds are gone", () => {
    const s = advance(round({ ms: 89_990 }), 20, mulberry32(8));
    expect(s.end).toBe("time");
    expect(s.ms).toBe(90_000);
    expect(SNAKE.seconds).toBe(90);
    // and nothing more happens once it is over
    expect(advance(s, 500, mulberry32(8))).toBe(s);
    expect(step(s, mulberry32(8))).toBe(s);
    expect(turn(s, "up")).toBe(s);
  });
});

describe("贪吃小强's crumbs", () => {
  it("start the same for the same seed, one of each, none near the roach or on its way", () => {
    expect(snakeStart(mulberry32(9))).toEqual(snakeStart(mulberry32(9)));
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const s = snakeStart(mulberry32(seed));
      expect(at(s)).toBe("4,6 3,6 2,6");
      expect(s.crumbs.map((c) => c.n)).toEqual([5, 20, 50, 100]);
      s.crumbs.forEach((c, i) => expect(fitForCrumb(c, s.body, s.crumbs.slice(0, i), s.dir)).toBe(true));
      seen.add(JSON.stringify(s.crumbs));
    }
    expect(seen.size).toBeGreaterThan(195);
  });

  it("are always one each of 5, 20, 50 and 100, a new one put down free and away from the head", () => {
    const dirs: Dir[] = ["up", "down", "left", "right"];
    let eats = 0;
    for (const seed of SEEDS) {
      const r = mulberry32(seed);
      const play = mulberry32(seed ^ 0x5eed);
      let s = snakeStart(r);
      // a player that turns at random now and then, and away from the edge or the train it is about to run into
      for (let k = 0; k < 400 && !s.end; k++) {
        const want = play() < 0.2 ? dirs[Math.floor(play() * 4)] : s.dir;
        const ways = [want, ...dirs].filter((d) => d !== BACK[s.dir] && safe(s, d));
        if (ways.length) s = turn({ ...s, turns: [] }, ways[0]);
        const before = s;
        s = step(s, r);
        if (s.end === "wall" || s.end === "self") break;
        expect(s.crumbs.map((c) => c.n)).toEqual([5, 20, 50, 100]);
        // none on a roach or on another
        const squares = new Set([...s.body, ...s.crumbs].map((c) => `${c.x},${c.y}`));
        expect(squares.size).toBe(s.body.length + 4);
        if (s.ate) {
          eats++;
          const put = s.crumbs.find((c) => c.n === s.ate!.n) as Crumb;
          expect(fitForCrumb(put, s.body, s.crumbs.filter((c) => c !== put), s.dir)).toBe(true);
          expect(before.crumbs.some((c) => c.x === put.x && c.y === put.y)).toBe(false);
        }
      }
    }
    expect(eats).toBeGreaterThan(600);
  });

  it("are put down not touching the head, nor on its way the 5 squares ahead", () => {
    const body: Cell[] = [
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ];
    expect(fitForCrumb({ x: 7, y: 7 }, body, [], "right")).toBe(false);
    expect(fitForCrumb({ x: 8, y: 8 }, body, [], "right")).toBe(false);
    expect(fitForCrumb({ x: 9, y: 7 }, body, [], "right")).toBe(true);
    expect(fitForCrumb({ x: 11, y: 6 }, body, [], "right")).toBe(false);
    expect(fitForCrumb({ x: 12, y: 6 }, body, [], "right")).toBe(true);
    expect(fitForCrumb({ x: 6, y: 9 }, body, [], "right")).toBe(true);
    expect(fitForCrumb({ x: 6, y: 9 }, body, [], "down")).toBe(false);
    expect(fitForCrumb({ x: 12, y: 12 }, body, [{ x: 12, y: 12 }], "right")).toBe(false);
  });
});
