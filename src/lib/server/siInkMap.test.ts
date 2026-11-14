import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_PROFILE } from "../profile";
import { MAX_CLONES, TOUCHES_PER_DAY } from "../rules";
import { INK_DECLARATIONS, INK_FROM, INK_PREFIX, RECALL_REST_MS, SI_ID } from "../si";
import { INN_CENTER, inkNow, innNumbers, ROOMS, STAY_MS } from "../siInn";
import { decodeTile, INK_BYTES, INK_TILE_ZOOM, tapOf, tilesOver, type InkPoint } from "../siTiles";
import type { LngLat } from "../types";
import { deleteAccount } from "./account";
import { db } from "./db";
import { forgetNearInn, spotRows, visibleDeclarations } from "./declarationInbox";
import { resetRoachFeed, roachCounts } from "./roachFeed";
import { blocks, declarations, declarationSpots, friendships, roaches, siInks, siTickets, siTouches, touches, userBadges, users } from "./schema";
import * as si from "./si";
import { forgetInkSnapshot, inkTile } from "./siInk";
import * as world from "./world";

// 墨小强 on the map (祀 round 2, block 3): tapped, touched, recalled, counted among the clones, declared from.
// Runs against the database named in vitest.config.mts, wiped before every test.

const HOUR = 3_600_000;
const g = globalThis as typeof globalThis & { __siShift?: number; __siWrongNext?: boolean };
/** Her clock this far on */
const at = (ms: number) => {
  g.__siShift = ms;
};
/** A time zone whose device clock reads `hour` o'clock at her clock's now */
const offsetFor = (hour: number) => {
  const ahead = (hour - new Date(si.siNow()).getUTCHours() + 24) % 24;
  return -((ahead > 12 ? ahead - 24 : ahead) * 60);
};

const SHANGHAI = { lng: 121.4737, lat: 31.2304 };
const TOKYO = { lng: 139.7, lat: 35.68 };
/** About 5 km from 缘缘庄: within reach of what is said there */
const NEAR_INN = { lng: 118.03, lat: 30.03 };
/** Somewhere for a clone, a kilometre or so apart from the others */
const spot = (i: number): LngLat => ({ lng: SHANGHAI.lng + 0.01 * (i + 1), lat: SHANGHAI.lat });

async function signUp(email: string, avatar = "hood") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, avatar, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}
const touchSi = (id: string, bold = false) => world.touch(id, SI_ID, bold, offsetFor(14));
const herCard = async (id: string) => (await world.me(id, offsetFor(14)))!.si;
const user = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const inkRow = async (id: string) => (await db.select().from(siInks).where(eq(siInks.userId, id)))[0];
const tickets = () => db.select().from(siTickets).orderBy(siTickets.n);
const ticket = async (n: number) => (await tickets()).find((t) => t.n === n)!;
/** What she said to them, in order */
const herLines = async (id: string) =>
  (
    await db
      .select({ kind: siTouches.kind })
      .from(siTouches)
      .where(and(eq(siTouches.userId, id), eq(siTouches.direction, "from_si")))
      .orderBy(siTouches.createdAt)
  ).map((r) => r.kind);
const badges = async (id: string) => (await db.select().from(userBadges).where(eq(userBadges.userId, id))).map((b) => b.badge).sort();
/** A main roach and `clones` clones */
async function withRoaches(id: string, clones: number) {
  await world.placeRoach(id, { kind: "main" }, SHANGHAI);
  for (let i = 0; i < clones; i++) await world.placeRoach(id, { kind: "clone" }, spot(i));
}
const clonesOf = async (id: string) => (await world.me(id))!.roaches.filter((r) => r.slot > 0);

