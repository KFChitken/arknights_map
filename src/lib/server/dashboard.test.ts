import { and, asc, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AMIYA_ID } from "../amiya";
import { addDays, beijingDate, beijingMidnight } from "../beijing";
import { COUNTED, OPEN_DAY } from "../dashboard";
import { CHARACTERS, OPERATORS } from "../operators";
import type { LngLat } from "../types";
import { backfillStats, countedFromTables, dashboard, morningStats, recordOnlinePeak, reportOnline, snapshotNow, takeSnapshot } from "./dashboard";
import { db } from "./db";
import * as friendly from "./friendly";
import { listen } from "./live";
import { resetRoachFeed } from "./roachFeed";
import {
  amiyaTouches,
  dailyTotals,
  declarations,
  friendNotes,
  friendships,
  moves,
  onlineHours,
  onlineNow,
  reactions,
  roachChanges,
  roaches,
  siInks,
  siTickets,
  statCounts,
  statSnapshots,
  touches,
  userBadges,
  users,
} from "./schema";
import { forgetInkSnapshot } from "./siInk";
import { countStat, forgetStatCounts, saveStatCounts, unsavedStats } from "./stats";
import { recordDailyTotals } from "./totals";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SQUARE = { lng: 121.4737, lat: 31.2304 };
const NEAR = { lng: 121.48, lat: 31.235 };
const TOKYO = { lng: 139.7, lat: 35.68 };

/** A player who ticked everything, with a main roach where given; returns their id */
async function player(email: string, at?: LngLat, more: Partial<typeof users.$inferInsert> = {}) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now, ...more })
    .returning({ id: users.id });
  if (at) await world.placeRoach(u.id, { kind: "main" }, at);
  return u.id;
}

