import "server-only";
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants as zlib, gzip } from "node:zlib";
import { and, asc, eq, gt, gte, inArray, lt, lte, max, or, sql } from "drizzle-orm";
import { isNearFire } from "../talulah";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
import { boxText, inBox, overviewCell, type Area, type Box } from "../world/area";
import { botRoaches } from "../world/bots";
import { nearMetre, packRoaches, SHORT_ID, shortIds } from "../world/packed";
import type { MapRoach } from "../world/types";
import { db } from "./db";
import { SHOW_BOTS } from "./env";
import { countNear, snapSpot } from "./nearby";
import { roachChanges, roaches, users } from "./schema";

/**
 * Everyone's roaches as one snapshot shared by every viewer. It holds no
 * owners and nothing viewer-specific (each browser leaves out its own roaches
 * and marks its friends'), so it is built once and handed to everyone. A page
 * that already holds a version only downloads what changed since.
 *
 * The snapshot is made once as the process starts, and from then on only the
 * roaches that changed are changed in it: the database notes each roach put
 * down, moved, taken back or whose look changes (roach_changes, written by a
 * trigger), and every POLL_MS the feed reads what came since it last looked and
 * re-reads just those roaches, whichever process changed them. Each round with
 * changes is a new version. Every CHECK_MS the whole table is read once more, a
 * piece at a time, and anything the rounds missed is put right (and logged).
 *
 * Places are given to about a metre. A page asks for the whole snapshot in one
 * of three forms (?f=): the list (pages from before the packed form), packed
 * with whole public ids (2), or packed with short ids (3: the first four bytes
 * of each public id, world/packed.ts), which is what pages ask for now; what
 * changed since a version comes with the same ids as the form asked. Only the
 * whole snapshot in each form is made when a page first asks for it at a version.
 *
 * Restarts. With FEED_STATE set to a file, the feed writes down where it is
 * (its epoch and version, a hash of each roach, the recent changes) every
 * SAVE_MS and when the process is told to stop, and takes up from there when
 * it starts again: the pages open across a deploy then download only what
 * changed meanwhile. A page whose version the feed does not know (no saved
 * state, or one from another process) still gets the whole snapshot, but in
 * the first SPREAD_MS after a start (OLD_SPREAD_MS for the older forms) not all
 * at once: each such page asks again later with a chance that grows over that time.
 */

/** How often the changes others wrote are read (a page's own wait no longer; roachesChanged does not hurry it) */
const POLL_MS = 3000;
/** How often the whole table is read again, a piece at a time, to put right anything the rounds missed */
const CHECK_MS = 30 * 60_000;
/** Roaches read at a time in that check */
const CHECK_CHUNK = 20_000;
/** A gap in the change numbers (a change not yet committed, or rolled back) is looked for again this long */
const GAP_MS = 60_000;
/** Roaches put in at a time by a round (or the check) that read many, each piece a version of its own */
const APPLY_CHUNK = 2000;
/** The triggers that write roach_changes (drizzle/0040_roach_changes.sql) */
const TRIGGERS = ["roach_changes_ins", "roach_changes_del", "roach_changes_upd", "roach_owner_changes_upd"];
/** Changes the first round reads again, from before the snapshot was made */
const REREAD_AT_START = 2000;
/** Changes are kept this long; a page further behind gets the whole snapshot again. */
const KEEP_CHANGES_MS = 3 * 60 * 60_000;
/** So does a page whose changes would be more than this share of all the roaches (and more than MIN_DIFF), which the snapshot holds in less room. */
const MAX_DIFF_SHARE = 0.2;
const MIN_DIFF = 500;
/** How many worked-out answers for older versions a snapshot keeps */
const DIFF_CACHE = 64;
/**
 * How often the state is written down (and when the process is told to stop, at once). Each write is a second
 * or more of work with a few hundred thousand roaches, done a piece at a time (writeState): only for a process
 * that ends without being told, whose pages then download a little more after its restart.
 */
const SAVE_MS = 5 * 60_000;
/** Ids or hashes written down at a time by a save in the background (changes: a tenth of this) */
const SAVE_PIECE = 20_000;
/**
 * After a restart from a saved state, versions go on this far past the saved one: a page may hold
 * a version made after the last save (when the process ended without saving), which then means
 * nothing here, so every version between is taken as unknown.
 */
const SKIP = 1000;
const SPREAD_MS = 10 * 60_000;
/**
 * Pages still running code from before the short form (f=1, f=2) wait longer: an hour. Each needs
 * the old, bigger snapshot once, and most of them are reloaded meanwhile, after which they ask for
 * the short form anyway.
 */
const OLD_SPREAD_MS = 60 * 60_000;
/** A version as pages hold it: the epoch (random hex) and a number */
const VERSION = /^[0-9a-f]{8}\.\d{1,12}$/;

/** How a roach looks to others: its owner's look, except that clones all look alike, so a clone cannot point at its main roach. */
export function lookOf(slot: number, avatar: string, color: string) {
  return slot > 0
    ? { avatar: "hood" as const, color: "white" as const }
    : { avatar: ROACH_AVATARS.find((a) => a === avatar) ?? "hood", color: ROACH_COLORS.find((c) => c === color) ?? "cyan" };
}

/** The forms a page can ask for (?f=): 1 the list, 2 packed with public ids, 3 packed with short ids */
export type FeedForm = 1 | 2 | 3;
/** Which ids a form gives: the whole public ids, or the short ones */
type View = "long" | "short";
const viewOf = (form: FeedForm): View => (form === 3 ? "short" : "long");

type Whole = { json: string; gzip: Buffer; br?: Buffer };

/**
 * What a visitor who has not signed in gets instead of the roaches (src/app/api/roaches): how many there are, by
 * 塔露拉干员's fire, and riding with 明河都尉; and how many players they belong to, which is how many main roaches
 * there are: a clone needs its player's main roach there first, and goes when it does. Show roaches (bots) are nobody's.
 */
export type FeedCounts = { total: number; fire: number; riders: number; players: number };

/** A square of the overview (overviewCell): its roaches, and the one with the lowest short id, which stands for them */
type Cell = { all: Set<MapRoach>; min: MapRoach | null; minId: string };

/**
 * The one copy of everyone's roaches, changed in place a few roaches at a time (apply). What is kept by
 * roach is kept up to date with it; what is worked out for one version (the whole forms, answers for older
 * versions, areas, the overview, visitors' counts) starts again with each new version. Short ids are not
 * stored: a roach goes by the first four bytes of its public id when it is the only one starting so (solo).
 */
