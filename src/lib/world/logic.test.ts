import { describe, expect, it } from "vitest";
import { declarationText, reactionsFor, TEMPLATES, type Declaration } from "../declarations";
import { beijingDate } from "../beijing";
import { activeEvents, EVENTS, untilText } from "../events";
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

describe("limited-time declarations", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const tazi: Declaration = { template: "event", line: "tazi" };

  it("runs each line from its start to the minute before its end, Beijing time, with its own game's version", () => {
    const on = (iso: string) => activeEvents(at(iso)).flatMap((e) => e.lines.map((l) => l.id));
    expect(on("2026-10-26T23:59:59+08:00")).toEqual([]);
    expect(on("2026-10-27T00:00:00+08:00")).toEqual(["tazi", "yuanyuan"]);
    // Endfield's version ends first
    expect(on("2026-11-26T03:59:59+08:00")).toEqual(["tazi", "yuanyuan"]);
    expect(on("2026-11-26T04:00:00+08:00")).toEqual(["tazi"]);
    expect(on("2026-11-29T03:59:59+08:00")).toEqual(["tazi"]);
    expect(on("2026-11-29T04:00:00+08:00")).toEqual([]);
    const [tazi, yuanyuan] = EVENTS[0].lines;
    expect([untilText(tazi), untilText(yuanyuan)]).toEqual(["到 11/29 04:00", "到 11/26 04:00"]);
  });

  it("counts visit days in Beijing time", () => {
    expect(beijingDate(at("2026-11-30T15:59:59Z"))).toBe("2026-11-30");
    expect(beijingDate(at("2026-11-30T16:00:00Z"))).toBe("2026-12-01");
  });

  it("can be sent by anyone while the event is on, and only then", () => {
    const anyone = { ...EMPTY_PROFILE };
    expect(declarationText(checkDeclaration(anyone, tazi, at("2026-11-15T12:00:00+08:00")))).toBe("恭喜塔姐上岛！");
    expect(() => checkDeclaration(anyone, tazi, at("2026-11-29T04:00:00+08:00"))).toThrow("已经结束");
    expect(() => checkDeclaration(anyone, tazi, at("2026-10-26T23:59:59+08:00"))).toThrow("还没开始");
    const yuanyuan: Declaration = { template: "event", line: "yuanyuan" };
    expect(() => checkDeclaration(anyone, yuanyuan, at("2026-11-27T12:00:00+08:00"))).toThrow("已经结束");
    expect(declarationText(checkDeclaration(anyone, tazi, at("2026-11-27T12:00:00+08:00")))).toBe("恭喜塔姐上岛！");
    expect(() => checkDeclaration(anyone, { template: "event", line: "nope" }, at("2026-11-15T12:00:00+08:00"))).toThrow(
      "选一句宣言",
    );
  });

  it("still reads right after the event, and falls back for a line nobody knows", () => {
    expect(declarationText({ template: "event", line: "yuanyuan" })).toBe("才...才不想和祀住进缘缘庄呢！");
    expect(declarationText({ template: "event", line: "nope" })).toBe("（限定宣言）");
    expect(reactionsFor("event")).not.toContain("birthday");
  });

  it("keeps line ids unique across events, since a declaration stores only the line", () => {
    const ids = EVENTS.flatMap((e) => e.lines.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
    // a typo in a time would quietly switch the line off
    for (const l of EVENTS.flatMap((e) => e.lines)) expect(Date.parse(l.start)).toBeLessThan(Date.parse(l.end));
  });
});
