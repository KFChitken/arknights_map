import { describe, expect, it } from "vitest";
import { SANDWICH, SANDWICH_STOPS, sandwichPx } from "./sandwich";

describe("两面包夹芝士", () => {
  it("has a slice of bread on either side of the cheese", () => {
    const cheese = SANDWICH.filter((p) => p.kind === "cheese");
    const bread = SANDWICH.filter((p) => p.kind === "bread");
    expect(cheese).toHaveLength(1);
    expect(bread).toHaveLength(2);
    const lats = bread.map((b) => b.at.lat).sort((a, b) => a - b);
    // one on the Pacific side, one on the Sea of Japan side
    expect(lats[0]).toBeLessThan(cheese[0].at.lat);
    expect(lats[1]).toBeGreaterThan(cheese[0].at.lat);
    // the cheese is drawn last, over the bread
    expect(SANDWICH[SANDWICH.length - 1].kind).toBe("cheese");
  });

  it("grows with the map, then stays put", () => {
    const first = SANDWICH_STOPS[0];
    const last = SANDWICH_STOPS[SANDWICH_STOPS.length - 1];
    expect(sandwichPx(0, "bread")).toBe(first[1]);
    expect(sandwichPx(first[0], "bread")).toBe(first[1]);
    expect(sandwichPx(last[0], "bread")).toBe(last[1]);
    expect(sandwichPx(15, "bread")).toBe(last[1]);
    expect(sandwichPx(4.5, "bread")).toBeCloseTo((38 + 54) / 2);
    for (let z = 0; z < 10; z += 0.5) {
      expect(sandwichPx(z + 0.5, "bread")).toBeGreaterThanOrEqual(sandwichPx(z, "bread"));
      expect(sandwichPx(z, "cheese")).toBeLessThan(sandwichPx(z, "bread"));
    }
  });
});
