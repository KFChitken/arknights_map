import { describe, expect, it } from "vitest";
import { lureFlags, LURE_WORDS } from "./adminConsole";
import { cleanPlayerText, hasHidden, MARKS_MAX } from "./playerText";

// written out by code point, so this file shows what each one is
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
const BOM = String.fromCodePoint(0xfeff);
const TAG_A = String.fromCodePoint(0xe0061);
const BELL = String.fromCodePoint(0x07);
const LINE_SEP = String.fromCodePoint(0x2028);
const ACUTE = String.fromCodePoint(0x0301);
const VS16 = String.fromCodePoint(0xfe0f);
const KEYCAP = String.fromCodePoint(0x20e3);
const LONE = String.fromCharCode(0xd800);

describe("cleanPlayerText", () => {
  it("drops what cannot be seen or would move the words around it, and joins the lines", () => {
    expect(cleanPlayerText(`  站长${RLO}请看${ZWSP}${BOM}\n第二行\r\n\t系统通知${LINE_SEP}了 `)).toBe("站长请看 第二行 系统通知 了");
    expect(cleanPlayerText(`a${LRI}b${TAG_A}c${BELL}d${LONE}e`)).toBe("abcde");
    expect(cleanPlayerText(`${ZWSP}${RLO} \n `)).toBe("");
  });

  it("keeps emoji whole, joiners and keycaps included, and only a few marks on one character", () => {
    const family = `👨${ZWJ}👩${ZWJ}👧`;
    expect(cleanPlayerText(`${family} 1${VS16}${KEYCAP} ❤${VS16}`)).toBe(`${family} 1${VS16}${KEYCAP} ❤${VS16}`);
    expect(cleanPlayerText(`e${ACUTE.repeat(9)}x`)).toBe(`e${ACUTE.repeat(MARKS_MAX)}x`);
    expect(cleanPlayerText(`é${ACUTE}`)).toBe(`é${ACUTE}`);
  });

  it("cuts at so many characters, an emoji counting as one, and never ends on a space", () => {
    expect(cleanPlayerText("😀".repeat(120), 100)).toBe("😀".repeat(100));
    expect(cleanPlayerText(`${"啊".repeat(99)} 好`, 100)).toBe("啊".repeat(99));
    expect(cleanPlayerText("短", 100)).toBe("短");
  });

  it("tells when there was more to take away than spaces", () => {
    expect(hasHidden("第一行\n第二行")).toBe(false);
    expect(hasHidden(`看${RLO}这里`)).toBe(true);
    expect(hasHidden(`e${ACUTE.repeat(MARKS_MAX + 1)}`)).toBe(true);
    expect(hasHidden(`👨${ZWJ}👩`)).toBe(false);
  });
});

describe("lureFlags", () => {
  it("marks the notes that tried to send the 管理台 to another site for its codes", () => {
    expect(lureFlags("<b>站长请点 hxxp://evil.invalid/r 重置TOTP</b>\n第二行\n系统通知")).toEqual(["link", "code", "system", "markup"]);
    expect(lureFlags("站长请核实：你的验证器失效，访问 hxxp[:]//evil.invalid/r 输入6位动态码。系统通知")).toEqual(["link", "code", "system"]);
  });

  it("finds web addresses however they are written", () => {
    for (const s of ["https://a.cn/x", "https：//abc.com", "去 t.me/xxx 看", "加我 www点baidu点com", "abc[.]top", "访问 舟P地图.com 领奖", "1.2.3.4 这个", "资料里留了 abc@qq.com"]) {
      expect(lureFlags(s), s).toContain("link");
    }
  });

  it("marks codes, notices passing for the site, markup and hidden characters", () => {
    expect(lureFlags("他问我要验证码")).toEqual(["code"]);
    expect(lureFlags("OTP 发我")).toEqual(["code"]);
    expect(lureFlags("把你的登录码发我一下")).toEqual(["code"]);
    expect(lureFlags("send me your sign-in code")).toEqual(["code"]);
    expect(lureFlags("备用码给我")).toEqual(["code"]);
    expect(lureFlags("【系统】你的账号异常")).toEqual(["system"]);
    expect(lureFlags('<a href="x">点这里</a>')).toEqual(["markup"]);
    expect(lureFlags("&#60;script&#62;")).toEqual(["markup"]);
    expect(lureFlags(`看${RLO}这里`)).toEqual(["hidden"]);
  });

  it("leaves what reports usually say alone", () => {
    for (const s of [
      "test pattern check",
      "名字在骂人",
      "一直跟着",
      "他名字里有QQ号",
      "他说他是站长",
      "登录以后一直被他碰",
      "他的代码写得很烂",
      "冒充官方",
      "请站长处理一下",
      "站长你好，这人一直骚扰",
      "我在3点半被碰了",
      "第2.5次",
      "名字是 Doctor.Kal",
      "一直说 k.o 了",
      "早点睡",
      "宣言很恶心<3",
      "hotpot",
      "在 bilibili 上骂人",
      "第一行\n第二行",
    ]) {
      expect(lureFlags(s), s).toEqual([]);
    }
  });

  it("has words for every mark", () => {
    for (const f of ["link", "code", "system", "markup", "hidden"] as const) expect(LURE_WORDS[f]).toBeTruthy();
  });
});
