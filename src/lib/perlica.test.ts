import { describe, expect, it } from "vitest";
import { besideMain, MINE_PX, rideStart } from "@/components/map/guideMarker";
import {
  anniversaryLine,
  awayBand,
  awaySentence,
  FAR_M,
  formatAway,
  formatKg,
  friendDay,
  isAnniversary,
  missKg,
  NEAR_M,
  PERLICA_MORE,
  perlicaBirthday,
  perlicaText,
  sleptSentence,
  spotNear,
  touchBackLine,
  weekLine,
  weightSentence,
} from "./perlica";

const metres = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

describe("佩丽卡监督", () => {
  it("writes time away from the largest unit there is, zeros included", () => {
    expect(formatAway(600)).toBe("10 分 0 秒");
    expect(formatAway(1388)).toBe("23 分 8 秒");
    expect(formatAway(3599)).toBe("59 分 59 秒");
    expect(formatAway(3600)).toBe("1 小时 0 分 0 秒");
    expect(formatAway(18760)).toBe("5 小时 12 分 40 秒");
    expect(formatAway(86399)).toBe("23 小时 59 分 59 秒");
    expect(formatAway(86400)).toBe("1 天 0 小时 0 分 0 秒");
    expect(formatAway(184467)).toBe("2 天 3 小时 14 分 27 秒");
    expect(formatAway(518659)).toBe("6 天 0 小时 4 分 19 秒");
  });

  it("picks the band by where it starts, and the line by its number", () => {
    expect([599, 600, 3599, 3600, 86399, 86400, 259199, 259200, 1209599, 1209600].map(awayBand)).toEqual([
      0, 0, 0, 1, 1, 2, 2, 3, 3, 4,
    ]);
    expect(awaySentence(1388, 0)).toBe("23 分 8 秒。……我没有在数，是计时器自己在走。");
    expect(awaySentence(18760, 0)).toBe("5 小时 12 分 40 秒。监督的工作早就做完了，剩下的时间都在等你。");
    expect(awaySentence(184467, 0)).toBe("2 天 3 小时 14 分 27 秒。饭我照常吃了，就是吃不出味道。");
    expect(awaySentence(20 * 86400, 2)).toBe("20 天 0 小时 0 分 0 秒。很久，但还不算最久。我等过更久的。");
  });

  it("says her touch back in her own words", () => {
    expect(touchBackLine("touch", false, null)).toBe("……刚才那一下是管理员吧。不用偷偷的，我认得出来。");
    expect(touchBackLine("touch", true, 3)).toBe("管理员主动碰我了。今天第 3 次，我记下了。");
    expect(touchBackLine("friend", true, null)).toBe("好，记下了。……以后不许再一声不吭地走掉。");
    const item = { bold: true, seconds: null, line: null, times: 3, others: null };
    expect(perlicaText({ ...item, what: "touch" })).toBe("佩丽卡监督大胆地碰回来了：「管理员主动碰我了。今天第 3 次，我记下了。」");
    expect(perlicaText({ ...item, what: "away", bold: false, seconds: 1388, line: 0 })).toBe(
      "佩丽卡监督：「23 分 8 秒。……我没有在数，是计时器自己在走。才 0.1 kg。这么轻的思念，我一只手就拿得动。」",
    );
  });

  it("stands 100 m to 1 km from the main roach, the same spot for the same numbers", () => {
    const main = { lng: 121.4737, lat: 31.2304 };
    for (let i = 0; i < 500; i++) {
      const d = metres(main, spotNear(main, Math.random(), Math.random()));
      expect(d).toBeGreaterThanOrEqual(NEAR_M - 1);
      expect(d).toBeLessThanOrEqual(FAR_M + 1);
    }
    expect(metres(main, spotNear(main, 0, 0.3))).toBeCloseTo(NEAR_M, 0);
    expect(metres(main, spotNear(main, 0.999999, 0.7))).toBeCloseTo(FAR_M, 0);
    expect(spotNear(main, 0.42, 0.17)).toEqual(spotNear(main, 0.42, 0.17));
    // far north the same metres are more degrees of longitude
    const north = { lng: 25, lat: 66 };
    expect(metres(north, spotNear(north, 0.5, 0.25))).toBeCloseTo(metres(main, spotNear(main, 0.5, 0.25)), 0);
  });

  it("steps aside when she would cover the main roach on screen, and only then", () => {
    const size = 30;
    const need = (MINE_PX + size) / 2;
    expect(besideMain({ x: 100, y: 100 }, null, size)).toEqual([0, 0]);
    expect(besideMain({ x: 100 + need, y: 100 }, { x: 100, y: 100 }, size)).toEqual([0, 0]);
    // 10 px to the right: pushed further right until the icons just touch
    expect(besideMain({ x: 110, y: 100 }, { x: 100, y: 100 }, size)).toEqual([need - 10, 0]);
    // right on top of it: upwards, and further up when her name hangs below her
    expect(besideMain({ x: 100, y: 100 }, { x: 100, y: 100 }, size)).toEqual([0, -need]);
    expect(besideMain({ x: 100, y: 100 }, { x: 100, y: 100 }, size, 18)).toEqual([0, -(need + 18)]);
    // below it, her name is out of the way already
    expect(besideMain({ x: 100, y: 110 }, { x: 100, y: 100 }, size, 18)).toEqual([0, need - 10]);
  });

  it("rides her 鬼火 in from the screen's edge on the side she came from, or from the left", () => {
    // from the left edge, level with where she stops, when where she was is unknown
    expect(rideStart({ x: 300, y: 200 }, null, 800, 600)).toEqual([-340, 0]);
    // from straight above: out past the top
    expect(rideStart({ x: 300, y: 200 }, { x: 300, y: 100 }, 800, 600)).toEqual([0, -240]);
    // from far to the right, off the screen: just past the right edge, along the way
    expect(rideStart({ x: 300, y: 200 }, { x: 3300, y: 200 }, 800, 600)).toEqual([540, 0]);
  });
});

