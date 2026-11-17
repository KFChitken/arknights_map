import { eq, sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GrayMode from "@/components/GrayMode";
import { grayUntilWords } from "../adminConsole";
import { beijingMidnight } from "../beijing";
import { db, pg } from "./db";
import { hearOthers } from "./live";
import { siteSettings, users } from "./schema";
import { endGray, followShown, grayState, grayUntil, isBilibiliUrl, loadSettings, passFollow, setGray, setPassFollow } from "./siteSettings";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function owner() {
  const [u] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
  return u.id;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  await loadSettings();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("关注 B 站领券", () => {
  const FILLED = { on: true, name: "Breeze青嵐", url: "https://space.bilibili.com/12345", code: "K7MQ2X" };

  it("is off with nothing filled till the owner fills it; a change keeps the rest, the code as it is compared", async () => {
    const by = await owner();
    expect(passFollow()).toEqual({ on: false, name: "", url: "", code: "" });
    expect(followShown(passFollow())).toBe(false);
    expect(await setPassFollow(by, { name: " Breeze青嵐 ", url: " https://space.bilibili.com/12345 " })).toEqual({
      on: false,
      name: "Breeze青嵐",
      url: "https://space.bilibili.com/12345",
      code: "",
    });
    expect(await setPassFollow(by, { code: " k7m q2x ", on: true })).toEqual(FILLED);
    expect(passFollow()).toEqual(FILLED);
    expect(followShown(passFollow())).toBe(true);
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, "pass_follow"));
    expect(row).toMatchObject({ value: FILLED, updatedBy: by });
    // 寻访 shows it only with all of it filled
    for (const off of [{ on: false }, { code: "" }, { url: "" }, { name: "" }]) {
      await setPassFollow(by, off);
      expect(followShown(passFollow()), JSON.stringify(off)).toBe(false);
      await setPassFollow(by, FILLED);
    }
    // as every process reads it again
    await loadSettings();
    expect(passFollow()).toEqual(FILLED);
  });

  it("takes only B 站's own https links, an account and a code not too long, and on as on or off", async () => {
    const by = await owner();
    for (const url of ["https://space.bilibili.com/12345", "https://m.bilibili.com/space/12345", "https://bilibili.com/", "https://b23.tv/AbCdEf", "https://SPACE.BILIBILI.COM/1"]) {
      expect(isBilibiliUrl(url), url).toBe(true);
    }
    for (const url of [
      "http://space.bilibili.com/12345",
      "https://bilibili.com.example.com/",
      "https://evilbilibili.com/",
      "https://user:pw@space.bilibili.com/1",
      "https://b23.tv.example.com/",
      "javascript:alert(1)",
      "space.bilibili.com/12345",
      "",
    ]) {
      expect(isBilibiliUrl(url), url).toBe(false);
    }
    const link = "链接要是 B 站的 https 链接，比如 https://space.bilibili.com/…，或者 https://b23.tv/…。";
    await expect(setPassFollow(by, { url: "http://space.bilibili.com/1" })).rejects.toMatchObject({ status: 400, message: link });
    await expect(setPassFollow(by, { url: 12345 })).rejects.toMatchObject({ status: 400, message: link });
    await expect(setPassFollow(by, { on: "yes" })).rejects.toMatchObject({ status: 400, message: "开关只能开或关。" });
    await expect(setPassFollow(by, { name: "名".repeat(31) })).rejects.toMatchObject({ status: 400, message: "账号最多 30 个字。" });
    await expect(setPassFollow(by, { code: "A".repeat(21) })).rejects.toMatchObject({ status: 400, message: "口令最多 20 个字，空格不算。" });
    await expect(setPassFollow(by, { code: null })).rejects.toMatchObject({ status: 400 });
    expect(await db.select().from(siteSettings)).toEqual([]);
    // spaces are not counted; a link may be taken away
    expect((await setPassFollow(by, { code: "abcd efgh ijkl mnop qrst" })).code).toBe("ABCDEFGHIJKLMNOPQRST");
    expect((await setPassFollow(by, { url: "https://b23.tv/AbCdEf" })).url).toBe("https://b23.tv/AbCdEf");
    expect((await setPassFollow(by, { url: "" })).url).toBe("");
  });

  it("forgets what was kept wrong, as if never filled", async () => {
    await db.insert(siteSettings).values({ key: "pass_follow", value: { on: "yes", name: 3, url: "http://example.com/", code: "x".repeat(40) } });
    await loadSettings();
    expect(passFollow()).toEqual({ on: false, name: "", url: "", code: "" });
  });
});

