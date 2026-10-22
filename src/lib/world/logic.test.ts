import { describe, expect, it } from "vitest";
import { declarationText, reactionsFor, TEMPLATES, type Declaration } from "../declarations";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { checkDeclaration } from "./logic";

const fan: Profile = {
  ...EMPTY_PROFILE,
  anonymous: false,
  name: "Breeze",
  drPrefix: true,
  games: ["arknights", "endfield"],
  favourites: { arknights: ["能天使"], endfield: ["佩丽卡"] },
};

const say = (d: Declaration, p: Profile = fan) => declarationText(checkDeclaration(p, d));

describe("declarations", () => {
  it("fills every sentence the sheet offers", () => {
    expect(say({ template: "launch", game: "endfield" })).toBe("终末地，启动！");
    expect(say({ template: "iam", character: "能天使", title: "佩洛" })).toBe("我是能天使的佩洛");
    expect(say({ template: "love", character: "佩丽卡" })).toBe("我永远喜欢佩丽卡");
    expect(say({ template: "buff", character: "能天使" })).toBe("加强能天使");
    expect(say({ template: "myname", game: "arknights" })).toBe("我是Dr. Breeze，我要玩明日方舟");
    expect(say({ template: "welcome", game: "arknights" })).toBe("欢迎回家，刀客塔");
    expect(say({ template: "welcome", game: "endfield" })).toBe("欢迎回家，管理员");
    expect(say({ template: "canyou", character: "佩丽卡" })).toBe("佩丽卡做得到吗？");
    expect(say({ template: "eat", character: "能天使", food: "脚夹馍" })).toBe("我想吃能天使的脚夹馍");
    expect(say({ template: "birthday" })).toBe("祝我生日快乐");
    expect(TEMPLATES).toHaveLength(9);
  });

  it("only takes your own favourites, the listed titles and foods, and your real name", () => {
    expect(() => say({ template: "love", character: "陈" })).toThrow("厨力角色");
    expect(() => say({ template: "iam", character: "能天使", title: "博士" })).toThrow("称呼");
    // @ts-expect-error a food that is not on the list
    expect(() => say({ template: "eat", character: "能天使", food: "火锅" })).toThrow("吃的");
    // the name always comes from the profile, never from the request
    expect(say({ template: "myname", game: "endfield", name: "别人" })).toBe("我是Dr. Breeze，我要玩终末地");
    expect(() => say({ template: "myname", game: "endfield" }, { ...fan, anonymous: true })).toThrow("名字");
    // no longer offered as a declaration; it became a reaction
    expect(() => say({ template: "alsoplay", game: "arknights" })).toThrow("选一句宣言");
  });

  it("offers 生日快乐！ only under a birthday declaration", () => {
    expect(reactionsFor("birthday")).toContain("birthday");
    expect(reactionsFor("launch")).not.toContain("birthday");
    expect(reactionsFor("launch")).toEqual(["alsoplay", "zhouli", "shouwei", "plusone", "diplomat"]);
  });
});
