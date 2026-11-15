import { describe, expect, it } from "vitest";
import { mainlandWords } from "./siteStatus";

const amap = { count: 0, limit: 1_500_000, home: "amap" as const, set: null, out: null };

describe("what the digest and the admin page say mainland China starts with", () => {
  it("is 高德's, or 腾讯's for the rest of a day 高德 would not give its map loads", () => {
    expect(mainlandWords(amap)).toBe("内地现在用：高德");
    expect(mainlandWords({ ...amap, home: "tencent", out: "2026-11-14" })).toBe("内地现在用：腾讯（今天高德不给加载了，明天 0 点先再试高德）");
  });

  it("says when MAINLAND_MAP holds it", () => {
    expect(mainlandWords({ ...amap, home: "own", set: "own" })).toBe("内地现在用：我们自己的图（服务器上 MAINLAND_MAP 设成了 own）");
    expect(mainlandWords({ ...amap, home: "amap", set: "amap", out: "2026-11-14" })).toBe("内地现在用：高德（服务器上 MAINLAND_MAP 设成了 amap；今天高德不给加载了）");
  });
});
