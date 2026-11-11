import "server-only";
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants as zlib, gzip } from "node:zlib";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { fireCount } from "../talulah";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
import { botRoaches } from "../world/bots";
import { nearMetre, packRoaches, SHORT_ID, shortIds } from "../world/packed";
import type { MapRoach } from "../world/types";
import { db } from "./db";
import { SHOW_BOTS } from "./env";
import { countNear, gridOf, snapSpot, type Grid } from "./nearby";
import { roaches, users } from "./schema";

/**
 * Everyone's roaches as one snapshot shared by every viewer. It holds no
 * owners and nothing viewer-specific (each browser leaves out its own roaches
 * and marks its friends'), so it is built once and handed to everyone. A page
 * that already holds a version only downloads what changed since.
 *
 * The snapshot is rebuilt after roaches are placed, moved or removed, or a
 * look changes, at most every REBUILD_MS; and every MAX_AGE_MS anyway, in case
 * a change slipped past roachesChanged().
 *
 * Places are given to about a metre. A page asks for the whole snapshot in one
 * of three forms (?f=): the list (pages from before the packed form), packed
 * with whole public ids (2), or packed with short ids (3: the first four bytes
 * of each public id, world/packed.ts), which is what pages ask for now; what
 * changed since a version comes with the same ids as the form asked. Only the
 * short form is made at every rebuild, the other two when a page asks.
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

const REBUILD_MS = 10_000;
const MAX_AGE_MS = 5 * 60_000;
/** Changes are kept this long; a page further behind gets the whole snapshot again. */
const KEEP_CHANGES_MS = 3 * 60 * 60_000;
/** So does a page whose changes would be more than this share of all the roaches (and more than MIN_DIFF), which the snapshot holds in less room. */
const MAX_DIFF_SHARE = 0.2;
const MIN_DIFF = 500;
/** How many worked-out answers for older versions a snapshot keeps */
const DIFF_CACHE = 64;
const SAVE_MS = 60_000;
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

/** What a visitor who has not signed in gets instead of the roaches (src/app/api/roaches): how many there are, by 塔露拉干员's fire, and riding with 明河都尉 */
export type FeedCounts = { total: number; fire: number; riders: number };

type Snapshot = {
  n: number;
  v: string;
  builtAt: number;
  /** For visitors (FeedCounts), worked out when one first asks */
  counts?: FeedCounts;
  /** The roaches by degree (nearby.ts), made when a visitor first asks what is near a spot */
  grid?: Grid;
  /** Answers about spots already asked about, by the snapped spot */
  around?: Map<string, { near: number; far: number }>;
  /** Every roach as the feed gives it, places to the metre, with its public id */
  list: MapRoach[];
  /** A hash of each roach's look and place (hashOf), by public id: what the next rebuild compares */
  hashes: Map<string, number>;
  /** Each roach's short id (world/packed.ts shortIds), by public id */
  short: Map<string, string>;
  /** Each roach as JSON, by the id it goes by in each view */
  json: Record<View, Map<string, string>>;
  /** The whole snapshot in each form, made when first wanted */
  whole: Partial<Record<FeedForm, Promise<Whole>>>;
  /** Answers already worked out for pages at an older version, by view and that version */
  diffs: Map<string, string>;
};

/** The ids, in one view, of the roaches that changed or went in one rebuild */
type Touched = { changed: string[]; removed: string[] };
/** One rebuild's changes: from version `from` to `n` (one more, except across a restart) */
type Change = { n: number; from: number; at: number; long: Touched; short: Touched };

/** Where the process before this one left off (FEED_STATE): what the first rebuild compares with */
type Before = { n: number; hashes: Map<string, number>; short: Map<string, string> };

type Feed = {
  /** Differs on every start without a saved state, so a version from before is never mistaken for a current one */
  epoch: string;
  snapshot: Snapshot | null;
  before: Before | null;
  /** Versions in (from, to) mean nothing here: made after the last save by the process before */
  unknown: { from: number; to: number } | null;
  changes: Change[];
  dirty: boolean;
  building: Promise<Snapshot> | null;
  startedAt: number;
  /** The saved state has been looked for (once per process) */
  started: boolean;
  /** No more rebuilds: the process has been told to stop, and its last state is saved */
  stopping: boolean;
  savedAt: number;
  saving: Promise<void> | null;
};

