import { randomInt } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMIYA_ID } from "../amiya";
import { CATALOG_IDS, passChar, passCharNamed, poolIds } from "../passCatalog";
import { PITY, WELCOME_TICKETS } from "../passes";
import { deleteAccount } from "./account";
import { loadMods } from "./admins";
import { db } from "./db";
import { HttpError } from "./http";
import {
  claimFollow,
  collection,
  copiesOf,
  draw,
  didTask,
  forgetRoachPasses,
  openWallet,
  passesMe,
  passesOpen,
  passFromBottle,
  passLog,
  passState,
  roachPass,
  setLook,
  setOnMap,
  setPool,
  setWish,
  wear,
  wishFromFavourites,
  wornPasses,
} from "./passes";
import * as passArt from "./passArt";
import { admins, passCounters, passes, passWallets, siteSettings, users, type UserRow } from "./schema";
import { loadSettings, setPassFollow } from "./siteSettings";
import * as world from "./world";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// Runs against the database named in vitest.config.mts

/** Noon, Beijing time: well inside a site day */
const NOON = Date.parse("2026-11-14T12:00:00+08:00");
/** One of the pictures moved in their boxes (src/data/pass-framing.json: 风笛's), and where */
const MOVED = "9f8c7a61d2a0df8b";
const MOVED_FRAME = { m: [0, -13.8, 100, 140.4], f: [0, -20.3, 100, 207.8], p: [0, -16.7, 100, 170.2] };
const HOUR = 3_600_000;
const id = (game: "arknights" | "endfield", name: string) => passCharNamed(game, name)!.id;
/** Two full wish lists */
const SIX = [1, 2, 3, 4, 5, 6];
const OTHER_SIX = [7, 8, 9, 10, 11, 12];

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
  forgetRoachPasses();
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
    expect(first.tasks.map((t) => [t.task, t.done, t.got])).toEqual([
      ["touch", 0, 0],
      ["declare", 0, 0],
      ["reply", 0, 0],
      ["npc", 0, 0],
    ]);
    expect(first.giftsIn).toBe(0);
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
    expect(ten.drawn[0]).toEqual({ charId: 1, no: 2, tier: "up", up: true, fancy: true, foil: true });
    expect(ten.drawn.slice(1).every((d) => d.tier === "dup" && !d.up && d.fancy)).toBe(true);
    expect(ten.state.tickets).toBe(20);

    // someone else's first of the same character takes the next number, and is new to them
    const theirs = await draw(b, 10, NOON, always(1));
    expect(theirs.drawn[0]).toEqual({ charId: 1, no: 12, tier: "new", up: false, fancy: false, foil: true });
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
    const a = await player("a@example.com", { ak: ["阿米娅", "能天使", "银灰", "陈", "史尔特尔", "艾雅法拉"] });
    await openWallet(a, NOON);
    await setWallet(a.id, { tickets: 50, miss: PITY - 3 });
    // the dice land on 黑, who is not on the list, and on the first of the list for the sure one
    const hei = always(id("arknights", "黑"));
    const ten = await draw(a, 10, NOON, hei);
    expect(ten.drawn.map((d) => d.tier)).toEqual(["new", "up", "wish", "dup", "dup", "dup", "dup", "dup", "dup", "dup"]);
    expect(ten.drawn[2]).toMatchObject({ charId: amiya, no: 1, tier: "wish", up: false, fancy: false });
    expect(ten.state.miss).toBe(7);
    // just drawn, so a tap on them on the page opens their pass, not a 样张
    expect(ten.state.wishOwned).toEqual([{ charId: amiya, copies: 1, first: { id: expect.any(Number), no: 1, at: NOON } }]);
    expect(ten.state.wishDrawn).toEqual([{ charId: amiya, lastNo: 1 }]);
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

  it("refuses a draw while the wish list holds 1 to 5, and draws once it is emptied or filled up", async () => {
    const a = await player("a@example.com", { ak: ["阿米娅", "能天使"] });
    expect(await openWallet(a, NOON)).toMatchObject({ wish: [id("arknights", "阿米娅"), id("arknights", "能天使")], wishOpen: true });
    for (const n of [1, 10]) {
      expect(await refusal(draw(a, n, NOON, always(1))), String(n)).toEqual({
        status: 409,
        message: "心愿单还差 4 位：放满 6 位才能寻访，不要心愿就全部拿掉。",
      });
    }
    // nothing spent, nothing drawn, and no draw to wait a second after
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS);
    expect(await db.select().from(passes)).toEqual([]);
    await setWallet(a.id, { tickets: 0 });
    expect(await refusal(draw(a, 1, NOON, always(1)))).toMatchObject({ status: 409, message: expect.stringContaining("还差 4 位") });
    await setWallet(a.id, { tickets: WELCOME_TICKETS });

    await setWish(a, [], NOON);
    expect((await draw(a, 1, NOON, always(1))).drawn).toHaveLength(1);
    await setWish(a, SIX, NOON);
    expect((await draw(a, 1, NOON + 1000, always(1))).drawn[0]).toMatchObject({ charId: 1, tier: "wish" });
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

/** Dice that never land on the wish list by chance: the catalogue's last, then the first of whomever is left */
const offWish = (n: number) => (n === CATALOG_IDS.length ? n - 1 : 0);
/** The player, playing these games (我的资料's 在玩) */
const plays = async (u: UserRow, games: string[]) => {
  const [row] = await db.update(users).set({ games }).where(eq(users.id, u.id)).returning();
  return row;
};

describe("卡池, while only both games' may be drawn from (PASS_POOLS not on: Breeze, 2026-11-22)", () => {
  const last = CATALOG_IDS[CATALOG_IDS.length - 1];

  it("is both for everyone, whatever they play or picked before, a 漂流瓶 too, the pick kept for later", async () => {
    // never picked, plays 终末地 alone; picked 方舟's before
    const a = await plays(await player("a@example.com"), ["endfield"]);
    const b = await plays(await player("b@example.com"), ["arknights"]);
    expect(await openWallet(a, NOON)).toMatchObject({ pool: "both", pools: false });
    await openWallet(b, NOON);
    await setWallet(b.id, { pool: "ak", tickets: 50 });
    expect(await passState(b.id, NOON)).toMatchObject({ pool: "both", pools: false });
    // the dice that bring 终末地's first with its 卡池 and 方舟's with theirs bring the catalogue's last, as with both
    expect((await draw(a, 10, NOON, offWish)).drawn.every((d) => d.charId === last)).toBe(true);
    expect((await draw(b, 1, NOON, offWish)).drawn[0].charId).toBe(last);
    expect((await passFromBottle(db, b, NOON + 1000, offWish)).drawn.charId).toBe(last);
    // kept as they were: back once one game's may be picked again
    expect((await wallet(a.id)).pool).toBeNull();
    expect((await wallet(b.id)).pool).toBe("ak");
    vi.stubEnv("PASS_POOLS", "on");
    expect(await passState(b.id, NOON)).toMatchObject({ pool: "ak", pools: true });
    expect((await passState(a.id, NOON)).pool).toBe("ef");
  });

  it("takes both, and no pick of one game's", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    for (const p of ["ak", "ef"]) {
      expect(await refusal(setPool(a, p, NOON)), p).toEqual({ status: 409, message: "现在只开了两边都抽的卡池。" });
    }
    expect((await wallet(a.id)).pool).toBeNull();
    expect(await refusal(setPool(a, "endfield", NOON))).toMatchObject({ status: 400 });
    expect(await setPool(a, "both", NOON)).toMatchObject({ pool: "both", pools: false });
    expect((await wallet(a.id)).pool).toBe("both");
  });
});

