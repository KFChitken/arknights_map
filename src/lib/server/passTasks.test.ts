import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMIYA_ID } from "../amiya";
import { TICKETS_CAP, WELCOME_TICKETS, type Task } from "../passes";
import type { LngLat } from "../types";
import { db } from "./db";
import * as friendly from "./friendly";
import * as help from "./help";
import { HttpError } from "./http";
import { claim, didTask, draw, openWallet, passesMe, passState } from "./passes";
import { resetRoachFeed } from "./roachFeed";
import { blocks, passCounters, passWallets, touches, users, type UserRow } from "./schema";
import * as world from "./world";

// 每日任务 (src/lib/passes.ts TASK_MAX): what a player does is counted, and its tickets claimed on the 寻访 page.
// Runs against the database named in vitest.config.mts

/** Noon, Beijing time: well inside a site day */
const NOON = Date.parse("2026-11-14T12:00:00+08:00");
const SQUARE = { lng: 121.4737, lat: 31.2304 };
const NEAR = { lng: 121.48, lat: 31.235 };
const TOKYO = { lng: 139.7, lat: 35.68 };

/** A player who ticked everything, with a main roach where given */
async function player(email: string, at?: LngLat): Promise<UserRow> {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  if (at) await world.placeRoach(u.id, { kind: "main" }, at);
  return u;
}

const mainOf = async (id: string) => (await world.me(id))!.roaches.find((r) => r.slot === 0)!.publicId;

/** A touch's inbox id, the first from one player to another */
async function touchItem(from: string, to: string) {
  const [t] = await db
    .select({ id: touches.id })
    .from(touches)
    .where(and(eq(touches.fromUserId, from), eq(touches.toUserId, to)))
    .orderBy(asc(touches.createdAt))
    .limit(1);
  return `t:${t.id}`;
}

async function wallet(userId: string) {
  const [w] = await db.select().from(passWallets).where(eq(passWallets.userId, userId));
  return w;
}

const setWallet = (userId: string, values: Partial<typeof passWallets.$inferInsert>) =>
  db.update(passWallets).set(values).where(eq(passWallets.userId, userId));

/** Each task's done and claimed today, as the page shows them */
async function tasks(userId: string, now = Date.now()) {
  const s = await passState(userId, now);
  return Object.fromEntries(s.tasks.map((t) => [t.task, [t.done, t.got]])) as Record<Task, [number, number]>;
}
const NONE = { touch: [0, 0], declare: [0, 0], reply: [0, 0], npc: [0, 0] };

