import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Declaration } from "../declarations";
import { EMPTY_PROFILE, type Profile } from "../profile";
import type { LngLat } from "../types";
import { passersby, TESTERS } from "../world/cast";
import { reachText } from "../world/logic";
import type { PlaceTarget } from "../world/types";
import { db } from "./db";
import { identities, resetDemo, seedDemo } from "./demo";
import { listen } from "./live";
import { pruneOldActivity } from "./retention";
import { declarations, deliveries, friendCuts, friendships, moves, reactions, roaches, sessions, touches, users } from "./schema";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const PEOPLES_SQUARE = { lng: 121.4737, lat: 31.2304 };
const TOKYO = { lng: 139.7, lat: 35.68 };
const tester = (key: string) => TESTERS.find((t) => t.id === key)!;
const TOTAL = passersby().length + TESTERS.reduce((n, t) => n + t.roaches.length, 0);

/** The world as one player sees it, like the API does for a signed-in session. */
function as(id: string) {
  return {
    id,
    me: async () => (await world.me(id))!,
    roaches: () => world.publicRoaches(id),
    saveProfile: (p: Profile) => world.saveProfile(id, p),
    placeRoach: (target: PlaceTarget, spot: LngLat) => world.placeRoach(id, target, spot),
    removeRoach: (roachId: string) => world.removeRoach(id, roachId),
    touch: (publicId: string, bold: boolean) => world.touch(id, publicId, bold),
    reply: (itemId: string, bold: boolean) => world.reply(id, itemId, bold),
    inbox: () => world.inbox(id),
    markSeen: (itemIds: string[]) => world.markSeen(id, itemIds),
    declare: (d: Declaration, from?: string[]) => world.declare(id, d, from),
    react: (itemId: string, reaction: string) => world.react(id, itemId, reaction),
    ignore: (itemId: string) => world.ignore(id, itemId),
    friends: () => world.friends(id),
    unfriend: (friendId: string) => world.unfriend(id, friendId),
    radar: () => world.radar(id),
    identities: () => identities(id, null),
  };
}
type Player = ReturnType<typeof as>;

async function signUp(email: string) {
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: new Date(), policyAcceptedAt: new Date() })
    .returning({ id: users.id });
  return as(u.id);
}

async function demo(key: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.demoKey, key));
  return as(u.id);
}

/** Find the roach placed at a spot in what a player sees. */
async function publicAt(viewer: Player, at: LngLat) {
  const hit = (await viewer.roaches()).find((r) => r.lng === at.lng && r.lat === at.lat);
  if (!hit) throw new Error(`no public roach at ${at.lng},${at.lat}`);
  return hit;
}

