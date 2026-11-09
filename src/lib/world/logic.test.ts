import { describe, expect, it } from "vitest";
import {
  canReply,
  declarationText,
  DRUNK_TEMPLATES,
  GENERIC_REACTIONS,
  REACTIONS,
  repliesFor,
  replyOf,
  TEMPLATES,
  type Declaration,
} from "../declarations";
import { beijingDate } from "../beijing";
import { activeEvents, EVENTS, untilText } from "../events";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { checkDeclaration, normalizeProfile } from "./logic";

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

  it("offers 生日快乐！ only under a birthday declaration, as its own first", () => {
    expect(repliesFor({ template: "birthday" })[0]).toEqual({ id: "birthday", text: "生日快乐！", own: true });
    expect(repliesFor({ template: "launch", game: "arknights" }).map((r) => r.id)).not.toContain("birthday");
  });

  /** One of each sentence, its blanks filled */
  const everySentence: Declaration[] = [
    { template: "launch", game: "arknights" },
    { template: "iam", character: "阿米娅", title: "狗" },
    { template: "love", character: "阿米娅" },
    { template: "buff", character: "阿米娅" },
    { template: "myname", game: "endfield", name: "Dr. Breeze" },
    { template: "welcome", game: "arknights" },
    { template: "canyou", character: "阿米娅" },
    { template: "eat", character: "阿米娅", food: "脚夹馍" },
    { template: "birthday" },
    { template: "water" },
    { template: "drunklove", character: "阿米娅" },
    { template: "kr168", character: "阿米娅", spouse: "老婆" },
    { template: "radar" },
    { template: "roguelike" },
    { template: "xianshu" },
    { template: "rental" },
    ...EVENTS.flatMap((e) => e.lines.map((l): Declaration => ({ template: "event", line: l.id }))),
  ];

  it("gives every sentence its own four replies, the fourth asking for a touch, then the five every one has", () => {
    expect(new Set(everySentence.map((d) => d.template))).toEqual(new Set([...TEMPLATES, ...DRUNK_TEMPLATES, "event"]));
    for (const d of everySentence) {
      const replies = repliesFor(d);
      const own = replies.filter((r) => r.own);
      expect(own, declarationText(d)).toHaveLength(4);
      expect(own[3].text).toContain("碰我一下");
      expect(replies.filter((r) => !r.own).map((r) => r.id)).toEqual([...GENERIC_REACTIONS]);
      expect(replies.slice(0, 4)).toEqual(own);
      expect(new Set(replies.map((r) => r.text)).size).toBe(9);
      expect(new Set(replies.map((r) => r.id)).size).toBe(9);
      for (const r of replies) expect(r.text).not.toMatch(/^\s*$|undefined|[{}【】]/);
    }
    // every sentence's own ids are its own
    const owns = everySentence.filter((d) => !(d.template === "event" && d.line.startsWith("perlica-bday"))).flatMap((d) => repliesFor(d).filter((r) => r.own).map((r) => r.id));
    expect(new Set(owns).size).toBe(owns.length);
  });

  it("fills a reply in from the declaration, and 喵～ for a 猫", () => {
    expect(repliesFor({ template: "love", character: "阿米娅" }).slice(0, 4).map((r) => r.text)).toEqual([
      "我也永远喜欢阿米娅！",
      "阿米娅是我的！",
      "你上次也是这么说的",
      "同担！碰我一下",
    ]);
    expect(repliesFor({ template: "iam", character: "阿米娅", title: "猫" })[0].text).toBe("喵～");
    expect(repliesFor({ template: "iam", character: "阿米娅", title: "佩洛" })[0].text).toBe("汪汪！");
    expect(repliesFor({ template: "iam", character: "阿米娅", title: "狗" })[1].text).toBe("我也是阿米娅的狗");
    expect(repliesFor({ template: "myname", game: "endfield", name: "Dr. Breeze" }).slice(1, 4).map((r) => r.text)).toEqual([
      "我也要玩终末地！",
      "准了！",
      "Dr. Breeze你好，碰我一下",
    ]);
    // 佩丽卡's birthday is the same every year
    const p27 = repliesFor({ template: "event", line: "perlica-bday-2027" });
    expect(repliesFor({ template: "event", line: "perlica-bday-2036" })).toEqual(p27);
    expect(p27[0]).toEqual({ id: "perlica-bday.1", text: "佩丽卡生日快乐！", own: true });
  });

  it("refuses another sentence's own reply, keeps the old ones readable, and has only the five where a sentence has none", () => {
    const love: Declaration = { template: "love", character: "阿米娅" };
    expect(canReply(love, "love.4")).toBe(true);
    expect(canReply(love, "plusone")).toBe(true);
    expect(canReply(love, "launch.1")).toBe(false);
    expect(canReply(love, "birthday")).toBe(false);
    expect(canReply(love, "love.5")).toBe(false);
    // what was left before each sentence had its own still reads
    for (const id of Object.keys(REACTIONS)) expect(replyOf(love, id)?.text).toBe(REACTIONS[id as keyof typeof REACTIONS]);
    expect(replyOf(love, "nonsense")).toBeNull();
    expect(repliesFor({ template: "alsoplay", game: "arknights" }).map((r) => r.id)).toEqual([...GENERIC_REACTIONS]);
    expect(repliesFor({ template: "event", line: "nope" }).map((r) => r.id)).toEqual([...GENERIC_REACTIONS]);
  });
});

describe("looks", () => {
  it("keeps every look on the list, 咕咕嘎嘎 too, and puts anything else back to the hood", () => {
    for (const avatar of ["hood", "doctor", "endmin", "imp", "gugu"] as const) {
      expect(normalizeProfile({ ...EMPTY_PROFILE, avatar }).avatar).toBe(avatar);
    }
    // @ts-expect-error not a look
    expect(normalizeProfile({ ...EMPTY_PROFILE, avatar: "penguin" }).avatar).toBe("hood");
  });
});

