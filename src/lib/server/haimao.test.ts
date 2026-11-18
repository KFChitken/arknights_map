import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUIDE_TOUCHES_PER_DAY } from "../guides";
import { HAIMAO, HAIMAO_ID, HAIMAO_LINES, HAIMAO_LOVE_MAX, haimaoText } from "../haimao";
import { deleteAccount } from "./account";
import { loadMods } from "./admins";
import { db } from "./db";
import { answerKind } from "./haimao";
import { pretend } from "./demo";
import { admins, haimaoPlayers, haimaoSpins, haimaoTouches, users } from "./schema";
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
    expect(await herCard(owner)).toEqual({ friend: false, love: 0, plusToday: false });
    expect(await herCard(mod)).toEqual({ friend: false, love: 0, plusToday: false });
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
    expect(await herCard(me)).toEqual({ friend: false, love: 0, plusToday: false });
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
    expect(await herCard(me)).toEqual({ friend: true, love: 1, plusToday: true });
    // another bold touch that day: nothing more
    expect((await touch(me, true)).haimao).toEqual({ answer: null, love: 1, plus: false });
    expect((await hers(me)).map((r) => r.kind)).toEqual(["touch", "friend"]);
    // the next day the first bold touch raises it again, and is answered with her line for it
    await nextDay(me);
    expect(await herCard(me)).toMatchObject({ love: 1, plusToday: false });
    const next = await touch(me, true);
    expect(next).toMatchObject({ newFriend: null, guide: { kind: "touch" }, haimao: { answer: "plus", love: 2, plus: true } });
    expect(await herCard(me)).toEqual({ friend: true, love: 2, plusToday: true });
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
    expect(await herCard(me)).toEqual({ friend: false, love: 1, plusToday: true });
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
    expect(await herCard(me)).toEqual({ friend: false, love: 0, plusToday: false });
    expect(await db.select().from(haimaoTouches).where(eq(haimaoTouches.userId, me))).toEqual([]);
    await touch(me, true);
    await deleteAccount((await db.select().from(users).where(eq(users.id, me)))[0]);
    expect(await db.select().from(haimaoPlayers)).toEqual([]);
    expect(await db.select().from(haimaoTouches)).toEqual([]);
  });
});