describe("卡池, while one game's may be picked (PASS_POOLS=on)", () => {
  const ef = poolIds("ef")!;
  beforeEach(() => vi.stubEnv("PASS_POOLS", "on"));

  it("follows the games the player plays until they pick one, then keeps what they picked", async () => {
    const a = await plays(await player("a@example.com"), ["endfield"]);
    expect((await openWallet(a, NOON)).pool).toBe("ef");
    expect((await wallet(a.id)).pool).toBeNull();
    // 在玩 changed, nothing picked: the 卡池 follows
    await plays(a, ["arknights", "endfield"]);
    expect((await passState(a.id, NOON)).pool).toBe("both");
    await plays(a, ["arknights"]);
    expect((await passState(a.id, NOON)).pool).toBe("ak");
    await plays(a, []);
    expect((await passState(a.id, NOON)).pool).toBe("both");
    // picked: kept, whatever 在玩 says
    expect((await setPool(a, "ef", NOON)).pool).toBe("ef");
    await plays(a, ["arknights"]);
    expect((await passState(a.id, NOON)).pool).toBe("ef");
    expect((await setPool(a, "both", NOON)).pool).toBe("both");
    expect((await wallet(a.id)).pool).toBe("both");
  });

  it("is both, ak or ef, once the page was opened", async () => {
    const a = await player("a@example.com");
    expect(await refusal(setPool(a, "ef", NOON))).toEqual({ status: 409, message: "先打开寻访页。" });
    await openWallet(a, NOON);
    for (const p of ["", "arknights", "endfield", "EF", "toString", null, undefined, 1, ["ef"]]) {
      expect(await refusal(setPool(a, p, NOON)), String(p)).toEqual({ status: 400, message: "卡池只能选两边都抽、只抽方舟或只抽终末地。" });
    }
    expect((await wallet(a.id)).pool).toBeNull();
  });

  it("draws everyone off the wish list from the game picked, the wish list's other game all the same", async () => {
    const amiya = id("arknights", "阿米娅");
    const a = await player("a@example.com", { ak: ["阿米娅", "银灰", "陈", "史尔特尔", "艾雅法拉", "斯卡蒂"] });
    await openWallet(a, NOON);
    await setWallet(a.id, { tickets: 50 });
    await setPool(a, "ef", NOON);
    const ten = await draw(a, 10, NOON, offWish);
    expect(ten.drawn.map((d) => d.charId)).toEqual(Array(10).fill(ef[0]));
    expect(ten.state.miss).toBe(10);
    // a die under the wish list's length brings the wish: 方舟's 阿米娅, though the 卡池 is 终末地's
    const one = await draw(a, 1, NOON + 1000, () => 0);
    expect(one.drawn[0]).toMatchObject({ charId: amiya, tier: "wish" });
    expect(one.state.miss).toBe(0);
    // the sure one too
    await setWallet(a.id, { miss: PITY - 1 });
    expect((await draw(a, 1, NOON + 2000, offWish)).drawn[0]).toMatchObject({ charId: amiya, tier: "wish" });
    // both again: the same dice as ever
    await setPool(a, "both", NOON);
    expect((await draw(a, 1, NOON + 3000, always(1))).drawn[0].charId).toBe(1);
    expect((await draw(a, 1, NOON + 4000, offWish)).drawn[0].charId).toBe(CATALOG_IDS[CATALOG_IDS.length - 1]);
  });

  it("draws from the one game a player plays when they never picked", async () => {
    const a = await plays(await player("a@example.com"), ["endfield"]);
    await openWallet(a, NOON);
    const { drawn } = await draw(a, 10, NOON, offWish);
    expect(drawn.every((d) => passChar(d.charId)!.game === "ef")).toBe(true);
    expect(drawn[0].charId).toBe(ef[0]);
    // both games, or none said: everyone
    const b = await plays(await player("b@example.com"), ["arknights", "endfield"]);
    await openWallet(b, NOON);
    expect((await draw(b, 1, NOON, offWish)).drawn[0].charId).toBe(CATALOG_IDS[CATALOG_IDS.length - 1]);
  });
});

