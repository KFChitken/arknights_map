import { describe, expect, it } from "vitest";
import { checkSupport } from "./support";

describe("我的助战", () => {
  it("keeps three listed Arknights operators at most, once each, names only", () => {
    expect(checkSupport(["能天使", "能天使", "不存在的干员", "<script>", "佩丽卡", "黑", "安洁莉娜", "阿米娅"])).toEqual([
      "能天使",
      "黑",
      "安洁莉娜",
    ]);
    expect(checkSupport("nonsense")).toEqual([]);
    // 厨力 may hold characters of the story, whom nobody can field
    expect(checkSupport(["普瑞赛斯", "能天使"])).toEqual(["能天使"]);
  });
});
