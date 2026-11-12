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
import { endGray, grayState, grayUntil, loadSettings, setGray } from "./siteSettings";

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