describe("drunk declarations", () => {
  const drunk = (d: Declaration, p: Profile = fan) => declarationText(checkDeclaration(p, d, Date.now(), true));

  it("says each of the seven lines while the main roach lies drunk", () => {
    expect(drunk({ template: "water" })).toBe("这白开水怎么没味啊？");
    expect(drunk({ template: "drunklove", character: "能天使" })).toBe("我永远喜欢能天使！");
    expect(drunk({ template: "kr168", character: "佩丽卡", spouse: "老婆" })).toBe("氪了168，佩丽卡老婆回家家");
    expect(drunk({ template: "kr168", character: "能天使", spouse: "老公" })).toBe("氪了168，能天使老公回家家");
    expect(drunk({ template: "radar" })).toBe("我的方舟雷达💡的一下响了");
    expect(drunk({ template: "roguelike" })).toBe("我要打集成战略！");
    expect(drunk({ template: "xianshu" })).toBe("我要看仙术杯！");
    expect(drunk({ template: "rental" })).toBe("我的出租屋里真的有很多蟑螂，但我认识的粥批真的没有几个");
    expect(DRUNK_TEMPLATES).toHaveLength(7);
  });

  it("refuses them sober, and takes only your own favourites and 老婆 or 老公", () => {
    for (const template of DRUNK_TEMPLATES) {
      expect(() => say({ template, character: "能天使", spouse: "老婆" } as Declaration)).toThrow("醉倒以后");
    }
    expect(() => drunk({ template: "drunklove", character: "陈" })).toThrow("厨力角色");
    // @ts-expect-error neither 老婆 nor 老公
    expect(() => drunk({ template: "kr168", character: "能天使", spouse: "对象" })).toThrow("老婆还是老公");
    // the sober ones still go out drunk
    expect(drunk({ template: "launch", game: "arknights" })).toBe("明日方舟，启动！");
  });
});

describe("limited-time declarations", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const tazi: Declaration = { template: "event", line: "tazi" };

  it("runs each line from its start to the minute before its end, Beijing time, with its own game's version", () => {
    const on = (iso: string) => activeEvents(at(iso)).flatMap((e) => e.lines.map((l) => l.id));
    expect(on("2026-10-26T23:59:59+08:00")).toEqual([]);
    const arknights = ["tazi", "talulah-spring", "talulah-flame"];
    expect(on("2026-10-27T00:00:00+08:00")).toEqual([...arknights, "yuanyuan"]);
    // 明河 joins later
    expect(on("2026-11-05T23:59:59+08:00")).toEqual([...arknights, "yuanyuan"]);
    expect(on("2026-11-06T00:00:00+08:00")).toEqual([...arknights, "yuanyuan", "minghe"]);
    // Endfield's version ends first
    expect(on("2026-11-26T03:59:59+08:00")).toEqual([...arknights, "yuanyuan", "minghe"]);
    expect(on("2026-11-26T04:00:00+08:00")).toEqual(arknights);
    expect(on("2026-11-29T03:59:59+08:00")).toEqual(arknights);
    expect(on("2026-11-29T04:00:00+08:00")).toEqual([]);
    const [tazi, spring, flame, yuanyuan, minghe] = EVENTS[0].lines;
    expect([tazi, spring, flame, yuanyuan, minghe].map(untilText)).toEqual(["到 11/29 04:00", "到 11/29 04:00", "到 11/29 04:00", "到 11/26 04:00", "到 11/26 04:00"]);
    expect(minghe).toMatchObject({ game: "endfield", text: "明河，带我一程！" });
    // 塔露拉's own words, in Breeze's punctuation
    expect([spring, flame]).toMatchObject([
      { game: "arknights", text: "推开窗看看吧，春天已经到了。" },
      { game: "arknights", text: "我，就是火焰。" },
    ]);
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
    expect(repliesFor({ template: "event", line: "yuanyuan" }).map((r) => r.id)).not.toContain("birthday");
  });

  it("opens 「祝佩丽卡生日快乐！」 on her birthday every year, Beijing time, with no badge of its own", () => {
    const bday: Declaration = { template: "event", line: "perlica-bday-2027" };
    const anyone = { ...EMPTY_PROFILE };
    const on = (iso: string) => activeEvents(at(iso)).flatMap((e) => e.lines.map((l) => l.id));
    expect(on("2027-03-15T23:59:59+08:00")).toEqual([]);
    expect(on("2027-03-16T00:00:00+08:00")).toEqual(["perlica-bday-2027"]);
    expect(on("2027-03-17T03:59:59+08:00")).toEqual(["perlica-bday-2027"]);
    expect(on("2027-03-17T04:00:00+08:00")).toEqual([]);
    expect(on("2036-03-16T12:00:00+08:00")).toEqual(["perlica-bday-2036"]);
    expect(declarationText(checkDeclaration(anyone, bday, at("2027-03-16T12:00:00+08:00")))).toBe("祝佩丽卡生日快乐！");
    expect(() => checkDeclaration(anyone, bday, at("2027-03-17T04:00:00+08:00"))).toThrow("已经结束");
    expect(EVENTS.find((e) => e.id === "perlica-birthday")?.badge).toBeUndefined();
  });

  it("keeps line ids unique across events, since a declaration stores only the line", () => {
    const ids = EVENTS.flatMap((e) => e.lines.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
    // a typo in a time would quietly switch the line off
    for (const l of EVENTS.flatMap((e) => e.lines)) expect(Date.parse(l.start)).toBeLessThan(Date.parse(l.end));
  });
});
