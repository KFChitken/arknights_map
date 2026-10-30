import { describe, expect, it } from "vitest";
import { bare, loose, nameAllowed, parseNameWords } from "./nameRules";

// stand-ins for the words kept on the admin page
const WORDS = parseNameWords("台独\n=国家\n");

describe("name rules", () => {
  it("cleans full width, spaces, case and symbols before comparing", () => {
    expect(loose("ＱＱ 群​")).toBe("qq群");
    expect(bare("台 独")).toBe("台独");
    expect(bare("台-独")).toBe("台独");
    expect(bare("台.独✨")).toBe("台独");
    expect(bare("Dr. ＡＢＣ")).toBe("drabc");
  });

  it("blocks a word anywhere, or only as the whole name", () => {
    expect(nameAllowed("台 独", WORDS)).toBe(false);
    expect(nameAllowed("我是台-独", WORDS)).toBe(false);
    expect(nameAllowed("独立宣言爱好者", WORDS)).toBe(true);
    expect(nameAllowed("国家", WORDS)).toBe(false);
    expect(nameAllowed("国家队", WORDS)).toBe(true);
  });

  it("stops passing for staff but leaves players' own words alone", () => {
    expect(nameAllowed("管理组", [])).toBe(false);
    expect(nameAllowed("管理组小王", [])).toBe(true);
    // Endfield's main character
    expect(nameAllowed("管理员", [])).toBe(true);
    expect(nameAllowed("鹰角厨", [])).toBe(true);
    expect(nameAllowed("鹰角官方", [])).toBe(false);
    expect(nameAllowed("ADMIN", [])).toBe(false);
    expect(nameAllowed("舟P地图客服", [])).toBe(false);
    expect(nameAllowed("匿名舟P", [])).toBe(false);
    expect(nameAllowed("塔露拉厨", [])).toBe(true);
  });

  it("stops links, contacts and long numbers", () => {
    expect(nameAllowed("看www.abc", [])).toBe(false);
    expect(nameAllowed("abc.com", [])).toBe(false);
    expect(nameAllowed("the.company", [])).toBe(true);
    expect(nameAllowed("加QQ 12345", [])).toBe(false);
    expect(nameAllowed("ｖｘ abc", [])).toBe(false);
    expect(nameAllowed("微信号是abc", [])).toBe(true);
    expect(nameAllowed("阿白123456", [])).toBe(false);
    expect(nameAllowed("阿白12345", [])).toBe(true);
  });

  it("reads the bulk box: one word a line, = for the whole name, Markdown left out", () => {
    expect(parseNameWords("```\n# 标题\n台 独\n=国家\n\n台独\n```")).toEqual([
      { word: "台独", whole: false },
      { word: "国家", whole: true },
    ]);
  });
});
