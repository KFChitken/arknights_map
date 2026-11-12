import { describe, expect, it } from "vitest";
import { waitText } from "./rules";

describe("a wait in words", () => {
  it("says 「45 秒」, 「2 分钟」 or 「4 分 30 秒」, for every wait as it did when it was put together from 分 and 钟 or 「 30 秒」", () => {
    expect([45, 120, 270].map(waitText)).toEqual(["45 秒", "2 分钟", "4 分 30 秒"]);
    const before = (s: number) => (s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分${s % 60 ? ` ${s % 60} 秒` : "钟"}`);
    const differ: number[] = [];
    for (let s = 0; s <= 100_000; s++) if (waitText(s) !== before(s)) differ.push(s);
    expect(differ).toEqual([]);
  });
});