describe("全站变灰", () => {
  it("is on until the time set, and off by itself after, from memory", async () => {
    const by = await owner();
    const now = Date.now();
    expect(grayUntil(now)).toBeNull();
    const until = now + 2 * HOUR;
    expect(await setGray(by, until, now)).toBe(until);
    expect(grayUntil(now)).toBe(until);
    expect(grayUntil(until - 1)).toBe(until);
    expect(grayUntil(until)).toBeNull();
    expect(grayState(now)).toMatchObject({ until, memorial: { name: expect.any(String), days: expect.any(Number) } });
    // kept as an ISO time, by whom
    const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, "gray"));
    expect(row).toMatchObject({ value: { until: new Date(until).toISOString() }, updatedBy: by });

    // set again: the new time
    await setGray(by, now + DAY, now);
    expect(grayUntil(now)).toBe(now + DAY);
    // ended: the row goes, and it says whether the site was gray till then
    expect(await endGray(now)).toBe(true);
    expect(grayUntil(now)).toBeNull();
    expect(await db.select().from(siteSettings)).toEqual([]);
    expect(await endGray(now)).toBe(false);
  });

  it("takes only a time from now to 7 days ahead", async () => {
    const by = await owner();
    const now = Date.now();
    for (const until of [now, now - 1, now + 7 * DAY + 1, NaN, "tomorrow", null]) {
      await expect(setGray(by, until, now)).rejects.toMatchObject({ status: 400, message: "恢复时间要在现在到 7 天以内。" });
    }
    expect(await db.select().from(siteSettings)).toEqual([]);
    await setGray(by, now + 7 * DAY, now);
    expect(grayUntil(now)).toBe(now + 7 * DAY);
  });

  it("says when it ends in Beijing time, a midnight as the day before's 24:00", () => {
    const now = Date.parse("2026-11-12T10:00:00+08:00");
    expect(grayUntilWords(beijingMidnight("2026-11-13"), now)).toBe("今天 24:00");
    expect(grayUntilWords(beijingMidnight("2026-11-14"), now)).toBe("明天 24:00");
    expect(grayUntilWords(Date.parse("2026-11-15T08:30:00+08:00"), now)).toBe("11/15 08:30");
    expect(grayUntilWords(beijingMidnight("2026-11-13"))).toBe("11/12 24:00");
  });

  it("grays the page from its first look, rendered on the server, and not when it is off", () => {
    const gray = renderToString(createElement(GrayMode, { until: Date.now() + HOUR }));
    expect(gray).toContain("<style>html{filter:grayscale(1)}</style>");
    expect(renderToString(createElement(GrayMode, { until: null }))).toBe("");
  });

  // last: it leaves this process listening to the others
  it("is heard from another process at once", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await hearOthers();
    const until = Date.now() + HOUR;
    await db.insert(siteSettings).values({ key: "gray", value: { until: new Date(until).toISOString() } });
    expect(grayUntil()).toBeNull();
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "settings" }));
    await vi.waitFor(() => expect(grayUntil()).toBe(until));
    await db.delete(siteSettings);
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "settings" }));
    await vi.waitFor(() => expect(grayUntil()).toBeNull());
  });
});
