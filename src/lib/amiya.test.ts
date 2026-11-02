import { describe, expect, it } from "vitest";
import { amiyaLine, callName } from "./amiya";

describe("阿米娅向导", () => {
  it("calls players 博士, and only those who play just Endfield 管理员", () => {
    expect(callName(["endfield"])).toBe("管理员");
    expect(callName(["arknights"])).toBe("博士");
    expect(callName(["arknights", "endfield"])).toBe("博士");
    expect(callName([])).toBe("博士");
  });

  it("says Breeze's lines word for word", () => {
    expect(amiyaLine("sneaky", [])).toBe("欸？博士？");
    expect(amiyaLine("bold", [])).toBe("诶嘿嘿...博士");
    expect(amiyaLine("greet", [])).toBe("欢迎回家，博士");
    expect(amiyaLine("sneaky", ["endfield"])).toBe("欸？管理员？");
    expect(amiyaLine("bold", ["endfield"])).toBe("诶嘿嘿...管理员");
    expect(amiyaLine("greet", ["endfield"])).toBe("欢迎回家，管理员");
  });
});