type Snapshot = {
  n: number;
  v: string;
  builtAt: number;
  /** Every roach as the feed gives it, places to the metre, by public id */
  byId: Map<string, MapRoach>;
  /** A hash of each roach's look and place (hashOf), by public id: what tells a change from none */
  hashes: Map<string, number>;
  /** The one public id starting with each first four bytes; those starting with bytes several share go by their whole ids */
  solo: Map<string, string>;
  shared: Map<string, Set<string>>;
  /** The roaches by whole degree of longitude and latitude: f=4's boxes (world/area.ts) and visitors' counts (nearby.ts) */
  buckets: Map<number, Set<MapRoach>>;
  /** f=4: the roaches by square of the overview */
  cells: Map<number, Cell>;
  /** Roaches by 塔露拉干员's fire, riding with 明河都尉, and main roaches: one for each player (show roaches never count) */
  fire: number;
  riders: number;
  players: number;
  /** Main roaches asleep drunk, by public id: when they wake (and are read again) */
  drunk: Map<string, number>;
  /** The whole snapshot in each form, made when first wanted at this version */
  whole: Partial<Record<FeedForm, Promise<Whole>>>;
  /** Answers already worked out for pages at an older version, by view and that version */
  diffs: Map<string, string>;
  /** f=4: the answers for boxes asked for whole, by box, and the overview, kept across versions for a while (areaWhole) */
  areas: Map<string, KeptArea>;
  /** The overview's roaches at this version, made when first asked for */
  overview?: MapRoach[];
  /** Answers about spots already asked about, by the snapped spot, at this version */
  around?: Map<string, { near: number; far: number }>;
};

/** An f=4 answer as JSON, compressed each way when first asked for that way */
type AreaWhole = { json: string; br?: Promise<Buffer>; gzip?: Promise<Buffer> };
/** An area's whole answer as made: at which version, and when */
type KeptArea = { v: string; at: number; whole: AreaWhole };

/** The ids, in one view, of the roaches that changed or went in one version */
type Touched = { changed: string[]; removed: string[] };
/** One version's changes: from version `from` to `n` (one more, except across a restart) */
type Change = { n: number; from: number; at: number; long: Touched; short: Touched };

/** Where the process before this one left off (FEED_STATE): what the first snapshot compares with */
type Before = { n: number; hashes: Map<string, number>; short: Map<string, string> };

type Feed = {
  /** Differs on every start without a saved state, so a version from before is never mistaken for a current one */
  epoch: string;
  /** The highest change number read (roach_changes.n), and numbers below it not seen yet, with when they were missed */
  seen: number;
  gaps: Map<number, number>;
  /** When the whole table was last read through */
  checkedAt: number;
  snapshot: Snapshot | null;
  before: Before | null;
  /** Versions in (from, to) mean nothing here: made after the last save by the process before */
  unknown: { from: number; to: number } | null;
  changes: Change[];
  building: Promise<Snapshot> | null;
  /** When the last round started */
  polledAt: number;
  startedAt: number;
  /** The saved state has been looked for (once per process) */
  started: boolean;
  /** No more rounds: the process has been told to stop, and its last state is saved */
  stopping: boolean;
  savedAt: number;
  saving: Promise<void> | null;
};

const fresh = (): Feed => ({
  epoch: randomBytes(4).toString("hex"),
  seen: 0,
  gaps: new Map(),
  checkedAt: 0,
  snapshot: null,
  before: null,
  unknown: null,
  changes: [],
  building: null,
  polledAt: 0,
  startedAt: Date.now(),
  started: false,
  stopping: false,
  savedAt: 0,
  saving: null,
});

// Kept on globalThis so development reloads of this module share one feed
const g = globalThis as typeof globalThis & { __roachFeed?: Feed };
const feed: Feed = (g.__roachFeed ??= fresh());

/**
 * Called after roaches are placed, moved or removed, or someone's look changes. There is nothing left for it to
 * do: the database notes every such change itself (roach_changes), and every process reads them each round.
 * Kept so that its callers need not change.
 */
export function roachesChanged() {}

/** Whether a player's main roach lies asleep: drunk, or flipped over for their staying away. Nothing says which. */
export const sleeping = (u: { drunkUntil: Date | null; sleptAwayOn: string | null }, now = Date.now()) =>
  Boolean((u.drunkUntil && u.drunkUntil.getTime() > now) || u.sleptAwayOn);

const roachColumns = {
  slot: roaches.slot,
  publicId: roaches.publicId,
  lng: roaches.lng,
  lat: roaches.lat,
  avatar: users.avatar,
  color: users.color,
  drunkUntil: users.drunkUntil,
  sleptAwayOn: users.sleptAwayOn,
  rideSince: roaches.rideSince,
};
type RoachRow = { slot: number; publicId: string; lng: number; lat: number; avatar: string; color: string; drunkUntil: Date | null; sleptAwayOn: string | null; rideSince: Date | null };

/**
 * A roach as the feed gives it, places to the metre (as given, for allRoaches); and when its drunk owner
 * wakes, if it lies asleep for that
 */
function heldOf(r: RoachRow, now: number, toMetre = true): { roach: MapRoach; wakes: number | null } {
  const asleep = r.slot === 0 && sleeping(r, now);
  return {
    roach: {
      id: r.publicId,
      clone: r.slot > 0,
      ...lookOf(r.slot, r.avatar, r.color),
      lng: toMetre ? nearMetre(r.lng) : r.lng,
      lat: toMetre ? nearMetre(r.lat) : r.lat,
      // only the main roach lies down, drunk or away a long time, and the feed never says which or until when
      ...(asleep ? { asleep: true as const } : {}),
      // riding with 明河都尉, which only clones do; never since when
      ...(r.rideSince ? { ride: true as const } : {}),
    },
    wakes: asleep && !r.sleptAwayOn && r.drunkUntil ? r.drunkUntil.getTime() : null,
  };
}
type Read = ReturnType<typeof heldOf>;

/** Every roach on the map, the same for every viewer. */
export async function allRoaches(): Promise<MapRoach[]> {
  const rows = await db
    .select(roachColumns)
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    // ordering by the random public id keeps a player's roaches from sitting next to each other
    .orderBy(asc(roaches.publicId));
  const now = Date.now();
  return rows.map((r) => heldOf(r, now, false).roach);
}

