import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SI_AT, SI_ID, SI_LINES, STAMPS, stampAt } from "../si";
import { ROOMS, roomOf, STAY_MS } from "../siInn";
import { deleteAccount } from "./account";
import { db } from "./db";
import { pruneOldActivity } from "./retention";
import * as safety from "./safety";
import { allRoaches } from "./roachFeed";
import { amiyaTouches, declarations, radarScans, siInks, siTickets, siTouches, userBadges, users } from "./schema";
import * as si from "./si";
import { forgetInkSnapshot, inkTile } from "./siInk";
import { decodeTile, INK_TILE_ZOOM, tilesOver } from "../siTiles";
import { innNumbers, queueSpot, toLngLat } from "../siInn";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, wiped before every test

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const g = globalThis as typeof globalThis & { __siShift?: number; __siWrongNext?: boolean; __siToday?: number | null };
/** Her clock this far on (her table's rows, the stamp's day, the queue) */
const at = (ms: number) => {
  g.__siShift = ms;
};
/** A time zone whose device clock reads `hour` o'clock at her clock's now, within the ±14 h the server takes */
const offsetFor = (hour: number) => {
  const ahead = (hour - new Date(si.siNow()).getUTCHours() + 24) % 24;
  return -((ahead > 12 ? ahead - 24 : ahead) * 60);
};

