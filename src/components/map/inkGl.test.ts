import { describe, expect, it } from "vitest";
import { ROACH_AVATARS } from "@/lib/types";
import { INK_LOOKS, inkImageName } from "./inkArt";
import { inkCell } from "./inkGl";

describe("ink roaches on 高德's map", () => {
  it("draw a look with no ink picture (鸭爵) in the hood's cells, never running on into the trees' or the sealed ones'", () => {
    const duck = ROACH_AVATARS.indexOf("duck");
    expect(INK_LOOKS).not.toContain("duck");
    for (let look = 0; look < ROACH_AVATARS.length + 2; look++) {
      for (const state of [0, 1, 2]) {
        for (const left of [false, true]) {
          // the looks' four ways first (5 × 4), then the trees and the sign from 20; with her seal, from 32
          const plain = inkCell(look, state, left, false);
          const sealed = inkCell(look, state, left, true);
          expect(plain).toBeGreaterThanOrEqual(0);
          expect(plain).toBeLessThan(INK_LOOKS.length * 4);
          expect(sealed).toBeGreaterThanOrEqual(32);
          expect(sealed).toBeLessThan(32 + INK_LOOKS.length * 4);
          if (look >= INK_LOOKS.length) expect([plain, sealed]).toEqual([inkCell(0, state, left, false), inkCell(0, state, left, true)]);
        }
      }
    }
    expect(INK_LOOKS.length * 4).toBe(20);
    // and on MapLibre, the hood's pictures
    expect(inkImageName(duck, "standR")).toBe("si-ink-hood-standR");
    expect(inkImageName("duck", "lieL", true)).toBe("si-ink-hood-lieL-sealed");
    expect(inkImageName("gugu", "lieL")).toBe("si-ink-gugu-lieL");
  });
});
