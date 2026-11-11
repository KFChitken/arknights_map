import { describe, expect, it } from "vitest";
import { countText, rough, roughText } from "./counts";

describe("counts for visitors", () => {
  it("says the world's count as it is, or in 万 rounded down", () => {
    expect(countText(5011)).toBe("5,011 只");
    expect(countText(62_345)).toBe("6.2 万只");
    expect(countText(69_999)).toBe("6.9 万只");
    expect(countText(150_000)).toBe("15 万只");
  });

  it("rounds a count near a spot down: a few, tens, hundreds", () => {
    expect([0, 1, 9, 10, 37, 99, 100, 358, 1234].map(rough)).toEqual([0, 1, 1, 10, 30, 90, 100, 300, 1200]);
    expect(roughText(1)).toBe("几只");
    expect(roughText(30)).toBe("30 多只");
    expect(roughText(300)).toBe("300 多只");
  });
});
