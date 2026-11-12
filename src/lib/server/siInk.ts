import "server-only";
import { gt } from "drizzle-orm";
import { homeSpot } from "../siHomes";
import { brushOf, queueSpot, roomOf, roomSpot, STAY_MS, toLngLat } from "../siInn";
import { encodeInk, INK_BYTES, INK_TILE_ZOOM, tileOf } from "../siTiles";
import { ROACH_AVATARS } from "../types";
import { db } from "./db";
import { siInks, siTickets } from "./schema";
import { siNow } from "./siClock";

/**
 * 缘缘庄's ink roaches for the map close up (src/lib/siTiles.ts): every web process keeps the inks and
 * tickets in memory, adds only the new ones every half minute (an ink's latest ticket comes with the
 * ticket), works out where each one is from them (src/lib/siInn.ts, src/lib/siHomes.ts) and sorts them
 * into tiles, each sent as a few bytes an ink: where, which look, standing or lying, which way, and its
 * brush. No ids, numbers or owners: two players asking for the same tile get the same bytes.
 */

const REFRESH_MS = 30_000;
const LOOKS = ROACH_AVATARS as readonly string[];

export type Snapshot = {
  /** Highest ink number and ticket held */
  lastNo: number;
  lastN: number;
  /** By ink number: look (index into ROACH_AVATARS), latest ticket */
  look: Uint8Array;
  ticket: Uint32Array;
  /** By ticket number: when it got (or gets) its room, in seconds */
  checkin: Float64Array;
};

/** Nothing held yet, with room for the first thousand */
export const emptySnapshot = (): Snapshot => ({ lastNo: 0, lastN: 0, look: new Uint8Array(1024), ticket: new Uint32Array(1024), checkin: new Float64Array(1024) });

let snap = emptySnapshot();
let refreshedAt = 0;
let refreshing: Promise<void> | null = null;
/** The tiles, worked out from the snapshot at one moment of her clock */
let tiles: { at: number; byKey: Map<string, Uint8Array> } | null = null;

const grow = <T extends Uint8Array | Uint32Array | Float64Array>(a: T, size: number, make: (n: number) => T): T => {
  if (size < a.length) return a;
  const b = make(Math.max(size + 1, a.length * 2));
  b.set(a);
  return b;
};

type InkRow = { no: number; look: string };
type TicketRow = { n: number; inkNo: number; checkinAt: Date };

/**
 * The new inks and tickets into the snapshot. Every ticket is kept, its ink read now or not: room is made for
 * the ink it names, whose look comes with a later read.
 */
export function addToSnapshot(s: Snapshot, inks: InkRow[], tickets: TicketRow[]) {
  let top = inks.length ? inks[inks.length - 1].no : 0;
  for (const t of tickets) if (t.inkNo > top) top = t.inkNo;
  if (top) {
    s.look = grow(s.look, top, (n) => new Uint8Array(n));
    s.ticket = grow(s.ticket, top, (n) => new Uint32Array(n));
  }
  if (inks.length) {
    for (const i of inks) s.look[i.no] = Math.max(0, LOOKS.indexOf(i.look));
    s.lastNo = inks[inks.length - 1].no;
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

async function refresh() {
  // tickets before inks: a ticket's ink is always written before it (it is a foreign key), so the inks read
  // next take in every ink these tickets name
  const tickets = await db
    .select({ n: siTickets.n, inkNo: siTickets.inkNo, checkinAt: siTickets.checkinAt })
    .from(siTickets)
    .where(gt(siTickets.n, snap.lastN))
    .orderBy(siTickets.n);
  const inks = await db
    .select({ no: siInks.no, look: siInks.look })
    .from(siInks)
    .where(gt(siInks.no, snap.lastNo))
    .orderBy(siInks.no);
  addToSnapshot(snap, inks, tickets);
  if (inks.length || tickets.length) tiles = null;
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

/** Every ink roach where it is at her clock's `now`, sorted into tiles */
function sortIntoTiles(now: number) {
  const t = now / 1000;
  const inBy = checkedInBy(t);
  const lists = new Map<string, number[]>();
  for (let no = 1; no <= snap.lastNo; no++) {
    const n = snap.ticket[no];
    if (!n) continue;
    const inAt = snap.checkin[n];
    const state = inAt > t ? 0 : inAt + STAY_MS / 1000 > t ? 1 : 2;
    const spot = state === 0 ? queueSpot(n - inBy) : state === 1 ? roomSpot(roomOf(n)) : homeSpot(no);
    const at = toLngLat(spot.x, spot.y);
    const { key, fx, fy } = tileOf(at, INK_TILE_ZOOM);
    const b = brushOf(no);
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(fx, fy, snap.look[no], state, spot.left ? 1 : 0, b.size, b.tilt, b.ink);
  }
  const byKey = new Map<string, Uint8Array>();
  for (const [key, list] of lists) {
    const out = new Uint8Array((list.length / 8) * INK_BYTES);
    for (let i = 0, k = 0; i < list.length; i += 8, k++) {
      encodeInk(out, k * INK_BYTES, { fx: list[i], fy: list[i + 1], look: list[i + 2], state: list[i + 3], left: list[i + 4] === 1, size: list[i + 5], tilt: list[i + 6], ink: list[i + 7] });
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

/** Tests: forget everything held */
export function forgetInkSnapshot() {
  snap = emptySnapshot();
  refreshedAt = 0;
  tiles = null;
}
