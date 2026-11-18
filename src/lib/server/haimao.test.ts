import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE_TOUCHES_PER_DAY } from "../guides";
import { HAIMAO, HAIMAO_ID, HAIMAO_LINES, HAIMAO_LOVE_MAX, haimaoText } from "../haimao";
import { answerLove, HAIMAO_BADGE, HAIMAO_DAYS } from "../haimaoStory";
import { HAIMAO_WHEEL_BADGE, HAIMAO_WHEEL_LOVE, HAIMAO_WHEEL_TICKETS, WHEEL_SLICES } from "../haimaoWheel";
import { TICKETS_CAP, WELCOME_TICKETS } from "../passes";
import { deleteAccount } from "./account";
import { loadMods } from "./admins";
import { db } from "./db";
import { answerKind, endStory, hasSpun, openStory, pickStory, spinWheel, todayOf, tryStory, wheelOpen } from "./haimao";
import { pretend } from "./demo";
import { openWallet } from "./passes";
import { admins, haimaoPlayers, haimaoSpins, haimaoTouches, passWallets, userBadges, users } from "./schema";
import * as world from "./world";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// Runs against the database named in vitest.config.mts, wiped before every test

async function signUp(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}
const touch = (id: string, bold: boolean) => world.touch(id, HAIMAO_ID, bold);
const herCard = async (id: string) => (await world.me(id))!.haimao;
const player = async (id: string) => (await db.select().from(haimaoPlayers).where(eq(haimaoPlayers.userId, id)))[0];
const hers = async (id: string) =>
  (await db.select().from(haimaoTouches).where(eq(haimaoTouches.userId, id)).orderBy(haimaoTouches.createdAt)).filter(
    (r) => r.direction === "from_haimao",
  );
