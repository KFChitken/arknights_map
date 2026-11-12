import { describe, expect, it } from "vitest";
import { POKE_BANG } from "./flipArt";

describe("戳一戳's burst", () => {
  it("draws 戳! in it, character for character as it always has", () => {
    expect(POKE_BANG).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70 52">
  <path d="M35 2 L42 13 L56 6 L53 19 L68 22 L56 30 L64 43 L49 40 L44 51 L35 41 L25 50 L22 38 L6 42 L14 29 L2 21 L17 18 L14 5 L28 12 Z" fill="#ffd23f" stroke="#0d0e10" stroke-width="2.2" stroke-linejoin="round"/>
  <text x="35" y="33" text-anchor="middle" font-size="19" font-weight="700" font-family="ZCOOL KuaiLe, PingFang SC, sans-serif" fill="#0d0e10">戳!</text>
</svg>`,
    );
  });
});
