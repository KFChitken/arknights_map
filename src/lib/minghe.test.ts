import { describe, expect, it } from "vitest";
import { addDays, beijingMidnight } from "./beijing";
import { distanceKm } from "./geo";
import {
  bearing,
  dateOfDay,
  metresApart,
  MINGHE_FIRST_DAY,
  MINGHE_LINES,
  mingheDay,
  mingheText,
  mingheTouchLine,
  nextStationAt,
  QUEUE,
  queueBearing,
  queueSpot,
  queueSpots,
  rideLine,
  ROUTE,
  stationLines,
  stationLine,
  stationOf,
  stopOf,
  trailOf,
  tripStops,
} from "./minghe";

const HOUR = 3_600_000;
/** A moment of a day of his journey, Beijing time */
const at = (day: number, hhmm: string) => Date.parse(`${addDays(MINGHE_FIRST_DAY, day)}T${hhmm}:00+08:00`);

describe("明河都尉's route", () => {
  it("has 30 stations, each with its own name, and his own lines at seven of them", () => {
    expect(ROUTE).toHaveLength(30);
    expect(new Set(ROUTE.map((s) => s.name)).size).toBe(30);
    expect(ROUTE[0].name).toBe("张家界·武陵源");
    expect(ROUTE.flatMap((s, i) => (s.line ? [i + 1] : []))).toEqual([1, 2, 6, 15, 20, 27, 28]);
    // all in mainland China, a few hundred km apart at most
    for (const [i, s] of ROUTE.entries()) {
      expect(s.at.lng).toBeGreaterThan(100);
      expect(s.at.lng).toBeLessThan(125);
      expect(s.at.lat).toBeGreaterThan(22);
      expect(s.at.lat).toBeLessThan(42);
      expect(distanceKm(s.at, stationOf(i + 1).at)).toBeLessThan(1500);
    }
  });

  it("moves on at 04:00 Beijing time, from 武陵源 on the first day, round again after 30", () => {
    expect(mingheDay(at(0, "12:00"))).toBe(0);
    // before he set out, he waits at the first station
    expect(mingheDay(at(-5, "12:00"))).toBe(0);
    expect(mingheDay(at(1, "03:59"))).toBe(0);
    expect(mingheDay(at(1, "04:00"))).toBe(1);
    expect(stationOf(mingheDay(at(29, "12:00"))).name).toBe("厦门·鼓浪屿");
    expect(stationOf(mingheDay(at(30, "12:00"))).name).toBe("张家界·武陵源");
    expect(stopOf(61)).toBe(1);
    // 明河快进一天, in development
    expect(mingheDay(at(0, "12:00"), 3)).toBe(3);
    expect(dateOfDay(2)).toBe(addDays(MINGHE_FIRST_DAY, 2));
    expect(nextStationAt(at(3, "12:00"))).toBe(at(4, "04:00"));
    expect(nextStationAt(at(3, "02:00"))).toBe(at(3, "04:00"));
    expect(nextStationAt(beijingMidnight(MINGHE_FIRST_DAY) + 4 * HOUR)).toBe(at(1, "04:00"));
  });

  it("draws the trail through the stations passed, the last 7 at most, round the end of the route", () => {
    expect(trailOf(0)).toEqual([ROUTE[0].at]);
    expect(trailOf(3)).toEqual(ROUTE.slice(0, 4).map((s) => s.at));
    expect(trailOf(10)).toEqual(ROUTE.slice(4, 11).map((s) => s.at));
    expect(trailOf(32)).toEqual([...ROUTE.slice(26, 30), ...ROUTE.slice(0, 3)].map((s) => s.at));
  });

  it("says his own line at a station that has one, and the three shared ones in turn elsewhere", () => {
    expect(stationLine(0)).toBe("这里也叫武陵。山像是谁一笔一笔画出来的。");
    expect(stationLine(30)).toBe(stationLine(0));
    const shared = stationLines();
    expect([2, 3, 4].map(stationLine)).toEqual([shared[2], shared[0], shared[1]]);
  });
});

