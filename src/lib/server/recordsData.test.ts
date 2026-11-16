import { readFileSync } from "node:fs";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { beijingDate } from "../beijing";
import { EMPTY_PROFILE } from "../profile";
import { KEEP_ACTIVITY_DAYS } from "../rules";
import type { LngLat } from "../types";
import { db, pg } from "./db";
import { forgetHits } from "./rateLimit";
import { pruneOldActivity } from "./retention";
import { amiyaTouches, declarations, drinks, moves, reactions, siTouches, touches, users } from "./schema";
import * as world from "./world";

// Runs against the database named in vitest.config.mts, which is wiped before every test

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SHANGHAI = { lng: 121.4737, lat: 31.2304 };
const TOKYO = { lng: 139.7, lat: 35.68 };

async function player(email: string, at?: LngLat) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  await world.saveProfile(u.id, { ...EMPTY_PROFILE, anonymous: false, name: email.split("@")[0] });
  if (at) await world.placeRoach(u.id, { kind: "main" }, at);
  return u.id;
}

const drinksOf = (userId: string) => db.select().from(drinks).where(eq(drinks.userId, userId)).orderBy(asc(drinks.at));
const mainOf = async (userId: string) => (await world.me(userId))!.roaches.find((r) => r.slot === 0)!;

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  forgetHits();
});

describe("每次喝酒 (drinks)", () => {
  it("keeps each drink with how long it was to last, and when 醒酒 ended it", async () => {
    const a = await player("a@example.com", SHANGHAI);
    const { until } = await world.drink(a);
    const [one] = await drinksOf(a);
    expect(one).toMatchObject({ userId: a, soberAt: null });
    expect(one.until.getTime()).toBe(until);
    expect(Math.abs(one.at.getTime() - Date.now())).toBeLessThan(5_000);

    await world.sober(a);
    const [woke] = await drinksOf(a);
    expect(woke.soberAt).not.toBeNull();
    expect(woke.soberAt!.getTime()).toBeGreaterThanOrEqual(one.at.getTime());
    // 醒酒 again, awake: nothing changes
    await world.sober(a);
    expect((await drinksOf(a))[0].soberAt).toEqual(woke.soberAt);
  });

  it("ends the drink too when the main roach moves or goes off the map, and leaves one that ran out by itself", async () => {
    const a = await player("a@example.com", SHANGHAI);
    await world.drink(a);
    await world.placeRoach(a, { kind: "move", roachId: (await mainOf(a)).id }, TOKYO);
    expect((await drinksOf(a))[0].soberAt).not.toBeNull();

    // a second drink, then off the map
    forgetHits();
    await world.drink(a);
    await world.removeRoach(a, (await mainOf(a)).id);
    const [, second] = await drinksOf(a);
    expect(second.soberAt).not.toBeNull();

    // one that ran out: moving the next morning changes nothing of it
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    forgetHits();
    await world.drink(a);
    const ran = new Date(Date.now() - 1000);
    await db.update(drinks).set({ until: ran }).where(and(eq(drinks.userId, a), sql`${drinks.soberAt} is null`));
    await db.update(users).set({ drunkUntil: ran }).where(eq(users.id, a));
    await world.placeRoach(a, { kind: "move", roachId: (await mainOf(a)).id }, TOKYO);
    const third = (await drinksOf(a))[2];
    expect(third.soberAt).toBeNull();
    expect(third.until).toEqual(ran);
    // only the player's own drinks are ever changed
    const b = await player("b@example.com", TOKYO);
    await world.drink(b);
    await world.sober(a);
    expect((await drinksOf(b))[0].soberAt).toBeNull();
  });

  it("goes with the other activity after KEEP_ACTIVITY_DAYS, and with the account", async () => {
    const a = await player("a@example.com", SHANGHAI);
    await world.drink(a);
    const old = new Date(Date.now() - (KEEP_ACTIVITY_DAYS + 1) * DAY);
    await db.insert(drinks).values({ userId: a, at: old, until: new Date(old.getTime() + 8 * HOUR) });
    await pruneOldActivity();
    expect(await drinksOf(a)).toHaveLength(1);
    // the count for the 酒神 badges stays as it was
    expect((await world.me(a))!.counts.drinks).toBe(1);
    await db.delete(users).where(eq(users.id, a));
    expect(await db.select().from(drinks)).toEqual([]);
  });
});

