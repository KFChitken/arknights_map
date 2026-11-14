import { describe, expect, it } from "vitest";
import { layout } from "./Passes";

/** Room under a card for its name (Passes.tsx CAPTION) */
const CAPTION = 20;

describe("where the cards of a draw lie", () => {
  it("puts a single one in the middle, 5:9, at most 96 wide and else .38 of the box", () => {
    const one = layout(1, 366);
    expect(one.pos).toHaveLength(1);
    const [{ x, y, w }] = one.pos;
    expect(w).toBe(96);
    expect(2 * x + w).toBe(366);
    expect(one.h).toBe(y + Math.round(w * 1.8) + CAPTION);
    expect(layout(1, 200).pos[0].w).toBe(76);
  });

  it("puts ten in two rows of five, 5:9, the second under the first one's names, all inside the box", () => {
    for (const W of [296, 342, 366, 396]) {
      const { pos, h } = layout(10, W);
      expect(pos).toHaveLength(10);
      const w = pos[0].w;
      const tall = Math.round(w * 1.8);
      expect(pos.every((p) => p.w === w)).toBe(true);
      expect(Math.min(...pos.map((p) => p.x))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...pos.map((p) => p.x + w))).toBeLessThanOrEqual(W);
      expect(new Set(pos.slice(0, 5).map((p) => p.y)).size).toBe(1);
      expect(new Set(pos.slice(5).map((p) => p.y)).size).toBe(1);
      expect(pos[5].y).toBeGreaterThanOrEqual(pos[0].y + tall + CAPTION);
      expect(h).toBe(pos[5].y + tall + CAPTION);
    }
  });
});
