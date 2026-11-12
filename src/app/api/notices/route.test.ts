import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { forgetNotices, loadNotices } from "@/lib/server/notices";
import { forgetHits } from "@/lib/server/rateLimit";
import { notices } from "@/lib/server/schema";
import { GET } from "./route";

const get = (headers: Record<string, string> = {}) => GET(new NextRequest("http://localhost/api/notices", { headers }));
const add = (title: string) => db.insert(notices).values({ title, body: `${title}的正文`, status: "live", publishedAt: new Date() });

beforeEach(async () => {
  await db.delete(notices);
  forgetNotices();
  forgetHits();
});

describe("the notices' list", () => {
  it("is what is held in memory, its stamp the ETag, and a 304 to a browser that holds it", async () => {
    await add("一");
    await loadNotices();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body.notices.map((n: { title: string }) => n.title)).toEqual(["一"]);
    expect(body.notices[0].body).toBe("一的正文");
    expect(res.headers.get("etag")).toBe(`"${body.stamp}"`);

    const again = await get({ "if-none-match": `"${body.stamp}"` });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(`"${body.stamp}"`);

    // another one published meanwhile: the new list
    await add("二");
    await loadNotices();
    const changed = await get({ "if-none-match": `"${body.stamp}"` });
    expect(changed.status).toBe(200);
    expect((await changed.json()).notices).toHaveLength(2);
  });

  it("is given 60 times a minute to one address, its 304s not counted", async () => {
    await loadNotices();
    const one = { "x-forwarded-for": "203.0.113.9" };
    const first = await get(one);
    const etag = first.headers.get("etag")!;
    for (let i = 1; i < 60; i++) expect((await get(one)).status).toBe(200);
    expect((await get({ ...one, "if-none-match": etag })).status).toBe(304);

    const busy = await get(one);
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("10");
    expect((await busy.json()).error).toBe("人有点多，几秒后自动重试。");
    // a browser holding the list still gets its 304, and another address its list
    expect((await get({ ...one, "if-none-match": etag })).status).toBe(304);
    expect((await get({ "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
  });
});
