import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, beijingDate, beijingMidnight } from "../beijing";
import type { Declaration } from "../declarations";
import { anniversaryText, type Gesture } from "../friendly";
import { helpAnswerText, helpText } from "../help";
import { OPERATORS } from "../operators";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { FIRE_AT, isNearFire } from "../talulah";
import type { LngLat } from "../types";
import { distanceKm } from "../geo";
import type { InboxItem, PlaceTarget, RideTarget } from "../world/types";
import { deleteAccount } from "./account";
import { db } from "./db";
import * as friendly from "./friendly";
import * as help from "./help";
import { declarations, friendNotes, friendships, helpRequests, moves, roaches, touches, users, visits } from "./schema";
import * as safety from "./safety";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const PEOPLES_SQUARE = { lng: 121.4737, lat: 31.2304 };
const NEAR_SQUARE = { lng: 121.48, lat: 31.235 };
const TOKYO = { lng: 139.7, lat: 35.68 };

/** The world as one player sees it, like the API does for a signed-in session. */
function as(id: string) {
  return {
    id,
    me: async () => (await world.me(id))!,
    saveProfile: (p: Profile) => world.saveProfile(id, p),
    placeRoach: (target: PlaceTarget, spot: LngLat) => world.placeRoach(id, target, spot),
    removeRoach: (roachId: string) => world.removeRoach(id, roachId),
    rideMinghe: (target: RideTarget) => world.rideMinghe(id, target),
    touch: (publicId: string, bold: boolean) => world.touch(id, publicId, bold),
    inbox: () => world.inbox(id),
    markSeen: (itemIds: string[]) => world.markSeen(id, itemIds),
    declare: (d: Declaration) => world.declare(id, d),
    react: (itemId: string, reaction: string) => world.react(id, itemId, reaction),
    friends: () => world.friends(id),
    unfriend: (friendId: string) => world.unfriend(id, friendId),
    block: (target: string) => safety.block(id, target),
    drink: () => world.drink(id),
    sober: () => world.sober(id),
    remindSanity: (friendId: string) => friendly.remindSanity(id, friendId),
    answerSanity: (itemId: string, answer: string) => friendly.answerSanity(id, itemId, answer),
    gesture: (friendId: string, g: Gesture | string, replyTo?: string) => friendly.gesture(id, friendId, g, replyTo),
    visit: (friendId: string, publicId: string, cloneId?: string) => friendly.visit(id, friendId, publicId, cloneId),
    goHome: (cloneId: string) => friendly.goHome(id, cloneId),
    followHost: (cloneId: string) => friendly.followHost(id, cloneId),
    sendHome: (friendId: string) => friendly.sendHome(id, friendId),
    gameAsk: (friendId: string, game: string) => friendly.gameAsk(id, friendId, game),
    gameAdded: (itemId: string) => friendly.gameAdded(id, itemId),
    gameWant: (friendId: string, game: string) => friendly.gameWant(id, friendId, game),
  };
}
type Player = ReturnType<typeof as>;

/** A player who ticked everything, with a name, a main roach where given */
async function player(email: string, name: string, at?: LngLat) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  const p = as(u.id);
  await p.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name, drPrefix: true });
  if (at) await p.placeRoach({ kind: "main" }, at);
  return p;
}

const mainOf = async (p: Player) => (await p.me()).roaches.find((r) => r.slot === 0)!;
/** How a sees b in their 触须之交: Friend.id */
const key = (a: Player, b: Player) => world.friendKey(a.id, b.id);

/** Two players who touched each other's main roach boldly */
async function befriend(a: Player, b: Player) {
  await a.touch((await mainOf(b)).publicId, true);
  await b.touch((await mainOf(a)).publicId, true);
}