describe("来过几天 (visit_days)", () => {
  const visitDays = async (id: string) => (await db.select({ n: users.visitDays }).from(users).where(eq(users.id, id)))[0].n;

  it("counts each Beijing day once, however many pages open on it at once", async () => {
    const a = await player("a@example.com");
    await world.me(a);
    expect(await visitDays(a)).toBe(1);
    await world.me(a);
    expect(await visitDays(a)).toBe(1);

    // the next day: five pages at once still count it once
    const yesterday = beijingDate(Date.now() - DAY);
    await db.update(users).set({ lastSeenOn: yesterday }).where(eq(users.id, a));
    await Promise.all([world.me(a), world.me(a), world.me(a), world.me(a), world.me(a)]);
    expect(await visitDays(a)).toBe(2);
    expect((await db.select({ on: users.lastSeenOn }).from(users).where(eq(users.id, a)))[0].on).toBe(beijingDate());
  });
});

/**
 * What 「我的记录」's totals will read for each player: what the clean-up counted on their row, and what is still
 * kept. Touches in and reactions in leave out the withheld ones, as the inbox does.
 */
async function totals(ids: string[]) {
  const rows = await db.select().from(users).where(inArray(users.id, ids));
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  const out: Record<string, number[]> = {};
  for (const u of rows) {
    out[u.email!] = [
      u.oldTouchesOut + (await n(db.select({ n: count() }).from(touches).where(eq(touches.fromUserId, u.id)))),
      u.oldTouchesIn + (await n(db.select({ n: count() }).from(touches).where(and(eq(touches.toUserId, u.id), eq(touches.withheld, false))))),
      u.oldDeclarations + (await n(db.select({ n: count() }).from(declarations).where(eq(declarations.senderId, u.id)))),
      u.oldReactionsIn +
        (await n(
          db
            .select({ n: count() })
            .from(reactions)
            .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
            .where(and(eq(declarations.senderId, u.id), eq(reactions.withheld, false))),
        )),
      u.oldReactionsOut + (await n(db.select({ n: count() }).from(reactions).where(eq(reactions.fromUserId, u.id)))),
    ];
  }
  return out;
}

describe("删旧记录前留条数 (users.old_*)", () => {
  it("keeps every total as it was when the clean-up deletes, and counts nothing twice when run again", async () => {
    const [a, b, c] = [await player("a@example.com"), await player("b@example.com"), await player("c@example.com")];
    const now = Date.now();
    const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR);
    const old = KEEP_ACTIVITY_DAYS + 1;
    // in one old hour: a and b touch each other (each sends and gets in the same statement), a touches c while blocked
    await db.insert(touches).values([
      { fromUserId: a, toUserId: b, bold: true, createdAt: ago(old) },
      { fromUserId: b, toUserId: a, bold: false, createdAt: ago(old) },
      { fromUserId: a, toUserId: c, bold: true, withheld: true, createdAt: ago(old) },
      { fromUserId: c, toUserId: a, bold: true, createdAt: ago(old, 30) },
      // still kept
      { fromUserId: a, toUserId: b, bold: true, createdAt: ago(3) },
      { fromUserId: c, toUserId: b, bold: false, createdAt: ago(KEEP_ACTIVITY_DAYS - 1) },
    ]);
    const declare = async (sender: string, at: Date) =>
      (await db.insert(declarations).values({ senderId: sender, template: "hello", recipients: 3, createdAt: at }).returning({ id: declarations.id }))[0].id;
    const aOld = await declare(a, ago(old));
    const aOld2 = await declare(a, ago(old + 2));
    const bOld = await declare(b, ago(old));
    const aNew = await declare(a, ago(1));
    await db.insert(reactions).values([
      { declarationId: aOld, fromUserId: b, reaction: "r1", createdAt: ago(old) },
      { declarationId: aOld, fromUserId: c, reaction: "r2", withheld: true, createdAt: ago(old) },
      { declarationId: aOld2, fromUserId: c, reaction: "r1", createdAt: ago(old + 1) },
      { declarationId: bOld, fromUserId: a, reaction: "r3", createdAt: ago(old) },
      { declarationId: aNew, fromUserId: b, reaction: "r1", createdAt: ago(1) },
    ]);
    const before = await totals([a, b, c]);
    expect(before).toEqual({
      "a@example.com": [3, 2, 3, 3, 1],
      "b@example.com": [1, 3, 1, 1, 2],
      "c@example.com": [2, 0, 0, 0, 2],
    });

    await pruneOldActivity(now);
    expect(await db.select({ id: touches.id }).from(touches)).toHaveLength(2);
    expect((await db.select({ id: declarations.id }).from(declarations)).map((d) => d.id)).toEqual([aNew]);
    expect(await totals([a, b, c])).toEqual(before);
    const [counted] = await db.select().from(users).where(eq(users.id, a));
    expect(counted).toMatchObject({ oldTouchesOut: 2, oldTouchesIn: 2, oldDeclarations: 2, oldReactionsIn: 2, oldReactionsOut: 1 });

    // again, and a day later: nothing counted twice
    await pruneOldActivity(now);
    await pruneOldActivity(now + DAY);
    expect(await totals([a, b, c])).toEqual(before);
  });

  it("takes a busy hour in several statements, and skips the hours with nothing", async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await player(`p${i}@example.com`));
    const now = Date.now();
    // 2,600 within ten minutes of one old hour, more than a statement takes, and a few more on days before, with
    // empty days between
    const hour = Math.floor((now - (KEEP_ACTIVITY_DAYS + 1) * DAY) / HOUR) * HOUR;
    const rows = [];
    for (let i = 0; i < 2600; i++) {
      rows.push({ fromUserId: ids[i % 6], toUserId: ids[(i + 1) % 6], bold: i % 2 === 0, withheld: i % 50 === 0, createdAt: new Date(hour + (i % 600) * 1000) });
    }
    for (let i = 0; i < 30; i++) {
      rows.push({ fromUserId: ids[i % 6], toUserId: ids[(i + 2) % 6], bold: true, createdAt: new Date(hour - (8 + (i % 3) * 4) * DAY + i * 1000) });
    }
    for (let i = 0; i < rows.length; i += 1000) await db.insert(touches).values(rows.slice(i, i + 1000));
    await db.insert(touches).values({ fromUserId: ids[0], toUserId: ids[1], bold: true, createdAt: new Date(now - DAY) });
    const before = await totals(ids);
    await pruneOldActivity(now);
    expect(await db.select({ id: touches.id }).from(touches)).toHaveLength(1);
    expect(await totals(ids)).toEqual(before);
    const kept = await db.select({ out: sql<number>`sum(${users.oldTouchesOut})::int`, got: sql<number>`sum(${users.oldTouchesIn})::int` }).from(users);
    expect(kept[0]).toEqual({ out: 2630, got: 2630 - 52 });
  });
});

