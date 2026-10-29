import { describe, expect, it } from "vitest";
import { isOperator, matchesSearch, OPERATORS } from "./operators";

describe("character lists", () => {
  it("has Endfield's 34 under their official names", () => {
    expect(OPERATORS.endfield).toHaveLength(34);
    expect(isOperator("endfield", "提弗洛斯")).toBe(true);
    expect(isOperator("endfield", "明河")).toBe(true);
    expect(isOperator("endfield", "夜明河")).toBe(false);
  });

  it("finds characters by nickname too", () => {
    expect(matchesSearch("祀", "小葱")).toBe(true);
    expect(matchesSearch("祀", "祀")).toBe(true);
    expect(matchesSearch("能天使", "小葱")).toBe(false);
    expect(matchesSearch("Castle-3", "castle")).toBe(true);
    expect(matchesSearch("能天使", "  ")).toBe(true);
  });
});
