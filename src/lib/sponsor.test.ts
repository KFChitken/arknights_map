import { describe, expect, it } from "vitest";
import {
  cardMonth,
  enough,
  inHand,
  isMonth,
  ledger,
  monthOf,
  monthCell,
  monthsCovered,
  monthWords,
  parseYuan,
  repaidOf,
  share,
  sponsorLink,
  whichMonth,
  yuan,
  yuanTyped,
} from "./sponsor";

const month = (m: string, spent: number, received: number) => ({ month: m, spent, received, note: "" });

describe("支持舟P地图", () => {
  it("carries what a month has left over to the next, and never what the owner paid", () => {
    // entered in any order
    const rows = ledger([month("2026-12", 180_000, 250_000), month("2026-11", 200_000, 50_000), month("2027-01", 180_000, 100_000)]);
    expect(rows.map((r) => [r.month, r.carried, r.balance])).toEqual([
      ["2026-11", 0, -150_000],
      ["2026-12", 0, 70_000],
      ["2027-01", 70_000, -10_000],
    ]);
    expect(inHand(rows[2])).toBe(170_000);
    expect(ledger([])).toEqual([]);
  });

  it("pays back what starting the site cost from what the months leave over, before carrying the rest", () => {
    // ¥1,460 to pay back: November leaves ¥1,000, all of it paid back; December ¥800, ¥460 of it paid back and ¥340 carried
    const rows = ledger([month("2026-12", 200_000, 280_000), month("2026-11", 200_000, 300_000), month("2027-01", 200_000, 100_000)], 146_000);
    expect(rows.map((r) => [r.month, r.carried, r.balance, r.repaid])).toEqual([
      ["2026-11", 0, 100_000, 100_000],
      ["2026-12", 0, 80_000, 46_000],
      ["2027-01", 34_000, -66_000, 0],
    ]);
    expect(repaidOf(rows)).toBe(146_000);
    // a month short pays nothing back, and nothing of it carries
    expect(ledger([month("2026-11", 200_000, 50_000), month("2026-12", 0, 0)], 146_000).map((r) => [r.carried, r.balance, r.repaid])).toEqual([
      [0, -150_000, 0],
      [0, 0, 0],
    ]);
    // without one, nothing is paid back
    expect(repaidOf(ledger([month("2026-11", 100, 400), month("2026-12", 100, 400)]))).toBe(0);
  });

  it("shows this Beijing month on the card, else the latest before it, never one ahead", () => {
    const rows = ledger([month("2026-10", 1, 0), month("2026-11", 2, 0), month("2027-01", 3, 0)]);
    // 2026-11-30 16:30 UTC is already 12-01 in Beijing
    expect(cardMonth(rows, Date.parse("2026-11-30T15:59:00Z"))).toMatchObject({ month: "2026-11", current: true });
    expect(cardMonth(rows, Date.parse("2026-11-30T16:30:00Z"))).toMatchObject({ month: "2026-11", current: false });
    expect(cardMonth(rows, Date.parse("2027-02-10T00:00:00Z"))).toMatchObject({ month: "2027-01", current: false });
    expect(cardMonth(rows, Date.parse("2026-09-10T00:00:00Z"))).toBeNull();
    expect(cardMonth([], Date.now())).toBeNull();
    expect(monthOf(Date.parse("2026-11-30T16:30:00Z"))).toBe("2026-12");
  });

  it("says when a month has enough, and how far the bar goes", () => {
    const [first, second] = ledger([month("2026-11", 200_000, 50_000), month("2026-12", 100_000, 120_000)]);
    expect(enough(first)).toBe(false);
    expect(share(first)).toBe(0.25);
    expect(enough(second)).toBe(true);
    expect(share(second)).toBe(1);
    // a month whose bill is not in yet has no bar, and is not 够啦
    const [noBill] = ledger([month("2026-11", 0, 3_000)]);
    expect([enough(noBill), share(noBill)]).toEqual([false, 0]);
    // carried over counts towards it
    const [, carried] = ledger([month("2026-11", 100, 400), month("2026-12", 500, 200)]);
    expect([carried.carried, enough(carried)]).toEqual([300, true]);
  });

  it("counts the whole months what is in hand keeps the servers going, at the month's bill", () => {
    // ¥2,900 a month: ¥3,000 is this month and no more, ¥8,700 three months, ¥8,699.99 still two
    const at = (received: number, carriedIn = 0) =>
      monthsCovered(ledger([month("2026-10", 0, carriedIn), month("2026-11", 290_000, received)])[1]);
    expect([at(100_000), at(290_000), at(300_000), at(869_999), at(870_000)]).toEqual([0, 1, 1, 2, 3]);
    // what the months before left over counts too
    expect(at(200_000, 380_000)).toBe(2);
    // no bill yet, no months
    expect(monthsCovered(ledger([month("2026-11", 0, 50_000)])[0])).toBe(0);
    // what pays back the start is not there for the months after: ¥8,700 in with ¥1,460 still owed is two months
    const owing = ledger([month("2026-11", 290_000, 870_000)], 146_000)[0];
    expect([enough(owing), owing.repaid, monthsCovered(owing)]).toEqual([true, 146_000, 2]);
  });

  it("words sums and months", () => {
    expect(yuan(0)).toBe("¥0");
    expect(yuan(123_456)).toBe("¥1,234.56");
    expect(yuan(200_000)).toBe("¥2,000");
    expect(yuan(3_250)).toBe("¥32.50");
    expect(yuan(-150_000)).toBe("−¥1,500");
    expect(monthWords("2026-11")).toBe("2026 年 11 月");
    expect(monthWords("2027-01")).toBe("2027 年 1 月");
    expect(monthCell("2026-11")).toBe("2026\u00a0年 11\u00a0月");
    expect(whichMonth({ month: "2026-11", current: true })).toBe("这个月");
    expect(whichMonth({ month: "2026-09", current: false })).toBe("9 月");
  });

  it("reads the sums the admin types, in yuan", () => {
    expect(parseYuan("1234")).toBe(123_400);
    expect(parseYuan(" ¥1,234.5 ")).toBe(123_450);
    expect(parseYuan("￥0.05")).toBe(5);
    expect(parseYuan(32.5)).toBe(3_250);
    // and back as they would be typed again
    for (const fen of [0, 5, 10, 29, 3_250, 123_456, 150_000, 100_000_000]) expect(parseYuan(yuanTyped(fen))).toBe(fen);
    expect([yuanTyped(150_000), yuanTyped(32_050), yuanTyped(5)]).toEqual(["1500", "320.5", "0.05"]);
    expect(parseYuan("1000000")).toBe(100_000_000);
    for (const bad of ["", "-5", "1.234", "abc", "1e3", "1000001", "12.", null, undefined, {}]) expect(parseYuan(bad)).toBeNull();
  });

  it("takes only plain https links", () => {
    expect(sponsorLink(" https://ifdian.net/a/someone ")).toBe("https://ifdian.net/a/someone");
    expect(sponsorLink("")).toBe("");
    expect(sponsorLink(undefined)).toBe("");
    for (const bad of ["http://ifdian.net/a/x", "javascript:alert(1)", "ifdian.net/a/x", "https://user:pw@ifdian.net/", "https://localhost/", `https://a.cn/${"x".repeat(300)}`]) {
      expect(sponsorLink(bad)).toBeNull();
    }
  });

  it("knows a month when it sees one", () => {
    expect(isMonth("2026-11")).toBe(true);
    for (const bad of ["2026-13", "2026-1", "1999-01", "2026-11-01", 202611, null]) expect(isMonth(bad)).toBe(false);
  });
});
