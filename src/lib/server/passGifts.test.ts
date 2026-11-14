import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T, fmt } from "@/i18n";
import { FRIEND_ACTS_PER_DAY } from "../friendly";
import { GIFTS_IN_PER_DAY, TICKETS_CAP, WELCOME_TICKETS } from "../passes";
import { KEEP_ACTIVITY_DAYS, KEEP_PASS_GIFT_DAYS } from "../rules";
import { WorldError, type InboxItem } from "../world/types";
import { loadMods } from "./admins";
import { db } from "./db";
import * as friendly from "./friendly";
import { HttpError } from "./http";
import { claim, didTask, openWallet, passState } from "./passes";
import { admins, friendNotes, friendships, passCounters, passGifts, passWallets, users, type UserRow } from "./schema";
import * as world from "./world";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// 送 1 张寻访券 between 触须之交 (friendly.ts giftTicket, passes.ts receiveGift). Runs against the database named in
// vitest.config.mts, wiped before every test.

/** Noon, Beijing time: well inside a site day */
const NOON = Date.parse("2026-11-14T12:00:00+08:00");
const MINUTE = 60_000;
const DAY = 86_400_000;

async function player(email: string, ak: string[] = []): Promise<UserRow> {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now, favArknights: ak })
    .returning();
  return u;
}

/** x and y become 触须之交, a day before NOON */
async function befriend(x: UserRow, y: UserRow) {
  const [a, b] = x.id < y.id ? [x.id, y.id] : [y.id, x.id];
  await db.insert(friendships).values({ a, b, createdAt: new Date(NOON - DAY) });
}

/** How from sees to among their 触须之交 (Friend.id) */
const key = (from: UserRow, to: UserRow) => world.friendKey(from.id, to.id);
const give = (from: UserRow, to: UserRow, now = NOON) => friendly.giftTicket(from, key(from, to), now);

async function wallet(userId: string) {
  const [w] = await db.select().from(passWallets).where(eq(passWallets.userId, userId));
  return w;
}

/** Why a gift was refused: the words a player reads, or the status of a refusal that hides it all */
async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof WorldError) return e.message;
    if (e instanceof HttpError) return e.status;
    throw e;
  }
  throw new Error("not refused");
}

const fullUp = () => fmt(T.server.passes.giftsFull, { n: GIFTS_IN_PER_DAY });

/** The 消息 of a player about 寻访券, as they would read them at now */
async function giftNews(u: UserRow, now: number) {
  const items = await friendly.friendlyInbox(u, new Set(), now);
  return items.filter((i): i is Extract<InboxItem, { kind: "gift" | "giftsFull" }> => i.kind === "gift" || i.kind === "giftsFull");
}

