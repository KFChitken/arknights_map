import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { distanceKm } from "../geo";
import { EMPTY_PROFILE } from "../profile";
import { FIRE_AT, isNearFire, ringSpots, SEAT_TAKEN_M } from "../talulah";
import type { LngLat } from "../types";
import { db } from "./db";
import * as friendly from "./friendly";
import { moves, roaches, talulahTouches, users } from "./schema";
import { spreadFireStacks } from "./talulah";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const PEOPLES_SQUARE = { lng: 121.4737, lat: 31.2304 };
const M_PER_DEG = 111_320;
/** A spot so many metres east and north of the fire */
const at = (x: number, y: number): LngLat => ({
  lng: FIRE_AT.lng + x / (M_PER_DEG * Math.cos((FIRE_AT.lat * Math.PI) / 180)),
  lat: FIRE_AT.lat + y / M_PER_DEG,
});
/** A seat of ring k, nudged so many metres east and north */
const seat = (k: number, i: number, dx = 0, dy = 0) => {
  const s = ringSpots(k)[i];
  return at(s.x + dx, s.y + dy);
};
// the first ring's four seats: east, north, west (behind her, never sat on) and south
const EAST = 0;
const NORTH = 1;
const SOUTH = 3;
const metres = (a: LngLat, b: LngLat) => distanceKm(a, b) * 1000;

/** A player who ticked everything, with a name and a main roach far from the fire */
async function player(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  await world.saveProfile(u.id, { ...EMPTY_PROFILE, anonymous: false, name: email.split("@")[0], drPrefix: true });
  await world.placeRoach(u.id, { kind: "main" }, PEOPLES_SQUARE);
  return u.id;
}

/** Roaches put straight into the table, as clones of one player (slot 1 up), in the order given, a minute apart */
async function sitting(spots: LngLat[]) {
  const [u] = await db.insert(users).values({ email: `${randomUUID()}@example.com` }).returning({ id: users.id });
  const start = Date.now() - 3_600_000;
  return db
    .insert(roaches)
    .values(spots.map((p, i) => ({ userId: u.id, slot: i + 1, ...p, placedAt: new Date(start + i * 60_000) })))
    .returning();
}

