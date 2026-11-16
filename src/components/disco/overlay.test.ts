import { describe, expect, it } from "vitest";
import { glint } from "./overlay";

describe("the ball's glints", () => {
  it("flash up quickly on the beat and fade out by its middle, dark for the rest of it", () => {
    expect(glint(0)).toBe(0);
    expect(glint(0.06)).toBeCloseTo(0.5, 6);
    expect(glint(0.12)).toBeCloseTo(1, 6);
    expect(glint(0.31)).toBeCloseTo(0.5, 6);
    for (const ph of [0.5, 0.6, 0.8, 0.99]) expect(glint(ph)).toBe(0);
  });
});