const mainOf = async (id: string) => (await world.me(id))!.roaches.find((r) => r.slot === 0)!.publicId;
/** A touch's inbox id, the first from one player to another */
async function touchItem(from: string, to: string) {
  const [t] = await db
    .select({ id: touches.id })
    .from(touches)
    .where(and(eq(touches.fromUserId, from), eq(touches.toUserId, to)))
    .orderBy(asc(touches.createdAt))
    .limit(1);
  return `t:${t.id}`;
}
/** What this process counted today and has not saved, by name */
function counted() {
  const today = `${beijingDate(Date.now())}|`;
  return Object.fromEntries([...unsavedStats()].filter(([key]) => key.startsWith(today)).map(([key, n]) => [key.slice(today.length), n]));
}
/** stat_counts as day → name → n */
async function savedByDay() {
  const out: Record<string, Record<string, number>> = {};
  for (const r of await db.select().from(statCounts)) (out[r.day] ??= {})[r.name] = r.n;
  return out;
}
const noon = (day: string) => new Date(beijingMidnight(day) + 12 * HOUR);
/** A pair as friendships keeps it */
const pair = (x: string, y: string) => (x < y ? { a: x, b: y } : { a: y, b: x });

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${roachChanges}, ${statCounts}, ${onlineNow}, ${onlineHours}, ${statSnapshots}, ${dailyTotals}, ${siTickets}, ${siInks} cascade`,
  );
  forgetStatCounts();
  forgetInkSnapshot();
  resetRoachFeed();
});

describe("数据看板's counters", () => {
  it("adds each process's counts to the Beijing day's rows, and keeps them for next time when the database is away", async () => {
    const today = beijingDate(Date.now());
    countStat("decl");
    countStat("decl", 2);
    for (const by of [0, -1, Number.NaN]) countStat("decl", by);
    // a minute before and after midnight in Beijing
    countStat("touch.bold", 1, Date.parse("2026-11-12T15:59:00Z"));
    countStat("touch.bold", 1, Date.parse("2026-11-12T16:00:00Z"));
    await saveStatCounts();
    countStat("decl");
    await saveStatCounts();
    await saveStatCounts();
    const expected: Record<string, Record<string, number>> = { "2026-11-12": { "touch.bold": 1 }, "2026-11-13": { "touch.bold": 1 } };
    (expected[today] ??= {}).decl = 4;
    expect(await savedByDay()).toEqual(expected);
    expect(unsavedStats().size).toBe(0);

    countStat("reply");
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("database away");
    });
    await expect(saveStatCounts()).rejects.toThrow("database away");
    spy.mockRestore();
    expect(counted()).toEqual({ reply: 1 });
    countStat("reply");
    await saveStatCounts();
    expect((await savedByDay())[today].reply).toBe(2);
    expect(Object.keys((await db.select().from(statCounts))[0]).sort()).toEqual(["day", "n", "name"]);
  });

  it("counts a touch as it is written, a touch back of a touch apart, and nothing for one refused", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", TOKYO);
    const c = await player("c@example.com", NEAR);
    forgetStatCounts();
    await world.touch(a, await mainOf(b), false);
    // the same roach sneakily again, and one's own
    await expect(world.touch(a, await mainOf(b), false)).rejects.toThrow();
    await expect(world.touch(a, await mainOf(a), true)).rejects.toThrow();
    expect(counted()).toEqual({ "touch.sneaky": 1 });

    const item = await touchItem(a, b);
    await world.reply(b, item, true);
    await expect(world.reply(b, item, true)).rejects.toThrow();
    expect(counted()).toEqual({ "touch.sneaky": 1, "touch.bold": 1, "touch.back": 1 });

    // 默默爬走, counted once however often, and never by another
    await world.touch(c, await mainOf(b), true);
    const fromC = await touchItem(c, b);
    await world.ignore(b, fromC);
    await world.ignore(b, fromC);
    await expect(world.ignore(a, fromC)).rejects.toThrow();
    expect(counted()).toEqual({ "touch.sneaky": 1, "touch.bold": 2, "touch.back": 1, "touch.ignored": 1 });
  });

  it("counts a declaration by its sentence with the players it reached, and a reply by its id, once each", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    await player("c@example.com", TOKYO);
    forgetStatCounts();
    await world.declare(a, { template: "launch", game: "arknights" });
    // again at once: refused
    await expect(world.declare(a, { template: "launch", game: "arknights" })).rejects.toThrow();
    expect(counted()).toEqual({ decl: 1, "decl.launch": 1, "decl.reach": 1 });

    const [said] = (await world.inbox(b)).filter((i) => i.kind === "declaration");
    await world.react(b, said.id, "zhouli");
    await expect(world.react(b, said.id, "plusone")).rejects.toThrow();
    expect(counted()).toEqual({ decl: 1, "decl.launch": 1, "decl.reach": 1, reply: 1, "reply.zhouli": 1 });
  });

  it("counts a roach put down, main or clone, and never a move", async () => {
    const a = await player("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SQUARE);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    const main = (await world.me(a))!.roaches.find((r) => r.slot === 0)!;
    await world.placeRoach(a, { kind: "move", roachId: main.id }, NEAR);
    expect(counted()).toEqual({ "place.main": 1, "place.clone": 1 });
  });

  it("counts what 触须之交 do for each other once each, and nothing for one refused", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", TOKYO);
    await world.touch(a, await mainOf(b), true);
    await world.touch(b, await mainOf(a), true);
    forgetStatCounts();
    const key = world.friendKey(a, b);
    await friendly.gesture(a, key, "hug");
    await friendly.remindSanity(a, key);
    await expect(friendly.remindSanity(a, key)).rejects.toThrow();
    // a quilt for one awake
    await expect(friendly.gesture(a, key, "blanket")).rejects.toThrow();
    // a clone of a's at b's, put down for it
    await friendly.visit(a, key, await mainOf(b));
    await expect(friendly.visit(a, key, await mainOf(b))).rejects.toThrow();
    expect(counted()).toEqual({ "note.hug": 1, "note.sanity": 1, "note.visit": 1, "place.clone": 1 });
  });

  it("counts a player's touch of a guide", async () => {
    const a = await player("a@example.com", SQUARE);
    forgetStatCounts();
    await world.touch(a, AMIYA_ID, false);
    expect(counted()).toEqual({ "guide.amiya": 1 });
  });

  it("counts what the backfill counts from the same rows", async () => {
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", NEAR);
    const c = await player("c@example.com", TOKYO);
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    await world.touch(a, await mainOf(b), false);
    await world.reply(b, await touchItem(a, b), true);
    // a sneaky touch may be followed by a bold one: 触须之交 now
    await world.touch(a, await mainOf(b), true);
    await world.touch(c, await mainOf(a), true);
    await world.ignore(a, await touchItem(c, a));
    await world.declare(a, { template: "launch", game: "arknights" });
    const [said] = (await world.inbox(b)).filter((i) => i.kind === "declaration");
    await world.react(b, said.id, "zhouli");
    await friendly.gesture(a, world.friendKey(a, b), "hug");
    await world.touch(c, AMIYA_ID, true);
    const live = counted();
    expect(live).toMatchObject({ "place.main": 3, "place.clone": 1, "touch.sneaky": 1, "touch.bold": 3, "touch.back": 1, "touch.ignored": 1, "guide.amiya": 1 });

    // the same rows a day back, a whole day the backfill reads
    const back = (col: { name: string }) => sql.raw(`"${col.name}" = "${col.name}" - interval '1 day'`);
    const shifted: [PgTable, { name: string }[]][] = [
      [users, [users.createdAt]],
      [touches, [touches.createdAt, touches.ignoredAt]],
      [declarations, [declarations.createdAt]],
      [reactions, [reactions.createdAt]],
      [friendNotes, [friendNotes.createdAt]],
      [friendships, [friendships.createdAt]],
      [moves, [moves.at]],
      [amiyaTouches, [amiyaTouches.createdAt]],
    ];
    for (const [table, cols] of shifted) await db.execute(sql`update ${table} set ${sql.join(cols.map(back), sql`, `)}`);
    const yesterday = addDays(beijingDate(Date.now()), -1);
    const fromTables = Object.fromEntries((await countedFromTables()).filter((r) => r.day === yesterday).map((r) => [r.name, r.n]));
    expect(fromTables).toEqual({ ...live, signups: 3, friendships: 1 });
  });
});

describe("数据看板's backfill", () => {
  it("sets every whole day before today from the tables, once, and leaves today's counts alone", async () => {
    const today = beijingDate(Date.now());
    const d1 = addDays(today, -2);
    const d2 = addDays(today, -1);
    const a = await player("a@example.com", SQUARE);
    const b = await player("b@example.com", TOKYO);
    await db.update(users).set({ createdAt: noon(d1) }).where(eq(users.id, a));
    await db.update(users).set({ createdAt: noon(d2) }).where(eq(users.id, b));
    await db.update(moves).set({ at: noon(d1) }).where(eq(moves.userId, a));
    const [first] = await db.insert(touches).values({ fromUserId: a, toUserId: b, bold: false, toSlot: 0, createdAt: noon(d1) }).returning();
    await db.insert(touches).values([
      { fromUserId: b, toUserId: a, bold: true, replyTo: `t:${first.id}`, createdAt: noon(d2) },
      // crawled away from the day after
      { fromUserId: a, toUserId: b, bold: true, toSlot: 0, createdAt: noon(d1), ignoredAt: noon(d2) },
      // and today: today's, which the counters have
      { fromUserId: b, toUserId: a, bold: true, toSlot: 0, createdAt: noon(d2), ignoredAt: new Date() },
    ]);
    const [said] = await db.insert(declarations).values({ senderId: a, template: "launch", game: "arknights", recipients: 3, createdAt: noon(d1) }).returning();
    await db.insert(reactions).values({ declarationId: said.id, fromUserId: b, reaction: "zhouli", createdAt: noon(d1) });
    await db.insert(friendNotes).values([
      { fromUserId: a, toUserId: b, kind: "hug", period: d2, createdAt: noon(d2) },
      // the site's own word, not counted
      { fromUserId: b, toUserId: a, kind: "sentHome", period: "x", createdAt: noon(d2) },
    ]);
    await db.insert(amiyaTouches).values([
      { userId: a, direction: "to_amiya", bold: false, createdAt: noon(d1) },
      { userId: a, direction: "from_amiya", kind: "touch", bold: false, createdAt: noon(d1) },
    ]);
    await db.insert(friendships).values({ ...pair(a, b), createdAt: noon(d2) });
    // the 10-minute totals have d2 already
    await db.insert(dailyTotals).values({ day: d2, activeWeek: 2, signups: 1, friendships: 1 });
    // what the counters had: a part of d1, a name nothing counts any more, and today's
    await db.insert(statCounts).values([
      { day: d1, name: COUNTED.sneaky, n: 99 },
      { day: d1, name: "old.name", n: 5 },
      { day: today, name: COUNTED.bold, n: 4 },
    ]);

    const now = Date.now();
    expect(await backfillStats(now)).toBe(true);
    const filled = await savedByDay();
    expect(filled).toEqual({
      [d1]: {
        "touch.sneaky": 1,
        "touch.bold": 1,
        decl: 1,
        "decl.launch": 1,
        "decl.reach": 3,
        reply: 1,
        "reply.zhouli": 1,
        "place.main": 1,
        "guide.amiya": 1,
        signups: 1,
      },
      [d2]: { "touch.bold": 2, "touch.back": 1, "touch.ignored": 1, "note.hug": 1 },
      [today]: { "touch.bold": 4 },
      [OPEN_DAY]: { "backfill.done": now },
    });
    // once only
    expect(await backfillStats(now + MINUTE)).toBe(false);
    expect(await savedByDay()).toEqual(filled);
  });

  it("from 05:00 fills in the days before once, only before 06:00, and counts the day's spread once a day", async () => {
    const today = beijingDate(Date.now());
    const tomorrow = addDays(today, 1);
    const at = (day: string, h: number, m = 0) => beijingMidnight(day) + h * HOUR + m * MINUTE;
    expect(await morningStats(at(today, 4, 59))).toEqual({ backfilled: false, snapshot: false });
    expect(await db.select().from(statSnapshots)).toEqual([]);
    // a process that starts after 06:00 takes the day's snapshot, never the backfill
    expect(await morningStats(at(today, 6, 10))).toEqual({ backfilled: false, snapshot: true });
    expect(await morningStats(at(today, 6, 15))).toEqual({ backfilled: false, snapshot: false });
    expect(await morningStats(at(tomorrow, 5, 20))).toEqual({ backfilled: true, snapshot: true });
    expect(await morningStats(at(tomorrow, 5, 25))).toEqual({ backfilled: false, snapshot: false });
    const snaps = await db.select().from(statSnapshots).orderBy(asc(statSnapshots.day));
    expect(snaps.map((s) => [s.day, s.at.getTime()])).toEqual([
      [today, at(today, 6, 10)],
      [tomorrow, at(tomorrow, 5, 20)],
    ]);
  });
});

describe("数据看板's players online", () => {
  it("adds up the processes' fresh counts, keeps each hour's peak and when, and lets go of processes gone a day", async () => {
    const today = beijingDate(Date.now());
    const now = beijingMidnight(today) + 21 * HOUR + 10 * MINUTE;
    await db.insert(onlineNow).values([
      { process: "web", n: 5, at: new Date(now - 30_000) },
      { process: "web2", n: 3, at: new Date(now - MINUTE) },
      // stopped a few minutes ago, and a day ago
      { process: "web3", n: 9, at: new Date(now - 3 * MINUTE) },
      { process: "old", n: 1, at: new Date(now - 2 * DAY) },
    ]);
    expect(await recordOnlinePeak(now)).toBe(8);
    expect((await db.select({ p: onlineNow.process }).from(onlineNow)).map((r) => r.p).sort()).toEqual(["web", "web2", "web3"]);
    const hours = () => db.select().from(onlineHours);
    expect(await hours()).toEqual([{ day: today, hour: 21, peak: 8, peakAt: new Date(now) }]);

    // fewer later in the hour: the peak stays, with its time
    await db.update(onlineNow).set({ n: 1, at: new Date(now + MINUTE) }).where(eq(onlineNow.process, "web"));
    expect(await recordOnlinePeak(now + MINUTE)).toBe(4);
    expect(await hours()).toEqual([{ day: today, hour: 21, peak: 8, peakAt: new Date(now) }]);
    // more, web2 having gone quiet: a new peak
    await db.update(onlineNow).set({ n: 20, at: new Date(now + 2 * MINUTE) }).where(eq(onlineNow.process, "web"));
    expect(await recordOnlinePeak(now + 2 * MINUTE)).toBe(20);
    expect(await hours()).toEqual([{ day: today, hour: 21, peak: 20, peakAt: new Date(now + 2 * MINUTE) }]);
    // the next hour has its own
    expect(await recordOnlinePeak(now + HOUR)).toBe(0);
    expect((await hours()).map((h) => [h.hour, h.peak]).sort()).toEqual([
      [21, 20],
      [22, 0],
    ]);
  });

  it("has every process say how many signed-in players have a page open on it", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    const now = Date.now();
    const stops = [listen(a, () => {}), listen(a, () => {}), listen(b, () => {})];
    await reportOnline("web2", now);
    expect(await db.select().from(onlineNow)).toEqual([{ process: "web2", n: 2, at: new Date(now) }]);
    for (const stop of stops) stop();
    await reportOnline("web2", now + MINUTE);
    expect(await db.select().from(onlineNow)).toEqual([{ process: "web2", n: 0, at: new Date(now + MINUTE) }]);
  });
});

describe("the 10-minute totals", () => {
  it("keep the players there are and those who came today, and count yesterday's players once more after midnight", async () => {
    const now = Date.now();
    const today = beijingDate(now);
    const yesterday = addDays(today, -1);
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    const c = await player("c@example.com");
    await player("demo@example.com", undefined, { demoKey: "demo-test", lastSeenOn: today });
    await db
      .update(users)
      .set({ createdAt: new Date(beijingMidnight(yesterday) + HOUR), lastSeenOn: yesterday })
      .where(eq(users.id, a));
    await db
      .update(users)
      .set({ createdAt: new Date(beijingMidnight(yesterday) - HOUR), lastSeenOn: today })
      .where(eq(users.id, b));
    await db.update(users).set({ lastSeenOn: today }).where(eq(users.id, c));
    await db.insert(dailyTotals).values({ day: yesterday, activeWeek: 1, signups: 0, friendships: 0, players: 1, visitors: 7 });
    await recordDailyTotals(now);
    const rows = Object.fromEntries((await db.select().from(dailyTotals)).map((r) => [r.day, r]));
    expect(rows[today]).toEqual({ day: today, activeWeek: 3, signups: 1, friendships: 0, players: 3, visitors: 2 });
    // yesterday's who came stay as they were last counted: by now some of them came today too
    expect(rows[yesterday]).toEqual({ day: yesterday, activeWeek: 1, signups: 1, friendships: 0, players: 2, visitors: 7 });
  });
});

describe("数据看板's 05:00 snapshot", () => {
  it("counts how the players and their roaches are spread, in codes and totals that point at nobody", async () => {
    const now = Date.now();
    const today = beijingDate(now);
    const yesterday = addDays(today, -1);
    const [x, y] = CHARACTERS.arknights;
    const [e] = CHARACTERS.endfield;
    const [s] = OPERATORS.arknights;
    const a = await player("a.player@example.com", SQUARE, {
      name: "阿白",
      anonymous: false,
      avatar: "hood",
      color: "pink",
      games: ["arknights"],
      favArknights: [x, y],
      support: [s, "没有这个人"],
    });
    const b = await player("b.player@example.com", NEAR, { avatar: "hood", color: "cyan", games: ["arknights", "endfield"], favArknights: [x], favEndfield: [e] });
    const c = await player("c.player@example.com", TOKYO, { avatar: "doctor", color: "gold", games: ["endfield"] });
    const d = await player("d.player@example.com", undefined, { avatar: "imp" });
    await player("demo@example.com", undefined, { demoKey: "demo-test", avatar: "gugu", games: ["arknights"], favArknights: [y, y] });
    await world.placeRoach(a, { kind: "clone" }, TOKYO);
    await db.insert(friendships).values({ ...pair(a, b), createdAt: new Date(now - 3 * DAY - HOUR) });
    // the badges as given here alone
    await db.delete(userBadges);
    await db.insert(userBadges).values([
      { userId: a, badge: "amiya" },
      { userId: b, badge: "amiya" },
      { userId: a, badge: "siinn" },
      // held some days only: over, and still held
      { userId: c, badge: "survivor", earnedAt: new Date(now - 10 * DAY) },
      { userId: d, badge: "survivor" },
      { userId: d, badge: "no-such-badge" },
    ]);
    await db.insert(declarations).values([
      { senderId: a, template: "launch", game: "arknights", recipients: 7, createdAt: noon(yesterday) },
      { senderId: b, template: "launch", game: "arknights", recipients: 2, createdAt: noon(addDays(today, -2)) },
      // today's waits for tomorrow
      { senderId: b, template: "launch", game: "arknights", recipients: 30, createdAt: new Date(now) },
    ]);
    await db.insert(siInks).values([
      { no: 1, userId: a, look: "hood", drawnAt: new Date(now - DAY) },
      { no: 2, userId: b, look: "hood", drawnAt: new Date(now - DAY) },
      { no: 3, userId: c, look: "hood", drawnAt: new Date(now - DAY) },
    ]);
    await db.insert(siTickets).values([
      { n: 1, inkNo: 1, again: false, queuedAt: new Date(now - DAY), checkinAt: new Date(now - 20 * HOUR) },
      // recalled before its room
      { n: 2, inkNo: 2, again: false, queuedAt: new Date(now - DAY), checkinAt: new Date(now - 10 * HOUR), recalledAt: new Date(now - 12 * HOUR) },
      { n: 3, inkNo: 3, again: false, queuedAt: new Date(now - HOUR), checkinAt: new Date(now + 5 * HOUR) },
      // the first again: one ink roach that stayed
      { n: 4, inkNo: 1, again: true, queuedAt: new Date(now - 6 * HOUR), checkinAt: new Date(now - HOUR) },
    ]);

    const snap = await snapshotNow(now);
    expect(snap).toEqual({
      players: 4,
      milestones: [],
      avatars: [
        { key: "hood", n: 2 },
        { key: "doctor", n: 1 },
        { key: "imp", n: 1 },
      ],
      colors: [
        { key: "cyan", n: 1 },
        { key: "pink", n: 1 },
      ],
      hood: 2,
      games: { arknights: 1, endfield: 1, both: 1, none: 1 },
      clones: { players: 1, all: 1, full: 0, riders: 0 },
      favourites: {
        arknights: [
          { key: x, n: 2 },
          { key: y, n: 1 },
        ],
        endfield: [{ key: e, n: 1 }],
        support: [{ key: s, n: 1 }],
      },
      friendships: { pairs: 1, withSome: 2, most: 1, oldestDays: 3 },
      badges: {
        total: 4,
        by: [
          { key: "amiya", n: 2 },
          { key: "siinn", n: 1 },
          { key: "survivor", n: 1 },
        ],
      },
      guides: { friends: { amiya: 2, perlica: 0, talulah: 0, minghe: 0, si: 1 }, inksStayed: 1, inksQueued: 1 },
      where: {
        china: 2,
        abroad: 1,
        cities: [
          { key: "shanghai", n: 2 },
          { key: "tokyo", n: 1 },
        ],
      },
      reach: { n: 7, day: yesterday },
    });
    const json = JSON.stringify(snap);
    const own = await db.select({ id: roaches.id, publicId: roaches.publicId }).from(roaches);
    for (const secret of [a, b, c, d, "@example.com", ".player", "阿白", "demo-test", ...own.flatMap((r) => [r.id, r.publicId])]) {
      expect(json, secret).not.toContain(secret);
    }

    // written once a day, again over itself
    await takeSnapshot(now);
    await takeSnapshot(now + MINUTE);
    expect((await db.select().from(statSnapshots)).map((r) => [r.day, r.at.getTime()])).toEqual([[today, now + MINUTE]]);
    // tomorrow the record stays, though its declaration is gone, until one reaches more
    await db.delete(declarations);
    const tomorrow = beijingMidnight(addDays(today, 1)) + 5 * HOUR;
    expect((await snapshotNow(tomorrow)).reach).toEqual({ n: 7, day: yesterday });
    await db.insert(declarations).values({ senderId: c, template: "launch", game: "arknights", recipients: 9, createdAt: new Date(now) });
    expect((await snapshotNow(tomorrow)).reach).toEqual({ n: 9, day: today });
  });

  it("names the milestones reached by when that player came, among the accounts there are now", async () => {
    const start = Date.parse("2026-10-23T00:00:00Z");
    // ten thousand accounts, one a minute, and a demo one among them that counts for nothing
    await db.execute(sql`
      insert into ${users} (email, created_at, age_confirmed_at)
      select 'p' || i || '@example.com', ${new Date(start).toISOString()}::timestamptz + (i || ' minutes')::interval, now()
      from generate_series(1, 10000) as i`);
    await db.insert(users).values({ email: "demo@example.com", demoKey: "demo-test", createdAt: new Date(start) });
    const snap = await snapshotNow();
    expect(snap.players).toBe(10_000);
    expect(snap.milestones).toEqual([{ n: 10_000, at: start + 10_000 * MINUTE }]);
  });
});

describe("数据看板's answer", () => {
  it("has every day since the opening, today's counts, the week's, the hours, the records and the latest snapshot", async () => {
    const now = Date.now();
    const today = beijingDate(now);
    const yesterday = addDays(today, -1);
    const earlier = addDays(today, -3);
    const a = await player("a@example.com", SQUARE);
    await player("b@example.com", TOKYO);
    await db.insert(dailyTotals).values([
      { day: yesterday, activeWeek: 9, signups: 3, friendships: 2, players: 10, visitors: 4 },
      { day: today, activeWeek: 9, signups: 2, friendships: 1, players: 12, visitors: 5 },
    ]);
    const n = (day: string, counts: Record<string, number>) => Object.entries(counts).map(([name, v]) => ({ day, name, n: v }));
    await db.insert(statCounts).values([
      ...n(OPEN_DAY, { signups: 5, [COUNTED.backfilled]: now - DAY }),
      ...n(earlier, {
        "touch.sneaky": 6,
        "touch.bold": 2,
        "touch.back": 1,
        decl: 1,
        "decl.launch": 1,
        "decl.reach": 9,
        reply: 3,
        "reply.zhouli": 3,
        "place.main": 4,
        "place.clone": 1,
        "place.ink": 1,
        "guide.amiya": 2,
        "note.hug": 2,
      }),
      ...n(addDays(today, -8), { "touch.sneaky": 50 }),
      ...n(today, { "touch.bold": 1, "guide.amiya": 1 }),
    ]);
    const hourAt = (day: string, h: number) => new Date(beijingMidnight(day) + h * HOUR + 7 * MINUTE);
    await db.insert(onlineHours).values([
      { day: yesterday, hour: 20, peak: 11, peakAt: hourAt(yesterday, 20) },
      { day: yesterday, hour: 21, peak: 11, peakAt: hourAt(yesterday, 21) },
      { day: today, hour: 3, peak: 7, peakAt: hourAt(today, 3) },
      { day: today, hour: 4, peak: 6, peakAt: hourAt(today, 4) },
    ]);
    await db.insert(onlineNow).values({ process: "web", n: 3, at: new Date(now - 10_000) });
    await takeSnapshot(now);

    const d = await dashboard(now);
    const days: string[] = [];
    for (let day = OPEN_DAY; day <= today; day = addDays(day, 1)) days.push(day);
    expect(d.days.map((x) => x.day)).toEqual(days);
    const at = (day: string) => d.days.find((x) => x.day === day)!;
    expect(at(OPEN_DAY)).toEqual({
      day: OPEN_DAY,
      signups: 5,
      friendships: 0,
      players: 7,
      placed: 0,
      sneaky: 0,
      bold: 0,
      decl: 0,
      replies: 0,
      visitors: null,
      peakOnline: null,
    });
    expect(at(earlier)).toMatchObject({ players: 7, placed: 6, sneaky: 6, bold: 2, decl: 1, replies: 3, visitors: null, peakOnline: null });
    expect(at(yesterday)).toMatchObject({ signups: 3, friendships: 2, players: 10, visitors: 4, peakOnline: 11 });
    expect(at(today)).toMatchObject({ signups: 2, friendships: 1, players: 12, bold: 1, visitors: 5, peakOnline: 7 });
    expect(d.backfilled).toBe(true);
    expect(d.since).toEqual({ visitors: yesterday, online: yesterday });
    expect(d.totals).toEqual({
      players: 12,
      roaches: { mains: 2, clones: 0, inks: 0, fire: 0, riders: 0 },
      friendships: 3,
      touches: { sneaky: 56, bold: 3 },
      decl: 1,
      replies: 3,
      guides: { amiya: 3, perlica: 0, talulah: 0, minghe: 0, si: 0 },
    });
    expect(d.today).toEqual({ day: today, counts: { "touch.bold": 1, "guide.amiya": 1 }, online: 3, peak: { n: 7, at: hourAt(today, 3).getTime() } });
    expect(d.hours.today).toEqual(Array.from({ length: 24 }, (_, h) => (h === 3 ? 7 : h === 4 ? 6 : null)));
    expect(d.hours.yesterday).toEqual(Array.from({ length: 24 }, (_, h) => (h === 20 || h === 21 ? 11 : null)));
    expect(d.week).toEqual({
      from: addDays(today, -7),
      to: yesterday,
      counts: {
        "touch.sneaky": 6,
        "touch.bold": 2,
        "touch.back": 1,
        decl: 1,
        "decl.launch": 1,
        "decl.reach": 9,
        reply: 3,
        "reply.zhouli": 3,
        "place.main": 4,
        "place.clone": 1,
        "place.ink": 1,
        "guide.amiya": 2,
        "note.hug": 2,
      },
    });
    expect(d.records).toEqual({
      // the first time it was reached
      online: { n: 11, at: hourAt(yesterday, 20).getTime() },
      signups: { n: 5, day: OPEN_DAY },
      friendships: { n: 2, day: yesterday },
      touches: { n: 50, day: addDays(today, -8) },
      placed: { n: 6, day: earlier },
      reach: null,
    });
    expect(d.snapshot).toMatchObject({ day: today, at: now, players: 2 });
    expect(Object.keys(d.people).sort()).toEqual(["desk", "retention"]);
    const json = JSON.stringify(d);
    const own = await db.select({ id: roaches.id, publicId: roaches.publicId }).from(roaches);
    for (const secret of [a, "@example.com", ...own.flatMap((r) => [r.id, r.publicId])]) expect(json, secret).not.toContain(secret);
  });

  it("answers before anything was counted, with nothing made up", async () => {
    const d = await dashboard();
    expect(d.backfilled).toBe(false);
    expect(d.since).toEqual({ visitors: null, online: null });
    expect(d.today).toMatchObject({ counts: {}, online: null, peak: null });
    expect(d.snapshot).toBeNull();
    expect(Object.values(d.records).every((r) => r === null)).toBe(true);
    expect(d.totals.players).toBe(0);
    expect(d.days.every((x) => x.players === null && x.visitors === null && x.peakOnline === null && x.signups === 0)).toBe(true);
    expect(d.hours.today.every((h) => h === null)).toBe(true);
  });
});
