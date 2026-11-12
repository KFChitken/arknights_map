import "server-only";
import { gt } from "drizzle-orm";
import { homeSpot } from "../siHomes";
import { brushOf, queueSpot, roomOf, roomSpot, STAY_MS, toLngLat, toXY } from "../siInn";
import { encodeInk, INK_BYTES, INK_TILE_ZOOM, pointOf, tapOf, tileOf } from "../siTiles";
import { ROACH_AVATARS } from "../types";
import { db } from "./db";
import { siInks, siTickets } from "./schema";
import { siNow } from "./siClock";

/**
 * 缘缘庄's ink roaches for the map close up (src/lib/siTiles.ts): every web process keeps the inks and
 * tickets in memory, adds only what is new or changed every half minute (new tickets by number; inks by
 * si_inks.changed, so a recall or a return to the queue shows too; an ink's latest ticket comes with the
 * ticket), works out where each one is from them (src/lib/siInn.ts, src/lib/siHomes.ts) and sorts them
 * into tiles, each sent as a few bytes an ink: where, which look, standing or lying, which way, its brush,
 * and the number it is tapped by. Held ones (recalled, or waiting for room among their owner's clones) are
 * off the map. No ink numbers or owners: two players asking for the same tile get the same bytes.
 */

const REFRESH_MS = 30_000;
const LOOKS = ROACH_AVATARS as readonly string[];

export type Snapshot = {
  /** Highest ink number, ticket and si_inks.changed held */
  lastNo: number;
  lastN: number;
  lastChanged: number;
  /** By ink number: look (index into ROACH_AVATARS), latest ticket, tap number (siTiles.ts tapOf), held (1) or not */
  look: Uint8Array;
  ticket: Uint32Array;
  tap: Uint32Array;
  held: Uint8Array;
  /** By ticket number: when it got (or gets) its room, in seconds */
  checkin: Float64Array;
};

/** Nothing held yet, with room for the first thousand */
export const emptySnapshot = (): Snapshot => ({
  lastNo: 0,
  lastN: 0,
  lastChanged: 0,
  look: new Uint8Array(1024),
  ticket: new Uint32Array(1024),
  tap: new Uint32Array(1024),
  held: new Uint8Array(1024),
  checkin: new Float64Array(1024),
});

let snap = emptySnapshot();
let refreshedAt = 0;
let refreshing: Promise<void> | null = null;
/** The tiles, worked out from the snapshot at one moment of her clock */
let tiles: { at: number; byKey: Map<string, Uint8Array> } | null = null;
/** Ink roaches on the map (with a ticket and not held), as of the last refresh */
let onMap = 0;

const grow = <T extends Uint8Array | Uint32Array | Float64Array>(a: T, size: number, make: (n: number) => T): T => {
  if (size < a.length) return a;
  const b = make(Math.max(size + 1, a.length * 2));
  b.set(a);
  return b;
};

type InkRow = { no: number; look: string; publicId: string; held: boolean; changed: number };
type TicketRow = { n: number; inkNo: number; checkinAt: Date };

/**
 * The new or changed inks and the new tickets into the snapshot. Every ticket is kept, its ink read now or not:
 * room is made for the ink it names, whose look comes with a later read.
 */
export function addToSnapshot(s: Snapshot, inks: InkRow[], tickets: TicketRow[]) {
  let top = 0;
  for (const i of inks) if (i.no > top) top = i.no;
  for (const t of tickets) if (t.inkNo > top) top = t.inkNo;
  if (top) {
    s.look = grow(s.look, top, (n) => new Uint8Array(n));
    s.ticket = grow(s.ticket, top, (n) => new Uint32Array(n));
    s.tap = grow(s.tap, top, (n) => new Uint32Array(n));
    s.held = grow(s.held, top, (n) => new Uint8Array(n));
  }
  for (const i of inks) {
    s.look[i.no] = Math.max(0, LOOKS.indexOf(i.look));
    s.tap[i.no] = tapOf(i.publicId);
    s.held[i.no] = i.held ? 1 : 0;
    if (i.no > s.lastNo) s.lastNo = i.no;
    if (i.changed > s.lastChanged) s.lastChanged = i.changed;
  }
  if (tickets.length) {
    const last = tickets[tickets.length - 1].n;
    s.checkin = grow(s.checkin, last, (n) => new Float64Array(n));
    for (const t of tickets) {
      s.checkin[t.n] = t.checkinAt.getTime() / 1000;
      // tickets go out in order, so the last one read for an ink is its latest
      s.ticket[t.inkNo] = t.n;
    }
    s.lastN = last;
  }
}

/** On the map: drawn with a ticket, and not held */
function countOnMap(s: Snapshot) {
  let n = 0;
  for (let no = 1; no <= s.lastNo; no++) if (s.ticket[no] && !s.held[no]) n++;
  return n;
}