describe("关注 B 站领券", () => {
  const FOLLOW = { on: true, name: "Breeze青嵐", url: "https://space.bilibili.com/12345" };
  const GOT = { status: 409, message: "这个账号已经领过了，每个账号只能领一次。" };
  const opened = async (email: string) => {
    const u = await player(email);
    await openWallet(u, NOON);
    return u;
  };

  afterEach(async () => {
    await db.delete(siteSettings);
    await loadSettings();
  });

  it("brings 10 once an account, with nothing to type, past 50 too, and shows 已领 that day only", async () => {
    const a = await opened("a@example.com");
    expect((await passState(a.id, NOON)).follow).toBeNull();
    await setPassFollow(a.id, FOLLOW);
    expect((await passState(a.id, NOON)).follow).toEqual({ name: "Breeze青嵐", url: "https://space.bilibili.com/12345", got: false });
    await setWallet(a.id, { tickets: 48 });
    const st = await claimFollow(a, NOON);
    expect(st).toMatchObject({ tickets: 58, follow: { got: true } });
    expect((await wallet(a.id)).followGot).toEqual(new Date(NOON));
    // once an account, that day and any after
    expect(await refusal(claimFollow(a, NOON + 1000))).toEqual(GOT);
    expect((await wallet(a.id)).tickets).toBe(58);
    // 已领 till the site day turns, then gone
    expect((await passState(a.id, Date.parse("2026-11-15T03:59:00+08:00"))).follow).toMatchObject({ got: true });
    const next = Date.parse("2026-11-15T04:00:00+08:00");
    expect((await passState(a.id, next)).follow).toBeNull();
    expect(await refusal(claimFollow(a, next))).toEqual(GOT);
    expect((await wallet(a.id)).tickets).toBe(58);
  });

  it("gives it once when 领取 comes twice at the same moment", async () => {
    const a = await opened("a@example.com");
    await setPassFollow(a.id, FOLLOW);
    const both = await Promise.allSettled([claimFollow(a, NOON), claimFollow(a, NOON)]);
    expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS + 10);
  });

  it("counts a claim of before, with the code of then, as this one", async () => {
    const a = await opened("a@example.com");
    await setPassFollow(a.id, FOLLOW);
    const before = new Date(NOON - 86_400_000);
    await setWallet(a.id, { followGot: before });
    expect((await passState(a.id, NOON)).follow).toBeNull();
    expect(await refusal(claimFollow(a, NOON))).toEqual(GOT);
    expect((await wallet(a.id)).followGot).toEqual(before);
  });

  it("gives nothing while it is off or misses its account or link; 寻访 shows nothing then", async () => {
    const a = await opened("a@example.com");
    const b = await opened("b@example.com");
    await setPassFollow(a.id, FOLLOW);
    // the switch, then each of what it needs
    for (const off of [{ on: false }, { on: true, url: "" }, { url: FOLLOW.url, name: "" }]) {
      await setPassFollow(a.id, off);
      expect((await passState(b.id, NOON)).follow, JSON.stringify(off)).toBeNull();
      expect(await refusal(claimFollow(b, NOON)), JSON.stringify(off)).toEqual({ status: 409, message: "现在没有关注领券。" });
    }
    await setPassFollow(a.id, { name: "Breeze青嵐" });
    expect((await claimFollow(b, NOON)).tickets).toBe(WELCOME_TICKETS + 10);
  });

  it("waits for 寻访 to be opened first", async () => {
    const a = await player("a@example.com");
    await setPassFollow(a.id, FOLLOW);
    expect(await refusal(claimFollow(a, NOON))).toEqual({ status: 409, message: "先打开寻访页。" });
    await openWallet(a, NOON);
    expect((await claimFollow(a, NOON)).tickets).toBe(WELCOME_TICKETS + 10);
  });
});