let me: Player;
beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${roaches}, ${touches}, ${declarations}, ${deliveries}, ${reactions}, ${friendships}, ${friendCuts}, ${moves}`,
  );
  await seedDemo();
  me = await signUp("me@example.com");
});

describe("server world", () => {
  it("starts with the testers and the passers-by, and no roach of your own", async () => {
    expect((await me.me()).roaches).toEqual([]);
    expect(await me.roaches()).toHaveLength(TOTAL);
  });

  it("shows other players' roaches where they were placed, without owner or internal id", async () => {
    const all = await me.roaches();
    for (const t of TESTERS) {
      for (const p of t.roaches) await publicAt(me, p);
    }
    for (const r of all.slice(0, 50)) expect(Object.keys(r).sort()).toEqual(["avatar", "clone", "color", "friend", "id", "lat", "lng"]);
    const ownIds = new Set((await db.select({ id: roaches.id }).from(roaches)).map((r) => r.id));
    expect(all.some((r) => ownIds.has(r.id))).toBe(false);
  });

  it("lists your own roaches apart from everyone else's", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    expect((await me.me()).roaches[0]).toMatchObject(PEOPLES_SQUARE);
    expect((await me.roaches()).some((r) => r.lng === PEOPLES_SQUARE.lng)).toBe(false);

    const t1 = await demo("t1");
    // everyone else's roaches plus yours, minus t1's own two
    expect(await t1.roaches()).toHaveLength(TOTAL + 1 - 2);
    await publicAt(t1, PEOPLES_SQUARE);
  });

  it("does not let clones point back at their main roach", async () => {
    const all = await me.roaches();
    const clones = all.filter((r) => r.clone);
    expect(clones.length).toBe(TESTERS.reduce((n, t) => n + t.roaches.length - 1, 0));
    expect(new Set(clones.map((r) => r.color))).toEqual(new Set(["white"]));
    expect(new Set(clones.map((r) => r.avatar))).toEqual(new Set(["hood"]));
    // main roaches show the look their owner picked
    expect((await publicAt(me, tester("t3").roaches[0])).avatar).toBe("imp");
    // touching two roaches of one owner gives no hint that they share an owner
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const kal = tester("t3");
    const main = await publicAt(me, kal.roaches[0]);
    const beijingClone = await publicAt(me, kal.roaches[1]);
    expect([main.clone, beijingClone.clone]).toEqual([false, true]);
    await me.touch(main.id, false);
    await expect(me.touch(beijingClone.id, false)).resolves.toEqual({ newFriend: null });
  });

  it("delivers a bold touch with the toucher's profile, and a sneaky one without", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", drPrefix: true, games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const r1 = await publicAt(me, tester("t2").roaches[0]);
    await me.touch(r1.id, true);
    await expect(me.touch(r1.id, true)).rejects.toThrow("今天已经碰过");

    const r2 = await publicAt(me, tester("t1").roaches[0]);
    await me.touch(r2.id, false);

    const inbox2 = await (await demo("t2")).inbox();
    expect(inbox2).toHaveLength(1);
    expect(inbox2[0]).toMatchObject({ kind: "touch", bold: true, seen: false, target: "main" });
    expect(inbox2[0].kind === "touch" && inbox2[0].from?.displayName).toBe("Dr. Breeze");

    const inbox1 = await (await demo("t1")).inbox();
    expect(inbox1[0]).toMatchObject({ kind: "touch", bold: false, from: null });
  });

  it("says which of your roaches was touched, and lets you touch back once", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, TOKYO);
    const t1 = await demo("t1");
    await t1.touch((await publicAt(t1, TOKYO)).id, false);

    const [item] = await me.inbox();
    expect(item).toMatchObject({ kind: "touch", target: "clone", replied: false });
    await me.reply(item.id, true);
    await expect(me.reply(item.id, true)).rejects.toThrow("已经碰过");
    await me.markSeen([item.id]);
    expect((await me.inbox())[0]).toMatchObject({ seen: true, replied: true });

    const [back] = await t1.inbox();
    expect(back).toMatchObject({ kind: "touch", target: "touch", bold: true });
  });

  it("lets you crawl away from a touch without the toucher ever knowing", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true);
    const [touch] = await me.inbox();
    expect(touch).toMatchObject({ kind: "touch", ignored: false, seen: false });

    await expect(t1.ignore(touch.id)).rejects.toThrow("找不到");
    await me.ignore(touch.id);
    expect((await me.inbox())[0]).toMatchObject({ ignored: true, seen: true, replied: false });
    await expect(me.reply(touch.id, true)).rejects.toThrow("默默爬走");
    // nothing reaches the toucher
    expect(await t1.inbox()).toEqual([]);
  });

  it("shares a UID only when its owner opted in", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const kal = await demo("t3"); // shares UID
    await kal.touch((await publicAt(kal, PEOPLES_SQUARE)).id, true);
    const aBai = await demo("t1"); // does not
    await aBai.touch((await publicAt(aBai, PEOPLES_SQUARE)).id, true);
    const froms = (await me.inbox()).map((i) => (i.kind === "touch" ? i.from : null));
    expect(froms.find((f) => f?.displayName === "Kal")?.uid).toEqual({ arknights: "12345678" });
    expect(froms.find((f) => f?.displayName === "Dr. 阿白")?.uid).toBeUndefined();
  });

  it("sends a declaration to players with any roach within 10 km, once each, without telling where", async () => {
    await expect(me.declare({ template: "launch", game: "arknights" })).rejects.toThrow("先放下蟑螂本体");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const { reach } = await me.declare({ template: "launch", game: "arknights" });
    expect(reach).toContain("10 公里内");
    await expect(me.declare({ template: "launch", game: "endfield" })).rejects.toThrow("歇一会儿");

    for (const key of ["t1", "t2", "t3", "t5"]) {
      const items = await (await demo(key)).inbox();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: "declaration", text: "明日方舟，启动！", seen: false });
      expect(Object.keys(items[0]).sort()).toEqual(["at", "id", "kind", "options", "reaction", "replied", "seen", "text"]);
    }
    expect(await (await demo("t4")).inbox()).toHaveLength(0); // Beijing
  });

  it("declares from the roaches you pick, such as a clone far from your main roach", async () => {
    const BEIJING = tester("t4").roaches[0];
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, BEIJING);
    const [, clone] = (await me.me()).roaches;

    await expect(me.declare({ template: "launch", game: "arknights" }, [])).rejects.toThrow("选一只蟑螂");
    const aBaiRoach = (await (await demo("t1")).me()).roaches[0];
    await expect(me.declare({ template: "launch", game: "arknights" }, [clone.id, aBaiRoach.id])).rejects.toThrow("找不到");

    await me.declare({ template: "launch", game: "arknights" }, [clone.id]);
    // Dr. 夜莺厨 lives in Beijing and Kal has a clone there; 小林 is only in Shanghai
    expect(await (await demo("t4")).inbox()).toHaveLength(1);
    expect(await (await demo("t3")).inbox()).toHaveLength(1);
    expect(await (await demo("t2")).inbox()).toHaveLength(0);
  });

  it("reaches everyone near any picked roach once, even when near several of them", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, tester("t4").roaches[0]);
    const all = (await me.me()).roaches.map((r) => r.id);
    await me.declare({ template: "welcome", game: "endfield" }, all);
    for (const key of ["t1", "t2", "t3", "t4"]) {
      const items = await (await demo(key)).inbox();
      expect(items, key).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: "declaration", text: "欢迎回家，管理员" });
    }
  });

  it("nudges players who have the page open when something arrives for them", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t2 = await demo("t2");
    const t4 = await demo("t4");
    const count = { me: 0, t2: 0, t4: 0 };
    const offs = [
      listen(me.id, () => count.me++),
      listen(t2.id, () => count.t2++),
      listen(t4.id, () => count.t4++),
    ];

    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    expect(count).toEqual({ me: 0, t2: 1, t4: 0 });
    await me.declare({ template: "launch", game: "arknights" });
    expect(count).toEqual({ me: 0, t2: 2, t4: 0 });
    const [touchFromMe] = (await t2.inbox()).filter((i) => i.kind === "touch");
    await t2.reply(touchFromMe.id, false);
    expect(count).toEqual({ me: 1, t2: 2, t4: 0 });

    offs.forEach((off) => off());
    await (await demo("t1")).touch((await publicAt(me, tester("t2").roaches[0])).id, false);
    expect(count.t2).toBe(2);
  });

  it("lets the people who got a declaration react once each, without telling the sender who", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "birthday" });
    let nudged = 0;
    const off = listen(me.id, () => nudged++);

    const t2 = await demo("t2");
    const [got] = await t2.inbox();
    expect(got).toMatchObject({ kind: "declaration", text: "祝我生日快乐", reaction: null });
    expect(got.kind === "declaration" && got.options).toContain("birthday");
    await t2.react(got.id, "birthday");
    await expect(t2.react(got.id, "plusone")).rejects.toThrow("已经回应过");
    expect((await t2.inbox())[0]).toMatchObject({ reaction: "birthday" });
    const t1 = await demo("t1");
    await t1.react((await t1.inbox())[0].id, "zhouli");
    // 夜莺厨 lives in Beijing and never got it
    const t4 = await demo("t4");
    await expect(t4.react(got.id, "plusone")).rejects.toThrow("找不到");
    expect(nudged).toBe(2);
    off();

    const reactions = (await me.inbox()).filter((i) => i.kind === "reaction");
    expect(reactions.map((r) => r.kind === "reaction" && r.reaction).sort()).toEqual(["birthday", "zhouli"]);
    expect(reactions[0]).toMatchObject({ text: "祝我生日快乐", seen: false });
    expect(JSON.stringify(reactions)).not.toMatch(/阿白|小林|t1|t2/);
    expect(JSON.stringify(reactions)).not.toContain(t2.id);

    // the sender can touch back whoever reacted, and seeing them clears them
    const fromT2 = reactions.find((r) => r.kind === "reaction" && r.reaction === "birthday")!;
    await me.reply(fromT2.id, false);
    expect((await t2.inbox()).find((i) => i.kind === "touch")).toMatchObject({ target: "reaction", bold: false });
    await me.markSeen(reactions.map((r) => r.id));
    expect((await me.inbox()).filter((i) => i.kind === "reaction" && !i.seen)).toEqual([]);
  });

  it("keeps 生日快乐！ for birthday declarations", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    const t2 = await demo("t2");
    const [got] = await t2.inbox();
    expect(got.kind === "declaration" && got.options).not.toContain("birthday");
    await expect(t2.react(got.id, "birthday")).rejects.toThrow("不能这样回应");
    await expect(t2.react(got.id, "nonsense")).rejects.toThrow("不能这样回应");
  });

  it("puts the sender's name in 「我是…，我要玩…」 as it was when they said it", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", drPrefix: true, games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "myname", game: "endfield", name: "冒充别人" } as Declaration);
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: true, games: ["arknights"] });
    expect((await (await demo("t2")).inbox())[0]).toMatchObject({ text: "我是Dr. Breeze，我要玩终末地" });
  });

  it("only lets you declare with your own favourites and listed titles", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(me.declare({ template: "iam", character: "能天使", title: "狗" })).rejects.toThrow("厨力角色");
    await me.saveProfile({ ...EMPTY_PROFILE, games: ["arknights"], favourites: { arknights: ["能天使"], endfield: [] } });
    await expect(me.declare({ template: "iam", character: "能天使", title: "不存在的称呼" })).rejects.toThrow("称呼");
    await expect(me.declare({ template: "iam", character: "能天使", title: "管理员" })).rejects.toThrow("称呼");
    await me.declare({ template: "iam", character: "能天使", title: "狗" });
    expect((await (await demo("t2")).inbox())[0]).toMatchObject({ text: "我是能天使的狗" });
  });

  it("caps clones, rotates public ids on moves, and takes clones back with the main roach", async () => {
    await expect(me.placeRoach({ kind: "clone" }, PEOPLES_SQUARE)).rejects.toThrow("先放下蟑螂本体");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    for (let i = 0; i < 3; i++) await me.placeRoach({ kind: "clone" }, { lng: 100 + i, lat: 20 });
    await expect(me.placeRoach({ kind: "clone" }, { lng: 110, lat: 20 })).rejects.toThrow("最多只能放 3 只");

    const t1 = await demo("t1");
    const before = new Set((await t1.roaches()).map((r) => r.id));
    const { roaches: mine } = await me.me();
    await me.placeRoach({ kind: "move", roachId: mine[1].id }, { lng: 105, lat: 25 });
    const after = (await t1.roaches()).filter((r) => !before.has(r.id));
    expect(after).toHaveLength(1);
    expect(after[0].clone).toBe(true);

    const main = (await me.me()).roaches.find((r) => r.slot === 0)!;
    expect(await me.removeRoach(main.id)).toEqual([]);
    expect((await t1.roaches()).length).toBe(TOTAL - 2);
  });

  it("validates profiles", async () => {
    const saved = await me.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "  阿米娅的狗  ",
      games: ["endfield"],
      favourites: { arknights: ["能天使"], endfield: ["佩丽卡", "不存在", "佩丽卡", "陈千语", "管理员", "莱万汀"] },
      uid: { arknights: "123", endfield: "8899" },
    });
    expect(saved.name).toBe("阿米娅的狗");
    expect(saved.favourites).toEqual({ arknights: [], endfield: ["佩丽卡", "陈千语", "管理员"] });
    expect(saved.uid).toEqual({ arknights: "", endfield: "8899" });
    expect((await me.me()).profile).toEqual(saved);
    await expect(me.saveProfile({ ...EMPTY_PROFILE, uid: { arknights: "", endfield: "<script>" }, games: ["endfield"] })).rejects.toThrow("UID");
    await expect(me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: " " })).rejects.toThrow("名字");
  });

  it("lists passers-by someone touched as identities to step into", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const k = passersby().findIndex((p) => p.city === "上海");
    await me.touch((await publicAt(me, passersby()[k])).id, true);
    const passer = await demo(`n${k}`);
    const ids = await me.identities();
    expect(ids.find((i) => i.group === "passerby")).toMatchObject({ id: passer.id, unseen: 1, note: "上海" });

    expect((await passer.inbox())[0]).toMatchObject({ kind: "touch", bold: true });
    expect((await passer.me()).roaches).toEqual([expect.objectContaining({ slot: 0, lng: passersby()[k].lng })]);
  });

  it("resets the demo players and all activity, but keeps real players' roaches", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t2 = await demo("t2");
    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    await t2.placeRoach({ kind: "move", roachId: (await t2.me()).roaches[0].id }, TOKYO);

    await resetDemo();
    expect((await me.me()).roaches).toEqual([expect.objectContaining(PEOPLES_SQUARE)]);
    const fresh = await demo("t2");
    expect(await fresh.inbox()).toEqual([]);
    expect((await fresh.me()).roaches[0]).toMatchObject(tester("t2").roaches[0]);
    expect(await me.roaches()).toHaveLength(TOTAL);
  });

  it("makes two players 触须之交 once both have touched each other boldly", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const aBaiRoach = await publicAt(me, tester("t1").roaches[0]);
    expect(await me.touch(aBaiRoach.id, true)).toEqual({ newFriend: null });

    const t1 = await demo("t1");
    const [touchFromMe] = await t1.inbox();
    expect(await t1.reply(touchFromMe.id, true)).toEqual({ newFriend: "Breeze" });
    const [friend] = await t1.friends();
    expect(friend.profile.displayName).toBe("Breeze");
    expect(friend.roaches).toHaveLength(1);
    expect(friend.roaches[0]).toMatchObject({ friend: true, clone: false, ...PEOPLES_SQUARE });

    const items = await me.inbox();
    expect(items.find((i) => i.kind === "friend")).toMatchObject({ seen: false, from: { displayName: "Dr. 阿白" } });
    const [aBai] = await me.friends();
    // their main roach and Tokyo clone, both marked on your map
    expect(aBai.roaches.map((r) => r.clone)).toEqual([false, true]);
    const marked = (await me.roaches()).filter((r) => r.friend);
    expect(marked.map((r) => r.id).sort()).toEqual(aBai.roaches.map((r) => r.id).sort());
    expect(aBai.history).toContainEqual({ kind: "befriended", at: expect.any(Number), you: true });
    expect(aBai.history.some((e) => e.kind === "touched" && e.you && e.bold)).toBe(true);
  });

  it("does not count sneaky touches towards 触须之交", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, false);
    const t2 = await demo("t2");
    const [item] = await t2.inbox();
    expect(await t2.reply(item.id, true)).toEqual({ newFriend: null });
    expect(await t2.friends()).toEqual([]);
  });

  it("keeps third parties anonymous in a friend's history, and can be undone", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, true);
    const t1 = await demo("t1");
    const [item] = await t1.inbox();
    await t1.reply(item.id, true);
    // 阿白 also touches Kal, a stranger to you
    await t1.touch((await publicAt(t1, tester("t3").roaches[0])).id, false);

    const [f] = await me.friends();
    const third = f.history.find((e) => e.kind === "touched" && !e.you);
    expect(third).toEqual({ kind: "touched", at: expect.any(Number), bold: false, you: false });
    const kal = await demo("t3");
    expect(JSON.stringify(f)).not.toContain(kal.id);
    expect(JSON.stringify(f)).not.toContain("Kal");
    expect(JSON.stringify(f)).not.toContain(t1.id);

    await me.unfriend(f.id);
    expect(await me.friends()).toEqual([]);
    expect((await me.roaches()).some((r) => r.friend)).toBe(false);
    expect(await t1.friends()).toEqual([]);
    // old touches no longer count; a fresh pair of bold touches is needed
    expect(await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true)).toEqual({ newFriend: null });
  });

  it("runs the radar around your main roach, counting arrivals and departures across its edge", async () => {
    expect(await me.radar()).toBeNull();
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const before = (await me.radar())!;
    expect(before.radiusKm).toBe(100);
    expect(before.roaches).toBeGreaterThan(100);
    expect(before.players).toBeLessThanOrEqual(before.roaches);
    expect(before.daily).toHaveLength(7);
    expect(before.week.arrived).toBeGreaterThan(0);
    expect(before.week.arrived).toBeGreaterThanOrEqual(before.day.arrived);

    // 小林 leaves Shanghai for Beijing; Dr. 夜莺厨 (Beijing) drops a clone in Shanghai
    const t2 = await demo("t2");
    await t2.placeRoach({ kind: "move", roachId: (await t2.me()).roaches[0].id }, { lng: 116.4, lat: 39.9 });
    await (await demo("t4")).placeRoach({ kind: "clone" }, { lng: 121.45, lat: 31.22 });
    const after = (await me.radar())!;
    expect(after.day.left).toBe(before.day.left + 1);
    expect(after.day.arrived).toBe(before.day.arrived + 1);
    expect(after.day.clones).toBe(before.day.clones + 1);
    expect(after.daily[6].left).toBe(before.daily[6].left + 1);

    // your own moves never show up on your radar
    await me.placeRoach({ kind: "clone" }, { lng: 121.5, lat: 31.3 });
    expect((await me.radar())!.day).toEqual(after.day);
  });

  it("forgets touches, declarations and moves older than 90 days, keeping newer ones", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    await me.declare({ template: "birthday" });
    const t2 = await demo("t2");
    expect(await t2.inbox()).toHaveLength(2);

    // pretend a hundred days pass
    await pruneOldActivity(Date.now() + 100 * 86_400_000);
    expect(await t2.inbox()).toEqual([]);
    expect(await db.select().from(moves)).toEqual([]);
    expect(await db.select().from(deliveries)).toEqual([]);
    // the roaches themselves stay
    expect((await me.me()).roaches).toHaveLength(1);

    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, false);
    await pruneOldActivity();
    expect(await (await demo("t1")).inbox()).toHaveLength(1);
  });

  it("buckets the declaration head count", () => {
    expect(reachText(0)).toContain("暂时没有");
    expect(reachText(3)).toContain("不到 5 只");
    expect(reachText(7)).toContain("5–10 只");
    expect(reachText(49)).toContain("20–50 只");
    expect(reachText(500)).toContain("50 多只");
  });
});