const fresh = (): Feed => ({
  epoch: randomBytes(4).toString("hex"),
  snapshot: null,
  before: null,
  unknown: null,
  changes: [],
  dirty: true,
  building: null,
  startedAt: Date.now(),
  started: false,
  stopping: false,
  savedAt: 0,
  saving: null,
});

// Kept on globalThis so development reloads of this module share one feed
const g = globalThis as typeof globalThis & { __roachFeed?: Feed };
const feed: Feed = (g.__roachFeed ??= fresh());

/** Call after roaches are placed, moved or removed, or someone's look changes. */
export function roachesChanged() {
  feed.dirty = true;
}

/** Whether a player's main roach lies asleep: drunk, or flipped over for their staying away. Nothing says which. */
export const sleeping = (u: { drunkUntil: Date | null; sleptAwayOn: string | null }, now = Date.now()) =>
  Boolean((u.drunkUntil && u.drunkUntil.getTime() > now) || u.sleptAwayOn);

/** Every roach on the map, the same for every viewer. */
export async function allRoaches(): Promise<MapRoach[]> {
  const rows = await db
    .select({
      slot: roaches.slot,
      publicId: roaches.publicId,
      lng: roaches.lng,
      lat: roaches.lat,
      avatar: users.avatar,
      color: users.color,
      drunkUntil: users.drunkUntil,
      sleptAwayOn: users.sleptAwayOn,
      rideSince: roaches.rideSince,
    })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    // ordering by the random public id keeps a player's roaches from sitting next to each other
    .orderBy(asc(roaches.publicId));
  const now = Date.now();
  return rows.map((r) => ({
    id: r.publicId,
    clone: r.slot > 0,
    ...lookOf(r.slot, r.avatar, r.color),
    lng: r.lng,
    lat: r.lat,
    // only the main roach lies down, drunk or away a long time, and the feed never says which or until
    // when; a drunk one stands up again in the first rebuild after it wakes, within MAX_AGE_MS
    ...(r.slot === 0 && sleeping(r, now) ? { asleep: true as const } : {}),
    // riding with 明河都尉, which only clones do; never since when
    ...(r.rideSince ? { ride: true as const } : {}),
  }));
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
  const json =
    form === 1
      ? `{"v":"${s.v}","roaches":[${[...s.json.long.values()].join(",")}]}`
      : form === 2
        ? `{"v":"${s.v}","packed":${JSON.stringify(packRoaches(s.list))}}`
        : `{"v":"${s.v}","packed":${JSON.stringify(packRoaches(s.list.map((r) => ({ ...r, id: s.short.get(r.id)! })), 4))}}`;
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

async function rebuild(now: number): Promise<Snapshot> {
  const list = [...(await allRoaches()), ...botRoaches(SHOW_BOTS)].map((r) => ({ ...r, lng: nearMetre(r.lng), lat: nearMetre(r.lat) }));
  const hashes = new Map(list.map((r) => [r.id, hashOf(r)]));
  const short = shortIds(hashes.keys());
  const prev = feed.snapshot ?? feed.before;
  let n = 1;
  if (prev) {
    const long: Touched = { changed: [], removed: [] };
    for (const [id, h] of hashes) if (prev.hashes.get(id) !== h) long.changed.push(id);
    for (const id of prev.hashes.keys()) if (!hashes.has(id)) long.removed.push(id);
    // In the short view a roach also changes when its short id does (its first four bytes have
    // come to be shared with another roach's, or no longer are): gone under the old, there under the new
    const touched = new Set<string>();
    for (const id of long.changed) {
      touched.add(short.get(id)!);
      const was = prev.short.get(id);
      if (was !== undefined) touched.add(was);
    }
    for (const id of long.removed) touched.add(prev.short.get(id)!);
    for (const [id, is] of short) {
      const was = prev.short.get(id);
      if (was !== undefined && was !== is) touched.add(was).add(is);
    }
    const shown = new Set(short.values());
    const shortTouched: Touched = { changed: [], removed: [] };
    for (const id of touched) (shown.has(id) ? shortTouched.changed : shortTouched.removed).push(id);
    if (feed.snapshot && !long.changed.length && !long.removed.length && !touched.size) {
      feed.snapshot.builtAt = now;
      return feed.snapshot;
    }
    n = feed.snapshot ? feed.snapshot.n + 1 : prev.n + SKIP;
    feed.changes.push({ n, from: prev.n, at: now, long, short: shortTouched });
    feed.changes = feed.changes.filter((c) => now - c.at < KEEP_CHANGES_MS);
  }
  const v = `${feed.epoch}.${n}`;
  const s: Snapshot = {
    n,
    v,
    builtAt: now,
    list,
    hashes,
    short,
    json: {
      long: new Map(list.map((r) => [r.id, JSON.stringify(r)])),
      short: new Map(list.map((r) => [short.get(r.id)!, JSON.stringify({ ...r, id: short.get(r.id)! })])),
    },
    whole: {},
    diffs: new Map(),
  };
  // the form pages ask for is ready before anyone gets this snapshot
  await wholeOf(s, 3);
  return s;
}

/**
 * The snapshot to answer with. A rebuild that is due starts in the background
 * (one at a time); meanwhile pages get the snapshot they would have had a
 * moment ago, so nobody waits for it. Only the very first one is waited for.
 */
async function current(now = Date.now()): Promise<Snapshot> {
  if (!feed.started) start();
  const s = feed.snapshot;
  const due = !s || (feed.dirty && now - s.builtAt >= REBUILD_MS) || now - s.builtAt >= MAX_AGE_MS;
  if (due && !feed.building && !(s && feed.stopping)) {
    feed.dirty = false;
    const building = rebuild(now).then((snap) => {
      if (snap !== feed.snapshot) {
        feed.snapshot = snap;
        feed.before = null;
        if (now - feed.savedAt >= SAVE_MS) save(now);
      }
      return snap;
    });
    feed.building = building;
    building
      .catch((e) => {
        feed.dirty = true;
        console.error("Rebuilding the roach feed failed", e);
      })
      .finally(() => (feed.building = null));
  }
  return s ?? feed.building!;
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
    if (touched.size > Math.max(MIN_DIFF, s.list.length * MAX_DIFF_SHARE)) return full();
    const ids = [...touched].sort();
    const map = s.json[view];
    const changed = ids.flatMap((id) => map.get(id) ?? []);
    const removed = ids.filter((id) => !map.has(id));
    json = `{"v":"${s.v}","changed":[${changed.join(",")}],"removed":${JSON.stringify(removed)}}`;
    if (s.diffs.size >= DIFF_CACHE) s.diffs.clear();
    s.diffs.set(key, json);
  }
  return { kind: "diff", v: s.v, json };
}

/** The counts a visitor who has not signed in gets in place of the roaches, at the snapshot's version */
export async function roachCounts(now = Date.now()): Promise<{ v: string } & FeedCounts> {
  const s = await current(now);
  s.counts ??= { total: s.list.length, fire: fireCount(s.list), riders: s.list.reduce((k, r) => k + (r.ride ? 1 : 0), 0) };
  return { v: s.v, ...s.counts };
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
    counts = countNear((s.grid ??= gridOf(s.list)), at);
    if (asked.size >= AROUND_KEPT) asked.clear();
    asked.set(key, counts);
  }
  return counts;
}

/** What FEED_STATE holds; format says which code wrote it */
type Saved = { format: 1; epoch: string; n: number; at: number; ids: string[]; hashes: number[]; changes: Change[] };

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
  feed.saving = writeFile(`${file}.tmp`, stateNow(s, now))
    .then(() => rename(`${file}.tmp`, file))
    .catch((e) => console.error("Saving the roach feed's state failed", e))
    .finally(() => (feed.saving = null));
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

/** Tests only: wait for a rebuild in progress. */
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

/** Tests only: what the process does when told to stop */
export const stopRoachFeed = stop;
