import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Declaration } from "../declarations";
import { FIRST_BATCH, SURVIVOR_DAYS } from "../badges";
import { beijingDate } from "../beijing";
import { EVENTS } from "../events";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { POLICY_UPDATED_AT } from "../rules";
import type { LngLat } from "../types";
import { passersby, TESTERS } from "../world/cast";
import { reachText } from "../world/logic";
import type { PlaceTarget, PublicRoach } from "../world/types";
import { isBanned } from "./account";
import { allPlayers, openCases, resolveCase, retentionStats, setBadge } from "./admin";
import { award, catchUpBadges, markBadgesSeen, shownBadges, signedUp, wakeUp, wear } from "./badges";
import { awayExtraDays, flipTheAway } from "./away";
import { acceptPublicPlace, agreeAgain } from "./consent";
import { addNameWords, forgetNameWords, listNameWords, namesHit, removeNameWord, removeNameWords } from "./nameWords";
import { computeHotList } from "./hotList";
import { db } from "./db";
import { identities, resetDemo, seedDemo } from "./demo";
import { listen } from "./live";
import { pruneOldActivity } from "./retention";
import { allRoaches } from "./roachFeed";
import * as safety from "./safety";
import {
  bannedEmails,
  blocks,
  dailyTotals,
  declarations,
  deliveries,
  friendCuts,
  friendships,
  moves,
  nameWords,
  radarScans,
  reactions,
  reports,
  roaches,
  sessions,
  touches,
  userBadges,
  users,
} from "./schema";
import { recordDailyTotals } from "./totals";
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
    roaches: () => mapOf(id),
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
    block: (target: string) => safety.block(id, target),
    unblock: (blockId: string) => safety.unblock(id, blockId),
    blocks: () => safety.blockList(id),
    report: (target: string, reason: string, note = "") => safety.report(id, target, reason, note),
    identities: () => identities(id, null),
  };
}
type Player = ReturnType<typeof as>;

/** A player who ticked everything: at sign-up, and before their first roach. */
async function signUp(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return as(u.id);
}

async function userRow(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}

async function demo(key: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.demoKey, key));
  return as(u.id);
}

/** What a player's map shows: the shared feed without their own roaches, friends' marked, as the browser does it. */
async function mapOf(id: string): Promise<PublicRoach[]> {
  const own = new Set(((await world.me(id))?.roaches ?? []).map((r) => r.publicId));
  const friendIds = new Set((await world.friends(id)).flatMap((f) => f.roaches.map((r) => r.id)));
  return (await allRoaches()).filter((r) => !own.has(r.id)).map((r) => ({ ...r, friend: friendIds.has(r.id) }));
}

/** Make a player's radar scans look older than the free reopening window. */
async function rewindScans(userId: string) {
  await db.update(radarScans).set({ createdAt: sql`${radarScans.createdAt} - interval '11 minutes'` }).where(eq(radarScans.userId, userId));
}

/** Make a player and a tester 触须之交: a bold touch on the tester's main roach, touched back boldly. */
async function befriend(p: Player, key: string) {
  await p.touch((await publicAt(p, tester(key).roaches[0])).id, true);
  const t = await demo(key);
  const touch = (await t.inbox()).find((i) => i.kind === "touch" && !i.replied)!;
  await t.reply(touch.id, true);
}

const badgeIds = async (p: Player) => (await p.me()).badges.map((b) => b.id);

/** Find the roach placed at a spot in what a player sees. */
async function publicAt(viewer: Player, at: LngLat) {
  const hit = (await viewer.roaches()).find((r) => r.lng === at.lng && r.lat === at.lat);
  if (!hit) throw new Error(`no public roach at ${at.lng},${at.lat}`);
  return hit;
}

