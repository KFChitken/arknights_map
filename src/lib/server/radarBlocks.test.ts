import { and, gt, ne, or, sql, type AnyColumn } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import { RADAR_RADIUS_KM } from "../rules";
import type { LngLat } from "../types";
import type { Move } from "../world/cast";
import { buildRadar } from "../world/logic";
import { db } from "./db";
import { BLOCK_DEG, BLOCK_MS, blocksAround, forgetRadarBlocks, radarBlockStats, radarRaw } from "./radarBlocks";
import { declarations, moves, roaches, touches, users } from "./schema";

// Runs against the database named in vitest.config.mts, wiped before every test

const DAY = 86_400_000;
const SHANGHAI = { lng: 121.47, lat: 31.23 };

/** The radar as it read the database before the squares, query by query, for comparing */
async function scanDirect(userId: string, center: LngLat, now: number) {
  const c = sql`ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography`;
  const reach = RADAR_RADIUS_KM * 1010;
  const within = (geog: AnyColumn) => sql`ST_DWithin(${geog}, ${c}, ${reach})`;
  const near = await db
    .select({ owner: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(and(ne(roaches.userId, userId), within(roaches.geog)));
  const moveRows = await db
    .select()
    .from(moves)
    .where(and(ne(moves.userId, userId), gt(moves.at, new Date(now - 7 * DAY)), or(within(moves.fromGeog), within(moves.toGeog))));
  const recent: Move[] = moveRows.map((m) => ({
    owner: m.userId,
    slot: m.slot,
    from: m.fromLng === null || m.fromLat === null ? null : { lng: m.fromLng, lat: m.fromLat },
    to: m.toLng === null || m.toLat === null ? null : { lng: m.toLng, lat: m.toLat },
    at: m.at.getTime(),
  }));
  const nearPlayers = sql`(select ${roaches.userId} from ${roaches} where ${within(roaches.geog)})`;
  const touched = (
    await db
      .select({ to: touches.toUserId })
      .from(touches)
      .where(and(gt(touches.createdAt, new Date(now - DAY)), sql`${touches.toUserId} in ${nearPlayers}`))
  ).map((t) => t.to);
  const declaring = (
    await db
      .select({ from: declarations.senderId })
      .from(declarations)
      .where(and(gt(declarations.createdAt, new Date(now - DAY)), sql`${declarations.senderId} in ${nearPlayers}`))
  ).map((d) => d.from);
  return buildRadar({
    center,
    now,
    roaches: near.map((r) => ({ owner: r.owner, slot: r.slot, at: { lng: r.lng, lat: r.lat } })),
    moves: recent,
    touchedPlayers: touched,
    declaringPlayers: declaring,
    friends: new Set(),
    demo: false,
  });
}

/** The radar from the squares */
async function scanBlocks(userId: string, center: LngLat, now: number) {
  const raw = await radarRaw(center, userId, now);
  return buildRadar({ center, now, ...raw, friends: new Set(), demo: false });
}

/** A crowd round a point, many of them on the edges of squares, with a week of moves, touches and declarations */
async function crowd(seed: number, around: LngLat, players = 240) {
  const rand = mulberry32(seed);
  const ids: string[] = [];
  const now = Date.now();
  // within 1.2° of the point, and a third of them snapped to within a few metres of a square's edge
  const spot = () => {
    let lng = around.lng + (rand() * 2 - 1) * 1.2;
    let lat = around.lat + (rand() * 2 - 1) * 1.0;
    if (rand() < 0.35) lng = Math.round(lng / BLOCK_DEG) * BLOCK_DEG + (rand() - 0.5) * 0.0002;
    if (rand() < 0.35) lat = Math.round(lat / BLOCK_DEG) * BLOCK_DEG + (rand() - 0.5) * 0.0002;
    // the map keeps longitudes within ±180 (world/logic.ts checkSpot)
    return { lng: ((((lng + 180) % 360) + 360) % 360) - 180, lat };
  };
  const userRows = Array.from({ length: players }, (_, i) => ({ email: `crowd${seed}-${i}@example.com` }));
  for (const u of await db.insert(users).values(userRows).returning({ id: users.id })) ids.push(u.id);
  const roachRows = ids.flatMap((id) => {
    const n = 1 + Math.floor(rand() * 3);
    return Array.from({ length: n }, (_, slot) => ({ userId: id, slot, ...spot() }));
  });
  await db.insert(roaches).values(roachRows);
  const moveRows = Array.from({ length: 600 }, () => {
    const kind = rand();
    const from = kind < 0.2 ? null : spot();
    const to = kind > 0.9 ? null : spot();
    return {
      userId: ids[Math.floor(rand() * ids.length)],
      slot: Math.floor(rand() * 3),
      fromLng: from?.lng ?? null,
      fromLat: from?.lat ?? null,
      toLng: to?.lng ?? null,
      toLat: to?.lat ?? null,
      // up to 8 days back: some too old to count
      at: new Date(now - rand() * 8 * DAY),
    };
  });
  await db.insert(moves).values(moveRows);
  await db.insert(touches).values(
    Array.from({ length: 200 }, () => ({
      fromUserId: ids[Math.floor(rand() * ids.length)],
      toUserId: ids[Math.floor(rand() * ids.length)],
      bold: rand() < 0.5,
      createdAt: new Date(now - rand() * 2 * DAY),
    })),
  );
  await db.insert(declarations).values(
    Array.from({ length: 120 }, () => ({
      senderId: ids[Math.floor(rand() * ids.length)],
      template: "launch",
      game: "arknights",
      recipients: 0,
      createdAt: new Date(now - rand() * 2 * DAY),
    })),
  );
  return ids;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  forgetRadarBlocks();
});

describe("radar squares", () => {
  it("counts exactly as before, centres on and off the squares' edges", { timeout: 120_000 }, async () => {
    const ids = await crowd(7, SHANGHAI);
    const now = Date.now();
    const rand = mulberry32(99);
    const centres = [
      SHANGHAI,
      // on a corner of four squares, and on edges
      { lng: 121.5, lat: 31.5 },
      { lng: 121.0, lat: 31.234 },
      { lng: 121.37, lat: 31.0 },
      ...Array.from({ length: 6 }, () => ({ lng: SHANGHAI.lng + (rand() - 0.5) * 1.5, lat: SHANGHAI.lat + (rand() - 0.5) * 1.2 })),
    ];
    for (const [i, center] of centres.entries()) {
      // each from the point of view of a player in the crowd, whose own roaches and moves are left out
      const me = ids[i * 7];
      const before = await scanDirect(me, center, now);
      const after = await scanBlocks(me, center, now);
      expect(after, JSON.stringify(center)).toEqual(before);
      expect(before.roaches).toBeGreaterThan(0);
    }
  });

  it("counts across the 180° meridian as before", { timeout: 120_000 }, async () => {
    const ids = await crowd(11, { lng: 179.6, lat: -16.5 }, 80);
    const now = Date.now();
    for (const center of [
      { lng: 179.9, lat: -16.5 },
      { lng: -179.95, lat: -16.4 },
    ]) {
      expect(await scanBlocks(ids[0], center, now)).toEqual(await scanDirect(ids[0], center, now));
    }
  });

  it("reads a square again only once it is five minutes old", { timeout: 60_000 }, async () => {
    const ids = await crowd(3, SHANGHAI, 60);
    const now = Date.now();
    const first = await scanBlocks(ids[0], SHANGHAI, now);
    const squares = radarBlockStats().blocks;
    expect(squares).toBe(blocksAround(SHANGHAI).length);
    // a newcomer in the middle of the circle
    const [u] = await db.insert(users).values({ email: "late@example.com" }).returning({ id: users.id });
    await db.insert(roaches).values({ userId: u.id, slot: 0, ...SHANGHAI });
    expect((await scanBlocks(ids[0], SHANGHAI, now + BLOCK_MS - 1000)).roaches).toBe(first.roaches);
    expect((await scanBlocks(ids[0], SHANGHAI, now + BLOCK_MS)).roaches).toBe(first.roaches + 1);
    expect(radarBlockStats().blocks).toBe(squares);
  });

  it("covers the circle with squares, some 30 round Shanghai", () => {
    const squares = blocksAround(SHANGHAI);
    expect(squares.length).toBeGreaterThanOrEqual(20);
    expect(squares.length).toBeLessThanOrEqual(36);
    // the circle's furthest points fall in one of them
    for (const [dx, dy] of [
      [0, 0.9],
      [0, -0.9],
      [1.05, 0],
      [-1.05, 0],
    ]) {
      const p = { lng: SHANGHAI.lng + dx, lat: SHANGHAI.lat + dy };
      expect(squares.some(([x, y]) => Math.floor(p.lng / BLOCK_DEG) === x && Math.floor(p.lat / BLOCK_DEG) === y)).toBe(true);
    }
  });
});