describe("补来过几天 (scripts/backfill-visit-days.sql)", () => {
  /** The script as psql runs it, its one line for psql left out */
  const backfill = () => pg.unsafe(readFileSync("scripts/backfill-visit-days.sql", "utf8").replace("\\set ON_ERROR_STOP on", "")).simple();
  const visitDays = async (id: string) => (await db.select({ n: users.visitDays }).from(users).where(eq(users.id, id)))[0].n;

  it("counts the Beijing days a player did something on, never lowers the number, and counts nothing twice", async () => {
    const [a, b, c] = [await player("a@example.com"), await player("b@example.com"), await player("c@example.com")];
    // Beijing noon of a day so many days ago
    const noon = (daysAgo: number) => new Date(Date.parse(`${beijingDate(Date.now() - daysAgo * DAY)}T12:00:00+08:00`));
    const late = (daysAgo: number) => new Date(Date.parse(`${beijingDate(Date.now() - daysAgo * DAY)}T23:30:00+08:00`));
    await db.update(users).set({ lastSeenOn: beijingDate(Date.now() - 1 * DAY) }).where(eq(users.id, a));
    await db.insert(touches).values([
      { fromUserId: a, toUserId: b, bold: true, createdAt: noon(10) },
      // the same Beijing day, late at night: still day 10
      { fromUserId: a, toUserId: c, bold: false, createdAt: late(10) },
      // b was touched that day: a day of a's, not of b's
      { fromUserId: c, toUserId: b, bold: true, createdAt: noon(9) },
    ]);
    await db.insert(declarations).values({ senderId: a, template: "hello", recipients: 1, createdAt: noon(8) });
    await db.insert(moves).values([
      { userId: a, slot: 0, at: noon(7) },
      { userId: a, slot: 1, at: noon(1) },
    ]);
    await db.insert(amiyaTouches).values([
      { userId: a, direction: "to_amiya", bold: true, createdAt: noon(6) },
      // hers, not the player's
      { userId: b, direction: "from_amiya", bold: true, createdAt: noon(5) },
    ]);
    await db.insert(siTouches).values({ userId: c, direction: "to_si", bold: false, createdAt: noon(4) });

    await backfill();
    // a: days 10, 8, 7, 6 and 1 (a move and the last visit, the same day); b: nothing of b's own; c: days 9 and 4
    expect([await visitDays(a), await visitDays(b), await visitDays(c)]).toEqual([5, 0, 2]);
    await backfill();
    expect([await visitDays(a), await visitDays(b), await visitDays(c)]).toEqual([5, 0, 2]);
    // more already counted, by me() since it was kept: left as it is
    await db.update(users).set({ visitDays: 40 }).where(eq(users.id, c));
    await backfill();
    expect(await visitDays(c)).toBe(40);
  });
});