/** What a's card of b says of 送 1 张寻访券 today */
const giftOnCard = async (a: UserRow, b: UserRow, now = NOON) =>
  (await friendly.betweenOf(a, [{ user: b, since: new Date(NOON - DAY) }], now)).get(b.id)!.gift;

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${passCounters} cascade`);
  vi.stubEnv("PASSES", "on");
  vi.stubEnv("PASS_GIFTS", "");
  vi.stubEnv("PASS_ART", "off");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("送 1 张寻访券", () => {
  it("gives a 触须之交 a ticket out of nowhere, once a site day each, which turns at 04:00 Beijing time", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await befriend(a, b);
    await openWallet(a, NOON);
    await openWallet(b, NOON);

    await give(a, b);
    expect(await wallet(b.id)).toMatchObject({ tickets: WELCOME_TICKETS + 1, giftsIn: 1 });
    // the giver keeps every ticket of theirs
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS);
    expect(await refused(give(a, b, NOON + MINUTE))).toBe(T.server.passes.giftedToday);
    // each way counts on its own
    await give(b, a, NOON + MINUTE);
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS + 1);

    const before4 = Date.parse("2026-11-15T03:59:00+08:00");
    const at4 = Date.parse("2026-11-15T04:00:00+08:00");
    expect(await refused(give(a, b, before4))).toBe(T.server.passes.giftedToday);
    await give(a, b, at4);
    expect(await wallet(b.id)).toMatchObject({ tickets: WELCOME_TICKETS + 2, giftsIn: 1, day: "2026-11-15" });
    expect((await passState(b.id, at4)).giftsIn).toBe(1);
  });

  it("lets a player be given 3 a site day, by whoever comes first, past the 50 held", async () => {
    const r = await player("r@example.com");
    const givers = await Promise.all([1, 2, 3, 4].map((i) => player(`g${i}@example.com`)));
    for (const g of givers) await befriend(g, r);
    await openWallet(r, NOON);
    await db.update(passWallets).set({ tickets: TICKETS_CAP }).where(eq(passWallets.userId, r.id));

    for (const g of givers.slice(0, 3)) await give(g, r);
    expect(await wallet(r.id)).toMatchObject({ tickets: TICKETS_CAP + 3, giftsIn: GIFTS_IN_PER_DAY });
    expect(await refused(give(givers[3], r))).toBe(fullUp());
    expect(await db.select().from(passGifts).where(eq(passGifts.toId, r.id))).toHaveLength(3);
    // 每日任务 bring none past 50
    await didTask(r.id, "touch", NOON);
    await expect(claim(r, "touch", NOON)).rejects.toThrow("满 50 张");
    expect((await wallet(r.id)).tickets).toBe(TICKETS_CAP + 3);

    await give(givers[3], r, NOON + DAY);
    expect(await wallet(r.id)).toMatchObject({ tickets: TICKETS_CAP + 4, giftsIn: 1 });
  });

  it("never gives one more than 3 when many give at once", async () => {
    const r = await player("r@example.com");
    const givers = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => player(`g${i}@example.com`)));
    for (const g of givers) await befriend(g, r);
    // r never opened 寻访: the first gifts also race to make the wallet
    const tries = await Promise.allSettled(givers.map((g) => give(g, r)));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(GIFTS_IN_PER_DAY);
    for (const t of tries) if (t.status === "rejected") expect((t.reason as Error).message).toBe(fullUp());
    expect(await wallet(r.id)).toMatchObject({ tickets: GIFTS_IN_PER_DAY, giftsIn: GIFTS_IN_PER_DAY, welcomed: false });
    expect(await db.select().from(passGifts).where(eq(passGifts.toId, r.id))).toHaveLength(GIFTS_IN_PER_DAY);
    const notes = await db.select().from(friendNotes).where(and(eq(friendNotes.toUserId, r.id), eq(friendNotes.kind, "gift")));
    expect(notes).toHaveLength(GIFTS_IN_PER_DAY);
  });

  it("starts the receiver's day again with the first gift of a new site day", async () => {
    const r = await player("r@example.com");
    const g = await player("g@example.com");
    await befriend(g, r);
    const before4 = Date.parse("2026-11-14T03:59:00+08:00");
    const at4 = Date.parse("2026-11-14T04:00:00+08:00");
    await openWallet(r, before4);
    for (const task of ["touch", "touch", "declare", "reply", "npc"] as const) await didTask(r.id, task, before4);
    await claim(r, "touch", before4);
    await db.update(passWallets).set({ giftsIn: GIFTS_IN_PER_DAY }).where(eq(passWallets.userId, r.id));
    const old = await passState(r.id, before4);
    expect(old.tasks.map((t) => [t.done, t.got])).toEqual([[2, 2], [1, 0], [1, 0], [1, 0]]);
    expect(old.giftsIn).toBe(GIFTS_IN_PER_DAY);

    await give(g, r, at4);
    expect(await wallet(r.id)).toMatchObject({ day: "2026-11-14", touch: 0, touchGot: 0, declare: 0, reply: 0, npc: 0, giftsIn: 1, tickets: WELCOME_TICKETS + 2 + 1 });
    // and 每日任务 start again from nothing
    await didTask(r.id, "reply", at4);
    const now = await passState(r.id, at4);
    expect(now.tasks.map((t) => [t.done, t.got])).toEqual([[0, 0], [0, 0], [1, 0], [0, 0]]);
    expect(now.giftsIn).toBe(1);
  });

  it("is only between 触须之交: not to a stranger, nor once they are no longer", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    expect(await refused(give(a, b))).toBe(T.server.common.notFriends);
    await befriend(a, b);
    await give(a, b);
    await world.unfriend(a.id, key(a, b));
    expect(await refused(give(a, b, NOON + DAY))).toBe(T.server.common.notFriends);
    expect(await refused(give(b, a, NOON + DAY))).toBe(T.server.common.notFriends);
    expect((await wallet(b.id)).tickets).toBe(1);
  });

  it("makes the wallet of a player who never opened 寻访, who still gets the first ten, and nothing for play before", async () => {
    const a = await player("a@example.com");
    const r = await player("r@example.com", ["阿米娅"]);
    await befriend(a, r);
    await give(a, r);
    expect(await wallet(r.id)).toMatchObject({ tickets: 1, giftsIn: 1, welcomed: false });
    expect(await didTask(r.id, "touch", NOON)).toEqual({});
    expect((await wallet(r.id)).touch).toBe(0);
    const opened = await openWallet(r, NOON + MINUTE);
    expect(opened).toMatchObject({ tickets: 1 + WELCOME_TICKETS, welcomed: true, gifts: true });
    expect(opened.wish).toHaveLength(1);
    expect(opened.giftsIn).toBe(1);
    await didTask(r.id, "touch", NOON + MINUTE);
    expect((await claim(r, "touch", NOON + MINUTE)).tickets).toBe(2 + WELCOME_TICKETS);
  });

  it("is for those 寻访 is open to: nobody while PASS_GIFTS is off, the 站长 and the admins alone while PASSES is admins", async () => {
    const owner = await player("owner@example.com");
    const mod = await player("mod@example.com");
    const someone = await player("someone@example.com");
    await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
    await loadMods();
    await befriend(owner, mod);
    await befriend(owner, someone);
    await openWallet(owner, NOON);

    vi.stubEnv("PASS_GIFTS", "off");
    expect(await refused(give(owner, mod))).toBe(404);
    expect(await giftOnCard(owner, mod)).toBeUndefined();
    expect((await passState(owner.id, NOON)).gifts).toBe(false);

    vi.stubEnv("PASS_GIFTS", "");
    vi.stubEnv("PASSES", "admins");
    expect(await refused(give(owner, someone))).toBe(T.server.passes.giftClosed);
    expect(await refused(give(someone, owner))).toBe(404);
    expect(await giftOnCard(owner, someone)).toBeUndefined();
    expect(await giftOnCard(owner, mod)).toBe("ok");
    await give(owner, mod);
    expect(await wallet(someone.id)).toBeUndefined();
    expect((await wallet(mod.id)).tickets).toBe(1);
  });
});

describe("寻访券 in 消息", () => {
  it("tells the receiver, with 回送一张 till they give one back, and arrives answered if they gave one that day", async () => {
    const a = await player("a@example.com");
    const r = await player("r@example.com");
    await befriend(a, r);
    await give(a, r);
    const [came] = await giftNews(r, NOON + MINUTE);
    expect(came).toMatchObject({ kind: "gift", friendId: key(r, a), returned: false, replied: false, seen: false });
    expect(came.kind === "gift" && came.from).toBeTruthy();

    // 回送一张 is a gift like any: theirs to you now says 已经回送, and yours reaches them answered
    await give(r, a, NOON + 2 * MINUTE);
    expect(await giftNews(r, NOON + 3 * MINUTE)).toMatchObject([{ kind: "gift", returned: true }]);
    expect(await giftNews(a, NOON + 3 * MINUTE)).toMatchObject([{ kind: "gift", friendId: key(a, r), returned: true }]);

    // a gift from them on a later day waits for one of yours again, and one from you answers it, however it went
    await give(a, r, NOON + DAY);
    const later = (await giftNews(r, NOON + DAY + MINUTE)).sort((x, y) => y.at - x.at);
    expect(later.map((i) => i.kind === "gift" && i.returned)).toEqual([false, true]);
    await give(r, a, NOON + DAY + 2 * MINUTE);
    expect((await giftNews(r, NOON + DAY + 3 * MINUTE)).every((i) => i.kind === "gift" && i.returned)).toBe(true);
  });

  it("says once that the day's 3 came, just above the last, till the day turns", async () => {
    const r = await player("r@example.com");
    const givers = await Promise.all([1, 2, 3].map((i) => player(`g${i}@example.com`)));
    for (const g of givers) await befriend(g, r);
    await give(givers[0], r, NOON);
    await give(givers[1], r, NOON + MINUTE);
    expect((await giftNews(r, NOON + 2 * MINUTE)).some((i) => i.kind === "giftsFull")).toBe(false);
    await give(givers[2], r, NOON + 2 * MINUTE);
    const news = (await giftNews(r, NOON + 3 * MINUTE)).sort((x, y) => y.at - x.at);
    expect(news.map((i) => i.kind)).toEqual(["giftsFull", "gift", "gift", "gift"]);
    expect(news[0]).toMatchObject({ at: NOON + 2 * MINUTE + 1, seen: false, replied: true });

    // seen with the gifts it came with
    await friendly.seeFriendly(r.id, news.map((i) => i.id));
    expect((await giftNews(r, NOON + 3 * MINUTE)).every((i) => i.seen)).toBe(true);
    const tomorrow = await giftNews(r, NOON + DAY);
    expect(tomorrow.map((i) => i.kind)).toEqual(["gift", "gift", "gift"]);
  });
});

describe("送券 on the cards and in 一键", () => {
  it("says on a 触须之交's card whether TA may be given one today, and takes none of the day's acts", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    const c = await player("c@example.com");
    await befriend(a, b);
    await befriend(a, c);
    expect(await giftOnCard(a, b)).toBe("ok");
    await give(a, b);
    expect(await giftOnCard(a, b)).toBe("given");
    expect(await giftOnCard(a, b, NOON + DAY)).toBe("ok");
    const others = await Promise.all([1, 2, 3].map((i) => player(`g${i}@example.com`)));
    for (const g of others) {
      await befriend(g, c);
      await give(g, c);
    }
    expect(await giftOnCard(a, c)).toBe("full");
    const between = (await friendly.betweenOf(a, [{ user: b, since: new Date(NOON - DAY) }], NOON)).get(b.id)!;
    expect(between.actsLeft).toBe(FRIEND_ACTS_PER_DAY);
  });

  it("gives many at once (一键), each by the rules for one, and brings the giver no ticket", async () => {
    const now = Date.now();
    const a = await player("a@example.com");
    const [b, c, d] = await Promise.all(["b", "c", "d"].map((n) => player(`${n}@example.com`)));
    for (const x of [b, c, d]) await befriend(a, x);
    await openWallet(a, now);
    // c was given all a day brings, d had one from a already
    for (const i of [1, 2, 3]) {
      const g = await player(`g${i}@example.com`);
      await befriend(g, c);
      await give(g, c, now);
    }
    await give(a, d, now);
    const res = await friendly.friendsAct(a.id, "gift", [key(a, b), key(a, c), key(a, d), "nobody"]);
    expect(res).toEqual([
      { id: key(a, b), ok: true },
      { id: key(a, c), ok: false, why: fullUp() },
      { id: key(a, d), ok: false, why: T.server.passes.giftedToday },
      { id: "nobody", ok: false, why: T.server.common.notFriends },
    ]);
    expect((await wallet(b.id)).tickets).toBe(1);
    expect((await wallet(a.id)).tickets).toBe(WELCOME_TICKETS);
    vi.stubEnv("PASS_GIFTS", "off");
    expect(await refused(friendly.friendsAct(a.id, "gift", [key(a, b)]))).toBe(404);
  });
});

describe("keeping 送券", () => {
  it(`forgets who gave whom after ${KEEP_PASS_GIFT_DAYS} days, the note in 消息 too, and nothing else sooner`, async () => {
    const now = Date.now();
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await befriend(a, b);
    const old = now - (KEEP_PASS_GIFT_DAYS + 1) * DAY;
    const lately = now - DAY;
    await give(a, b, old);
    await give(a, b, lately);
    await db.insert(friendNotes).values({ fromUserId: a.id, toUserId: b.id, kind: "hug", period: "old#1", createdAt: new Date(old) });

    await friendly.pruneFriendly(new Date(now - KEEP_ACTIVITY_DAYS * DAY), now);
    const gifts = await db.select({ at: passGifts.createdAt }).from(passGifts);
    expect(gifts.map((g) => g.at.getTime())).toEqual([lately]);
    const notes = await db.select({ kind: friendNotes.kind, at: friendNotes.createdAt }).from(friendNotes);
    expect(notes.map((n) => `${n.kind}@${n.at.getTime()}`).sort()).toEqual([`gift@${lately}`, `hug@${old}`].sort());
  });
});