/** Every roach within 600 m of the fire */
const byFire = () => db.select().from(roaches).where(sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${FIRE_AT.lng}, ${FIRE_AT.lat}), 4326)::geography, 600)`);

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("seats by 塔露拉干员's fire, picked by the server", () => {
  it("seats players sent at once on seats of their own", async () => {
    // one free seat left in the first ring: every page sent at once would have picked it
    await sitting([seat(0, EAST), seat(0, NORTH)]);
    const players = await Promise.all(Array.from({ length: 5 }, (_, i) => player(`p${i}@example.com`)));
    const done = await Promise.all(players.map((id) => world.sitByFire(id, { kind: "clone" })));
    const seats = done.map((d) => d.seat);
    expect(seats.filter((s) => metres(s, FIRE_AT) < 12)).toHaveLength(1);
    for (const [i, s] of seats.entries()) {
      expect(isNearFire(s)).toBe(true);
      expect(done[i].roaches.find((r) => r.slot === 1)).toMatchObject({ lng: s.lng, lat: s.lat });
      for (const r of await byFire()) {
        if (r.lng !== s.lng || r.lat !== s.lat) expect(metres(r, s)).toBeGreaterThan(SEAT_TAKEN_M);
      }
    }
  });

  it("lets a roach moved there have its own seat back, and keeps every rule of a placement", async () => {
    await sitting([seat(0, EAST), seat(0, NORTH)]);
    const me = await player("me@example.com");
    const first = await world.sitByFire(me, { kind: "clone" });
    expect(metres(first.seat, seat(0, SOUTH))).toBeLessThan(2);
    // welcomed once, and counted as a roach put down
    expect((await db.select().from(talulahTouches).where(eq(talulahTouches.userId, me))).map((t) => t.kind)).toEqual(["welcome"]);
    const clone = first.roaches.find((r) => r.slot === 1)!;
    // moved again: the seat it holds is free for itself
    const again = await world.sitByFire(me, { kind: "move", roachId: clone.id });
    expect(metres(again.seat, seat(0, SOUTH))).toBeLessThan(3);
    const moved = again.roaches.find((r) => r.id === clone.id)!;
    expect(moved.publicId).not.toBe(clone.publicId);
    expect(await db.select().from(moves).where(eq(moves.userId, me))).toHaveLength(3);
    expect((await db.select().from(talulahTouches).where(eq(talulahTouches.userId, me))).map((t) => t.kind)).toEqual(["welcome"]);

    // a double tap: both picked the same free slot, and one of them is told it is down already
    const twice = await Promise.allSettled([world.sitByFire(me, { kind: "clone" }), world.sitByFire(me, { kind: "clone" })]);
    for (const t of twice) if (t.status === "rejected") expect((t.reason as Error).message).toBe("刚才那只已经放好了。");
    const slots = (await db.select().from(roaches).where(eq(roaches.userId, me))).map((r) => r.slot);
    expect(new Set(slots).size).toBe(slots.length);
    // the limits of any placement
    await expect(world.sitByFire(me, { kind: "move", roachId: randomUUID() })).rejects.toThrow("找不到这只蟑螂了");
    const [stranger] = await db.insert(users).values({ email: "stranger@example.com" }).returning({ id: users.id });
    await expect(world.sitByFire(stranger.id, { kind: "clone" })).rejects.toThrow("先放下蟑螂本体");
  });

  it("seats guests of a roach by the fire and clones sent from her card, all at once, on seats of their own", async () => {
    // a host by the fire on the east seat; the south seat the only free one in the first ring, and the
    // free seat nearest the host: every one of them would have picked it
    const host = await player("host@example.com");
    const guests = await Promise.all(["g1", "g2", "g3"].map((g) => player(`${g}@example.com`)));
    const senders = await Promise.all(["s1", "s2"].map((g) => player(`${g}@example.com`)));
    await sitting([seat(0, NORTH)]);
    const [, hostClone] = await world.placeRoach(host, { kind: "clone" }, seat(0, EAST));
    const [h] = await db.select().from(roaches).where(eq(roaches.userId, host));
    for (const g of guests) {
      const [mine] = await db.select().from(roaches).where(eq(roaches.userId, g));
      await world.touch(g, h.publicId, true);
      await world.touch(host, mine.publicId, true);
    }
    const seats = (
      await Promise.all([
        ...guests.map((g) => friendly.visit(g, world.friendKey(g, host), hostClone.publicId)),
        ...senders.map((id) => world.sitByFire(id, { kind: "clone" })),
      ])
    ).map((d) => d.seat);
    for (let i = 0; i < seats.length; i++) {
      expect(isNearFire(seats[i])).toBe(true);
      for (let j = i + 1; j < seats.length; j++) expect(metres(seats[i], seats[j])).toBeGreaterThan(SEAT_TAKEN_M);
    }
    expect(seats.filter((s) => metres(s, seat(0, SOUTH)) < 2)).toHaveLength(1);
    // the guests as close to their host as a seat was free
    for (const s of seats.slice(0, 3)) expect(metres(s, hostClone)).toBeLessThan(30);
  });

  it("seats two guests of one roach away from the fire, sent at once, apart", async () => {
    const host = await player("host@example.com");
    const guests = await Promise.all(["g1", "g2", "g3"].map((g) => player(`${g}@example.com`)));
    const [h] = await db.select().from(roaches).where(eq(roaches.userId, host));
    for (const g of guests) {
      const [mine] = await db.select().from(roaches).where(eq(roaches.userId, g));
      await world.touch(g, h.publicId, true);
      await world.touch(host, mine.publicId, true);
    }
    // the guests' own main roaches stand by the host's: move them away, so they take no seat
    await db.update(roaches).set({ lng: 139.7, lat: 35.68 }).where(sql`${roaches.userId} <> ${host}`);
    const seats = (await Promise.all(guests.map((g) => friendly.visit(g, world.friendKey(g, host), h.publicId)))).map((v) => v.seat);
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) expect(metres(seats[i], seats[j])).toBeGreaterThan(SEAT_TAKEN_M);
    }
  });
});

describe("roaches stacked by 塔露拉干员's fire, spread out as the server starts", () => {
  it("leaves the first on each seat, moves the later ones to the nearest free seat, quietly, and nothing the next time", async () => {
    const [first, second, third, north] = await sitting([seat(0, EAST, 0.4, 0.2), seat(0, EAST, -0.6, 0.1), seat(0, EAST), seat(0, NORTH)]);
    // put down by hand by the south seat, and a main roach on the north seat: neither moves
    const byHand = (await sitting([seat(0, SOUTH, 2.5, 0)]))[0];
    const [mainOnSeat] = await db
      .insert(users)
      .values({ email: "main@example.com" })
      .returning({ id: users.id })
      .then(([u]) => db.insert(roaches).values({ userId: u.id, slot: 0, ...seat(0, NORTH, 0.2, 0) }).returning());
    const before = await byFire();
    const movesBefore = await db.select().from(moves);

    expect(await spreadFireStacks()).toBe(2);
    const now = await byFire();
    const of = (id: string) => now.find((r) => r.id === id)!;
    for (const r of [first, north, byHand, mainOnSeat]) expect(of(r.id)).toMatchObject({ lng: r.lng, lat: r.lat });
    for (const r of [second, third]) {
      const moved = of(r.id);
      expect(metres(moved, r)).toBeGreaterThan(10);
      expect(metres(moved, FIRE_AT)).toBeLessThan(30);
      // the same public id, and as placed before: no move of the player's
      expect(moved.publicId).toBe(r.publicId);
      expect(moved.placedAt).toEqual(r.placedAt);
      for (const o of now) if (o.id !== r.id) expect(metres(moved, o)).toBeGreaterThanOrEqual(SEAT_TAKEN_M);
    }
    expect(now).toHaveLength(before.length);
    expect(await db.select().from(moves)).toEqual(movesBefore);

    expect(await spreadFireStacks()).toBe(0);
    expect(await byFire()).toEqual(expect.arrayContaining(now));
  });

  it("changes nothing with nobody stacked, and spreads a pair on any ring", async () => {
    expect(await spreadFireStacks()).toBe(0);
    await sitting([seat(0, EAST), seat(0, NORTH), seat(1, 2)]);
    expect(await spreadFireStacks()).toBe(0);
    await sitting([seat(1, 2, 0.5, 0.5)]);
    expect(await spreadFireStacks()).toBe(1);
    expect(await spreadFireStacks()).toBe(0);
  });
});
