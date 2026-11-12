import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { forgetStarted, markStarted } from "@/lib/server/ready";
import { resetRoachFeed, roachFeedSettled, stopRoachFeed } from "@/lib/server/roachFeed";
import { users } from "@/lib/server/schema";
import { GET } from "./route";

let dir = "";
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ready-"));
  process.env.DRAIN_FILE = join(dir, "draining");
  await db.execute(sql`truncate ${users} cascade`);
  resetRoachFeed();
  forgetStarted();
});
afterEach(async () => {
  delete process.env.DRAIN_FILE;
  rmSync(dir, { recursive: true, force: true });
  await roachFeedSettled();
  resetRoachFeed();
  forgetStarted();
});

describe("whether a process is ready for visitors (GET /api/ready)", () => {
  it("is not before it has started, and makes no roach list then", async () => {
    expect((await GET()).status).toBe(503);
    await roachFeedSettled();
    // still nothing made: the database may not be up to date yet
    markStarted();
    expect((await GET()).status).toBe(503);
  });

  it("is once it has started and its roach list is made, which the first ask sets off without waiting", async () => {
    markStarted();
    const first = await GET();
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ ok: false });
    await roachFeedSettled();
    const then = await GET();
    expect(then.status).toBe(200);
    expect(await then.json()).toEqual({ ok: true });
    expect(then.headers.get("cache-control")).toBe("no-store");
  });

  it("is not once it is told to stop", async () => {
    markStarted();
    await GET();
    await roachFeedSettled();
    expect((await GET()).status).toBe(200);
    stopRoachFeed();
    expect((await GET()).status).toBe(503);
  });

  it("is not while a release has said it is about to stop it, and is again once that is taken away", async () => {
    markStarted();
    await GET();
    await roachFeedSettled();
    expect((await GET()).status).toBe(200);
    writeFileSync(process.env.DRAIN_FILE!, "");
    expect((await GET()).status).toBe(503);
    rmSync(process.env.DRAIN_FILE!);
    expect((await GET()).status).toBe(200);
  });
});
