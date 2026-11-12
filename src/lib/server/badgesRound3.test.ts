import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { beijingDate } from "../beijing";
import { FIRE_AT } from "../talulah";
import {
  award,
  catchUpBadges,
  comrades,
  declaredFrom,
  earnedBy,
  nightByTheFire,
  partied,
  placed,
  quilted,
  responded,
  scannedRadar,
  sleptItOff,
  touchedSneakily,
  wishedHappyBirthday,
} from "./badges";
import { db } from "./db";
import { declarations, friendships, reactions, roaches, users } from "./schema";
import * as world from "./world";

const SHANGHAI = { lng: 121.4737, lat: 31.2304 };
const NANJING = { lng: 118.7969, lat: 32.0603 };
const SUZHOU = { lng: 120.5853, lat: 31.2989 };

async function signUp(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}

const held = async (id: string) => (await earnedBy(id)).map((b) => b.id);
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const yesterday = () => beijingDate(Date.now() - 86_400_000);

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("the third round of badges", () => {
  it("狂响的声筒: the main roach and two clones declaring at once, not one clone", async () => {
    const me = await signUp("horn@example.com");
    const mine = await world.placeRoach(me, { kind: "main" }, SHANGHAI);
    await world.placeRoach(me, { kind: "clone" }, NANJING);
    const all = await world.placeRoach(me, { kind: "clone" }, SUZHOU);
    await world.declare(me, { template: "launch", game: "arknights" }, [mine[0].id, all[1].id]);
    expect(await held(me)).not.toContain("loudhorn");
    await declaredFrom(me, all.map((r) => r.slot));
    expect(await held(me)).toContain("loudhorn");
    // and 异卵同生 came with the first clone
    expect(await held(me)).toContain("twins");
  });

  it("喧闹法则: thirty responses to one declaration, besides 一呼百舟应 at ten", async () => {
    const sender = await signUp("loud@example.com");
    const [d] = await db.insert(declarations).values({ senderId: sender, template: "launch", game: "arknights", recipients: 40 }).returning({ id: declarations.id });
    const fans = await db
      .insert(users)
      .values(Array.from({ length: 30 }, (_, i) => ({ email: `fan${i}@example.com` })))
      .returning({ id: users.id });
    await db.insert(reactions).values(fans.slice(0, 29).map((f) => ({ declarationId: d.id, fromUserId: f.id, reaction: "plusone" })));
    await responded(fans[28].id, d.id, sender);
    expect(await held(sender)).toEqual(expect.arrayContaining(["echo"]));
    expect(await held(sender)).not.toContain("rowdy");
    await db.insert(reactions).values({ declarationId: d.id, fromUserId: fans[29].id, reaction: "plusone" });
    await responded(fans[29].id, d.id, sender);
    expect(await held(sender)).toContain("rowdy");
  });

  it("罗德岛信使 and 眠于树影之中 count each 触须之交 once", async () => {
    const me = await signUp("post@example.com");
    const friends = await db
      .insert(users)
      .values(Array.from({ length: 5 }, (_, i) => ({ email: `f${i}@example.com` })))
      .returning({ id: users.id });
    for (const f of friends.slice(0, 4)) await wishedHappyBirthday(me, f.id);
    await wishedHappyBirthday(me, friends[0].id);
    expect((await row(me)).birthdayWished).toHaveLength(4);
    expect(await held(me)).not.toContain("postman");
    await wishedHappyBirthday(me, friends[4].id);
    expect(await held(me)).toContain("postman");

    await quilted(me, friends[0].id);
    await quilted(me, friends[0].id);
    await quilted(me, friends[1].id);
    expect(await held(me)).not.toContain("treeshade");
    await quilted(me, friends[2].id);
    expect(await held(me)).toContain("treeshade");
    expect((await row(me)).quiltedBy).toHaveLength(3);
  });

  it("移动城市: three moves of the main roach of 100 km or more; a nearer one or a clone's does not count", async () => {
    const me = await signUp("move@example.com");
    await placed(me, 0, SHANGHAI, SUZHOU);
    await placed(me, 1, SHANGHAI, NANJING);
    await placed(me, 0, SHANGHAI, NANJING);
    await placed(me, 0, NANJING, SHANGHAI);
    expect((await row(me)).farMoves).toBe(2);
    expect(await held(me)).not.toContain("movingcity");
    await placed(me, 0, SHANGHAI, NANJING);
    expect(await held(me)).toContain("movingcity");
    // a clone moved is no clone put out
    expect(await held(me)).not.toContain("twins");
  });

  it("天灾信使 and 惊霆无声 count a Beijing day once", async () => {
    const me = await signUp("days@example.com");
    await scannedRadar(me);
    await scannedRadar(me);
    await touchedSneakily(me);
    expect(await row(me)).toMatchObject({ radarDays: 1, sneakDays: 1 });
    await db.update(users).set({ radarDays: 9, radarOn: yesterday(), sneakDays: 9, sneakOn: yesterday() }).where(eq(users.id, me));
    await scannedRadar(me);
    await touchedSneakily(me);
    expect(await held(me)).toEqual(expect.arrayContaining(["stormchaser", "silentbolt"]));
  });

  it("counts a sneaky touch of a player's roach, not a bold one", async () => {
    const me = await signUp("sneak@example.com");
    const other = await signUp("other@example.com");
    await world.placeRoach(me, { kind: "main" }, SHANGHAI);
    const [theirs] = await world.placeRoach(other, { kind: "main" }, SUZHOU);
    await world.touch(me, theirs.publicId, false);
    expect((await row(me)).sneakDays).toBe(1);
    expect((await row(other)).sneakDays).toBe(0);
  });

  it("我真的不能再喝了 within a minute of drinking, 将进酒 while drunk, and 二次呼吸 only for a sleep left to run out", async () => {
    const quick = await signUp("quick@example.com");
    await world.placeRoach(quick, { kind: "main" }, SHANGHAI);
    await partied(quick);
    expect(await held(quick)).not.toContain("drinkup");
    await world.drink(quick);
    await partied(quick);
    await world.sober(quick);
    expect(await held(quick)).toEqual(expect.arrayContaining(["nomore", "drinkup"]));
    expect((await row(quick)).drunkAt).toBeNull();

    const slow = await signUp("slow@example.com");
    await world.placeRoach(slow, { kind: "main" }, SUZHOU);
    await world.drink(slow);
    await db.update(users).set({ drunkAt: sql`now() - interval '2 minutes'` }).where(eq(users.id, slow));
    await world.sober(slow);
    expect(await held(slow)).not.toContain("nomore");
    // sobered up: never 二次呼吸
    await db.update(users).set({ drunkUntil: sql`now() - interval '1 minute'` }).where(eq(users.id, slow));
    expect(await sleptItOff()).toBe(0);

    const sleeper = await signUp("sleeper@example.com");
    await world.placeRoach(sleeper, { kind: "main" }, NANJING);
    await world.drink(sleeper);
    expect(await sleptItOff()).toBe(0);
    await db.update(users).set({ drunkUntil: sql`now() - interval '1 minute'` }).where(eq(users.id, sleeper));
    expect(await sleptItOff()).toBe(1);
    expect(await held(sleeper)).toContain("secondwind");
    expect((await row(sleeper)).drunkAt).toBeNull();
    expect(await sleptItOff()).toBe(0);
  });

  it("温暖你的战友: a night by 塔露拉干员's fire once a day, ten of them", async () => {
    const me = await signUp("fire@example.com");
    const away = await signUp("away@example.com");
    await db.insert(roaches).values([
      { userId: me, slot: 0, lng: FIRE_AT.lng, lat: FIRE_AT.lat + 0.0005 },
      { userId: away, slot: 0, lng: FIRE_AT.lng + 0.1, lat: FIRE_AT.lat },
    ]);
    expect(await nightByTheFire()).toBe(1);
    await nightByTheFire();
    expect((await row(me)).fireNights).toBe(1);
    expect((await row(away)).fireNights).toBe(0);
    await db.update(users).set({ fireNights: 9, fireNightOn: yesterday() }).where(eq(users.id, me));
    await nightByTheFire();
    expect(await held(me)).toContain("warmth");
  });

  it("共患难的战友: 触须之交 for thirty days, both of them", async () => {
    const [a, b, c] = await Promise.all(["a@example.com", "b@example.com", "c@example.com"].map(signUp));
    const pair = (x: string, y: string) => (x < y ? { a: x, b: y } : { a: y, b: x });
    await db.insert(friendships).values({ ...pair(a, b), createdAt: sql`now() - interval '31 days'` });
    await db.insert(friendships).values({ ...pair(a, c), createdAt: sql`now() - interval '29 days'` });
    expect(await comrades()).toBe(2);
    expect(await held(a)).toContain("comrade");
    expect(await held(b)).toContain("comrade");
    expect(await held(c)).not.toContain("comrade");
    expect(await comrades()).toBe(0);
  });

  it("罗德岛正式干员 with five others, 精英干员 with one of each of the five series", async () => {
    const me = await signUp("elite@example.com");
    await award(me, ["trainee", "tipsy", "lookatme", "courtesy"]);
    expect(await held(me)).not.toContain("regular");
    expect(await held(me)).not.toContain("elite");
    await award(me, ["amiya"]);
    expect(await held(me)).toEqual(expect.arrayContaining(["regular", "elite"]));
  });

  it("hands out at start what is on record already", async () => {
    const me = await signUp("catch@example.com");
    await db.insert(roaches).values({ userId: me, slot: 1, lng: SHANGHAI.lng, lat: SHANGHAI.lat });
    await db.insert(users).values({ email: "x@example.com" });
    const others = await db.select({ id: users.id }).from(users).where(inArray(users.email, ["x@example.com"]));
    await db.insert(friendships).values({ ...(me < others[0].id ? { a: me, b: others[0].id } : { a: others[0].id, b: me }), createdAt: sql`now() - interval '40 days'` });
    await db.update(users).set({ drinksTotal: 12, friendsEver: 100 }).where(eq(users.id, me));
    await catchUpBadges();
    expect(await held(me)).toEqual(expect.arrayContaining(["twins", "comrade", "thousandcups", "summit", "regular"]));
    expect(await held(me)).not.toContain("bigjar");
  });
});