describe("the wish list", () => {
  it("takes 6 different characters of the catalogue, or none", async () => {
    const a = await player("a@example.com");
    expect(await refusal(setWish(a, SIX, NOON))).toMatchObject({ status: 409 });
    await openWallet(a, NOON);
    // too few, too many, one twice, one not in the catalogue, not ids; then not a list
    const lists = [[1], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7], [1, 1, 2, 3, 4, 5], [99_999, 2, 3, 4, 5, 6], [0], ["1"], [1.5]];
    for (const ids of [...lists, "1", null, undefined, { 0: 1 }]) {
      expect(await refusal(setWish(a, ids, NOON)), JSON.stringify(ids)).toEqual({
        status: 400,
        message: "心愿单要放满 6 位角色（不能重复），或者一位也不放。",
      });
    }
    expect((await setWish(a, SIX, NOON)).wish).toEqual(SIX);
    expect((await wallet(a.id)).wish).toEqual(SIX);
    expect((await setWish(a, [], NOON)).wish).toEqual([]);
    expect((await wallet(a.id)).wish).toEqual([]);
  });

  it("changes once a site day while full, emptying it too, a change from one not full free; the count towards pity stays", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    await setWallet(a.id, { miss: 17 });
    // they had no 厨力: nothing to pity yet
    expect(await passState(a.id, NOON)).toMatchObject({ wish: [], wishOpen: true, miss: 0 });
    expect(await setWish(a, SIX, NOON)).toMatchObject({ wish: SIX, wishOpen: true, miss: 17 });
    expect(await setWish(a, OTHER_SIX, NOON)).toMatchObject({ wish: OTHER_SIX, wishOpen: false, miss: 17 });
    for (const ids of [SIX, []]) {
      expect(await refusal(setWish(a, ids, NOON + HOUR))).toMatchObject({ status: 409, message: expect.stringContaining("凌晨 4 点") });
    }
    const tomorrow = Date.parse("2026-11-15T04:00:00+08:00");
    expect(await passState(a.id, tomorrow)).toMatchObject({ wishOpen: true });
    // emptied, that day's change: no count while empty, and it may be filled again for free; full, nothing more that day
    expect(await setWish(a, [], tomorrow)).toMatchObject({ wish: [], wishOpen: true, miss: 0 });
    expect(await setWish(a, SIX, tomorrow)).toMatchObject({ wish: SIX, wishOpen: false, miss: 17 });
    expect(await refusal(setWish(a, [], tomorrow + HOUR))).toMatchObject({ status: 409 });
    expect((await wallet(a.id)).wishDay).toBe("2026-11-15");

    // a list filled from six of their 厨力 may still be changed that day, once
    const six = ["阿米娅", "银灰", "陈", "史尔特尔", "艾雅法拉", "斯卡蒂"];
    const b = await player("b@example.com", { ak: six });
    expect(await openWallet(b, NOON)).toMatchObject({ wish: six.map((n) => id("arknights", n)), wishOpen: true });
    expect(await setWish(b, SIX, NOON)).toMatchObject({ wish: SIX, wishOpen: false });
    expect(await refusal(setWish(b, OTHER_SIX, NOON))).toMatchObject({ status: 409 });

    // fewer of them, or a list of 1 to 5 kept from before, changed that day too: filled up or emptied at once, free
    const c = await player("c@example.com", { ef: ["管理员"] });
    expect(await openWallet(c, NOON)).toMatchObject({ wish: [id("endfield", "管理员")], wishOpen: true });
    await setWallet(c.id, { wish: [1, 2, 3], wishDay: "2026-11-14" });
    expect(await passState(c.id, NOON)).toMatchObject({ wish: [1, 2, 3], wishOpen: true });
    expect(await setWish(c, [], NOON)).toMatchObject({ wish: [], wishOpen: true });
    expect(await setWish(c, SIX, NOON)).toMatchObject({ wish: SIX, wishOpen: false });
    expect((await wallet(c.id)).wishDay).toBe("2026-11-14");
  });
});

