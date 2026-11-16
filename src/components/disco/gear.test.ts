import { describe, expect, it } from "vitest";
import { BACK_MS, fpsCap, GearWatch, modeOf } from "./gear";

/** Frames at fps for s seconds from t (ms): each step down there was, and the time after */
function run(w: GearWatch, t: number, fps: number, s: number) {
  const steps: string[] = [];
  const end = t + s * 1000;
  for (; t < end; t += 1000 / fps) if (w.frame(t)) steps.push(w.gear);
  return { steps, t };
}

describe("听歌's disco on a slow phone", () => {
  it("stays as it is at 30 frames a second, and at 25", () => {
    const w = new GearWatch();
    const fast = run(w, 1000, 30, 10);
    expect([...fast.steps, ...run(w, fast.t, 25, 10).steps]).toEqual([]);
    expect(w.gear).toBe("full");
  });

  it("goes to 省电版 after three seconds running under 24 a second, and to the lights alone after three more under 16", () => {
    const w = new GearWatch();
    const slow = run(w, 1000, 20, 3.5);
    expect(slow.steps).toEqual(["lite"]);
    // 20 a second is enough for 省电版
    const lite = run(w, slow.t, 20, 10);
    expect(lite.steps).toEqual([]);
    const slower = run(w, lite.t, 12, 4.5);
    expect(slower.steps).toEqual(["lights"]);
    expect(w.gear).toBe("lights");
  });

  it("starts counting again after a second fast enough", () => {
    const w = new GearWatch();
    // two slow seconds, then two fast, then two slow again
    const steps: string[] = [];
    let t = 1000;
    for (const [fps, s] of [
      [10, 2.05],
      [30, 2],
      [10, 2.05],
    ]) {
      const r = run(w, t, fps, s);
      steps.push(...r.steps);
      t = r.t;
    }
    expect(steps).toEqual([]);
    expect(w.gear).toBe("full");
    expect(run(w, t, 10, 1.5).steps).toEqual(["lite"]);
  });

  it("never steps back up, however fast it gets after", () => {
    const w = new GearWatch();
    const down = run(w, 1000, 8, 8);
    expect(down.steps).toEqual(["lite", "lights"]);
    expect(run(w, down.t, 60, 20).steps).toEqual([]);
    expect(w.gear).toBe("lights");
  });

  it("counts nothing while it rests: just started, or just back to the page", () => {
    const w = new GearWatch();
    w.rest(1000, BACK_MS);
    expect(run(w, 1000, 5, BACK_MS / 1000).steps).toEqual([]);
    expect(w.gear).toBe("full");
    // and from then on, as ever
    expect(run(w, 1000 + BACK_MS, 5, 3.5).steps).toEqual(["lite"]);
  });

  it("takes a stop of the page (a dialog, another tab) for no frames, not for slow ones", () => {
    const w = new GearWatch();
    let t = 1000;
    for (let k = 0; k < 6; k++) {
      t = run(w, t, 30, 0.9).t;
      // nothing drawn for 5 seconds
      t += 5000;
    }
    expect(w.gear).toBe("full");
  });
});

describe("what is drawn", () => {
  it("only lights where less motion is asked for, or after the last step down; nobody dances where the map cannot draw it", () => {
    expect(modeOf(true, "full", true)).toEqual({ dance: false, fx: "still" });
    expect(modeOf(true, "lite", false)).toEqual({ dance: false, fx: "still" });
    expect(modeOf(false, "lights", true)).toEqual({ dance: false, fx: "calm" });
    expect(modeOf(false, "full", true)).toEqual({ dance: true, fx: "full" });
    expect(modeOf(false, "lite", true)).toEqual({ dance: true, fx: "lite" });
    // 轻量's piles, the real look, a phone without the GPU layer: the lights, nobody dancing
    expect(modeOf(false, "full", false)).toEqual({ dance: false, fx: "full" });
  });

  it("draws 30 frames a second at most, 20 in 省电版", () => {
    expect(fpsCap("full")).toBe(30);
    expect(fpsCap("lite")).toBe(20);
  });
});
