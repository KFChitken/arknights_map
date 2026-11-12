import { describe, expect, it } from "vitest";
import { CHARACTERS, isCharacter, isOperator, matchesSearch, OPERATORS } from "./operators";

describe("character lists", () => {
  it("has Endfield's 34 under their official names", () => {
    expect(OPERATORS.endfield).toHaveLength(34);
    expect(isOperator("endfield", "提弗洛斯")).toBe(true);
    expect(isOperator("endfield", "明河")).toBe(true);
    expect(isOperator("endfield", "夜明河")).toBe(false);
  });

  it("lets 普瑞赛斯, of the story, be among the Arknights 厨力 after the 6-stars, but never fielded", () => {
    expect(isCharacter("arknights", "普瑞赛斯")).toBe(true);
    expect(isOperator("arknights", "普瑞赛斯")).toBe(false);
    expect(isCharacter("endfield", "普瑞赛斯")).toBe(false);
    expect(CHARACTERS.arknights.indexOf("普瑞赛斯")).toBe(CHARACTERS.arknights.indexOf("塔露拉") + 1);
    // the playable ones are as BWIKI lists them, and every one of them may be 厨力 too
    expect(OPERATORS.arknights).toHaveLength(440);
    expect(CHARACTERS.arknights).toEqual([...OPERATORS.arknights.slice(0, 141), "普瑞赛斯", ...OPERATORS.arknights.slice(141)]);
    expect(CHARACTERS.endfield).toEqual(OPERATORS.endfield);
    expect(matchesSearch("普瑞赛斯", "普瑞")).toBe(true);
  });

  it("finds characters by nickname too", () => {
    expect(matchesSearch("祀", "小葱")).toBe(true);
    expect(matchesSearch("祀", "祀")).toBe(true);
    expect(matchesSearch("能天使", "小葱")).toBe(false);
    expect(matchesSearch("Castle-3", "castle")).toBe(true);
    expect(matchesSearch("能天使", "  ")).toBe(true);
  });
});
