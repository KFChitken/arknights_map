import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withLang } from "@/i18n/server";
import { AMIYA_AT, AMIYA_ID } from "../amiya";
import { PERLICA_ID } from "../perlica";
import { FIRE_AT, TALULAH_ID } from "../talulah";
import { metresApart, MINGHE_ID, queueSpot, stationOf, stopOf } from "../minghe";
import { declarationText, DRUNK_TEMPLATES, FOODS, repliesFor, STAY_TEMPLATES, TEMPLATES, type Declaration, type Template } from "../declarations";
import { FIRST_BATCH, SURVIVOR_DAYS } from "../badges";
import { beijingDate } from "../beijing";
import { EVENTS } from "../events";
import { EMPTY_PROFILE, type Profile } from "../profile";
import { MAX_CLONES, POLICY_UPDATED_AT } from "../rules";
import type { LngLat } from "../types";
import { passersby, TESTERS } from "../world/cast";
import { tapOf } from "../siTiles";
import { reachText } from "../world/logic";
import type { InboxItem, PlaceTarget, PublicRoach } from "../world/types";
import type { AdminAction } from "../safety";
import { deleteAccount, isBanned, mailboxForms } from "./account";
import {
  answerAppeal,
  banInfo,
  clearBlockedNames,
  findPlayers,
  openAppeals,
  openCases,
  reportCounts,
  reportedRoaches,
  retentionStats,
  roachesNear,
  setBadge,
  settleCase,
  settleCases,
  takeBackRoaches,
} from "./admin";
import { award, catchUpBadges, fireSongs, markBadgesSeen, shownBadges, signedUp, wakeUp, wear } from "./badges";
import { greetAmiya } from "./amiya";
import { deviceDay, deviceWeek } from "./guides";
import * as perlica from "./perlica";
import * as talulah from "./talulah";
import * as minghe from "./minghe";
import { awayExtraDays, flipTheAway } from "./away";
import { acceptPublicPlace, agreeAgain, confirmAge } from "./consent";
import { addNameWords, checkName, forgetNameWords, listNameWords, nameJudgeNow, namesHit, removeNameWord, removeNameWords, testName } from "./nameWords";
import { computeHotList } from "./hotList";
import { db } from "./db";
import { identities, resetDemo, seedDemo } from "./demo";
import { listen } from "./live";
import { pruneOldActivity } from "./retention";
import { appeal } from "./staffNotes";
import { spotRows } from "./declarationInbox";
import { distanceKm } from "../geo";
import { allRoaches } from "./roachFeed";
import * as safety from "./safety";
import {
  adminBackupCodes,
  adminLog,
  adminNotes,
  adminRequests,
  admins,
  amiyaTouches,
  bannedEmails,
  blocks,
  clearedValues,
  dailyTotals,
  declarations,
  declarationSpots,
  deskCodes,
  deliveries,
  friendCuts,
  friendNotes,
  friendships,
  mingheTouches,
  modActions,
  moves,
  nameWords,
  notices,
  offLimitsAreas,
  passCounters,
  passes,
  passGifts,
  passWallets,
  perlicaTouches,
  pokes,
  radarScans,
  reactions,
  reports,
  roaches,
  sessions,
  siteSettings,
  staffNotes,
  siInks,
  siTickets,
  siTouches,
  talulahTouches,
  touches,
  userBadges,
  userPasswords,
  users,
  visitBans,
  friendStars,
  helpRequests,
  helpAnswers,
  visits,
} from "./schema";
import { recordDailyTotals } from "./totals";
import * as world from "./world";
import { forgetRadarBlocks } from "./radarBlocks";

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
    reportRoach: (roachId: string, reason: string, note = "") => safety.reportRoach(id, roachId, reason, note),
    appeal: (actionId: string, text: string) => appeal(id, actionId, text),
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

/** Accounts old enough for their reports to count towards the automatic steps */
async function aged(...ids: string[]) {
  await db.update(users).set({ createdAt: sql`now() - interval '4 days'` }).where(inArray(users.id, ids));
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

/** Move all of a player's touches with one guide a day further back: their next touch is a new day's. */
async function dayBefore(t: typeof amiyaTouches | typeof perlicaTouches | typeof talulahTouches | typeof mingheTouches, p: Player) {
  await db.update(t).set({ createdAt: sql`${t.createdAt} - interval '25 hours'` }).where(eq(t.userId, p.id));
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

/** Two real players, each with a main roach, who touched each other boldly. Returns their main roaches' public ids. */
async function realFriends(a: Player, b: Player) {
  const [aMain] = await a.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
  const [bMain] = await b.placeRoach({ kind: "main" }, TOKYO);
  await a.touch(bMain.publicId, true);
  await b.touch(aMain.publicId, true);
  return { a: aMain.publicId, b: bMain.publicId };
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
    sql`truncate ${users}, ${sessions}, ${roaches}, ${touches}, ${declarations}, ${deliveries}, ${reactions}, ${friendships}, ${friendCuts}, ${moves}, ${blocks}, ${reports}, ${bannedEmails}, ${radarScans}, ${userBadges}, ${dailyTotals}, ${nameWords}, ${pokes}, ${amiyaTouches}, ${perlicaTouches}, ${talulahTouches}, ${mingheTouches}, ${friendNotes}, ${visits}, ${visitBans}, ${friendStars}, ${helpRequests}, ${helpAnswers}, ${clearedValues}, ${modActions}, ${staffNotes}, ${deskCodes}, ${declarationSpots}, ${userPasswords}, ${notices}, ${siTouches}, ${siTickets}, ${siInks}, ${admins}, ${adminBackupCodes}, ${adminLog}, ${adminNotes}, ${adminRequests}, ${offLimitsAreas}, ${siteSettings}, ${passes}, ${passWallets}, ${passGifts}, ${passCounters}`,
  );
  // no 明河快进一天 left over, and nothing the radar read for the test before
  (globalThis as { __mingheShift?: number }).__mingheShift = 0;
  forgetRadarBlocks();
  forgetNameWords();
  await seedDemo();
  me = await signUp("me@example.com");
});

