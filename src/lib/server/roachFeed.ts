import "server-only";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { asc, eq } from "drizzle-orm";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import type { MapRoach } from "../world/types";
import { db } from "./db";
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
 */

const REBUILD_MS = 10_000;
const MAX_AGE_MS = 5 * 60_000;
/** Changes are kept this long; a page further behind gets the whole snapshot again. */
const KEEP_CHANGES_MS = 15 * 60_000;

/** How a roach looks to others: its owner's look, except that clones all look alike, so a clone cannot point at its main roach. */
export function lookOf(slot: number, avatar: string, color: string) {
  return slot > 0
    ? { avatar: "hood" as const, color: "white" as const }
    : { avatar: ROACH_AVATARS.find((a) => a === avatar) ?? "hood", color: ROACH_COLORS.find((c) => c === color) ?? "cyan" };
}

type Snapshot = {
  n: number;
  v: string;
  /** Each roach as JSON, by public id */
  roaches: Map<string, string>;
  json: string;
  gzip: Buffer;
  builtAt: number;
  /** Answers already worked out for pages at an older version, by that version */
  diffs: Map<number, string>;
};

type Change = { n: number; at: number; changed: string[]; removed: string[] };

type Feed = {
  /** Differs on every server start, so a version from before a restart is never mistaken for a current one */
  epoch: string;
  snapshot: Snapshot | null;
  changes: Change[];
  dirty: boolean;
  building: Promise<Snapshot> | null;
};

// Kept on globalThis so development reloads of this module share one feed
const g = globalThis as typeof globalThis & { __roachFeed?: Feed };
const feed: Feed = (g.__roachFeed ??= {
  epoch: randomBytes(4).toString("hex"),
  snapshot: null,
  changes: [],
  dirty: true,
  building: null,
});

/** Call after roaches are placed, moved or removed, or someone's look changes. */
export function roachesChanged() {
  feed.dirty = true;
}

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
    })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    // ordering by the random public id keeps a player's roaches from sitting next to each other
    .orderBy(asc(roaches.publicId));
  return rows.map((r) => ({ id: r.publicId, clone: r.slot > 0, ...lookOf(r.slot, r.avatar, r.color), lng: r.lng, lat: r.lat }));
}

const gzipAsync = promisify(gzip);

async function rebuild(now: number): Promise<Snapshot> {
  const list = await allRoaches();
  const next = new Map(list.map((r) => [r.id, JSON.stringify(r)]));
  const prev = feed.snapshot;
  if (prev) {
    const changed = [...next].filter(([id, json]) => prev.roaches.get(id) !== json).map(([id]) => id);
    const removed = [...prev.roaches.keys()].filter((id) => !next.has(id));
    if (!changed.length && !removed.length) {
      prev.builtAt = now;
      return prev;
    }
    feed.changes.push({ n: prev.n + 1, at: now, changed, removed });
    feed.changes = feed.changes.filter((c) => now - c.at < KEEP_CHANGES_MS);
  }
  const n = (prev?.n ?? 0) + 1;
  const v = `${feed.epoch}.${n}`;
  const json = `{"v":"${v}","roaches":[${[...next.values()].join(",")}]}`;
  return { n, v, roaches: next, json, gzip: await gzipAsync(json), builtAt: now, diffs: new Map() };
}

/**
 * The snapshot to answer with. A rebuild that is due starts in the background
 * (one at a time); meanwhile pages get the snapshot they would have had a
 * moment ago, so nobody waits for it. Only the very first one is waited for.
 */
async function current(now = Date.now()): Promise<Snapshot> {
  const s = feed.snapshot;
  const due = !s || (feed.dirty && now - s.builtAt >= REBUILD_MS) || now - s.builtAt >= MAX_AGE_MS;
  if (due && !feed.building) {
    feed.dirty = false;
    const building = rebuild(now).then((snap) => (feed.snapshot = snap));
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
  | { kind: "full"; v: string; json: string; gzip: Buffer }
  | { kind: "diff"; v: string; json: string };

/**
 * What a page holding version `since` needs: nothing new, the roaches changed
 * since (sorted by id, with no times or order of changes), or the whole
 * snapshot when it has no version or one too old or from before a restart.
 */
export async function roachFeed(since: string | null, now = Date.now()): Promise<FeedAnswer> {
  const s = await current(now);
  const full = { kind: "full" as const, v: s.v, json: s.json, gzip: s.gzip };
  const [epoch, nText] = (since ?? "").split(".");
  const from = Number(nText);
  if (epoch !== feed.epoch || !Number.isInteger(from) || from > s.n) return full;
  if (from === s.n) return { kind: "diff", v: s.v, json: `{"v":"${s.v}"}` };
  const missing = feed.changes.length === 0 || feed.changes[0].n > from + 1;
  if (missing) return full;

  let json = s.diffs.get(from);
  if (!json) {
    const touched = new Set<string>();
    for (const c of feed.changes) {
      if (c.n <= from || c.n > s.n) continue;
      for (const id of c.changed) touched.add(id);
      for (const id of c.removed) touched.add(id);
    }
    const ids = [...touched].sort();
    const changed = ids.flatMap((id) => s.roaches.get(id) ?? []);
    const removed = ids.filter((id) => !s.roaches.has(id));
    json = `{"v":"${s.v}","changed":[${changed.join(",")}],"removed":${JSON.stringify(removed)}}`;
    s.diffs.set(from, json);
  }
  return { kind: "diff", v: s.v, json };
}

/** Tests only: wait for a rebuild in progress. */
export async function roachFeedSettled() {
  await feed.building?.catch(() => {});
}

/** Tests only: forget everything, as after a restart. */
export function resetRoachFeed() {
  feed.epoch = randomBytes(4).toString("hex");
  feed.snapshot = null;
  feed.changes = [];
  feed.dirty = true;
  feed.building = null;
}
