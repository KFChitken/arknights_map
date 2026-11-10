import { describe, expect, it } from "vitest";
import { suggestEmail } from "./emailTypos";

describe("suggestEmail", () => {
  it("suggests the common domain a mistyped one is closest to", () => {
    expect(suggestEmail("doctor@gmial.com")).toBe("doctor@gmail.com");
    expect(suggestEmail("doctor@gmai.com")).toBe("doctor@gmail.com");
    expect(suggestEmail("doctor@gmail.con")).toBe("doctor@gmail.com");
    expect(suggestEmail("doctor@gmaill.co")).toBe("doctor@gmail.com");
    expect(suggestEmail("12345@qq.con")).toBe("12345@qq.com");
    expect(suggestEmail("12345@vip.qq.con")).toBe("12345@vip.qq.com");
    expect(suggestEmail("amiya@163.con")).toBe("amiya@163.com");
    expect(suggestEmail("amiya@hotmial.com")).toBe("amiya@hotmail.com");
    expect(suggestEmail("amiya@outlok.com")).toBe("amiya@outlook.com");
  });

  it("catches the misspellings seen most in the bounces", () => {
    const seen: Record<string, string> = {
      "qq.con": "qq.com",
      "qq.co": "qq.com",
      "qq.cpm": "qq.com",
      "pp.com": "qq.com",
      "qq.cm": "qq.com",
      "qq.cim": "qq.com",
      "gamil.com": "gmail.com",
      "163.cm": "163.com",
      "qq.vom": "qq.com",
      "qq.com.com": "qq.com",
      "163.comcom": "163.com",
      "gmai.com": "gmail.com",
      "gmail.con": "gmail.com",
      "outlook.co": "outlook.com",
      "outlok.com": "outlook.com",
    };
    for (const [typo, meant] of Object.entries(seen)) expect(suggestEmail(`12345@${typo}`), typo).toBe(`12345@${meant}`);
  });

  it("keeps the player's own spelling of the part before @", () => {
    expect(suggestEmail(" Doctor.Rhodes@GMIAL.COM ")).toBe("Doctor.Rhodes@gmail.com");
  });

  it("says nothing for a common domain, an unknown one, or one as close to two", () => {
    expect(suggestEmail("doctor@gmail.com")).toBeNull();
    expect(suggestEmail("doctor@QQ.com")).toBeNull();
    expect(suggestEmail("doctor@rhodes-island.org")).toBeNull();
    expect(suggestEmail("doctor@example.com")).toBeNull();
    // 163.com and 126.com both one swap away
    expect(suggestEmail("doctor@162.com")).toBeNull();
    // not an address yet
    expect(suggestEmail("doctor@gmai")).toBeNull();
    expect(suggestEmail("gmial.com")).toBeNull();
  });
});