/** 触须之交 again a day later, after they stopped being so */
async function befriendAgain(a: Player, b: Player) {
  await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '25 hours'` });
  await befriend(a, b);
}

const of = <K extends InboxItem["kind"]>(items: InboxItem[], kind: K) => items.filter((i): i is Extract<InboxItem, { kind: K }> => i.kind === kind);
const metres = (x: LngLat, y: LngLat) => distanceKm(x, y) * 1000;
const between = async (a: Player, b: Player) => (await a.friends()).find((f) => f.id === key(a, b))!.between!;

let a: Player;
let b: Player;
beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  a = await player("a@example.com", "A", PEOPLES_SQUARE);
  b = await player("b@example.com", "B", TOKYO);
  await befriend(a, b);
});

describe("催理智", () => {
  it("reminds a 触须之交 once a day either way, and only 「清完了！」 comes back", async () => {
    await a.remindSanity(key(a, b));
    await expect(a.remindSanity(key(a, b))).rejects.toThrow("今天已经催过 TA 了");
    await b.remindSanity(key(b, a));
    expect((await between(a, b)).done.sanity).toBe(true);

    const [note] = of(await b.inbox(), "sanity");
    expect(note).toMatchObject({ from: { displayName: "Dr. A" }, asleep: false, answer: null, seen: false });
    await b.answerSanity(note.id, "done");
    await expect(b.answerSanity(note.id, "ok")).rejects.toThrow("已经回过了");
    expect(of(await b.inbox(), "sanity")[0]).toMatchObject({ answer: "done", seen: true });
    const [thanks] = of(await a.inbox(), "sanityThanks");
    expect(thanks).toMatchObject({ from: { displayName: "Dr. B" }, seen: false });
    await a.markSeen([thanks.id]);
    expect(of(await a.inbox(), "sanityThanks")[0].seen).toBe(true);

    // 「知道啦」 tells nobody
    const [theirs] = of(await a.inbox(), "sanity");
    await a.answerSanity(theirs.id, "ok");
    expect(of(await b.inbox(), "sanityThanks")).toEqual([]);

    // only 触须之交, and only the one it was sent to answers it
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await expect(c.remindSanity(key(c, a))).rejects.toThrow("你们已经不是触须之交了");
    await expect(c.answerSanity(note.id, "done")).rejects.toThrow("找不到这条消息了");
  });

  it("reaches a drunk 触须之交, who sees it on waking up, saying it came while asleep", async () => {
    await b.drink();
    await a.remindSanity(key(a, b));
    expect(of(await b.inbox(), "sanity")).toEqual([]);
    await b.sober();
    expect(of(await b.inbox(), "sanity")[0]).toMatchObject({ asleep: true });
  });
});

describe("小动作", () => {
  it("lets 催理智 and the gestures add up to three a day for one 触须之交, each of theirs returned once as one of yours", async () => {
    await a.gesture(key(a, b), "hug");
    await a.gesture(key(a, b), "hug");
    expect((await between(a, b)).actsLeft).toBe(1);
    await a.remindSanity(key(a, b));
    await expect(a.gesture(key(a, b), "luck")).rejects.toThrow("今天和 TA 互动满 3 次了，明天再来吧。");
    await expect(a.remindSanity(key(a, b))).rejects.toThrow("今天已经催过 TA 了");
    await expect(a.gesture(key(a, b), "blanket")).rejects.toThrow("TA 醒着呢");
    await expect(a.gesture(key(a, b), "dance")).rejects.toThrow("没有这个动作");
    expect(await between(a, b)).toMatchObject({ actsLeft: 0, done: { sanity: true, blanket: false } });

    const hugs = of(await b.inbox(), "gesture").filter((g) => g.gesture === "hug");
    expect(hugs).toHaveLength(2);
    expect(hugs[0]).toMatchObject({ from: { displayName: "Dr. A" }, returned: false });
    await b.gesture(key(b, a), "hug", hugs[0].id);
    await expect(b.gesture(key(b, a), "hug", hugs[0].id)).rejects.toThrow("已经回过了");
    expect(of(await b.inbox(), "gesture").filter((g) => g.returned)).toHaveLength(1);
    expect(of(await a.inbox(), "gesture")).toMatchObject([{ gesture: "hug", from: { displayName: "Dr. B" } }]);
    // the other way round counts apart: B's answer and two more of B's own
    await b.gesture(key(b, a), "highfive");
    await b.gesture(key(b, a), "hug", hugs[1].id);
    await expect(b.gesture(key(b, a), "luck")).rejects.toThrow("今天和 TA 互动满 3 次了");
    expect(of(await b.inbox(), "gesture").some((g) => g.gesture === "hug" && !g.returned)).toBe(false);

    // a new Beijing day, three more
    await db.update(friendNotes).set({ createdAt: sql`${friendNotes.createdAt} - interval '1 day'` });
    await a.gesture(key(a, b), "luck");
    expect((await between(a, b)).actsLeft).toBe(2);

    // no limit on touching meanwhile
    await expect(a.touch((await mainOf(b)).publicId, false)).rejects.toThrow("今天已经碰过这只蟑螂了");
  });

  it("does one of them for many 触须之交 at once, each by the rules for one", async () => {
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await befriend(a, c);
    await b.drink();
    expect(await friendly.friendsAct(a.id, "hug", [key(a, b), key(a, c), "nobody", key(a, c)])).toEqual([
      { id: key(a, b), ok: false, why: "TA 睡着了，等 TA 醒了再来吧。" },
      { id: key(a, c), ok: true },
      { id: "nobody", ok: false, why: "你们已经不是触须之交了。" },
    ]);
    expect(of(await c.inbox(), "gesture")).toMatchObject([{ gesture: "hug", from: { displayName: "Dr. A" }, returned: false }]);
    // 催理智 reaches the sleeping one too; each is one of the day's three
    expect((await friendly.friendsAct(a.id, "sanity", [key(a, b), key(a, c)])).every((r) => r.ok)).toBe(true);
    expect((await between(a, c)).actsLeft).toBe(1);
    expect(await friendly.friendsAct(a.id, "highfive", [key(a, c)])).toEqual([{ id: key(a, c), ok: true }]);
    expect(await friendly.friendsAct(a.id, "luck", [key(a, c)])).toEqual([{ id: key(a, c), ok: false, why: "今天和 TA 互动满 3 次了，明天再来吧。" }]);
    await expect(friendly.friendsAct(a.id, "poke", [key(a, c)])).rejects.toThrow("没有这个动作");
    await expect(friendly.friendsAct(a.id, "hug", [])).rejects.toThrow("先选几位触须之交");
  });

  it("covers a sleeping 触须之交 once a sleep, seen on waking up", async () => {
    await expect(a.gesture(key(a, b), "water")).rejects.toThrow("TA 醒着呢");
    await b.drink();
    await expect(a.gesture(key(a, b), "highfive")).rejects.toThrow("TA 睡着了");
    await a.gesture(key(a, b), "blanket");
    await a.gesture(key(a, b), "water");
    await expect(a.gesture(key(a, b), "blanket")).rejects.toThrow("已经给 TA 盖过被子了");
    const asleep = await between(a, b);
    expect(asleep).toMatchObject({ asleep: true, done: { blanket: true, water: true } });
    expect(asleep.mainId).toBe((await mainOf(b)).publicId);
    expect(of(await b.inbox(), "gesture")).toEqual([]);

    // a new sleep, a new blanket
    await b.sober();
    expect(of(await b.inbox(), "gesture").map((g) => g.gesture).sort()).toEqual(["blanket", "water"]);
    await db.update(users).set({ drunkUntil: new Date(Date.now() + 3_600_000) }).where(eq(users.id, b.id));
    expect((await between(a, b)).done.blanket).toBe(false);
    await a.gesture(key(a, b), "blanket");
  });
});

describe("串门", () => {
  it("seats a new clone by a 触须之交's roach, tells the host once with a word about the door, and goes home", async () => {
    const host = await mainOf(b);
    const { roaches: mine, seat } = await a.visit(key(a, b), host.publicId);
    expect(metres(seat, host)).toBeLessThan(40);
    expect(metres(seat, host)).toBeGreaterThan(3);
    const clone = mine.find((r) => r.slot > 0)!;
    expect(clone).toMatchObject({ visit: { friendId: key(a, b), name: "Dr. B", left: null } });
    expect((await between(a, b)).visiting).toEqual({ cloneId: clone.id, left: false });
    expect((await mainOf(b)).guests).toEqual([{ friendId: key(b, a), name: "Dr. A" }]);
    const [came] = of(await b.inbox(), "visit");
    expect(came).toMatchObject({ event: "came", tip: true, from: { displayName: "Dr. A" } });
    expect(metres(came.spot!, seat)).toBeLessThan(1);
    await expect(a.visit(key(a, b), host.publicId)).rejects.toThrow("你已经在 TA 家了");

    // nothing on the shared map says whose clone it is
    expect(JSON.stringify(await world.me(b.id))).not.toContain(clone.publicId);

    // home: a clone put down for the visit is taken back, and no move is counted
    const movesBefore = (await db.select().from(moves).where(eq(moves.userId, a.id))).length;
    await a.goHome(clone.id);
    expect((await a.me()).roaches.filter((r) => r.slot > 0)).toEqual([]);
    expect(await db.select().from(moves).where(eq(moves.userId, a.id))).toHaveLength(movesBefore);
    expect((await mainOf(b)).guests).toBeUndefined();

    // a second guest later: no word about the door again
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await befriend(c, b);
    await c.visit(key(c, b), host.publicId);
    expect(of(await b.inbox(), "visit").find((v) => v.from.displayName === "Dr. C")).toMatchObject({ tip: false });
  });

  it("moves an existing clone when asked, back to where it stood on going home, and keeps guests apart", async () => {
    const [, clone] = await a.placeRoach({ kind: "clone" }, NEAR_SQUARE);
    const host = await mainOf(b);
    await a.visit(key(a, b), host.publicId, clone.id);
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await befriend(c, b);
    const { seat } = await c.visit(key(c, b), host.publicId);
    const aSeat = (await a.me()).roaches.find((r) => r.id === clone.id)!;
    expect(metres(aSeat, seat)).toBeGreaterThanOrEqual(6);
    expect((await mainOf(b)).guests?.map((g) => g.name).sort()).toEqual(["Dr. A", "Dr. C"]);

    await a.goHome(clone.id);
    const back = (await a.me()).roaches.find((r) => r.id === clone.id)!;
    expect(metres(back, NEAR_SQUARE)).toBeLessThan(1);
    expect(back.publicId).not.toBe(aSeat.publicId);
  });

  it("lets the host send a guest home, who may not come back for three days", async () => {
    const host = await mainOf(b);
    await a.visit(key(a, b), host.publicId);
    await b.sendHome(key(b, a));
    expect((await a.me()).roaches.filter((r) => r.slot > 0)).toEqual([]);
    expect(of(await a.inbox(), "visit")).toMatchObject([{ event: "sentHome", from: { displayName: "Dr. B" } }]);
    await expect(a.visit(key(a, b), host.publicId)).rejects.toThrow("Dr. B 请你的克隆体回家休息了，3 天后才能再去。");
    expect((await between(a, b)).visitAgainAt).toBeGreaterThan(Date.now());
    await expect(b.sendHome(key(b, a))).rejects.toThrow("已经回家了");
  });

  it("leaves a guest where it sits when the host moves or takes back the roach, telling it once", async () => {
    const [, hostClone] = await b.placeRoach({ kind: "clone" }, { lng: 139.71, lat: 35.69 });
    const { roaches: mine } = await a.visit(key(a, b), hostClone.publicId);
    const guest = mine.find((r) => r.slot > 0)!;
    await b.placeRoach({ kind: "move", roachId: hostClone.id }, { lng: 139.75, lat: 35.7 });
    const [moved] = of(await a.inbox(), "visit");
    expect(moved).toMatchObject({ event: "hostMoved", cloneId: guest.id });
    expect((await a.me()).roaches.find((r) => r.id === guest.id)).toMatchObject({ lng: guest.lng, lat: guest.lat, visit: { left: "moved" } });
    expect((await b.me()).roaches.find((r) => r.id === hostClone.id)!.guests).toBeUndefined();
    expect((await between(a, b)).visiting).toEqual({ cloneId: guest.id, left: true });
    await expect(a.visit(key(a, b), hostClone.publicId)).rejects.toThrow();
    // moving again tells nobody again
    await b.placeRoach({ kind: "move", roachId: hostClone.id }, { lng: 139.76, lat: 35.7 });
    expect(of(await a.inbox(), "visit")).toHaveLength(1);

    // 跟过去 is a move
    const { seat } = await a.followHost(guest.id);
    expect(metres(seat, { lng: 139.76, lat: 35.7 })).toBeLessThan(40);
    expect((await b.me()).roaches.find((r) => r.id === hostClone.id)!.guests).toHaveLength(1);

    // taken back: only home is left
    await b.removeRoach(hostClone.id);
    expect(of(await a.inbox(), "visit")[0]).toMatchObject({ event: "hostRemoved", cloneId: guest.id });
    await expect(a.followHost(guest.id)).rejects.toThrow("TA 收回了那只蟑螂");
    await a.goHome(guest.id);
    expect(of(await a.inbox(), "visit")[0]).toMatchObject({ cloneId: null });
  });

  it("ends visits quietly when the guest moves its clone, the two stop being 触须之交, or the host's account goes", async () => {
    const host = await mainOf(b);
    const { roaches: mine } = await a.visit(key(a, b), host.publicId);
    const guest = mine.find((r) => r.slot > 0)!;
    await a.placeRoach({ kind: "move", roachId: guest.id }, NEAR_SQUARE);
    expect((await mainOf(b)).guests).toBeUndefined();
    expect(await db.select().from(visits)).toEqual([]);

    await a.visit(key(a, b), host.publicId, guest.id);
    await b.unfriend(key(b, a));
    expect(metres((await a.me()).roaches.find((r) => r.id === guest.id)!, NEAR_SQUARE)).toBeLessThan(1);
    expect(of(await a.inbox(), "visit")).toEqual([]);

    await befriendAgain(a, b);
    await a.visit(key(a, b), host.publicId, guest.id);
    await deleteAccount((await db.select().from(users).where(eq(users.id, b.id)))[0]);
    expect(metres((await a.me()).roaches.find((r) => r.id === guest.id)!, NEAR_SQUARE)).toBeLessThan(1);
  });

  it("sends guests home when the host stops taking them, and refuses new ones", async () => {
    const host = await mainOf(b);
    await a.visit(key(a, b), host.publicId);
    await b.saveProfile({ ...(await b.me()).profile, welcomeGuests: false });
    expect((await a.me()).roaches.filter((r) => r.slot > 0)).toEqual([]);
    expect(of(await a.inbox(), "visit")).toMatchObject([{ event: "closed" }]);
    expect((await between(a, b)).welcome).toBe(false);
    await expect(a.visit(key(a, b), host.publicId)).rejects.toThrow("TA 现在不接待客人");
    // a page from before the switch existed sends none, which is on
    const older: Partial<Profile> = { ...(await b.me()).profile };
    delete older.welcomeGuests;
    await b.saveProfile(older as Profile);
    expect((await between(a, b)).welcome).toBe(true);
  });

  it("refuses a roach riding with 明河都尉, and seats guests of a roach by 塔露拉干员's fire by the fire", async () => {
    const [, rider] = await b.placeRoach({ kind: "clone" }, { lng: 139.72, lat: 35.69 });
    await b.rideMinghe({ kind: "move", roachId: rider.id });
    const riding = (await b.me()).roaches.find((r) => r.id === rider.id)!;
    await expect(a.visit(key(a, b), riding.publicId)).rejects.toThrow("这只在跟明河走");

    const byFire = (await b.placeRoach({ kind: "clone" }, { lng: FIRE_AT.lng + 0.0006, lat: FIRE_AT.lat })).find((r) => r.slot === 2)!;
    const { seat } = await a.visit(key(a, b), byFire.publicId);
    expect(isNearFire(seat)).toBe(true);
    expect(metres(seat, byFire)).toBeLessThan(25);
  });
});

describe("游戏里也加个好友", () => {
  const shares = (server: string) => ({
    ...EMPTY_PROFILE,
    anonymous: false,
    name: "B",
    drPrefix: true,
    games: ["arknights", "endfield"] as Profile["games"],
    uid: { arknights: "12345678", endfield: "" },
    uidServer: { arknights: server, endfield: "" },
    shareUid: true,
  });

  it("says 我在游戏里申请了 on a shared UID of the same server, and both see 游戏里也是好友 once confirmed", async () => {
    await b.saveProfile(shares("bili"));
    await a.saveProfile({ ...(await a.me()).profile, games: ["arknights"], uidServer: { arknights: "bili", endfield: "" } });
    await a.gameAsk(key(a, b), "arknights");
    await expect(a.gameAsk(key(a, b), "arknights")).rejects.toThrow("已经告诉过 TA 了，7 天后可以再说一次");
    await expect(a.gameAsk(key(a, b), "endfield")).rejects.toThrow("TA 没有分享这个游戏的 UID");
    expect((await between(a, b)).games.arknights).toMatchObject({ added: false });
    expect((await between(a, b)).games.arknights!.askAgainAt).toBeGreaterThan(Date.now());

    const [ask] = of(await b.inbox(), "game");
    expect(ask).toMatchObject({ event: "ask", game: "arknights", server: "B服", answered: false, from: { displayName: "Dr. A" } });
    await b.gameAdded(ask.id);
    await expect(b.gameAdded(ask.id)).rejects.toThrow("已经说过了");
    expect((await between(a, b)).games.arknights).toEqual({ added: true, askAgainAt: null });
    // both of them see it
    expect((await between(b, a)).games.arknights!.added).toBe(true);
    expect(of(await a.inbox(), "game")).toMatchObject([{ event: "added", game: "arknights", from: { displayName: "Dr. B" } }]);
    await expect(a.gameAsk(key(a, b), "arknights")).rejects.toThrow("你们在游戏里已经是好友了");

    // forgotten once they stop being 触须之交
    await a.unfriend(key(a, b));
    await befriendAgain(a, b);
    expect((await between(a, b)).games.arknights!.added).toBe(false);
  });

  it("refuses different servers, and says 想在游戏里加你 once a week where no UID is shared", async () => {
    await b.saveProfile(shares("cn"));
    await a.saveProfile({ ...(await a.me()).profile, games: ["arknights"], uidServer: { arknights: "bili", endfield: "" } });
    await expect(a.gameAsk(key(a, b), "arknights")).rejects.toThrow("你们不在一个服务器");
    await expect(a.gameWant(key(a, b), "arknights")).rejects.toThrow("直接加 TA");
    await a.gameWant(key(a, b), "endfield");
    await expect(a.gameWant(key(a, b), "endfield")).rejects.toThrow("7 天后");
    expect(of(await b.inbox(), "game")).toMatchObject([{ event: "want", game: "endfield", from: { displayName: "Dr. A" } }]);
  });
});

describe("触须之交纪念日", () => {
  /** As if they became 触须之交 n days before today (Beijing dates) */
  const metDaysAgo = (n: number) =>
    db
      .update(friendships)
      .set({ createdAt: new Date(beijingMidnight(addDays(beijingDate(), -n)) + 3_600_000) })
      .where(sql`true`);

  it("brings both a card on the 7th, 30th, 100th and 365th day, seen once, and kept for 30 days", async () => {
    for (const [ago, day] of [
      [6, 7],
      [29, 30],
      [99, 100],
      [364, 365],
    ]) {
      await metDaysAgo(ago);
      for (const [p, q] of [
        [a, b],
        [b, a],
      ]) {
        expect(of(await p.inbox(), "anniversary")).toMatchObject([{ day, from: { displayName: q === a ? "Dr. A" : "Dr. B" }, seen: false }]);
        expect((await between(p, q)).anniversary).toBe(day);
      }
    }
    expect(anniversaryText(365, "Dr. A")).toBe("今天是你和 Dr. A 成为触须之交的第 365 天，满一年啦");
    expect(anniversaryText(730, "Dr. A")).toBe("今天是你和 Dr. A 成为触须之交的第 730 天，满两年啦");

    const [card] = of(await a.inbox(), "anniversary");
    await a.markSeen([card.id]);
    expect(of(await a.inbox(), "anniversary")[0].seen).toBe(true);
    expect(of(await b.inbox(), "anniversary")[0].seen).toBe(false);

    // the 30th, ten days on: still there, dated that day; nothing on the days between
    await metDaysAgo(39);
    expect(of(await b.inbox(), "anniversary")).toMatchObject([{ day: 30, at: beijingMidnight(addDays(beijingDate(), -10)) }]);
    expect((await between(a, b)).anniversary).toBeNull();
    await metDaysAgo(3);
    expect(of(await a.inbox(), "anniversary")).toEqual([]);
  });
});

describe("生日祝福送到所有触须之交", () => {
  it("reaches every 触须之交 however far, by name, and their answers come back by name; strangers stay anonymous", async () => {
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    const d = await player("d@example.com", "D", NEAR_SQUARE);
    await befriend(a, d);
    const { reach } = await a.declare({ template: "birthday" });
    expect(reach).toMatch(/你的 2 位触须之交也都收到了。$/);

    const [far] = of(await b.inbox(), "declaration");
    expect(far).toMatchObject({ from: { displayName: "Dr. A" }, friendId: key(b, a) });
    const [near] = of(await d.inbox(), "declaration");
    expect(near).toMatchObject({ from: { displayName: "Dr. A" } });
    expect(of(await d.inbox(), "declaration")).toHaveLength(1);
    const [stranger] = of(await c.inbox(), "declaration");
    expect(stranger.from).toBeUndefined();

    await b.react(far.id, "birthday");
    await c.react(stranger.id, "birthday");
    const answers = of(await a.inbox(), "reaction");
    expect(answers.find((r) => r.from)).toMatchObject({ from: { displayName: "Dr. B" }, reaction: { id: "birthday", text: "生日快乐！" } });
    expect(answers.filter((r) => !r.from)).toHaveLength(1);

    // within 30 days: only those nearby hear it, as anyone's
    await db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - interval '2 days'` });
    const again = await a.declare({ template: "birthday" });
    expect(again.reach).not.toContain("触须之交");
    expect(of(await b.inbox(), "declaration")).toHaveLength(1);
    expect(of(await d.inbox(), "declaration").find((x) => !x.from)).toBeTruthy();
  });
});

