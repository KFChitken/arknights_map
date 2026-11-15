import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { amapOutNow, forgetMainlandMap, loadAmapOut, mainlandMap, recordAmapOut } from "./mainlandMap";
import { watchState } from "./schema";

// 2026-11-20 12:00 and the last minute of that day, Beijing time; then the 21st there, still the 20th in UTC
const mid = Date.parse("2026-11-20T04:00:00Z");
const lastMinute = Date.parse("2026-11-20T15:59:00Z");
const nextDay = Date.parse("2026-11-20T16:00:00Z");

beforeEach(async () => {
  await db.delete(watchState).where(eq(watchState.key, "amapOut"));
  forgetMainlandMap();
});

describe("the map visitors from mainland China start with", () => {
  it("is 高德's until it will not give its map loads, then 腾讯's for the rest of the Beijing day", async () => {
    expect(mainlandMap(mid, "auto")).toBe("amap");
    expect(await recordAmapOut(mid)).toBe(true);
    expect(amapOutNow(mid)).toBe("2026-11-20");
    expect(mainlandMap(mid, "auto")).toBe("tencent");
    expect(mainlandMap(lastMinute, "auto")).toBe("tencent");
    // 00:00 in Beijing, though still the 20th in UTC: 高德's first again (2026-11-14: its daily allowance, back by morning)
    expect(mainlandMap(nextDay, "auto")).toBe("amap");
    expect(amapOutNow(nextDay)).toBe(null);
  });

  it("reaches the other processes from the database, and is news once a day", async () => {
    expect(await recordAmapOut(mid)).toBe(true);
    expect(await recordAmapOut(mid + 60_000)).toBe(false);
    // another process: nothing until it reads it, then the same; recording it again there is no news either
    forgetMainlandMap();
    expect(mainlandMap(mid, "auto")).toBe("amap");
    await loadAmapOut();
    expect(mainlandMap(mid, "auto")).toBe("tencent");
    forgetMainlandMap();
    expect(await recordAmapOut(mid)).toBe(false);
    expect(await db.select({ value: watchState.value }).from(watchState).where(eq(watchState.key, "amapOut"))).toEqual([{ value: "2026-11-20" }]);
    // the next day it can happen again
    expect(await recordAmapOut(nextDay)).toBe(true);
    expect(mainlandMap(nextDay, "auto")).toBe("tencent");
  });

  it("is what MAINLAND_MAP holds it to, whatever happens", async () => {
    expect(mainlandMap(mid, "tencent")).toBe("tencent");
    expect(mainlandMap(mid, "own")).toBe("own");
    await recordAmapOut(mid);
    expect(mainlandMap(mid, "amap")).toBe("amap");
    expect(mainlandMap(mid, "own")).toBe("own");
  });

  it("is 高德's when nothing was kept, or something else was: another day, or a month as kept before", async () => {
    await loadAmapOut();
    expect(mainlandMap(mid, "auto")).toBe("amap");
    await db.insert(watchState).values({ key: "amapOut", value: "2026-11-19" });
    await loadAmapOut();
    expect(mainlandMap(mid, "auto")).toBe("amap");
    await db.update(watchState).set({ value: "2026-11" }).where(eq(watchState.key, "amapOut"));
    await loadAmapOut();
    expect(mainlandMap(mid, "auto")).toBe("amap");
  });
});
