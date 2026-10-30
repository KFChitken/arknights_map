import { describe, expect, it } from "vitest";
import { nextMorning } from "./morning";

const at = (iso: string) => Date.parse(iso);

describe("the next morning where a roach lies", () => {
  it("is the next 8:00 by the local clock, guessed from the longitude", () => {
    const beijing = { lng: 116.4, lat: 39.9 };
    expect(nextMorning(beijing, at("2026-11-01T22:30+08:00"))).toBe(at("2026-11-02T08:00+08:00"));
    expect(nextMorning(beijing, at("2026-11-02T07:59+08:00"))).toBe(at("2026-11-02T08:00+08:00"));
    expect(nextMorning(beijing, at("2026-11-02T08:00+08:00"))).toBe(at("2026-11-03T08:00+08:00"));
    expect(nextMorning({ lng: -0.13, lat: 51.5 }, at("2026-11-01T23:00Z"))).toBe(at("2026-11-02T08:00Z"));
    expect(nextMorning({ lng: -74, lat: 40.7 }, at("2026-11-01T23:00-05:00"))).toBe(at("2026-11-02T08:00-05:00"));
  });
});