/** The refusal a call ends in: its status and words */
async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, message: e.message };
    throw e;
  }
  throw new Error("not refused");
}
const NOTHING = { status: 409, message: "这一项现在没有能领的券。" };

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${passCounters} cascade`);
  resetRoachFeed();
  vi.stubEnv("PASSES", "on");
  vi.stubEnv("PASS_ART", "off");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("每日任务", () => {
  it("counts each task up to 3, 2, 3 and 2 a site day without a ticket, and starts again at 04:00 Beijing time with nothing kept", async () => {
    const u = await player("a@example.com");
    // nothing is written for a player who never opened the page
    expect(await didTask(u.id, "touch", NOON)).toEqual({});
    expect(await wallet(u.id)).toBeUndefined();

    const before4 = Date.parse("2026-11-14T03:59:00+08:00");
    await openWallet(u, before4);
    for (const [task, times] of [["touch", 4], ["declare", 3], ["reply", 4], ["npc", 3]] as const) {
      for (let i = 0; i < times; i++) await didTask(u.id, task, before4);
    }
    expect(await tasks(u.id, before4)).toEqual({ touch: [3, 0], declare: [2, 0], reply: [3, 0], npc: [2, 0] });
    expect((await passState(u.id, before4)).tasks.map((t) => t.max)).toEqual([3, 2, 3, 2]);
    expect((await wallet(u.id)).tickets).toBe(WELCOME_TICKETS);
    // past the day's most: not counted, and nothing for the dot
    expect(await didTask(u.id, "npc", before4)).toEqual({});
    await claim(u, "touch", before4);
    expect(await tasks(u.id, before4)).toMatchObject({ touch: [3, 3] });

    const at4 = Date.parse("2026-11-14T04:00:00+08:00");
    // a new day reads as nothing done, before anything is written; what was not claimed is gone
    expect(await tasks(u.id, at4)).toEqual(NONE);
    expect(await refusal(claim(u, "declare", at4))).toEqual(NOTHING);
    await didTask(u.id, "declare", at4);
    expect(await tasks(u.id, at4)).toEqual({ ...NONE, declare: [1, 0] });
    expect(await wallet(u.id)).toMatchObject({ day: "2026-11-14", tickets: WELCOME_TICKETS + 3, touch: 0, touchGot: 0, declare: 1 });
    expect((await claim(u, "declare", at4)).tickets).toBe(WELCOME_TICKETS + 4);
  });

  it("claims what was done and not claimed yet, as many as 50 leaves room for, the rest later that day", async () => {
    const u = await player("a@example.com");
    await openWallet(u, NOON);
    expect(await refusal(claim(u, "touch", NOON))).toEqual(NOTHING);
    await didTask(u.id, "touch", NOON);
    const once = await claim(u, "touch", NOON);
    expect(once.tickets).toBe(WELCOME_TICKETS + 1);
    expect(once.tasks[0]).toEqual({ task: "touch", done: 1, got: 1, max: 3 });
    // done again after a claim, claimed again
    await didTask(u.id, "touch", NOON);
    await didTask(u.id, "touch", NOON);
    expect((await claim(u, "touch", NOON)).tickets).toBe(WELCOME_TICKETS + 3);
    expect(await refusal(claim(u, "touch", NOON))).toEqual(NOTHING);

    // 50 held: as many as fit; the rest waits for room, that day
    await setWallet(u.id, { tickets: TICKETS_CAP - 1 });
    for (let i = 0; i < 3; i++) await didTask(u.id, "reply", NOON);
    expect((await claim(u, "reply", NOON)).tickets).toBe(TICKETS_CAP);
    expect(await refusal(claim(u, "reply", NOON))).toEqual({ status: 409, message: "手上满 50 张了，先抽掉一些再来领，今天之内都能领。" });
    expect(await tasks(u.id, NOON)).toMatchObject({ reply: [3, 1] });
    await draw(u, 1, NOON);
    expect((await claim(u, "reply", NOON)).tickets).toBe(TICKETS_CAP);
    expect(await tasks(u.id, NOON)).toMatchObject({ reply: [3, 2] });

    expect(await refusal(claim(u, "touches", NOON))).toEqual({ status: 400, message: "没有这个任务。" });
    const never = await player("b@example.com");
    expect(await refusal(claim(never, "touch", NOON))).toEqual({ status: 409, message: "先打开寻访页。" });
  });

  it("gives no more for claims at once than was done, or than 50 leaves room for (the wallet is locked)", async () => {
    const u = await player("a@example.com");
    await openWallet(u, NOON);
    for (let i = 0; i < 3; i++) await didTask(u.id, "touch", NOON);
    const all = await Promise.allSettled(Array.from({ length: 6 }, () => claim(u, "touch", NOON)));
    expect(all.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await wallet(u.id)).toMatchObject({ tickets: WELCOME_TICKETS + 3, touchGot: 3 });

    // two tasks at once with room for 4 of their 5
    await setWallet(u.id, { tickets: TICKETS_CAP - 4 });
    for (let i = 0; i < 3; i++) await didTask(u.id, "reply", NOON);
    for (let i = 0; i < 2; i++) await didTask(u.id, "npc", NOON);
    await Promise.allSettled([claim(u, "reply", NOON), claim(u, "npc", NOON)]);
    const w = await wallet(u.id);
    expect(w.tickets).toBe(TICKETS_CAP);
    expect(w.replyGot + w.npcGot).toBe(4);
  });

  it("lights the dot on the 寻访 button for a ticket to claim, as the action that counted says at once", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    await openWallet(a);
    await setWallet(a.id, { tickets: 0 });
    expect((await passesMe(a))?.dot).toBe(false);
    expect(await world.touch(a.id, await mainOf(b.id), false)).toMatchObject({ passesDot: true });
    expect((await passesMe(a))?.dot).toBe(true);
    await claim(a, "touch");
    expect((await passesMe(a))?.dot).toBe(false);
    // b never opened the page: nothing counted, nothing said
    const back = await world.reply(b.id, await touchItem(a.id, b.id), false);
    expect(back).not.toHaveProperty("passesDot");
    expect(await wallet(b.id)).toBeUndefined();
  });
});

describe("what counts towards 每日任务", () => {
  it("counts a touch on the map and one back from 消息, sneaky or bold, and a guide's as npc", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    await openWallet(a);
    await openWallet(b);
    await world.touch(a.id, await mainOf(b.id), false);
    await world.reply(b.id, await touchItem(a.id, b.id), true);
    expect(await tasks(a.id)).toEqual({ ...NONE, touch: [1, 0] });
    expect(await tasks(b.id)).toEqual({ ...NONE, touch: [1, 0] });
    expect(await world.touch(a.id, AMIYA_ID, true)).toMatchObject({ guide: { id: "amiya" }, passesDot: true });
    expect(await tasks(a.id)).toEqual({ ...NONE, touch: [1, 0], npc: [1, 0] });
  });

  it("counts a declaration and a reply to someone's", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    await openWallet(a);
    await openWallet(b);
    expect(await world.declare(a.id, { template: "launch", game: "arknights" })).toMatchObject({ passesDot: true });
    const [said] = (await world.inbox(b.id)).filter((i) => i.kind === "declaration");
    expect(await world.react(b.id, said.id, "zhouli")).toEqual({ passesDot: true });
    expect(await tasks(a.id)).toEqual({ ...NONE, declare: [1, 0] });
    expect(await tasks(b.id)).toEqual({ ...NONE, reply: [1, 0] });
  });

  it("counts a touch a block keeps from arriving, so 每日任务 never tell who blocked whom", async () => {
    const owner = await player("owner@example.com", SQUARE);
    const toucher = await player("toucher@example.com");
    await openWallet(toucher);
    await db.insert(blocks).values({ blockerId: owner.id, blockedId: toucher.id });
    await world.touch(toucher.id, await mainOf(owner.id), true);
    const [sent] = await db.select({ withheld: touches.withheld }).from(touches).where(eq(touches.fromUserId, toucher.id));
    expect(sent.withheld).toBe(true);
    expect(await tasks(toucher.id)).toEqual({ ...NONE, touch: [1, 0] });
  });

  it("counts nothing of what 触须之交 do for each other, 求助 or 戳一戳", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", TOKYO);
    await world.touch(a.id, await mainOf(b.id), true);
    await world.touch(b.id, await mainOf(a.id), true);
    await openWallet(a);
    const key = world.friendKey(a.id, b.id);
    await friendly.gesture(a.id, key, "hug");
    await friendly.remindSanity(a.id, key);
    await friendly.visit(a.id, key, await mainOf(b.id));

    await db.update(users).set({ games: ["arknights"] });
    await help.askHelp(b.id, { kind: "clues", game: "arknights", clues: [3, 5] });
    const [theirs] = (await help.helpBoard(a.id)).theirs;
    await help.answerHelp(a.id, theirs.id, [3]);

    await world.drink(b.id);
    await world.poke(a.id, await mainOf(b.id));
    expect(await tasks(a.id)).toEqual(NONE);
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS);
  });

  it("counts nothing while PASSES is off, and never fails what it is counted for", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    await openWallet(a);
    vi.stubEnv("PASSES", "off");
    expect(await world.touch(a.id, await mainOf(b.id), false)).not.toHaveProperty("passesDot");
    vi.stubEnv("PASSES", "on");
    expect(await tasks(a.id)).toEqual(NONE);

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("connection lost");
    });
    expect(await didTask(a.id, "declare")).toEqual({});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not counted"), expect.anything());
    expect(await tasks(a.id)).toEqual(NONE);
  });
});
