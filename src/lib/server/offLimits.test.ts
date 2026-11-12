import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { distanceKm } from "../geo";
import { RIDE_STOPS } from "../minghe";
import { isOffLimits, offLimitsMessage } from "../offLimits";
import { mulberry32 } from "../prng";
import { EMPTY_PROFILE } from "../profile";
import type { LngLat } from "../types";
import { db } from "./db";
import * as friendly from "./friendly";
import { mingheToday, moveMingheRiders } from "./minghe";
import { moveOutOfOffLimits } from "./offLimits";
import { friendNotes, moves, roaches, staffNotes, users, visits } from "./schema";
import { OFF_LIMITS_WORDS } from "./staffNotes";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const MAUSOLEUM = { lng: 116.3915, lat: 39.9011 };
const ZHONGNANHAI = { lng: 116.38, lat: 39.915 };
const NANJING_MEMORIAL = { lng: 118.738, lat: 32.0374 };
// just inside the square's east edge (116.3975), and just outside it: across the street, and closer still
const SQUARE_EDGE = { lng: 116.3972, lat: 39.903 };
const BY_THE_SQUARE = { lng: 116.3979, lat: 39.903 };
const ON_THE_EDGE = { lng: 116.3977, lat: 39.903 };
const PEOPLES_SQUARE = { lng: 121.4737, lat: 31.2304 };
const TOKYO = { lng: 139.7, lat: 35.68 };

const metres = (a: LngLat, b: LngLat) => distanceKm(a, b) * 1000;

/** A player who ticked everything, with a name, a main roach where given */
async function player(email: string, name: string, at?: LngLat) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  await world.saveProfile(u.id, { ...EMPTY_PROFILE, anonymous: false, name, drPrefix: true });
  if (at) await world.placeRoach(u.id, { kind: "main" }, at);
  return u.id;
}

/** A roach standing where it stood before its place was listed, put there behind the rules' back */
async function standing(userId: string, slot: number, at: LngLat) {
  const [r] = await db.insert(roaches).values({ userId, slot, lng: at.lng, lat: at.lat }).returning();
  return r;
}

const roachOf = async (id: string) => (await db.select().from(roaches).where(eq(roaches.id, id)))[0];
const notesOf = (userId: string) => db.select().from(staffNotes).where(eq(staffNotes.userId, userId));
const movesOf = async (userId: string) => (await db.select().from(moves).where(eq(moves.userId, userId))).length;
const mainOf = async (userId: string) => (await world.me(userId))!.roaches.find((r) => r.slot === 0)!;