describe("佩丽卡监督's second step", () => {
  it("weighs the time away at a kilogram every five hours, to 0.1 kg, from 0.1 kg, in tonnes from a tonne", () => {
    expect(missKg(600)).toBe(0.1);
    expect(formatKg(missKg(84_600))).toBe("4.7 kg");
    expect(formatKg(12)).toBe("12.0 kg");
    expect(formatKg(216)).toBe("216.0 kg");
    expect(formatKg(1000)).toBe("1.00 吨");
    expect(formatKg(1040)).toBe("1.04 吨");
    // 23.5 hours: band 1, line 84600 % 3 = 0
    expect(weightSentence(84_600)).toBe("这次攒了 4.7 kg 重重的思念，你终于回来了。");
    // in tonnes, no space after 吨 (5,201 hours: line 1 of the last band)
    expect(weightSentence(18_723_601)).toBe("1.04 吨的思念，重到秤都快放不下了。……没关系，你回来就好。");
  });

  it("picks the weight's band as her reports do, and the same line for the same seconds", () => {
    for (const s of [600, 3599, 3600, 86399, 86400, 259199, 259200, 1209599, 1209600]) {
      expect(weightSentence(s)).toBe(weightSentence(s));
    }
    expect(weightSentence(3599)).toMatch(/^(这次只攒了|.*这点思念不算重|才 )/);
    expect(weightSentence(3600)).toMatch(/重重的|开始有点重|攒到/);
    expect(weightSentence(1209600)).toMatch(/十年|秤|一点都不重/);
    expect(perlicaText({ what: "away", bold: false, seconds: 84_600, line: 0, times: null, others: null })).toBe(
      "佩丽卡监督：「23 小时 30 分 0 秒。监督的工作早就做完了，剩下的时间都在等你。这次攒了 4.7 kg 重重的思念，你终于回来了。」",
    );
    expect(sleptSentence(25_200, 2)).toBe("你睡了 7 小时 0 分 0 秒。……下次喝之前，先跟我说一声。");
  });

  it("counts the days of being 触须之交 again by the device's clock, from 04:00, the first day being day 1", () => {
    const beijing = -480;
    const since = Date.parse("2026-11-06T03:00:00+08:00"); // still 11/5 by the 04:00 rule
    expect(friendDay(since, beijing, Date.parse("2026-11-06T03:59:59+08:00"))).toBe(1);
    expect(friendDay(since, beijing, Date.parse("2026-11-06T04:00:00+08:00"))).toBe(2);
    expect(friendDay(since, beijing, Date.parse("2026-11-11T12:00:00+08:00"))).toBe(7);
    // a device in New York turns its day at its own 04:00
    const ny = 300;
    expect(friendDay(Date.parse("2026-11-06T10:00:00-05:00"), ny, Date.parse("2026-11-07T03:59:00-05:00"))).toBe(1);
    expect(friendDay(Date.parse("2026-11-06T10:00:00-05:00"), ny, Date.parse("2026-11-07T04:00:00-05:00"))).toBe(2);
    expect([7, 30, 100, 365, 730].map(isAnniversary)).toEqual([true, true, true, true, true]);
    expect([1, 8, 364, 366].map(isAnniversary)).toEqual([false, false, false, false]);
    expect(anniversaryLine(30)).toBe("今天是我们再次相遇的第 30 天。……我没有特意记，是日历提醒的。");
    expect(anniversaryLine(730)).toBe("今天是我们再次相遇的第 730 天。……上次我等了十年，这次我们一起过了两年。");
    expect(anniversaryLine(3650)).toMatch(/一起过了十年。$/);
    expect(anniversaryLine(4015)).toMatch(/一起过了 11 年。$/);
  });

  it("has her birthday from 3/16 00:00 to 3/17 04:00 Beijing time, whatever the device's zone", () => {
    expect(perlicaBirthday(Date.parse("2027-03-15T23:59:59+08:00"))).toBe(false);
    expect(perlicaBirthday(Date.parse("2027-03-16T00:00:00+08:00"))).toBe(true);
    expect(perlicaBirthday(Date.parse("2027-03-17T03:59:59+08:00"))).toBe(true);
    expect(perlicaBirthday(Date.parse("2027-03-17T04:00:00+08:00"))).toBe(false);
    // the same moments from an American device
    expect(perlicaBirthday(Date.parse("2027-03-15T12:00:00-04:00"))).toBe(true);
    expect(perlicaBirthday(Date.parse("2027-03-15T11:59:59-04:00"))).toBe(false);
  });

  it("says her new touches back and notes in her own words", () => {
    expect(touchBackLine("jealous", true, 1, 3, 0)).toBe("今天你碰了 3 只蟑螂，我是第 4 个。");
    expect(touchBackLine("jealous", false, null, 1, 1)).toBe(PERLICA_MORE.onlyAmiya);
    expect(touchBackLine("aside", true, 2, null, 0)).toBe("罗德岛那位……我知道。");
    expect(touchBackLine("birthday", false, null)).toBe("……今天是我的生日。管理员偷偷来，我也认得出来。");
    expect(touchBackLine("birthday", true, 5)).toBe("今天是我的生日。……管理员来了，我很高兴。");
    const item = { bold: true, seconds: null, times: 1, others: null, line: null };
    expect(perlicaText({ ...item, what: "jealous", others: 2, line: 0 })).toBe("佩丽卡监督大胆地碰回来了：「今天你碰了 2 只蟑螂，我是第 3 个。」");
    expect(perlicaText({ ...item, what: "aside", bold: false, line: 0 })).toBe("佩丽卡监督偷偷碰回来了：「罗德岛那位……我知道。」");
    // as you touched 阿米娅向导: no touch of hers back
    expect(perlicaText({ ...item, what: "aside", bold: false, line: 1 })).toBe("佩丽卡监督：「罗德岛那位……我知道。」");
    expect(perlicaText({ ...item, what: "week", bold: false, others: 4, times: 2, line: 1 })).toBe(
      "佩丽卡监督：「监督周报：上周你碰了 4 只蟑螂，碰了我 2 次。……这周也拜托了，管理员。」",
    );
  });

  it("writes her weekly report three ways, ending by its line", () => {
    expect(weekLine(5, 3, 0)).toBe("监督周报：上周你碰了 5 只蟑螂，碰了我 3 次。……数据我都核对过了。");
    expect(weekLine(5, 0, 2)).toBe("监督周报：上周你碰了 5 只蟑螂。……碰我的次数是 0。这一项，下周记得补上。");
    expect(weekLine(0, 3, 2)).toBe("监督周报：上周你谁都没碰，只碰了我，一共 3 次。……下周的，我也会好好记着。");
  });
});
