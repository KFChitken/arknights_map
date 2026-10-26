import { describe, expect, it } from "vitest";
import { distanceKm } from "../geo";
import { BOT_FREE_KM, botRoaches, isBotId } from "./bots";

describe("show roaches", () => {
  it("are the same every time, marked as nobody's, and none when switched off", () => {
    const bots = botRoaches(3000);
    expect(bots).toHaveLength(3000);
    expect(botRoaches(3000)).toEqual(bots);
    expect(bots.every((b) => b.bot && isBotId(b.id) && !b.clone)).toBe(true);
    expect(new Set(bots.map((b) => b.id)).size).toBe(3000);
    expect(new Set(bots.map((b) => b.avatar))).toEqual(new Set(["hood", "doctor", "endmin", "imp"]));
    expect(botRoaches(0)).toEqual([]);
    expect(isBotId("2f4c8a3e-1d2b-4c5d-9e8f-0a1b2c3d4e5f")).toBe(false);
    // none in Beijing, so testers there can find the real players
    expect(bots.filter((b) => distanceKm(b, { lng: 116.4, lat: 39.9 }) <= BOT_FREE_KM)).toEqual([]);
  });
});
