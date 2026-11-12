import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  answerKind,
  answerLine,
  checkinLine,
  chineseDate,
  deviceHour,
  favouriteLine,
  firstSentence,
  howLong,
  MINGHE_NEAR,
  paintingDay,
  paintingTier,
  placeLine,
  portraitTitle,
  SI_LINES,
  siText,
  stampAt,
  stampLine,
  STAMPS,
  STAMPS_PER_ROUND,
  stayLine,
  vacancyLine,
} from "./si";
import { ROUTE } from "./minghe";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-12T06:00:00Z");

describe("祀掌柜", () => {
  it("answers a new 触须之交 first, then one long or a little while away, the small hours, and as usual", () => {
    const base = { newFriend: false, friend: true, last: NOW - HOUR, now: NOW, hour: 14 };
    expect(answerKind({ ...base, newFriend: true, last: NOW - 20 * DAY, hour: 2 })).toBe("friend");
    expect(answerKind({ ...base, last: NOW - 14 * DAY, hour: 2 })).toBe("longaway");
    expect(answerKind({ ...base, last: NOW - 3 * DAY })).toBe("away");
    expect(answerKind({ ...base, last: NOW - 3 * DAY + 1 })).toBe("touch");
    // days away only for a 触须之交, never for someone she just met
    expect(answerKind({ ...base, friend: false, last: NOW - 20 * DAY })).toBe("touch");
    expect(answerKind({ ...base, friend: true, last: null })).toBe("touch");
    for (const hour of [0, 4]) expect(answerKind({ ...base, hour })).toBe("night");
    expect(answerKind({ ...base, hour: 5 })).toBe("touch");
  });

  it("finds 明河都尉's day near her by where his stations are", () => {
    expect(ROUTE[MINGHE_NEAR].name).toBe("黄山");
  });

  it("works out the hour on the player's device from its time zone, Beijing without one", () => {
    // 06:00 UTC: 14:00 in Beijing, 01:00 in New York (UTC−5)
    expect(deviceHour(-480, NOW)).toBe(14);
    expect(deviceHour(undefined, NOW)).toBe(14);
    expect(deviceHour(300, NOW)).toBe(1);
    expect(deviceHour("junk", NOW)).toBe(14);
  });

  it("says her lines word for word, the bubble only the first sentence", () => {
    expect(answerLine("touch", false, 0)).toBe("谁在戳我？……哼，偷偷摸摸的，我早就看见了。");
    expect(answerLine("touch", true, 2)).toBe("墨都被你碰洒了！……算了，就原谅你这一次。");
    expect(answerLine("night", true, null)).toBe(SI_LINES.night);
    expect(firstSentence(answerLine("touch", false, 0))).toBe("谁在戳我？");
    expect(firstSentence(answerLine("touch", false, 1))).toBe("鬼鬼祟祟的。");
    expect(firstSentence(SI_LINES.friend)).toBe("才、才不想和你交朋友呢！");
    expect(firstSentence(SI_LINES.longaway)).toBe("一百五十年都别想我理你！");
    // the same in another language
    expect(firstSentence("Who is poking me? Sneaky.")).toBe("Who is poking me?");
    expect(firstSentence("……哼")).toBe("……哼");
    // every ellipsis is two of 「…」
    const all = JSON.stringify(SI_LINES);
    expect(all).not.toMatch(/[^…]…[^…]/);
    expect(all).not.toMatch(/\.\.\./);
  });

  it("stamps each player's first 29 in an order of their own, the same every round, the 30th always 「祀」", () => {
    const a = Array.from({ length: 90 }, (_, k) => stampAt("player-a", k));
    const b = Array.from({ length: 30 }, (_, k) => stampAt("player-b", k));
    expect(STAMPS).toHaveLength(30);
    expect(STAMPS[29]).toBe("祀");
    expect(new Set(a.slice(0, 30)).size).toBe(30);
    expect(a.slice(30, 60)).toEqual(a.slice(0, 30));
    expect(a.slice(60, 90)).toEqual(a.slice(0, 30));
    for (const k of [29, 59, 89]) expect(STAMPS[a[k]]).toBe("祀");
    expect(a.slice(0, 29)).not.toContain(29);
    // shuffled: not the list as written, and not the same for another account
    expect(a.slice(0, 29)).not.toEqual(Array.from({ length: 29 }, (_, i) => i));
    expect(b.slice(0, 29)).not.toEqual(a.slice(0, 29));
    expect(STAMPS_PER_ROUND).toBe(30);
  });

  it("says which stamp she put in, one of three ways at random but the same each time, and more at 7, 30 and 100", () => {
    const ways = [
      (s: string) => `顺手给你盖了个章：「${s}」。在我盖新的之前，不许擦掉。`,
      (s: string) => `今天的章：「${s}」。……别、别多想，随手盖的。`,
      (s: string) => `「${s}」。哼，就这个了，不满意也不换。`,
    ];
    const used = new Set<number>();
    for (let k = 1; k <= 60; k++) {
      if (k === 7 || k === 30) continue;
      const stamp = k % 30;
      const line = stampLine(stamp, k);
      const way = ways.findIndex((w) => w(STAMPS[stamp]) === line);
      expect(way).toBeGreaterThanOrEqual(0);
      expect(stampLine(stamp, k)).toBe(line);
      used.add(way);
    }
    expect(used.size).toBe(3);
    expect(stampLine(1, 7)).toMatch(/才七个？……还早着呢。$/);
    expect(stampLine(29, 30)).toMatch(/三十种都被你集齐了？/);
    expect(stampLine(2, 100)).toMatch(/一百个……你就这么闲吗？……明、明天也来。$/);
    expect(stampLine(2, 31)).not.toMatch(/集齐/);
  });

  it("writes how long as the card does: under an hour, hours rounded up, days rounded", () => {
    expect(howLong(10 * 60_000)).toBe("不到 1 小时");
    expect(howLong(HOUR)).toBe("1 小时");
    expect(howLong(HOUR + 1)).toBe("2 小时");
    expect(howLong(23.2 * HOUR)).toBe("24 小时");
    expect(howLong(DAY)).toBe("1 天");
    expect(howLong(3.6 * DAY)).toBe("4 天");
    expect(placeLine(1234, 5 * HOUR)).toBe("你排在第 1,234 位，大概还要 5 小时。……我才没有特意帮你算。");
    expect(placeLine(3, 20 * 60_000)).toBe("你排在第 3 位，大概还要不到 1 小时。……我才没有特意帮你算。");
    expect(vacancyLine(2380)).toBe("还有 2,380 间空房。……才、才不是特意给你留的。");
    expect(checkinLine(17, 0)).toBe("正好有空房，17 号。……来得巧而已，别得意。");
    expect(checkinLine(17, 190)).toBe("排了 4 小时，总算轮到你了。17 号房，就住半天。……被子是新晒的，才、才不是为你晒的。");
    expect(stayLine(17, 30 * 60_000)).toBe("17 号房，还能住不到 1 小时");
  });

  it("writes her lines in the inbox whole, the stamp after her answer", () => {
    const item = { bold: false, variant: 1, stamp: null, stamps: null, room: null, waited: null };
    expect(siText({ ...item, line: "touch" })).toBe("祀掌柜回了你：「鬼鬼祟祟的。想碰就大大方方地碰，我又不咬人。」");
    expect(siText({ ...item, line: "touch", stamp: 29, stamps: 30 })).toBe(
      `祀掌柜回了你：「鬼鬼祟祟的。想碰就大大方方地碰，我又不咬人。」${stampLine(29, 30)}`,
    );
    expect(stampLine(29, 30)).toMatch(/「祀」.*三十种都被你集齐了？……哼，集章本盖满了，我再给你加几页。$/);
    expect(siText({ ...item, line: "friend" })).toBe(`祀掌柜和你成为了触须之交：「${SI_LINES.friend}」`);
    expect(siText({ ...item, line: "checkin", room: 5, waited: 0 })).toBe("祀掌柜：「正好有空房，5 号。……来得巧而已，别得意。」");
    expect(siText({ ...item, line: "again", room: 2500 })).toBe("祀掌柜：「又是你。2500 号房，还是住半天。……我才没记得你上回睡的哪间。」");
    expect(siText({ ...item, line: "checkout", room: 5 })).toBe(`祀掌柜：「${SI_LINES.checkout}」`);
  });

  it("paints by Beijing day from 04:00, in four tiers after a blank sheet", () => {
    expect(paintingDay(Date.parse("2026-11-11T19:59:00Z"))).toBe("2026-11-11");
    expect(paintingDay(Date.parse("2026-11-11T20:00:00Z"))).toBe("2026-11-12");
    expect([0, 1, 1000, 1001, 5000, 5001, 10000, 10001].map(paintingTier)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it("speaks of herself among the Endfield favourites first, else the first of her family in the Arknights list", () => {
    expect(favouriteLine({ arknights: ["年"], endfield: ["祀"] })).toMatch(/^你的厨力角色……是我？/);
    expect(favouriteLine({ arknights: ["能天使", "令", "年"], endfield: [] })).toMatch(/^令姐姐/);
    expect(favouriteLine({ arknights: ["望"], endfield: [] })).toBe("你也认识望？……哼，我才没想哥哥们。……就一点点。");
    expect(favouriteLine({ arknights: ["能天使"], endfield: ["明河"] })).toBeNull();
  });
});

describe("her portraits", () => {
  it("dates them in Chinese numerals by this device's calendar", () => {
    expect(chineseDate(new Date(2026, 10, 11, 23, 59).getTime())).toBe("二〇二六年十一月十一日");
    expect(chineseDate(new Date(2027, 0, 1).getTime())).toBe("二〇二七年一月一日");
    expect(chineseDate(new Date(2026, 9, 20).getTime())).toBe("二〇二六年十月二十日");
    expect(chineseDate(new Date(2030, 11, 31).getTime())).toBe("二〇三〇年十二月三十一日");
  });

  it("writes your name on yours, or 管理员 without one", () => {
    expect(portraitTitle("小刻")).toBe("小刻小像");
    expect(portraitTitle(null)).toBe("管理员小像");
    expect(portraitTitle("  ")).toBe("管理员小像");
  });

  it("has every character of her seals and the portraits' own words in the seal font's list", () => {
    const script = readFileSync(new URL("../../scripts/si-seal-font.py", import.meta.url), "utf8");
    const words = /WORDS = "([^"]+)"/.exec(script)![1];
    const own = `${portraitTitle(null)}自画像${chineseDate(new Date(2029, 11, 27).getTime())}${chineseDate(new Date(2036, 3, 18).getTime())}`;
    expect([...own].filter((c) => !words.includes(c))).toEqual([]);
    // the script reads the seals from si.ts itself
    expect(script).toContain("export const STAMPS = \\[");
    expect(STAMPS.join("").length).toBeGreaterThan(30);
  });
});
