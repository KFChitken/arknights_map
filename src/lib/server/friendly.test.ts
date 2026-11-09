import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, beijingDate, beijingMidnight } from "../beijing";
import type { Declaration } from "../declarations";
import { anniversaryText, type Gesture } from "../friendly";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { FIRE_AT, isNearFire } from "../talulah";
import type { LngLat } from "../types";
import { distanceKm } from "../geo";
import type { InboxItem, PlaceTarget, RideTarget } from "../world/types";
import { deleteAccount } from "./account";
import { db } from "./db";
import * as friendly from "./friendly";
import { declarations, friendNotes, friendships, moves, roaches, touches, users, visits } from "./schema";
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
  it("lets each be done once a day while TA is awake, and returned once as your own", async () => {
    await a.gesture(key(a, b), "hug");
    await expect(a.gesture(key(a, b), "hug")).rejects.toThrow("今天已经和 TA 贴贴过了");
    await a.gesture(key(a, b), "luck");
    await expect(a.gesture(key(a, b), "blanket")).rejects.toThrow("TA 醒着呢");
    await expect(a.gesture(key(a, b), "dance")).rejects.toThrow("没有这个动作");
    expect((await between(a, b)).done).toMatchObject({ hug: true, highfive: false, luck: true, blanket: false });

    const hug = of(await b.inbox(), "gesture").find((g) => g.gesture === "hug")!;
    expect(hug).toMatchObject({ from: { displayName: "Dr. A" }, returned: false });
    await b.gesture(key(b, a), "hug", hug.id);
    expect(of(await b.inbox(), "gesture").find((g) => g.gesture === "hug")).toMatchObject({ returned: true });
    expect(of(await a.inbox(), "gesture")).toMatchObject([{ gesture: "hug", from: { displayName: "Dr. B" } }]);
    // returning it was their one for today
    await expect(b.gesture(key(b, a), "hug")).rejects.toThrow("今天已经和 TA 贴贴过了");
    const luck = of(await b.inbox(), "gesture").find((g) => g.gesture === "luck")!;
    await expect(b.gesture(key(b, a), "hug", luck.id)).rejects.toThrow("找不到这条消息了");

    // no limit on touching meanwhile
    await expect(a.touch((await mainOf(b)).publicId, false)).rejects.toThrow("今天已经碰过这只蟑螂了");
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
    expect(answers.find((r) => r.from)).toMatchObject({ from: { displayName: "Dr. B" }, reaction: "birthday" });
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