let me: Player;
beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${roaches}, ${touches}, ${declarations}, ${deliveries}, ${reactions}, ${friendships}, ${friendCuts}, ${moves}, ${blocks}, ${reports}, ${bannedEmails}, ${radarScans}, ${userBadges}, ${dailyTotals}, ${nameWords}`,
  );
  forgetNameWords();
  await seedDemo();
  me = await signUp("me@example.com");
});

describe("server world", () => {
  it("lists every real account's email and name for the admin, newest first, without demo players", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: true, name: "阿白" });
    const other = await signUp("other@example.com");
    const players = await allPlayers();
    expect(players.map((p) => p.email)).toEqual(["other@example.com", "me@example.com"]);
    expect(players[1]).toMatchObject({ id: me.id, name: "阿白", anonymous: true });
    expect(Object.keys(players[0]).sort()).toEqual(["anonymous", "email", "id", "joinedAt", "name"]);
    expect(other.id).toBe(players[0].id);
  });

  it("refuses names the rules or the admin's words block, and lists the names in use they catch", async () => {
    const named = (name: string) => me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name });
    await expect(named("鹰角官方")).rejects.toThrow("这个名字用不了");
    await expect(named("管理员小王")).resolves.toMatchObject({ name: "管理员小王" });
    // a name already in use before the word was added is listed, not changed
    expect(await addNameWords("```\n小王\n=国家\n```")).toBe(2);
    expect(await namesHit()).toEqual([{ id: me.id, name: "管理员小王", anonymous: false }]);
    await expect(named("小 王 同学")).rejects.toThrow("这个名字用不了");
    await expect(named("国家队")).resolves.toMatchObject({ name: "国家队" });
    await expect(named("国家")).rejects.toThrow("这个名字用不了");
    await removeNameWord("小王");
    await expect(named("小王")).resolves.toMatchObject({ name: "小王" });

    // the admin page searches the list and deletes many at once, cleaned like the adding
    await addNameWords("测试一\n测 试 二\n别的");
    expect(await listNameWords("测试")).toMatchObject({ total: 4, found: 2 });
    expect((await listNameWords("")).words).toHaveLength(4);
    expect(await removeNameWords("测-试一\n测试二\n不在名单上")).toBe(2);
    expect(await listNameWords("")).toMatchObject({ total: 2 });
    await expect(named("国家")).rejects.toThrow("这个名字用不了");
  });

  it("gets drunk until the next morning: only the main roach lies down, and nothing says why", async () => {
    const [main] = await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, TOKYO);
    const { until } = await world.drink(me.id);
    expect(until).toBeGreaterThan(Date.now());
    expect(await me.me()).toMatchObject({ drunkUntil: until, counts: { drinks: 1 }, badges: [{ id: "tipsy", seen: false }] });
    const mine = new Set((await me.me()).roaches.map((r) => r.publicId));
    const shown = (await allRoaches()).filter((r) => mine.has(r.id));
    expect(shown.find((r) => r.id === main.publicId)).toMatchObject({ asleep: true });
    expect(shown.filter((r) => r.asleep)).toHaveLength(1);
    expect(JSON.stringify(await allRoaches())).not.toMatch(/drunk|drink/i);
    await expect(world.drink(me.id)).rejects.toThrow("已经醉倒了");

    // 醒酒 at once; the next drink waits a few seconds
    await world.sober(me.id);
    expect((await me.me()).drunkUntil).toBeNull();
    expect((await allRoaches()).some((r) => r.asleep)).toBe(false);
    await expect(world.drink(me.id)).rejects.toThrow("缓一缓");
    expect((await me.me()).counts.drinks).toBe(1);

    // moving the main roach sobers it up
    await db.update(users).set({ drunkUntil: new Date(Date.now() + 3_600_000) }).where(eq(users.id, me.id));
    await me.placeRoach({ kind: "move", roachId: main.id }, TOKYO);
    expect((await me.me()).drunkUntil).toBeNull();
  });

  it("flips the main roach of a player away 14 to 17 days at the 04:00 batch, and only that batch tells others it is back", async () => {
    const [main] = await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, TOKYO);
    // the batch's day is today's, as me() records visits by today's date
    const now = Date.now();
    const daysBefore = (n: number) => beijingDate(now - n * 86_400_000);
    const away = 14 + awayExtraDays(me.id);
    const asleep = async () => (await allRoaches()).filter((r) => r.asleep).map((r) => r.id);

    await db.update(users).set({ lastSeenOn: daysBefore(away - 1) }).where(eq(users.id, me.id));
    expect(await flipTheAway(now)).toEqual({ flipped: 0, woke: 0 });
    await db.update(users).set({ lastSeenOn: daysBefore(away) }).where(eq(users.id, me.id));
    expect(await flipTheAway(now)).toEqual({ flipped: 1, woke: 0 });
    // only the main roach, and the demo players never
    expect(await asleep()).toEqual([main.publicId]);

    // back: the owner sees it stand up once; the shared list waits for the next batch
    expect((await me.me()).wokeFromAway).toBe(true);
    expect((await me.me()).wokeFromAway).toBe(false);
    expect(await asleep()).toEqual([main.publicId]);
    expect((await flipTheAway()).woke).toBe(1);
    expect(await asleep()).toEqual([]);

    // with the switch off it never flips; a move stands it up at once
    await db.update(users).set({ lastSeenOn: daysBefore(30), flipWhenAway: false }).where(eq(users.id, me.id));
    expect((await flipTheAway(now)).flipped).toBe(0);
    await db.update(users).set({ flipWhenAway: true }).where(eq(users.id, me.id));
    expect((await flipTheAway(now)).flipped).toBe(1);
    await me.placeRoach({ kind: "move", roachId: main.id }, TOKYO);
    expect(await asleep()).toEqual([]);
  });

  it("counts a player with no recorded visit as away since 10/28 or signing up when flipping", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const now = Date.parse("2026-11-21T04:05+08:00");
    await db.update(users).set({ lastSeenOn: null, createdAt: new Date("2026-11-20T12:00+08:00") }).where(eq(users.id, me.id));
    expect((await flipTheAway(now)).flipped).toBe(0);
    await db.update(users).set({ createdAt: new Date("2026-09-01T12:00+08:00") }).where(eq(users.id, me.id));
    // 10/28 to 11/21 is 24 days, past 14 to 17
    expect((await flipTheAway(now)).flipped).toBe(1);
  });

  it("gives 泰拉异格酒神 on the 50th drink, counting every one, and never lets test players drink", async () => {
    const regular = await signUp("regular@example.com");
    await regular.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await db.update(users).set({ drinksTotal: 49 }).where(eq(users.id, regular.id));
    await award(regular.id, ["tipsy"]);
    await world.drink(regular.id);
    expect((await regular.me()).badges.map((b) => b.id)).toEqual(["tipsy", "bacchus"]);
    expect((await regular.me()).counts.drinks).toBe(50);
    await expect(world.drink((await demo("t1")).id)).rejects.toThrow("测试玩家");
  });

  it("asks before a player's first new roach that its spot is public, but not for moves", async () => {
    const shy = await signUp("shy@example.com");
    await db.update(users).set({ publicPlaceAcceptedAt: null }).where(eq(users.id, shy.id));
    expect((await shy.me()).agreedPublicPlace).toBe(false);
    await expect(shy.placeRoach({ kind: "main" }, PEOPLES_SQUARE)).rejects.toThrow("公开蟑螂位置");
    const agreedAt = async () => (await db.select().from(users).where(eq(users.id, shy.id)))[0].publicPlaceAcceptedAt;
    await acceptPublicPlace(shy.id);
    const first = await agreedAt();
    // agreeing again keeps the first time
    await acceptPublicPlace(shy.id);
    expect(await agreedAt()).toEqual(first);
    const [main] = await shy.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    expect((await shy.me()).agreedPublicPlace).toBe(true);
    // a move never asks; a new clone does
    await db.update(users).set({ publicPlaceAcceptedAt: null }).where(eq(users.id, shy.id));
    await shy.placeRoach({ kind: "move", roachId: main.id }, TOKYO);
    await expect(shy.placeRoach({ kind: "clone" }, PEOPLES_SQUARE)).rejects.toThrow("公开蟑螂位置");
  });

  it("asks accounts that agreed to an older privacy policy to agree again, but never demo players", async () => {
    const old = await signUp("old@example.com");
    const before = new Date(POLICY_UPDATED_AT.getTime() - 86_400_000);
    await db.update(users).set({ policyAcceptedAt: before, crossBorderAcceptedAt: null, publicPlaceAcceptedAt: null }).where(eq(users.id, old.id));
    expect(await old.me()).toMatchObject({ mustReconsent: true, agreedPublicPlace: false });
    // signed up on the old page after the date: still no separate consent, so still asked
    await db.update(users).set({ policyAcceptedAt: new Date() }).where(eq(users.id, old.id));
    expect((await old.me()).mustReconsent).toBe(true);
    await agreeAgain(old.id);
    expect(await old.me()).toMatchObject({ mustReconsent: false, agreedPublicPlace: true });
    expect((await me.me()).mustReconsent).toBe(false);
    expect((await (await demo("t1")).me()).mustReconsent).toBe(false);
  });

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

  it("tells a newcomer's page what the tutorial still has to show", async () => {
    expect(await me.me()).toMatchObject({ isNew: true, hasDeclared: false, hasTouched: false });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, false);
    expect(await me.me()).toMatchObject({ isNew: true, hasDeclared: true, hasTouched: true });
    await db.update(users).set({ createdAt: sql`now() - interval '8 days'` }).where(eq(users.id, me.id));
    expect(await me.me()).toMatchObject({ isNew: false, hasDeclared: false, hasTouched: false });
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
    expect(froms.find((f) => f?.displayName === "Kal")).toMatchObject({ uid: { arknights: "12345678" }, uidServer: { arknights: "cn" } });
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

  it("sends a limited-time line while its event is on, earns its badge once, and keeps it readable after", async () => {
    const lines = EVENTS.find((e) => e.id === "half2026")!.lines;
    const saved = lines.map((l) => ({ ...l }));
    const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const moveTo = (start: number, end: number) => lines.forEach((l) => Object.assign(l, { start: hoursFromNow(start), end: hoursFromNow(end) }));
    // the lines moved around now, so the test does not depend on when it runs
    moveTo(-1, 1);
    try {
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await me.declare({ template: "event", line: "tazi" });
      const t2 = await demo("t2");
      const [got] = await t2.inbox();
      expect(got).toMatchObject({ kind: "declaration", text: "恭喜塔姐上岛！" });
      await t2.react(got.id, "plusone");
      expect((await me.inbox()).find((i) => i.kind === "reaction")).toMatchObject({ text: "恭喜塔姐上岛！", reaction: "plusone" });

      await db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - interval '2 minutes'` });
      await me.declare({ template: "event", line: "yuanyuan" });
      expect(await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, me.id))).toEqual([
        { badge: "half2026" },
      ]);
      // nobody else earned it
      expect(await db.select().from(userBadges)).toHaveLength(1);

      moveTo(-48, -1);
      await db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - interval '2 minutes'` });
      await expect(me.declare({ template: "event", line: "tazi" })).rejects.toThrow("已经结束");
      expect((await t2.inbox()).map((i) => i.kind === "declaration" && i.text)).toEqual([
        "才...才不想和祀住进缘缘庄呢！",
        "恭喜塔姐上岛！",
      ]);
    } finally {
      lines.forEach((l, i) => Object.assign(l, saved[i]));
    }
  });

  it("notes the day of each visit, Beijing time, and nothing finer", async () => {
    await db.update(users).set({ lastSeenOn: "2026-01-01" }).where(eq(users.id, me.id));
    await me.me();
    const [u] = await db.select({ lastSeenOn: users.lastSeenOn }).from(users).where(eq(users.id, me.id));
    expect(u.lastSeenOn).toBe(beijingDate());
  });

  it("keeps one row of sitewide counts a day, and closes yesterday's after midnight", async () => {
    const at = (iso: string) => new Date(iso);
    const other = await signUp("other@example.com");
    const away = await signUp("away@example.com");
    await db.update(users).set({ createdAt: at("2026-11-10T09:00+08:00"), lastSeenOn: "2026-11-10" }).where(eq(users.id, me.id));
    await db.update(users).set({ createdAt: at("2026-11-09T23:59+08:00"), lastSeenOn: "2026-11-04" }).where(eq(users.id, other.id));
    await db.update(users).set({ createdAt: at("2026-10-01T12:00+08:00"), lastSeenOn: "2026-11-03" }).where(eq(users.id, away.id));
    const [a, b] = [me.id, other.id].sort();
    await db.insert(friendships).values({ a, b, createdAt: at("2026-11-10T10:00+08:00") });

    await recordDailyTotals(Date.parse("2026-11-10T12:00+08:00"));
    // seen within 11/04–11/10: me and other; the demo players never count
    expect(await db.select().from(dailyTotals)).toEqual([{ day: "2026-11-10", activeWeek: 2, signups: 1, friendships: 1 }]);

    // someone signs up a minute before midnight, after the last count of the day
    const late = await signUp("late@example.com");
    await db.update(users).set({ createdAt: at("2026-11-10T23:59+08:00") }).where(eq(users.id, late.id));
    await recordDailyTotals(Date.parse("2026-11-11T00:05+08:00"));
    expect(await db.select().from(dailyTotals).orderBy(dailyTotals.day)).toEqual([
      { day: "2026-11-10", activeWeek: 2, signups: 2, friendships: 1 },
      { day: "2026-11-11", activeWeek: 1, signups: 0, friendships: 0 },
    ]);
  });

  it("counts each player once towards the diplomacy badges, and gives 千里传须 for a friend far away", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await befriend(me, "t1");
    expect(await me.me()).toMatchObject({ counts: { friends: 1 }, badges: [{ id: "trainee", seen: false }] });
    expect(await badgeIds(await demo("t1"))).toEqual(["trainee"]);

    // apart and together again: the badge stays, and 阿白 still counts once
    await me.unfriend((await me.friends())[0].id);
    expect(await badgeIds(me)).toEqual(["trainee"]);
    await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '25 hours'` });
    await befriend(me, "t1");
    expect((await me.me()).counts.friends).toBe(1);

    // 夜莺厨 lives in Beijing, about 1070 km from People's Square
    await befriend(me, "t4");
    expect(await me.me()).toMatchObject({ counts: { friends: 2 } });
    expect(await badgeIds(me)).toEqual(["trainee", "farwhisker"]);
    expect(await badgeIds(await demo("t4"))).toEqual(["trainee", "farwhisker"]);
  });

  it("gives 罗德岛外交部发言人 once ten different players have reacted to your declarations", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    const [d] = await db.select({ id: declarations.id }).from(declarations);
    const got = await db.select({ id: deliveries.recipientId }).from(deliveries);
    expect(got.length).toBeGreaterThanOrEqual(10);
    for (const r of got.slice(0, 9)) await world.react(r.id, `d:${d.id}`, "plusone");
    expect(await me.me()).toMatchObject({ counts: { responders: 9 }, badges: [] });
    await world.react(got[9].id, `d:${d.id}`, "zhouli");
    expect(await badgeIds(me)).toEqual(["spokesperson"]);
  });

  it("numbers the first players to sign up, never giving a number out twice, and wakes every newcomer for a week", async () => {
    await db.execute(sql`select setval('first_batch_serial', 1, false)`);
    await signedUp(me.id);
    const second = await signUp("second@example.com");
    await signedUp(second.id);
    expect((await second.me()).badges).toMatchObject([{ id: "firstbatch", serial: 2 }, { id: "survivor" }]);
    await db.execute(sql`select setval('first_batch_serial', ${FIRST_BATCH}, true)`);
    const late = await signUp("late@example.com");
    await signedUp(late.id);
    expect((await late.me()).badges.map((b) => b.id)).toEqual(["survivor"]);
  });

  it("holds 石棺里的苏醒 for a week only, then gives it again on the next return", async () => {
    await wakeUp(me.id);
    const [held] = (await me.me()).badges;
    expect(held).toMatchObject({ id: "survivor", seen: false });
    expect(held.until! - held.at).toBe(SURVIVOR_DAYS * 86_400_000);
    expect(await wear(me.id, "survivor")).toBe(true);
    expect((await shownBadges([await userRow(me.id)])).get(me.id)?.worn).toBe("survivor");
    await markBadgesSeen(me.id, ["survivor"]);

    // a week later it is gone: not held, not worn, not shown, not wearable
    const weekAgo = new Date(Date.now() - SURVIVOR_DAYS * 86_400_000 - 1000);
    await db.update(userBadges).set({ earnedAt: weekAgo }).where(eq(userBadges.userId, me.id));
    expect(await me.me()).toMatchObject({ badges: [], wornBadge: null });
    expect((await shownBadges([await userRow(me.id)])).get(me.id)).toEqual({ badges: [], worn: null });
    expect(await wear(me.id, "survivor")).toBe(false);

    // back after another long time away: held again, and shown as new
    await db.update(users).set({ lastSeenOn: beijingDate(Date.now() - 20 * 86_400_000) }).where(eq(users.id, me.id));
    expect((await me.me()).badges).toMatchObject([{ id: "survivor", seen: false }]);
  });

  it("welcomes a player back after a whole day away, and wakes 石棺里的苏醒 after 14", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await db.delete(moves);
    const daysAgo = (n: number) => beijingDate(Date.now() - n * 86_400_000);
    // back the next day is not away
    await db.update(users).set({ lastSeenOn: daysAgo(1) }).where(eq(users.id, me.id));
    expect((await me.me()).homecoming).toBeNull();

    await db.update(users).set({ lastSeenOn: daysAgo(2) }).where(eq(users.id, me.id));
    const newcomer = await signUp("new@example.com");
    await newcomer.placeRoach({ kind: "main" }, { lng: PEOPLES_SQUARE.lng + 0.05, lat: PEOPLES_SQUARE.lat });
    await newcomer.placeRoach({ kind: "clone" }, TOKYO);
    const back = await me.me();
    expect(back.homecoming).toEqual({ daysAway: 2, arrivals: 1 });
    expect(back.badges).toEqual([]);
    // once a day
    expect((await me.me()).homecoming).toBeNull();

    await db.update(users).set({ lastSeenOn: daysAgo(13) }).where(eq(users.id, me.id));
    expect((await me.me()).badges).toEqual([]);
    await db.update(users).set({ lastSeenOn: daysAgo(14) }).where(eq(users.id, me.id));
    const risen = await me.me();
    expect(risen.homecoming?.daysAway).toBe(14);
    expect(risen.badges).toMatchObject([{ id: "survivor", seen: false }]);
  });

  it("counts a player with no recorded visit as away since 10/28, or since signing up if that is later", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-20T12:00+08:00"), toFake: ["Date"] });
    try {
      await db.update(users).set({ createdAt: new Date("2026-09-01T12:00+08:00"), lastSeenOn: null }).where(eq(users.id, me.id));
      const back = await me.me();
      expect(back.homecoming?.daysAway).toBe(23);
      expect(back.badges.map((b) => b.id)).toContain("survivor");
      // signed up yesterday and back today: not away
      const fresh = await signUp("fresh@example.com");
      await db.update(users).set({ createdAt: new Date("2026-11-19T12:00+08:00"), lastSeenOn: null }).where(eq(users.id, fresh.id));
      const next = await fresh.me();
      expect(next.homecoming).toBeNull();
      expect(next.badges.map((b) => b.id)).not.toContain("survivor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows badges on profile cards, the worn one first, and lets you wear only your own", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await award(me.id, ["trainee", "beta"]);
    expect(await wear(me.id, "ambassador")).toBe(false);
    expect(await wear(me.id, "beta")).toBe(true);
    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    const [touch] = await (await demo("t2")).inbox();
    expect(touch.kind === "touch" && touch.from).toMatchObject({
      displayName: "Breeze",
      badges: [{ id: "beta" }, { id: "trainee" }],
      worn: "beta",
    });
    // never on the map
    expect(JSON.stringify(await (await demo("t2")).roaches())).not.toContain("beta");

    expect(await me.me()).toMatchObject({ wornBadge: "beta", badges: [{ seen: false }, { seen: false }] });
    await markBadgesSeen(me.id, ["trainee", "beta"]);
    expect((await me.me()).badges.every((b) => b.seen)).toBe(true);
    await wear(me.id, null);
    expect((await me.me()).wornBadge).toBeNull();
  });

  it("lets the admin hand out 内测功臣 and take any badge back, by email", async () => {
    await setBadge(" ME@example.com", "beta", true);
    expect(await badgeIds(me)).toEqual(["beta"]);
    await expect(setBadge("me@example.com", "beta", true)).rejects.toThrow("已经有");
    await expect(setBadge("me@example.com", "trainee", true)).rejects.toThrow("不能发");
    await expect(setBadge("nobody@example.com", "beta", true)).rejects.toThrow("没有用这个邮箱");
    await wear(me.id, "beta");
    await setBadge("me@example.com", "beta", false);
    expect(await me.me()).toMatchObject({ badges: [], wornBadge: null });
    await expect(setBadge("me@example.com", "beta", false)).rejects.toThrow("没有这个称号");
  });

  it("catches up badges the counts already earned", async () => {
    await db.update(users).set({ friendsEver: 10 }).where(eq(users.id, me.id));
    await catchUpBadges();
    await catchUpBadges();
    expect(await badgeIds(me)).toEqual(["trainee", "diplomat"]);
  });

  it("gives the admin this week's totals against the last, and nothing about anyone", async () => {
    const at = (iso: string) => new Date(iso);
    const other = await signUp("other@example.com");
    const old = await signUp("old@example.com");
    await db.update(users).set({ createdAt: at("2026-11-10T09:00+08:00"), lastSeenOn: "2026-11-18" }).where(eq(users.id, me.id));
    await db.update(users).set({ createdAt: at("2026-11-10T21:00+08:00"), lastSeenOn: "2026-11-10" }).where(eq(users.id, other.id));
    await db.update(users).set({ createdAt: at("2026-10-01T12:00+08:00"), lastSeenOn: "2026-11-19" }).where(eq(users.id, old.id));
    await db.insert(dailyTotals).values({ day: "2026-11-13", activeWeek: 5, signups: 0, friendships: 0 });
    expect(await retentionStats(Date.parse("2026-11-20T12:00+08:00"))).toEqual({
      activeWeek: 2,
      activeWeekBefore: 5,
      lastWeekSignups: 2,
      lastWeekSignupsBack: 1,
      friendshipsWeek: 0,
    });
  });

  it("shows 我的助战 on profile cards to Arknights players' friends, and tells them when it changes", async () => {
    const fan = { ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights" as const] };
    await me.saveProfile({ ...fan, support: ["能天使", "黑"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await befriend(me, "t1");
    const t1 = await demo("t1");
    const [friend] = await t1.friends();
    expect(friend.profile.support).toEqual(["能天使", "黑"]);
    expect(friend.history.filter((e) => e.kind === "support")).toHaveLength(1);

    // saving the rest of the profile is not a change of 助战
    await db.update(users).set({ supportChangedAt: sql`now() - interval '2 days'` }).where(eq(users.id, me.id));
    await me.saveProfile({ ...fan, name: "Breeze2", support: ["能天使", "黑"] });
    const [stale] = (await t1.friends())[0].history.filter((e) => e.kind === "support");
    expect(Date.now() - stale.at).toBeGreaterThan(86_400_000);
    await me.saveProfile({ ...fan, support: ["黑"] });
    const changes = (await t1.friends())[0].history.filter((e) => e.kind === "support");
    expect(changes).toHaveLength(1);
    expect(Date.now() - changes[0].at).toBeLessThan(60_000);

    // only for players of Arknights
    await me.saveProfile({ ...fan, games: ["endfield"], support: ["能天使"] });
    expect((await me.me()).profile.support).toEqual([]);
  });

  it("ranks this week's 「我永远喜欢」 and 「加强」 by different players, three or more", async () => {
    const at = (iso: string) => new Date(iso);
    const now = Date.parse("2026-11-04T12:00+08:00");
    const players = [me, ...(await Promise.all(["a", "b", "c"].map((x) => signUp(`${x}@example.com`))))];
    const shout = (p: Player, template: string, character: string, when: string) =>
      db.insert(declarations).values({ senderId: p.id, template, character, recipients: 0, createdAt: at(when) });
    // this week (from Monday 11/02 04:00): 能天使 by three players, one of them twice; 佩丽卡 by two
    for (const p of players.slice(0, 3)) await shout(p, "love", "能天使", "2026-11-03T10:00+08:00");
    await shout(players[0], "love", "能天使", "2026-11-04T10:00+08:00");
    for (const p of players.slice(0, 2)) await shout(p, "love", "佩丽卡", "2026-11-03T10:00+08:00");
    // demo players never count
    await shout(await demo("t1"), "love", "能天使", "2026-11-03T10:00+08:00");
    // last week, and just before this week began
    for (const p of players) await shout(p, "love", "黑", "2026-11-02T03:59+08:00");
    for (const p of players.slice(0, 3)) await shout(p, "buff", "能天使", "2026-11-02T04:00+08:00");

    const list = await computeHotList(now);
    expect(list.weekStart).toBe(Date.parse("2026-11-02T04:00+08:00"));
    expect(list.boards.love).toEqual([{ rank: 1, character: "能天使", games: ["arknights"], players: 3 }]);
    expect(list.boards.buff).toEqual([{ rank: 1, character: "能天使", games: ["arknights"], players: 3 }]);
    expect(list.lastWeek).toEqual({ love: { rank: 1, character: "黑", games: ["arknights"], players: 4 }, buff: null });
    // two players are too few to show
    expect(JSON.stringify(list)).not.toContain("佩丽卡");
  });

  it("moves players who picked 夜明河 over to its official name 明河", async () => {
    await db.update(users).set({ games: ["endfield"], favEndfield: ["夜明河", "佩丽卡"] }).where(eq(users.id, me.id));
    await db.execute(sql.raw(readFileSync("drizzle/0012_rename_minghe.sql", "utf8")));
    expect((await me.me()).profile.favourites.endfield).toEqual(["明河", "佩丽卡"]);
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
      uidServer: { arknights: "jp", endfield: "asia" },
    });
    expect(saved.name).toBe("阿米娅的狗");
    expect(saved.favourites).toEqual({ arknights: [], endfield: ["佩丽卡", "陈千语", "管理员"] });
    expect(saved.uid).toEqual({ arknights: "", endfield: "8899" });
    expect(saved.uidServer).toEqual({ arknights: "", endfield: "asia" });
    expect((await me.me()).profile).toEqual(saved);
    await expect(me.saveProfile({ ...EMPTY_PROFILE, uid: { arknights: "", endfield: "<script>" }, games: ["endfield"] })).rejects.toThrow("UID");
    // a UID needs its server, one of the game's own
    const uidOnly = { ...EMPTY_PROFILE, games: ["endfield" as const], uid: { arknights: "", endfield: "8899" } };
    await expect(me.saveProfile(uidOnly)).rejects.toThrow("服务器");
    await expect(me.saveProfile({ ...uidOnly, uidServer: { arknights: "", endfield: "jp" } })).rejects.toThrow("服务器");
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

  it("hides a blocked player's messages from you, old and new, without telling them", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, true);
    const t1 = await demo("t1");
    await t1.reply((await t1.inbox())[0].id, true);
    const [aBai] = await me.friends();

    await me.block(`friend:${aBai.id}`);
    expect(await me.friends()).toEqual([]);
    expect(await t1.friends()).toEqual([]);
    expect(await me.inbox()).toEqual([]);
    expect(await me.blocks()).toEqual([{ id: expect.any(String), name: "Dr. 阿白", at: expect.any(Number) }]);

    // 阿白 sees nothing change: the touch from you is still there, and touching you seems to work
    expect(await t1.inbox()).toHaveLength(1);
    expect(await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true)).toEqual({ newFriend: null });
    expect(await me.inbox()).toEqual([]);
    // declarations stop both ways
    await me.declare({ template: "launch", game: "arknights" });
    expect((await t1.inbox()).some((i) => i.kind === "declaration")).toBe(false);
    expect((await (await demo("t2")).inbox()).some((i) => i.kind === "declaration")).toBe(true);
    await t1.declare({ template: "launch", game: "endfield" });
    expect(await me.inbox()).toEqual([]);

    // unblocking brings back what came before the block, but not what was sent during it
    await me.unblock((await me.blocks())[0].id);
    const back = (await me.inbox()).filter((i) => i.kind === "touch");
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ target: "touch", bold: true });
  });

  it("blocks senders you only saw anonymously, and keeps them anonymous in your list", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t2 = await demo("t2");
    await t2.touch((await publicAt(t2, PEOPLES_SQUARE)).id, false);
    await me.declare({ template: "launch", game: "arknights" });
    const t3 = await demo("t3");
    await t3.react((await t3.inbox())[0].id, "plusone");

    const items = await me.inbox();
    await me.block(items.find((i) => i.kind === "touch")!.id);
    await me.block(items.find((i) => i.kind === "reaction")!.id);
    expect(await me.inbox()).toEqual([]);
    const list = await me.blocks();
    expect(list.map((b) => b.name)).toEqual([null, null]);
    expect(JSON.stringify(list)).not.toMatch(/小林|Kal|t2|t3/);
    // you can only block what was sent to you
    await expect(t2.block(items[0].id)).rejects.toThrow("找不到");
  });

  it("files reports for the admin, blocks the reported player, and hides a name three players report", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true);
    const [touch] = await me.inbox();
    await expect(me.report(touch.id, "nonsense")).rejects.toThrow("举报理由");
    await me.report(touch.id, "name", "  名字在骂人  ");
    await me.report(touch.id, "spam");
    expect(await me.inbox()).toEqual([]);
    const [filed] = await db.select().from(reports);
    expect(filed).toMatchObject({ reason: "name", note: "名字在骂人", context: "大胆碰了举报人的本体", targetName: "阿白" });
    expect(await db.$count(reports)).toBe(1);

    // two more players report the same name, and it is hidden until the admin looks
    for (const key of ["t2", "t3"]) {
      const p = await demo(key);
      await t1.touch((await publicAt(t1, tester(key).roaches[0])).id, true);
      const [item] = (await p.inbox()).filter((i) => i.kind === "touch");
      await p.report(item.id, "name");
    }
    const [aBai] = await db.select().from(users).where(eq(users.id, t1.id));
    expect(aBai).toMatchObject({ anonymous: true, name: "" });

    const cases = await openCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ targetId: t1.id, reporters: 3, name: "" });
    expect(cases[0].reports.map((r) => r.name)).toEqual(["阿白", "阿白", "阿白"]);
    await resolveCase(t1.id, "dismiss");
    expect(await openCases()).toEqual([]);
    await expect(resolveCase(t1.id, "ban")).rejects.toThrow("测试玩家");
  });

  it("bans an account: deletes it and refuses its email from then on", async () => {
    const troll = await signUp("troll@example.com");
    await troll.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "main" }, TOKYO);
    await troll.touch((await publicAt(troll, TOKYO)).id, false);
    await me.report((await me.inbox())[0].id, "spam");

    await resolveCase(troll.id, "ban");
    expect(await db.select().from(users).where(eq(users.id, troll.id))).toEqual([]);
    expect(await db.$count(reports)).toBe(0);
    expect(await isBanned("troll@example.com")).toBe(true);
    expect(await isBanned("me@example.com")).toBe(false);
    expect(JSON.stringify(await db.select().from(bannedEmails))).not.toContain("troll");
  });

  it("runs the radar around your main roach, counting arrivals and departures across its edge", async () => {
    expect(await me.radar()).toBeNull();
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const before = (await me.radar())!;
    expect(before).toMatchObject({ scansLeft: 4, nextScanAt: null });
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
    // reopening it within a few minutes shows the same scan without using one up
    expect(await me.radar()).toEqual(before);
    await rewindScans(me.id);
    const after = (await me.radar())!;
    expect(after.day.left).toBe(before.day.left + 1);
    expect(after.day.arrived).toBe(before.day.arrived + 1);
    expect(after.day.clones).toBe(before.day.clones + 1);
    expect(after.daily[6].left).toBe(before.daily[6].left + 1);

    // your own moves never show up on your radar
    await me.placeRoach({ kind: "clone" }, { lng: 121.5, lat: 31.3 });
    await rewindScans(me.id);
    expect((await me.radar())!.day).toEqual(after.day);
  });

  it("allows five radar scans a day, then shows the last one again until one frees up", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    for (let i = 4; i >= 0; i--) {
      expect((await me.radar())!.scansLeft).toBe(i);
      await rewindScans(me.id);
    }
    const [last] = await db.select().from(radarScans).where(eq(radarScans.userId, me.id)).orderBy(sql`created_at desc`).limit(1);
    const shown = (await me.radar())!;
    expect(shown).toMatchObject({ scansLeft: 0, scannedAt: last.createdAt.getTime(), nextScanAt: expect.any(Number) });
    expect(shown.nextScanAt).toBeGreaterThan(Date.now());
    // a day after the first scan, one frees up
    await db.update(radarScans).set({ createdAt: sql`${radarScans.createdAt} - interval '1 day'` }).where(eq(radarScans.id, (await db.select().from(radarScans).orderBy(radarScans.createdAt).limit(1))[0].id));
    expect((await me.radar())!).toMatchObject({ scansLeft: 0, nextScanAt: null });
  });

  it("scans afresh once the main roach has moved, even within the free reopening window", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    expect((await me.radar())!.scansLeft).toBe(4);
    expect((await me.radar())!.scansLeft).toBe(4);
    await me.placeRoach({ kind: "move", roachId: (await me.me()).roaches[0].id }, TOKYO);
    expect((await me.radar())!.scansLeft).toBe(3);
  });

  it("refuses touches on show roaches, which belong to nobody", async () => {
    await expect(me.touch("bot-12", true)).rejects.toThrow("演示蟑螂");
  });

  it("allows three moves a day, and puts a cap on putting roaches down again and again", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    expect((await me.me()).movesLeft).toBe(3);
    const main = (await me.me()).roaches[0];
    for (let i = 1; i <= 3; i++) await me.placeRoach({ kind: "move", roachId: main.id }, { lng: 121 + i / 10, lat: 31 });
    expect((await me.me()).movesLeft).toBe(0);
    await expect(me.placeRoach({ kind: "move", roachId: main.id }, TOKYO)).rejects.toThrow("每天最多挪 3 次窝");
    await expect(me.placeRoach({ kind: "main" }, TOKYO)).rejects.toThrow("每天最多挪 3 次窝");

    // taking roaches back and putting them down again is capped too
    for (let i = 0; i < 7; i++) {
      await me.placeRoach({ kind: "clone" }, { lng: 100, lat: 20 + i });
      await me.removeRoach((await me.me()).roaches.find((r) => r.slot > 0)!.id);
    }
    await expect(me.placeRoach({ kind: "clone" }, TOKYO)).rejects.toThrow("今天放下的蟑螂太多了");
    // a day later the moves come back
    await db.update(moves).set({ at: sql`${moves.at} - interval '1 day'` }).where(eq(moves.userId, me.id));
    expect((await me.me()).movesLeft).toBe(3);
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
