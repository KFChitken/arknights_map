import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { siteDay, siteDayStart } from "../siteDay";
import type { LngLat } from "../types";
import { db } from "./db";
import { declarations, roaches, users } from "./schema";
import { studyDone, studyToday } from "./study";
import { studyAnnounce, studyGiveUpSaying } from "./studySay";
import * as world from "./world";

// four courses, none held back: what is tested here is what is said, not the games
vi.mock("../study/courses", () => {
  const COURSE_IDS = ["stopwatch", "react325", "echo325", "find325"];
  return { COURSE_IDS, coursesFor: () => COURSE_IDS, isCourse: (v: unknown) => typeof v === "string" && COURSE_IDS.includes(v) };
});

const SQUARE: LngLat = { lng: 121.4737, lat: 31.2304 };
const NEARBY: LngLat = { lng: 121.49, lat: 31.24 };

async function account(email: string) {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  return u.id;
}
const who = (id: string) => ({ id, email: "player@example.com" });
const mainRoach = (userId: string, at: LngLat) => db.insert(roaches).values({ userId, slot: 0, lng: at.lng, lat: at.lat });

/** Today's course, five rounds of it lost: it may be given up */
async function loseFive(id: string) {
  const { course } = await studyToday(who(id));
  for (let i = 0; i < 5; i++) await studyDone(who(id), course, false);
  return course;
}

const sentBy = (id: string) => db.select().from(declarations).where(eq(declarations.senderId, id));

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("325大学习's two declarations", () => {
  it("says 苦也！ from the main roach the moment today's course is given up, to the players near, once", async () => {
    const me = await account("me@example.com");
    const near = await account("near@example.com");
    await mainRoach(me, SQUARE);
    await mainRoach(near, NEARBY);
    const course = await loseFive(me);
    expect(await studyGiveUpSaying(who(me), course)).toEqual({
      done: true,
      days: 1,
      fails: 5,
      skipped: true,
      said: { reach: expect.stringContaining("收到了你的宣言") },
    });
    // what the player near gets: 苦也！, its own four replies first
    const got = (await world.inbox(near)).find((i) => i.kind === "declaration");
    expect(got).toMatchObject({ text: "苦也！" });
    expect(got?.kind === "declaration" && got.options.slice(0, 4).map((r) => r.text)).toEqual(["抱抱，明天再学", "我今天也没过", "325 不会跑的", "同是苦学人，碰我一下"]);
    expect((await sentBy(me)).map((d) => d.template)).toEqual(["kuye"]);
    // given up already: as it is, and nothing said again, a minute later too
    await db.update(declarations).set({ createdAt: sql`created_at - interval '2 minutes'` }).where(eq(declarations.senderId, me));
    expect(await studyGiveUpSaying(who(me), course)).toEqual({ done: true, days: 1, fails: 5, skipped: true });
    expect(await sentBy(me)).toHaveLength(1);
  });

  it("gives today up all the same when 苦也！ cannot be said: no main roach, said a moment ago, interactions paused", async () => {
    const none = await account("none@example.com");
    expect(await studyGiveUpSaying(who(none), await loseFive(none))).toEqual({
      done: true,
      days: 1,
      fails: 5,
      skipped: true,
      said: { failed: T.server.world.mainBeforeDeclaring },
    });

    const chatty = await account("chatty@example.com");
    await mainRoach(chatty, SQUARE);
    await world.declare(chatty, { template: "stronghold" });
    expect(await studyGiveUpSaying(who(chatty), await loseFive(chatty))).toMatchObject({
      done: true,
      days: 1,
      skipped: true,
      said: { failed: T.server.world.declaredJustNow },
    });

    const paused = await account("paused@example.com");
    await mainRoach(paused, SQUARE);
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, paused));
    const d = await studyGiveUpSaying(who(paused), await loseFive(paused));
    expect(d).toMatchObject({ done: true, days: 1, skipped: true, said: { failed: expect.stringContaining("暂停") } });
    expect(await sentBy(paused)).toHaveLength(0);
    for (const id of [none, chatty, paused]) {
      expect((await db.select().from(users).where(eq(users.id, id)))[0]).toMatchObject({ studyDays: 1, studiedOn: siteDay(), studySkippedOn: siteDay() });
    }
  });

  it("says 已完成今日的325大学习 once today's course is done, once a site day", async () => {
    const me = await account("me@example.com");
    await mainRoach(me, SQUARE);
    const { course } = await studyToday(who(me));
    await expect(studyAnnounce(who(me))).rejects.toMatchObject({ status: 409, message: "今天这门上完了才能发这句。" });
    // a round lost is not done
    await studyDone(who(me), course, false);
    await expect(studyAnnounce(who(me))).rejects.toMatchObject({ status: 409 });
    expect(await studyToday(who(me))).toMatchObject({ done: false, announced: false });

    await studyDone(who(me), course, true);
    expect(await studyToday(who(me))).toMatchObject({ done: true, announced: false });
    expect(await studyAnnounce(who(me))).toEqual({ reach: expect.stringContaining("宣言") });
    expect(await studyToday(who(me))).toMatchObject({ done: true, announced: true });
    expect((await sentBy(me)).map((d) => d.template)).toEqual(["studied"]);
    // a second time today: refused, a minute later too
    await db.update(declarations).set({ createdAt: sql`created_at - interval '2 minutes'` }).where(eq(declarations.senderId, me));
    await expect(studyAnnounce(who(me))).rejects.toMatchObject({ status: 409, message: "今天已经发过这句了。" });
    // said before today's site day began, at 04:00 Beijing time: yesterday's, so today's may be said
    await db
      .update(declarations)
      .set({ createdAt: new Date(siteDayStart(siteDay()) - 60_000) })
      .where(eq(declarations.senderId, me));
    expect((await studyToday(who(me))).announced).toBe(false);
    expect(await studyAnnounce(who(me))).toEqual({ reach: expect.any(String) });
  });

  it("refuses 已完成今日的325大学习 as any declaration is refused, and while interactions are paused", async () => {
    const me = await account("me@example.com");
    const { course } = await studyToday(who(me));
    await studyDone(who(me), course, true);
    await expect(studyAnnounce(who(me))).rejects.toThrow(T.server.world.mainBeforeDeclaring);
    await mainRoach(me, SQUARE);
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, me));
    await expect(studyAnnounce(who(me))).rejects.toMatchObject({ status: 403, message: expect.stringContaining("暂停") });
    await db.update(users).set({ suspendedUntil: null }).where(eq(users.id, me));
    // nor from the sheet, ever
    await expect(world.declare(me, { template: "studied" })).rejects.toThrow("这句只能在325大学习里发。");
    await expect(world.declare(me, { template: "kuye" })).rejects.toThrow("这句只能在325大学习里发。");
    expect(await sentBy(me)).toHaveLength(0);
    expect(await studyAnnounce(who(me))).toEqual({ reach: expect.any(String) });
  });
});