/** These roaches as they are now (those not found are gone), a thousand at a time */
async function readRoaches(ids: string[]): Promise<Map<string, Read>> {
  const now = Date.now();
  const out = new Map<string, Read>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db
      .select(roachColumns)
      .from(roaches)
      .innerJoin(users, eq(users.id, roaches.userId))
      .where(inArray(roaches.publicId, ids.slice(i, i + 1000)));
    for (const r of rows) out.set(r.publicId, heldOf(r, now));
  }
  return out;
}

const PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The roach a page names by the id the feed gave it: its public id, or the short form of it
 * (world/packed.ts), which stands for the one roach whose public id starts with it. Null when there
 * is none, and also in the moment before pages hear that two roaches have come to share a short id.
 * ownerId: only among that player's roaches.
 */
export async function roachByFeedId(id: string, ownerId?: string) {
  const which = PUBLIC_ID.test(id)
    ? eq(roaches.publicId, id)
    : SHORT_ID.test(id)
      ? and(gte(roaches.publicId, `${id}-0000-0000-0000-000000000000`), lte(roaches.publicId, `${id}-ffff-ffff-ffff-ffffffffffff`))
      : null;
  if (!which) return null;
  const rows = await db
    .select()
    .from(roaches)
    .where(ownerId ? and(which, eq(roaches.userId, ownerId)) : which)
    .limit(2);
  return rows.length === 1 ? rows[0] : null;
}