describe("server world", () => {
  it("finds accounts for the admin by email, name or the start of their id, newest first, never demo players, nobody without a search", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: true, name: "阿白" });
    const other = await signUp("other@example.com");
    for (const q of ["", "   ", null]) expect(await findPlayers(q)).toEqual({ players: [], total: 0 });
    const { players, total } = await findPlayers("EXAMPLE.com");
    expect(players.map((p) => p.email)).toEqual(["other@example.com", "me@example.com"]);
    expect(total).toBe(2);
    expect(players[1]).toMatchObject({ id: me.id, name: "阿白", anonymous: true });
    expect(Object.keys(players[0]).sort()).toEqual(["anonymous", "email", "id", "joinedAt", "name"]);
    expect((await findPlayers("白")).players.map((p) => p.id)).toEqual([me.id]);
    expect((await findPlayers(other.id.slice(0, 8))).players.map((p) => p.id)).toEqual([other.id]);
    // an id matches only at its start, and % and _ stand for themselves
    expect((await findPlayers(other.id.slice(4, 12))).total).toBe(0);
    for (const q of ["%", "_", "me%", "o_her"]) expect((await findPlayers(q)).total, q).toBe(0);
    // the demo players have addresses too
    expect((await findPlayers("t1")).total).toBe(0);
    // at most 50, the newest
    await db.insert(users).values(Array.from({ length: 60 }, (_, i) => ({ email: `many${i}@example.com`, createdAt: new Date(Date.now() - i * 1000) })));
    const many = await findPlayers("many");
    expect(many.total).toBe(60);
    expect(many.players).toHaveLength(50);
    expect(many.players[0].email).toBe("many0@example.com");
  });

  it("refuses names the rules or the admin's words block, and lists the names in use they catch", async () => {
    const named = (name: string) => me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name });
    await expect(named("鹰角官方")).rejects.toThrow("这个名字用不了");
    await expect(named("管理员小王")).resolves.toMatchObject({ name: "管理员小王" });
    // a name already in use before the word was added is listed, not changed
    expect(await addNameWords("```\n小王\n=国家\n```")).toBe(2);
    expect(await namesHit()).toEqual({ checked: 1, count: 1, hits: [{ id: me.id, name: "管理员小王", anonymous: false, held: false, word: "小王" }] });
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

  it("refuses a listed word however it is written, and by its sound too when it is marked ~", async () => {
    const named = (name: string) => me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name });
    await addNameWords("台独\n~张三丰");
    for (const name of ["臺獨", "台 獨", "台\u200d独", "台a独", "我是臺獨", "張三豐", "章三峰", "zhangsanfeng", "Zhāng Sān Fēng", "张san丰"]) {
      await expect(named(name), name).rejects.toThrow("这个名字用不了");
    }
    await expect(named("张三")).resolves.toMatchObject({ name: "张三" });
    // the admin page's 试一个名字, and its search finding a word by another way of writing it
    expect(await testName("臺獨")).toEqual({ word: "台独" });
    expect(await testName("章三峰")).toEqual({ word: "~张三丰" });
    expect(await testName("阿米娅")).toEqual({ word: null });
    expect((await listNameWords("獨")).words).toEqual([{ word: "台独", whole: false }]);
  });

  it("clears the names in use that the words block now, with a 站长通知 to appeal and no yellow card", async () => {
    const shown = await signUp("shown@example.com");
    await shown.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "臺獨小王", games: ["arknights"] });
    await shown.placeRoach({ kind: "main" }, TOKYO);
    await shown.declare({ template: "myname", game: "arknights" } as Declaration);
    const hidden = await signUp("hidden@example.com");
    await hidden.saveProfile({ ...EMPTY_PROFILE, anonymous: true, name: "章三峰" });
    const held = await signUp("held@example.com");
    await held.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "台独迷" });
    await safety.holdProfile(held.id);
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "阿米娅" });

    await addNameWords("台独\n~张三丰");
    const { checked, count, hits } = await namesHit();
    expect({ checked, count }).toEqual({ checked: 4, count: 3 });
    // the names others can see first; one held for a report is settled with its case
    expect(hits[0]).toEqual({ id: shown.id, name: "臺獨小王", anonymous: false, held: false, word: "台独" });
    expect(hits.slice(1).sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      [
        { id: hidden.id, name: "章三峰", anonymous: true, held: false, word: "~张三丰" },
        { id: held.id, name: "台独迷", anonymous: true, held: true, word: "台独" },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );

    // ticked a while ago: one has changed their name since, one is held, one is fine, one is no account
    await hidden.saveProfile({ ...EMPTY_PROFILE, anonymous: true, name: "阿白" });
    expect(await clearBlockedNames([shown.id, hidden.id, held.id, me.id, "nope", shown.id])).toBe(1);

    const after = await shown.me();
    expect(after.profile).toMatchObject({ name: "", anonymous: true });
    const said = (await (await demo("t1")).inbox()).find((i) => i.kind === "declaration");
    expect(said).toMatchObject({ text: "我是匿名舟P，我要玩明日方舟" });
    const notes = (await shown.inbox()).filter((i): i is Extract<InboxItem, { kind: "staff" }> => i.kind === "staff");
    expect(notes.map((n) => n.text)).toEqual(["因为社区守则里「名字和资料里不能有违法、涉政、色情、赌博、广告引流的内容」这一条，站长清掉了你的名字。这个名字以后不能再用了。"]);
    expect(notes[0].appeal).toMatchObject({ state: "open" });
    expect(await db.select({ userId: modActions.userId, action: modActions.action, rule: modActions.rule, yellow: modActions.yellow }).from(modActions)).toEqual([
      { userId: shown.id, action: "clearName", rule: "name", yellow: false },
    ]);
    expect((await hidden.me()).profile).toMatchObject({ name: "阿白" });
    expect((await held.me()).profileHeld).toBe(true);
    expect((await namesHit()).hits.map((h) => h.id)).toEqual([held.id]);

    // and that account cannot take the name back however it is written, even once the word is off the list
    await removeNameWord("台独");
    for (const name of ["臺獨小王", "台独小王", "台 独 小 王"]) {
      await expect(shown.saveProfile({ ...after.profile, anonymous: false, name }), name).rejects.toThrow("这个名字被站长清掉过");
    }
  });

  it("hears within a minute of words another process added, and builds the list again only when it changed", async () => {
    const first = await nameJudgeNow();
    // as the admin's change on another process would come: this one is not told
    await db.insert(nameWords).values({ word: "小王", whole: false });
    expect(await nameJudgeNow()).toBe(first);
    await expect(checkName("小王")).resolves.toBeUndefined();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(now + 61_000);
      const second = await nameJudgeNow();
      expect(second).not.toBe(first);
      await expect(checkName("小王")).rejects.toThrow("这个名字用不了");
      // another minute with nothing changed: looked again, the same list kept
      clock.mockReturnValue(now + 122_000);
      expect(await nameJudgeNow()).toBe(second);
    } finally {
      clock.mockRestore();
    }
  });

  it("gets drunk until the next morning: only the main roach lies down, and nothing says why", async () => {
    const [main] = await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, TOKYO);
    const { until } = await world.drink(me.id);
    expect(until).toBeGreaterThan(Date.now());
    // 异卵同生 came with the clone
    expect(await me.me()).toMatchObject({ drunkUntil: until, counts: { drinks: 1 }, badges: [{ id: "twins" }, { id: "tipsy", seen: false }] });
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
    expect(await flipTheAway(now)).toEqual({ flipped: 0, woke: 0, told: 0 });
    await db.update(users).set({ lastSeenOn: daysBefore(away) }).where(eq(users.id, me.id));
    expect(await flipTheAway(now)).toEqual({ flipped: 1, woke: 0, told: 0 });
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

  it("lets only 触须之交 poke a sleeping main roach, once a week, and it sleeps on", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze" });
    const pal = await signUp("pal@example.com");
    const ids = await realFriends(me, pal);
    await pal.placeRoach({ kind: "clone" }, PEOPLES_SQUARE);
    const stranger = await signUp("stranger@example.com");
    await expect(world.poke(me.id, ids.b)).rejects.toThrow("醒着呢");

    await world.drink(pal.id);
    await expect(world.poke(stranger.id, ids.b)).rejects.toThrow("只有触须之交");
    await expect(world.poke(me.id, ids.a)).rejects.toThrow("你自己的蟑螂");
    const clone = (await pal.me()).roaches.find((r) => r.slot === 1)!;
    await expect(world.poke(me.id, clone.publicId)).rejects.toThrow("醒着呢");
    const { againAt } = await world.poke(me.id, ids.b);
    expect(againAt - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    await expect(world.poke(me.id, ids.b)).rejects.toThrow("7 天后可以再戳");
    expect((await me.friends())[0].pokeAgainAt).toBe(againAt);
    expect((await pal.friends())[0].pokeAgainAt).toBeNull();
    // still asleep, and still drunk
    expect((await allRoaches()).find((r) => r.id === ids.b)).toMatchObject({ asleep: true });
    expect((await pal.me()).drunkUntil).not.toBeNull();

    // hidden while it sleeps it off; once up, pal sees who
    expect((await pal.inbox()).some((i) => i.kind === "poke")).toBe(false);
    await world.sober(pal.id);
    const poked = (await pal.inbox()).find((i) => i.kind === "poke")!;
    expect(poked).toMatchObject({ seen: false, from: { displayName: "Breeze" } });
    await pal.markSeen([poked.id]);
    expect((await pal.inbox()).find((i) => i.kind === "poke")).toMatchObject({ seen: true });
    // a later drink keeps seen pokes in view
    await db.update(users).set({ drunkUntil: new Date(Date.now() + 3_600_000) }).where(eq(users.id, pal.id));
    expect((await pal.inbox()).some((i) => i.kind === "poke")).toBe(true);

    // blocking from the poke ends the friendship, and hides it
    await pal.block(poked.id);
    expect(await me.friends()).toEqual([]);
    expect((await pal.inbox()).some((i) => i.kind === "poke")).toBe(false);
  });

  it("tells the poker 「醒啦」 at the first 04:00 batch after the roach stands up, drunk or away alike", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze" });
    const pal = await signUp("pal@example.com");
    await pal.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "摸鱼" });
    const ids = await realFriends(me, pal);
    const now = Date.now();
    const daysBefore = (n: number) => beijingDate(now - n * 86_400_000);
    const woke = async () => (await me.inbox()).filter((i) => i.kind === "pokeWoke");

    // drunk: told at the first batch that finds it awake
    await world.drink(pal.id);
    await world.poke(me.id, ids.b);
    expect((await flipTheAway(now)).told).toBe(0);
    await world.sober(pal.id);
    expect((await flipTheAway(now)).told).toBe(1);
    expect(await woke()).toMatchObject([{ seen: false, from: { displayName: "摸鱼" } }]);
    expect((await flipTheAway(now)).told).toBe(0);
    await me.markSeen([(await woke())[0].id]);
    expect(await woke()).toMatchObject([{ seen: true }]);

    // away: the batch that stands it up again tells nobody yet; the one after does
    await db.delete(pokes);
    await db.update(users).set({ lastSeenOn: daysBefore(20), sleptAwayOn: daysBefore(3) }).where(eq(users.id, pal.id));
    await world.poke(me.id, ids.b);
    expect((await pal.me()).wokeFromAway).toBe(true);
    expect((await pal.inbox()).find((i) => i.kind === "poke")).toMatchObject({ from: { displayName: "Breeze" } });
    expect(await flipTheAway(now)).toMatchObject({ woke: 1, told: 0 });
    expect(await woke()).toEqual([]);
    expect((await flipTheAway(now + 86_400_000)).told).toBe(1);
    expect(await woke()).toHaveLength(1);

    // nothing about it in the shared roach list
    expect(JSON.stringify(await allRoaches())).not.toMatch(/poke/i);
  });

  it("lets anyone touch 阿米娅向导, who touches back the same way, apart from everything between players", async () => {
    expect(await me.touch(AMIYA_ID, false)).toMatchObject({ newFriend: null, guide: { id: "amiya", bold: false } });
    expect(await me.touch(AMIYA_ID, true)).toMatchObject({ newFriend: "阿米娅向导", guide: { id: "amiya", bold: true } });
    // she has touched back once today: nothing more from her until the player's next day
    expect(await me.touch(AMIYA_ID, true)).toMatchObject({ newFriend: null, guide: { id: "amiya", itemId: null } });
    const rows = await db.select().from(amiyaTouches).where(eq(amiyaTouches.userId, me.id));
    const bolds = (direction: string) =>
      rows
        .filter((r) => r.direction === direction)
        .map((r) => r.bold)
        .sort();
    expect(bolds("to_amiya")).toEqual([false, true, true]);
    expect(bolds("from_amiya")).toEqual([false, true]);

    // her touches are her own kind of message; nothing reaches the tables between players
    const inbox = await me.inbox();
    expect(inbox.filter((i) => i.kind === "amiya")).toHaveLength(2);
    expect(inbox.some((i) => i.kind === "touch")).toBe(false);
    expect(await db.select().from(touches)).toEqual([]);
    expect(await db.select().from(friendships)).toEqual([]);
    expect((await userRow(me.id)).friendsEver).toBe(0);
    expect(await badgeIds(me)).not.toContain("trainee");
    expect(await badgeIds(me)).not.toContain("farwhisker");

    // first among 触须之交, with nothing to block or report
    const [first] = await me.friends();
    expect(first).toMatchObject({ id: AMIYA_ID, profile: { displayName: "阿米娅向导" }, history: [], pokeAgainAt: null });
    expect(first.roaches).toEqual([expect.objectContaining({ id: AMIYA_ID, friend: true, guide: true, ...AMIYA_AT })]);
    await expect(me.block(`friend:${AMIYA_ID}`)).rejects.toThrow("不是真人");
    await expect(me.report(inbox[0].id, "spam")).rejects.toThrow("不是真人");
    await expect(world.poke(me.id, AMIYA_ID)).rejects.toThrow("一直醒着");
    expect((await me.me()).amiya).toEqual({ friend: true, greeting: null });

    // the 60 touches a day between players stay untouched, and she has her own 20
    for (let i = 3; i < 20; i++) await me.touch(AMIYA_ID, false);
    await expect(me.touch(AMIYA_ID, false)).rejects.toThrow("今天跟阿米娅碰得够多啦");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(me.touch((await publicAt(me, tester("t1").roaches[0])).id, false)).resolves.toBeTruthy();
    // a new day, a new touch back; the inbox keeps only her latest five
    for (let day = 0; day < 4; day++) {
      await dayBefore(amiyaTouches, me);
      expect((await me.touch(AMIYA_ID, false)).guide!.itemId).toBeTruthy();
    }
    expect((await me.inbox()).filter((i) => i.kind === "amiya")).toHaveLength(5);

    await me.unfriend(AMIYA_ID);
    expect((await me.friends()).some((f) => f.id === AMIYA_ID)).toBe(false);
    expect((await me.me()).amiya.friend).toBe(false);
  });

  it("lets you touch back or crawl away from her touches once each, and only your own", async () => {
    const { guide } = await me.touch(AMIYA_ID, false);
    const item = guide!.itemId!;
    const other = await signUp("other@example.com");
    await expect(other.reply(item, true)).rejects.toThrow("找不到这条消息了");
    await expect(other.ignore(item)).rejects.toThrow("找不到这条消息了");
    await other.markSeen([item]);
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ seen: false });

    const back = await me.reply(item, true);
    expect(back).toMatchObject({ newFriend: "阿米娅向导", guide: { id: "amiya", bold: true } });
    await expect(me.reply(item, false)).rejects.toThrow("已经碰过 TA 了");
    await expect(me.ignore(item)).rejects.toThrow("已经碰过 TA 了");
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ replied: true });

    await me.ignore(back.guide!.itemId!);
    expect((await me.inbox()).find((i) => i.id === back.guide!.itemId!)).toMatchObject({ ignored: true, seen: true });
    await expect(me.reply(back.guide!.itemId!, false)).rejects.toThrow("默默爬走");
    await me.markSeen([item]);
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ seen: true });
  });

  it("greets 阿米娅向导's 触须之交 once a day by their own clock, from the day after", async () => {
    const at = (iso: string) => Date.parse(iso);
    await db.update(users).set({ amiyaFriendSince: new Date(at("2026-11-02T10:00+08:00")) }).where(eq(users.id, me.id));
    const greet = async (offset: number, iso: string) => greetAmiya(await userRow(me.id), offset, at(iso));
    const greetings = async () =>
      (await db.select().from(amiyaTouches).where(eq(amiyaTouches.userId, me.id))).filter((r) => r.kind === "greet").length;

    // Beijing: not the day they became friends, nor before 04:00 the next morning
    expect(await greet(-480, "2026-11-02T23:00+08:00")).toBeNull();
    expect(await greet(-480, "2026-11-03T03:59+08:00")).toBeNull();
    const first = await greet(-480, "2026-11-03T04:01+08:00");
    expect(first).toMatchObject({ kind: "amiya", greet: true, seen: false, replied: false });
    expect((await greet(-480, "2026-11-03T20:00+08:00"))?.id).toBe(first!.id);
    await me.markSeen([first!.id]);
    expect(await greet(-480, "2026-11-03T21:00+08:00")).toBeNull();
    expect(await greetings()).toBe(1);

    // Nashville in winter (CST): 03:30 there is still the day already greeted; 04:30 is a new one
    expect(await greet(360, "2026-11-04T03:30-06:00")).toBeNull();
    expect(await greet(360, "2026-11-04T04:30-06:00")).toMatchObject({ greet: true });
    // and in summer (CDT); two pages opening at once still get one greeting
    // either page may be the one that greets: the other gets the same greeting back, or nothing
    const summer = (await Promise.all([greet(300, "2027-06-01T04:30-05:00"), greet(300, "2027-06-01T04:30-05:00")])).find(Boolean);
    expect(await greetings()).toBe(3);
    // flying to Beijing the same day brings back that greeting, not a new one
    expect((await greet(-480, "2027-06-01T16:00+08:00"))?.id).toBe(summer!.id);
    expect(await greetings()).toBe(3);

    await me.unfriend(AMIYA_ID);
    expect(await greet(-480, "2027-06-03T10:00+08:00")).toBeNull();
    expect(await greetings()).toBe(3);
  });

  it("forgets touches with 阿米娅向导 after 90 days, and all of them with the account", async () => {
    await me.touch(AMIYA_ID, true);
    await db.insert(amiyaTouches).values({
      userId: me.id,
      direction: "from_amiya",
      bold: false,
      createdAt: new Date(Date.now() - 91 * 86_400_000),
    });
    await pruneOldActivity();
    expect(await db.select().from(amiyaTouches)).toHaveLength(2);
    await deleteAccount(await userRow(me.id));
    expect(await db.select().from(amiyaTouches)).toEqual([]);
  });

  it("never counts 阿米娅向导 on the radar", async () => {
    await me.placeRoach({ kind: "main" }, { lng: AMIYA_AT.lng + 0.01, lat: AMIYA_AT.lat });
    await me.touch(AMIYA_ID, true);
    expect(await me.radar()).toMatchObject({ roaches: 0, players: 0, friendsNearby: 0 });
  });

  it("keeps 只看本体 on the account, tells the player alone, and leaves it as it is when the profile is saved", async () => {
    expect((await me.me()).onlyMains).toBe(false);
    await world.setOnlyMains(me.id, true);
    expect((await me.me()).onlyMains).toBe(true);
    expect((await userRow(me.id)).onlyMains).toBe(true);
    await me.saveProfile({ ...EMPTY_PROFILE, name: "阿白" });
    expect((await me.me()).onlyMains).toBe(true);
    // nothing of it where others look: their 触须之交 list, the roaches on the map
    const other = await signUp("other@example.com");
    await realFriends(me, other);
    const friends = await other.friends();
    expect(friends).toHaveLength(1);
    expect(JSON.stringify(friends)).not.toMatch(/onlyMains|only_mains/);
    expect(JSON.stringify(await other.roaches())).not.toMatch(/onlyMains|only_mains/);
    // someone else's own stays off, and it switches back
    expect((await other.me()).onlyMains).toBe(false);
    await world.setOnlyMains(me.id, false);
    expect((await me.me()).onlyMains).toBe(false);
  });

  it("tells a player the tap numbers of their 触须之交's ink roaches on the map, for 只看本体, and of nobody else's", async () => {
    const friend = await signUp("friend@example.com");
    const stranger = await signUp("stranger@example.com");
    const ids = await realFriends(me, friend);
    const ink = (no: number, userId: string) =>
      db.insert(siInks).values({ no, userId, look: "hood", drawnAt: new Date(), ticket: no }).returning({ publicId: siInks.publicId });
    const [theirs] = await ink(1, friend.id);
    await ink(2, stranger.id);
    const listed = async () => (await me.friends()).find((f) => f.roaches.some((r) => r.id === ids.b))!;
    expect((await listed()).inkTap).toBe(tapOf(theirs.publicId));
    // held: recalled, or never queued
    await db.update(siInks).set({ recalledAt: new Date() }).where(eq(siInks.no, 1));
    expect((await listed()).inkTap).toBeUndefined();
    await db.update(siInks).set({ recalledAt: null, ticket: null }).where(eq(siInks.no, 1));
    expect((await listed()).inkTap).toBeUndefined();
    // the stranger's is in nobody's list
    expect((await me.friends()).some((f) => f.inkTap !== undefined)).toBe(false);
    expect((await friend.friends()).some((f) => f.inkTap !== undefined)).toBe(false);
  });

  describe("佩丽卡监督's 离开计时", () => {
    const lastActive = async (p: Player) => (await userRow(p.id)).lastActiveAt;
    /** As if the page last said 「还在」 that many seconds ago */
    const awayFor = (p: Player, seconds: number) =>
      db
        .update(users)
        .set({ lastActiveAt: new Date(Date.now() - seconds * 1000) })
        .where(eq(users.id, p.id));
    const reports = async (p: Player) =>
      (await db.select().from(perlicaTouches).where(eq(perlicaTouches.userId, p.id))).filter((r) => r.kind === "away");

    beforeEach(async () => {
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    });

    it("keeps no time until the player says yes, and says nothing right after", async () => {
      expect((await me.me()).perlica).toEqual({ friend: false, timer: null, week: null });
      expect(await perlica.here(me.id)).toBeNull();
      await perlica.leave(me.id);
      expect(await lastActive(me)).toBeNull();

      await perlica.setTimer(me.id, false);
      expect(await perlica.here(me.id)).toBeNull();
      expect(await lastActive(me)).toBeNull();
      const off = await userRow(me.id);
      expect(off).toMatchObject({ perlicaTimer: "off" });
      expect(off.perlicaTimerAt).toBeInstanceOf(Date);

      await perlica.setTimer(me.id, true);
      const on = await userRow(me.id);
      expect(on).toMatchObject({ perlicaTimer: "on" });
      expect(on.lastActiveAt).toBeInstanceOf(Date);
      expect(on.perlicaTimerAt!.getTime()).toBeGreaterThanOrEqual(off.perlicaTimerAt!.getTime());
      expect((await me.me()).perlica).toEqual({ friend: false, timer: "on", week: null });
      expect(await perlica.here(me.id)).toBeNull();

      // saving the profile never touches it, and someone never asked stays never asked
      await me.saveProfile({ ...EMPTY_PROFILE, name: "阿白" });
      expect((await userRow(me.id)).perlicaTimer).toBe("on");
      const other = await signUp("other@example.com");
      await other.saveProfile({ ...EMPTY_PROFILE, name: "阿黑" });
      expect((await userRow(other.id)).perlicaTimer).toBeNull();
    });

    it("says how long the player was gone from ten minutes on, to the second, seen at once", async () => {
      await perlica.setTimer(me.id, true);
      await awayFor(me, 599);
      expect(await perlica.here(me.id)).toBeNull();
      await awayFor(me, 600);
      const said = await perlica.here(me.id);
      expect(said).toMatchObject({ kind: "perlica", what: "away", seen: true, bold: false, replied: false });
      expect(said!.seconds).toBeGreaterThanOrEqual(600);
      expect(said!.seconds).toBeLessThan(605);
      expect([0, 1, 2]).toContain(said!.line);
      // the time kept is now, so straight after there is nothing more to say
      expect(Date.now() - (await lastActive(me))!.getTime()).toBeLessThan(5000);
      expect(await perlica.here(me.id)).toBeNull();
      // in the inbox, already read, and nothing for 欢迎回家 to count
      const inbox = await me.inbox();
      expect(inbox.find((i) => i.id === said!.id)).toMatchObject({ what: "away", seen: true });
      expect(inbox.some((i) => i.kind === "touch")).toBe(false);

      // 「走了」 moves the time too
      await awayFor(me, 3000);
      await perlica.leave(me.id);
      expect(Date.now() - (await lastActive(me))!.getTime()).toBeLessThan(5000);
    });

    it("makes one report when two pages say 「还在」 at once, and keeps only the latest five", async () => {
      await perlica.setTimer(me.id, true);
      await awayFor(me, 7200);
      const both = await Promise.all([perlica.here(me.id), perlica.here(me.id)]);
      expect(both.filter(Boolean)).toHaveLength(1);
      expect(await reports(me)).toHaveLength(1);
      for (let i = 0; i < 6; i++) {
        await awayFor(me, 700 + i);
        expect(await perlica.here(me.id)).not.toBeNull();
      }
      const kept = await reports(me);
      expect(kept).toHaveLength(5);
      // the five latest: the first two are gone
      expect(kept.map((r) => r.awaySeconds).sort()).toEqual([701, 702, 703, 704, 705]);
    });

    it("says nothing to a player without a main roach, though the time moves on", async () => {
      const bare = await signUp("bare@example.com");
      await perlica.setTimer(bare.id, true);
      await awayFor(bare, 5000);
      expect(await perlica.here(bare.id)).toBeNull();
      expect(Date.now() - (await lastActive(bare))!.getTime()).toBeLessThan(5000);
      expect(await reports(bare)).toEqual([]);
    });

    it("forgets the time and her reports when switched off, and keeps the touches", async () => {
      await perlica.setTimer(me.id, true);
      await awayFor(me, 1000);
      await perlica.here(me.id);
      await me.touch(PERLICA_ID, false);
      await perlica.setTimer(me.id, false);
      expect(await lastActive(me)).toBeNull();
      expect(await reports(me)).toEqual([]);
      expect(await db.select().from(perlicaTouches).where(eq(perlicaTouches.userId, me.id))).toHaveLength(2);
      // off, 「走了」 keeps nothing
      await perlica.leave(me.id);
      expect(await lastActive(me)).toBeNull();
    });

    it("is never shown to the admin", async () => {
      await perlica.setTimer(me.id, true);
      expect(JSON.stringify(await findPlayers("example"))).not.toMatch(/lastActive|last_active|perlica/i);
    });
  });

  it("takes taps on a guide arriving together one at a time: each goes through, and she answers the day's first once", async () => {
    // 阿米娅向导's touch used to write first and lock the player last, so two at once deadlocked and one failed
    for (const id of [AMIYA_ID, PERLICA_ID, TALULAH_ID, MINGHE_ID]) {
      const taps = await Promise.all(Array.from({ length: 4 }, () => me.touch(id, false)));
      expect(taps.filter((t) => t.guide?.itemId)).toHaveLength(1);
    }
    // touching two of them at once as well
    await expect(Promise.all([me.touch(AMIYA_ID, true), me.touch(PERLICA_ID, true), me.touch(AMIYA_ID, false)])).resolves.toHaveLength(3);
  });

  it("tells a second tap that came with the first that it is done already, instead of failing", async () => {
    const reasons = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => (r.reason as Error).message);
    // putting a roach down: both pick the same free slot, and one of them is down already
    for (const target of [{ kind: "main" }, { kind: "clone" }] as PlaceTarget[]) {
      const taps = await Promise.allSettled([me.placeRoach(target, PEOPLES_SQUARE), me.placeRoach(target, TOKYO)]);
      for (const why of reasons(taps)) expect(why).toBe("刚才那只已经放好了。");
    }
    const slots = (await me.me()).roaches.map((r) => r.slot);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).toContain(0);

    // touching back the same touch: answered once
    const pal = await signUp("pal@example.com");
    await pal.touch((await me.me()).roaches.find((r) => r.slot === 0)!.publicId, false);
    const item = (await me.inbox()).find((i) => i.kind === "touch")!.id;
    const back = await Promise.allSettled([me.reply(item, false), me.reply(item, false), me.reply(item, true)]);
    expect(back.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(reasons(back)).toEqual(["已经碰过 TA 了。", "已经碰过 TA 了。"]);
  });

  it("lets anyone touch 佩丽卡监督, who touches back and counts the day's touches, apart from everything between players", async () => {
    const sneaky = await me.touch(PERLICA_ID, false);
    expect(sneaky).toMatchObject({ newFriend: null, guide: { id: "perlica", bold: false, kind: "touch", times: null } });
    const first = await me.touch(PERLICA_ID, true);
    expect(first).toMatchObject({ newFriend: "佩丽卡监督", guide: { id: "perlica", bold: true, kind: "friend", times: null } });
    // she has touched back once today: nothing more from her until the player's next day
    expect(await me.touch(PERLICA_ID, true)).toMatchObject({ newFriend: null, guide: { kind: "touch", itemId: null, times: null } });
    const rows = await db.select().from(perlicaTouches).where(eq(perlicaTouches.userId, me.id));
    expect(rows.filter((r) => r.direction === "to_perlica")).toHaveLength(3);
    expect(rows.filter((r) => r.direction === "from_perlica").map((r) => r.kind).sort()).toEqual(["friend", "touch"]);

    const inbox = await me.inbox();
    expect(inbox.filter((i) => i.kind === "perlica")).toHaveLength(2);
    expect(inbox.find((i) => i.id === first.guide!.itemId!)).toMatchObject({ what: "friend", bold: true, seen: false });
    expect(await db.select().from(touches)).toEqual([]);
    expect(await db.select().from(friendships)).toEqual([]);
    expect((await userRow(me.id)).friendsEver).toBe(0);
    expect(await badgeIds(me)).not.toContain("trainee");
    expect(await badgeIds(me)).not.toContain("farwhisker");

    // 阿米娅向导 first, then her; nothing to block, report or poke
    await me.touch(AMIYA_ID, true);
    const list = await me.friends();
    expect(list.map((f) => f.id)).toEqual([AMIYA_ID, PERLICA_ID]);
    expect(list[1]).toMatchObject({ profile: { displayName: "佩丽卡监督" }, roaches: [], history: [], pokeAgainAt: null });
    await expect(me.block(`friend:${PERLICA_ID}`)).rejects.toThrow("佩丽卡监督不是真人");
    await expect(me.report(first.guide!.itemId!, "spam")).rejects.toThrow("不是真人");
    await expect(world.poke(me.id, PERLICA_ID)).rejects.toThrow("佩丽卡监督一直醒着");
    expect((await me.me()).perlica).toEqual({ friend: true, timer: null, week: null });

    // her own 20 a day, apart from 阿米娅向导's and the 60 between players
    for (let i = 3; i < 20; i++) await me.touch(PERLICA_ID, false);
    await expect(me.touch(PERLICA_ID, false)).rejects.toThrow("今天跟佩丽卡碰得够多啦");
    await expect(me.touch(AMIYA_ID, false)).resolves.toBeTruthy();
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(me.touch((await publicAt(me, tester("t1").roaches[0])).id, false)).resolves.toBeTruthy();
    for (let day = 0; day < 4; day++) {
      await dayBefore(perlicaTouches, me);
      expect((await me.touch(PERLICA_ID, false)).guide!.itemId).toBeTruthy();
    }
    expect((await me.inbox()).filter((i) => i.kind === "perlica")).toHaveLength(5);

    // 解除 leaves the timer alone; a bold touch makes them 触须之交 again
    await perlica.setTimer(me.id, true);
    await me.unfriend(PERLICA_ID);
    expect((await me.me()).perlica).toEqual({ friend: false, timer: "on", week: null });
    expect((await me.friends()).map((f) => f.id)).toEqual([AMIYA_ID]);
  });

  it("touches back once a day by the player's own clock from 04:00, as 佩丽卡监督 does, counting a bold first touch", async () => {
    await db.update(users).set({ perlicaFriendSince: new Date() }).where(eq(users.id, me.id));
    // the latest 04:00 in Beijing and in Nashville: hours apart
    const beijing = deviceDay(-480).start;
    const nashville = deviceDay(360).start;
    expect(Math.abs(beijing - nashville)).toBeGreaterThan(3_600_000);
    for (const [offset, start] of [
      [-480, beijing],
      [360, nashville],
    ]) {
      const after = async (touchedAt: number) => {
        await db.delete(perlicaTouches).where(eq(perlicaTouches.userId, me.id));
        await db.insert(perlicaTouches).values({ userId: me.id, direction: "to_perlica", bold: false, createdAt: new Date(touchedAt) });
        return (await world.touch(me.id, PERLICA_ID, true, offset)).guide!;
      };
      // a touch a minute before their 04:00 was yesterday's: she answers this one
      const answered = await after(start - 60_000);
      expect(answered.itemId).toBeTruthy();
      expect(answered.times).toBe(1);
      // one just after it was today's: she has answered today already
      expect(await after(start + 1000)).toMatchObject({ itemId: null, times: null });
    }
  });

  it("lets you touch back or crawl away from 佩丽卡监督's once each, her reports included, and only your own", async () => {
    await perlica.setTimer(me.id, true);
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await db.update(users).set({ lastActiveAt: new Date(Date.now() - 4000 * 1000) }).where(eq(users.id, me.id));
    const report = (await perlica.here(me.id))!;
    const { guide } = await me.touch(PERLICA_ID, false);
    const item = guide!.itemId!;
    const amiya = (await me.touch(AMIYA_ID, false)).guide!.itemId!;

    const other = await signUp("other@example.com");
    await expect(other.reply(item, true)).rejects.toThrow("找不到这条消息了");
    await expect(other.ignore(item)).rejects.toThrow("找不到这条消息了");
    await other.markSeen([item]);
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ seen: false });
    // an Amiya id with Perlica's prefix, and the other way round, finds nothing
    await expect(me.reply(`e:${amiya.slice(2)}`, false)).rejects.toThrow("找不到这条消息了");
    await expect(me.reply(`a:${item.slice(2)}`, false)).rejects.toThrow("找不到这条消息了");

    const back = await me.reply(report.id, true);
    expect(back).toMatchObject({ newFriend: "佩丽卡监督", guide: { id: "perlica", kind: "friend" } });
    await expect(me.reply(report.id, false)).rejects.toThrow("已经碰过 TA 了");
    await expect(me.ignore(report.id)).rejects.toThrow("已经碰过 TA 了");
    expect((await me.inbox()).find((i) => i.id === report.id)).toMatchObject({ replied: true });

    await me.ignore(item);
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ ignored: true, seen: true });
    await expect(me.reply(item, false)).rejects.toThrow("默默爬走");
    await me.markSeen([back.guide!.itemId!]);
    expect((await me.inbox()).find((i) => i.id === back.guide!.itemId!)).toMatchObject({ seen: true });
  });

  it("forgets touches with 佩丽卡监督 after 90 days, and all of them with the account", async () => {
    await me.touch(PERLICA_ID, true);
    await db.insert(perlicaTouches).values({
      userId: me.id,
      direction: "from_perlica",
      bold: false,
      createdAt: new Date(Date.now() - 91 * 86_400_000),
    });
    await pruneOldActivity();
    expect(await db.select().from(perlicaTouches)).toHaveLength(2);
    await deleteAccount(await userRow(me.id));
    expect(await db.select().from(perlicaTouches)).toEqual([]);
  });

  it("never counts 佩丽卡监督 on the radar or in the shared roach list", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch(PERLICA_ID, true);
    expect(await me.radar()).toMatchObject({ friendsNearby: 0 });
    expect(JSON.stringify(await allRoaches())).not.toMatch(/perlica/i);
  });

  it("lets anyone touch 塔露拉干员, who answers openly and shakes hands on the first bold touch, apart from everything between players", async () => {
    expect(await me.touch(TALULAH_ID, false)).toMatchObject({ newFriend: null, guide: { id: "talulah", bold: false, kind: "touch" } });
    const shake = await me.touch(TALULAH_ID, true);
    expect(shake).toMatchObject({ newFriend: "塔露拉干员", guide: { id: "talulah", bold: true, kind: "friend" } });
    // she has touched back once today: nothing more from her until the player's next day
    expect(await me.touch(TALULAH_ID, true)).toMatchObject({ newFriend: null, guide: { kind: "touch", itemId: null } });
    const rows = await db.select().from(talulahTouches).where(eq(talulahTouches.userId, me.id));
    expect(rows.filter((r) => r.direction === "to_talulah").map((r) => r.bold).sort()).toEqual([false, true, true]);
    expect(rows.filter((r) => r.direction === "from_talulah").map((r) => r.kind).sort()).toEqual(["handshake", "touch"]);

    const inbox = await me.inbox();
    expect(inbox.find((i) => i.id === shake.guide!.itemId!)).toMatchObject({ kind: "talulah", line: "handshake", seen: false });
    expect(inbox.some((i) => i.kind === "touch")).toBe(false);
    expect(await db.select().from(touches)).toEqual([]);
    expect(await db.select().from(friendships)).toEqual([]);
    expect((await userRow(me.id)).friendsEver).toBe(0);
    expect(await badgeIds(me)).not.toContain("trainee");
    expect(await badgeIds(me)).not.toContain("farwhisker");

    // after 阿米娅向导 and 佩丽卡监督; nothing to block, report or poke
    await me.touch(PERLICA_ID, true);
    await me.touch(AMIYA_ID, true);
    const list = await me.friends();
    expect(list.map((f) => f.id)).toEqual([AMIYA_ID, PERLICA_ID, TALULAH_ID]);
    expect(list[2]).toMatchObject({ profile: { displayName: "塔露拉干员" }, history: [], pokeAgainAt: null });
    expect(list[2].roaches).toEqual([expect.objectContaining({ id: TALULAH_ID, friend: true, guide: true, ...FIRE_AT })]);
    await expect(me.block(`friend:${TALULAH_ID}`)).rejects.toThrow("塔露拉干员不是真人，不用拉黑。");
    await expect(me.report(shake.guide!.itemId!, "spam")).rejects.toThrow("不是真人");
    await expect(world.poke(me.id, TALULAH_ID)).rejects.toThrow("塔露拉干员一直醒着，碰碰她吧。");
    expect((await me.me()).talulah).toEqual({ friend: true, visited: false });

    // her own 20 a day, apart from the other guides' and the 60 between players
    for (let i = 3; i < 20; i++) await me.touch(TALULAH_ID, false);
    await expect(me.touch(TALULAH_ID, false)).rejects.toThrow("今天跟塔露拉碰得够多啦，明天再来吧。");
    await expect(me.touch(PERLICA_ID, false)).resolves.toBeTruthy();
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(me.touch((await publicAt(me, tester("t1").roaches[0])).id, false)).resolves.toBeTruthy();
    for (let day = 0; day < 4; day++) {
      await dayBefore(talulahTouches, me);
      expect((await me.touch(TALULAH_ID, false)).guide!.itemId).toBeTruthy();
    }
    expect((await me.inbox()).filter((i) => i.kind === "talulah")).toHaveLength(5);

    // 解除: she stays; the next bold touch shakes hands again
    await db.delete(talulahTouches).where(eq(talulahTouches.userId, me.id));
    await me.unfriend(TALULAH_ID);
    expect((await me.friends()).map((f) => f.id)).toEqual([AMIYA_ID, PERLICA_ID]);
    expect((await me.touch(TALULAH_ID, true)).newFriend).toBe("塔露拉干员");
  });

  it("lets you answer or crawl away from 塔露拉干员's once each, and only your own", async () => {
    const item = (await me.touch(TALULAH_ID, false)).guide!.itemId!;
    const other = await signUp("other@example.com");
    await expect(other.reply(item, true)).rejects.toThrow("找不到这条消息了");
    await expect(other.ignore(item)).rejects.toThrow("找不到这条消息了");
    await other.markSeen([item]);
    expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ seen: false });
    await expect(me.reply(`e:${item.slice(2)}`, false)).rejects.toThrow("找不到这条消息了");

    const back = await me.reply(item, true);
    expect(back).toMatchObject({ newFriend: "塔露拉干员", guide: { kind: "friend" } });
    await expect(me.reply(item, false)).rejects.toThrow("已经碰过 TA 了");
    await expect(me.ignore(item)).rejects.toThrow("已经碰过 TA 了");
    await me.ignore(back.guide!.itemId!);
    expect((await me.inbox()).find((i) => i.id === back.guide!.itemId!)).toMatchObject({ ignored: true, seen: true });
    await expect(me.reply(back.guide!.itemId!, false)).rejects.toThrow("默默爬走");
  });

  it("welcomes a player's first roach by 塔露拉干员's fire, within 300 m, once for good", async () => {
    // metres north of the fire, as distanceKm measures them
    const north = (m: number) => ({ lng: FIRE_AT.lng, lat: FIRE_AT.lat + (m / 1000 / 6371.0088) * (180 / Math.PI) });
    const welcomes = async (p: Player) =>
      (await db.select().from(talulahTouches).where(eq(talulahTouches.userId, p.id))).filter((r) => r.kind === "welcome");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const [, far] = await me.placeRoach({ kind: "clone" }, north(301));
    expect(await welcomes(me)).toEqual([]);
    expect((await me.me()).talulah.visited).toBe(false);
    await me.placeRoach({ kind: "move", roachId: far.id }, north(299));
    expect(await welcomes(me)).toHaveLength(1);
    expect((await me.me()).talulah.visited).toBe(true);
    expect((await me.inbox()).find((i) => i.kind === "talulah")).toMatchObject({ line: "welcome", seen: false });
    // away and back again: no second welcome
    await me.placeRoach({ kind: "move", roachId: far.id }, TOKYO);
    await me.placeRoach({ kind: "move", roachId: far.id }, north(10));
    expect(await welcomes(me)).toHaveLength(1);

    // a main roach counts too, and two arriving at once bring one welcome
    const other = await signUp("other@example.com");
    await other.placeRoach({ kind: "main" }, north(50));
    expect(await welcomes(other)).toHaveLength(1);
    const third = await signUp("third@example.com");
    await Promise.all([talulah.arrivedAt(third.id, north(20)), talulah.arrivedAt(third.id, north(30))]);
    expect(await welcomes(third)).toHaveLength(1);
  });

  it("answers a 触须之交's birthday declaration once a year, and nothing else", async () => {
    const birthdays = async (p: Player) =>
      (await db.select().from(talulahTouches).where(eq(talulahTouches.userId, p.id))).filter((r) => r.kind === "birthday");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    // not her 触须之交 yet
    await me.declare({ template: "birthday" });
    expect(await birthdays(me)).toEqual([]);
    await me.touch(TALULAH_ID, true);
    await db.update(declarations).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(declarations.senderId, me.id));
    const { reach } = await me.declare({ template: "birthday" });
    expect(reach).toBeTruthy();
    expect(await birthdays(me)).toHaveLength(1);
    expect((await me.inbox()).find((i) => i.kind === "talulah" && i.line === "birthday")).toMatchObject({ seen: false });
    // she is never among the recipients
    expect(JSON.stringify(await db.select().from(deliveries))).not.toMatch(/talulah/i);
    // within a year: no second answer; a year on: another
    await db.update(users).set({ talulahBirthdayAt: new Date(Date.now() - 364 * 86_400_000) }).where(eq(users.id, me.id));
    await talulah.birthdayDeclared(me.id);
    expect(await birthdays(me)).toHaveLength(1);
    await db.update(users).set({ talulahBirthdayAt: new Date(Date.now() - 366 * 86_400_000) }).where(eq(users.id, me.id));
    await talulah.birthdayDeclared(me.id);
    expect(await birthdays(me)).toHaveLength(2);

    // other declarations bring nothing
    const friend = await signUp("friend@example.com");
    await friend.placeRoach({ kind: "main" }, TOKYO);
    await friend.touch(TALULAH_ID, true);
    await friend.declare({ template: "launch", game: "arknights" });
    expect(await birthdays(friend)).toEqual([]);
  });

  it("forgets touches with 塔露拉干员 after 90 days, and all of them with the account", async () => {
    await me.touch(TALULAH_ID, true);
    await db.insert(talulahTouches).values({
      userId: me.id,
      direction: "from_talulah",
      bold: false,
      createdAt: new Date(Date.now() - 91 * 86_400_000),
    });
    await pruneOldActivity();
    expect(await db.select().from(talulahTouches)).toHaveLength(2);
    await deleteAccount(await userRow(me.id));
    expect(await db.select().from(talulahTouches)).toEqual([]);
  });

  it("never counts 塔露拉干员 on the radar or in the shared roach list", async () => {
    // test players live in Harbin too: she adds nobody to what the radar finds there
    await me.placeRoach({ kind: "main" }, { lng: FIRE_AT.lng + 0.001, lat: FIRE_AT.lat });
    const before = (await me.radar())!;
    await me.touch(TALULAH_ID, true);
    await rewindScans(me.id);
    expect(await me.radar()).toMatchObject({ roaches: before.roaches, players: before.players, friendsNearby: 0 });
    expect(JSON.stringify(await allRoaches())).not.toMatch(/talulah/i);
  });

  describe("佩丽卡监督's second step", () => {
    const HOUR_MS = 3_600_000;
    /** Their touches with her a day back, so the next one is the first of today */
    const herYesterday = (p: Player) =>
      db
        .update(perlicaTouches)
        .set({ createdAt: sql`${perlicaTouches.createdAt} - interval '1 day'` })
        .where(eq(perlicaTouches.userId, p.id));
    /** 触须之交 since yesterday: a bold touch, a day back */
    const befriendHer = async (p: Player) => {
      await p.touch(PERLICA_ID, true);
      await herYesterday(p);
    };
    const roachOf = async (p: Player, key: string, i = 0) => (await publicAt(p, tester(key).roaches[i])).id;

    it("is jealous on the first touch of her in a day, when a 触须之交 touched others first", async () => {
      await befriendHer(me);
      await me.touch(await roachOf(me, "t1"), false);
      // the same player's other roach counts once
      await me.touch(await roachOf(me, "t1", 1), false);
      await me.touch(await roachOf(me, "t2"), true);
      await me.touch(AMIYA_ID, false);
      const jealous = await me.touch(PERLICA_ID, true);
      expect(jealous.guide).toMatchObject({ kind: "jealous", others: 3, line: 0, times: 1 });
      expect((await me.inbox()).find((i) => i.id === jealous.guide!.itemId!)).toMatchObject({
        what: "jealous",
        others: 3,
        line: 0,
        times: 1,
      });
      // she answers once a day, so nothing more today: no 罗德岛那位 either
      expect((await me.touch(PERLICA_ID, true)).guide).toMatchObject({ kind: "touch", itemId: null, times: null });

      // touching 塔露拉干员 counts too; only 阿米娅向导 is her other line
      const other = await signUp("other@example.com");
      await befriendHer(other);
      await other.touch(TALULAH_ID, false);
      expect((await other.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "jealous", others: 1, line: 0 });
      const third = await signUp("third@example.com");
      await befriendHer(third);
      await third.touch(AMIYA_ID, true);
      expect((await third.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "jealous", others: 1, line: 1 });

      // not her 触须之交: never jealous
      const stranger = await signUp("stranger@example.com");
      await stranger.placeRoach({ kind: "main" }, TOKYO);
      await stranger.touch(await roachOf(stranger, "t2"), false);
      expect((await stranger.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "touch" });
    });

    it("counts the day by the device's clock", async () => {
      const bj = deviceDay(-480).start;
      const ny = deviceDay(300).start;
      // a touch of another player that falls in one zone's today but not the other's
      const at = new Date(Math.max(bj, ny) - 60_000);
      const inBeijing = at.getTime() >= bj;
      const players = await Promise.all(["a@example.com", "b@example.com"].map(signUp));
      for (const p of players) {
        await befriendHer(p);
        await p.placeRoach({ kind: "main" }, TOKYO);
        await p.touch(await roachOf(p, "t2"), false);
        await db.update(touches).set({ createdAt: at }).where(eq(touches.fromUserId, p.id));
      }
      const [bjAnswer, nyAnswer] = await Promise.all([
        world.touch(players[0].id, PERLICA_ID, false, -480),
        world.touch(players[1].id, PERLICA_ID, false, 300),
      ]);
      expect(bjAnswer.guide!.kind).toBe(inBeijing ? "jealous" : "touch");
      expect(nyAnswer.guide!.kind).toBe(inBeijing ? "touch" : "jealous");
    });

    it("says 「罗德岛那位……」 once a day when 阿米娅向导 was touched too, either way round, never on a jealous day", async () => {
      await me.touch(AMIYA_ID, false);
      expect((await me.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "aside", line: 0 });
      expect((await me.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "touch" });
      expect((await me.touch(AMIYA_ID, true)).aside).toBeUndefined();

      // the other way round: she speaks up as 阿米娅向导 is touched, a note of hers already read
      const other = await signUp("other@example.com");
      await other.touch(PERLICA_ID, false);
      const amiya = await other.touch(AMIYA_ID, false);
      expect(amiya.aside).toEqual({ id: "perlica", itemId: expect.stringMatching(/^e:/) });
      expect((await other.inbox()).find((i) => i.id === amiya.aside!.itemId)).toMatchObject({
        kind: "perlica",
        what: "aside",
        line: 1,
        seen: true,
      });
      expect((await other.touch(AMIYA_ID, false)).aside).toBeUndefined();
      expect((await other.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "touch" });

      // a jealous day has no aside
      const third = await signUp("third@example.com");
      await befriendHer(third);
      await third.touch(AMIYA_ID, false);
      expect((await third.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "jealous", line: 1 });
      expect((await third.touch(AMIYA_ID, false)).aside).toBeUndefined();
    });

    it("answers on her birthday before anything but a first bold touch", async () => {
      perlica.pretendBirthday(me.id);
      expect((await me.touch(PERLICA_ID, true)).guide).toMatchObject({ kind: "friend" });
      await herYesterday(me);
      await me.touch(AMIYA_ID, false);
      expect((await me.touch(PERLICA_ID, false)).guide).toMatchObject({ kind: "birthday" });
      // once a day, birthday or not; a bold first touch the next day is counted
      expect((await me.touch(PERLICA_ID, true)).guide).toMatchObject({ kind: "touch", itemId: null });
      await herYesterday(me);
      expect((await me.touch(PERLICA_ID, true)).guide).toMatchObject({ kind: "birthday", times: 1 });
    });

    it("is jealous once however many touches come at once", async () => {
      await befriendHer(me);
      await me.touch(AMIYA_ID, false);
      const both = await Promise.all([me.touch(PERLICA_ID, false), me.touch(PERLICA_ID, false)]);
      expect(both.map((r) => r.guide!.kind).sort()).toEqual(["jealous", "touch"]);
    });

    it("sends a 触须之交 with her 离开计时 on her weekly report, once a week, dated the start of it", async () => {
      const { start, prevStart } = deviceWeek(-480);
      const lastWeek = new Date(prevStart + HOUR_MS);
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await me.touch(PERLICA_ID, true);
      await me.touch(PERLICA_ID, false);
      await me.touch(PERLICA_ID, true);
      await me.touch(await roachOf(me, "t1"), false);
      await me.touch(await roachOf(me, "t2"), false);
      await db.update(touches).set({ createdAt: lastWeek }).where(eq(touches.fromUserId, me.id));
      await db.update(perlicaTouches).set({ createdAt: lastWeek }).where(eq(perlicaTouches.userId, me.id));
      // not yet: the timer is off
      expect((await me.me()).perlica.week).toBeNull();
      await perlica.setTimer(me.id, true);
      const week = (await me.me()).perlica.week;
      expect(week).toMatchObject({ kind: "perlica", what: "week", others: 2, times: 3, seen: true });
      expect(week!.at).toBe(start);
      expect([0, 1, 2]).toContain(week!.line);
      expect((await me.me()).perlica.week).toBeNull();
      // switching the timer off takes it away with her reports
      await perlica.setTimer(me.id, false);
      expect((await db.select().from(perlicaTouches).where(eq(perlicaTouches.userId, me.id))).some((r) => r.kind === "week")).toBe(false);

      // one a week, however many visits ask at once
      const other = await signUp("other@example.com");
      await other.touch(PERLICA_ID, true);
      await db.update(perlicaTouches).set({ createdAt: lastWeek }).where(eq(perlicaTouches.userId, other.id));
      await perlica.setTimer(other.id, true);
      const both = await Promise.all([world.me(other.id), world.me(other.id)]);
      expect(both.filter((m) => m!.perlica.week)).toHaveLength(1);

      // nothing touched last week, or not her 触须之交: nothing
      const quiet = await signUp("quiet@example.com");
      await quiet.touch(PERLICA_ID, true);
      await perlica.setTimer(quiet.id, true);
      expect((await quiet.me()).perlica.week).toBeNull();
      const stranger = await signUp("stranger@example.com");
      await stranger.placeRoach({ kind: "main" }, TOKYO);
      await stranger.touch(await roachOf(stranger, "t2"), false);
      await db.update(touches).set({ createdAt: lastWeek }).where(eq(touches.fromUserId, stranger.id));
      await perlica.setTimer(stranger.id, true);
      expect((await stranger.me()).perlica.week).toBeNull();
    });
  });

  describe("明河都尉", () => {
    const DAY_MS = 86_400_000;
    const today = () => minghe.mingheToday();
    const ridersNow = async () =>
      (await db.select().from(roaches).where(isNotNull(roaches.rideSince))).sort(
        (x, y) => x.rideSince!.getTime() - y.rideSince!.getTime(),
      );

    it("lets anyone touch him, who answers the same way and is 触须之交 from the first bold touch, apart from everything between players", async () => {
      expect(await me.touch(MINGHE_ID, false)).toMatchObject({ newFriend: null, guide: { id: "minghe", bold: false, kind: "touch" } });
      const first = await me.touch(MINGHE_ID, true);
      expect(first).toMatchObject({ newFriend: "明河都尉", guide: { id: "minghe", bold: true, kind: "friend" } });
      // he has touched back once today: nothing more from him until the player's next day
      expect(await me.touch(MINGHE_ID, true)).toMatchObject({ newFriend: null, guide: { kind: "touch", itemId: null } });
      const rows = await db.select().from(mingheTouches).where(eq(mingheTouches.userId, me.id));
      expect(rows.filter((r) => r.direction === "to_minghe").map((r) => r.bold).sort()).toEqual([false, true, true]);
      expect(rows.filter((r) => r.direction === "from_minghe").map((r) => `${r.kind}:${r.bold}`).sort()).toEqual([
        "friend:true",
        "touch:false",
      ]);
      const inbox = await me.inbox();
      expect(inbox.find((i) => i.id === first.guide!.itemId!)).toMatchObject({ kind: "minghe", line: "friend", seen: false, stop: null });
      expect(inbox.some((i) => i.kind === "touch")).toBe(false);
      expect(await db.select().from(touches)).toEqual([]);
      expect(await db.select().from(friendships)).toEqual([]);
      expect((await userRow(me.id)).friendsEver).toBe(0);
      expect(await badgeIds(me)).not.toContain("trainee");
      expect(await badgeIds(me)).not.toContain("farwhisker");

      // fourth among the 触须之交, where he is today; nothing to block, report or poke
      await me.touch(TALULAH_ID, true);
      await me.touch(PERLICA_ID, true);
      await me.touch(AMIYA_ID, true);
      const list = await me.friends();
      expect(list.map((f) => f.id)).toEqual([AMIYA_ID, PERLICA_ID, TALULAH_ID, MINGHE_ID]);
      expect(list[3]).toMatchObject({ profile: { displayName: "明河都尉" }, history: [], pokeAgainAt: null });
      expect(list[3].roaches).toEqual([
        expect.objectContaining({ id: MINGHE_ID, friend: true, guide: true, ...stationOf(today()).at }),
      ]);
      await expect(me.block(`friend:${MINGHE_ID}`)).rejects.toThrow("明河都尉不是真人，不用拉黑。");
      await expect(me.report(first.guide!.itemId!, "spam")).rejects.toThrow("不是真人");
      await expect(world.poke(me.id, MINGHE_ID)).rejects.toThrow("明河都尉一直醒着，碰碰他吧。");
      expect((await me.me()).minghe).toEqual({ friend: true, riding: null, dayShift: 0 });

      // his own 20 a day, apart from the other guides' and the 60 between players
      for (let i = 3; i < 20; i++) await me.touch(MINGHE_ID, false);
      await expect(me.touch(MINGHE_ID, false)).rejects.toThrow("今天跟明河碰得够多啦，明天再来吧。");
      await expect(me.touch(TALULAH_ID, false)).resolves.toBeTruthy();
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await expect(me.touch((await publicAt(me, tester("t1").roaches[0])).id, false)).resolves.toBeTruthy();
      for (let day = 0; day < 4; day++) {
        await dayBefore(mingheTouches, me);
        expect((await me.touch(MINGHE_ID, false)).guide!.itemId).toBeTruthy();
      }
      expect((await me.inbox()).filter((i) => i.kind === "minghe")).toHaveLength(5);

      // 解除: he rides on; the next bold touch makes them 触须之交 again
      await me.unfriend(MINGHE_ID);
      expect((await me.friends()).map((f) => f.id)).toEqual([AMIYA_ID, PERLICA_ID, TALULAH_ID]);
      await db.delete(mingheTouches).where(eq(mingheTouches.userId, me.id));
      expect((await me.touch(MINGHE_ID, true)).newFriend).toBe("明河都尉");
    });

    it("lets you answer or crawl away from his once each, and only your own", async () => {
      const item = (await me.touch(MINGHE_ID, false)).guide!.itemId!;
      expect(item.startsWith("m:")).toBe(true);
      const other = await signUp("other@example.com");
      await expect(other.reply(item, true)).rejects.toThrow("找不到这条消息了");
      await expect(other.ignore(item)).rejects.toThrow("找不到这条消息了");
      await other.markSeen([item]);
      expect((await me.inbox()).find((i) => i.id === item)).toMatchObject({ seen: false });
      await expect(me.reply(`h:${item.slice(2)}`, false)).rejects.toThrow("找不到这条消息了");

      const back = await me.reply(item, true);
      expect(back).toMatchObject({ newFriend: "明河都尉", guide: { id: "minghe", kind: "friend" } });
      await expect(me.reply(item, false)).rejects.toThrow("已经碰过 TA 了");
      await expect(me.ignore(item)).rejects.toThrow("已经碰过 TA 了");
      await me.ignore(back.guide!.itemId!);
      expect((await me.inbox()).find((i) => i.id === back.guide!.itemId!)).toMatchObject({ ignored: true, seen: true });
      await expect(me.reply(back.guide!.itemId!, false)).rejects.toThrow("默默爬走");
      // answering him counts towards his 20 like any touch
      const mine = await db
        .select()
        .from(mingheTouches)
        .where(and(eq(mingheTouches.userId, me.id), eq(mingheTouches.direction, "to_minghe")));
      expect(mine).toHaveLength(2);
    });

    it("sends a clone to ride with him, a new one as a placement or one already out as a move, into today's queue", async () => {
      const day = today();
      const [main] = await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await expect(world.rideMinghe(me.id, { kind: "move", roachId: main.id })).rejects.toThrow("本体不能跟他走");
      await expect(world.rideMinghe(me.id, { kind: "main" } as never)).rejects.toThrow("派一只克隆体跟他走吧");
      const movesBefore = (await db.select().from(moves)).length;
      const { roaches: mine, item } = await world.rideMinghe(me.id, { kind: "clone" });
      expect(item).toMatchObject({ kind: "minghe", line: "ride", stop: stopOf(day), seen: false });
      const rider = mine.find((r) => r.slot === 1)!;
      expect(metresApart(rider, queueSpot(day, 0))).toBeLessThan(0.01);
      expect((await db.select().from(moves)).length).toBe(movesBefore + 1);
      expect((await me.me()).minghe.riding).toEqual({ roachId: rider.id, since: expect.any(Number), stops: 1 });
      // everyone sees a clone riding along, never whose
      expect((await allRoaches()).filter((r) => r.ride)).toEqual([expect.objectContaining({ id: rider.publicId, clone: true })]);
      await expect(world.rideMinghe(me.id, { kind: "clone" })).rejects.toThrow("你已经有一只克隆体在跟明河走了。");

      // all three clones out: one of them moves over, which counts as a move, and he keeps where it stood
      const other = await signUp("other@example.com");
      await other.placeRoach({ kind: "main" }, TOKYO);
      for (let i = 1; i <= 3; i++) await other.placeRoach({ kind: "clone" }, { lng: TOKYO.lng + 0.01 * i, lat: TOKYO.lat });
      const out = (await other.me()).roaches.find((r) => r.slot === 2)!;
      const left = (await other.me()).movesLeft;
      const moved = (await world.rideMinghe(other.id, { kind: "move", roachId: out.id })).roaches.find((r) => r.id === out.id)!;
      expect(metresApart(moved, queueSpot(day, 1))).toBeLessThan(0.01);
      expect(moved.publicId).not.toBe(out.publicId);
      expect((await other.me()).movesLeft).toBe(left - 1);
      const [row] = await db.select().from(roaches).where(eq(roaches.id, moved.id));
      expect(row).toMatchObject({ rideStartDay: day, rideDay: day, rideFromLng: out.lng, rideFromLat: out.lat });
    });

    it("gives riders stacked on one spot (the queue used to end at 2 km) a spot each, in the order they got on", async () => {
      const day = today();
      const riders: string[] = [];
      for (let i = 0; i < 4; i++) {
        const p = await signUp(`rider${i}@example.com`);
        await p.placeRoach({ kind: "main" }, TOKYO);
        riders.push((await world.rideMinghe(p.id, { kind: "clone" })).roaches.find((r) => r.slot === 1)!.id);
      }
      // the last three all on the first one's spot, as the old queue left them past 2 km
      const first = queueSpot(day, 0);
      await db.update(roaches).set({ lng: first.lng, lat: first.lat }).where(isNotNull(roaches.rideSince));
      expect(await minghe.spreadStackedRiders()).toBe(3);
      const spots = await Promise.all(riders.map(async (id) => (await db.select().from(roaches).where(eq(roaches.id, id)))[0]));
      expect(spots.map((r) => [0, 1, 2, 3].findIndex((k) => metresApart(r, queueSpot(day, k)) < 0.01))).toEqual([0, 1, 2, 3]);
      // nobody stacked: nothing moves
      expect(await minghe.spreadStackedRiders()).toBe(0);
    });

    it("moves his riders to the next station at 04:00, once a day, and sees them home after 7", async () => {
      const day = today();
      const now = Date.now();
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      const fresh = (await world.rideMinghe(me.id, { kind: "clone" })).roaches.find((r) => r.slot === 1)!;
      const other = await signUp("other@example.com");
      await other.placeRoach({ kind: "main" }, TOKYO);
      const stay = (await other.placeRoach({ kind: "clone" }, { lng: TOKYO.lng + 0.01, lat: TOKYO.lat })).find((r) => r.slot === 1)!;
      // a touch before it rides is no part of the trip
      const toucher = await signUp("toucher@example.com");
      await toucher.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await toucher.touch(stay.publicId, false);
      const ridden = (await world.rideMinghe(other.id, { kind: "move", roachId: stay.id })).roaches.find((r) => r.id === stay.id)!;
      await toucher.touch(ridden.publicId, true);
      await toucher.touch(fresh.publicId, false);
      const moveRows = (await db.select().from(moves)).length;
      const left = (await other.me()).movesLeft;

      // the next day: both to the next station, in the order they got on, under new public ids
      expect(await minghe.moveMingheRiders(now + DAY_MS)).toEqual({ moved: 2, home: 0 });
      let [a, b] = await ridersNow();
      expect([a.id, b.id]).toEqual([fresh.id, stay.id]);
      expect(metresApart(a, queueSpot(day + 1, 0))).toBeLessThan(0.01);
      expect(metresApart(b, queueSpot(day + 1, 1))).toBeLessThan(0.01);
      expect([a.rideDay, b.rideDay]).toEqual([day + 1, day + 1]);
      expect(a.publicId).not.toBe(fresh.publicId);
      // not the players' own moves: no rows for the radar or 欢迎回家, nothing off the day's three
      expect((await db.select().from(moves)).length).toBe(moveRows);
      expect((await other.me()).movesLeft).toBe(left);
      expect((await me.me()).minghe.riding).toMatchObject({ roachId: fresh.id, stops: 2 });
      // again the same day: nothing moves
      expect(await minghe.moveMingheRiders(now + DAY_MS)).toEqual({ moved: 0, home: 0 });
      expect((await ridersNow())[0].publicId).toBe(a.publicId);

      // three days without it: straight to that day's station
      await minghe.moveMingheRiders(now + 4 * DAY_MS);
      [a, b] = await ridersNow();
      expect(a.rideDay).toBe(day + 4);
      expect(metresApart(a, queueSpot(day + 4, 0))).toBeLessThan(0.01);
      await toucher.touch(a.publicId, true);

      // 7 stations on: the new clone is taken back, the moved one goes back where it stood, and he says how it went
      expect(await minghe.moveMingheRiders(now + 7 * DAY_MS)).toEqual({ moved: 0, home: 2 });
      expect(await ridersNow()).toEqual([]);
      // 七站星河: both rode all seven stations
      expect(await badgeIds(me)).toContain("sevenstops");
      expect(await badgeIds(other)).toContain("sevenstops");
      expect((await me.me()).roaches.map((r) => r.slot)).toEqual([0]);
      const [back] = await db.select().from(roaches).where(eq(roaches.id, stay.id));
      expect(back).toMatchObject({ lng: stay.lng, lat: stay.lat, rideSince: null, rideStartDay: null, rideDay: null, rideFromLng: null });
      expect((await me.inbox()).find((i) => i.kind === "minghe" && i.line === "trip")).toMatchObject({
        stop: stopOf(day),
        times: 2,
        seen: false,
      });
      expect((await other.inbox()).find((i) => i.kind === "minghe" && i.line === "trip")).toMatchObject({ times: 1 });
    });

    it("lets a rider get off at a station, where it stays, and quietly when moved or taken back by hand", async () => {
      const day = today();
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await expect(world.dismountMinghe(me.id)).rejects.toThrow("你没有克隆体在跟明河走。");
      const rider = (await world.rideMinghe(me.id, { kind: "clone" })).roaches.find((r) => r.slot === 1)!;
      const { item, roaches: after } = await world.dismountMinghe(me.id);
      expect(item).toMatchObject({ kind: "minghe", line: "dismount", stop: stopOf(day) });
      expect(after.find((r) => r.id === rider.id)).toMatchObject({ lng: rider.lng, lat: rider.lat });
      expect((await me.me()).minghe.riding).toBeNull();
      expect((await allRoaches()).some((r) => r.ride)).toBe(false);
      expect(await minghe.moveMingheRiders(Date.now() + DAY_MS)).toEqual({ moved: 0, home: 0 });

      // moved by hand: off without a word
      await world.rideMinghe(me.id, { kind: "move", roachId: rider.id });
      await me.placeRoach({ kind: "move", roachId: rider.id }, TOKYO);
      expect((await me.me()).minghe.riding).toBeNull();
      // taken back: gone with it
      const again = (await world.rideMinghe(me.id, { kind: "clone" })).roaches.find((r) => r.slot === 2)!;
      await me.removeRoach(again.id);
      expect((await me.me()).minghe.riding).toBeNull();
      const lines = (await db.select().from(mingheTouches).where(eq(mingheTouches.userId, me.id))).map((r) => r.kind).sort();
      expect(lines).toEqual(["dismount", "ride", "ride", "ride"]);
    });

    it("never counts him on the radar, nor his riders' daily moves as arrivals", async () => {
      const next = stationOf(today() + 1).at;
      await me.placeRoach({ kind: "main" }, { lng: next.lng + 0.002, lat: next.lat });
      const before = (await me.radar())!;
      await me.touch(MINGHE_ID, true);
      const other = await signUp("other@example.com");
      await other.placeRoach({ kind: "main" }, TOKYO);
      await world.rideMinghe(other.id, { kind: "clone" });
      await minghe.moveMingheRiders(Date.now() + DAY_MS);
      await rewindScans(me.id);
      // what the radar read is kept a few minutes: as if they had passed
      forgetRadarBlocks();
      const after = (await me.radar())!;
      // his rider is there now, but it did not arrive as anyone's move
      expect(after.roaches).toBe(before.roaches + 1);
      expect(after.week.arrived).toBe(before.week.arrived);
      expect(after.friendsNearby).toBe(0);
      expect(JSON.stringify(await allRoaches())).not.toMatch(/minghe/i);
    });

    it("forgets his messages after 90 days, and everything of his with the account", async () => {
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await me.touch(MINGHE_ID, true);
      await world.rideMinghe(me.id, { kind: "clone" });
      await db.insert(mingheTouches).values({
        userId: me.id,
        direction: "from_minghe",
        kind: "trip",
        bold: false,
        stop: 3,
        times: 2,
        createdAt: new Date(Date.now() - 91 * DAY_MS),
      });
      await pruneOldActivity();
      expect(await db.select().from(mingheTouches)).toHaveLength(3);
      await deleteAccount(await userRow(me.id));
      expect(await db.select().from(mingheTouches)).toEqual([]);
      expect(await ridersNow()).toEqual([]);
    });

    it("forgets a player's records with him when testing locally", async () => {
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await me.touch(MINGHE_ID, true);
      await world.rideMinghe(me.id, { kind: "clone" });
      await minghe.forgetMinghe(me.id);
      expect((await me.me()).minghe).toEqual({ friend: false, riding: null, dayShift: 0 });
      expect(await db.select().from(mingheTouches)).toEqual([]);
      expect((await me.me()).roaches).toHaveLength(2);
    });
  });

  it("gives 泰拉异格酒神 on the 50th drink, counting every one, and never lets test players drink", async () => {
    const regular = await signUp("regular@example.com");
    await regular.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await db.update(users).set({ drinksTotal: 49 }).where(eq(users.id, regular.id));
    await award(regular.id, ["tipsy"]);
    await world.drink(regular.id);
    // 人称千杯 at ten on the way
    expect((await regular.me()).badges.map((b) => b.id)).toEqual(["tipsy", "bacchus", "thousandcups"]);
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

  it("tells you when you signed up, which nobody else is told", async () => {
    const row = (await world.userById(me.id))!;
    const mine = await me.me();
    expect(mine.joinedAt).toBe(row.createdAt.getTime());
    expect(Object.keys(mine.profile)).not.toContain("joinedAt");
    // the card others see of you
    const card = (await world.cardsOf([row], me.id)).get(me.id)!;
    expect(card.displayName).toBeDefined();
    expect(JSON.stringify(card)).not.toContain(String(row.createdAt.getTime()));
    expect(Object.keys(card)).not.toContain("joinedAt");
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

  it("finds a roach by the short id the feed gives it, as long as no other roach's public id starts the same", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const target = await publicAt(me, tester("t2").roaches[0]);
    const other = await publicAt(me, tester("t1").roaches[0]);
    await me.touch(target.id.slice(0, 8), false);
    expect((await (await demo("t2")).inbox())[0]).toMatchObject({ kind: "touch", target: "main" });
    // the same roach under its whole id: already touched today
    await expect(me.touch(target.id, false)).rejects.toThrow("今天已经偷偷碰过这只蟑螂了");

    // another roach comes to start like this one, before the page hears: the short id names neither
    const shared = `${other.id.slice(0, 8)}-0000-4000-8000-000000000000`;
    await db.update(roaches).set({ publicId: shared }).where(eq(roaches.publicId, target.id));
    await expect(me.touch(other.id.slice(0, 8), false)).rejects.toThrow("已经爬走了");
    await me.touch(other.id, false);
    await expect(me.touch("0f6b2a5", false)).rejects.toThrow("已经爬走了");
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

  it("lets you touch back only someone you have not touched in the last day, so touches never go back and forth", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, TOKYO);
    const t1 = await demo("t1");
    const waiting = async (p: Player) => (await p.inbox()).find((i) => i.kind === "touch" && !i.replied && !i.ignored)!;
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, true);
    // 阿白 has not touched me today: TA may touch back
    expect(await waiting(t1)).not.toHaveProperty("waits");
    await t1.reply((await waiting(t1)).id, false);
    // I have, boldly: my touch back waits till tomorrow, either way, and the inbox says so before I try
    const mine = await waiting(me);
    expect(mine).toMatchObject({ target: "touch", waits: "all" });
    await expect(me.reply(mine.id, false)).rejects.toThrow("今天已经碰过 TA 了，明天再碰回去吧。");
    await expect(me.reply(mine.id, true)).rejects.toThrow("今天已经碰过 TA 了，明天再碰回去吧。");

    // the same for a touch on another of my roaches, and for touching back from a declaration
    await t1.touch((await publicAt(t1, TOKYO)).id, false);
    const other = (await me.inbox()).find((i) => i.kind === "touch" && i.target === "clone")!;
    expect(other).toMatchObject({ waits: "all", replied: false });
    await expect(me.reply(other.id, false)).rejects.toThrow("今天已经碰过 TA 了");
    await t1.declare({ template: "launch", game: "arknights" });
    const heard = (await me.inbox()).find((i) => i.kind === "declaration")!;
    expect(heard).toMatchObject({ waits: "all" });
    await expect(me.reply(heard.id, true)).rejects.toThrow("今天已经碰过 TA 了");

    // a day on, they go; however its id is spelled, an item is answered once
    await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '25 hours'` });
    expect(await waiting(me)).not.toHaveProperty("waits");
    await expect(me.reply(mine.id, false)).resolves.toEqual({ newFriend: null });
    await expect(me.reply(`t:${mine.id.slice(2).toUpperCase()}`, false)).rejects.toThrow("已经碰过 TA 了");
    await expect(me.reply(`${mine.id}:again`, false)).rejects.toThrow("已经碰过 TA 了");
  });

  it("lets one player touch another's roaches three times a day, main and clones together, touching back included", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    for (let i = 0; i < 4; i++) await me.placeRoach({ kind: "clone" }, { lng: 100 + i, lat: 20 });
    const t1 = await demo("t1");
    const [a, b, c, d] = (await t1.roaches()).filter((r) => r.lng === PEOPLES_SQUARE.lng || r.lat === 20);
    for (const r of [a, b, c]) await t1.touch(r.id, false);
    await expect(t1.touch(d.id, true)).rejects.toThrow("今天已经碰过这只蟑螂的主人 3 次了，明天再来吧。");
    expect((await me.inbox()).filter((i) => i.kind === "touch")).toHaveLength(3);

    // touching back counts too: once I touched 阿白 back, two more of their roaches, and no more
    const [first] = (await me.inbox()).filter((i) => i.kind === "touch");
    await me.reply(first.id, false);
    for (const at of tester("t1").roaches) await me.touch((await publicAt(me, at)).id, false);
    await t1.placeRoach({ kind: "clone" }, { lng: 90, lat: 10 });
    await expect(me.touch((await publicAt(me, { lng: 90, lat: 10 })).id, false)).rejects.toThrow("的主人 3 次了");

    // a day on, three more
    await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '25 hours'` });
    await expect(t1.touch(d.id, false)).resolves.toEqual({ newFriend: null });
  });

  it("lets the bold touch that makes two players 触须之交 go, past the day's three or after touching today", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    for (let i = 0; i < 3; i++) await me.placeRoach({ kind: "clone" }, { lng: 100 + i, lat: 20 });
    const t1 = await demo("t1");
    // I touched 阿白 boldly two days ago
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, true);
    await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '49 hours'` });
    const [a, b, c, d] = (await t1.roaches()).filter((r) => r.lng === PEOPLES_SQUARE.lng || r.lat === 20);
    for (const r of [a, b, c]) await t1.touch(r.id, false);
    await expect(t1.touch(d.id, false)).rejects.toThrow("的主人 3 次了");
    await expect(t1.touch(d.id, true)).resolves.toMatchObject({ newFriend: expect.any(String) });
    expect(await me.friends()).toHaveLength(1);
  });

  it("lets you touch back boldly, and only boldly, someone you touched today when that makes you 触须之交", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    // I touched 阿白 sneakily; then 阿白 touches me boldly
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, false);
    await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true);
    const bold = (await me.inbox()).find((i) => i.kind === "touch" && i.bold)!;
    expect(bold).toMatchObject({ waits: "sneaky" });
    await expect(me.reply(bold.id, false)).rejects.toThrow("今天已经碰过 TA 了");
    await expect(me.reply(bold.id, true)).resolves.toMatchObject({ newFriend: expect.any(String) });
  });

  it("lets a sneaky touch on a roach be followed by a bold one the same day, to say who it was, and nothing after", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const r = await publicAt(me, tester("t2").roaches[0]);
    await me.touch(r.id, false);
    // sneakily again: not today, and the answer says what still goes
    await expect(me.touch(r.id, false)).rejects.toThrow("今天已经偷偷碰过这只蟑螂了。想让 TA 知道是你，可以大胆碰一下。");
    // boldly: it goes, and 小林 sees who, besides the sneaky one
    await expect(me.touch(r.id, true)).resolves.toEqual({ newFriend: null });
    const theirs = (await (await demo("t2")).inbox()).filter((i) => i.kind === "touch");
    expect(theirs.map((i) => i.kind === "touch" && [i.bold, i.from?.displayName ?? null, i.target]).sort()).toEqual([
      [false, null, "main"],
      [true, "Breeze", "main"],
    ]);
    // after the bold one, nothing more on that roach today, either way
    await expect(me.touch(r.id, true)).rejects.toThrow("今天已经碰过这只蟑螂了，明天再来吧。");
    await expect(me.touch(r.id, false)).rejects.toThrow("今天已经碰过这只蟑螂了，明天再来吧。");
    // nor after a bold one first
    const other = await publicAt(me, tester("t1").roaches[0]);
    await me.touch(other.id, true);
    await expect(me.touch(other.id, false)).rejects.toThrow("今天已经碰过这只蟑螂了，明天再来吧。");

    // the bold one makes 触须之交 when TA touched you boldly before
    const t3 = await demo("t3");
    await t3.touch((await publicAt(t3, PEOPLES_SQUARE)).id, true);
    const kal = await publicAt(me, tester("t3").roaches[0]);
    await me.touch(kal.id, false);
    await expect(me.touch(kal.id, true)).resolves.toEqual({ newFriend: "Kal" });
  });

  it("keeps the day's three touches on one player when a bold touch follows sneaky ones", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    // all three of Kal's roaches, sneakily: a bold one now on the first is a fourth
    const kal = await Promise.all(tester("t3").roaches.map((at) => publicAt(me, at)));
    for (const r of kal) await me.touch(r.id, false);
    await expect(me.touch(kal[0].id, true)).rejects.toThrow("今天已经碰过这只蟑螂的主人 3 次了，明天再来吧。");
    // nor from 消息, when Kal touches me
    const t3 = await demo("t3");
    await t3.touch((await publicAt(t3, PEOPLES_SQUARE)).id, false);
    const item = (await me.inbox()).find((i) => i.kind === "touch")!;
    expect(item).toMatchObject({ waits: "all" });
    await expect(me.reply(item.id, true)).rejects.toThrow("今天已经碰过 TA 了，明天再碰回去吧。");
  });

  it("lets you touch back boldly, to say who it was, someone you touched only sneakily today, and nothing more after", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights"] });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    const waiting = async (p: Player) => (await p.inbox()).find((i) => i.kind === "touch" && !i.replied && !i.ignored)!;
    // I touch 阿白 sneakily, and 阿白 touches me back sneakily
    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, false);
    await t1.reply((await waiting(t1)).id, false);
    // a sneaky touch back waits till tomorrow, a bold one goes now, and the inbox says so before I try
    const back = await waiting(me);
    expect(back).toMatchObject({ target: "touch", bold: false, waits: "reveal" });
    await expect(me.reply(back.id, false)).rejects.toThrow("今天已经碰过 TA 了，偷偷碰回去要等明天，大胆碰回去现在就行。");
    // the same for a declaration of theirs
    await t1.declare({ template: "launch", game: "arknights" });
    const heard = () => me.inbox().then((items) => items.find((i) => i.kind === "declaration")!);
    expect(await heard()).toMatchObject({ waits: "reveal" });
    await expect(me.reply(back.id, true)).resolves.toEqual({ newFriend: null });

    // 阿白 sees who it was, and may touch back boldly to become 触须之交
    const told = (await t1.inbox()).find((i) => i.kind === "touch" && i.bold)!;
    expect(told).toMatchObject({ target: "touch", from: { displayName: "Breeze" }, waits: "sneaky" });
    // after my bold touch, nothing more from me today
    expect(await heard()).toMatchObject({ waits: "all" });
    await expect(me.reply((await heard()).id, true)).rejects.toThrow("今天已经碰过 TA 了，明天再碰回去吧。");
    await expect(t1.reply(told.id, true)).resolves.toEqual({ newFriend: "Breeze" });
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
    // 全体目光向我看齐！ is theirs already, so declaring brings no badge (and no nudge) of its own
    await award(me.id, ["lookatme"]);
    const count = { me: 0, t2: 0, t4: 0 };
    const heard: string[] = [];
    const offs = [
      listen(me.id, () => count.me++),
      listen(t2.id, (event) => {
        count.t2++;
        heard.push(event);
      }),
      listen(t4.id, () => count.t4++),
    ];

    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    expect(count).toEqual({ me: 0, t2: 1, t4: 0 });
    await me.declare({ template: "launch", game: "arknights" });
    expect(count).toEqual({ me: 0, t2: 2, t4: 0 });
    // a declaration says so: pages take their time with those
    expect(heard).toEqual(["inbox", "declare"]);
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
    expect(got.kind === "declaration" && got.options.map((o) => o.id)).toContain("birthday");
    await t2.react(got.id, "birthday");
    await expect(t2.react(got.id, "plusone")).rejects.toThrow("已经回应过");
    expect((await t2.inbox())[0]).toMatchObject({ reaction: { id: "birthday", text: "生日快乐！" } });
    const t1 = await demo("t1");
    await t1.react((await t1.inbox())[0].id, "zhouli");
    // 夜莺厨 lives in Beijing and never got it
    const t4 = await demo("t4");
    await expect(t4.react(got.id, "plusone")).rejects.toThrow("找不到");
    expect(nudged).toBe(2);
    off();

    const reactions = (await me.inbox()).filter((i) => i.kind === "reaction");
    expect(reactions.map((r) => r.kind === "reaction" && r.reaction.id).sort()).toEqual(["birthday", "zhouli"]);
    expect(reactions.map((r) => r.kind === "reaction" && r.reaction.text).sort()).toEqual(["合乎粥礼", "生日快乐！"]);
    expect(reactions[0]).toMatchObject({ text: "祝我生日快乐", seen: false });
    expect(JSON.stringify(reactions)).not.toMatch(/阿白|小林|t1|t2/);
    expect(JSON.stringify(reactions)).not.toContain(t2.id);

    // the sender can touch back whoever reacted, and seeing them clears them
    const fromT2 = reactions.find((r) => r.kind === "reaction" && r.reaction.id === "birthday")!;
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
    expect(got.kind === "declaration" && got.options.map((o) => o.id)).not.toContain("birthday");
    await expect(t2.react(got.id, "birthday")).rejects.toThrow("不能这样回应");
    await expect(t2.react(got.id, "nonsense")).rejects.toThrow("不能这样回应");
  });

  it("offers each declaration its own four replies, filled in, then the five every one has", async () => {
    await me.saveProfile({ ...EMPTY_PROFILE, games: ["arknights"], favourites: { arknights: ["阿米娅"], endfield: [] } });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "love", character: "阿米娅" });
    const t2 = await demo("t2");
    const [got] = await t2.inbox();
    expect(got.kind === "declaration" && got.options.map((o) => [o.text, o.own])).toEqual([
      ["我也永远喜欢阿米娅！", true],
      ["阿米娅是我的！", true],
      ["你上次也是这么说的", true],
      ["同担！碰我一下", true],
      ["原来，你也玩舟？", false],
      ["合乎粥礼", false],
      ["舟P收收味", false],
      ["+1", false],
      ["这种已经是外交官级别的了", false],
    ]);
    await expect(t2.react(got.id, "launch.4")).rejects.toThrow("不能这样回应");
    await t2.react(got.id, "love.4");
    expect((await t2.inbox())[0]).toMatchObject({ reaction: { id: "love.4", text: "同担！碰我一下" } });
    const [back] = (await me.inbox()).filter((i) => i.kind === "reaction");
    expect(back).toMatchObject({ text: "我永远喜欢阿米娅", reaction: { text: "同担！碰我一下" } });
    expect(back.kind === "reaction" && back.from).toBeUndefined();

    // one left before the sentences had their own still reads
    await db.update(reactions).set({ reaction: "zhouli" });
    expect((await me.inbox()).find((i) => i.kind === "reaction")).toMatchObject({ reaction: { id: "zhouli", text: "合乎粥礼" } });
  });

  it("gives whoever gets a declaration the very sentence sent, every one there is, with its replies, and its sender each reply", async () => {
    // One of every sentence (tsc wants one for each), its blanks never what a row read wrong falls back to
    // (启动, 明日方舟, the first food or spouse): 缘缘庄's two read as 「明日方舟，启动！」 to all who got them
    const EVERY: { [K in Template]: Extract<Declaration, { template: K }> } = {
      launch: { template: "launch", game: "endfield" },
      stronghold: { template: "stronghold" },
      iam: { template: "iam", character: "阿米娅", title: "猫" },
      love: { template: "love", character: "阿米娅" },
      buff: { template: "buff", character: "阿米娅" },
      myname: { template: "myname", game: "endfield", name: "Dr. Breeze" },
      welcome: { template: "welcome", game: "endfield" },
      canyou: { template: "canyou", character: "阿米娅" },
      eat: { template: "eat", character: "阿米娅", food: FOODS[2] },
      birthday: { template: "birthday" },
      event: { template: "event", line: "minghe" },
      alsoplay: { template: "alsoplay", game: "endfield" },
      water: { template: "water" },
      drunklove: { template: "drunklove", character: "阿米娅" },
      kr168: { template: "kr168", character: "阿米娅", spouse: "老公" },
      radar: { template: "radar" },
      roguelike: { template: "roguelike" },
      xianshu: { template: "xianshu" },
      rental: { template: "rental" },
      sihouse: { template: "sihouse" },
      simine: { template: "simine" },
    };
    const sendable = [...TEMPLATES, ...DRUNK_TEMPLATES, ...STAY_TEMPLATES];
    // the sheet's lists hold every sentence but the limited lines and 「…也玩…」 of before
    expect([...sendable, "event", "alsoplay"].sort()).toEqual(Object.keys(EVERY).sort());
    await me.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "Breeze",
      drPrefix: true,
      games: ["arknights", "endfield"],
      favourites: { arknights: ["阿米娅"], endfield: [] },
    });
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    // drunk till tomorrow, and a guest of 缘缘庄 before: every sentence can be sent
    await db.update(users).set({ drunkUntil: new Date(Date.now() + 86_400_000), siStayedAt: new Date() }).where(eq(users.id, me.id));
    const t2 = await demo("t2");
    // every limited line, on now
    const lines = EVENTS.flatMap((e) => e.lines);
    const saved = lines.map(({ start, end }) => ({ start, end }));
    lines.forEach((l) => Object.assign(l, { start: new Date(Date.now() - 3_600_000).toISOString(), end: new Date(Date.now() + 3_600_000).toISOString() }));
    try {
      const sent: Declaration[] = [...sendable.map((t) => EVERY[t]), ...lines.map((l) => ({ template: "event", line: l.id }) as const)];
      for (const d of sent) {
        await me.declare(d);
        const [got] = await t2.inbox();
        expect(got, d.template).toMatchObject({ kind: "declaration", text: declarationText(d), reaction: null });
        expect(got.kind === "declaration" && got.options, d.template).toEqual(repliesFor(d));
        // its fourth, asking for a touch; one of the five for a sentence without its own
        const pick = repliesFor(d).filter((r) => r.own).at(-1) ?? repliesFor(d)[0];
        await t2.react(got.id, pick.id);
        expect((await t2.inbox())[0], d.template).toMatchObject({ id: got.id, reaction: pick });
        expect((await me.inbox()).filter((i) => i.kind === "reaction"), d.template).toMatchObject([{ text: declarationText(d), reaction: pick }]);
        // the next at once, not a minute later or after the day's twenty
        await db.delete(declarations).where(eq(declarations.senderId, me.id));
      }
    } finally {
      lines.forEach((l, i) => Object.assign(l, saved[i]));
    }

    // 「…也玩…」 can no longer be sent; one of then reads as it was
    await me.declare({ template: "launch", game: "endfield" });
    await db.update(declarations).set({ template: "alsoplay" }).where(eq(declarations.senderId, me.id));
    const [old] = await t2.inbox();
    expect(old).toMatchObject({ kind: "declaration", text: declarationText(EVERY.alsoplay) });
    expect(old.kind === "declaration" && old.options).toEqual(repliesFor(EVERY.alsoplay));

    // replies picked while 缘缘庄's two read as 「明日方舟，启动！」 read as picked, and none is picked so now
    await db.delete(declarations).where(eq(declarations.senderId, me.id));
    await me.declare({ template: "simine" });
    const [inn] = await t2.inbox();
    expect(inn).toMatchObject({ kind: "declaration", text: "疯狂新妻祀是我的！" });
    await db.insert(reactions).values({ declarationId: inn.id.slice("d:".length), fromUserId: t2.id, reaction: "launch.1" });
    expect((await t2.inbox())[0]).toMatchObject({ id: inn.id, reaction: { id: "launch.1", text: "上号！" } });
    expect((await me.inbox()).find((i) => i.kind === "reaction")).toMatchObject({ text: "疯狂新妻祀是我的！", reaction: { text: "上号！" } });
    await expect((await demo("t1")).react(inn.id, "launch.1")).rejects.toThrow("不能这样回应");
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
    // the dates, to put back after
    const saved = lines.map(({ start, end }) => ({ start, end }));
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
      // its own four, then the five
      expect(got.kind === "declaration" && got.options.slice(0, 4).map((o) => o.id)).toEqual(["tazi.1", "tazi.2", "tazi.3", "tazi.4"]);
      await t2.react(got.id, "tazi.1");
      expect((await me.inbox()).find((i) => i.kind === "reaction")).toMatchObject({
        text: "恭喜塔姐上岛！",
        reaction: { id: "tazi.1", text: "塔姐，欢迎上岛！" },
      });

      await db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - interval '2 minutes'` });
      await me.declare({ template: "event", line: "yuanyuan" });
      expect(await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, me.id))).toEqual(
        expect.arrayContaining([{ badge: "half2026" }]),
      );
      // once, and nobody else earned it
      expect(await db.select().from(userBadges).where(eq(userBadges.badge, "half2026"))).toHaveLength(1);

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
    // seen within 11/04–11/10: me and other; the demo players never count; came that day: me
    expect(await db.select().from(dailyTotals)).toEqual([{ day: "2026-11-10", activeWeek: 2, signups: 1, friendships: 1, players: 3, visitors: 1 }]);

    // someone signs up a minute before midnight, after the last count of the day
    const late = await signUp("late@example.com");
    await db.update(users).set({ createdAt: at("2026-11-10T23:59+08:00") }).where(eq(users.id, late.id));
    await recordDailyTotals(Date.parse("2026-11-11T00:05+08:00"));
    // yesterday's players counted again too, but not who came: by now some of them may have come today
    expect(await db.select().from(dailyTotals).orderBy(dailyTotals.day)).toEqual([
      { day: "2026-11-10", activeWeek: 2, signups: 2, friendships: 1, players: 4, visitors: 1 },
      { day: "2026-11-11", activeWeek: 1, signups: 0, friendships: 0, players: 4, visitors: 0 },
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
    // the players near enough to see it
    const got = await db.execute<{ id: string }>(
      sql`select distinct user_id as id from roaches where user_id <> ${me.id}
        and ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${PEOPLES_SQUARE.lng}, ${PEOPLES_SQUARE.lat}), 4326)::geography, 10000)`,
    );
    expect(got.length).toBeGreaterThanOrEqual(10);
    for (const r of got.slice(0, 9)) await world.react(r.id, `d:${d.id}`, "plusone");
    expect(await me.me()).toMatchObject({ counts: { responders: 9 } });
    expect(await badgeIds(me)).toEqual(["lookatme"]);
    await world.react(got[9].id, `d:${d.id}`, "zhouli");
    // ten on the one declaration: 一呼百舟应 too
    expect(await badgeIds(me)).toEqual(["spokesperson", "lookatme", "echo"]);
  });

  describe("the second round of badges", () => {
    const yesterday = () => beijingDate(Date.now() - 86_400_000);
    const nextDeclaration = () => db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - interval '2 minutes'` });

    it("counts Beijing days of declaring, once a day, and the everyday sentences sent", async () => {
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await me.declare({ template: "launch", game: "arknights" });
      expect(await badgeIds(me)).toEqual(["lookatme"]);
      await nextDeclaration();
      await me.declare({ template: "welcome", game: "arknights" });
      // twenty in a day are one day
      expect((await me.me()).counts).toMatchObject({ declareDays: 1, declareLines: 2 });

      await db
        .update(users)
        .set({ declareDays: 9, declaredOn: yesterday(), declaredLines: ["iam", "love", "buff", "myname", "welcome", "canyou", "eat"] })
        .where(eq(users.id, me.id));
      await nextDeclaration();
      // 祝我生日快乐 is not one of the eight, but a new day of declaring
      await me.declare({ template: "birthday" });
      expect((await me.me()).counts).toMatchObject({ declareDays: 10, declareLines: 7 });
      expect(await badgeIds(me)).toEqual(["lookatme", "declarer"]);
      await nextDeclaration();
      // nor is 卫戍协议，启动！
      await me.declare({ template: "stronghold" });
      expect((await me.me()).counts).toMatchObject({ declareDays: 10, declareLines: 7 });
      expect(await badgeIds(me)).toEqual(["lookatme", "declarer"]);
      await nextDeclaration();
      await me.declare({ template: "launch", game: "endfield" });
      expect(await badgeIds(me)).toEqual(["lookatme", "declarer", "fluent"]);
    });

    it("counts Beijing days of responding, and never who was answered", async () => {
      const t2 = await demo("t2");
      const t3 = await demo("t3");
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      for (const t of [t2, t3]) {
        await t.declare({ template: "launch", game: "arknights" });
        const item = (await me.inbox()).find((i) => i.kind === "declaration" && !i.reaction)!;
        await me.react(item.id, "plusone");
      }
      expect((await me.me()).counts).toMatchObject({ reactDays: 1 });
      expect(await badgeIds(me)).toEqual(["courtesy"]);
      await db.update(users).set({ reactDays: 9, reactedOn: yesterday() }).where(eq(users.id, me.id));
      await nextDeclaration();
      await t2.declare({ template: "welcome", game: "endfield" });
      await me.react((await me.inbox()).find((i) => i.kind === "declaration" && !i.reaction)!.id, "zhouli");
      expect(await badgeIds(me)).toEqual(["courtesy", "hype"]);
    });

    it("gives each guide's badge as she becomes 触须之交, 满编小队 with all four, and counts days of touching 阿米娅 and 佩丽卡", async () => {
      for (const id of [AMIYA_ID, PERLICA_ID, TALULAH_ID]) await me.touch(id, true);
      expect(await badgeIds(me)).toEqual(["amiya", "perlica", "talulah"]);
      expect((await me.me()).counts).toMatchObject({ guideFriends: 3, amiyaDays: 1, perlicaDays: 1 });
      await me.touch(MINGHE_ID, true);
      // five held: 罗德岛正式干员 too
      expect(await badgeIds(me)).toEqual(["regular", "amiya", "perlica", "talulah", "minghe", "fullsquad"]);

      await db.update(users).set({ amiyaDays: 29, amiyaTouchedOn: yesterday() }).where(eq(users.id, me.id));
      await me.touch(AMIYA_ID, false);
      await me.touch(AMIYA_ID, false);
      expect((await me.me()).counts).toMatchObject({ amiyaDays: 30 });
      expect(await badgeIds(me)).toContain("amiya30");
      expect(await badgeIds(me)).not.toContain("perlica30");
    });

    it("gives 以宣会友 to both when a back-and-forth that began with a declaration makes them 触须之交", async () => {
      const pal = await signUp("pal@example.com");
      const stranger = await signUp("stranger@example.com");
      await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
      await pal.placeRoach({ kind: "main" }, { lng: PEOPLES_SQUARE.lng + 0.01, lat: PEOPLES_SQUARE.lat });
      await stranger.placeRoach({ kind: "main" }, { lng: PEOPLES_SQUARE.lng - 0.01, lat: PEOPLES_SQUARE.lat });
      await me.declare({ template: "launch", game: "arknights" });
      // pal answers the declaration boldly, and me touches back boldly
      const heard = (await pal.inbox()).find((i) => i.kind === "declaration")!;
      await pal.reply(heard.id, true);
      const back = (await me.inbox()).find((i) => i.kind === "touch")!;
      expect((await me.reply(back.id, true)).newFriend).toBeTruthy();
      expect(await badgeIds(me)).toContain("declfriend");
      expect(await badgeIds(pal)).toContain("declfriend");
      // touched on the map instead: not this one
      const roachOf = async (p: Player) => (await p.me()).roaches.find((r) => r.slot === 0)!.publicId;
      await stranger.touch(await roachOf(me), true);
      await me.touch(await roachOf(stranger), true);
      expect(await badgeIds(stranger)).not.toContain("declfriend");
    });

    it("gives 火边的歌声 to everyone by 塔露拉's fire once 50 roaches sit there, test players aside", async () => {
      const near = (i: number) => ({ lng: FIRE_AT.lng + 0.0003 * Math.cos(i), lat: FIRE_AT.lat + 0.0003 * Math.sin(i) });
      const players = await Promise.all(Array.from({ length: 49 }, (_, i) => signUp(`fire${i}@example.com`)));
      await db.insert(roaches).values(players.map((p, i) => ({ userId: p.id, slot: 0, ...near(i), publicId: randomUUID() })));
      await fireSongs();
      expect(await db.select().from(userBadges).where(eq(userBadges.badge, "fireside"))).toEqual([]);
      // the fiftieth arrives the usual way
      await me.placeRoach({ kind: "main" }, near(50));
      expect(await badgeIds(me)).toContain("fireside");
      expect(await db.select().from(userBadges).where(eq(userBadges.badge, "fireside"))).toHaveLength(50);
    });

    it("catches up what players already did, as kept, at every start", async () => {
      await db
        .update(users)
        .set({ declareDays: 30, reactDays: 10, amiyaFriendSince: new Date(), perlicaDays: 30, declaredLines: ["launch"] })
        .where(eq(users.id, me.id));
      await catchUpBadges();
      expect(await badgeIds(me)).toEqual(["regular", "lookatme", "declarer", "chief", "courtesy", "hype", "amiya", "perlica30"]);
    });
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

  it("wakes 石棺里的苏醒 once for two pages that both found the player back, and again on the next return", async () => {
    const away = () => db.update(users).set({ lastSeenOn: beijingDate(Date.now() - 20 * 86_400_000) }).where(eq(users.id, me.id));
    await away();
    expect((await me.me()).badges).toMatchObject([{ id: "survivor", seen: false }]);
    await markBadgesSeen(me.id, ["survivor"]);
    // a second page opened at the same moment read the visit before, and finds the player back as well
    await away();
    await Promise.all([me.me(), me.me()]);
    expect((await me.me()).badges).toMatchObject([{ id: "survivor", seen: true }]);
    await wakeUp(me.id);
    expect((await me.me()).badges).toMatchObject([{ id: "survivor", seen: true }]);
    // given more than a day ago, as on the next return after a long time away: new again
    await db.update(userBadges).set({ earnedAt: new Date(Date.now() - 86_400_000 - 60_000) }).where(eq(userBadges.userId, me.id));
    await wakeUp(me.id);
    const [again] = (await me.me()).badges;
    expect(again).toMatchObject({ id: "survivor", seen: false });
    expect(Date.now() - again.at).toBeLessThan(60_000);
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

  it("shows a 触须之交 the UID only once its owner fills it in and ticks 把 UID 一起给对方看", async () => {
    const fan = { ...EMPTY_PROFILE, anonymous: false, name: "Breeze", games: ["arknights" as const] };
    await me.saveProfile(fan);
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await befriend(me, "t1");
    const t1 = await demo("t1");
    // no UID yet
    expect((await t1.friends())[0].profile.uid).toBeUndefined();
    // filled in, but not shared: still nothing
    const withUid = { ...fan, uid: { arknights: "12345678", endfield: "" }, uidServer: { arknights: "bili", endfield: "" } };
    await me.saveProfile(withUid);
    expect((await t1.friends())[0].profile.uid).toBeUndefined();
    // shared: the friend sees it, with its server
    await me.saveProfile({ ...withUid, shareUid: true });
    expect((await t1.friends())[0].profile).toMatchObject({ uid: { arknights: "12345678" }, uidServer: { arknights: "bili" } });
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

  it("keeps the newest hundred declarations in the inbox, and gives a page only the ones after those it holds", async () => {
    const shouter = await signUp("shout@example.com");
    const sent = async (minutesAgo: number) => {
      const [d] = await db
        .insert(declarations)
        .values({ senderId: shouter.id, template: "launch", game: "arknights", recipients: 1, createdAt: new Date(Date.now() - minutesAgo * 60_000) })
        .returning({ id: declarations.id });
      await db.insert(deliveries).values({ declarationId: d.id, recipientId: me.id });
      return `d:${d.id}`;
    };
    const ids: string[] = [];
    for (let i = 0; i < 105; i++) ids.push(await sent(300 - i));
    const box = (await me.inbox()).filter((i) => i.kind === "declaration");
    expect(box).toHaveLength(100);
    // the newest hundred, newest first: the five oldest are left out
    expect(box.map((i) => i.id)).toEqual(ids.slice(5).reverse());

    // a page holding them gets only what came after the newest (and that one again, from a second's overlap)
    const newest = box[0].at;
    expect((await world.newDeclarations(me.id, newest)).map((i) => i.id)).toEqual([ids[104]]);
    const fresh = await sent(0);
    const got = await world.newDeclarations(me.id, newest);
    expect(got.map((i) => i.id)).toEqual([fresh, ids[104]]);
    // each just as the whole inbox gives it
    expect(got[0]).toEqual((await me.inbox()).find((i) => i.id === fresh));
    // nonsense asks for the whole inbox's worth
    expect(await world.newDeclarations(me.id, "soon")).toHaveLength(100);
  });

  it("ranks this week's 「我永远喜欢」, 「加强」 and 「我想吃」 (合乎粥礼) by different players, three or more", async () => {
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
    // 我想吃银灰的… by four, 我想吃能天使的… by two
    for (const p of players) await shout(p, "eat", "银灰", "2026-11-03T12:00+08:00");
    for (const p of players.slice(0, 2)) await shout(p, "eat", "能天使", "2026-11-03T12:00+08:00");

    const list = await computeHotList(now);
    expect(list.weekStart).toBe(Date.parse("2026-11-02T04:00+08:00"));
    expect(list.boards.love).toEqual([{ rank: 1, character: "能天使", games: ["arknights"], players: 3 }]);
    expect(list.boards.buff).toEqual([{ rank: 1, character: "能天使", games: ["arknights"], players: 3 }]);
    expect(list.boards.eat).toEqual([{ rank: 1, character: "银灰", games: ["arknights"], players: 4 }]);
    expect(list.lastWeek).toEqual({ love: { rank: 1, character: "黑", games: ["arknights"], players: 4 }, buff: null, eat: null });
    // two players are too few to show
    expect(JSON.stringify(list)).not.toContain("佩丽卡");
  });

  it("gives a character of the story her game on the hot list, as any other", async () => {
    const now = Date.parse("2026-11-04T12:00+08:00");
    const players = [me, ...(await Promise.all(["a", "b"].map((x) => signUp(`${x}@example.com`))))];
    for (const p of players) {
      await db.insert(declarations).values({ senderId: p.id, template: "love", character: "普瑞赛斯", recipients: 0, createdAt: new Date("2026-11-03T10:00+08:00") });
    }
    expect((await computeHotList(now)).boards.love).toEqual([{ rank: 1, character: "普瑞赛斯", games: ["arknights"], players: 3 }]);
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
    for (let i = 0; i < MAX_CLONES; i++) await me.placeRoach({ kind: "clone" }, { lng: 100 + i, lat: 20 });
    await expect(me.placeRoach({ kind: "clone" }, { lng: 110, lat: 20 })).rejects.toThrow(`最多只能放 ${MAX_CLONES} 只`);

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

  it("files reports for the admin, blocks the reported player, and holds a profile three players report", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    await aged(me.id, (await demo("t2")).id, (await demo("t3")).id);
    await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true);
    const [touch] = await me.inbox();
    await expect(me.report(touch.id, "nonsense")).rejects.toThrow("举报理由");
    await me.report(touch.id, "name", "  名字在骂人  ");
    await me.report(touch.id, "spam");
    expect(await me.inbox()).toEqual([]);
    const [filed] = await db.select().from(reports);
    expect(filed).toMatchObject({ reason: "name", note: "名字在骂人", context: "大胆碰了举报人的本体", targetName: "阿白" });
    expect(await db.$count(reports)).toBe(1);

    // two more players report what 阿白 wrote about themselves, for the other reasons of that kind: held until the admin looks
    for (const [key, reason] of [
      ["t2", "contact"],
      ["t3", "impersonate"],
    ]) {
      const p = await demo(key);
      await t1.touch((await publicAt(t1, tester(key).roaches[0])).id, true);
      const [item] = (await p.inbox()).filter((i) => i.kind === "touch");
      await p.report(item.id, reason);
    }
    const aBai = await userRow(t1.id);
    expect(aBai).toMatchObject({ anonymous: true, name: "阿白", heldAnonymous: false, heldShareUid: false });
    expect(aBai.profileHeldAt).not.toBeNull();
    expect((await t1.me()).profileHeld).toBe(true);

    const cases = (await openCases()).cases;
    expect(cases).toHaveLength(1);
    // the admin sees what 阿白 had chosen, and that it is held
    expect(cases[0]).toMatchObject({ targetId: t1.id, reporters: 3, name: "阿白", anonymous: false, heldAt: expect.any(Number) });
    expect(cases[0].reports.map((r) => r.reason)).toEqual(["name", "contact", "impersonate"]);
    expect(cases[0].reports.map((r) => r.name)).toEqual(["阿白", "阿白", "阿白"]);
    await settleCase(t1.id, "dismiss");
    expect((await openCases()).cases).toEqual([]);
    expect(await userRow(t1.id)).toMatchObject({ anonymous: false, name: "阿白", profileHeldAt: null, heldAnonymous: null });
    expect((await t1.me()).profileHeld).toBe(false);
    await expect(settleCase(t1.id, "ban")).rejects.toThrow("测试玩家");
  });

  it("holds a profile for three different players reporting what it says, never counting spam, minors or 其他", async () => {
    const troll = await signUp("troll@example.com");
    await troll.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "小坏", games: ["arknights"] });
    await troll.placeRoach({ kind: "main" }, TOKYO);
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await aged(me.id, ...(await Promise.all(["t1", "t2", "t3", "t4", "t5"].map(async (k) => (await demo(k)).id))));
    const reportBy = async (p: Player, at: LngLat, reason: string, note = "") => {
      await troll.touch((await publicAt(troll, at)).id, true);
      const [item] = (await p.inbox()).filter((i) => i.kind === "touch");
      await p.report(item.id, reason, note);
    };
    const held = async () => Boolean((await userRow(troll.id)).profileHeldAt);
    await reportBy(me, PEOPLES_SQUARE, "name");
    await reportBy(await demo("t2"), tester("t2").roaches[0], "spam");
    await reportBy(await demo("t3"), tester("t3").roaches[0], "minor");
    await reportBy(await demo("t4"), tester("t4").roaches[0], "other", "一直碰我");
    await reportBy(await demo("t5"), tester("t5").roaches[0], "contact");
    expect(await held()).toBe(false);
    await reportBy(await demo("t1"), tester("t1").roaches[0], "impersonate");
    expect(await held()).toBe(true);
    expect(await userRow(troll.id)).toMatchObject({ anonymous: true, name: "小坏", heldAnonymous: false });
  });

  it("hides a held name and UIDs from everyone and locks them in 资料, until the admin lets them out", async () => {
    const troll = await signUp("troll@example.com");
    await troll.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "小坏",
      games: ["arknights"],
      uid: { arknights: "12345678", endfield: "" },
      uidServer: { arknights: "cn", endfield: "" },
      shareUid: true,
    });
    await troll.placeRoach({ kind: "main" }, TOKYO);
    await troll.declare({ template: "myname", game: "arknights" } as Declaration);
    // 阿白 has a clone in Tokyo: touched boldly by 小坏, and in reach of 小坏's declaration
    const t1 = await demo("t1");
    await troll.touch((await publicAt(troll, tester("t1").roaches[1])).id, true);
    const seen = async () => {
      const items = await t1.inbox();
      const touch = items.find((i) => i.kind === "touch");
      const said = items.find((i) => i.kind === "declaration" && i.text.endsWith("我要玩明日方舟"));
      return {
        name: touch?.kind === "touch" ? touch.from?.displayName : null,
        uid: touch?.kind === "touch" ? touch.from?.uid : null,
        said: said?.kind === "declaration" ? said.text : null,
      };
    };
    expect(await seen()).toEqual({ name: "小坏", uid: { arknights: "12345678" }, said: "我是小坏，我要玩明日方舟" });

    await safety.holdProfile(troll.id);
    expect(await seen()).toEqual({ name: "匿名舟P", uid: undefined, said: "我是匿名舟P，我要玩明日方舟" });
    // holding again keeps what they had chosen
    await safety.holdProfile(troll.id);
    expect(await userRow(troll.id)).toMatchObject({ heldAnonymous: false, heldShareUid: true });

    const held = (await troll.me()).profile;
    expect(held).toMatchObject({ anonymous: true, name: "小坏", shareUid: false, uid: { arknights: "12345678" } });
    const locked = "站长看过之前先改不了";
    await expect(troll.saveProfile({ ...held, name: "小好" })).rejects.toThrow(locked);
    await expect(troll.saveProfile({ ...held, anonymous: false })).rejects.toThrow(locked);
    await expect(troll.saveProfile({ ...held, drPrefix: true })).rejects.toThrow(locked);
    await expect(troll.saveProfile({ ...held, uid: { arknights: "87654321", endfield: "" } })).rejects.toThrow(locked);
    await expect(troll.saveProfile({ ...held, uidServer: { arknights: "bili", endfield: "" } })).rejects.toThrow(locked);
    await expect(troll.saveProfile({ ...held, shareUid: true })).rejects.toThrow(locked);
    await troll.saveProfile({ ...held, avatar: "imp", color: "red" });
    // a game left out meanwhile keeps its UID for the admin
    await troll.saveProfile({ ...held, avatar: "imp", color: "red", games: ["endfield"] });
    expect((await troll.me()).profile).toMatchObject({ avatar: "imp", color: "red", games: ["endfield"], uid: { arknights: "12345678" } });
    await troll.saveProfile({ ...held, avatar: "imp", color: "red" });
    await expect(troll.declare({ template: "myname", game: "arknights" } as Declaration)).rejects.toThrow("站长看过之前先发不了这句");

    // nothing wrong after all: everything as it was, and editable again
    await settleCase(troll.id, "dismiss");
    expect(await seen()).toEqual({ name: "小坏", uid: { arknights: "12345678" }, said: "我是小坏，我要玩明日方舟" });
    const back = await troll.me();
    expect(back.profileHeld).toBe(false);
    expect(back.profile).toMatchObject({ anonymous: false, name: "小坏", shareUid: true, avatar: "imp" });
    await troll.saveProfile({ ...back.profile, name: "小好" });
  });

  it("clears a name for good: that player cannot take it again however it is spelt, anyone else can", async () => {
    const troll = await signUp("troll@example.com");
    await troll.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "小坏",
      games: ["arknights"],
      uid: { arknights: "12345678", endfield: "" },
      uidServer: { arknights: "cn", endfield: "" },
      shareUid: true,
    });
    await troll.placeRoach({ kind: "main" }, TOKYO);
    await troll.declare({ template: "myname", game: "arknights" } as Declaration);
    await safety.holdProfile(troll.id);
    await settleCase(troll.id, "clearName");

    const after = await troll.me();
    // the UID was never the problem, so sharing it comes back
    expect(after.profile).toMatchObject({ name: "", anonymous: true, shareUid: true, uid: { arknights: "12345678" } });
    expect(after.profileHeld).toBe(false);
    const said = (await (await demo("t1")).inbox()).find((i) => i.kind === "declaration");
    expect(said).toMatchObject({ text: "我是匿名舟P，我要玩明日方舟" });
    for (const name of ["小坏", " 小 坏 ", "小-坏!"]) {
      await expect(troll.saveProfile({ ...after.profile, anonymous: false, name })).rejects.toThrow("这个名字被站长清掉过");
    }
    // kept behind 匿名 too, as the name is kept
    await expect(troll.saveProfile({ ...after.profile, anonymous: true, name: "小坏" })).rejects.toThrow("这个名字被站长清掉过");
    await troll.saveProfile({ ...after.profile, anonymous: false, name: "小好" });
    await me.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "小坏" });
  });

  it("clears the UIDs alone or the name and UIDs both, and keeps cleared UIDs off that account", async () => {
    const troll = await signUp("troll@example.com");
    const before: Profile = {
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "小坏",
      games: ["arknights", "endfield"],
      uid: { arknights: "12345678", endfield: "998877" },
      uidServer: { arknights: "cn", endfield: "cn" },
      shareUid: true,
    };
    await troll.saveProfile(before);
    await safety.holdProfile(troll.id);
    await settleCase(troll.id, "clearUid");
    const after = (await troll.me()).profile;
    // the name was never the problem: it shows again, and the servers stay picked
    expect(after).toMatchObject({
      name: "小坏",
      anonymous: false,
      shareUid: true,
      uid: { arknights: "", endfield: "" },
      uidServer: { arknights: "cn", endfield: "cn" },
    });
    const gone = "这个 UID 被站长清掉过";
    await expect(troll.saveProfile({ ...after, uid: { arknights: "12345678", endfield: "" } })).rejects.toThrow(gone);
    await expect(troll.saveProfile({ ...after, uid: { arknights: "", endfield: "998877" } })).rejects.toThrow(gone);
    await troll.saveProfile({ ...after, uid: { arknights: "11112222", endfield: "" } });
    await me.saveProfile({ ...before, name: "我" });

    await safety.holdProfile(troll.id);
    await settleCase(troll.id, "clearBoth");
    const both = (await troll.me()).profile;
    expect(both).toMatchObject({ name: "", anonymous: true, uid: { arknights: "", endfield: "" } });
    await expect(troll.saveProfile({ ...both, anonymous: false, name: "小坏" })).rejects.toThrow("这个名字被站长清掉过");
    await expect(troll.saveProfile({ ...both, uid: { arknights: "11112222", endfield: "" } })).rejects.toThrow(gone);
    const kept = await db.select({ kind: clearedValues.kind, value: clearedValues.value }).from(clearedValues);
    expect(kept.map((k) => `${k.kind}:${k.value}`).sort()).toEqual(["name:小坏", "uid:11112222", "uid:12345678", "uid:998877"]);
    // they go with the account
    await deleteAccount((await userRow(troll.id))!);
    expect(await db.$count(clearedValues)).toBe(0);
  });

  it("asks a report for 其他 to say what happened, before anything is filed or blocked", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const t1 = await demo("t1");
    await t1.touch((await publicAt(t1, PEOPLES_SQUARE)).id, true);
    const [touch] = await me.inbox();
    await expect(me.report(touch.id, "other")).rejects.toThrow("写一句是什么事");
    await expect(me.report(touch.id, "other", " 啊 ")).rejects.toThrow("写一句是什么事");
    expect(await db.$count(reports)).toBe(0);
    expect(await me.blocks()).toEqual([]);
    await me.report(touch.id, "other", "一直跟着");
    expect(await db.$count(reports)).toBe(1);
  });

  it("shows the admin what a reported player wrote about themselves, UIDs included, and what came of reports before", async () => {
    const troll = await signUp("troll@example.com");
    await troll.saveProfile({
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "小坏",
      drPrefix: true,
      games: ["arknights", "endfield"],
      uid: { arknights: "12345678", endfield: "" },
      uidServer: { arknights: "bili", endfield: "" },
      shareUid: true,
    });
    await troll.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await troll.placeRoach({ kind: "clone" }, TOKYO);
    await me.placeRoach({ kind: "main" }, { lng: 121.5, lat: 31.25 });
    await troll.touch((await publicAt(troll, { lng: 121.5, lat: 31.25 })).id, true);
    await me.report((await me.inbox())[0].id, "spam");

    const [c] = (await openCases()).cases;
    expect(c).toMatchObject({
      name: "小坏",
      drPrefix: true,
      email: "troll@example.com",
      games: [
        { game: "arknights", uid: "12345678", server: "B服", favourites: [] },
        { game: "endfield", uid: "", server: "", favourites: [] },
      ],
      shareUid: true,
      // its clone's
      badges: ["异卵同生"],
      worn: null,
      roaches: { main: true, clones: 1 },
      friends: 0,
      blockedBy: 1,
      heldAt: null,
      settled: { dismissed: 0, nameCleared: 0, uidCleared: 0 },
    });
    // never where its roaches are
    expect(JSON.stringify(c)).not.toMatch(/121\.47|139\.7|lng|lat/);

    // dismissed, then reported again by someone else: the admin sees the dismissal
    await settleCase(troll.id, "dismiss");
    const t2 = await demo("t2");
    await troll.touch((await publicAt(troll, tester("t2").roaches[0])).id, false);
    await t2.report((await t2.inbox()).find((i) => i.kind === "touch")!.id, "other", "一直碰我");
    const [again] = (await openCases()).cases;
    expect(again).toMatchObject({ reporters: 1, blockedBy: 2, settled: { dismissed: 1, nameCleared: 0, uidCleared: 0 } });
  });

  it("bans every way of writing the banned mailbox", async () => {
    const banned = {
      "a.b+x@gmail.com": ["ab@gmail.com", "a.b@googlemail.com", "AB+y@Gmail.com", " a.b+x@gmail.com "],
      "c+1@example.com": ["c@example.com", "c+2@example.com"],
    };
    for (const email of Object.keys(banned)) await settleCase((await signUp(email)).id, "ban");
    for (const email of Object.values(banned).flat()) expect(await isBanned(email), email).toBe(true);
    for (const email of ["a.b@example.com", "c@gmail.com", "abc@gmail.com", "me@example.com"]) expect(await isBanned(email), email).toBe(false);
    expect(mailboxForms(" A.B+x@GoogleMail.com ")).toEqual(["a.b+x@googlemail.com", "ab@gmail.com"]);
    expect(mailboxForms("+x@example.com")).toEqual(["+x@example.com"]);
    expect(mailboxForms("c@example.com")).toEqual(["c@example.com"]);
    expect(JSON.stringify(await db.select().from(bannedEmails))).not.toMatch(/gmail|example/);
  });

  it("bans an account: deletes it and refuses its email from then on", async () => {
    const troll = await signUp("troll@example.com");
    await troll.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "main" }, TOKYO);
    await troll.touch((await publicAt(troll, TOKYO)).id, false);
    await me.report((await me.inbox())[0].id, "spam");

    await settleCase(troll.id, "ban");
    expect(await db.select().from(users).where(eq(users.id, troll.id))).toEqual([]);
    expect(await db.$count(reports)).toBe(0);
    expect(await isBanned("troll@example.com")).toBe(true);
    expect(await isBanned("me@example.com")).toBe(false);
    expect(JSON.stringify(await db.select().from(bannedEmails))).not.toContain("troll");
  });

  // ---- report handling: settling, telling both sides, reliable reporters ----

  /** n players of their own, each with a main roach at a spot nobody else's is on, for the reported to touch */
  let spots = 0;
  async function players(n: number, prefix = "r") {
    const out: { p: Player; at: LngLat }[] = [];
    for (let i = 0; i < n; i++) {
      const p = await signUp(`${prefix}${i}@example.com`);
      const at = { lng: 100 + (spots % 40) * 0.5, lat: 20 + Math.floor(spots / 40) * 0.5 };
      spots++;
      await p.placeRoach({ kind: "main" }, at);
      out.push({ p, at });
    }
    return out;
  }

  /** A reporter's report of someone, by the bold touch that someone gave them */
  async function reportedBy(target: Player, reporter: { p: Player; at: LngLat }, reason: string, note = "") {
    await target.touch((await publicAt(target, reporter.at)).id, true);
    const [item] = (await reporter.p.inbox()).filter((i) => i.kind === "touch");
    await reporter.p.report(item.id, reason, note);
  }

  /** A player who touches others: named, with a main roach */
  async function troll(email = "troll@example.com") {
    const t = await signUp(email);
    await t.saveProfile({ ...EMPTY_PROFILE, anonymous: false, name: "小坏", games: ["arknights"] });
    await t.placeRoach({ kind: "main" }, TOKYO);
    return t;
  }

  const staffTexts = async (p: Player) => (await p.inbox()).flatMap((i) => (i.kind === "staff" ? [i.text] : []));
  const monthDay = (t: number) => beijingDate(t).slice(5).replace(/^0/, "").replace("-0", "/").replace("-", "/");

  it("tells both sides how a case was settled, once to each reporter, never who reported or how many", async () => {
    const bad = await troll();
    const [a, b] = await players(2);
    await reportedBy(bad, a, "spam");
    await reportedBy(bad, b, "spam");
    // the same reporter twice in one case (as before reports were kept to one an open case) hears once
    const [first] = await db.select().from(reports).where(eq(reports.reporterId, a.p.id));
    await db.insert(reports).values({ ...first, id: undefined, reason: "other", note: "又来了", createdAt: new Date(first.createdAt.getTime() + 1000) });
    await settleCase(bad.id, "warn");

    const day = monthDay(first.createdAt.getTime());
    expect(await staffTexts(a.p)).toEqual([`站长看过你 ${day} 举报的那位舟P（骚扰刷屏）了：已经处理了，谢谢你。`]);
    expect(await staffTexts(b.p)).toHaveLength(1);
    expect(await staffTexts(bad)).toEqual(["因为社区守则里「不能骚扰别人」这一条，站长提醒你一次，记一张黄牌。90 天内 3 张黄牌可能会被封号。"]);
    for (const p of [a.p, b.p, bad]) expect(JSON.stringify(await p.inbox())).not.toMatch(/小坏|r0@|r1@|2 个人|两个人/);
    expect(await userRow(a.p.id)).toMatchObject({ reportsUpheld: 1, reportsDismissed: 0 });
    expect(await userRow(b.p.id)).toMatchObject({ reportsUpheld: 1, reportsDismissed: 0 });
    expect(await db.select({ action: modActions.action, rule: modActions.rule, yellow: modActions.yellow }).from(modActions)).toEqual([
      { action: "warn", rule: "harass", yellow: true },
    ]);

    // read: no longer counted as new
    const [note] = (await bad.inbox()).filter((i) => i.kind === "staff");
    expect(note.seen).toBe(false);
    await bad.markSeen([note.id]);
    expect((await bad.inbox()).find((i) => i.kind === "staff")!.seen).toBe(true);
  });

  it("tells the reporters nothing was wrong when dismissed, and the reported player only of a hold let out", async () => {
    const bad = await troll();
    const [a] = await players(1);
    await reportedBy(bad, a, "name");
    await settleCase(bad.id, "dismiss");
    expect(await staffTexts(a.p)).toEqual([expect.stringMatching(/了：这次没发现违规。TA 已经被你拉黑了，不会再打扰你。$/)]);
    expect(await staffTexts(bad)).toEqual([]);
    expect(await userRow(a.p.id)).toMatchObject({ reportsUpheld: 0, reportsDismissed: 1 });

    await safety.holdProfile(bad.id);
    expect(await staffTexts(bad)).toEqual(["有人举报了你的名字或 UID，站长看过之前先藏起来了，也暂时改不了。没问题的话会恢复。"]);
    await settleCase(bad.id, "dismiss");
    expect(await staffTexts(bad)).toContain("站长看过了，你的名字和 UID 没问题，已经恢复。");
  });

  it("counts yellow cards over 90 days, and says so on the case at three", async () => {
    const bad = await troll();
    const reporters = await players(4);
    for (const r of reporters.slice(0, 3)) {
      await reportedBy(bad, r, "spam");
      await settleCase(bad.id, "warn");
    }
    await reportedBy(bad, reporters[3], "spam");
    expect(((await openCases()).cases)[0]).toMatchObject({ yellow: 3, settled: { warned: 3, dismissed: 0 } });
    await db.execute(sql`update ${modActions} set ${sql.identifier("created_at")} = now() - interval '91 days' where ${modActions.id} = (select min(${modActions.id}::text)::uuid from ${modActions})`);
    expect(((await openCases()).cases)[0].yellow).toBe(2);
  });

  it("pauses a player for seven days, and lets the reports' own pause go when the admin looks", async () => {
    const bad = await troll();
    const [a, b] = await players(2);
    await reportedBy(bad, a, "spam");
    await settleCase(bad.id, "suspend");
    const until = (await userRow(bad.id)).suspendedUntil!.getTime();
    expect(until).toBeGreaterThan(Date.now() + 7 * 86_400_000 - 60_000);
    expect((await bad.me()).suspendedUntil).toBe(until);
    expect(await staffTexts(bad)).toEqual([
      expect.stringMatching(/^因为社区守则里「不能骚扰别人」这一条，站长暂停了你的互动，到 \d+ 月 \d+ 日。这期间你还能看地图和消息，但不能碰人、发宣言、回应、戳一戳和做客。$/),
    ]);

    // a new account two reliable players report for spam: paused by the reports, until the admin looks
    const fresh = await signUp("new@example.com");
    await fresh.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const [c, d] = await players(2, "s");
    await aged(c.p.id, d.p.id);
    await reportedBy(fresh, c, "spam");
    expect((await userRow(fresh.id)).suspendedUntil).toBeNull();
    await reportedBy(fresh, d, "spam");
    expect(await userRow(fresh.id)).toMatchObject({ suspendedAuto: true });
    expect(await staffTexts(fresh)).toEqual(["有人举报你骚扰，站长看过之前先暂停你的互动，最长 7 天。"]);
    expect(((await openCases()).cases).find((x) => x.targetId === fresh.id)).toMatchObject({ suspendedAuto: true });
    await settleCase(fresh.id, "dismiss");
    expect(await userRow(fresh.id)).toMatchObject({ suspendedUntil: null, suspendedAuto: false });
    expect(await staffTexts(fresh)).toContain("站长看过了，没发现问题，你的互动恢复了。");
    // the auto pause is in the record, apart from the admin's own doings
    expect((await db.select().from(modActions).where(eq(modActions.userId, fresh.id))).map((m) => [m.action, m.auto])).toEqual([
      ["suspend", true],
      ["dismiss", false],
    ]);
    void b;
  });

  it("asks a player to say again they are 18 or older, without telling them in 消息", async () => {
    const bad = await troll();
    const [a] = await players(1);
    await reportedBy(bad, a, "minor");
    await settleCase(bad.id, "ageCheck");
    expect((await bad.me()).ageCheck).toBe(true);
    expect(await staffTexts(bad)).toEqual([]);
    expect(await db.select({ rule: modActions.rule }).from(modActions)).toEqual([{ rule: "age" }]);
    await reportedBy(bad, (await players(1, "q"))[0], "spam");
    expect(((await openCases()).cases)[0].ageCheckAt).toEqual(expect.any(Number));
    await confirmAge(bad.id);
    expect((await bad.me()).ageCheck).toBe(false);
    expect(((await openCases()).cases)[0]).toMatchObject({ ageCheckAt: null, settled: { ageChecks: 1 } });
  });

  it("counts only reliable reporters: new accounts and those often found wrong hold nothing", async () => {
    const bad = await troll();
    const rs = await players(7);
    for (const r of rs.slice(0, 3)) await reportedBy(bad, r, "name");
    expect((await userRow(bad.id)).profileHeldAt).toBeNull();
    // several new accounts within the hour: maybe a pile-on
    expect(((await openCases()).cases)[0]).toMatchObject({ reporters: 3, reliable: 0, brigade: true });

    await aged(...rs.slice(3).map((r) => r.p.id));
    await db.update(users).set({ reportsDismissed: 3, reportsUpheld: 1 }).where(eq(users.id, rs[5].p.id));
    for (const r of rs.slice(3, 6)) await reportedBy(bad, r, "contact");
    expect((await userRow(bad.id)).profileHeldAt).toBeNull();
    expect(((await openCases()).cases)[0]).toMatchObject({ reporters: 6, reliable: 2 });
    expect(((await openCases()).cases)[0].reports.map((r) => r.reporter?.reliable)).toEqual([false, false, false, true, true, false]);
    await reportedBy(bad, rs[6], "impersonate");
    expect((await userRow(bad.id)).profileHeldAt).not.toBeNull();
  });

  it("puts red cases first, then yellow, then green, and lists one blocked by many until the admin looks", async () => {
    const [red, yellow, green] = [await troll("red@example.com"), await troll("yellow@example.com"), await troll("green@example.com")];
    const rs = await players(3);
    await reportedBy(green, rs[0], "name");
    await reportedBy(yellow, rs[1], "spam");
    await reportedBy(red, rs[2], "minor");
    expect(((await openCases()).cases).map((c) => [c.targetId, c.level])).toEqual([
      [red.id, "red"],
      [yellow.id, "yellow"],
      [green.id, "green"],
    ]);
    await settleCases([red.id, yellow.id, green.id], "dismiss");
    await expect(settleCases([red.id], "ban")).rejects.toThrow("不能批量");
    expect((await openCases()).cases).toEqual([]);
    // each one settled on its own, and each reporter told
    for (const r of rs) expect(await staffTexts(r.p)).toEqual([expect.stringContaining("这次没发现违规")]);

    // blocked by ten different players in a week, with no report: a case of its own
    const lonely = await signUp("lonely@example.com");
    const blockers = await Promise.all(Array.from({ length: 12 }, (_, i) => signUp(`b${i}@example.com`)));
    const block = (from: Player[], at = new Date()) => db.insert(blocks).values(from.map((b) => ({ blockerId: b.id, blockedId: lonely.id, createdAt: at })));
    await block(blockers.slice(0, 10));
    expect((await openCases()).cases).toMatchObject([{ targetId: lonely.id, level: "yellow", reports: [], blockedRecently: 10 }]);
    await settleCase(lonely.id, "dismiss");
    expect((await openCases()).cases).toEqual([]);
    // again only after ten more since the admin looked
    await db.delete(blocks).where(eq(blocks.blockedId, lonely.id));
    await block(blockers.slice(0, 9), new Date(Date.now() + 1000));
    expect((await openCases()).cases).toEqual([]);
    await block(blockers.slice(9, 10), new Date(Date.now() + 1000));
    expect((await openCases()).cases).toMatchObject([{ targetId: lonely.id, blockedRecently: 10 }]);
  });

  // ---- reports of a roach's spot on the map, the queue a page at a time, appeals ----

  /** The roach the viewer's map shows at a spot, by the id the feed gave it */
  const feedId = async (viewer: Player, at: LngLat) => (await publicAt(viewer, at)).id;
  const OSAKA = { lng: 135.5, lat: 34.69 };

  it("files a roach's spot without blocking anyone, once a roach while open, within the day's ten reports", async () => {
    const owner = await troll();
    const [a] = await players(1);
    await owner.touch(await feedId(owner, a.at), true);
    const before = { owner: await owner.inbox(), a: await a.p.inbox() };
    const id = await feedId(a.p, TOKYO);
    await expect(a.p.reportRoach(id, "spam")).rejects.toThrow("举报理由");
    await a.p.reportRoach(id, "place", "  学校门口  ");
    const [main] = await db.select().from(roaches).where(eq(roaches.userId, owner.id));
    expect(await db.select().from(reports)).toMatchObject([
      {
        reporterId: a.p.id,
        targetId: owner.id,
        reason: "place",
        note: "学校门口",
        context: "地图上的蟑螂（本体）",
        targetName: "小坏",
        roachId: main.id,
        placeLng: TOKYO.lng,
        placeLat: TOKYO.lat,
        roachSlot: 0,
        nearM: null,
      },
    ]);
    // nobody blocked: both still see all they saw, and the touch can still be answered
    expect(await db.$count(blocks)).toBe(0);
    expect(await owner.inbox()).toEqual(before.owner);
    expect(await a.p.inbox()).toEqual(before.a);

    // once a roach while its report is open, even after it moved (a new id on the map)
    await a.p.reportRoach(id, "pattern");
    await owner.placeRoach({ kind: "move", roachId: main.id }, OSAKA);
    await expect(a.p.reportRoach(id, "place")).rejects.toThrow("这只蟑螂已经挪走了。");
    await a.p.reportRoach(await feedId(a.p, OSAKA), "stalk");
    expect(await db.$count(reports)).toBe(1);

    // nobody's own roach, nor a guide, nor a show roach
    await expect(owner.reportRoach(await feedId(a.p, OSAKA), "place")).rejects.toThrow("这是你自己的蟑螂。");
    await expect(a.p.reportRoach(AMIYA_ID, "place")).rejects.toThrow("是站里的向导，不用举报。");

    // the day's ten are shared with reports of players
    await db.insert(reports).values(
      Array.from({ length: 9 }, () => ({ reporterId: a.p.id, targetId: owner.id, reason: "spam", context: "x", targetName: "x" })),
    );
    const other = await signUp("other@example.com");
    await other.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await expect(a.p.reportRoach(await feedId(a.p, PEOPLES_SQUARE), "place")).rejects.toThrow("今天举报得够多了");
    await other.touch(await feedId(other, a.at), true);
    const [touch] = (await a.p.inbox()).filter((i) => i.kind === "touch" && i.id !== before.a[0]?.id);
    await expect(a.p.report(touch.id, "spam")).rejects.toThrow("今天举报得够多了");
  });

  it("keeps how far a 「一直贴着我放」 roach was from the reporter's nearest one, never where that is", async () => {
    const owner = await troll();
    const near = { lng: 116.4, lat: 39.9 };
    const far = { lng: 116.4, lat: 30 };
    const reporter = await signUp("near@example.com");
    await reporter.placeRoach({ kind: "main" }, far);
    await reporter.placeRoach({ kind: "clone" }, { lng: 116.4, lat: 39.9009 });
    await owner.placeRoach({ kind: "clone" }, near);
    await reporter.reportRoach(await feedId(reporter, near), "stalk");
    const nobody = await signUp("nobody@example.com");
    await nobody.reportRoach(await feedId(nobody, near), "stalk");
    const rows = await db.select().from(reports).orderBy(reports.createdAt);
    expect(rows.map((r) => [r.nearM, r.roachSlot, r.context])).toEqual([
      [Math.round(distanceKm(near, { lng: 116.4, lat: 39.9009 }) * 1000), 1, "地图上的蟑螂（克隆体）"],
      [null, 1, "地图上的蟑螂（克隆体）"],
    ]);
    expect(rows[0].nearM).toBe(100);
    expect(JSON.stringify(rows)).not.toContain("39.9009");
  });

  it("keeps a roach's case apart from its owner's, so settling one never settles or tells of the other", async () => {
    const bad = await troll();
    const [a, b] = await players(2);
    await reportedBy(bad, a, "spam");
    await b.p.reportRoach(await feedId(b.p, TOKYO), "place");
    const [main] = await db.select().from(roaches).where(eq(roaches.userId, bad.id));
    expect(await reportCounts()).toEqual({ open: 2, urgent: 1, appeals: 0 });

    let cases = (await openCases()).cases;
    expect(cases.map((c) => [c.kind, c.caseId, c.level])).toEqual([
      ["roach", `roach:${main.id}`, "red"],
      ["person", bad.id, "yellow"],
    ]);
    expect(cases[0]).toMatchObject({
      targetId: bad.id,
      name: "小坏",
      rule: "roach",
      reporters: 1,
      roach: { main: true, lng: TOKYO.lng, lat: TOKYO.lat, state: "here" },
      reports: [{ reason: "place", context: "地图上的蟑螂（本体）", place: TOKYO, nearM: null }],
    });
    // the owner's info box, as in their own case, and never where their other roaches are
    expect(cases[0].roaches).toEqual({ main: true, clones: 0 });
    expect(cases[1].reports).toHaveLength(1);

    // the roach first: the player's case stays open, its reporter hears nothing
    await settleCase(cases[0].caseId, "warn");
    cases = (await openCases()).cases;
    expect(cases.map((c) => c.kind)).toEqual(["person"]);
    const day = monthDay(Date.now());
    expect(await staffTexts(b.p)).toEqual([`站长看过你 ${day} 举报的那只蟑螂（放在学校、别人家门口等不合适的地方）了：已经处理了，谢谢你。`]);
    expect(await staffTexts(a.p)).toEqual([]);
    expect(await staffTexts(bad)).toEqual(["因为社区守则里「蟑螂不能放在不合适的地方」这一条，站长提醒你一次，记一张黄牌。90 天内 3 张黄牌可能会被封号。"]);

    // then the player's: the roach's reporter is not told again
    await b.p.reportRoach(await feedId(b.p, TOKYO), "pattern");
    await settleCase(bad.id, "dismiss");
    expect((await openCases()).cases.map((c) => c.kind)).toEqual(["roach"]);
    expect(await staffTexts(b.p)).toHaveLength(1);
    expect(await staffTexts(a.p)).toEqual([expect.stringContaining("那位舟P（骚扰刷屏）了：这次没发现违规")]);

    // moved since, then gone: the case goes on per report, and there is nothing left to take back
    await bad.placeRoach({ kind: "move", roachId: main.id }, OSAKA);
    expect((await openCases()).cases[0].roach).toMatchObject({ state: "moved", lng: TOKYO.lng });
    await bad.removeRoach(main.id);
    const [gone] = (await openCases()).cases;
    const [report] = await db.select().from(reports).where(eq(reports.reason, "pattern"));
    expect(gone).toMatchObject({ kind: "roach", caseId: `report:${report.id}`, roach: { state: "gone" } });
    await expect(settleCase(gone.caseId, "removeRoach")).rejects.toThrow("已经收回了");
    await expect(settleCase(gone.caseId, "suspend")).rejects.toThrow("蟑螂的举报只能");
    await expect(settleCase(bad.id, "removeRoach")).rejects.toThrow("只用在地图上蟑螂的举报");
    await settleCase(gone.caseId, "dismiss");
    expect(await staffTexts(b.p)).toEqual([expect.stringContaining("（好几只摆成字或图案）了：这次没发现问题。"), expect.stringContaining("已经处理了")]);
    expect((await openCases()).cases).toEqual([]);
    expect(await userRow(b.p.id)).toMatchObject({ reportsUpheld: 1, reportsDismissed: 1 });
  });

  it("takes a reported roach back as its owner would: a clone alone, the main roach with its clones, a yellow card each", async () => {
    const bad = await troll();
    await bad.placeRoach({ kind: "clone" }, OSAKA);
    await bad.placeRoach({ kind: "clone" }, PEOPLES_SQUARE);
    const [a] = await players(1);
    await a.p.reportRoach(await feedId(a.p, OSAKA), "pattern");
    const [clone] = (await openCases()).cases;
    expect(clone.roach?.main).toBe(false);
    await settleCase(clone.caseId, "removeRoach");
    const left = await db.select({ slot: roaches.slot, lng: roaches.lng }).from(roaches).where(eq(roaches.userId, bad.id));
    expect(left.map((r) => r.lng).sort()).toEqual([PEOPLES_SQUARE.lng, TOKYO.lng].sort());
    expect(await staffTexts(bad)).toEqual(["因为社区守则里「蟑螂不能放在不合适的地方」这一条，站长把你的一只克隆体收回到你手里了，记一张黄牌。"]);
    expect(await db.select({ resolution: reports.resolution }).from(reports)).toEqual([{ resolution: "roach_removed" }]);
    expect(await db.select({ action: modActions.action, yellow: modActions.yellow, rule: modActions.rule }).from(modActions)).toEqual([
      { action: "removeRoach", yellow: true, rule: "roach" },
    ]);

    await a.p.reportRoach(await feedId(a.p, TOKYO), "place");
    const [main] = (await openCases()).cases;
    expect(main.roach?.main).toBe(true);
    await settleCase(main.caseId, "removeRoach");
    expect(await db.$count(roaches, eq(roaches.userId, bad.id))).toBe(0);
    expect((await staffTexts(bad))[0]).toBe("因为社区守则里「蟑螂不能放在不合适的地方」这一条，站长把你的一只本体收回到你手里了，记一张黄牌。");
    expect((await bad.me()).roaches).toEqual([]);
    // two yellow cards on the next case about them
    await db.insert(reports).values({ reporterId: a.p.id, targetId: bad.id, reason: "spam", context: "x", targetName: "x" });
    expect((await openCases()).cases[0]).toMatchObject({ yellow: 2, settled: { roachesRemoved: 2 } });
  });

  it("lets the admin take back roaches straight from the map, one or every other one near a spot, with one card each", async () => {
    // two players spelling something out by 人民广场 (main roaches in Tokyo), and the admin's own roach among them
    const step = (i: number) => ({ lng: PEOPLES_SQUARE.lng + i * 0.0005, lat: PEOPLES_SQUARE.lat });
    const bad = await troll();
    const worse = await troll("worse@example.com");
    await bad.placeRoach({ kind: "clone" }, step(1));
    await bad.placeRoach({ kind: "clone" }, step(2));
    await worse.placeRoach({ kind: "clone" }, step(3));
    const admin = await signUp("admin-map@example.com");
    await admin.placeRoach({ kind: "main" }, step(4));

    // one: a clone alone goes, the owner told once
    expect(await takeBackRoaches(admin.id, [await feedId(admin, step(1))], "roach")).toEqual({ roaches: 1, players: 1 });
    expect(await staffTexts(bad)).toEqual(["因为社区守则里「蟑螂不能放在不合适的地方」这一条，站长把你的一只克隆体收回到你手里了，记一张黄牌。"]);

    // near a spot: everyone's but the admin's own, nearest first, at most 3000 m
    const all = await roachesNear(admin.id, PEOPLES_SQUARE.lng, PEOPLES_SQUARE.lat, 500);
    expect(all.map((r) => r.ownerId)).not.toContain(admin.id);
    expect(all.every((r, i) => r.meters <= 500 && (i === 0 || all[i - 1].meters <= r.meters))).toBe(true);
    // (others of the tests' own players stand by 人民广场 too)
    const near = all.filter((r) => r.ownerId === bad.id || r.ownerId === worse.id);
    expect(near.map((r) => r.ownerId)).toEqual([bad.id, worse.id]);
    expect(await takeBackRoaches(admin.id, near.map((r) => r.id), "roach")).toEqual({ roaches: 2, players: 2 });
    expect(await db.$count(roaches, eq(roaches.userId, admin.id))).toBe(1);
    // the clones only: their main roaches stay in Tokyo
    expect(await db.$count(roaches, eq(roaches.userId, bad.id))).toBe(1);
    expect(await db.$count(roaches, eq(roaches.userId, worse.id))).toBe(1);
    // one yellow card and one notice for each cleaning they were in, never for the admin
    expect(await db.$count(modActions, and(eq(modActions.userId, bad.id), eq(modActions.yellow, true)))).toBe(2);
    expect(await db.$count(modActions, eq(modActions.userId, worse.id))).toBe(1);
    expect(await db.$count(modActions, eq(modActions.userId, admin.id))).toBe(0);
    expect(await staffTexts(worse)).toHaveLength(1);
    // a main roach takes its clones with it, as when its owner takes it back
    await worse.placeRoach({ kind: "clone" }, step(5));
    const worseMain = (await worse.me()).roaches.find((r) => r.slot === 0)!;
    expect(await takeBackRoaches(admin.id, [worseMain.publicId], "roach")).toEqual({ roaches: 2, players: 1 });
    expect(await db.$count(roaches, eq(roaches.userId, worse.id))).toBe(0);
    expect(await db.$count(roaches, eq(roaches.userId, bad.id))).toBe(1);
    // already gone: nothing, and nobody told again
    expect(await takeBackRoaches(admin.id, near.map((r) => r.id), "roach")).toEqual({ roaches: 0, players: 0 });
    await expect(roachesNear(admin.id, 500, 0, 100)).rejects.toThrow("位置不对");
  });

  it("marks every roach of the players with open reports on the admin's map, main and clones, and none once settled", async () => {
    const bad = await troll();
    await bad.placeRoach({ kind: "clone" }, PEOPLES_SQUARE);
    const [a] = await players(1);
    expect(await reportedRoaches()).toEqual([]);
    await reportedBy(bad, a, "name");
    const marks = await reportedRoaches();
    expect(marks.map((m) => [m.main, m.lng]).sort()).toEqual([
      [false, PEOPLES_SQUARE.lng],
      [true, TOKYO.lng],
    ]);
    expect(marks[0]).toMatchObject({ owner: "小坏", reasons: ["名字不合适"] });
    // nobody else's: the reporter's own roach is not marked
    expect(marks.some((m) => m.lng === a.at.lng)).toBe(false);
    await settleCase(bad.id, "dismiss");
    expect(await reportedRoaches()).toEqual([]);
  });

  it("pages the queue fifty at a time in order of colour, with how many there are of each", async () => {
    const targets = await db
      .insert(users)
      .values(Array.from({ length: 120 }, (_, i) => ({ email: `t${i}@example.com` })))
      .returning({ id: users.id });
    const reasons = ["name", "spam", "minor"];
    await db.insert(reports).values(
      targets.map((t, i) => ({
        reporterId: me.id,
        targetId: t.id,
        reason: reasons[i % 3],
        context: "x",
        targetName: "x",
        createdAt: new Date(Date.now() - (200 - i) * 60_000),
      })),
    );
    const pages = await Promise.all([1, 2, 3, 4].map((page) => openCases({ page })));
    expect(pages.map((p) => p.cases.length)).toEqual([50, 50, 20, 0]);
    expect(pages[0]).toMatchObject({ total: 120, levels: { red: 40, yellow: 40, green: 40 }, nameOnly: 40, page: 1 });
    const all = pages.flatMap((p) => p.cases);
    expect(all.map((c) => c.level)).toEqual([...Array(40).fill("red"), ...Array(40).fill("yellow"), ...Array(40).fill("green")]);
    expect(new Set(all.map((c) => c.caseId)).size).toBe(120);
    // within a colour, the one waiting longest first
    for (const level of ["red", "yellow", "green"]) {
      const since = all.filter((c) => c.level === level).map((c) => c.since);
      expect(since).toEqual([...since].sort((x, y) => x - y));
    }
    // filtered on the server
    expect(await openCases({ level: "yellow" })).toMatchObject({ total: 40, levels: { red: 40 } });
    expect((await openCases({ level: "yellow" })).cases.every((c) => c.level === "yellow")).toBe(true);
    expect((await openCases({ reason: "minor", page: 1 })).total).toBe(40);
    expect((await openCases({ nameOnly: true })).cases.every((c) => c.reports.every((r) => r.reason === "name"))).toBe(true);
    expect((await openCases({ reason: "blocks" })).total).toBe(0);
  });

  it("keeps why an account was banned, finds the ban however the address is written, and lets actions go after a year", async () => {
    const bad = await signUp("a.b+x@gmail.com");
    await settleCase(bad.id, "ban", { rule: "contact" });
    expect(await banInfo(" AB@gmail.com ")).toEqual({ banned: { at: expect.any(Number), reason: "contact" }, accounts: [] });
    expect(await banInfo("me@example.com")).toEqual({
      banned: null,
      accounts: [{ id: me.id, email: "me@example.com", name: "", anonymous: expect.any(Boolean), joinedAt: expect.any(Number) }],
    });
    await expect(banInfo("me")).rejects.toThrow("完整的邮箱");

    const other = await troll();
    const DAY_MS = 86_400_000;
    await db.insert(modActions).values([
      { userId: other.id, action: "warn", yellow: true, createdAt: new Date(Date.now() - 366 * DAY_MS) },
      { userId: other.id, action: "warn", yellow: true, createdAt: new Date(Date.now() - 364 * DAY_MS) },
    ]);
    await pruneOldActivity();
    expect((await db.select({ at: modActions.createdAt }).from(modActions)).map((a) => Math.round((Date.now() - a.at.getTime()) / DAY_MS))).toEqual([364]);
  });

  it("lets a player appeal what the admin did once, within 30 days, and tells them the answer", async () => {
    const bad = await troll();
    const [a] = await players(1);
    await reportedBy(bad, a, "spam");
    await settleCase(bad.id, "warn");
    const staffNote = async () => (await bad.inbox()).find((i) => i.kind === "staff" && i.appeal)! as Extract<InboxItem, { kind: "staff" }>;
    const { appeal: open } = await staffNote();
    expect(open).toEqual({ actionId: expect.any(String), state: "open" });
    const actionId = open!.actionId;
    await expect(bad.appeal(actionId, "嗯")).rejects.toThrow("写一句");
    await expect(bad.appeal(actionId, "长".repeat(101))).rejects.toThrow("最多写 100 个字");
    await expect(a.p.appeal(actionId, "不是我的处理")).rejects.toThrow("找不到这次处理了");
    await expect(bad.appeal("nonsense", "我没有刷屏")).rejects.toThrow("找不到这次处理了");
    // the reporter's note has nothing to appeal
    expect((await a.p.inbox()).find((i) => i.kind === "staff")).not.toHaveProperty("appeal");

    await bad.appeal(actionId, "  我没有刷屏，是误会  ");
    await expect(bad.appeal(actionId, "再申诉一次")).rejects.toThrow("已经申诉过了");
    expect((await staffNote()).appeal).toEqual({ actionId, state: "sent" });
    expect(await reportCounts()).toMatchObject({ appeals: 1 });
    const [waiting] = await openAppeals();
    expect(waiting).toMatchObject({ actionId, action: "warn", rule: "harass", appeal: "我没有刷屏，是误会", who: { targetId: bad.id, yellow: 1, name: "小坏" } });

    await answerAppeal(actionId, true);
    await expect(answerAppeal(actionId, false)).rejects.toThrow("已经处理过了");
    expect(await openAppeals()).toEqual([]);
    expect(await reportCounts()).toMatchObject({ appeals: 0 });
    expect((await staffNote()).appeal).toEqual({ actionId, state: "answered" });
    expect(await staffTexts(bad)).toContain("站长看了你的申诉：维持原来的处理。");

    // 30 days on, there is no appealing it
    const [b] = await players(1, "late");
    await reportedBy(bad, b, "spam");
    await settleCase(bad.id, "suspend");
    const [late] = await db.select().from(modActions).where(eq(modActions.action, "suspend"));
    await db.update(modActions).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(modActions.id, late.id));
    await expect(bad.appeal(late.id, "太久以前了")).rejects.toThrow("不能再申诉了");
    // nor the reports' own pause, nor asking for their age
    const auto = await db.insert(modActions).values({ userId: bad.id, action: "suspend", auto: true }).returning();
    const age = await db.insert(modActions).values({ userId: bad.id, action: "ageCheck" }).returning();
    for (const x of [auto[0], age[0]]) await expect(bad.appeal(x.id, "我要申诉")).rejects.toThrow("找不到这次处理了");
  });

  it("undoes each kind of action on appeal as far as it can", async () => {
    const bad = await signUp("bad@example.com");
    const profile: Profile = {
      ...EMPTY_PROFILE,
      anonymous: false,
      name: "小坏",
      games: ["arknights"],
      uid: { ...EMPTY_PROFILE.uid, arknights: "12345678" },
      uidServer: { ...EMPTY_PROFILE.uidServer, arknights: "cn" },
    };
    await bad.saveProfile(profile);
    await bad.placeRoach({ kind: "main" }, TOKYO);
    const reporters = await players(5);
    const undo = async (action: AdminAction, reason: string) => {
      const r = reporters.shift()!;
      await reportedBy(bad, r, reason);
      await settleCase(bad.id, action);
      const [a] = await db.select().from(modActions).where(and(eq(modActions.userId, bad.id), eq(modActions.action, action)));
      await bad.appeal(a.id, "处理错了");
      await answerAppeal(a.id, false);
      expect((await db.select().from(modActions).where(eq(modActions.id, a.id)))[0]).toMatchObject({ appealResult: "reverted" });
      return (await staffTexts(bad))[0];
    };

    expect(await undo("warn", "spam")).toBe("站长看了你的申诉：撤销了这次处理，黄牌不算了。");
    expect(await undo("suspend", "spam")).toBe("站长看了你的申诉：撤销了这次处理，互动恢复了。");
    expect((await userRow(bad.id)).suspendedUntil).toBeNull();

    expect(await undo("clearName", "name")).toBe("站长看了你的申诉：撤销了这次处理，可以再用原来的名字了（要在「我的资料」里重新填上）。");
    expect(await userRow(bad.id)).toMatchObject({ name: "", anonymous: true });
    await bad.saveProfile(profile);
    expect((await userRow(bad.id)).name).toBe("小坏");

    expect(await undo("clearUid", "contact")).toBe("站长看了你的申诉：撤销了这次处理，可以再填原来的 UID 了（要在「我的资料」里重新填上）。");
    await bad.saveProfile(profile);
    expect((await userRow(bad.id)).uidArknights).toBe("12345678");
    expect(await db.$count(clearedValues)).toBe(0);

    // a roach taken back stays taken back; its yellow card goes
    const r = reporters.shift()!;
    await r.p.reportRoach(await feedId(r.p, TOKYO), "place");
    const [roachCase] = (await openCases()).cases;
    await settleCase(roachCase.caseId, "removeRoach");
    const [removed] = await db.select().from(modActions).where(eq(modActions.action, "removeRoach"));
    await bad.appeal(removed.id, "那里不是学校");
    await answerAppeal(removed.id, false);
    expect((await staffTexts(bad))[0]).toBe("站长看了你的申诉：撤销了这次处理，黄牌不算了。");
    expect(await db.$count(roaches, eq(roaches.userId, bad.id))).toBe(0);
    await db.insert(reports).values({ reporterId: r.p.id, targetId: bad.id, reason: "spam", context: "x", targetName: "x" });
    expect((await openCases()).cases[0].yellow).toBe(0);

    // a pause the admin gave later stays when an earlier one is undone; an age question goes
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000), ageCheckAt: new Date() }).where(eq(users.id, bad.id));
    const [old] = await db
      .insert(modActions)
      .values({ userId: bad.id, action: "suspend", until: new Date(Date.now() + 3600_000), appeal: "x", appealedAt: new Date() })
      .returning();
    await answerAppeal(old.id, false);
    expect((await userRow(bad.id)).suspendedUntil).not.toBeNull();
    const [age] = await db.insert(modActions).values({ userId: bad.id, action: "ageCheck", appeal: "x", appealedAt: new Date() }).returning();
    await answerAppeal(age.id, false);
    expect((await userRow(bad.id)).ageCheckAt).toBeNull();
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
    // what the radar read is kept a few minutes: as if they had passed
    forgetRadarBlocks();
    const after = (await me.radar())!;
    expect(after.day.left).toBe(before.day.left + 1);
    expect(after.day.arrived).toBe(before.day.arrived + 1);
    expect(after.day.clones).toBe(before.day.clones + 1);
    expect(after.daily[6].left).toBe(before.daily[6].left + 1);

    // your own moves never show up on your radar
    await me.placeRoach({ kind: "clone" }, { lng: 121.5, lat: 31.3 });
    await rewindScans(me.id);
    forgetRadarBlocks();
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

  it("forgets touches, pokes, declarations and moves older than 90 days, keeping newer ones", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.touch((await publicAt(me, tester("t2").roaches[0])).id, true);
    await me.declare({ template: "birthday" });
    const t2 = await demo("t2");
    expect(await t2.inbox()).toHaveLength(2);

    const poker = await signUp("poker@example.com");
    const pal = await signUp("pal@example.com");
    const ids = await realFriends(poker, pal);
    await db.update(users).set({ sleptAwayOn: beijingDate() }).where(eq(users.id, pal.id));
    await world.poke(poker.id, ids.b);

    // pretend a hundred days pass
    await pruneOldActivity(Date.now() + 100 * 86_400_000);
    expect(await t2.inbox()).toEqual([]);
    expect(await db.select().from(pokes)).toEqual([]);
    expect(await db.select().from(moves)).toEqual([]);
    expect(await db.select().from(deliveries)).toEqual([]);
    // the roaches themselves stay
    expect((await me.me()).roaches).toHaveLength(1);

    await me.touch((await publicAt(me, tester("t1").roaches[0])).id, false);
    await pruneOldActivity();
    expect(await (await demo("t1")).inbox()).toHaveLength(1);
  });

  it("lets who a declaration reached go once it is older than the inbox shows, but not a birthday's to 触须之交", async () => {
    const shouter = await signUp("shout@example.com");
    const sent = async (daysAgo: number, toFriend = false) => {
      const [d] = await db
        .insert(declarations)
        .values({ senderId: shouter.id, template: "launch", game: "arknights", recipients: 1, createdAt: new Date(Date.now() - daysAgo * 86_400_000) })
        .returning({ id: declarations.id });
      await db.insert(deliveries).values({ declarationId: d.id, recipientId: me.id, toFriend });
      return d.id;
    };
    const old = await sent(32);
    const oldBirthday = await sent(33, true);
    const fresh = await sent(29);
    const ancient = await sent(45);
    await pruneOldActivity();
    const left = (await db.select({ id: deliveries.declarationId }).from(deliveries)).map((d) => d.id).sort();
    // the one from 45 days ago is older than the week looked at (an earlier day took it on the live site)
    expect(left).toEqual([oldBirthday, fresh, ancient].sort());
    expect(left).not.toContain(old);
    // the declarations themselves stay
    expect(await db.$count(declarations)).toBe(4);
  });

  it("buckets the declaration head count", () => {
    expect(reachText(0)).toContain("暂时没有");
    expect(reachText(3)).toContain("不到 5 只");
    expect(reachText(7)).toContain("5–10 只");
    expect(reachText(49)).toContain("20–50 只");
    expect(reachText(500)).toContain("50 多只");
  });
});

describe("declarations by where the roaches are", () => {
  const DAY_MS = 86_400_000;
  // north of People's Square: about 5 km, 15 km and 30 km off, and 5 km on from the last
  const NEAR = { lng: 121.4737, lat: 31.2754 };
  const FAR = { lng: 121.4737, lat: 31.3654 };
  const ELSEWHERE = { lng: 121.4737, lat: 31.5004 };
  const ELSEWHERE_NEAR = { lng: 121.4737, lat: 31.5454 };
  const NEAR_FAR = { lng: 121.4837, lat: 31.3654 };

  const declarationItems = async (p: Player) => (await p.inbox()).filter((i) => i.kind === "declaration");
  const declarationIds = async (p: Player) => (await declarationItems(p)).map((i) => i.id);
  const unseen = async (p: Player) => (await declarationItems(p)).filter((i) => !i.seen).map((i) => i.id);
  /** The id of the player's newest declaration, as 消息 names it */
  const latest = async (p: Player) => {
    const mine = await db.select().from(declarations).where(eq(declarations.senderId, p.id));
    return `d:${mine.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0].id}`;
  };
  /** Move one of a player's roaches, past the day's limit on moves */
  const moveTo = (p: Player, slot: number, at: LngLat) =>
    db.update(roaches).set({ lng: at.lng, lat: at.lat }).where(and(eq(roaches.userId, p.id), eq(roaches.slot, slot)));
  /** Declarations sent before now, so another can be sent past the minute between them (their spots keep the same time) */
  const earlier = async (minutes: number) => {
    await db.update(declarations).set({ createdAt: sql`${declarations.createdAt} - make_interval(mins => ${minutes})` });
    await db.update(declarationSpots).set({ createdAt: sql`${declarationSpots.createdAt} - make_interval(mins => ${minutes})` });
  };
  /** A declaration by the sender from these spots, sent this long ago, as declare() keeps it */
  const sentFrom = async (sender: Player, from: LngLat[], ago: number) => {
    const [d] = await db
      .insert(declarations)
      .values({ senderId: sender.id, template: "launch", game: "arknights", recipients: 0, createdAt: new Date(Date.now() - ago) })
      .returning();
    await db.insert(declarationSpots).values(spotRows(d, from));
    return `d:${d.id}`;
  };

  it("with 只看本体 on, shows those near the main roach, answered ones and a 触须之交's birthday; off again, the rest as they were", async () => {
    const sender = await signUp("sender@example.com");
    const friend = await signUp("friend@example.com");
    // me: main roach at People's Square, a 触须之交 in Tokyo, and a clone 15 km off, out of the main roach's reach
    await realFriends(me, friend);
    await me.placeRoach({ kind: "clone" }, FAR);
    const nearMain = await sentFrom(sender, [NEAR], 3 * 60_000);
    const nearClone = await sentFrom(sender, [FAR], 2 * 60_000);
    const answered = await sentFrom(sender, [FAR], 60_000);
    await me.react(answered, "plusone");
    expect(await declarationIds(me)).toEqual([answered, nearClone, nearMain]);
    const before = await unseen(me);
    expect(before).toContain(nearClone);

    await world.setOnlyMains(me.id, true);
    expect(await declarationIds(me)).toEqual([answered, nearMain]);
    // what only a clone was near can no longer be answered or touched back
    await expect(me.react(nearClone, "plusone")).rejects.toThrow("找不到这条宣言了");
    await expect(me.reply(nearClone, false)).rejects.toThrow();
    // a 触须之交's 「祝我生日快乐」 comes however far
    await friend.declare({ template: "birthday" });
    const birthday = await latest(friend);
    expect(await declarationIds(me)).toEqual([birthday, answered, nearMain]);

    // off: the clone's come back, read or unread as they were
    await world.setOnlyMains(me.id, false);
    expect(await declarationIds(me)).toEqual([birthday, answered, nearClone, nearMain]);
    expect((await unseen(me)).filter((id) => id !== birthday)).toEqual(before);
  });

  it("counts and nudges a player with 只看本体 on only for their main roach, as before for everyone else", async () => {
    const sender = await signUp("sender@example.com");
    await sender.placeRoach({ kind: "main" }, FAR);
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.placeRoach({ kind: "clone" }, FAR);
    const other = await signUp("other@example.com");
    await other.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await other.placeRoach({ kind: "clone" }, FAR);
    let nudged = 0;
    const off = listen(me.id, () => nudged++);
    const sent = async () => {
      await earlier(2);
      await sender.declare({ template: "launch", game: "arknights" });
      const mine = await db.select().from(declarations).where(eq(declarations.senderId, sender.id));
      return mine.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0].recipients;
    };
    try {
      // off: me and other by their clones (and whoever else is about)
      const all = await sent();
      expect(nudged).toBe(1);
      // on: me not counted, not nudged, for a clone alone; other, off, as before
      await world.setOnlyMains(me.id, true);
      expect(await sent()).toBe(all - 1);
      expect(nudged).toBe(1);
      // on, with the main roach near: counted and nudged
      await moveTo(me, 0, NEAR_FAR);
      expect(await sent()).toBe(all);
      expect(nudged).toBe(2);
    } finally {
      off();
    }
  });

  it("shows one for seven days to every roach within 10 km of where it was sent, kept once with its spot", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const near = await signUp("near@example.com");
    await near.placeRoach({ kind: "main" }, NEAR);
    const far = await signUp("far@example.com");
    await far.placeRoach({ kind: "main" }, FAR);
    await me.declare({ template: "launch", game: "arknights" });
    const id = await latest(me);
    expect(await declarationIds(near)).toContain(id);
    expect(await declarationIds(far)).not.toContain(id);
    expect(await declarationIds(me)).not.toContain(id);
    expect((await world.newDeclarations(near.id, Date.now() - 60_000)).map((i) => i.id)).toContain(id);
    expect(await world.newDeclarations(near.id, Date.now() + 5_000)).toEqual([]);
    // one row, with the spot it was sent from, and no row for each player it reaches
    expect(await db.$count(deliveries)).toBe(0);
    expect(await db.select({ spot: declarationSpots.spot, lng: declarationSpots.lng, lat: declarationSpots.lat }).from(declarationSpots)).toEqual([
      { spot: 0, lng: PEOPLES_SQUARE.lng, lat: PEOPLES_SQUARE.lat },
    ]);

    // the eighth day: gone, and there is nothing more to do with it
    await db.update(declarations).set({ createdAt: new Date(Date.now() - 8 * DAY_MS) });
    await db.update(declarationSpots).set({ createdAt: new Date(Date.now() - 8 * DAY_MS) });
    expect(await declarationIds(near)).not.toContain(id);
    await expect(near.react(id, "plusone")).rejects.toThrow("找不到这条宣言了");
    await expect(near.reply(id, false)).rejects.toThrow("找不到这条消息的主人了");
    await expect(near.report(id, "spam")).rejects.toThrow("找不到这条消息了");
    // and where it was sent from is forgotten; the declaration stays for 热榜
    await pruneOldActivity();
    expect(await db.$count(declarationSpots)).toBe(0);
    expect(await db.$count(declarations)).toBe(1);
  });

  it("keeps what the admin reads of a reported declaration or reaction in Chinese, though reported from the English site", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const near = await signUp("near@example.com");
    await near.placeRoach({ kind: "main" }, NEAR);
    const d: Declaration = { template: "launch", game: "arknights" };
    await me.declare(d);
    const id = await latest(me);
    await near.react(id, "zhouli");
    await withLang("en", () => near.report(id, "spam"));
    const reaction = (await me.inbox()).find((i) => i.kind === "reaction")!;
    await withLang("en", () => me.report(reaction.id, "other", "not nice"));
    expect((await db.select({ context: reports.context }).from(reports)).map((r) => r.context).sort()).toEqual(
      [`宣言「${declarationText(d)}」`, `回应「合乎粥礼」，回应的是举报人的宣言「${declarationText(d)}」`].sort(),
    );
    expect(declarationText(d)).toMatch(/[\u4e00-\u9fff]/);
  });

  it("counts every roach of the player, never one between players who blocked each other, and shows the newest hundred", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    const id = await latest(me);
    const other = await signUp("other@example.com");
    await other.placeRoach({ kind: "main" }, ELSEWHERE);
    expect(await declarationIds(other)).not.toContain(id);
    await other.placeRoach({ kind: "clone" }, NEAR);
    expect(await declarationIds(other)).toContain(id);
    for (const [blockerId, blockedId] of [
      [other.id, me.id],
      [me.id, other.id],
    ]) {
      await db.insert(blocks).values({ blockerId, blockedId });
      expect(await declarationIds(other)).not.toContain(id);
      await db.delete(blocks);
    }

    // a hundred and ten near it, all older: the newest hundred, newest first
    const now = Date.now();
    const older = await db
      .insert(declarations)
      .values(
        Array.from({ length: 110 }, (_, i) => ({
          senderId: me.id,
          template: "launch",
          game: "arknights",
          recipients: 0,
          createdAt: new Date(now - (i + 2) * 60_000),
        })),
      )
      .returning();
    await db.insert(declarationSpots).values(older.flatMap((d) => spotRows(d, [PEOPLES_SQUARE])));
    const shown = await declarationItems(other);
    expect(shown).toHaveLength(100);
    expect(shown[0].id).toBe(id);
    expect(shown.map((i) => i.at)).toEqual([...shown.map((i) => i.at)].sort((x, y) => y - x));
  });

  it("shows what a roach moved near finds, hides it once moved away, and keeps what was answered wherever the roaches go", async () => {
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    const id = await latest(me);
    const c = await signUp("c@example.com");
    await c.placeRoach({ kind: "main" }, ELSEWHERE);
    await c.placeRoach({ kind: "clone" }, ELSEWHERE_NEAR);
    expect(await declarationIds(c)).not.toContain(id);
    await moveTo(c, 1, NEAR);
    expect(await declarationIds(c)).toContain(id);
    await moveTo(c, 1, ELSEWHERE_NEAR);
    expect(await declarationIds(c)).not.toContain(id);

    // reacted to: stays when the roach moves away
    await moveTo(c, 1, NEAR);
    await c.react(id, "plusone");
    await moveTo(c, 1, ELSEWHERE_NEAR);
    expect(await declarationItems(c)).toMatchObject([{ id, reaction: { id: "plusone" } }]);
    // touched back: the same
    const d = await signUp("d@example.com");
    await d.placeRoach({ kind: "main" }, NEAR);
    await d.reply(id, false);
    await moveTo(d, 0, ELSEWHERE);
    expect(await declarationItems(d)).toMatchObject([{ id, replied: true }]);
    // past the inbox's 30 days not even those
    await db.update(declarations).set({ createdAt: new Date(Date.now() - 31 * DAY_MS) });
    expect(await declarationIds(c)).toEqual([]);
    expect(await declarationIds(d)).toEqual([]);
  });

  it("sends a birthday to every 触须之交 by name, once when they are near too, and to the rest nearby as anyone's", async () => {
    const friend = await signUp("friend@example.com");
    await realFriends(me, friend);
    const near = await signUp("near@example.com");
    await near.placeRoach({ kind: "main" }, NEAR);
    await me.declare({ template: "birthday" });
    const id = await latest(me);
    expect(await declarationItems(friend)).toMatchObject([{ id, from: { displayName: expect.any(String) } }]);
    expect((await declarationItems(near)).find((i) => i.id === id)).not.toHaveProperty("from");
    expect(await db.select({ id: deliveries.recipientId, toFriend: deliveries.toFriend }).from(deliveries)).toEqual([{ id: friend.id, toFriend: true }]);
    // a 触须之交 near it too: one item, by name
    await moveTo(friend, 0, NEAR);
    const theirs = (await declarationItems(friend)).filter((i) => i.id === id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toHaveProperty("from");
    // theirs for 30 days, wherever they are
    await moveTo(friend, 0, TOKYO);
    await db.update(declarations).set({ createdAt: new Date(Date.now() - 20 * DAY_MS) });
    expect(await declarationIds(friend)).toEqual([id]);
    expect(await declarationIds(near)).not.toContain(id);
  });

  it("counts what was read up to the newest one seen, so older ones a move brings in come read", async () => {
    const other = await signUp("other@example.com");
    await other.placeRoach({ kind: "main" }, ELSEWHERE);
    await other.declare({ template: "launch", game: "arknights" });
    const old = await latest(other);
    await earlier(2 * 24 * 60);
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    await me.declare({ template: "launch", game: "arknights" });
    const mine = await latest(me);
    const c = await signUp("c@example.com");
    await c.placeRoach({ kind: "main" }, NEAR);
    await c.placeRoach({ kind: "clone" }, FAR);
    expect(await unseen(c)).toEqual([mine]);
    await c.markSeen([mine]);
    expect(await unseen(c)).toEqual([]);
    // the clone moves near the older one: shown, and read already
    await moveTo(c, 1, ELSEWHERE_NEAR);
    expect(await declarationIds(c)).toEqual([mine, old]);
    expect(await unseen(c)).toEqual([]);
    // a new one is not
    await earlier(2);
    await me.declare({ template: "welcome", game: "arknights" });
    const next = await latest(me);
    expect(await unseen(c)).toEqual([next]);
    // marking one the player does not see marks nothing
    await c.markSeen([`d:${randomUUID()}`]);
    expect(await unseen(c)).toEqual([next]);
  });

  it("still shows, the week after, declarations delivered the old way, read as they were", async () => {
    const sender = await signUp("sender@example.com");
    const [d] = await db.insert(declarations).values({ senderId: sender.id, template: "launch", game: "arknights", recipients: 1 }).returning();
    await db.insert(deliveries).values({ declarationId: d.id, recipientId: me.id });
    expect(await declarationItems(me)).toMatchObject([{ id: `d:${d.id}`, seen: false }]);
    await me.markSeen([`d:${d.id}`]);
    expect(await declarationItems(me)).toMatchObject([{ id: `d:${d.id}`, seen: true }]);
    await me.react(`d:${d.id}`, "plusone");
    await db.update(declarations).set({ createdAt: new Date(Date.now() - 8 * DAY_MS) });
    // reacted to, so kept; another one delivered the old way and older than a week is not
    const [e] = await db.insert(declarations).values({ senderId: sender.id, template: "welcome", game: "arknights", recipients: 1, createdAt: new Date(Date.now() - 8 * DAY_MS) }).returning();
    await db.insert(deliveries).values({ declarationId: e.id, recipientId: me.id });
    expect(await declarationIds(me)).toEqual([`d:${d.id}`]);
  });

  it("reaches exactly 10 km, across squares of the map and across ±180°", async () => {
    const sender = await signUp("sender@example.com");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    // due east and due north, just inside and just outside 10 km (a degree of latitude is 111.195 km)
    const kmEast = (km: number) => ({ lng: PEOPLES_SQUARE.lng + km / (111.195 * Math.cos((PEOPLES_SQUARE.lat * Math.PI) / 180)), lat: PEOPLES_SQUARE.lat });
    const kmNorth = (km: number) => ({ lng: PEOPLES_SQUARE.lng, lat: PEOPLES_SQUARE.lat + km / 111.195 });
    const inside = [await sentFrom(sender, [kmEast(9.95)], 60_000), await sentFrom(sender, [kmNorth(9.95)], 120_000)];
    const outside = [await sentFrom(sender, [kmEast(10.05)], 180_000), await sentFrom(sender, [kmNorth(10.05)], 240_000)];
    const ids = await declarationIds(me);
    expect(ids).toEqual(inside);
    for (const id of outside) expect(ids).not.toContain(id);
    // one sent from two places counts once, near by either
    const both = await sentFrom(sender, [kmEast(30), kmNorth(3)], 30_000);
    expect((await declarationIds(me)).filter((id) => id === both)).toHaveLength(1);

    // over the date line: 179.95°E and 179.97°W are about 7 km apart on the equator
    const pacific = await signUp("pacific@example.com");
    await pacific.placeRoach({ kind: "main" }, { lng: 179.95, lat: 0 });
    const across = await sentFrom(sender, [{ lng: -179.97, lat: 0 }], 10_000);
    expect(await declarationIds(pacific)).toEqual([across]);
  });

  it("finds the newest hundred however far back they go within the week, and none older", async () => {
    const sender = await signUp("sender@example.com");
    await me.placeRoach({ kind: "main" }, PEOPLES_SQUARE);
    const HOUR = 3_600_000;
    // a few in the last hour, more over the last day, most days ago, one past the week
    const recent = [await sentFrom(sender, [NEAR], 10 * 60_000), await sentFrom(sender, [NEAR], 50 * 60_000)];
    const today = [];
    for (let i = 0; i < 20; i++) today.push(await sentFrom(sender, [NEAR], 2 * HOUR + i * HOUR));
    const days = [];
    for (let i = 0; i < 90; i++) days.push(await sentFrom(sender, [PEOPLES_SQUARE], 2 * DAY_MS + i * HOUR));
    const tooOld = await sentFrom(sender, [NEAR], 8 * DAY_MS);
    const ids = await declarationIds(me);
    expect(ids).toEqual([...recent, ...today, ...days].slice(0, 100));
    expect(ids).not.toContain(tooOld);
    // and a quiet place: the two there, from days ago
    const quiet = { lng: 87.6, lat: 43.8 };
    const far = [await sentFrom(sender, [quiet], 3 * DAY_MS), await sentFrom(sender, [quiet], 6 * DAY_MS)];
    const there = await signUp("there@example.com");
    await there.placeRoach({ kind: "main" }, quiet);
    expect(await declarationIds(there)).toEqual(far);
  });
});
