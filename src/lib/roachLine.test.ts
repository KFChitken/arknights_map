import { describe, expect, it, vi } from "vitest";

describe("the roaches' pictures", () => {
  it("are drawn whole whichever of roachSvg.ts and flipArt.ts a page loads first", async () => {
    for (const first of ["./roachSvg", "./flipArt"]) {
      vi.resetModules();
      await import(first);
      const flip = await import("./flipArt");
      const svg = await import("./roachSvg");
      expect(svg.LINE, first).toBe("#0d0e10");
      expect(flip.POKE_FINGER, first).toContain('stroke="#0d0e10"');
      expect(flip.POKE_BANG, first).toContain('fill="#0d0e10"');
    }
  });
});
