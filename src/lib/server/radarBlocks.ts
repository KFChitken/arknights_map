import "server-only";
import { and, count, gt, sql } from "drizzle-orm";
import { distanceKm } from "../geo";
import { RADAR_RADIUS_KM } from "../rules";
import type { LngLat } from "../types";
import type { Move } from "../world/cast";
import { db } from "./db";
import { declarations, moves, roaches, touches } from "./schema";

/**
 * What the radar counts (world.ts scanRadar), read from the database by squares of BLOCK_DEG and kept in
 * this process for up to BLOCK_MS: the roaches in each square, the week's moves that start or end in it, and
 * how many touches the players with a roach in it had, and declarations they sent, in the last day. A scan
 * puts together the squares its circle touches (about 20–30 round Shanghai) and counts as before (buildRadar),
 * so the numbers are the same, at most BLOCK_MS late. A square is read again only once it is that old, or a
 * little before while scans still want it, in the background; every scan near it until then costs no database.
 * Each process keeps its own, packed into typed arrays (a player's id is held once, by number).
 */

/** Squares of this many degrees each way */
export const BLOCK_DEG = 0.5;
/** How long a square is kept before it is read again */
export const BLOCK_MS = 5 * 60_000;
/** Read again in the background once this old, while scans still want it, so they rarely wait */
const REFRESH_AHEAD_MS = 4 * 60_000;
/** Squares nobody has scanned for this long are let go */
const FORGET_MS = 3 * BLOCK_MS;

const DAY = 86_400_000;

// every player seen, held once: squares refer to them by number
const playerIds: string[] = [];
const playerNo = new Map<string, number>();
const noOf = (id: string) => {
  let n = playerNo.get(id);
  if (n === undefined) {
    n = playerIds.length;
    playerIds.push(id);
    playerNo.set(id, n);
  }
  return n;
};

type Block = {
  /** When it was read, and when a scan last used it */
  at: number;
  usedAt: number;
  /** Roaches: owner number and slot; place (lng, lat) */
  roachOwner: Int32Array;
  roachSlot: Int8Array;
  roachAt: Float64Array;
  /** Moves: id, owner number, slot, from and to (NaN where none), when */
  moveId: Float64Array;
  moveOwner: Int32Array;
  moveSlot: Int8Array;
  movePlaces: Float64Array;
  moveAt: Float64Array;
  /** The day's touches to, and declarations by, each player with a roach here: by player number */
  touched: Map<number, number>;
  declared: Map<number, number>;
};

const blocks = new Map<string, Block>();
const loading = new Map<string, Promise<Block>>();
let sweptAt = 0;

const keyOf = (x: number, y: number) => `${x},${y}`;