async function refresh() {
  // tickets before inks: a ticket's ink is always written before it (it is a foreign key), so the inks read
  // next take in every ink these tickets name. Inks by `changed`, which is given out under the inn's lock
  // (src/lib/server/si.ts), so in the order the changes were made: none read is ever older than one missed.
  const tickets = await db
    .select({ n: siTickets.n, inkNo: siTickets.inkNo, checkinAt: siTickets.checkinAt })
    .from(siTickets)
    .where(gt(siTickets.n, snap.lastN))
    .orderBy(siTickets.n);
  const rows = await db
    .select({
      no: siInks.no,
      look: siInks.look,
      publicId: siInks.publicId,
      ticket: siInks.ticket,
      recalledAt: siInks.recalledAt,
      changed: siInks.changed,
    })
    .from(siInks)
    .where(gt(siInks.changed, snap.lastChanged))
    .orderBy(siInks.changed);
  const inks = rows.map((r) => ({ no: r.no, look: r.look, publicId: r.publicId, held: r.ticket === null || r.recalledAt !== null, changed: r.changed }));
  addToSnapshot(snap, inks, tickets);
  if (inks.length || tickets.length) {
    tiles = null;
    onMap = countOnMap(snap);
  }
}

/** The snapshot, at most REFRESH_MS old */
async function fresh() {
  if (Date.now() - refreshedAt < REFRESH_MS) return;
  refreshing ??= refresh()
    .then(() => {
      refreshedAt = Date.now();
    })
    .finally(() => {
      refreshing = null;
    });
  await refreshing;
}

/** How many had their room by `t` (seconds): the snapshot's checked-in count */
function checkedInBy(t: number) {
  // check-ins only grow with the ticket number
  let lo = 0;
  let hi = snap.lastN;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (snap.checkin[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Where ink `no` is at `t` (seconds), with `inBy` the tickets that had their room by then: queuing (its place by its
 * ticket, so one recalled ahead leaves its place empty), in its room, or home in the fields; null while held, or
 * before it has a ticket
 */
function placeOf(no: number, t: number, inBy: number) {
  const n = snap.ticket[no];
  if (!n || snap.held[no]) return null;
  const inAt = snap.checkin[n];
  const state = inAt > t ? 0 : inAt + STAY_MS / 1000 > t ? 1 : 2;
  const spot = state === 0 ? queueSpot(n - inBy) : state === 1 ? roomSpot(roomOf(n)) : homeSpot(no);
  return { state, spot };
}

/** Every ink roach where it is at her clock's `now`, sorted into tiles */
function sortIntoTiles(now: number) {
  const t = now / 1000;
  const inBy = checkedInBy(t);
  const lists = new Map<string, number[]>();
  for (let no = 1; no <= snap.lastNo; no++) {
    const p = placeOf(no, t, inBy);
    if (!p) continue;
    const at = toLngLat(p.spot.x, p.spot.y);
    const { key, fx, fy } = tileOf(at, INK_TILE_ZOOM);
    const b = brushOf(no);
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(fx, fy, snap.look[no], p.state, p.spot.left ? 1 : 0, b.size, b.tilt, b.ink, snap.tap[no]);
  }
  const byKey = new Map<string, Uint8Array>();
  for (const [key, list] of lists) {
    const out = new Uint8Array((list.length / 9) * INK_BYTES);
    for (let i = 0, k = 0; i < list.length; i += 9, k++) {
      encodeInk(out, k * INK_BYTES, {
        fx: list[i],
        fy: list[i + 1],
        look: list[i + 2],
        state: list[i + 3],
        left: list[i + 4] === 1,
        size: list[i + 5],
        tilt: list[i + 6],
        ink: list[i + 7],
        tap: list[i + 8],
      });
    }
    byKey.set(key, out);
  }
  tiles = { at: now, byKey };
}

const EMPTY = new Uint8Array(0);

/** One tile's ink roaches (x, y at INK_TILE_ZOOM), as they are now, fresh to half a minute */
export async function inkTile(x: number, y: number) {
  await fresh();
  const now = siNow();
  // queues move on as rooms free: worked out again with every refresh, or half a minute on
  if (!tiles || now - tiles.at >= REFRESH_MS) sortIntoTiles(now);
  return tiles!.byKey.get(`${x}/${y}`) ?? EMPTY;
}

/**
 * The ink roach tapped on the map, by the tap number its tile gave and where in the tile (x, y at INK_TILE_ZOOM) it
 * was: its number, should one on the map have that tap number now; of two that share it, the one nearest. Not only
 * in that tile: the queue may have moved it on since the page had the tile.
 */
export async function inkTapped(x: number, y: number, tap: number, fx: number, fy: number): Promise<number | null> {
  await fresh();
  const t = siNow() / 1000;
  const inBy = checkedInBy(t);
  const [ax, ay] = toXY(pointOf(x, y, INK_TILE_ZOOM, fx, fy));
  let best: number | null = null;
  let bestD = Infinity;
  for (let no = 1; no <= snap.lastNo; no++) {
    if (snap.tap[no] !== tap) continue;
    const p = placeOf(no, t, inBy);
    if (!p) continue;
    const d = (p.spot.x - ax) ** 2 + (p.spot.y - ay) ** 2;
    if (d < bestD) {
      bestD = d;
      best = no;
    }
  }
  return best;
}

/**
 * How many ink roaches are on the map, for 「全球 N 只」 (src/lib/server/roachFeed.ts): fresh to half a minute,
 * asked again in the background when older, so it can be read at once wherever the counts are made
 */
export function inksOnMap() {
  if (Date.now() - refreshedAt >= REFRESH_MS && !refreshing) void fresh().catch(() => {});
  return onMap;
}

/** One of this process's own changes (a recall): read again at the next ask, not half a minute on */
export function inksChanged() {
  refreshedAt = 0;
}

/** Tests: forget everything held */
export function forgetInkSnapshot() {
  snap = emptySnapshot();
  refreshedAt = 0;
  tiles = null;
  onMap = 0;
}