describe("明河都尉's riders", () => {
  it("queue three abreast behind him, 10 m apart and 12 m between rows, 14 m back to the first", () => {
    for (let stop = 0; stop < 30; stop++) {
      const spots = Array.from({ length: 60 }, (_, k) => queueSpot(stop, k));
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) expect(metresApart(spots[i], spots[j])).toBeGreaterThanOrEqual(9.9);
      }
      expect(metresApart(spots[0], stationOf(stop).at)).toBeCloseTo(QUEUE.first, 0);
      expect(metresApart(spots[3], stationOf(stop).at)).toBeCloseTo(QUEUE.first + QUEUE.apart, 0);
    }
  });

  it("queue the way the route table says, or back towards the station before", () => {
    // 长沙·橘子洲: up the island, to the north
    const s = stationOf(2).at;
    expect(bearing(s, queueSpot(2, 0))).toBeCloseTo(0, 0);
    expect(queueSpot(2, 0).lat).toBeGreaterThan(s.lat);
    // 武汉·黄鹤楼 has none: towards 岳阳楼
    expect(queueBearing(4)).toBeCloseTo(bearing(stationOf(4).at, stationOf(3).at), 6);
    expect(bearing(stationOf(4).at, queueSpot(4, 0))).toBeCloseTo(queueBearing(4), 0);
  });

  it("take the first free spots, past any roach already standing there", () => {
    const first = queueSpots(5, 3);
    expect(first).toEqual([0, 1, 2].map((k) => queueSpot(5, k)));
    const taken = [queueSpot(5, 0), queueSpot(5, 2)];
    expect(queueSpots(5, 3, taken)).toEqual([1, 3, 4].map((k) => queueSpot(5, k)));
    // a roach in another city takes nothing here
    expect(queueSpots(5, 1, [stationOf(6).at])).toEqual([queueSpot(5, 0)]);
  });

  it("give each rider a spot of their own however long the queue, past 2 km too", () => {
    // 1500 riders already queued: 500 rows, some 6 km back from him
    const taken = Array.from({ length: 1500 }, (_, k) => queueSpot(5, k));
    expect(metresApart(taken[1499], stationOf(5).at)).toBeGreaterThan(5000);
    const next = queueSpots(5, 20, taken);
    expect(next).toEqual(Array.from({ length: 20 }, (_, k) => queueSpot(5, 1500 + k)));
    for (const s of next) expect(taken.every((t) => metresApart(t, s) >= 9.9)).toBe(true);
    // never two on one spot, thousands at once
    const many = queueSpots(5, 4000);
    expect(new Set(many.map((s) => `${s.lng.toFixed(6)},${s.lat.toFixed(6)}`)).size).toBe(4000);
  });

  it("lay out a long queue at once", () => {
    const taken = Array.from({ length: 5000 }, (_, k) => queueSpot(9, k * 2));
    const t0 = performance.now();
    expect(queueSpots(9, 200, taken)).toHaveLength(200);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("明河都尉's lines", () => {
  it("answer a touch the way it came, and say where a clone got on and off and how its trip went", () => {
    expect(mingheTouchLine("touch", false)).toBe(MINGHE_LINES.sneaky);
    expect(mingheTouchLine("touch", true)).toBe(MINGHE_LINES.bold);
    expect(mingheTouchLine("friend", true)).toBe(MINGHE_LINES.friend);
    expect(rideLine(29)).toBe("上来吧。今天在厦门·鼓浪屿，明天去张家界·武陵源。");
    const item = (line: "touch" | "friend" | "ride" | "dismount" | "trip", bold = false, stop: number | null = 2, times: number | null = null) =>
      mingheText({ line, bold, stop, times });
    expect(item("touch", true)).toBe("明河都尉回了你：「管理员。来得正好，前面的路，一起走一段？」");
    expect(item("touch")).toBe("明河都尉回了你：「这一下很轻，不过我察觉到了。管理员，一路可好？」");
    expect(item("friend")).toBe("明河都尉和你成为了触须之交：「你给过我的答案，我一直记着。往后这一路，有我。」");
    expect(item("ride")).toBe("你的克隆体跟上了明河都尉：「上来吧。今天在长沙·橘子洲，明天去岳阳·岳阳楼。」");
    expect(item("dismount")).toBe("你的克隆体在长沙·橘子洲下了马，明河都尉说：「就在长沙·橘子洲下吗？好，这里的灯火不错。」");
    expect(item("trip", false, 27, 12)).toBe("明河都尉送你的克隆体回来了：「7 站走完了。这一路，你的克隆体被碰了 12 次。辛苦了，我送你回去。」");
    expect(tripStops(27)).toEqual(["广州·天河", "深圳·深圳湾", "厦门·鼓浪屿", "张家界·武陵源", "常德·桃花源", "长沙·橘子洲", "岳阳·岳阳楼"]);
  });
});