describe("kept between the two of them", () => {
  it("forgets notes after 90 days but not that two are friends in a game; blocking ends visits", async () => {
    await a.remindSanity(key(a, b));
    await db
      .update(friendNotes)
      .set({ createdAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(and(eq(friendNotes.fromUserId, a.id), eq(friendNotes.kind, "sanity")));
    await friendly.pruneFriendly(new Date(Date.now() - 90 * 86_400_000));
    expect(await db.select().from(friendNotes)).toEqual([]);

    const host = await mainOf(b);
    await a.visit(key(a, b), host.publicId);
    await b.block(`friend:${key(b, a)}`);
    expect((await a.me()).roaches.filter((r) => r.slot > 0)).toEqual([]);
    expect(await db.select().from(roaches).where(eq(roaches.userId, a.id))).toHaveLength(1);
  });
});

describe("特别关注", () => {
  it("puts the starred first, in the order starred, for nobody but you, gone with the friendship", async () => {
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await befriend(a, c);
    // newest first before any star
    expect((await a.friends()).map((f) => f.profile.displayName)).toEqual(["Dr. C", "Dr. B"]);
    await world.starFriend(a.id, key(a, b), true);
    await world.starFriend(a.id, key(a, b), true);
    const starred = await a.friends();
    expect(starred[0]).toMatchObject({ id: key(a, b), star: expect.any(Number) });
    expect(starred.find((f) => f.id === key(a, c))!.star).toBeNull();
    // B sees nothing of it
    expect((await b.friends()).find((f) => f.id === key(b, a))!.star).toBeNull();
    await world.starFriend(a.id, key(a, b), false);
    expect((await a.friends()).find((f) => f.id === key(a, b))!.star).toBeNull();

    await world.starFriend(a.id, key(a, c), true);
    await a.unfriend(key(a, c));
    await expect(world.starFriend(a.id, key(a, c), true)).rejects.toThrow("你们已经不是触须之交了");
    await befriendAgain(a, c);
    expect((await a.friends()).find((f) => f.id === key(a, c))!.star).toBeNull();
  });
});

describe("求助", () => {
  const plays = async (p: Player, games: ("arknights" | "endfield")[]) => {
    const { profile } = await p.me();
    await p.saveProfile({ ...profile, games });
  };
  const board = (p: Player) => help.helpBoard(p.id);
  const OPERATOR = OPERATORS.arknights[0];

  it("shows a request only to 触须之交 who play that game, as a dot until they look, and tells the asker who answered", async () => {
    const c = await player("c@example.com", "C", NEAR_SQUARE);
    await befriend(a, c);
    await plays(a, ["arknights"]);
    await plays(b, ["arknights", "endfield"]);
    await plays(c, ["endfield"]);
    const inboxBefore = await b.inbox();
    await help.askHelp(a.id, { kind: "clues", game: "arknights", clues: [5, 3, 3, 9] });

    const [theirs] = (await board(b)).theirs;
    expect(theirs).toMatchObject({ kind: "clues", game: "arknights", clues: [3, 5], fresh: true, friendId: key(b, a), answered: null, from: { displayName: "Dr. A" } });
    expect(helpText(theirs)).toBe("明日方舟 · 缺 3、5 号线索");
    expect(theirs.until - theirs.at).toBe(24 * 3_600_000);
    expect((await board(c)).theirs).toEqual([]);
    expect((await b.me()).help).toEqual({ asks: 1, answers: 0 });
    // nothing in 消息
    expect(await b.inbox()).toEqual(inboxBefore);
    await help.seeHelp(b.id);
    expect((await b.me()).help).toEqual({ asks: 0, answers: 0 });
    expect((await board(b)).theirs[0].fresh).toBe(false);

    await expect(help.answerHelp(b.id, theirs.id, [4])).rejects.toThrow("选一下送了哪几号");
    await help.answerHelp(b.id, theirs.id, [3, 4]);
    await expect(help.answerHelp(b.id, theirs.id, [5])).rejects.toThrow("已经回应过了");
    await expect(help.answerHelp(c.id, theirs.id, [5])).rejects.toThrow("你没有在玩这个游戏");
    await expect(help.answerHelp(a.id, theirs.id, [5])).rejects.toThrow("这是你自己的求助");
    expect((await board(b)).theirs[0].answered).toEqual({ clues: [3] });

    expect((await a.me()).help).toEqual({ asks: 0, answers: 1 });
    const [mine] = (await board(a)).mine;
    expect(mine).toMatchObject({ fresh: true, answers: [{ friendId: key(a, b), name: "Dr. B", clues: [3], fresh: true }] });
    expect(helpAnswerText(mine, mine.answers![0].name, mine.answers![0].clues)).toBe("Dr. B 送了你 3 号线索");
    await help.seeHelp(a.id);
    expect((await a.me()).help.answers).toBe(0);
  });

  it("keeps one of each kind for each game, three a day, up for a day unless closed, and only among 触须之交", async () => {
    await plays(a, ["arknights", "endfield"]);
    await plays(b, ["arknights", "endfield"]);
    await help.askHelp(a.id, { kind: "exchange", game: "endfield" });
    await help.askHelp(a.id, { kind: "support", game: "arknights", operator: OPERATOR, skill: 3 });
    await help.askHelp(a.id, { kind: "support", game: "arknights", operator: OPERATOR, skill: 0 });
    const shown = (await board(b)).theirs;
    expect(shown.map((r) => helpText(r))).toEqual([`明日方舟 · 想借 ${OPERATOR} 当助战`, "终末地 · 开了线索交流，来我帝江号拜访吧"]);
    await help.askHelp(a.id, { kind: "support", game: "arknights", operator: OPERATOR, skill: 1 });
    await expect(help.askHelp(a.id, { kind: "support", game: "arknights", operator: OPERATOR, skill: 2 })).rejects.toThrow("今天这种求助已经发了 3 次");
    await expect(help.askHelp(a.id, { kind: "support", game: "endfield", operator: OPERATOR, skill: 1 })).rejects.toThrow("这个游戏没有这种求助");
    await expect(help.askHelp(a.id, { kind: "support", game: "arknights", operator: "不是干员", skill: 1 })).rejects.toThrow("选一位干员");
    await expect(help.askHelp(a.id, { kind: "clues", game: "arknights", clues: [] })).rejects.toThrow("选一下缺几号线索");
    await expect(help.askHelp(a.id, { kind: "wish", game: "arknights" })).rejects.toThrow("没有这种求助");

    const [support, exchange] = (await board(b)).theirs;
    expect(support).toMatchObject({ kind: "support", operator: OPERATOR, skill: 1 });
    await help.answerHelp(b.id, support.id);
    expect(helpAnswerText((await board(a)).mine[0], "Dr. B")).toBe(`Dr. B 挂上了 ${OPERATOR}`);

    // closed early, or a day on: gone
    await help.closeHelp(a.id, exchange.id);
    await expect(help.closeHelp(a.id, exchange.id)).rejects.toThrow("这条求助已经结束了");
    await expect(help.answerHelp(b.id, exchange.id)).rejects.toThrow("这条求助已经结束了");
    await db.update(helpRequests).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await board(b)).toEqual({ mine: [], theirs: [] });
    expect(await board(a)).toEqual({ mine: [], theirs: [] });

    // no longer 触须之交: nothing either way
    await help.askHelp(a.id, { kind: "exchange", game: "arknights" });
    const [up] = (await board(b)).theirs;
    await b.unfriend(key(b, a));
    expect((await board(b)).theirs).toEqual([]);
    await expect(help.answerHelp(b.id, up.id)).rejects.toThrow("你们已经不是触须之交了");

    // a week on, deleted
    await db.update(helpRequests).set({ createdAt: sql`${helpRequests.createdAt} - interval '8 days'` });
    await help.pruneHelp();
    expect(await db.select().from(helpRequests)).toEqual([]);
  });
});
