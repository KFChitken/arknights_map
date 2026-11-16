import { describe, expect, it } from "vitest";
import { roachSvg } from "./roachSvg";

describe("roachSvg's sleeves up (听歌's disco)", () => {
  it("draws the hood with both sleeves up, and the rest of it as ever", () => {
    for (const color of ["cyan", "gold", "white"] as const) {
      const up = roachSvg(color, { hands: true });
      expect(up).toContain('transform="rotate(-160.5 47.5 36)"');
      expect(up).toContain('transform="rotate(160.5 16.5 36)"');
      expect(roachSvg(color)).not.toContain("rotate(160.5 16.5 36)");
      expect(up.replace(/ transform="rotate\(-?160\.5 \d+\.5 36\)"/g, "")).toBe(roachSvg(color));
    }
  });

  it("keeps a clone's look and a friend's colour with them", () => {
    const opts = { avatar: "hood", clone: true, friend: true } as const;
    expect(roachSvg("purple", { ...opts, hands: true }).replace(/ transform="rotate\(-?160\.5 \d+\.5 36\)"/g, "")).toBe(roachSvg("purple", opts));
  });
});
