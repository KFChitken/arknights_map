import { describe, expect, it } from "vitest";
import { besideMain, MINE_PX } from "@/components/map/guideMarker";
import { awayBand, awaySentence, FAR_M, formatAway, NEAR_M, perlicaText, spotNear, touchBackLine } from "./perlica";

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
    const item = { bold: true, seconds: null, line: null, times: 3 };
    expect(perlicaText({ ...item, what: "touch" })).toBe("佩丽卡监督大胆地碰回来了：「管理员主动碰我了。今天第 3 次，我记下了。」");
    expect(perlicaText({ ...item, what: "away", bold: false, seconds: 1388, line: 0 })).toBe(
      "佩丽卡监督：「23 分 8 秒。……我没有在数，是计时器自己在走。」",
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
});
