import { describe, expect, it } from "vitest";
import { memorialWords, nextMemorial, qingmingDay } from "./memorials";

describe("纪念日", () => {
  it("puts 清明 on the 4th or the 5th of April by the formula", () => {
    expect(qingmingDay(2025)).toBe(4);
    expect(qingmingDay(2026)).toBe(5);
    expect(qingmingDay(2027)).toBe(5);
    expect(qingmingDay(2028)).toBe(4);
  });

  it("finds the next from a Beijing date, today's own included, into the year after", () => {
    expect(nextMemorial("2026-11-12")).toEqual({ date: "2026-12-13", name: "南京大屠杀死难者国家公祭日", days: 31 });
    expect(nextMemorial("2026-12-13")).toEqual({ date: "2026-12-13", name: "南京大屠杀死难者国家公祭日", days: 0 });
    expect(nextMemorial("2026-12-14")).toMatchObject({ date: "2027-04-05", name: "清明节" });
    expect(nextMemorial("2027-09-04")).toMatchObject({ date: "2027-09-18", days: 14 });
    expect(nextMemorial("2027-09-19")).toMatchObject({ date: "2027-09-30", name: "烈士纪念日" });
  });

  it("says it as the 管理台 shows it", () => {
    expect(memorialWords({ date: "2026-12-13", name: "南京大屠杀死难者国家公祭日", days: 31 })).toBe(
      "下一个纪念日：12 月 13 日，南京大屠杀死难者国家公祭日（还有 31 天）。",
    );
    expect(memorialWords({ date: "2026-12-13", name: "南京大屠杀死难者国家公祭日", days: 0 })).toBe("今天是南京大屠杀死难者国家公祭日。");
  });
});
