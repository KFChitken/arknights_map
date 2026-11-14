import { randomInt } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_IDS, passCharNamed } from "../passCatalog";
import { PITY, TICKETS_CAP, WELCOME_TICKETS } from "../passes";
import { deleteAccount } from "./account";
import { loadMods } from "./admins";
import { db } from "./db";
import { HttpError } from "./http";
import {
  collection,
  copiesOf,
  draw,
  earn,
  openWallet,
  passesMe,
  passesOpen,
  passLog,
  passState,
  setLook,
  setWish,
  wear,
  wishFromFavourites,
  wornPasses,
} from "./passes";
import { admins, blocks, passCounters, passes, passWallets, touches, users, type UserRow } from "./schema";
import * as world from "./world";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// Runs against the database named in vitest.config.mts

/** Noon, Beijing time: well inside a site day */
const NOON = Date.parse("2026-11-14T12:00:00+08:00");
const HOUR = 3_600_000;
const id = (game: "arknights" | "endfield", name: string) => passCharNamed(game, name)!.id;

async function player(email: string, fav: { ak?: string[]; ef?: string[] } = {}): Promise<UserRow> {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      favArknights: fav.ak ?? [],
      favEndfield: fav.ef ?? [],
    })
    .returning();
  return u;
}

async function wallet(userId: string) {
  const [w] = await db.select().from(passWallets).where(eq(passWallets.userId, userId));
  return w;
}

const setWallet = (userId: string, values: Partial<typeof passWallets.$inferInsert>) =>
  db.update(passWallets).set(values).where(eq(passWallets.userId, userId));

