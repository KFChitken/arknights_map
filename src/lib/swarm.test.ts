import { describe, expect, it } from "vitest";
import { crawl, LEG_FRAMES, legFrame } from "./swarm";

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