async function signUp(email: string, avatar = "hood") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, avatar, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}
/** A touch at 14:00 on the device unless said otherwise */
const touch = (id: string, bold: boolean, offsetMin: number = offsetFor(14)) => world.touch(id, SI_ID, bold, offsetMin);
const rows = (id: string) => db.select().from(siTouches).where(eq(siTouches.userId, id)).orderBy(siTouches.createdAt);
const hers = async (id: string) => (await rows(id)).filter((r) => r.direction === "from_si");
/** Her answers to touches, without what she says about 缘缘庄 */
const answers = async (id: string) => (await hers(id)).filter((r) => !["checkin", "again", "checkout"].includes(r.kind));
const user = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const badges = async (id: string) => (await db.select().from(userBadges).where(eq(userBadges.userId, id))).map((b) => b.badge).sort();
const tickets = () => db.select().from(siTickets).orderBy(siTickets.n);

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${siTouches}, ${siTickets}, ${siInks} cascade`);
  at(0);
  g.__siWrongNext = false;
  si.pretendVisitors(null);
  si.forgetSiState();
  forgetInkSnapshot();
});

describe("祀掌柜", () => {
  it("answers the day's first touch the way she was touched, and not the rest of the day", async () => {
    const me = await signUp("me@example.com");
    const first = await touch(me, false);
    expect(first).toMatchObject({ newFriend: null, guide: { id: "si", bold: false, kind: "touch" } });
    expect(first.guide!.itemId).toMatch(/^i:/);
    const again = await touch(me, false);
    expect(again.guide!.itemId).toBeNull();
    const mine = await rows(me);
    expect(mine.filter((r) => r.direction === "to_si")).toHaveLength(2);
    expect(await answers(me)).toHaveLength(1);
    const [answer] = await answers(me);
    expect(answer).toMatchObject({ kind: "touch", bold: false });
    expect([0, 1, 2]).toContain(answer.line);
    const inbox = (await world.inbox(me)).filter((i) => i.kind === "si" && i.line === "touch");
    expect(inbox).toEqual([expect.objectContaining({ id: first.guide!.itemId, line: "touch", variant: answer.line, seen: false })]);
    // a new day by their device: answered again, boldly this time
    at(DAY);
    const bold = await touch(me, true);
    expect(bold).toMatchObject({ newFriend: "祀掌柜", guide: { kind: "friend", bold: true } });
  });

  it("makes the first bold touch 触须之交 whenever it comes, answered even after one today, and gives a portrait once", async () => {
    const me = await signUp("me@example.com");
    await touch(me, false);
    g.__siWrongNext = true;
    const made = await touch(me, true);
    expect(made).toMatchObject({ newFriend: "祀掌柜", guide: { kind: "friend" }, si: { portrait: "wrong", stamp: null } });
    expect(made.guide!.itemId).not.toBeNull();
    expect((await answers(me)).map((r) => r.kind)).toEqual(["touch", "friend"]);
    expect((await world.me(me))!.si).toMatchObject({ friend: true, portrait: { state: "wrong" }, stamps: 1, stampedToday: true });
    // then she answers as usual, once a day
    expect(await touch(me, true)).toMatchObject({ newFriend: null, guide: { itemId: null }, si: { portrait: null } });

    // 还给她 / 就不还, only while the portrait is hers by mistake
    await expect(si.answerPortrait(me, "nope")).rejects.toThrow("选一个吧。");
    expect(await si.answerPortrait(me, "return")).toEqual({ line: SI_LINES.portraitReturn });
    await expect(si.answerPortrait(me, "keep")).rejects.toThrow("这幅画已经说好了。");
    expect((await world.me(me))!.si.portrait).toMatchObject({ state: "returned" });

    // 解除 keeps the portrait and the stamps; back again, no new portrait
    const portraitAt = (await user(me)).siPortraitAt;
    await world.unfriend(me, SI_ID);
    expect((await world.me(me))!.si).toMatchObject({ friend: false, portrait: { state: "returned" }, stamps: 1 });
    at(DAY);
    expect(await touch(me, true)).toMatchObject({ newFriend: "祀掌柜", si: { portrait: null } });
    expect((await user(me)).siPortraitAt).toEqual(portraitAt);
    expect((await world.friends(me)).map((f) => f.id)).toContain(SI_ID);
  });

  it("gets the portrait right nine times in ten", { timeout: 60_000 }, async () => {
    const got: string[] = [];
    for (let i = 0; i < 60; i++) got.push((await touch(await signUp(`p${i}@example.com`), true)).si!.portrait!);
    expect(got.every((p) => p === "right" || p === "wrong")).toBe(true);
    // 60 tries: at least one right, and not all wrong
    expect(got.filter((p) => p === "right").length).toBeGreaterThan(40);
    const kept = await signUp("kept@example.com");
    g.__siWrongNext = true;
    await touch(kept, true);
    expect(await si.answerPortrait(kept, "keep")).toEqual({ line: SI_LINES.portraitKeep });
    expect((await world.me(kept))!.si.portrait).toMatchObject({ state: "kept" });
    // a right one was never wrong, so nothing to answer
    const right = await signUp("right@example.com");
    await touch(right, false);
    await expect(si.answerPortrait(right, "return")).rejects.toThrow("这幅画已经说好了。");
  });

  it("answers a new 触须之交 first, a 触须之交 back after 14 or 3 days, the small hours, then as usual", async () => {
    const me = await signUp("me@example.com");
    expect((await touch(me, true, offsetFor(2))).guide!.kind).toBe("friend");
    at(14 * DAY);
    await touch(me, false, offsetFor(2));
    at(14 * DAY + 3 * DAY);
    await touch(me, false, offsetFor(2));
    at(14 * DAY + 4 * DAY);
    await touch(me, false, offsetFor(2));
    at(14 * DAY + 5 * DAY);
    await touch(me, false, offsetFor(14));
    expect((await answers(me)).map((r) => r.kind)).toEqual(["friend", "longaway", "away", "night", "touch"]);
    // days away mean nothing to her before you are 触须之交
    const other = await signUp("other@example.com");
    await touch(other, false);
    at(14 * DAY + 5 * DAY + 20 * DAY);
    await touch(other, false);
    expect((await answers(other)).map((r) => r.kind)).toEqual(["touch", "touch"]);
  });

  it("allows 20 touches in any 24 hours, her own count, and says so in her words", async () => {
    const me = await signUp("me@example.com");
    for (let i = 0; i < 20; i++) await touch(me, false);
    await expect(touch(me, false)).rejects.toThrow("碰、碰够了没有！今天不许再碰了，明天再来。");
    // the other guides count their own
    expect(await world.touch(me, "amiya", false)).toMatchObject({ guide: { id: "amiya" } });
    expect(await db.select().from(amiyaTouches).where(eq(amiyaTouches.userId, me))).toHaveLength(2);
    at(DAY + 1000);
    await expect(touch(me, false)).resolves.toBeTruthy();
  });

  it("stamps the day's first answer, once a day by the device, in the player's own order, and never starts over", async () => {
    const me = await signUp("me@example.com");
    const first = await touch(me, false);
    expect(first.si!.stamp).toEqual({ stamp: stampAt(me, 0), stamps: 1 });
    expect((await touch(me, true)).si!.stamp).toBeNull();
    expect((await answers(me)).map((r) => [r.kind, r.stamp, r.stamps])).toEqual([
      ["touch", stampAt(me, 0), 1],
      ["friend", null, null],
    ]);
    expect((await user(me)).siStamps).toBe(1);
    // 32 days, some skipped: 31 stamps, the 30th 「祀」, then the round again
    let day = 1;
    for (let k = 1; k < 31; k++) {
      day += k % 7 === 0 ? 3 : 1;
      at(day * DAY);
      const res = await touch(me, false);
      expect(res.si!.stamp).toEqual({ stamp: stampAt(me, k), stamps: k + 1 });
    }
    const all = (await answers(me)).filter((r) => r.stamp !== null).map((r) => r.stamp!);
    expect(all).toHaveLength(31);
    expect(new Set(all.slice(0, 30)).size).toBe(30);
    expect(STAMPS[all[29]]).toBe("祀");
    expect(all[30]).toBe(all[0]);
    const m = (await world.me(me))!.si;
    expect(m).toMatchObject({ stamps: 31, stampedToday: true });
    // the next day by the device, not yet
    at((day + 1) * DAY);
    expect((await world.me(me))!.si.stampedToday).toBe(false);
  });

  it("draws one ink roach in the player's look the first time, for good, whatever they change later", async () => {
    const me = await signUp("me@example.com", "gugu");
    const res = await Promise.all([touch(me, false), touch(me, false)]);
    expect(res.filter((r) => r.si!.inn.drawn)).toHaveLength(1);
    expect(await db.select().from(siInks)).toEqual([expect.objectContaining({ no: 1, userId: me, look: "gugu", ticket: 1 })]);
    await db.update(users).set({ avatar: "doctor" }).where(eq(users.id, me));
    await touch(me, true);
    expect(await db.select().from(siInks)).toEqual([expect.objectContaining({ no: 1, look: "gugu" })]);
    expect((await world.me(me))!.si.inn).toMatchObject({ inkNo: 1, look: "gugu" });

    // the account goes, the ink roach stays in the painting, nobody's; her lines go with them
    await deleteAccount(await user(me));
    expect(await db.select().from(siInks)).toEqual([expect.objectContaining({ no: 1, userId: null, look: "gugu" })]);
    expect(await db.select().from(siTouches)).toEqual([]);
  });

  it("gives out places with no gaps or twins when many come at once, the first 2500 straight into their rooms", async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => signUp(`p${i}@example.com`)));
    const res = await Promise.all(ids.map((id) => touch(id, false)));
    const ts = await tickets();
    expect(ts.map((t) => t.n)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(new Set(ts.map((t) => t.inkNo)).size).toBe(12);
    for (const r of res) expect(r.si!.inn).toMatchObject({ drawn: true, event: "in", place: null });
    expect(new Set(res.map((r) => r.si!.inn.room))).toEqual(new Set(ts.map((t) => roomOf(t.n))));
    // straight in: her line said at once, the minute job adds nothing
    expect(ts.every((t) => t.saidIn)).toBe(true);
    for (const id of ids) expect((await hers(id)).map((r) => r.kind)).toEqual(["touch", "checkin"]);
    expect(await si.innMinute()).toBe(0);
    for (const id of ids) {
      expect((await hers(id)).map((r) => [r.kind, r.waited])).toEqual([
        ["touch", null],
        ["checkin", 0],
      ]);
      expect(await badges(id)).toEqual(["siinn"]);
      expect((await world.me(id))!.si).toMatchObject({ stayed: true, inn: { state: "stay" } });
    }
  });

  it("queues the 2501st, who gets room 1 the moment its first guest leaves, told by the minute job once", { timeout: 60_000 }, async () => {
    await si.pretendCrowd(ROOMS);
    const me = await signUp("me@example.com");
    const res = await touch(me, false);
    expect(res.si!.inn).toMatchObject({ drawn: true, event: "queued", room: null, place: 1 });
    const [first] = await tickets();
    const mine = (await tickets()).at(-1)!;
    expect(mine).toMatchObject({ n: ROOMS + 1, saidIn: false, again: false });
    expect(mine.checkinAt.getTime()).toBe(first.checkinAt.getTime() + STAY_MS);
    expect(await badges(me)).toEqual(["siqueue"]);
    expect((await world.me(me))!.si).toMatchObject({ stayed: false, inn: { state: "queue", place: 1, checkinAt: mine.checkinAt.getTime() } });
    // queuing: another touch gives no second place
    await touch(me, false);
    expect(await tickets()).toHaveLength(ROOMS + 1);

    // half a day on, it is in room 1, told once however often the job runs
    at(STAY_MS);
    expect((await world.me(me))!.si).toMatchObject({ stayed: true, inn: { state: "stay", room: 1 } });
    await si.innMinute();
    await si.innMinute();
    // queued a moment after the first guest went in
    const waited = Math.floor((mine.checkinAt.getTime() - mine.queuedAt.getTime()) / 60_000);
    expect(waited).toBeGreaterThanOrEqual(STAY_MS / 60_000 - 1);
    expect((await hers(me)).map((r) => [r.kind, r.room, r.waited])).toEqual([
      ["touch", null, null],
      ["checkin", 1, waited],
    ]);
    expect(await badges(me)).toEqual(["siinn", "siqueue"]);
    expect((await user(me)).siStayedAt?.getTime()).toBe(mine.checkinAt.getTime());
    const [said] = (await hers(me)).filter((r) => r.kind === "checkin");
    expect(said.createdAt.getTime()).toBe(mine.checkinAt.getTime());
    // staying: still no second place
    await touch(me, false);
    expect(await tickets()).toHaveLength(ROOMS + 1);

    // and out half a day later, dated when it happened even though the job only runs later
    at(3 * STAY_MS);
    await si.innMinute();
    const out = (await hers(me)).filter((r) => r.kind === "checkout");
    expect(out).toEqual([expect.objectContaining({ room: 1, createdAt: new Date(mine.checkinAt.getTime() + STAY_MS) })]);
    expect((await world.me(me))!.si.inn).toMatchObject({ state: "out", inkNo: ROOMS + 1 });
    await si.innMinute();
    expect((await hers(me)).filter((r) => r.kind === "checkout")).toHaveLength(1);

    // outside, a touch queues it again: a returning guest, no second badge
    const back = await touch(me, true);
    expect(back.si!.inn).toMatchObject({ drawn: false, event: "in" });
    expect((await tickets()).at(-1)).toMatchObject({ n: ROOMS + 2, inkNo: ROOMS + 1, again: true, saidIn: true });
    expect((await hers(me)).map((r) => r.kind).slice(-2)).toEqual(["friend", "again"]);
    expect(await badges(me)).toEqual(["siinn", "siqueue"]);
    expect((await db.select().from(siInks).where(eq(siInks.no, ROOMS + 1)))[0].ticket).toBe(ROOMS + 2);
  });

  it("counts the queue, the rooms and the fields from four numbers, the same as one by one", { timeout: 120_000 }, async () => {
    // a random crowd coming over 3 days, and touching again when out
    const players = await Promise.all(Array.from({ length: 30 }, (_, i) => signUp(`p${i}@example.com`)));
    await si.pretendCrowd(ROOMS - 5);
    let t = 0;
    const rand = mulberry(7);
    for (let step = 0; step < 40; step++) {
      t += Math.floor(rand() * 4 * HOUR);
      at(t);
      for (const id of players) if (rand() < 0.3) await touch(id, false).catch(() => {});
      const now = si.siNow();
      const counts = await countsAt(now);
      const one = await oneByOne(now);
      expect(counts).toEqual(one);
      expect(counts.staying).toBeLessThanOrEqual(ROOMS);
    }
  });

  it("hands out the ink roaches by tile: where and how each is drawn, nothing whose, the same for everyone", { timeout: 60_000 }, async () => {
    await si.pretendCrowd(ROOMS + 300);
    const me = await signUp("me@example.com", "imp");
    await touch(me, false);
    const tiles = tilesOver({ lng: 117.97, lat: 29.99 }, { lng: 118.0, lat: 30.02 }, INK_TILE_ZOOM, 400);
    const all = [];
    for (const t of tiles) {
      const bytes = await inkTile(t.x, t.y);
      expect(await inkTile(t.x, t.y)).toEqual(bytes);
      all.push(...decodeTile(t.x, t.y, INK_TILE_ZOOM, bytes));
    }
    expect(all).toHaveLength(ROOMS + 301);
    expect(Object.keys(all[0]).sort()).toEqual(["ink", "lat", "left", "lng", "look", "size", "state", "tilt"]);
    const { queue, staying } = innNumbers(await si.siState());
    expect(all.filter((p) => p.state === 0)).toHaveLength(queue);
    expect(all.filter((p) => p.state === 1)).toHaveLength(staying);
    // the last in the queue, mine, stands where the queue's last place is
    const last = toLngLat(queueSpot(queue).x, queueSpot(queue).y);
    expect(all.some((p) => p.look === 3 && Math.abs(p.lng - last.lng) < 1e-6 && Math.abs(p.lat - last.lat) < 1e-6)).toBe(true);
  });

  it("lets a player say her two declarations from the moment their ink roach has a room, and for good", { timeout: 60_000 }, async () => {
    const me = await signUp("me@example.com");
    await world.placeRoach(me, { kind: "main" }, { lng: 121.4737, lat: 31.2304 });
    await expect(world.declare(me, { template: "sihouse" })).rejects.toThrow("住进缘缘庄就能发。");
    await si.pretendCrowd(ROOMS);
    await touch(me, false);
    expect((await world.me(me))!.si).toMatchObject({ stayed: false, inn: { state: "queue" } });
    await expect(world.declare(me, { template: "simine" })).rejects.toThrow("住进缘缘庄就能发。");
    // in its room: at once, before the minute job has said so
    at(STAY_MS);
    expect((await world.me(me))!.si.stayed).toBe(true);
    await expect(world.declare(me, { template: "simine" })).resolves.toMatchObject({ reach: expect.any(String) });
    // out again, still theirs (the last one taken back, as one a moment ago would wait)
    await db.delete(declarations).where(eq(declarations.senderId, me));
    at(3 * STAY_MS);
    await si.innMinute();
    expect((await world.me(me))!.si).toMatchObject({ stayed: true, inn: { state: "out" } });
    await expect(world.declare(me, { template: "sihouse" })).resolves.toMatchObject({ reach: expect.any(String) });
  });

  it("keeps her lines 90 days like any guide's; the ink roaches and tickets stay", async () => {
    const me = await signUp("me@example.com");
    await touch(me, false);
    await db.update(siTouches).set({ createdAt: sql`${siTouches.createdAt} - interval '91 days'` });
    await pruneOldActivity();
    expect(await rows(me)).toEqual([]);
    expect(await db.select().from(siInks)).toHaveLength(1);
    expect(await tickets()).toHaveLength(1);
  });

  it("cannot be blocked, reported or poked, and is fifth among the 触须之交", async () => {
    const me = await signUp("me@example.com");
    const made = await touch(me, true);
    await expect(safety.block(me, `friend:${SI_ID}`)).rejects.toThrow("祀掌柜不是真人，不用拉黑。");
    await expect(safety.block(me, made.guide!.itemId!)).rejects.toThrow("祀掌柜不是真人，不用拉黑。");
    await expect(safety.reportRoach(me, SI_ID, "place", "")).rejects.toThrow("祀掌柜是站里的向导，不用举报。");
    await expect(world.poke(me, SI_ID)).rejects.toThrow("祀掌柜一直醒着，碰碰她吧。");
    for (const id of ["amiya", "perlica", "talulah", "minghe"]) await world.touch(me, id, true);
    expect((await world.friends(me)).map((f) => f.id)).toEqual(["amiya", "perlica", "talulah", "minghe", SI_ID]);
    // 满编小队 still counts the four
    expect((await world.me(me))!.counts.guideFriends).toBe(4);
    expect(await badges(me)).not.toContain("si");
  });

  it("is never counted on the radar, nor are the ink roaches, and is never in the shared roach list", async () => {
    const me = await signUp("me@example.com");
    await world.placeRoach(me, { kind: "main" }, { lng: SI_AT.lng + 0.004, lat: SI_AT.lat + 0.002 });
    const before = (await world.radar(me))!;
    await touch(me, true);
    await si.pretendCrowd(ROOMS + 500);
    await db.update(radarScans).set({ createdAt: sql`${radarScans.createdAt} - interval '11 minutes'` });
    expect(await world.radar(me)).toMatchObject({ roaches: before.roaches, players: before.players, friendsNearby: 0 });
    expect(JSON.stringify(await allRoaches())).not.toMatch(/"si"/);
  });

  it("counts today's visitors by Beijing day from 04:00, each once", async () => {
    const a = await signUp("a@example.com");
    const b = await signUp("b@example.com");
    await touch(a, false);
    await touch(a, true);
    await touch(b, false);
    expect(await si.todaysVisitors()).toBe(2);
    si.pretendVisitors(8000);
    expect(await si.todaysVisitors()).toBe(8000);
    si.pretendVisitors(null);
    at(DAY);
    expect(await si.todaysVisitors(si.siNow())).toBe(0);
  });

  it("forgets a player in development, leaving their ink roach in the painting, nobody's", async () => {
    const me = await signUp("me@example.com");
    await touch(me, true);
    await si.forgetSi(me);
    expect(await rows(me)).toEqual([]);
    expect((await world.me(me))!.si).toMatchObject({ friend: false, portrait: null, stamps: 0, inn: null, stayed: false });
    expect(await db.select().from(siInks)).toEqual([expect.objectContaining({ no: 1, userId: null })]);
    // touched again, a new one is drawn
    expect((await touch(me, false)).si!.inn).toMatchObject({ drawn: true });
    expect(await db.select().from(siInks)).toHaveLength(2);
    await si.clearInn();
    expect(await db.select().from(siInks)).toEqual([]);
    expect(await tickets()).toEqual([]);
  });
});

/** The four numbers and what follows from them (3.6) */
async function countsAt(now: number) {
  const [{ d }] = await db.select({ d: sql<number>`coalesce(max(${siInks.no}), 0)::int` }).from(siInks);
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${siTickets.n}), 0)::int` }).from(siTickets);
  const c = await si.checkedInBy(db, now);
  const o = await si.checkedInBy(db, now - STAY_MS);
  return { queue: n - c, staying: c - o, outside: d - (n - o) };
}

/** The same, ink roach by ink roach, from its latest ticket */
async function oneByOne(now: number) {
  const inks = await db.select({ ticket: siInks.ticket, checkinAt: siTickets.checkinAt }).from(siInks).innerJoin(siTickets, eq(siTickets.n, siInks.ticket));
  let queue = 0;
  let staying = 0;
  let outside = 0;
  for (const i of inks) {
    const inAt = i.checkinAt.getTime();
    if (inAt > now) queue++;
    else if (inAt + STAY_MS > now) staying++;
    else outside++;
  }
  return { queue, staying, outside };
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
