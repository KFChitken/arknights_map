import { describe, expect, it } from "vitest";
import { cartoonCrawl, crawl, LEG_FRAMES, legFrame } from "./swarm";

const track = (seed: number, look: "real" | "cartoon", ms = 20_000, every = 50) =>
  Array.from({ length: ms / every }, (_, i) => crawl(seed, i * every, look));

describe("crawl", () => {
  it("gives every roach its own path, so a crowd does not move in step", () => {
    const paths = Array.from({ length: 40 }, (_, seed) => track(seed + 1, "real").map((c) => `${c.dx.toFixed(1)},${c.dy.toFixed(1)}`).join(" "));
    expect(new Set(paths).size).toBe(40);
  });

  it("keeps a real roach jiggling near its spot, with darts now and then", () => {
    const steps = track(7, "real");
    const moves = steps.slice(1).map((c, i) => Math.hypot(c.dx - steps[i].dx, c.dy - steps[i].dy));
    const far = Math.max(...steps.map((c) => Math.hypot(c.dx, c.dy)));
    // never frozen solid between two looks 50 ms apart
    expect(Math.min(...moves)).toBeGreaterThan(0);
    // most steps are a small jiggle, a few are darts
    const darts = moves.filter((m) => m > 2.5).length;
    expect(darts).toBeGreaterThan(0);
    expect(darts / moves.length).toBeLessThan(0.3);
    expect(far).toBeLessThan(16);
  });

  it("keeps every walk pose in range", () => {
    const frames = new Set(track(3, "real").map((c) => c.frame));
    expect([...frames].every((f) => f >= 0 && f < LEG_FRAMES)).toBe(true);
    const poses = new Set(Array.from({ length: 200 }, (_, i) => legFrame(1, i * 17)));
    expect([...poses].sort()).toEqual(Array.from({ length: LEG_FRAMES }, (_, i) => i));
  });
});

describe("cartoonCrawl", () => {
  // the vertex shader of components/map/roachGl.ts, step by step: the clock's part of each angle wrapped first
  const TAU = 6.2831853;
  const mod = (x: number, y: number) => x - y * Math.floor(x / y);
  const onGpu = (seed: number, t: number, scale: number) => {
    const [phase, speed, period, reach, yMul] = cartoonCrawl(seed);
    const k = t * speed;
    const slowX = mod(k / 1400, TAU) + phase;
    const slowY = mod((k * yMul) / 1400, TAU) + phase * yMul;
    const fastX = mod(k / period, TAU) + phase * 3;
    const fastY = mod((k * 1.1) / period, TAU) + phase * 3.3;
    return {
      dx: (Math.cos(slowX) * 2.2 * reach + Math.sin(fastX) * 0.5) * scale,
      dy: (Math.sin(slowY) * 1.6 * reach + Math.cos(fastY) * 0.5) * scale,
    };
  };

  it("moves each cartoon roach on the GPU as crawl() does", () => {
    for (let seed = 1; seed < 60; seed += 7)
      for (const t of [0, 16, 1234, 98_765, 2 ** 23 - 1])
        for (const scale of [0.5, 1.5]) {
          const cpu = crawl(seed * 7919, t, "cartoon", scale);
          const gpu = onGpu(seed * 7919, t, scale);
          // TAU is 2π to 8 digits: after a clock of hours, still far below a pixel
          expect(Math.abs(gpu.dx - cpu.dx)).toBeLessThan(0.01);
          expect(Math.abs(gpu.dy - cpu.dy)).toBeLessThan(0.01);
        }
  });
});