/** Their touches with her a day back, and the day her 好感度 last went up too: their next touch is a new day's */
async function nextDay(id: string) {
  await db.update(haimaoTouches).set({ createdAt: sql`${haimaoTouches.createdAt} - interval '25 hours'` }).where(eq(haimaoTouches.userId, id));
  await db.update(haimaoPlayers).set({ plusOn: "2000-01-01" }).where(eq(haimaoPlayers.userId, id));
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${haimaoTouches}, ${haimaoPlayers}, ${haimaoSpins}, ${admins} cascade`);
  await loadMods();
  vi.stubEnv("HAIMAO", "on");
});

afterEach(() => vi.unstubAllEnvs());

describe("香艳制作人 on the server", () => {
  it("is nowhere while HAIMAO is off: not in me(), not to be touched, nothing of hers in the inbox or among friends", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    vi.stubEnv("HAIMAO", "off");
    expect(await herCard(me)).toBeUndefined();
    await expect(touch(me, false)).rejects.toThrow("没有这个功能。");
    expect((await world.inbox(me)).filter((i) => i.kind === "haimao")).toEqual([]);
    expect((await world.friends(me)).map((f) => f.id)).not.toContain(HAIMAO_ID);
    // nor is she when the switch is left out
    vi.stubEnv("HAIMAO", "");
    expect(await herCard(me)).toBeUndefined();
  });

  it("shows only to the 站长 and the admins while HAIMAO is admins", async () => {
    const owner = await signUp("owner@example.com");
    const mod = await signUp("mod@example.com");
    const someone = await signUp("someone@example.com");
    await db.insert(admins).values({ userId: mod, role: "mod", alias: "小管" });
    await loadMods();
    vi.stubEnv("HAIMAO", "admins");
    // the two may try her story out (试玩)
    expect(await herCard(owner)).toEqual({ friend: false, love: 0, plusToday: false, days: 0, trial: true });
    expect(await herCard(mod)).toEqual({ friend: false, love: 0, plusToday: false, days: 0, trial: true });
    expect(await herCard(someone)).toBeUndefined();
    await expect(touch(someone, true)).rejects.toThrow("没有这个功能。");
    expect((await touch(owner, true)).newFriend).toBe(HAIMAO.name);
  });

  it("answers a sneaky first touch, keeps her 好感度 as it is, and nothing more that day", async () => {
    const me = await signUp("me@example.com");
    const first = await touch(me, false);
    expect(first).toMatchObject({ newFriend: null, guide: { id: HAIMAO_ID, bold: false, kind: "touch" }, haimao: { answer: "touch", love: 0, plus: false } });
    expect(first.guide!.itemId).toMatch(/^k:/);
    const again = await touch(me, false);
    expect(again.guide!.itemId).toBeNull();
    expect(again.haimao).toEqual({ answer: null, love: 0, plus: false });
    expect(await herCard(me)).toEqual({ friend: false, love: 0, plusToday: false, days: 0 });
    // in the inbox in her own words
    const [item] = (await world.inbox(me)).filter((i) => i.kind === "haimao");
    expect(item).toMatchObject({ id: first.guide!.itemId, line: "touch", bold: false, seen: false, replied: false });
    expect(haimaoText(item as Parameters<typeof haimaoText>[0])).toBe(`香艳制作人回了你：「${HAIMAO_LINES.sneaky}」`);
  });

  it("makes them 触须之交 at the first bold touch, which raises her 好感度 by 1, once a day", async () => {
    const me = await signUp("me@example.com");
    await touch(me, false);
    // answered though it is not the day's first: it makes them friends, and raises her 好感度
    const bold = await touch(me, true);
    expect(bold).toMatchObject({ newFriend: HAIMAO.name, guide: { kind: "friend" }, haimao: { answer: "friend", love: 1, plus: true } });
    expect(bold.guide!.itemId).toMatch(/^k:/);
    expect(await herCard(me)).toEqual({ friend: true, love: 1, plusToday: true, days: 0 });
    // another bold touch that day: nothing more
    expect((await touch(me, true)).haimao).toEqual({ answer: null, love: 1, plus: false });
    expect((await hers(me)).map((r) => r.kind)).toEqual(["touch", "friend"]);
    // the next day the first bold touch raises it again, and is answered with her line for it
    await nextDay(me);
    expect(await herCard(me)).toMatchObject({ love: 1, plusToday: false });
    const next = await touch(me, true);
    expect(next).toMatchObject({ newFriend: null, guide: { kind: "touch" }, haimao: { answer: "plus", love: 2, plus: true } });
    expect(await herCard(me)).toEqual({ friend: true, love: 2, plusToday: true, days: 0 });
    const friends = await world.friends(me);
    expect(friends.find((f) => f.id === HAIMAO_ID)).toMatchObject({ profile: { displayName: HAIMAO.name } });
  });

  it("raises her 好感度 by a bold touch after a sneaky one the same day, answering that one too", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    await nextDay(me);
    expect((await touch(me, false)).haimao).toMatchObject({ answer: "touch", plus: false });
    expect((await touch(me, true)).haimao).toEqual({ answer: "plus", love: 2, plus: true });
  });

  it("never takes her 好感度 past 100: a bold touch then has her line about the lift", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    await db.update(haimaoPlayers).set({ love: HAIMAO_LOVE_MAX, plusOn: "2000-01-01" }).where(eq(haimaoPlayers.userId, me));
    await nextDay(me);
    expect((await touch(me, true)).haimao).toEqual({ answer: "lift", love: HAIMAO_LOVE_MAX, plus: false });
    expect(await player(me)).toMatchObject({ love: HAIMAO_LOVE_MAX, plusOn: "2000-01-01" });
  });

  it("picks her answer: friends, a gain, now and then the lift past 50, else her line to a sneaky touch", () => {
    const t = { bold: false, newFriend: false, raises: false, love: 0, roll: 0 };
    expect(answerKind({ ...t, bold: true, newFriend: true, raises: true })).toBe("friend");
    expect(answerKind({ ...t, bold: true, raises: true, love: 80 })).toBe("plus");
    expect(answerKind({ ...t, love: 50, roll: 0 })).toBe("touch");
    expect(answerKind({ ...t, love: 51, roll: 0 })).toBe("lift");
    expect(answerKind({ ...t, love: 51, roll: 1 })).toBe("touch");
    expect(answerKind({ ...t, bold: true, love: 51, roll: 2 })).toBe("lift");
    expect(answerKind({ ...t, bold: true, love: 20, roll: 2 })).toBe("touch");
  });

  it("is touched back once from the inbox, which counts as touching her, 好感度 and all", async () => {
    const me = await signUp("me@example.com");
    const first = await touch(me, false);
    const back = await world.reply(me, first.guide!.itemId!, true);
    expect(back).toMatchObject({ newFriend: HAIMAO.name, haimao: { answer: "friend", love: 1, plus: true } });
    await expect(world.reply(me, first.guide!.itemId!, true)).rejects.toThrow();
    const [item] = (await world.inbox(me)).filter((i) => i.id === first.guide!.itemId);
    expect(item).toMatchObject({ replied: true });
  });

  it("stays 触须之交 no longer once unfriended, her 好感度 kept; a bold touch makes them friends again", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    await world.unfriend(me, HAIMAO_ID);
    expect(await herCard(me)).toEqual({ friend: false, love: 1, plusToday: true, days: 0 });
    expect((await world.friends(me)).map((f) => f.id)).not.toContain(HAIMAO_ID);
    // answered though it is not the day's first, and her 好感度 is not raised twice in a day
    expect(await touch(me, true)).toMatchObject({ newFriend: HAIMAO.name, haimao: { answer: "friend", love: 1, plus: false } });
  });

  it("says dame dame to a touch past the day's allowance", async () => {
    const me = await signUp("me@example.com");
    for (let i = 0; i < GUIDE_TOUCHES_PER_DAY; i++) await touch(me, i % 2 === 0);
    await expect(touch(me, false)).rejects.toThrow(HAIMAO_LINES.tooMany);
  });

  it("forgets the player when asked in development, and goes with their account", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    await pretend(me, "haimao");
    expect(await herCard(me)).toEqual({ friend: false, love: 0, plusToday: false, days: 0 });
    expect(await db.select().from(haimaoTouches).where(eq(haimaoTouches.userId, me))).toEqual([]);
    await touch(me, true);
    await deleteAccount((await db.select().from(users).where(eq(users.id, me)))[0]);
    expect(await db.select().from(haimaoPlayers)).toEqual([]);
    expect(await db.select().from(haimaoTouches)).toEqual([]);
  });
});

// ---- 今日剧情 ----

/** The day their story last moved on, and their line of the day, a day back: their next look is a new day's */
async function storyNextDay(id: string) {
  await db.update(haimaoPlayers).set({ dayOn: "2000-01-01", chatOn: "2000-01-01" }).where(eq(haimaoPlayers.userId, id));
}
const hasBadge = async (id: string) =>
  (await db.select().from(userBadges).where(eq(userBadges.userId, id))).some((b) => b.badge === HAIMAO_BADGE);
/** Twelve scenes answered (the last today), as a player who came every day */
async function twelveDone(id: string, love = 60) {
  await openStory(id);
  await db
    .update(haimaoPlayers)
    .set({ love, days: HAIMAO_DAYS, dayOn: "2000-01-01", picks: Array.from({ length: HAIMAO_DAYS }, (_, i) => i % 3) })
    .where(eq(haimaoPlayers.userId, id));
}

describe("香艳制作人's story", () => {
  it("opens day 1 to a new player and takes one answer, with the 好感度 it brings; another changes nothing", async () => {
    const me = await signUp("me@example.com");
    expect(await openStory(me)).toEqual({ love: 0, days: 0, picks: [], end: false, today: { kind: "scene", day: 1, picked: null } });
    // the scene opened is not a day used: nothing changes until it is answered
    expect(await player(me)).toMatchObject({ days: 0, dayOn: null });
    expect(await pickStory(me, 1, 0)).toEqual({
      love: answerLove(1, 0),
      days: 1,
      picks: [0],
      end: false,
      today: { kind: "scene", day: 1, picked: 0 },
      plus: 8,
    });
    // a second tap, another answer, or the next day's scene the same day: as things stand, nothing more
    expect(await pickStory(me, 1, 2)).toMatchObject({ love: 8, picks: [0], plus: 0 });
    expect(await pickStory(me, 2, 0)).toMatchObject({ love: 8, days: 1, plus: 0 });
    expect((await openStory(me)).today).toEqual({ kind: "scene", day: 1, picked: 0 });
    // her card counts it seen: 回顾剧情 has a day to list
    expect(await herCard(me)).toMatchObject({ love: 8, days: 1 });
  });

  it("opens the next scene the next day, however many days later, and adds what each answer brings", async () => {
    const me = await signUp("me@example.com");
    await openStory(me);
    await pickStory(me, 1, 1);
    await storyNextDay(me);
    expect((await openStory(me)).today).toEqual({ kind: "scene", day: 2, picked: null });
    // yesterday's page, left open: its answer is not taken today
    expect(await pickStory(me, 1, 0)).toMatchObject({ days: 1, love: 5, plus: 0 });
    expect(await pickStory(me, 2, 2)).toMatchObject({ love: 8, days: 2, picks: [1, 2], plus: 3 });
    // a bold touch the same day still adds its own
    await touch(me, true);
    expect((await openStory(me)).love).toBe(9);
  });

  it("refuses what is not an answer to a scene", async () => {
    const me = await signUp("me@example.com");
    for (const [day, answer] of [
      [0, 0],
      [13, 0],
      [1, 3],
      [1, -1],
      [1.5, 0],
      ["1", "x"],
      [null, null],
    ]) {
      await expect(pickStory(me, day, answer), `${day} ${answer}`).rejects.toThrow("请求格式不对。");
    }
  });

  it("waits after the twelfth for ALL END, on any day: her 好感度 to 100 and the badge, once", async () => {
    const me = await signUp("me@example.com");
    await twelveDone(me);
    await db.update(haimaoPlayers).set({ days: HAIMAO_DAYS - 1 }).where(eq(haimaoPlayers.userId, me));
    expect((await openStory(me)).today).toEqual({ kind: "scene", day: 12, picked: null });
    // not before the twelfth is answered
    expect(await endStory(me)).toMatchObject({ end: false, love: 60, plus: 0 });
    expect(await pickStory(me, 12, 1)).toMatchObject({ love: 65, days: 12, today: { kind: "scene", day: 12, picked: 1 }, plus: 5 });
    // days later it still waits
    await storyNextDay(me);
    expect((await openStory(me)).today).toEqual({ kind: "scene", day: 12, picked: 1 });
    expect(await hasBadge(me)).toBe(false);
    expect(await endStory(me)).toMatchObject({ love: HAIMAO_LOVE_MAX, end: true, today: { kind: "end" }, plus: 35 });
    expect(await hasBadge(me)).toBe(true);
    // again: nothing more, and the day is ALL END's
    expect(await endStory(me)).toMatchObject({ love: HAIMAO_LOVE_MAX, end: true, plus: 0 });
    expect((await openStory(me)).today).toEqual({ kind: "end" });
    expect(await pickStory(me, 12, 0)).toMatchObject({ love: HAIMAO_LOVE_MAX, picks: expect.arrayContaining([1]), plus: 0 });
    // the twelve all there to see again, with the answers picked then
    expect(await herCard(me)).toMatchObject({ love: HAIMAO_LOVE_MAX, days: HAIMAO_DAYS });
    expect((await openStory(me)).picks).toHaveLength(HAIMAO_DAYS);
  });

  it("lets 站长 and the admins try it out: the next day at once, or from the start as for a new player", async () => {
    const owner = await signUp("owner@example.com");
    const me = await signUp("me@example.com");
    expect(await herCard(me)).not.toHaveProperty("trial");
    await expect(tryStory(me, "next")).rejects.toThrow("没有这个功能。");
    await expect(tryStory(me, "restart")).rejects.toThrow("没有这个功能。");
    await openStory(owner);
    await pickStory(owner, 1, 0);
    await touch(owner, true);
    expect(await herCard(owner)).toMatchObject({ plusToday: true });
    expect((await tryStory(owner, "next")).today).toEqual({ kind: "scene", day: 2, picked: null });
    // a day not seen yet is not skipped
    expect((await tryStory(owner, "next")).today).toEqual({ kind: "scene", day: 2, picked: null });
    for (let n = 2; n <= HAIMAO_DAYS; n++) {
      expect(await pickStory(owner, n, 1)).toMatchObject({ days: n, plus: 5 });
      if (n < HAIMAO_DAYS) await tryStory(owner, "next");
    }
    // nor is ALL END
    expect((await tryStory(owner, "next")).today).toEqual({ kind: "scene", day: 12, picked: 1 });
    expect(await endStory(owner)).toMatchObject({ end: true, love: HAIMAO_LOVE_MAX });
    expect(await hasBadge(owner)).toBe(true);
    // then her lines, a day at once
    expect((await tryStory(owner, "next")).today).toEqual({ kind: "chat", line: 0 });
    expect((await openStory(owner)).today).toEqual({ kind: "chat", line: 0 });
    expect((await openStory(owner)).today).toEqual({ kind: "chat", line: 0 });
    await tryStory(owner, "next");
    expect((await openStory(owner)).today).toEqual({ kind: "chat", line: 1 });
    // from the start: no 好感度, no badge, day 1 today, today's bold touch to come again
    expect(await tryStory(owner, "restart")).toEqual({ love: 0, days: 0, picks: [], end: false, today: { kind: "scene", day: 1, picked: null } });
    expect(await hasBadge(owner)).toBe(false);
    expect(await herCard(owner)).toMatchObject({ love: 0, plusToday: false, days: 0, trial: true });
    await touch(owner, true);
    expect(await herCard(owner)).toMatchObject({ love: 1, plusToday: true });
    // and nothing of anyone else's
    expect(await player(me)).toBeUndefined();
  });

  it("then has one line a day, the ten in turn from the first, the same one all day", async () => {
    const me = await signUp("me@example.com");
    await twelveDone(me);
    await endStory(me);
    expect((await openStory(me)).today).toEqual({ kind: "end" });
    const lines: number[] = [];
    for (let day = 0; day < 3; day++) {
      await storyNextDay(me);
      const first = (await openStory(me)).today;
      expect((await openStory(me)).today).toEqual(first);
      if (first.kind === "chat") lines.push(first.line);
    }
    expect(lines).toEqual([0, 1, 2]);
    // nothing to answer, and her 好感度 stays full
    expect(await pickStory(me, 1, 0)).toMatchObject({ love: HAIMAO_LOVE_MAX, plus: 0 });
    // the badge, had it failed to come with ALL END, comes at the next look
    await db.delete(userBadges).where(eq(userBadges.userId, me));
    await openStory(me);
    expect(await hasBadge(me)).toBe(true);
  });

  it("knows what today holds from what is kept", () => {
    const p = { days: 0, dayOn: null, picks: [] as number[], endAt: null, chats: 0, chatOn: null };
    expect(todayOf(p, "2026-11-18")).toEqual({ kind: "scene", day: 1, picked: null });
    expect(todayOf({ ...p, days: 3, dayOn: "2026-11-18", picks: [0, 1, 2] }, "2026-11-18")).toEqual({ kind: "scene", day: 3, picked: 2 });
    expect(todayOf({ ...p, days: 3, dayOn: "2026-11-17", picks: [0, 1, 2] }, "2026-11-18")).toEqual({ kind: "scene", day: 4, picked: null });
    expect(todayOf({ ...p, days: 12, dayOn: "2026-11-01", picks: Array(12).fill(0) }, "2026-11-18")).toEqual({ kind: "scene", day: 12, picked: 0 });
    const ended = { ...p, days: 12, dayOn: "2026-11-01", endAt: new Date(), chatOn: "2026-11-17" };
    expect(todayOf(ended, "2026-11-17")).toEqual({ kind: "end" });
    expect(todayOf(ended, "2026-11-18")).toEqual({ kind: "chat", line: 0 });
    expect(todayOf({ ...ended, chats: 4, chatOn: "2026-11-18" }, "2026-11-18")).toEqual({ kind: "chat", line: 3 });
  });

  it("is not there for a player she does not show to, and forgets their story with them", async () => {
    const me = await signUp("me@example.com");
    await twelveDone(me);
    await endStory(me);
    vi.stubEnv("HAIMAO", "admins");
    await expect(openStory(me)).rejects.toThrow("没有这个功能。");
    await expect(pickStory(me, 1, 0)).rejects.toThrow("没有这个功能。");
    await expect(endStory(me)).rejects.toThrow("没有这个功能。");
    vi.stubEnv("HAIMAO", "on");
    await pretend(me, "haimao");
    expect(await hasBadge(me)).toBe(false);
    expect((await openStory(me)).today).toEqual({ kind: "scene", day: 1, picked: null });
  });
});

// ---- 转 ALL ----

const wallet = async (id: string) => (await db.select().from(passWallets).where(eq(passWallets.userId, id)))[0];
const badgesOf = async (id: string) => (await db.select().from(userBadges).where(eq(userBadges.userId, id))).map((b) => b.badge).sort();
const account = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

describe("香艳制作人's wheel", () => {
  beforeEach(() => vi.stubEnv("PASSES", "on"));

  it("is there only where she shows and 寻访 is open too: on her card, and to spin", async () => {
    const owner = await signUp("owner@example.com");
    const someone = await signUp("someone@example.com");
    expect(await herCard(someone)).toEqual({ friend: false, love: 0, plusToday: false, days: 0, wheel: true });
    vi.stubEnv("PASSES", "admins");
    expect(await herCard(someone)).toEqual({ friend: false, love: 0, plusToday: false, days: 0 });
    expect(wheelOpen(await account(someone))).toBe(false);
    await expect(spinWheel(someone)).rejects.toThrow("没有这个功能。");
    expect((await herCard(owner))?.wheel).toBe(true);
    vi.stubEnv("PASSES", "on");
    vi.stubEnv("HAIMAO", "admins");
    await expect(spinWheel(someone)).rejects.toThrow("没有这个功能。");
    expect(await herCard(someone)).toBeUndefined();
    // nothing was given, nor kept
    expect(await db.select().from(haimaoSpins)).toEqual([]);
    expect(await wallet(someone)).toBeUndefined();
    expect(await badgesOf(someone)).toEqual([]);
  });

  it("gives it all at the one spin: three tickets, the badge, 好感度 +5, her two lines; her card says where it stopped", async () => {
    const me = await signUp("me@example.com");
    expect(await hasSpun(await account(me))).toBe(false);
    const spin = await spinWheel(me);
    expect(spin.landed).toBeGreaterThanOrEqual(1);
    expect(spin.landed).toBeLessThan(WHEEL_SLICES.length);
    // a wallet made for one who never opened 寻访 lights its dot
    expect(spin).toEqual({ landed: spin.landed, love: HAIMAO_WHEEL_LOVE, plus: HAIMAO_WHEEL_LOVE, again: false, passesDot: true });
    expect(await wallet(me)).toMatchObject({ tickets: HAIMAO_WHEEL_TICKETS, welcomed: false });
    expect(await badgesOf(me)).toEqual([HAIMAO_WHEEL_BADGE]);
    expect(await herCard(me)).toEqual({ friend: false, love: HAIMAO_WHEEL_LOVE, plusToday: false, days: 0, wheel: true, spun: spin.landed });
    expect(await hasSpun(await account(me))).toBe(true);
    // the first ten still come when they open 寻访
    expect((await openWallet(await account(me))).tickets).toBe(HAIMAO_WHEEL_TICKETS + WELCOME_TICKETS);
  });

  it("gives nothing more asked again, but answers with where it stopped", async () => {
    const me = await signUp("me@example.com");
    const first = await spinWheel(me);
    const again = await spinWheel(me);
    expect(again).toEqual({ landed: first.landed, love: HAIMAO_WHEEL_LOVE, plus: 0, again: true });
    expect((await wallet(me)).tickets).toBe(HAIMAO_WHEEL_TICKETS);
    expect(await badgesOf(me)).toEqual([HAIMAO_WHEEL_BADGE]);
    expect((await player(me)).love).toBe(HAIMAO_WHEEL_LOVE);
  });

  it("is spun once however many taps come at once", async () => {
    const me = await signUp("me@example.com");
    // and a touch of hers at the same time, which moves her 好感度 too
    const [spins] = await Promise.all([Promise.all(Array.from({ length: 6 }, () => spinWheel(me))), touch(me, true)]);
    expect(spins.filter((s) => !s.again)).toHaveLength(1);
    expect(new Set(spins.map((s) => s.landed)).size).toBe(1);
    expect((await wallet(me)).tickets).toBe(HAIMAO_WHEEL_TICKETS);
    expect(await badgesOf(me)).toEqual([HAIMAO_WHEEL_BADGE]);
    expect((await player(me)).love).toBe(HAIMAO_WHEEL_LOVE + 1);
  });

  it("adds the tickets past the cap, and her 好感度 only up to 100", async () => {
    const me = await signUp("me@example.com");
    await openWallet(await account(me));
    await db.update(passWallets).set({ tickets: TICKETS_CAP }).where(eq(passWallets.userId, me));
    await openStory(me);
    await db.update(haimaoPlayers).set({ love: HAIMAO_LOVE_MAX - 2 }).where(eq(haimaoPlayers.userId, me));
    const spin = await spinWheel(me);
    expect(spin).toMatchObject({ love: HAIMAO_LOVE_MAX, plus: 2, again: false, passesDot: true });
    expect((await wallet(me)).tickets).toBe(TICKETS_CAP + HAIMAO_WHEEL_TICKETS);
  });

  it("goes with what is forgotten of her, but for the tickets, and with their account", async () => {
    const me = await signUp("me@example.com");
    await spinWheel(me);
    await pretend(me, "haimao");
    expect(await db.select().from(haimaoSpins)).toEqual([]);
    expect(await badgesOf(me)).toEqual([]);
    expect((await wallet(me)).tickets).toBe(HAIMAO_WHEEL_TICKETS);
    expect((await herCard(me))?.spun).toBeUndefined();
    await spinWheel(me);
    await deleteAccount(await account(me));
    expect(await db.select().from(haimaoSpins)).toEqual([]);
  });

  it("keeps her two lines theirs only while she shows to them", async () => {
    const me = await signUp("me@example.com");
    await spinWheel(me);
    vi.stubEnv("HAIMAO", "off");
    expect(await hasSpun(await account(me))).toBe(false);
    vi.stubEnv("HAIMAO", "on");
    // 寻访 closed again, the spin stays theirs and so do the lines
    vi.stubEnv("PASSES", "off");
    expect(await hasSpun(await account(me))).toBe(true);
    expect((await herCard(me))?.spun).toBeGreaterThan(0);
  });
});