/** The squares (their south-west corners, in whole BLOCK_DEG steps) a circle of RADAR_RADIUS_KM round a point touches */
export function blocksAround(center: LngLat): [number, number][] {
  const dLat = (RADAR_RADIUS_KM / 111) * 1.01;
  const dLng = Math.min(180, dLat / Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  const out: [number, number][] = [];
  for (let y = Math.floor((center.lat - dLat) / BLOCK_DEG); y <= Math.floor((center.lat + dLat) / BLOCK_DEG); y++) {
    const seen = new Set<number>();
    for (let x = Math.floor((center.lng - dLng) / BLOCK_DEG); x <= Math.floor((center.lng + dLng) / BLOCK_DEG); x++) {
      // across the 180° meridian, to the same square once
      const wrapped = ((((x * BLOCK_DEG + 180) % 360) + 360) % 360) - 180;
      const bx = Math.round(wrapped / BLOCK_DEG);
      if (seen.has(bx)) continue;
      seen.add(bx);
      out.push([bx, y]);
    }
  }
  return out;
}

/** One square read from the database, its four questions at once */
async function load(x: number, y: number, now: number): Promise<Block> {
  const west = x * BLOCK_DEG;
  const south = y * BLOCK_DEG;
  const east = west + BLOCK_DEG;
  const north = south + BLOCK_DEG;
  // the square, a little wider, as a box the spatial indexes can use; exactly which points are in it is decided
  // by their degrees (a geography box's edges are great circles, which bow away from the parallels)
  const m = 0.01;
  const box = sql`ST_MakeEnvelope(${Math.max(-180, west - m)}, ${Math.max(-90, south - m)}, ${Math.min(180, east + m)}, ${Math.min(90, north + m)}, 4326)::geography`;
  const inSquare = (lng: number | null, lat: number | null) => lng !== null && lat !== null && lng >= west && lng < east && lat >= south && lat < north;
  // the players with a roach here (as the square holds them, by the same box); any outside it only widen the
  // counts, which the scan narrows to the owners of roaches in its circle
  const playersHere = sql`(select ${roaches.userId} from ${roaches} where ${roaches.geog} && ${box})`;
  const [roachRows, moveRows, touchRows, declRows] = await Promise.all([
    db
      .select({ owner: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
      .from(roaches)
      .where(sql`${roaches.geog} && ${box}`),
    db
      .select({
        id: moves.id,
        userId: moves.userId,
        slot: moves.slot,
        fromLng: moves.fromLng,
        fromLat: moves.fromLat,
        toLng: moves.toLng,
        toLat: moves.toLat,
        at: moves.at,
      })
      .from(moves)
      .where(and(gt(moves.at, new Date(now - 7 * DAY)), sql`(${moves.fromGeog} && ${box} or ${moves.toGeog} && ${box})`)),
    db
      .select({ player: touches.toUserId, n: count() })
      .from(touches)
      .where(and(gt(touches.createdAt, new Date(now - DAY)), sql`${touches.toUserId} in ${playersHere}`))
      .groupBy(touches.toUserId),
    db
      .select({ player: declarations.senderId, n: count() })
      .from(declarations)
      .where(and(gt(declarations.createdAt, new Date(now - DAY)), sql`${declarations.senderId} in ${playersHere}`))
      .groupBy(declarations.senderId),
  ]);
  const here = roachRows.filter((r) => inSquare(r.lng, r.lat));
  const b: Block = {
    at: now,
    usedAt: now,
    roachOwner: Int32Array.from(here, (r) => noOf(r.owner)),
    roachSlot: Int8Array.from(here, (r) => r.slot),
    roachAt: Float64Array.from(here.flatMap((r) => [r.lng, r.lat])),
    moveId: new Float64Array(0),
    moveOwner: new Int32Array(0),
    moveSlot: new Int8Array(0),
    movePlaces: new Float64Array(0),
    moveAt: new Float64Array(0),
    touched: new Map(touchRows.map((t) => [noOf(t.player), t.n])),
    declared: new Map(declRows.map((d) => [noOf(d.player), d.n])),
  };
  const mv = moveRows.filter((r) => inSquare(r.fromLng, r.fromLat) || inSquare(r.toLng, r.toLat));
  b.moveId = Float64Array.from(mv, (r) => r.id);
  b.moveOwner = Int32Array.from(mv, (r) => noOf(r.userId));
  b.moveSlot = Int8Array.from(mv, (r) => r.slot);
  b.movePlaces = Float64Array.from(mv.flatMap((r) => [r.fromLng ?? NaN, r.fromLat ?? NaN, r.toLng ?? NaN, r.toLat ?? NaN]));
  b.moveAt = Float64Array.from(mv, (r) => r.at.getTime());
  return b;
}

/** Read a square (once, however many scans want it), and keep it */
function reload(x: number, y: number, now: number) {
  const key = keyOf(x, y);
  let p = loading.get(key);
  if (!p) {
    p = load(x, y, now)
      .then((b) => {
        blocks.set(key, b);
        return b;
      })
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/** A square: as kept while young enough (read again in the background when nearly too old), else read again */
async function blockAt(x: number, y: number, now: number): Promise<Block> {
  const kept = blocks.get(keyOf(x, y));
  if (kept && now - kept.at < BLOCK_MS) {
    kept.usedAt = now;
    if (now - kept.at >= REFRESH_AHEAD_MS) reload(x, y, now).catch(() => {});
    return kept;
  }
  return reload(x, y, now);
}

/** Let go of the squares nobody has wanted for a while (at most once a minute) */
function sweep(now: number) {
  if (now - sweptAt < 60_000) return;
  sweptAt = now;
  for (const [key, b] of blocks) if (now - b.usedAt > FORGET_MS) blocks.delete(key);
}

const placeOf = (a: Float64Array, i: number): LngLat | null => (Number.isNaN(a[i]) ? null : { lng: a[i], lat: a[i + 1] });

/**
 * What the radar counts round a point, from the squares its circle touches: the roaches inside the circle and
 * the moves across its edge (only those can count, by the same test buildRadar uses), but the scanning player's
 * own (a move in two of the squares once); and who was touched or declared, one entry a touch or declaration
 * (as buildRadar counts them) for each player with a roach in those squares.
 */
export async function radarRaw(center: LngLat, userId: string, now = Date.now()) {
  sweep(now);
  const squares = await Promise.all(blocksAround(center).map(([x, y]) => blockAt(x, y, now)));
  const me = playerNo.get(userId) ?? -1;
  const roachesNear: { owner: string; slot: number; at: LngLat }[] = [];
  const movesNear: Move[] = [];
  const seenMoves = new Set<number>();
  const touched = new Map<number, number>();
  const declared = new Map<number, number>();
  const inside = (p: LngLat | null) => Boolean(p && distanceKm(center, p) <= RADAR_RADIUS_KM);
  for (const b of squares) {
    for (let i = 0; i < b.roachOwner.length; i++) {
      if (b.roachOwner[i] === me) continue;
      const at = { lng: b.roachAt[i * 2], lat: b.roachAt[i * 2 + 1] };
      if (inside(at)) roachesNear.push({ owner: playerIds[b.roachOwner[i]], slot: b.roachSlot[i], at });
    }
    for (let i = 0; i < b.moveId.length; i++) {
      if (b.moveOwner[i] === me || seenMoves.has(b.moveId[i])) continue;
      seenMoves.add(b.moveId[i]);
      const from = placeOf(b.movePlaces, i * 4);
      const to = placeOf(b.movePlaces, i * 4 + 2);
      // a move within the circle, or outside it, crosses nothing
      if (inside(from) === inside(to)) continue;
      movesNear.push({ owner: playerIds[b.moveOwner[i]], slot: b.moveSlot[i], from, to, at: b.moveAt[i] });
    }
    // a player with roaches in two squares has the same count in both: once
    for (const [p, n] of b.touched) touched.set(p, n);
    for (const [p, n] of b.declared) declared.set(p, n);
  }
  const repeat = (counts: Map<number, number>) => [...counts].flatMap(([p, n]) => Array<string>(n).fill(playerIds[p]));
  return { roaches: roachesNear, moves: movesNear, touchedPlayers: repeat(touched), declaringPlayers: repeat(declared) };
}

/** How many squares are kept, and how much they hold (for the measurements) */
export function radarBlockStats() {
  let roachCount = 0;
  let moveCount = 0;
  for (const b of blocks.values()) {
    roachCount += b.roachOwner.length;
    moveCount += b.moveId.length;
  }
  return { blocks: blocks.size, roaches: roachCount, moves: moveCount, players: playerIds.length };
}

/** Tests: nothing kept */
export function forgetRadarBlocks() {
  blocks.clear();
  loading.clear();
  sweptAt = 0;
}