async function befriend(a: string, b: string) {
  await world.touch(a, (await mainOf(b)).publicId, true);
  await world.touch(b, (await mainOf(a)).publicId, true);
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("放下和挪窝", () => {
  it("refuses a roach put down or moved where none may stand, naming no place, and counts nothing", async () => {
    const newcomer = await player("n@example.com", "N");
    await expect(world.placeRoach(newcomer, { kind: "main" }, MAUSOLEUM)).rejects.toThrow(offLimitsMessage());
    expect((await world.me(newcomer))!.roaches).toEqual([]);

    const a = await player("a@example.com", "A", PEOPLES_SQUARE);
    const before = await movesOf(a);
    await expect(world.placeRoach(a, { kind: "clone" }, ZHONGNANHAI)).rejects.toThrow(offLimitsMessage());
    const main = await mainOf(a);
    await expect(world.placeRoach(a, { kind: "move", roachId: main.id }, NANJING_MEMORIAL)).rejects.toThrow(offLimitsMessage());
    expect(await movesOf(a)).toBe(before);
    expect((await world.me(a))!.movesLeft).toBeGreaterThan(0);

    // right by it is fine
    await world.placeRoach(a, { kind: "clone" }, BY_THE_SQUARE);
    expect((await world.me(a))!.roaches).toHaveLength(2);
  });
});

describe("已经在里面的蟑螂", () => {
  it("move just outside once, under new public ids, each owner told once, and nothing changes the second time", async () => {
    const a = await player("a@example.com", "A");
    const b = await player("b@example.com", "B", PEOPLES_SQUARE);
    const mainA = await standing(a, 0, MAUSOLEUM);
    const cloneA = await standing(a, 1, ZHONGNANHAI);
    const cloneB = await standing(b, 1, NANJING_MEMORIAL);
    const movesBefore = (await db.select().from(moves)).length;

    expect(await moveOutOfOffLimits(undefined, mulberry32(5))).toEqual({ moved: 3, home: 0, owners: 2 });
    for (const [r, from] of [
      [mainA, MAUSOLEUM],
      [cloneA, ZHONGNANHAI],
      [cloneB, NANJING_MEMORIAL],
    ] as const) {
      const now = await roachOf(r.id);
      expect(isOffLimits(now)).toBe(false);
      expect(metres(now, from)).toBeLessThan(1400);
      expect(now.publicId).not.toBe(r.publicId);
      expect(now.placedAt).toEqual(r.placedAt);
    }
    // not a move of theirs: the radar never sees it, and the day's moves are untouched
    expect(await db.select().from(moves)).toHaveLength(movesBefore);

    expect((await notesOf(a)).map((n) => [n.kind, n.reason])).toEqual([["offLimits", "moved"]]);
    expect((await notesOf(b)).map((n) => [n.kind, n.reason])).toEqual([["offLimits", "moved"]]);
    const said = (await world.inbox(a)).filter((i) => i.kind === "staff");
    expect(said).toMatchObject([{ text: OFF_LIMITS_WORDS.moved, seen: false }]);
    // B's main roach never stood in one
    expect(metres(await mainOf(b), PEOPLES_SQUARE)).toBeLessThan(1);

    expect(await moveOutOfOffLimits()).toEqual({ moved: 0, home: 0, owners: 0 });
    expect(await notesOf(a)).toHaveLength(1);
  });

  it("send a clone visiting there home, and leave the guests outside where they sit, as when a host moves", async () => {
    const host = await player("h@example.com", "H");
    const inGuest = await player("g@example.com", "G", TOKYO);
    const outGuest = await player("o@example.com", "O", TOKYO);
    const hostRoach = await standing(host, 0, SQUARE_EDGE);
    // G's clone sits inside next to the host and came from Tokyo; O's sits outside and was put down for the visit
    const inClone = await standing(inGuest, 1, { lng: SQUARE_EDGE.lng - 0.0002, lat: SQUARE_EDGE.lat });
    const outClone = await standing(outGuest, 1, BY_THE_SQUARE);
    const visit = { hostId: host, hostRoachId: hostRoach.id, since: new Date() };
    await db.insert(visits).values([
      { ...visit, roachId: inClone.id, guestId: inGuest, fromLng: TOKYO.lng + 0.01, fromLat: TOKYO.lat },
      { ...visit, roachId: outClone.id, guestId: outGuest, fromLng: null, fromLat: null },
    ]);

    expect(await moveOutOfOffLimits(undefined, mulberry32(9))).toEqual({ moved: 1, home: 1, owners: 2 });
    // G's clone is back home, and G is told so; not that the host moved
    expect(metres(await roachOf(inClone.id), { lng: TOKYO.lng + 0.01, lat: TOKYO.lat })).toBeLessThan(1);
    expect(await db.select().from(visits).where(eq(visits.roachId, inClone.id))).toEqual([]);
    expect((await notesOf(inGuest)).map((n) => n.reason)).toEqual(["home"]);
    expect(await db.select().from(friendNotes).where(eq(friendNotes.toUserId, inGuest))).toEqual([]);
    expect((await world.inbox(inGuest)).find((i) => i.kind === "staff")).toMatchObject({ text: OFF_LIMITS_WORDS.home });

    // the host moved out; O's clone stays where it sits, left behind and told so, with nothing from 站长
    expect(isOffLimits(await roachOf(hostRoach.id))).toBe(false);
    expect(metres(await roachOf(outClone.id), BY_THE_SQUARE)).toBeLessThan(1);
    const [left] = await db.select().from(visits).where(eq(visits.roachId, outClone.id));
    expect(left.leftAt).not.toBeNull();
    expect(await db.select().from(friendNotes).where(and(eq(friendNotes.toUserId, outGuest), eq(friendNotes.kind, "hostMoved")))).toHaveLength(1);
    expect(await notesOf(outGuest)).toEqual([]);
    expect((await notesOf(host)).map((n) => n.reason)).toEqual(["moved"]);
  });

  it("go home just outside when home is where none may stand now: from a visit, or after a ride", async () => {
    const host = await player("h@example.com", "H", PEOPLES_SQUARE);
    const guest = await player("g@example.com", "G", TOKYO);
    const hostRoach = await mainOf(host);
    const clone = await standing(guest, 1, { lng: PEOPLES_SQUARE.lng + 0.0002, lat: PEOPLES_SQUARE.lat });
    await db.insert(visits).values({ roachId: clone.id, guestId: guest, hostId: host, hostRoachId: hostRoach.id, fromLng: MAUSOLEUM.lng, fromLat: MAUSOLEUM.lat });
    await friendly.goHome(guest, clone.id);
    const back = await roachOf(clone.id);
    expect(isOffLimits(back)).toBe(false);
    expect(metres(back, MAUSOLEUM)).toBeLessThan(700);

    // a clone that set out with 明河都尉 from there, before the place was listed, comes back beside it
    const now = Date.now();
    const day = mingheToday(now);
    const [rider] = await db
      .insert(roaches)
      .values({
        userId: guest,
        slot: 2,
        lng: 116.27,
        lat: 40.0,
        rideSince: new Date(now - RIDE_STOPS * 86_400_000),
        rideStartDay: day - RIDE_STOPS,
        rideDay: day - 1,
        rideFromLng: ZHONGNANHAI.lng,
        rideFromLat: ZHONGNANHAI.lat,
      })
      .returning();
    await moveMingheRiders(now);
    const home = await roachOf(rider.id);
    expect(home.rideSince).toBeNull();
    expect(isOffLimits(home)).toBe(false);
    expect(metres(home, ZHONGNANHAI)).toBeLessThan(1400);
  });
});

describe("串门的座位", () => {
  it("never puts a guest inside, even by a roach on the edge", async () => {
    // 17 m from the edge: the second ring of seats, 25 m out, reaches inside on its west side
    const host = await player("h@example.com", "H", ON_THE_EDGE);
    const hostRoach = await mainOf(host);
    for (let i = 0; i < 14; i++) {
      const guest = await player(`g${i}@example.com`, `G${i}`, TOKYO);
      await befriend(guest, host);
      const { seat } = await friendly.visit(guest, world.friendKey(guest, host), hostRoach.publicId);
      expect(isOffLimits(seat)).toBe(false);
      expect(metres(seat, ON_THE_EDGE)).toBeLessThan(60);
    }
  });
});