/** FNV-1a over everything the feed says of a roach but its id */
function hashOf(r: MapRoach) {
  const s = `${r.clone ? 1 : 0}|${r.avatar}|${r.color}|${r.lng}|${r.lat}|${r.asleep ? 1 : 0}|${r.ride ? 1 : 0}|${r.bot ? 1 : 0}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

/** The whole snapshot in one form, compressed once for every page that asks */
async function makeWhole(s: Snapshot, form: FeedForm): Promise<Whole> {
  const list = [...s.byId.values()];
  const json =
    form === 1
      ? `{"v":"${s.v}","roaches":[${list.map((r) => JSON.stringify(r)).join(",")}]}`
      : form === 2
        ? `{"v":"${s.v}","packed":${JSON.stringify(packRoaches(list))}}`
        : `{"v":"${s.v}","packed":${JSON.stringify(packRoaches(list.map((r) => ({ ...r, id: shortOf(s, r.id) })), 4))}}`;
  // Every process makes these for every snapshot (every ~10 s while roaches move), so the levels are picked
  // for time. On the live list of 11/11 (1.5 MB, ~78k roaches), on a fast Mac: brotli 11 took 1.2 s for
  // 652 KB, brotli 5 19 ms for 701 KB; gzip 9 250 ms, gzip 6 64 ms for 0.7% more. The server is slower still.
  const [gz, br] = await Promise.all([
    gzipAsync(json, { level: 6 }),
    // the form every page asks for now
    form === 3 ? brotliAsync(json, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: json.length } }) : undefined,
  ]);
  return { json, gzip: gz, br };
}

const wholeOf = (s: Snapshot, form: FeedForm) => (s.whole[form] ??= makeWhole(s, form));

/** An empty snapshot at version n */
const emptySnapshot = (n: number, now: number): Snapshot => ({
  n,
  v: `${feed.epoch}.${n}`,
  builtAt: now,
  byId: new Map(),
  hashes: new Map(),
  solo: new Map(),
  shared: new Map(),
  buckets: new Map(),
  cells: new Map(),
  fire: 0,
  riders: 0,
  players: 0,
  drunk: new Map(),
  whole: {},
  diffs: new Map(),
  areas: new Map(),
});

const bucketKey = (lngDeg: number, latDeg: number) => (latDeg + 90) * 361 + (lngDeg + 180);
/**
 * The first four bytes of a public id, which the short form goes by; none for the show roaches' ids. Public
 * ids come from the database's uuid column, always in its one written form, so the shape is enough to tell
 * (this runs for every roach put in, so no pattern matching).
 */
const prefixOf = (id: string) => (id.length === 36 && id.charCodeAt(8) === 45 ? id.slice(0, 8) : null);

/** The id a roach goes by in the short form (world/packed.ts shortIds): its first four bytes when no other roach starts so */
function shortOf(s: Snapshot, id: string) {
  const prefix = prefixOf(id);
  return prefix && s.solo.get(prefix) === id ? prefix : id;
}
/** The roach a short-form id stands for now, if any */
function byShort(s: Snapshot, id: string): MapRoach | undefined {
  if (SHORT_ID.test(id)) {
    const whole = s.solo.get(id);
    return whole === undefined ? undefined : s.byId.get(whole);
  }
  const r = s.byId.get(id);
  return r && shortOf(s, id) === id ? r : undefined;
}

/** The lowest short id in a square of the overview, worked out again (the one there went, or its short id changed) */
function findMin(s: Snapshot, c: Cell) {
  c.min = null;
  c.minId = "";
  for (const r of c.all) {
    const id = shortOf(s, r.id);
    if (!c.min || id < c.minId) {
      c.min = r;
      c.minId = id;
    }
  }
}

/** A roach into the degree grid and its square of the overview, and the counts */
function place(s: Snapshot, r: MapRoach) {
  const k = bucketKey(Math.floor(r.lng), Math.floor(r.lat));
  const bucket = s.buckets.get(k);
  if (bucket) bucket.add(r);
  else s.buckets.set(k, new Set([r]));
  const cellKey = overviewCell(r);
  let c = s.cells.get(cellKey);
  if (!c) s.cells.set(cellKey, (c = { all: new Set(), min: null, minId: "" }));
  c.all.add(r);
  const id = shortOf(s, r.id);
  if (!c.min || id < c.minId) {
    c.min = r;
    c.minId = id;
  }
  if (!r.bot && isNearFire(r)) s.fire++;
  if (r.ride && !r.bot) s.riders++;
  if (!r.clone && !r.bot) s.players++;
}
function unplace(s: Snapshot, r: MapRoach) {
  const k = bucketKey(Math.floor(r.lng), Math.floor(r.lat));
  const bucket = s.buckets.get(k);
  bucket?.delete(r);
  if (bucket && !bucket.size) s.buckets.delete(k);
  const cellKey = overviewCell(r);
  const c = s.cells.get(cellKey);
  if (c) {
    c.all.delete(r);
    if (!c.all.size) s.cells.delete(cellKey);
    else if (c.min === r) findMin(s, c);
  }
  if (!r.bot && isNearFire(r)) s.fire--;
  if (r.ride && !r.bot) s.riders--;
  if (!r.clone && !r.bot) s.players--;
}

/**
 * The short ids of the roaches starting with these four bytes, as they are now, and whether they changed: a
 * lone one goes by the bytes, several sharing them each by its whole id. ids: those starting so now.
 */
function settlePrefix(s: Snapshot, prefix: string, ids: string[], touched: Set<string>) {
  const wasSolo = s.solo.get(prefix);
  const wasShared = s.shared.get(prefix);
  // what nearly every round meets: a new roach alone under its four bytes, or the one that had them gone
  if (wasShared === undefined && ids.length <= 1 && (wasSolo === undefined || ids.length === 0 || ids[0] === wasSolo)) {
    if (ids.length === 1 && wasSolo === undefined) {
      s.solo.set(prefix, ids[0]);
      touched.add(prefix);
      const r = s.byId.get(ids[0]);
      const c = r && s.cells.get(overviewCell(r));
      if (r && c) {
        if (c.min === r) findMin(s, c);
        else if (prefix < c.minId) {
          c.min = r;
          c.minId = prefix;
        }
      }
    } else if (!ids.length && wasSolo !== undefined) {
      s.solo.delete(prefix);
      touched.add(prefix);
    }
    return;
  }
  const before = new Map<string, string>();
  if (wasSolo !== undefined) before.set(wasSolo, prefix);
  for (const id of wasShared ?? []) before.set(id, id);
  s.solo.delete(prefix);
  s.shared.delete(prefix);
  if (ids.length === 1) s.solo.set(prefix, ids[0]);
  else if (ids.length > 1) s.shared.set(prefix, new Set(ids));
  for (const id of new Set([...before.keys(), ...ids])) {
    const was = before.get(id);
    const is = ids.includes(id) ? (ids.length === 1 ? prefix : id) : undefined;
    if (was === is) continue;
    if (was !== undefined) touched.add(was);
    if (is !== undefined) touched.add(is);
    // a roach still there whose short id changed may be its square's lowest now, or no longer
    const r = s.byId.get(id);
    const c = r && is !== undefined ? s.cells.get(overviewCell(r)) : undefined;
    if (r && c && is !== undefined) {
      if (c.min === r) findMin(s, c);
      else if (is < c.minId) {
        c.min = r;
        c.minId = is;
      }
    }
  }
}

/** Those starting with these four bytes now, in the snapshot */
const startingWith = (s: Snapshot, prefix: string) => {
  const solo = s.solo.get(prefix);
  return solo !== undefined ? [solo] : [...(s.shared.get(prefix) ?? [])];
};

/**
 * Put these roaches as they are now into the snapshot (null: gone): only what differs, with everything kept
 * by roach. What changed, in each view (the short view also where a short id came or went); null when nothing did.
 */
function apply(s: Snapshot, now: Map<string, Read | null>): { long: Touched; short: Touched } | null {
  const long: Touched = { changed: [], removed: [] };
  const touched = new Set<string>();
  // by first four bytes: roaches that came, and that went
  const came = new Map<string, string[]>();
  const went = new Map<string, Set<string>>();
  for (const [id, read] of now) {
    const r = read?.roach ?? null;
    const old = s.byId.get(id);
    // when it wakes, if it lies drunk: kept apart, it changes nothing on the map
    if (read && read.wakes !== null) s.drunk.set(id, read.wakes);
    else s.drunk.delete(id);
    if (!r && !old) continue;
    const h = r ? hashOf(r) : 0;
    if (r && old && s.hashes.get(id) === h) continue;
    // under the short id it went by (a new one's comes once the others starting like it are seen to)
    if (old) touched.add(shortOf(s, id));
    if (old) unplace(s, old);
    const prefix = prefixOf(id);
    if (r) {
      s.byId.set(id, r);
      s.hashes.set(id, h);
      place(s, r);
      long.changed.push(id);
      if (!old && prefix) came.set(prefix, [...(came.get(prefix) ?? []), id]);
      else if (!old) touched.add(id);
    } else {
      s.byId.delete(id);
      s.hashes.delete(id);
      long.removed.push(id);
      if (prefix) {
        const set = went.get(prefix);
        if (set) set.add(id);
        else went.set(prefix, new Set([id]));
      }
    }
  }
  // who starts with each four bytes that gained or lost a roach now, and what that makes their short ids
  for (const prefix of new Set([...came.keys(), ...went.keys()])) {
    const gone = went.get(prefix);
    const ids = [...new Set([...startingWith(s, prefix).filter((x) => !gone?.has(x)), ...(came.get(prefix) ?? [])])];
    settlePrefix(s, prefix, ids, touched);
  }
  if (!long.changed.length && !long.removed.length && !touched.size) return null;
  const short: Touched = { changed: [], removed: [] };
  for (const id of touched) (byShort(s, id) ? short.changed : short.removed).push(id);
  return { long, short };
}

/** A new version, after a round that changed something: what changed noted, and every answer of the last one let go */
function bump(s: Snapshot, touched: { long: Touched; short: Touched }, now: number, from = s.n, n = s.n + 1) {
  s.n = n;
  s.v = `${feed.epoch}.${n}`;
  s.builtAt = now;
  s.whole = {};
  s.diffs = new Map();
  s.overview = undefined;
  s.around = undefined;
  feed.changes.push({ n, from, at: now, long: touched.long, short: touched.short });
  feed.changes = feed.changes.filter((c) => now - c.at < KEEP_CHANGES_MS);
}

/** The newest change number written so far: what the first round reads from */
async function newestChange() {
  const [row] = await db.select({ n: max(roachChanges.n) }).from(roachChanges);
  return Number(row?.n ?? 0);
}

/** Let the requests waiting meanwhile have a turn, between pieces of a long job */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Roaches put in at a time while the first snapshot is made */
const BUILD_CHUNK = 20_000;

/**
 * The first snapshot of a process: every roach (and the show roaches, which never change), put in a piece
 * at a time. After a restart from a saved state, what changed meanwhile is worked out against it and kept
 * as one version's changes.
 */
async function build(now: number): Promise<Snapshot> {
  await triggersThere();
  // the first round reads a little further back: a change numbered before the newest may still have been on
  // its way (its transaction not yet committed) as the roaches were read; reading one again changes nothing
  feed.seen = Math.max(0, (await newestChange()) - REREAD_AT_START);
  feed.gaps.clear();
  feed.checkedAt = now;
  const t0 = performance.now();
  const rows = await db.select(roachColumns).from(roaches).innerJoin(users, eq(users.id, roaches.userId)).orderBy(asc(roaches.publicId));
  const t1 = performance.now();
  const real = Date.now();
  const s = emptySnapshot(1, now);
  // short ids first, all at once: which first four bytes are whose alone
  for (const r of rows) {
    const p = prefixOf(r.publicId);
    if (!p) continue;
    const first = s.solo.get(p);
    if (first === undefined && !s.shared.has(p)) s.solo.set(p, r.publicId);
    else if (first !== undefined) {
      s.solo.delete(p);
      s.shared.set(p, new Set([first, r.publicId]));
    } else s.shared.get(p)!.add(r.publicId);
  }
  for (let i = 0; i < rows.length; i++) {
    const { roach, wakes } = heldOf(rows[i], real);
    s.byId.set(roach.id, roach);
    s.hashes.set(roach.id, hashOf(roach));
    place(s, roach);
    if (wakes !== null) s.drunk.set(roach.id, wakes);
    if (i % BUILD_CHUNK === BUILD_CHUNK - 1) await breathe();
  }
  for (const b of botRoaches(SHOW_BOTS)) {
    const roach = { ...b, lng: nearMetre(b.lng), lat: nearMetre(b.lat) };
    s.byId.set(roach.id, roach);
    s.hashes.set(roach.id, hashOf(roach));
    place(s, roach);
  }
  if (process.env.FEED_TIMING) console.info(`roach feed build: read ${Math.round(t1 - t0)} ms, put in ${Math.round(performance.now() - t1)} ms`);
  const before = feed.before;
  // after a restart from a saved state: versions go on from the saved one, with what changed meanwhile
  if (before) bump(s, against(s, before), now, before.n, before.n + SKIP);
  return s;
}

/**
 * What differs between the snapshot and the saved state of the process before (its hashes and short ids),
 * in each view, as one version's changes
 */
function against(s: Snapshot, before: Before) {
  const long: Touched = { changed: [], removed: [] };
  for (const [id, h] of s.hashes) if (before.hashes.get(id) !== h) long.changed.push(id);
  for (const id of before.hashes.keys()) if (!s.hashes.has(id)) long.removed.push(id);
  const touched = new Set<string>();
  for (const id of long.changed) {
    touched.add(shortOf(s, id));
    const was = before.short.get(id);
    if (was !== undefined) touched.add(was);
  }
  for (const id of long.removed) touched.add(before.short.get(id)!);
  for (const [id, was] of before.short) {
    if (!s.byId.has(id)) continue;
    const is = shortOf(s, id);
    if (was !== is) touched.add(was).add(is);
  }
  const short: Touched = { changed: [], removed: [] };
  for (const id of touched) (byShort(s, id) ? short.changed : short.removed).push(id);
  return { long, short };
}

/**
 * One round: the changes written since the last (by any process; numbers skipped last time looked for again,
 * as their transactions may have committed since), and drunk roaches due to wake, read again and put in.
 */
async function poll(s: Snapshot, now: number): Promise<boolean> {
  const real = Date.now();
  for (const [n, at] of feed.gaps) if (real - at > GAP_MS) feed.gaps.delete(n);
  const gaps = [...feed.gaps.keys()];
  const rows = await db
    .select({ n: roachChanges.n, publicId: roachChanges.publicId })
    .from(roachChanges)
    .where(gaps.length ? or(gt(roachChanges.n, feed.seen), sql`${roachChanges.n} = any(${numbers(gaps)}::bigint[])`) : gt(roachChanges.n, feed.seen))
    .orderBy(asc(roachChanges.n));
  const ids = new Set<string>();
  let next = feed.seen + 1;
  for (const r of rows) {
    ids.add(r.publicId);
    feed.gaps.delete(r.n);
    if (r.n > feed.seen) {
      for (let k = next; k < r.n && feed.gaps.size < 100_000; k++) feed.gaps.set(k, real);
      next = r.n + 1;
      feed.seen = r.n;
    }
  }
  for (const [id, wakes] of s.drunk) if (wakes <= real) ids.add(id);
  if (!ids.size || feed.stopping) return false;
  const found = await readRoaches([...ids]);
  const put = await inPieces(s, [...ids].map((id) => [id, found.get(id) ?? null]), now);
  stats.lastRound = { roaches: ids.size, ...put };
  if (put.longest > 200) console.warn(`roach feed: putting in a round of ${ids.size} roaches took ${Math.round(put.longest)} ms at a stretch`);
  return put.changed;
}

/** A Postgres array of numbers, as one parameter however many (a query takes at most 65,535) */
const numbers = (ns: number[]) => `{${ns.join(",")}}`;

/**
 * Put these roaches as they are now into the snapshot, APPLY_CHUNK at a time, each piece a version of its own
 * (as if each had been a round), with other requests let in between: all a round does on the main thread,
 * which grows with the changes and not with the map. None once the process has been told to stop, whose last
 * version is written down. Whether any changed, and the time on the main thread, in all and at most at a stretch.
 */
async function inPieces(s: Snapshot, reads: [string, Read | null][], now: number) {
  let changed = false;
  let ms = 0;
  let longest = 0;
  for (let i = 0; i < reads.length; i += APPLY_CHUNK) {
    if (i) await breathe();
    if (feed.stopping) break;
    const started = performance.now();
    const touched = apply(s, new Map(reads.slice(i, i + APPLY_CHUNK)));
    if (touched) {
      bump(s, touched, now);
      changed = true;
    }
    const took = performance.now() - started;
    ms += took;
    longest = Math.max(longest, took);
  }
  return { changed, ms, longest };
}

/** How the last round went, for the measurements: how many roaches it read again, and its time on the main thread */
const stats: { lastRound: { roaches: number; changed: boolean; ms: number; longest: number } | null } = { lastRound: null };

/** Says so in the log if the database no longer notes roach changes: the map would then change only at the checks */
async function triggersThere() {
  try {
    const on = await db.execute<{ name: string }>(
      sql`select tgname as name from pg_trigger where tgrelid in ('roaches'::regclass, 'users'::regclass) and not tgisinternal and tgenabled in ('O', 'A')`,
    );
    const missing = TRIGGERS.filter((t) => !on.some((r) => r.name === t));
    if (missing.length) {
      console.error(`roach feed: the database is not noting roach changes (${missing.join(", ")} missing or off), so the map changes only at the half-hourly check`);
    }
  } catch (e) {
    console.error("roach feed: could not look for the triggers that note roach changes", e);
  }
}
export const roachFeedStats = () => ({ ...stats, held: feed.snapshot?.byId.size ?? 0 });

/**
 * Every CHECK_MS: the whole table read again a piece at a time (never a second copy of all the roaches at once),
 * each roach compared with the snapshot, and anything the rounds missed put right, in a version of its own,
 * with a line in the log (it should not happen).
 */
async function check(s: Snapshot, now: number) {
  feed.checkedAt = now;
  await triggersThere();
  // no round runs meanwhile: what is written from now on comes in the next one
  const seen = feed.seen;
  const gaps = [...feed.gaps.keys()];
  const fix = new Map<string, Read | null>();
  const there = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const rows: RoachRow[] = await db
      .select(roachColumns)
      .from(roaches)
      .innerJoin(users, eq(users.id, roaches.userId))
      .where(after ? gt(roaches.publicId, after) : undefined)
      .orderBy(asc(roaches.publicId))
      .limit(CHECK_CHUNK);
    const real = Date.now();
    for (const r of rows) {
      there.add(r.publicId);
      const read = heldOf(r, real);
      if (s.hashes.get(r.publicId) !== hashOf(read.roach)) fix.set(r.publicId, read);
    }
    if (rows.length < CHECK_CHUNK) break;
    after = rows[rows.length - 1].publicId;
    await breathe();
  }
  for (const [id, r] of s.byId) if (!r.bot && !there.has(id)) fix.set(id, null);
  if (!fix.size) return false;
  // a roach changed while the table was read through is in the log, for the next round: not missed
  const logged = await db
    .selectDistinct({ publicId: roachChanges.publicId })
    .from(roachChanges)
    .where(gaps.length ? or(gt(roachChanges.n, seen), sql`${roachChanges.n} = any(${numbers(gaps)}::bigint[])`) : gt(roachChanges.n, seen));
  const pending = new Set(logged.map((r) => r.publicId));
  const missed = [...fix.keys()].filter((id) => !pending.has(id)).length;
  if (missed) console.warn(`roach feed: the full check found ${missed} roaches the rounds had missed`);
  return (await inPieces(s, [...fix], now)).changed;
}

/**
 * The snapshot to answer with. A round that is due (every POLL_MS) starts in the background, one at a time;
 * meanwhile pages get the version there is, so nobody waits for it. Only the very first snapshot is waited for.
 */
async function current(now = Date.now()): Promise<Snapshot> {
  if (!feed.started) start();
  const s = feed.snapshot;
  if (!s) {
    if (!feed.building) {
      feed.polledAt = now;
      const building = build(now).then((snap) => {
        feed.snapshot = snap;
        feed.before = null;
        if (now - feed.savedAt >= SAVE_MS) save(now);
        return snap;
      });
      feed.building = building;
      building.catch((e) => console.error("Building the roach feed failed", e)).finally(() => (feed.building = null));
    }
    return feed.building!;
  }
  // a round that is due runs in the background, one at a time; meanwhile pages get the version there is
  if (!feed.building && !feed.stopping && now - feed.polledAt >= POLL_MS) {
    feed.polledAt = now;
    // every CHECK_MS the round also reads the whole table through, after the changes
    const checking = now - feed.checkedAt >= CHECK_MS;
    const round = poll(s, now)
      .then(async (changed) => (checking ? (await check(s, now)) || changed : changed))
      .then((changed) => {
        if (changed && now - feed.savedAt >= SAVE_MS) save(now);
        return s;
      });
    feed.building = round;
    round.catch((e) => console.error("Reading the roach feed's changes failed", e)).finally(() => (feed.building = null));
  }
  return s;
}

export type FeedAnswer =
  | { kind: "full"; v: string; json: string; gzip: Buffer; br?: Buffer }
  | { kind: "diff"; v: string; json: string };

/**
 * What a page holding version `since` needs: nothing new, the roaches changed
 * since (sorted by id, with no times or order of changes), or the whole
 * snapshot when it has no version or one too old or unknown here; in the form
 * it asked for (FeedForm).
 */
export async function roachFeed(since: string | null, now = Date.now(), form: FeedForm = 1): Promise<FeedAnswer> {
  const s = await current(now);
  const full = async (): Promise<FeedAnswer> => ({ kind: "full", v: s.v, ...(await wholeOf(s, form)) });
  if (since === null || !VERSION.test(since)) return full();
  const [epoch, nText] = since.split(".");
  const from = Number(nText);
  const known = epoch === feed.epoch && !(feed.unknown && from > feed.unknown.from && from < feed.unknown.to) && from <= s.n;
  if (!known) {
    // Just after a start, many pages at once may hold a version from before it: not all of them
    // get the whole snapshot at once. Each keeps what it has and asks again later.
    const age = now - feed.startedAt;
    const spread = form === 3 ? SPREAD_MS : OLD_SPREAD_MS;
    if (age < spread && Math.random() * spread > age) return { kind: "diff", v: since, json: `{"v":"${since}"}` };
    return full();
  }
  if (from === s.n) return { kind: "diff", v: s.v, json: `{"v":"${s.v}"}` };
  const missing = feed.changes.length === 0 || feed.changes[0].from > from;
  if (missing) return full();

  const view = viewOf(form);
  const key = `${view}:${from}`;
  let json = s.diffs.get(key);
  if (!json) {
    const touched = new Set<string>();
    for (const c of feed.changes) {
      if (c.n <= from || c.n > s.n) continue;
      for (const id of c[view].changed) touched.add(id);
      for (const id of c[view].removed) touched.add(id);
    }
    if (touched.size > Math.max(MIN_DIFF, s.byId.size * MAX_DIFF_SHARE)) return full();
    const ids = [...touched].sort();
    const now = (id: string) => (view === "long" ? s.byId.get(id) : byShort(s, id));
    const changed = ids.flatMap((id) => {
      const r = now(id);
      return r ? [JSON.stringify(view === "long" ? r : { ...r, id })] : [];
    });
    const removed = ids.filter((id) => !now(id));
    json = `{"v":"${s.v}","changed":[${changed.join(",")}],"removed":${JSON.stringify(removed)}}`;
    if (s.diffs.size >= DIFF_CACHE) s.diffs.clear();
    s.diffs.set(key, json);
  }
  return { kind: "diff", v: s.v, json };
}

/** How many roaches in all, by the fire, riding with 明河都尉, and how many players they belong to, kept up to date with every change */
const countsOf = (s: Snapshot): FeedCounts => ({ total: s.byId.size, fire: s.fire, riders: s.riders, players: s.players });

/** The counts a visitor who has not signed in gets in place of the roaches, at the snapshot's version */
export async function roachCounts(now = Date.now()): Promise<{ v: string } & FeedCounts> {
  const s = await current(now);
  return { v: s.v, ...countsOf(s) };
}

// ---- f=4, 只发看得到的 (world/area.ts) ----

/**
 * Whole answers for areas are kept across versions for a while: the overview up to OVERVIEW_KEPT_MS (a page
 * asks for it again only that often anyway), a box up to BOX_KEPT_MS, each at the version it was made at,
 * which it says, and which its ETag says. The version moves on with every round that changed anything
 * anywhere, every few seconds: made anew for each, a page coming back to an area it had downloaded it all
 * again instead of getting a 304, and on a slow link the overview, hundreds of KB, then took minutes or
 * never came. A page holding a box made a while ago asks what changed since its version, as for any box.
 * The overview is always sent whole, so every page showing it downloads it again each time it is made
 * anew: half an hour, not five minutes (2026-11-12, when the servers' outgoing bandwidth was full), the
 * roaches seen from that far up being at most that late. Past AREAS_KEPT, the least lately made go first;
 * each is up to a few hundred KB.
 */
const OVERVIEW_KEPT_MS = 30 * 60_000;
const BOX_KEPT_MS = 60_000;
const AREAS_KEPT = 256;

export type AreaAnswer =
  | { kind: "full"; v: string; key: string; whole: AreaWhole }
  | { kind: "diff"; v: string; json: string };

/**
 * total, by the fire, riding with 明河都尉, players: every f=4 answer says them, as pages no longer hold every roach
 * to count. players came last, so pages from before it still read the first three as they did.
 */
const totalsJson = (s: Snapshot) => {
  const c = countsOf(s);
  return `[${c.total},${c.fire},${c.riders},${c.players}]`;
};

/** The roaches in a box, edges included, by their short ids */
function roachesIn(s: Snapshot, b: Box): MapRoach[] {
  const out: MapRoach[] = [];
  for (let lat = Math.floor(b[1]); lat <= Math.floor(b[3]); lat++) {
    for (let lng = Math.floor(b[0]); lng <= Math.floor(b[2]); lng++) {
      for (const r of s.buckets.get(bucketKey(lng, lat)) ?? []) {
        if (inBox(r, b)) out.push({ ...r, id: shortOf(s, r.id) });
      }
    }
  }
  return out;
}

/**
 * The overview: for each square of the world (overviewCell) with roaches in it, the one with the lowest
 * short id, so the same one while it stays there, carrying how many there are (n)
 */
function overviewList(s: Snapshot): MapRoach[] {
  if (s.overview) return s.overview;
  const out: MapRoach[] = [];
  for (const c of s.cells.values()) if (c.min) out.push({ ...c.min, id: c.minId, ...(c.all.size > 1 ? { n: c.all.size } : {}) });
  return (s.overview = out);
}

/** The whole answer for an area, made once for every page that asks and kept a while (OVERVIEW_KEPT_MS, BOX_KEPT_MS), at its own version */
function areaWhole(s: Snapshot, area: Area, now: number): { v: string; key: string; whole: AreaWhole } {
  const key = area === "overview" ? "o" : boxText(area);
  const kept = s.areas.get(key);
  if (kept && now >= kept.at && now - kept.at < (area === "overview" ? OVERVIEW_KEPT_MS : BOX_KEPT_MS)) return { v: kept.v, key, whole: kept.whole };
  const list = area === "overview" ? overviewList(s) : roachesIn(s, area);
  const where = area === "overview" ? `"overview":true` : `"box":[${key}]`;
  const whole = { json: `{"v":"${s.v}",${where},"t":${totalsJson(s)},"packed":${JSON.stringify(packRoaches(list, 4))}}` };
  s.areas.delete(key);
  s.areas.set(key, { v: s.v, at: now, whole });
  if (s.areas.size > AREAS_KEPT) s.areas.delete(s.areas.keys().next().value!);
  return { v: s.v, key, whole };
}

/** An area's answer compressed the way asked, once per snapshot (brotli 5 and gzip 6, as for the whole list) */
export function compressedArea(whole: AreaWhole, how: "br" | "gzip"): Promise<Buffer> {
  if (how === "br") {
    return (whole.br ??= brotliAsync(whole.json, {
      params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: whole.json.length },
    }));
  }
  return (whole.gzip ??= gzipAsync(whole.json, { level: 6 }));
}

/**
 * f=4: what a signed-in page needs for the area it shows (world/area.ts). The overview always whole; a
 * box whole, or, to a page holding that box at version `since`, the roaches changed in it since (with
 * the ids of any changed or gone elsewhere, which it drops if it holds them). As for roachFeed, a
 * version unknown here gets the whole box, spread out just after a start.
 */
export async function roachArea(area: Area, since: string | null, now = Date.now()): Promise<AreaAnswer> {
  const s = await current(now);
  const full = (): AreaAnswer => ({ kind: "full", ...areaWhole(s, area, now) });
  if (area === "overview" || since === null || !VERSION.test(since)) return full();
  const [epoch, nText] = since.split(".");
  const from = Number(nText);
  const known = epoch === feed.epoch && !(feed.unknown && from > feed.unknown.from && from < feed.unknown.to) && from <= s.n;
  if (!known) {
    const age = now - feed.startedAt;
    if (age < SPREAD_MS && Math.random() * SPREAD_MS > age) return { kind: "diff", v: since, json: `{"v":"${since}"}` };
    return full();
  }
  if (from === s.n) return { kind: "diff", v: s.v, json: `{"v":"${s.v}","t":${totalsJson(s)}}` };
  if (feed.changes.length === 0 || feed.changes[0].from > from) return full();
  const key = `area:${boxText(area)}:${from}`;
  let json = s.diffs.get(key);
  if (!json) {
    const touched = new Set<string>();
    for (const c of feed.changes) {
      if (c.n <= from || c.n > s.n) continue;
      for (const id of c.short.changed) touched.add(id);
      for (const id of c.short.removed) touched.add(id);
    }
    if (touched.size > Math.max(MIN_DIFF, s.byId.size * MAX_DIFF_SHARE)) return full();
    const changed: string[] = [];
    const removed: string[] = [];
    for (const id of [...touched].sort()) {
      const r = byShort(s, id);
      if (r && inBox(r, area)) changed.push(JSON.stringify({ ...r, id }));
      else removed.push(id);
    }
    json = `{"v":"${s.v}","t":${totalsJson(s)},"changed":[${changed.join(",")}],"removed":${JSON.stringify(removed)}}`;
    if (s.diffs.size >= DIFF_CACHE) s.diffs.clear();
    s.diffs.set(key, json);
  }
  return { kind: "diff", v: s.v, json };
}

const AROUND_KEPT = 5000;

/** Roaches near a spot, roughly (nearby.ts), for a visitor who has not signed in; the same spot is counted once per snapshot */
export async function roachesNear(spot: LngLat, now = Date.now()): Promise<{ near: number; far: number }> {
  const s = await current(now);
  const at = snapSpot(spot);
  const key = `${at.lng},${at.lat}`;
  const asked = (s.around ??= new Map());
  let counts = asked.get(key);
  if (!counts) {
    counts = countNear((x, y) => s.buckets.get(bucketKey(x, y)), at);
    if (asked.size >= AROUND_KEPT) asked.clear();
    asked.set(key, counts);
  }
  return counts;
}

/** What FEED_STATE holds; format says which code wrote it */
export type Saved = { format: 1; epoch: string; n: number; at: number; ids: string[]; hashes: number[]; changes: Change[] };

function stateNow(s: Snapshot, now: number): string {
  const saved: Saved = {
    format: 1,
    epoch: feed.epoch,
    n: s.n,
    at: now,
    ids: [...s.hashes.keys()],
    hashes: [...s.hashes.values()],
    changes: feed.changes,
  };
  return JSON.stringify(saved);
}

/** Write down where the feed is, in the background (a temporary file, then renamed, so a reader never sees half of one) */
function save(now: number) {
  const file = process.env.FEED_STATE;
  const s = feed.snapshot;
  if (!file || !s || feed.saving) return;
  feed.savedAt = now;
  feed.saving = writeState(file, s, now)
    .catch((e) => console.error("Saving the roach feed's state failed", e))
    .finally(() => (feed.saving = null));
}

/**
 * What stateNow says, written a piece at a time, each piece's write leaving the process free for everything else
 * until it is done: made as one string it held the process for a second or more each time (2026-11-12, the live
 * site's main process, with every roach's id and hash). As at one moment: the ids, hashes, version and changes
 * are taken first, so the rounds that go on meanwhile change nothing in it. Not put in place if the process was
 * told to stop meanwhile, which writes down the latest itself (stop, into a file of its own).
 */
async function writeState(file: string, s: Snapshot, now: number) {
  const saved: Saved = { format: 1, epoch: feed.epoch, n: s.n, at: now, ids: [...s.hashes.keys()], hashes: [...s.hashes.values()], changes: feed.changes.slice() };
  const writing = `${file}.saving`;
  const out = await open(writing, "w");
  try {
    for (const piece of statePieces(saved)) await out.write(piece);
  } finally {
    await out.close();
  }
  if (!feed.stopping) await rename(writing, file);
}

/** JSON.stringify(saved), in pieces of about `piece` ids or hashes at a time (changes: as many ids as that between them) */
export function* statePieces(saved: Saved, piece = SAVE_PIECE) {
  const list = function* <T>(items: T[], size: number) {
    for (let i = 0; i < items.length; i += size) yield (i ? "," : "") + items.slice(i, i + size).map((x) => JSON.stringify(x)).join(",");
  };
  yield `{"format":${saved.format},"epoch":${JSON.stringify(saved.epoch)},"n":${saved.n},"at":${saved.at},"ids":[`;
  yield* list(saved.ids, piece);
  yield '],"hashes":[';
  yield* list(saved.hashes, piece);
  yield '],"changes":[';
  // a change may name up to APPLY_CHUNK roaches twice over: grouped by how many ids they name, not how many they are
  const ids = (c: Change) => c.long.changed.length + c.long.removed.length + c.short.changed.length + c.short.removed.length;
  let group: string[] = [];
  let named = 0;
  let first = true;
  for (const c of saved.changes) {
    group.push(JSON.stringify(c));
    named += ids(c) + 1;
    if (named >= piece) {
      yield (first ? "" : ",") + group.join(",");
      first = false;
      group = [];
      named = 0;
    }
  }
  if (group.length) yield (first ? "" : ",") + group.join(",");
  yield "]}";
}

/** The process has been told to stop: no more versions, and the last one written down before it goes */
function stop() {
  const file = process.env.FEED_STATE;
  feed.stopping = true;
  const s = feed.snapshot;
  if (!file || !s) return;
  try {
    writeFileSync(`${file}.tmp`, stateNow(s, Date.now()));
    renameSync(`${file}.tmp`, file);
  } catch (e) {
    console.error("Saving the roach feed's state failed", e);
  }
}

/** Once per process: take up where the process before left off, if it wrote that down */
function start() {
  feed.started = true;
  const file = process.env.FEED_STATE;
  if (!file) return;
  const gs = globalThis as typeof globalThis & { __roachFeedStop?: true };
  if (!gs.__roachFeedStop) {
    gs.__roachFeedStop = true;
    process.once("SIGTERM", stop);
  }
  let saved: Saved;
  try {
    saved = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
  if (
    saved?.format !== 1 ||
    !/^[0-9a-f]{8}$/.test(saved.epoch) ||
    !Number.isInteger(saved.n) ||
    !Array.isArray(saved.ids) ||
    !Array.isArray(saved.hashes) ||
    saved.ids.length !== saved.hashes.length ||
    !Array.isArray(saved.changes) ||
    !saved.changes.every((c) => Number.isInteger(c?.n) && Number.isInteger(c?.from) && c.long && c.short)
  ) {
    return;
  }
  feed.epoch = saved.epoch;
  feed.changes = saved.changes.filter((c) => Date.now() - c.at < KEEP_CHANGES_MS);
  feed.before = { n: saved.n, hashes: new Map(saved.ids.map((id, i) => [id, saved.hashes[i]])), short: shortIds(saved.ids) };
  feed.unknown = { from: saved.n, to: saved.n + SKIP };
}

/** The changes older than the oldest a page may still be behind by (KEEP_CHANGES_MS): every process has read them long since */
export async function pruneRoachChanges(now = Date.now()) {
  await db.delete(roachChanges).where(lt(roachChanges.at, new Date(now - KEEP_CHANGES_MS)));
}

/** Tests only: wait for a round or the first snapshot in progress. */
export async function roachFeedSettled() {
  await feed.building?.catch(() => {});
  await feed.saving;
}

/**
 * Tests only: forget everything, as after a restart; with no spreading of
 * unknown versions unless startedAt says when the process started.
 */
export function resetRoachFeed(startedAt = -Infinity) {
  Object.assign(feed, fresh(), { startedAt });
}

/** Tests only: no area's whole answer kept, so the next is made from the roaches as they are now */
export function forgetKeptAreas() {
  feed.snapshot?.areas.clear();
}

/** Tests only: what the process does when told to stop */
export const stopRoachFeed = stop;