describe("the wish list on the page", () => {
  it("brings how many of each wish the site has drawn and the player's first pass of each they have, in one more query", async () => {
    const [amiya, exu, hei] = [id("arknights", "阿米娅"), id("arknights", "能天使"), id("arknights", "黑")];
    const a = await player("a@example.com", { ak: ["阿米娅", "能天使", "黑"], ef: ["莱万汀", "佩丽卡", "管理员"] });
    const b = await player("b@example.com");
    for (const u of [a, b]) {
      await openWallet(u, NOON);
      await setWallet(u.id, { tickets: 50 });
    }
    // somebody else draws 阿米娅 ten times; then the player twice, and 能天使 once; nobody draws 黑 nor the other three
    await draw(b, 10, NOON, always(amiya));
    await draw(a, 1, NOON, always(amiya));
    await draw(a, 1, NOON + 1000, always(amiya));
    await draw(a, 1, NOON + 2000, always(exu));

    const asked = vi.spyOn(db._.session, "prepareQuery");
    const st = await passState(a.id, NOON + 3000);
    const queries = asked.mock.calls.map(([q]) => q.sql);
    expect([...st.wishDrawn].sort((x, y) => x.charId - y.charId)).toEqual(
      [
        { charId: amiya, lastNo: 12 },
        { charId: exu, lastNo: 1 },
      ].sort((x, y) => x.charId - y.charId),
    );
    expect(st.wishDrawn.some((d) => d.charId === hei)).toBe(false);
    // their first (the lowest number), as 我的通行证 would open it, and how many
    const firstOf = async (charId: number) => (await copiesOf(a.id, charId)).copies[0];
    expect([...st.wishOwned].sort((x, y) => x.charId - y.charId)).toEqual(
      [
        { charId: amiya, copies: 2, first: await firstOf(amiya) },
        { charId: exu, copies: 1, first: await firstOf(exu) },
      ].sort((x, y) => x.charId - y.charId),
    );
    expect(st.wishOwned.find((o) => o.charId === amiya)?.first).toMatchObject({ no: 11, at: NOON });

    // the wallet, their passes of the wishes, the site's counts of the wishes (a row each at most), the pass worn
    expect(queries).toHaveLength(4);
    const counts = queries.filter((q) => q.includes('"pass_counters"'));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatch(/"char_id" in \(\$1, \$2, \$3, \$4, \$5, \$6\)/);
  });

  it("asks nothing of the passes or the counts for an empty wish list", async () => {
    const a = await player("a@example.com");
    await openWallet(a, NOON);
    const asked = vi.spyOn(db._.session, "prepareQuery");
    const st = await passState(a.id, NOON);
    expect(st).toMatchObject({ wish: [], wishOwned: [], wishDrawn: [] });
    expect(asked.mock.calls.map(([q]) => q.sql).filter((q) => q.includes('"pass_counters"') || q.includes('from "passes"'))).toEqual([]);
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

  it("puts a dot on the button for the first ten, a ticket of 每日任务 to claim, and ten tickets for a draw", async () => {
    const a = await player("a@example.com");
    expect(await passesMe(a)).toEqual({ tickets: 0, dot: true, worn: null, onMap: true });
    expect((await world.me(a.id))?.passes).toEqual({ tickets: 0, dot: true, worn: null, onMap: true });
    await openWallet(a, NOON);
    expect(await passesMe(a)).toEqual({ tickets: WELCOME_TICKETS, dot: true, worn: null, onMap: true });
    await draw(a, 1, NOON, always(1));
    expect(await passesMe(a, NOON)).toEqual({ tickets: WELCOME_TICKETS - 1, dot: false, worn: null, onMap: true });
    await didTask(a.id, "npc", NOON);
    expect(await passesMe(a, NOON)).toMatchObject({ dot: true });
    // till the day turns, unclaimed
    expect(await passesMe(a, NOON + 24 * HOUR)).toMatchObject({ dot: false });
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
    // a picture is moved in its boxes on a card as on the passes page, for the few that are
    expect(Object.keys(shown!)).not.toContain("frame");
    const index = vi.spyOn(passArt, "passArtIndex").mockResolvedValue(new Map([[3, { file: MOVED, color: null }]]));
    expect(await card(someone.id)).toMatchObject({ art: MOVED, frame: MOVED_FRAME });
    expect((await passesMe(row, NOON))?.worn).toMatchObject({ art: MOVED, frame: MOVED_FRAME });
    index.mockRestore();
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

describe("the pass on a main roach's card on the map", () => {
  const SPOT = { lng: 121.4737, lat: 31.2304 };
  const NEAR = { lng: 121.48, lat: 31.235 };
  /** A player wearing their first pass of a character (ten drawn: numbers 1 to 10, gold, the special look) */
  async function wearer(email: string, charId: number) {
    const a = await player(email);
    await world.placeRoach(a.id, { kind: "main" }, SPOT);
    await world.placeRoach(a.id, { kind: "clone" }, NEAR);
    await openWallet(a, NOON);
    await draw(a, 10, NOON, always(charId));
    const [first] = await passesOf(a.id, charId);
    await wear(a, first.id, NOON);
    const roaches = (await world.me(a.id))!.roaches;
    return { a, main: roaches.find((r) => r.slot === 0)!.publicId, clone: roaches.find((r) => r.slot > 0)!.publicId };
  }

  it("shows the pass the owner wears as it is printed, by the roach's id in the feed: never how many they have, or whose", async () => {
    const { a, main } = await wearer("a@example.com", 1);
    await db.update(users).set({ anonymous: false, name: "布丁大王" }).where(eq(users.id, a.id));
    const c = passChar(1)!;
    const shown = await roachPass(main, NOON);
    // No.000001 of ten copies: its number (gold, one of the first hundred) and day, and the special look ten bring
    expect(shown).toEqual({
      game: c.game,
      charId: 1,
      name: c.name,
      en: c.en,
      rarity: c.rarity,
      no: 1,
      fancy: true,
      color: c.color,
      art: null,
      avatar: expect.toBeOneOf([null, expect.any(String)]),
      drawnAt: NOON,
    });
    expect(Object.keys(shown!).sort()).toEqual(["art", "avatar", "charId", "color", "drawnAt", "en", "fancy", "game", "name", "no", "rarity"]);
    // not how many, which of their passes, or anything of the player's own: the map names nobody
    expect(JSON.stringify(shown)).not.toMatch(/"(copies|passId|userId|plain|onMap)"|布丁大王|a@example\.com/);
    expect(JSON.stringify(shown)).not.toContain(a.id);
    // the short form of the id the feed gives, too
    forgetRoachPasses();
    expect(await roachPass(main.slice(0, 8), NOON)).toEqual(shown);

    // its picture's files and colour, where there is one
    forgetRoachPasses();
    vi.spyOn(passArt, "passArtIndex").mockResolvedValue(new Map([[1, { file: "0123456789abcdef", color: "#7d338a" }]]));
    expect(await roachPass(main, NOON)).toMatchObject({ art: "0123456789abcdef", color: "#7d338a" });

    // and where it is moved in its boxes, for a picture that is (src/data/pass-framing.json)
    forgetRoachPasses();
    vi.spyOn(passArt, "passArtIndex").mockResolvedValue(new Map([[1, { file: MOVED, color: "#7d338a" }]]));
    expect(await roachPass(main, NOON)).toEqual({ ...shown, color: "#7d338a", art: MOVED, frame: MOVED_FRAME });
    vi.stubEnv("PASS_FRAMING", "off");
    forgetRoachPasses();
    expect(Object.keys((await roachPass(main, NOON))!)).not.toContain("frame");
  });

  it("is nothing on a clone, a guide, a demo roach, a roach not there, or a main roach whose owner wears none", async () => {
    const { a, main, clone } = await wearer("a@example.com", 1);
    const b = await player("b@example.com");
    await world.placeRoach(b.id, { kind: "main" }, NEAR);
    const bare = (await world.me(b.id))!.roaches[0].publicId;
    for (const id of [clone, clone.slice(0, 8), bare, AMIYA_ID, "bot-3", "00000000-0000-4000-8000-000000000000", "", "x".repeat(400)]) {
      expect(await roachPass(id, NOON), id.slice(0, 40)).toBeNull();
    }
    await wear(a, null, NOON);
    forgetRoachPasses();
    expect(await roachPass(main, NOON)).toBeNull();
  });

  it("is nothing while the owner switched it off in 我的资料, as the next to ask sees within a minute", async () => {
    const { a, main } = await wearer("a@example.com", 1);
    expect((await passesMe(a, NOON))?.onMap).toBe(true);
    expect(await roachPass(main, NOON)).toMatchObject({ charId: 1 });

    expect(await setOnMap(a, false, NOON)).toEqual({ onMap: false });
    expect((await passesMe(a, NOON))?.onMap).toBe(false);
    // kept a minute for whoever asks
    expect(await roachPass(main, NOON + 59_000)).toMatchObject({ charId: 1 });
    expect(await roachPass(main, NOON + 61_000)).toBeNull();
    await setOnMap(a, true, NOON);
    expect(await roachPass(main, NOON + 122_000)).toMatchObject({ charId: 1 });
    expect(await refusal(setOnMap(a, "off", NOON))).toMatchObject({ status: 400 });
    expect(await refusal(setOnMap(a, undefined, NOON))).toMatchObject({ status: 400 });
  });

  it("can be switched off before the player ever opened 寻访, and their first ten still come", async () => {
    const a = await player("a@example.com");
    await setOnMap(a, false, NOON);
    expect(await wallet(a.id)).toMatchObject({ onMap: false, welcomed: false, tickets: 0 });
    expect(await openWallet(a, NOON)).toMatchObject({ tickets: WELCOME_TICKETS, welcomed: true });
    expect((await passesMe(a, NOON))?.onMap).toBe(false);
  });
});
