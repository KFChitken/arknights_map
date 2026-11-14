import { describe, expect, it } from "vitest";
import { nextSiteDayAt, siteDay, siteDayStart } from "./siteDay";

const at = (s: string) => Date.parse(s);

describe("the site's day", () => {
  it("turns at 04:00 Beijing time, wherever the player is", () => {
    expect(siteDay(at("2026-11-14T03:59:59.999+08:00"))).toBe("2026-11-13");
    expect(siteDay(at("2026-11-14T04:00:00+08:00"))).toBe("2026-11-14");
    expect(siteDay(at("2026-11-14T23:59:00+08:00"))).toBe("2026-11-14");
    expect(siteDay(at("2026-11-15T00:30:00+08:00"))).toBe("2026-11-14");
    // evening in Chicago is the next morning in Beijing
    expect(siteDay(at("2026-11-13T14:30:00-06:00"))).toBe("2026-11-14");
    expect(siteDay(at("2026-11-13T13:59:00-06:00"))).toBe("2026-11-13");
  });

  it("knows when a day begins, and when the next one does", () => {
    expect(siteDayStart("2026-11-14")).toBe(at("2026-11-14T04:00:00+08:00"));
    expect(nextSiteDayAt(at("2026-11-14T03:00:00+08:00"))).toBe(at("2026-11-14T04:00:00+08:00"));
    expect(nextSiteDayAt(at("2026-11-14T04:00:00+08:00"))).toBe(at("2026-11-15T04:00:00+08:00"));
    expect(nextSiteDayAt(at("2026-12-31T20:00:00+08:00"))).toBe(at("2027-01-01T04:00:00+08:00"));
  });
});
