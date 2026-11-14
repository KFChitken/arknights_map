import gcoord from "gcoord";
import { eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { shifted } from "../coords";
import { distanceKm } from "../geo";
import type { LngLat } from "../types";
import { BORDER_FIX, fixBorders, fixedSpot, shiftedBefore } from "./borderFix";
import { db } from "./db";
import { borderFixes, roachChanges, roaches, users } from "./schema";

// Runs against the database named in vitest.config.mts, which is wiped before every test

// Spots the borders before judged wrong (scripts comparing them with OpenStreetMap's), each a few km from the border:
// China's side of Suifenhe and Heihe, and Mong Cai across from Dongxing
const SUIFENHE = { lng: 131.144, lat: 44.436 };
const HEIHE = { lng: 127.59, lat: 50.182 };
const MONG_CAI = { lng: 108.004, lat: 21.492 };
// Tawang, 藏南: India's by the borders before, China's as China draws them now
const TAWANG = { lng: 91.86, lat: 27.59 };
const BEIJING = { lng: 116.3975, lat: 39.9087 };
const SEOUL = { lng: 126.978, lat: 37.5665 };

const metres = (a: LngLat, b: LngLat) => distanceKm(a, b) * 1000;
const amap = (p: LngLat, rule: (p: LngLat) => boolean): LngLat => {
  if (!rule(p)) return p;
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.WGS84, gcoord.GCJ02);
  return { lng, lat };
};

/** The undoing the hand-off gives, word for word: every spot back where it was, unless its owner moved it since */
const UNDO = [
  sql`update roaches r set lng = f.from_lng, lat = f.from_lat
    from border_fixes f
    where f.run = ${BORDER_FIX} and f.field = 'place' and f.roach_id = r.id and r.lng = f.to_lng and r.lat = f.to_lat`,
  sql`update roaches r set ride_from_lng = f.from_lng, ride_from_lat = f.from_lat
    from border_fixes f
    where f.run = ${BORDER_FIX} and f.field = 'ride_from' and f.roach_id = r.id and r.ride_from_lng = f.to_lng and r.ride_from_lat = f.to_lat`,
];

async function player(email: string) {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  return u.id;
}
async function roach(userId: string, slot: number, at: LngLat, rideFrom?: LngLat) {
  const [r] = await db
    .insert(roaches)
    .values({ userId, slot, lng: at.lng, lat: at.lat, ...(rideFrom ? { rideFromLng: rideFrom.lng, rideFromLat: rideFrom.lat } : {}) })
    .returning();
  return r;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${borderFixes} cascade`);
});

describe("the borders' fix of 2026-11-15", () => {
  it("knows what changed: China's side of the border towns and 藏南 are shifted now, the far side no longer", () => {
    for (const p of [SUIFENHE, HEIHE, TAWANG]) expect([shiftedBefore(p), shifted(p)]).toEqual([false, true]);
    expect([shiftedBefore(MONG_CAI), shifted(MONG_CAI)]).toEqual([true, false]);
    for (const p of [BEIJING, SEOUL]) expect(shiftedBefore(p)).toBe(shifted(p));
  });

  it("puts a spot where Amap shows it where it showed it before, and leaves the rest", () => {
    for (const p of [SUIFENHE, HEIHE, TAWANG, MONG_CAI]) {
      const to = fixedSpot(p)!;
      expect(metres(amap(to, shifted), amap(p, shiftedBefore))).toBeLessThan(1);
      // a few hundred metres, as Amap's shift is
      expect(metres(to, p)).toBeGreaterThan(200);
      expect(metres(to, p)).toBeLessThan(900);
    }
    expect(fixedSpot(BEIJING)).toBeNull();
    expect(fixedSpot(SEOUL)).toBeNull();
  });

  it("puts right the roaches and riders' spots once, keeping where each was, so it can be checked and undone", async () => {
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    const suifenhe = await roach(a, 0, SUIFENHE);
    const mongCai = await roach(a, 1, MONG_CAI);
    // a rider of 明河都尉 far away, who goes back to Heihe
    const rider = await roach(a, 2, { lng: 120.15, lat: 30.27 }, HEIHE);
    const beijing = await roach(b, 0, BEIJING);
    const seoul = await roach(b, 1, SEOUL);
    const tawang = await roach(b, 2, TAWANG);

    // counted only
    expect(await fixBorders(true)).toEqual({ places: 3, rideFroms: 1, atBorder: 0, dry: true });
    expect(await db.$count(borderFixes)).toBe(0);
    expect((await db.select().from(roaches).where(eq(roaches.id, suifenhe.id)))[0]).toMatchObject({ lng: SUIFENHE.lng, lat: SUIFENHE.lat });

    await db.execute(sql`truncate ${roachChanges}`);
    expect(await fixBorders(false)).toEqual({ places: 3, rideFroms: 1, atBorder: 0, dry: false });
    const now = new Map((await db.select().from(roaches)).map((r) => [r.id, r]));
    for (const [r, was] of [
      [suifenhe, SUIFENHE],
      [mongCai, MONG_CAI],
      [tawang, TAWANG],
    ] as const) {
      expect(now.get(r.id)).toMatchObject(fixedSpot(was)!);
      // the same roach to everyone, by the same public id
      expect(now.get(r.id)!.publicId).toBe(r.publicId);
    }
    expect(now.get(rider.id)).toMatchObject({ lng: 120.15, lat: 30.27, rideFromLng: fixedSpot(HEIHE)!.lng, rideFromLat: fixedSpot(HEIHE)!.lat });
    for (const r of [beijing, seoul]) expect(now.get(r.id)).toMatchObject({ lng: r.lng, lat: r.lat });
    // the map hears of the roaches moved, and of nothing else (where a rider goes back to is not drawn)
    const heard = new Set((await db.select({ id: roachChanges.publicId }).from(roachChanges)).map((c) => c.id));
    expect([...heard].sort()).toEqual([suifenhe.publicId, mongCai.publicId, tawang.publicId].sort());

    // kept: where each was and went, and that it ran
    const kept = await db.select().from(borderFixes).where(eq(borderFixes.run, BORDER_FIX));
    expect(kept.map((k) => k.field).sort()).toEqual(["done", "place", "place", "place", "ride_from"]);
    expect(kept.find((k) => k.roachId === suifenhe.id)).toMatchObject({
      field: "place",
      fromLng: SUIFENHE.lng,
      fromLat: SUIFENHE.lat,
      toLng: fixedSpot(SUIFENHE)!.lng,
      toLat: fixedSpot(SUIFENHE)!.lat,
    });
    // once: a second start changes nothing
    expect(await fixBorders(false)).toBeNull();
    expect(await db.$count(borderFixes)).toBe(5);

    // undone, every spot is back where it was; one moved by its owner since stays where they put it
    await db.update(roaches).set({ lng: 131.2, lat: 44.42 }).where(eq(roaches.id, suifenhe.id));
    for (const q of UNDO) await db.execute(q);
    const undone = new Map((await db.select().from(roaches).where(inArray(roaches.id, [suifenhe.id, mongCai.id, tawang.id, rider.id]))).map((r) => [r.id, r]));
    expect(undone.get(suifenhe.id)).toMatchObject({ lng: 131.2, lat: 44.42 });
    expect(undone.get(mongCai.id)).toMatchObject(MONG_CAI);
    expect(undone.get(tawang.id)).toMatchObject(TAWANG);
    expect(undone.get(rider.id)).toMatchObject({ rideFromLng: HEIHE.lng, rideFromLat: HEIHE.lat });
  });
});