/** The village's tiles: every ink roach of a small crowd stands on one of them */
const VILLAGE = tilesOver({ lng: 117.97, lat: 29.99 }, { lng: 118.0, lat: 30.02 }, INK_TILE_ZOOM, 400);
async function onTiles(read: (x: number, y: number) => Promise<Uint8Array> = inkTile) {
  const all: InkPoint[] = [];
  for (const t of VILLAGE) {
    const bytes = await read(t.x, t.y);
    expect(bytes.length % INK_BYTES).toBe(0);
    all.push(...decodeTile(t.x, t.y, INK_TILE_ZOOM, bytes));
  }
  return all;
}
/** Their ink roach on the tiles, by the tap number me() gives them */
const theirsOnTiles = async (id: string) => {
  const tap = (await herCard(id)).inn!.tap;
  return (await onTiles()).filter((p) => p.tap === tap);
};
/** A tap on it, as the page asks: by what its tile gave */
const tap = (id: string, p: InkPoint) => world.tapInk(id, p.x, p.y, p.tap, p.fx, p.fy);
/** Their ink roach as somebody else would touch it */
const inkId = async (id: string) => INK_PREFIX + (await inkRow(id)).publicId;

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${roaches}, ${touches}, ${blocks}, ${declarations}, ${declarationSpots}, ${siTouches}, ${siTickets}, ${siInks} cascade`);
  at(0);
  g.__siWrongNext = false;
  si.pretendVisitors(null);
  si.forgetSiState();
  forgetInkSnapshot();
  forgetNearInn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("墨小强 on the map", () => {
  it("sends each ink roach in 12 bytes with its tap number and none held, another process leaving one recalled out after its next refresh", async () => {
    const a = await signUp("a@example.com", "imp");
    const b = await signUp("b@example.com");
    await touchSi(a);
    await touchSi(b);
    const card = await herCard(a);
    expect(card.inn).toMatchObject({ state: "stay", tap: tapOf((await inkRow(a)).publicId) });
    const all = await onTiles();
    expect(all).toHaveLength(2);
    expect(all.filter((p) => p.tap === card.inn!.tap)).toEqual([expect.objectContaining({ look: 3, state: 1 })]);
    const bTap = tapOf((await inkRow(b)).publicId);

    // another process, which has the tiles from before the recall
    vi.resetModules();
    const other = await import("./siInk");
    expect(await onTiles(other.inkTile)).toHaveLength(2);
    await si.recallInk(a);
    // this one at its next ask; the other only at its next refresh, half a minute on
    expect((await onTiles()).map((p) => p.tap)).toEqual([bTap]);
    expect(await onTiles(other.inkTile)).toHaveLength(2);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);
    expect((await onTiles(other.inkTile)).map((p) => p.tap)).toEqual([bTap]);
    vi.useRealTimers();

    // one drawn while its owner has five clones waits off the map
    const c = await signUp("c@example.com");
    await withRoaches(c, MAX_CLONES);
    expect((await touchSi(c)).si!.inn).toMatchObject({ drawn: true, event: "full", room: null, place: null });
    expect(await inkRow(c)).toMatchObject({ ticket: null, recalledAt: null });
    expect((await herCard(c)).inn).toMatchObject({ state: "held", recalledAt: null });
    expect((await onTiles()).map((p) => p.tap)).toEqual([bTap]);
    // a page from before "held", still open after the update, takes it for a stay long over: lying at home, not nowhere
    const held = (await herCard(c)).inn!;
    expect(inkNow(held as unknown as Parameters<typeof inkNow>[0], null, si.siNow())).toMatchObject({ state: 2, at: held.home, until: null });
  });

  it("tells whoever taps an ink roach what it is to them: theirs, a 触须之交's by name, anyone's, or nobody's, and no more", async () => {
    const a = await signUp("a@example.com");
    const friend = await signUp("f@example.com");
    const stranger = await signUp("s@example.com");
    await world.saveProfile(a, { ...EMPTY_PROFILE, anonymous: false, name: "阿白" });
    const [aMain] = await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    const [fMain] = await world.placeRoach(friend, { kind: "main" }, TOKYO);
    await world.touch(a, fMain.publicId, true);
    expect((await world.touch(friend, aMain.publicId, true)).newFriend).not.toBeNull();
    await touchSi(a);
    const [p] = await theirsOnTiles(a);
    const id = await inkId(a);

    const mine = await tap(a, p);
    expect(mine).toEqual({ state: "stay", mine: true, friend: null, gone: false, id: null });
    const [listed] = await world.friends(friend);
    const theirs = await tap(friend, p);
    expect(theirs).toEqual({ state: "stay", mine: false, friend: { id: listed.id, name: listed.profile.displayName }, gone: false, id });
    expect(listed.profile.displayName).toContain("阿白");
    const anyones = await tap(stranger, p);
    expect(anyones).toEqual({ state: "stay", mine: false, friend: null, gone: false, id });
    // nothing of whose it is, nor which she drew
    const no = String((await inkRow(a)).no);
    for (const r of [mine, theirs, anyones]) {
      expect(JSON.stringify(r)).not.toContain(a);
      expect(Object.values(r)).not.toContain(Number(no));
    }

    // a tap number nobody has now, or nonsense
    await expect(tap(stranger, { ...p, tap: (p.tap + 1) >>> 0 })).rejects.toThrow("它被收回去了。");
    await expect(world.tapInk(stranger, -1, p.y, p.tap, p.fx, p.fy)).rejects.toThrow("请求格式不对。");
    await expect(world.tapInk(stranger, p.x, p.y, p.tap, 2, p.fy)).rejects.toThrow("请求格式不对。");
    await expect(world.tapInk(stranger, p.x, p.y, "1", p.fx, p.fy)).rejects.toThrow("请求格式不对。");

    // its owner gone, it is nobody's, and not to be touched
    await deleteAccount(await user(a));
    expect(await tap(stranger, p)).toEqual({ state: "stay", mine: false, friend: null, gone: true, id: null });
    await expect(world.touch(stranger, id, false)).rejects.toThrow("这只墨小强的主人已经不在了。");
  });

  it("takes touches on an ink roach as on one of its owner's clones, said in 消息 as 墨小强", async () => {
    const a = await signUp("a@example.com");
    const b = await signUp("b@example.com");
    await withRoaches(a, 1);
    const [aMain, aClone] = (await world.me(a))!.roaches.sort((x, y) => x.slot - y.slot);
    await touchSi(a);
    const id = await inkId(a);

    await expect(world.touch(a, id, false)).rejects.toThrow("这是你自己的蟑螂。");
    expect(await world.touch(b, id, false)).toMatchObject({ newFriend: null });
    expect((await world.inbox(a)).filter((i) => i.kind === "touch")).toEqual([
      expect.objectContaining({ kind: "touch", target: "ink", bold: false, from: null }),
    ]);
    expect(await db.select({ toSlot: touches.toSlot }).from(touches)).toEqual([{ toSlot: -1 }]);
    // once a day each, a bold one after a sneaky one to say who it was
    await expect(world.touch(b, id, false)).rejects.toThrow("今天已经偷偷碰过这只蟑螂了。");
    expect(await world.touch(b, id, true)).toMatchObject({ newFriend: null });
    await expect(world.touch(b, id, true)).rejects.toThrow("今天已经碰过这只蟑螂了，北京时间凌晨 4 点刷新。");
    // a few a day on one player's roaches, 墨小强 among them
    await world.touch(b, aMain.publicId, false);
    await expect(world.touch(b, aClone.publicId, false)).rejects.toThrow("今天已经碰过这只蟑螂的主人 3 次了，北京时间凌晨 4 点刷新。");

    // b's bold touch on it counts as on any roach of a's: a touching b boldly back makes them 触须之交
    await world.placeRoach(b, { kind: "main" }, TOKYO);
    const [bMain] = (await world.me(b))!.roaches;
    expect((await world.touch(a, bMain.publicId, true)).newFriend).not.toBeNull();
    expect(await db.select().from(friendships)).toHaveLength(1);
    // and a day on, it may be touched again
    await db.update(touches).set({ createdAt: sql`${touches.createdAt} - interval '25 hours'` });
    expect(await world.touch(b, id, false)).toMatchObject({ newFriend: null });

    // between a blocked pair it looks sent, and never arrives
    const c = await signUp("c@example.com");
    await db.insert(blocks).values({ blockerId: a, blockedId: c });
    const seen = (await world.inbox(a)).length;
    expect(await world.touch(c, id, true)).toMatchObject({ newFriend: null });
    expect(await world.inbox(a)).toHaveLength(seen);
    expect((await db.select().from(touches).where(eq(touches.fromUserId, c)))[0]).toMatchObject({ withheld: true, toSlot: -1 });

    // the day's touches in all, as anywhere
    const d = await signUp("d@example.com");
    await db.insert(touches).values(Array.from({ length: TOUCHES_PER_DAY }, () => ({ fromUserId: d, toUserId: b, bold: false, toSlot: 0, toPublicId: randomUUID() })));
    await expect(world.touch(d, id, false)).rejects.toThrow("今天的触须用完啦，北京时间凌晨 4 点刷新。");

    // none such, or recalled
    await expect(world.touch(b, `${INK_PREFIX}${randomUUID()}`, false)).rejects.toThrow("它被收回去了。");
    await expect(world.touch(b, `${INK_PREFIX}nonsense`, false)).rejects.toThrow("它被收回去了。");
    await si.recallInk(a);
    await expect(world.touch(c, id, false)).rejects.toThrow("它被收回去了。");
  });

  it("recalls one queuing, staying or out, nobody else's place or time moving, the minute job quiet about it", { timeout: 60_000 }, async () => {
    await si.pretendCrowd(ROOMS);
    const a = await signUp("a@example.com");
    const b = await signUp("b@example.com");
    const c = await signUp("c@example.com");
    for (const id of [a, b, c]) expect((await touchSi(id)).si!.inn).toMatchObject({ event: "queued" });
    const before = (await tickets()).map((t) => [t.n, t.checkinAt.getTime()]);

    // a queuing: its ticket void, its place left empty
    await si.recallInk(a);
    expect((await tickets()).map((t) => [t.n, t.checkinAt.getTime()])).toEqual(before);
    expect(await ticket(ROOMS + 1)).toMatchObject({ saidIn: true, saidOut: true, recalledAt: expect.any(Date) });
    expect((await tickets()).filter((t) => t.recalledAt).map((t) => t.n)).toEqual([ROOMS + 1]);
    expect((await herCard(a)).inn).toMatchObject({ state: "held", recalledAt: expect.any(Number) });
    expect((await herCard(b)).inn).toMatchObject({ state: "queue", place: 2 });
    const queuing = await si.siState();
    expect(queuing).toMatchObject({ held: 1, empty: { queue: 1, rooms: 0 } });
    expect(innNumbers(queuing)).toMatchObject({ queue: 2, places: 3, staying: ROOMS, outside: 0 });
    await expect(si.recallInk(a)).rejects.toThrow("墨小强已经不在地图上了。");
    await expect(si.recallInk(await signUp("nobody@example.com"))).rejects.toThrow("墨小强已经不在地图上了。");

    // half a day on, b and c in their rooms and told so; a's room empty, nothing said to a, no badge
    at(STAY_MS);
    await si.innMinute();
    expect(await herLines(a)).toEqual(["touch"]);
    expect(await herLines(b)).toEqual(["touch", "checkin"]);
    expect(await badges(a)).toEqual(["siqueue"]);
    expect(await badges(b)).toEqual(["siinn", "siqueue"]);
    expect((await user(a)).siStayedAt).toBeNull();
    si.forgetSiState();
    expect((await si.siState()).empty).toEqual({ queue: 0, rooms: 1 });

    // b staying: out early, its room empty till it was due out, never told it left
    at(STAY_MS + HOUR);
    await si.recallInk(b);
    expect(await ticket(ROOMS + 2)).toMatchObject({ saidOut: true, recalledAt: expect.any(Date) });
    expect((await herCard(b)).stayed).toBe(true);
    si.forgetSiState();
    const staying = await si.siState();
    expect(staying.empty).toEqual({ queue: 0, rooms: 2 });
    // the crowd out by now, c the one left in a room
    expect(innNumbers(staying)).toMatchObject({ queue: 0, staying: 1, outside: ROOMS });
    at(2 * STAY_MS + HOUR);
    await si.innMinute();
    expect(await herLines(b)).toEqual(["touch", "checkin"]);
    expect(await herLines(c)).toEqual(["touch", "checkin", "checkout"]);
    si.forgetSiState();
    expect((await si.siState()).empty).toEqual({ queue: 0, rooms: 0 });

    // c out in the fields: taken in, its ticket as it was
    await si.recallInk(c);
    expect((await ticket(ROOMS + 3)).recalledAt).toBeNull();
    expect((await herCard(c)).inn).toMatchObject({ state: "held" });
    expect(await si.siState()).toMatchObject({ held: 3 });

    // twelve hours after their recalls, straight into rooms: a for the first time, never having stayed; b again
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: false, event: "in" });
    expect((await touchSi(b)).si!.inn).toMatchObject({ drawn: false, event: "in" });
    expect((await tickets()).slice(-2)).toEqual([
      expect.objectContaining({ inkNo: (await inkRow(a)).no, again: false, recalledAt: null }),
      expect.objectContaining({ inkNo: (await inkRow(b)).no, again: true, recalledAt: null }),
    ]);
    expect((await herLines(a)).slice(-1)).toEqual(["checkin"]);
    expect((await herLines(b)).slice(-1)).toEqual(["again"]);
    expect(await inkRow(a)).toMatchObject({ recalledAt: null });
    expect(await badges(a)).toEqual(["siinn", "siqueue"]);
  });

  it("rests twelve hours after a recall, then queues at the end of the queue", { timeout: 60_000 }, async () => {
    await si.pretendCrowd(2 * ROOMS);
    const a = await signUp("a@example.com");
    expect((await touchSi(a)).si!.inn).toMatchObject({ event: "queued", place: ROOMS + 1 });
    await si.recallInk(a);
    const recalledAt = (await inkRow(a)).recalledAt!.getTime();
    const b = await signUp("b@example.com");
    expect((await touchSi(b)).si!.inn).toMatchObject({ event: "queued", place: ROOMS + 2 });

    // her clock a little short of twelve hours after: resting, nothing given
    at(recalledAt + RECALL_REST_MS - 60_000 - Date.now());
    const resting = await touchSi(a);
    expect(resting.si!.inn).toMatchObject({ drawn: false, event: "resting", room: null, place: null });
    expect(resting.si!.you).toMatchObject({ state: "held", recalledAt });
    expect(await tickets()).toHaveLength(2 * ROOMS + 2);

    // a little past: the next number, behind b, the empty place still counted ahead of both
    at(recalledAt + RECALL_REST_MS + 60_000 - Date.now());
    const back = await touchSi(a);
    expect(back.si!.inn).toMatchObject({ drawn: false, event: "queued", place: 3 });
    expect(back.si!.you).toMatchObject({ state: "queue", n: 2 * ROOMS + 3 });
    expect((await herCard(b)).inn).toMatchObject({ state: "queue", place: 2 });
    expect(await ticket(2 * ROOMS + 3)).toMatchObject({ inkNo: (await inkRow(a)).no, again: false });
    expect((await ticket(2 * ROOMS + 3)).checkinAt.getTime()).toBeGreaterThanOrEqual((await ticket(2 * ROOMS + 2)).checkinAt.getTime());
  });

  it("rests the twelve hours whatever the day: recalled at 03:50 in Beijing, still resting at 04:10 as her day turns", async () => {
    const BEIJING = -480;
    // tomorrow's midnight in Beijing, and her clock pinned to a time of that day
    const bj = new Date(Date.now() + 8 * HOUR);
    const midnight = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + 1) - 8 * HOUR;
    const pin = (h: number, m: number) => at(midnight + h * HOUR + m * 60_000 - Date.now());
    const touchAt = (id: string) => world.touch(id, SI_ID, false, BEIJING);
    const a = await signUp("a@example.com");
    pin(3, 40);
    const first = await touchAt(a);
    expect(first.si).toMatchObject({ stamp: { stamps: 1 }, inn: { event: "in" } });
    pin(3, 50);
    await si.recallInk(a);
    // a new day by her: answered and stamped again, but 墨小强 rests
    pin(4, 10);
    const next = await touchAt(a);
    expect(next.guide!.itemId).not.toBeNull();
    expect(next.si).toMatchObject({ stamp: { stamps: 2 }, inn: { event: "resting" } });
    pin(15, 45);
    expect((await touchAt(a)).si!.inn.event).toBe("resting");
    // twelve hours after the recall, back into a room as a returning guest
    pin(15, 55);
    expect((await touchAt(a)).si!.inn).toMatchObject({ event: "in" });
    expect((await tickets()).at(-1)).toMatchObject({ n: 2, again: true });
  });

  it("counts 墨小强 among the five clones while it is on the map, and holds it while they are five", async () => {
    const a = await signUp("a@example.com");
    await withRoaches(a, MAX_CLONES - 1);
    await touchSi(a);
    await expect(world.placeRoach(a, { kind: "clone" }, spot(7))).rejects.toThrow("最多只能放 5 只克隆体（墨小强也算一只）。");
    // recalled, room for one more
    await si.recallInk(a);
    await world.placeRoach(a, { kind: "clone" }, spot(7));
    expect(await clonesOf(a)).toHaveLength(MAX_CLONES);
    await expect(world.placeRoach(a, { kind: "clone" }, spot(8))).rejects.toThrow("最多只能放 5 只克隆体。");

    // rested, but five clones: held, as she says
    at(RECALL_REST_MS);
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: false, event: "full" });
    expect((await herCard(a)).inn).toMatchObject({ state: "held" });
    // a clone taken back: it goes at the next touch
    await world.removeRoach(a, (await clonesOf(a))[0].id);
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: false, event: "in" });
    expect((await herCard(a)).inn).toMatchObject({ state: "stay" });
    await expect(world.placeRoach(a, { kind: "clone" }, spot(8))).rejects.toThrow("最多只能放 5 只克隆体（墨小强也算一只）。");
  });

  it("draws the first one held while its owner has five clones, on the map once one is taken back", async () => {
    const a = await signUp("a@example.com", "gugu");
    await withRoaches(a, MAX_CLONES);
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: true, event: "full" });
    expect(await si.siState()).toMatchObject({ drawn: 1, tickets: 0, held: 1 });
    expect(innNumbers(await si.siState())).toMatchObject({ queue: 0, staying: 0, outside: 0 });
    // touched again, still the one drawing
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: false, event: "full" });
    expect(await db.select().from(siInks)).toHaveLength(1);
    await world.removeRoach(a, (await clonesOf(a))[0].id);
    expect((await touchSi(a)).si!.inn).toMatchObject({ drawn: false, event: "in" });
    expect(await tickets()).toEqual([expect.objectContaining({ n: 1, again: false })]);
    // of hers, only the one for a room (their clones earn others of their own)
    expect((await badges(a)).filter((b) => b === "siqueue" || b === "siinn")).toEqual(["siinn"]);
    expect((await herCard(a)).inn).toMatchObject({ state: "stay", look: "gugu" });
  });

  it("never lets a clone placed and a touch of hers at the same moment make six", { timeout: 120_000 }, async () => {
    for (let k = 0; k < 8; k++) {
      const p = await signUp(`p${k}@example.com`);
      await withRoaches(p, MAX_CLONES - 1);
      const [placed, touched] = await Promise.allSettled([world.placeRoach(p, { kind: "clone" }, spot(7)), touchSi(p)]);
      expect(touched.status).toBe("fulfilled");
      const ink = await si.inkOnMap(db, p);
      expect((await clonesOf(p)).length + (ink ? 1 : 0)).toBe(MAX_CLONES);
      expect(placed.status).toBe(ink ? "rejected" : "fulfilled");
    }
  });

  it("leaves those with more from before it counted as they are, and lets the one lying outside queue again", async () => {
    const a = await signUp("a@example.com");
    await withRoaches(a, MAX_CLONES - 1);
    await touchSi(a);
    // a fifth clone from before 墨小强 counted
    await db.insert(roaches).values({ userId: a, slot: MAX_CLONES, lng: spot(9).lng, lat: spot(9).lat });
    expect(await clonesOf(a)).toHaveLength(MAX_CLONES);
    expect((await herCard(a)).inn).toMatchObject({ state: "stay" });
    await expect(world.placeRoach(a, { kind: "clone" }, spot(8))).rejects.toThrow("最多只能放 5 只克隆体");
    // touched staying: nothing; out: in again, without counting
    expect((await touchSi(a)).si!.inn).toMatchObject({ event: "none" });
    at(STAY_MS + 60_000);
    expect((await herCard(a)).inn).toMatchObject({ state: "out" });
    expect((await touchSi(a)).si!.inn).toMatchObject({ event: "in" });
    expect((await tickets()).at(-1)).toMatchObject({ n: 2, again: true });
    expect(await clonesOf(a)).toHaveLength(MAX_CLONES);
  });

  it("sends a declaration from 墨小强 at 缘缘庄, and shows a player whose ink roach is there the newest 20 sent near, never in place of their own", { timeout: 60_000 }, async () => {
    const a = await signUp("a@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await expect(world.declare(a, { template: "launch", game: "arknights" }, [INK_FROM])).rejects.toThrow();
    await touchSi(a);
    const near = await signUp("near@example.com");
    await world.placeRoach(near, { kind: "main" }, NEAR_INN);
    const res = await world.declare(a, { template: "launch", game: "arknights" }, [INK_FROM]);
    expect(res.reach).toBeTruthy();
    const [sent] = await db.select().from(declarations).where(eq(declarations.senderId, a));
    expect(sent.recipients).toBe(1);
    const spots = await db.select().from(declarationSpots).where(eq(declarationSpots.declarationId, sent.id));
    expect(spots).toEqual([expect.objectContaining({ lng: INN_CENTER.lng, lat: INN_CENTER.lat })]);
    expect((await visibleDeclarations(near)).map((d) => d.d.id)).toEqual([sent.id]);

    // 25 sent near the inn, 5 near a player's main roach far away
    const p = await signUp("p@example.com");
    await world.placeRoach(p, { kind: "main" }, TOKYO);
    const sender = await signUp("sender@example.com");
    const now = Date.now();
    const sentAt = async (from: LngLat, minutesAgo: number) => {
      const [d] = await db
        .insert(declarations)
        .values({ senderId: sender, template: "launch", game: "arknights", recipients: 0, createdAt: new Date(now - minutesAgo * 60_000) })
        .returning();
      await db.insert(declarationSpots).values(spotRows(d, [from]));
      return d.id;
    };
    const atInn: string[] = [];
    for (let i = 0; i < 25; i++) atInn.push(await sentAt(NEAR_INN, i + 1));
    const atHome: string[] = [];
    for (let i = 0; i < 5; i++) atHome.push(await sentAt(TOKYO, 100 + i));
    const ids = async (limit?: number) => (await visibleDeclarations(p, { limit })).map((d) => d.d.id);
    expect(await ids()).toEqual(atHome);
    // their ink roach at the inn: the newest 20 sent near it too, a's from 墨小强 among them
    await touchSi(p);
    forgetNearInn();
    const nearInn = [sent.id, ...atInn];
    expect(await ids()).toEqual([...nearInn.slice(0, INK_DECLARATIONS), ...atHome]);
    // however few their own may be, those come in full
    expect(await ids(3)).toEqual([...nearInn.slice(0, INK_DECLARATIONS), ...atHome.slice(0, 3)]);
    // asked about by id, one near the inn is theirs too, the 21st as well
    expect((await visibleDeclarations(p, { ids: [atInn[24]], limit: 1 })).map((d) => d.d.id)).toEqual([atInn[24]]);
    // with 只看本体 on, their ink roach finds none, as their clones find none: only their main roach's
    await world.setOnlyMains(p, true);
    expect(await ids()).toEqual(atHome);
    expect(await visibleDeclarations(p, { ids: [atInn[24]], limit: 1 })).toEqual([]);
    await world.setOnlyMains(p, false);
    expect(await ids()).toEqual([...nearInn.slice(0, INK_DECLARATIONS), ...atHome]);
    // recalled: only their own again
    await si.recallInk(p);
    expect(await ids()).toEqual(atHome);
  });

  it("counts the ink roaches on the map among all the roaches, and not among the players", async () => {
    resetRoachFeed();
    const a = await signUp("a@example.com");
    const b = await signUp("b@example.com");
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(b, { kind: "main" }, TOKYO);
    await si.pretendCrowd(3);
    await touchSi(a);
    // read by the next ask of a tile, as the counts are made at once from what is held
    await inkTile(0, 0);
    expect(await roachCounts(Date.now())).toMatchObject({ total: 2 + 4, players: 2 });
    await si.recallInk(a);
    await inkTile(0, 0);
    expect(await roachCounts(Date.now())).toMatchObject({ total: 2 + 3, players: 2 });
  });
});