/** Dice that always land on the same character: the catalogue's index of id, and the first of a wish list */
const always = (charId: number) => (n: number) => (n === CATALOG_IDS.length ? CATALOG_IDS.indexOf(charId) : 0);

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

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${passCounters} cascade`);
  vi.stubEnv("PASSES", "on");
  // whatever pictures this computer has (passArt.test.ts tries them)
  vi.stubEnv("PASS_ART", "off");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("寻访券", () => {
  it("gives the first ten once, and the player's 厨力 as their first wish list", async () => {
    const u = await player("a@example.com", { ak: ["能天使", "黑", "不在名单里", "阿米娅"], ef: ["莱万汀", "佩丽卡", "管理员", "汤汤"] });
    expect(wishFromFavourites(u)).toEqual([
      id("arknights", "能天使"),
      id("arknights", "黑"),
      id("arknights", "阿米娅"),
      id("endfield", "莱万汀"),
      id("endfield", "佩丽卡"),
      id("endfield", "管理员"),
    ]);
    const first = await openWallet(u, NOON);
    expect(first).toMatchObject({ tickets: WELCOME_TICKETS, welcomed: true, wish: wishFromFavourites(u), wishOpen: true, miss: 0 });
    expect(first.today).toEqual({ social: 0, guide: 0, declare: 0, giftsIn: 0 });
    const again = await openWallet(u, NOON + HOUR);
    expect(again).toMatchObject({ tickets: WELCOME_TICKETS, welcomed: false });
    expect(again.nextDayAt).toBe(Date.parse("2026-11-15T04:00:00+08:00"));
  });

  it("welcomes once a wallet that was made before the player first came", async () => {
    const u = await player("a@example.com", { ak: ["阿米娅"] });
    await db.insert(passWallets).values({ userId: u.id, tickets: 2, day: "2026-11-14" });
    expect(await openWallet(u, NOON)).toMatchObject({ tickets: 2 + WELCOME_TICKETS, welcomed: true, wish: [id("arknights", "阿米娅")] });
    expect(await openWallet(u, NOON)).toMatchObject({ tickets: 2 + WELCOME_TICKETS, welcomed: false });
  });

  it("comes for play up to 6, 2 and 2 a site day, which turns at 04:00 Beijing time, and 50 held", async () => {
    const u = await player("a@example.com");
    // nothing is written for a player who never opened the page
    await earn(u.id, "social", NOON);
    expect(await wallet(u.id)).toBeUndefined();

    const before4 = Date.parse("2026-11-14T03:59:00+08:00");
    await openWallet(u, before4);
    for (let i = 0; i < 7; i++) await earn(u.id, "social", before4);
    for (let i = 0; i < 3; i++) await earn(u.id, "guide", before4);
    for (let i = 0; i < 3; i++) await earn(u.id, "declare", before4);
    expect(await passState(u.id, before4)).toMatchObject({ tickets: 20, today: { social: 6, guide: 2, declare: 2, giftsIn: 0 } });

    const at4 = Date.parse("2026-11-14T04:00:00+08:00");
    // a new day reads as nothing brought yet, before anything is written
    expect((await passState(u.id, at4)).today).toEqual({ social: 0, guide: 0, declare: 0, giftsIn: 0 });
    await earn(u.id, "social", at4);
    expect(await passState(u.id, at4)).toMatchObject({ tickets: 21, today: { social: 1, guide: 0, declare: 0 } });
    expect((await wallet(u.id)).day).toBe("2026-11-14");

    await setWallet(u.id, { tickets: TICKETS_CAP - 1 });
    await earn(u.id, "guide", at4);
    await earn(u.id, "declare", at4);
    await earn(u.id, "social", at4);
    expect(await passState(u.id, at4)).toMatchObject({ tickets: TICKETS_CAP, today: { social: 1, guide: 1, declare: 0 } });
  });

  it("counts nothing while PASSES is off, and never fails what it is counted for", async () => {
    const u = await player("a@example.com");
    await openWallet(u, NOON);
    vi.stubEnv("PASSES", "off");
    await earn(u.id, "social", NOON);
    expect((await wallet(u.id)).tickets).toBe(WELCOME_TICKETS);

    vi.stubEnv("PASSES", "admins");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "update").mockImplementationOnce(() => {
      throw new Error("connection lost");
    });
    await expect(earn(u.id, "social", NOON)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not counted"), expect.anything());
    expect((await wallet(u.id)).tickets).toBe(WELCOME_TICKETS);
  });

  it("comes for a touch even when a block keeps it from arriving, so tickets never tell", async () => {
    const owner = await player("owner-of-roach@example.com");
    const toucher = await player("toucher@example.com");
    const [main] = await world.placeRoach(owner.id, { kind: "main" }, { lng: 121.4737, lat: 31.2304 });
    await openWallet(toucher);
    await world.touch(toucher.id, main.publicId, false);
    expect((await wallet(toucher.id)).tickets).toBe(WELCOME_TICKETS + 1);
    await db.insert(blocks).values({ blockerId: owner.id, blockedId: toucher.id });
    await world.touch(toucher.id, main.publicId, true);
    const sent = await db.select({ withheld: touches.withheld }).from(touches).where(eq(touches.fromUserId, toucher.id)).orderBy(asc(touches.createdAt));
    expect(sent.map((t) => t.withheld)).toEqual([false, true]);
    expect((await wallet(toucher.id)).tickets).toBe(WELCOME_TICKETS + 2);
    // the owner of the roach, who never opened the page, has no wallet
    expect(await wallet(owner.id)).toBeUndefined();
  });
});

describe("a draw", () => {
  it("spends one or ten tickets, and numbers each character's passes from 1 in the order the site drew them", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await openWallet(a, NOON);
    await openWallet(b, NOON);
    const one = await draw(a, 1, NOON, always(1));
    expect(one.drawn).toEqual([{ charId: 1, no: 1, tier: "new", up: false, fancy: false, foil: true }]);
    expect(one.state.tickets).toBe(WELCOME_TICKETS - 1);

    await setWallet(a.id, { tickets: 30 });
    const ten = await draw(a, 10, NOON + 1000, always(1));
    expect(ten.drawn.map((d) => d.no)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ten.drawn[0]).toEqual({ charId: 1, no: 2, tier: "up", up: true, fancy: true, foil: false });
    expect(ten.drawn.slice(1).every((d) => d.tier === "dup" && !d.up && d.fancy)).toBe(true);
    expect(ten.state.tickets).toBe(20);

    // someone else's first of the same character takes the next number, and is new to them
    const theirs = await draw(b, 10, NOON, always(1));
    expect(theirs.drawn[0]).toEqual({ charId: 1, no: 12, tier: "new", up: false, fancy: false, foil: false });
    expect(theirs.drawn[1]).toMatchObject({ no: 13, tier: "up", fancy: true });
    expect(theirs.drawn.find((d) => d.no === 111)).toBeUndefined();
    expect((await db.select().from(passCounters))[0]).toEqual({ charId: 1, lastNo: 21 });

    // every pass is kept: who, when, whom
    const rows = await db.select().from(passes).where(eq(passes.userId, a.id));
    expect(rows).toHaveLength(11);
    expect(rows.every((r) => r.charId === 1 && r.drawnAt.getTime() >= NOON && !r.wish)).toBe(true);
  });

  it("refuses a draw of another size, without the tickets, before the page was opened, or within a second", async () => {
    const a = await player("a@example.com");
    expect(await refusal(draw(a, 1, NOON))).toMatchObject({ status: 409, message: "先打开寻访页。" });
    await openWallet(a, NOON);
    for (const n of [0, 2, 5, "1", "10", null, undefined, 1.5]) {
      expect(await refusal(draw(a, n, NOON)), String(n)).toMatchObject({ status: 400 });
    }
    await draw(a, 1, NOON, always(1));
    expect(await refusal(draw(a, 1, NOON + 999, always(1)))).toMatchObject({ status: 429 });
    expect(await refusal(draw(a, 10, NOON + 1000, always(1)))).toEqual({ status: 409, message: "寻访券不够了。" });
    // the refused ones spent nothing, drew nothing, and held up nothing
    await draw(a, 1, NOON + 1000, always(1));
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS - 2);
    expect(await db.select().from(passes)).toHaveLength(2);
  });

  it("brings someone from the wish list on the 30th draw without one, owned or not, and starts the count again", async () => {
    const amiya = id("arknights", "阿米娅");
    const a = await player("a@example.com", { ak: ["阿米娅", "能天使"] });
    await openWallet(a, NOON);
    await setWallet(a.id, { tickets: 50, miss: PITY - 3 });
    // the dice land on 黑, who is not on the list, and on the first of the list for the sure one
    const hei = always(id("arknights", "黑"));
    const ten = await draw(a, 10, NOON, hei);
    expect(ten.drawn.map((d) => d.tier)).toEqual(["new", "up", "wish", "dup", "dup", "dup", "dup", "dup", "dup", "dup"]);
    expect(ten.drawn[2]).toMatchObject({ charId: amiya, no: 1, tier: "wish", up: false, fancy: false });
    expect(ten.state.miss).toBe(7);
    expect(ten.state.wishOwned).toEqual([{ charId: amiya, copies: 1, no: 1 }]);
    expect((await db.select({ wish: passes.wish }).from(passes).where(eq(passes.charId, amiya)))[0].wish).toBe(true);

    // the sure one again, for a character they already have: their second copy
    await setWallet(a.id, { miss: PITY - 1 });
    const again = await draw(a, 1, NOON + 1000, hei);
    expect(again.drawn[0]).toMatchObject({ charId: amiya, no: 2, tier: "wish", up: true, fancy: true });
    expect(again.state.miss).toBe(0);

    // one that came by chance starts the count again too
    await setWallet(a.id, { miss: 12 });
    const chance = await draw(a, 1, NOON + 2000, always(id("arknights", "能天使")));
    expect(chance.drawn[0].tier).toBe("wish");
    expect(chance.state.miss).toBe(0);
  });

  it("keeps no count towards pity with an empty wish list", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    const { state } = await draw(a, 10, NOON, always(1));
    expect(state).toMatchObject({ wish: [], miss: 0 });
    expect((await wallet(a.id)).miss).toBe(0);
  });

  it("gives out numbers with none twice and none skipped when 200 players draw ten at once", { timeout: 60_000 }, async () => {
    const day = "2026-11-14";
    const made = await db
      .insert(users)
      .values(Array.from({ length: 200 }, (_, i) => ({ email: `p${i}@example.com`, ageConfirmedAt: new Date(), policyAcceptedAt: new Date() })))
      .returning();
    await db.insert(passWallets).values(made.map((u) => ({ userId: u.id, tickets: 10, day, welcomed: true })));
    // five characters only, so the draws keep meeting on the same counters
    const five = (n: number) => randomInt(Math.min(n, 5));
    const results = await Promise.all(made.map((u) => draw(u, 10, NOON, five)));
    expect(results.every((r) => r.drawn.length === 10 && r.state.tickets === 0)).toBe(true);

    const rows = await db.select({ charId: passes.charId, no: passes.no }).from(passes);
    expect(rows).toHaveLength(2000);
    const byChar = new Map<number, number[]>();
    for (const r of rows) byChar.set(r.charId, [...(byChar.get(r.charId) ?? []), r.no]);
    const counters = new Map((await db.select().from(passCounters)).map((c) => [c.charId, c.lastNo]));
    for (const [charId, nos] of byChar) {
      nos.sort((x, y) => x - y);
      expect(nos, String(charId)).toEqual(Array.from({ length: nos.length }, (_, i) => i + 1));
      expect(counters.get(charId)).toBe(nos.length);
    }
    // what each was told is what was kept
    const told = results.flatMap((r) => r.drawn.map((d) => `${d.charId}:${d.no}`)).sort();
    expect(told).toEqual(rows.map((r) => `${r.charId}:${r.no}`).sort());
  });

  it("goes with its player's account, the pass they wear too, and its numbers are never given again", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await openWallet(a, NOON);
    await openWallet(b, NOON);
    await draw(a, 10, NOON, always(7));
    const [worn] = await db.select({ id: passes.id }).from(passes).where(and(eq(passes.userId, a.id), eq(passes.no, 3)));
    await db.update(users).set({ wornPass: worn.id }).where(eq(users.id, a.id));
    const [row] = await db.select().from(users).where(eq(users.id, a.id));
    await deleteAccount(row);
    expect(await db.select().from(passes)).toEqual([]);
    expect(await db.select().from(passWallets).where(eq(passWallets.userId, a.id))).toEqual([]);
    const { drawn } = await draw(b, 1, NOON, always(7));
    expect(drawn[0]).toMatchObject({ charId: 7, no: 11, tier: "new" });
  });
});

describe("the wish list", () => {
  it("takes 1 to 6 different characters of the catalogue", async () => {
    const a = await player("a@example.com");
    expect(await refusal(setWish(a, [1], NOON))).toMatchObject({ status: 409 });
    await openWallet(a, NOON);
    for (const ids of [[], [1, 2, 3, 4, 5, 6, 7], [1, 1], [99_999], [0], ["1"], [1.5], "1", null, undefined, { 0: 1 }]) {
      expect(await refusal(setWish(a, ids, NOON)), JSON.stringify(ids)).toEqual({ status: 400, message: "心愿单要放 1 到 6 位角色，不能重复。" });
    }
    expect((await setWish(a, [1, 2, 3, 4, 5, 6], NOON)).wish).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("changes once a site day, the first filling free, and never moves the count towards pity", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    await setWallet(a.id, { miss: 17 });
    // they had no 厨力: nothing to pity yet
    expect(await passState(a.id, NOON)).toMatchObject({ wish: [], wishOpen: true, miss: 0 });
    expect(await setWish(a, [1], NOON)).toMatchObject({ wish: [1], wishOpen: true, miss: 17 });
    expect(await setWish(a, [1, 2], NOON)).toMatchObject({ wish: [1, 2], wishOpen: false, miss: 17 });
    expect(await refusal(setWish(a, [3], NOON + HOUR))).toMatchObject({ status: 409, message: expect.stringContaining("凌晨 4 点") });
    const tomorrow = Date.parse("2026-11-15T04:00:00+08:00");
    expect(await passState(a.id, tomorrow)).toMatchObject({ wishOpen: true });
    expect(await setWish(a, [3], tomorrow)).toMatchObject({ wish: [3], wishOpen: false, miss: 17 });

    // a list filled from their 厨力 may still be changed that day, once
    const b = await player("b@example.com", { ef: ["管理员"] });
    expect(await openWallet(b, NOON)).toMatchObject({ wish: [id("endfield", "管理员")], wishOpen: true });
    expect(await setWish(b, [4], NOON)).toMatchObject({ wish: [4], wishOpen: false });
    expect(await refusal(setWish(b, [5], NOON))).toMatchObject({ status: 409 });
  });
});

describe("我的通行证 and 寻访记录", () => {
  it("counts each character's copies and their first number, and every pass in all", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await openWallet(a, NOON);
    await openWallet(b, NOON);
    await draw(b, 1, NOON, always(2));
    await draw(a, 1, NOON, always(2));
    await draw(a, 1, NOON + 1000, always(2));
    await draw(a, 1, NOON + 2000, always(9));
    const mine = await collection(a.id);
    expect(mine.passes).toBe(3);
    expect(mine.chars.sort((x, y) => x.charId - y.charId)).toEqual([
      { charId: 2, copies: 2, no: 2, lastAt: NOON + 1000 },
      { charId: 9, copies: 1, no: 1, lastAt: NOON + 2000 },
    ]);
    expect(await collection((await player("c@example.com")).id)).toEqual({ chars: [], passes: 0 });
  });

  it("lists the passes newest first, fifty at a time", async () => {
    const a = await player("a@example.com");
    await db.insert(passes).values(Array.from({ length: 55 }, (_, i) => ({ userId: a.id, charId: i + 1, no: 1, wish: i === 54, drawnAt: new Date(NOON + i) })));
    const first = await passLog(a.id);
    expect(first.rows).toHaveLength(50);
    expect(first.more).toBe(true);
    expect(first.rows[0]).toMatchObject({ charId: 55, no: 1, wish: true, at: NOON + 54 });
    expect(first.rows[49].charId).toBe(6);
    const rest = await passLog(a.id, first.rows[49].id);
    expect(rest.rows.map((r) => r.charId)).toEqual([5, 4, 3, 2, 1]);
    expect(rest.more).toBe(false);
    for (const before of ["abc", -1, 0, 1.5, null]) expect((await passLog(a.id, before)).rows[0].charId, String(before)).toBe(55);
    expect(await passLog((await player("b@example.com")).id)).toEqual({ rows: [], more: false });
  });
});

describe("who may draw (PASSES)", () => {
  it("is everyone when on, the 站长 and the admins when admins, and nobody when off", async () => {
    const owner = await player("owner@example.com");
    const mod = await player("mod@example.com");
    const someone = await player("someone@example.com");
    await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
    await loadMods();

    expect([owner, mod, someone].map(passesOpen)).toEqual([true, true, true]);
    vi.stubEnv("PASSES", "admins");
    expect([owner, mod, someone].map(passesOpen)).toEqual([true, true, false]);
    expect(await passesMe(someone)).toBeUndefined();
    expect((await world.me(someone.id))?.passes).toBeUndefined();
    vi.stubEnv("PASSES", "off");
    expect([owner, mod, someone].map(passesOpen)).toEqual([false, false, false]);
    vi.stubEnv("PASSES", "");
    expect(passesOpen(owner)).toBe(false);
  });

  it("puts a dot on the button for the first ten, and while there are ten tickets for a draw", async () => {
    const a = await player("a@example.com");
    expect(await passesMe(a)).toEqual({ tickets: 0, dot: true, worn: null });
    expect((await world.me(a.id))?.passes).toEqual({ tickets: 0, dot: true, worn: null });
    await openWallet(a, NOON);
    expect(await passesMe(a)).toEqual({ tickets: WELCOME_TICKETS, dot: true, worn: null });
    await draw(a, 1, NOON, always(1));
    expect(await passesMe(a)).toEqual({ tickets: WELCOME_TICKETS - 1, dot: false, worn: null });
  });
});

/** The player's passes of a character, lowest number first */
const passesOf = (userId: string, charId: number) =>
  db.select({ id: passes.id, no: passes.no }).from(passes).where(and(eq(passes.userId, userId), eq(passes.charId, charId))).orderBy(asc(passes.no));

describe("wearing a pass", () => {
  it("switches a character between the special look and the normal one, from their second copy", async () => {
    const a = await player("a@example.com");
    expect(await refusal(setLook(a, 7, true, NOON))).toMatchObject({ status: 409 });
    await openWallet(a, NOON);
    await draw(a, 1, NOON, always(7));
    expect(await refusal(setLook(a, 7, true, NOON))).toEqual({ status: 409, message: "再抽到一张这位，就能换成镭射版。" });
    for (const [charId, plain] of [[99_999, true], [0, true], ["7", true], [7, "true"], [7, null], [null, true]]) {
      expect(await refusal(setLook(a, charId, plain, NOON)), JSON.stringify([charId, plain])).toEqual({ status: 400, message: "没有这位角色。" });
    }
    await draw(a, 1, NOON + 1000, always(7));
    await draw(a, 1, NOON + 2000, always(8));
    await draw(a, 1, NOON + 3000, always(8));
    expect((await setLook(a, 7, true, NOON)).plain).toEqual([7]);
    // asked twice, kept once
    expect((await setLook(a, 7, true, NOON)).plain).toEqual([7]);
    expect((await setLook(a, 8, true, NOON)).plain).toEqual([7, 8]);
    expect((await setLook(a, 7, false, NOON)).plain).toEqual([8]);
    expect((await setLook(a, 7, false, NOON)).plain).toEqual([8]);

    // the pass worn follows the look picked, on their own pages and on the card others see
    const [, second] = await passesOf(a.id, 8);
    const worn = (await wear(a, second.id, NOON)).worn;
    expect(worn).toMatchObject({ passId: second.id, charId: 8, no: 2, copies: 2, fancy: false });
    const seen = async () => (await world.cardsOf([(await world.userById(a.id))!], a.id)).get(a.id)!.pass;
    expect(await seen()).toMatchObject({ charId: 8, no: 2, copies: 2, fancy: false });
    expect((await setLook(a, 8, false, NOON)).worn).toMatchObject({ fancy: true });
    expect(await seen()).toMatchObject({ fancy: true });
    expect((await passesMe((await world.userById(a.id))!))?.worn).toMatchObject({ passId: second.id, fancy: true });
  });

  it("wears one of the player's own passes, or none, and says what is printed on it", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    expect(await refusal(wear(a, null, NOON))).toMatchObject({ status: 409 });
    await openWallet(a, NOON);
    await openWallet(b, NOON);
    const exu = id("arknights", "能天使");
    await draw(a, 1, NOON, always(exu));
    await draw(b, 1, NOON, always(exu));
    const [mine] = await passesOf(a.id, exu);
    const [theirs] = await passesOf(b.id, exu);
    expect(await refusal(wear(a, theirs.id, NOON))).toEqual({ status: 404, message: "这张通行证不在你这里。" });
    expect(await refusal(wear(a, 2 ** 31 - 1, NOON))).toMatchObject({ status: 404 });
    for (const bad of ["1", 0, -1, 1.5, undefined, {}]) {
      expect(await refusal(wear(a, bad, NOON)), JSON.stringify(bad)).toMatchObject({ status: 400 });
    }
    expect((await passState(a.id, NOON)).worn).toBeNull();
    const s = await wear(a, mine.id, NOON);
    expect(s.worn).toEqual({
      passId: mine.id,
      game: "ak",
      charId: exu,
      name: "能天使",
      en: "Exusiai",
      rarity: 6,
      no: 1,
      copies: 1,
      fancy: false,
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      art: null,
      avatar: expect.toBeOneOf([null, expect.any(String)]),
      drawnAt: NOON,
    });
    const row = (await world.userById(a.id))!;
    expect((await passesMe(row))?.worn).toEqual(s.worn);
    expect(row.wornPass).toBe(mine.id);
    expect((await wear(a, null, NOON)).worn).toBeNull();
    expect((await world.userById(a.id))!.wornPass).toBeNull();
  });

  it("lists a player's passes of one character, lowest number first, for picking which to wear", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    await draw(a, 1, NOON, always(5));
    await draw(a, 1, NOON + 1000, always(6));
    await draw(a, 1, NOON + 2000, always(5));
    const got = await copiesOf(a.id, 5);
    expect(got).toEqual({
      charId: 5,
      copies: [
        { id: expect.any(Number), no: 1, at: NOON },
        { id: expect.any(Number), no: 2, at: NOON + 2000 },
      ],
    });
    expect(await copiesOf(a.id, 9)).toEqual({ charId: 9, copies: [] });
    for (const bad of [0, 99_999, "5", Number.NaN]) expect(await refusal(copiesOf(a.id, bad)), String(bad)).toMatchObject({ status: 400 });
  });

  it("shows the pass worn on profile cards to whoever may see passes: all while on, the admins' eyes alone while admins", async () => {
    const owner = await player("owner@example.com");
    const someone = await player("someone@example.com");
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    await draw(a, 10, NOON, always(3));
    const [, , third] = await passesOf(a.id, 3);
    await wear(a, third.id, NOON);
    const row = (await world.userById(a.id))!;
    const bare = (await world.userById(someone.id))!;
    const card = async (viewer: string | null) => (await world.cardsOf([row, bare], viewer)).get(a.id)!.pass;

    const shown = await card(someone.id);
    expect(shown).toMatchObject({ charId: 3, no: 3, copies: 10, fancy: true, drawnAt: NOON });
    // which of their passes it is stays theirs
    expect(Object.keys(shown!)).not.toContain("passId");
    expect((await world.cardsOf([bare], a.id)).get(someone.id)!.pass).toBeUndefined();
    // nobody is looking (a card in a reply to their own ink)
    expect(await card(null)).toBeUndefined();
    expect((await wornPasses([row], null)).size).toBe(0);

    vi.stubEnv("PASSES", "admins");
    expect(await card(someone.id)).toBeUndefined();
    expect(await card(owner.id)).toMatchObject({ charId: 3 });
    vi.stubEnv("PASSES", "off");
    expect(await card(owner.id)).toBeUndefined();
    expect(await passesMe(row)).toBeUndefined();
  });
});
