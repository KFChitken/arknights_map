import "server-only";
import { and, count, countDistinct, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { after } from "next/server";
import {
  OWNER_ALIAS,
  ZONE_LABEL_MAX,
  ZONE_MAX_M,
  ZONE_MIN_M,
  ZONE_RADIUS_WRONG,
  ZONE_SURE_OVER,
  ZONES_MAX,
  type ZoneDrawn,
  type ZoneItem,
  type ZoneList,
  type ZonePreview,
  type ZoneSpot,
} from "../adminConsole";
import { AMIYA_AT } from "../amiya";
import { distanceKm } from "../geo";
import { ROUTE } from "../minghe";
import { type DrawnPlace, OFF_LIMITS, setExtraOffLimits } from "../offLimits";
import { KEEP_ADMIN_LOG_DAYS } from "../rules";
import { FIRE_AT } from "../talulah";
import type { LngLat } from "../types";
import { type Actor, logAdmin } from "./admins";
import { db } from "./db";
import { HttpError } from "./http";
import { onReload, reloadEverywhere } from "./live";
import { moveOutOfOffLimits } from "./offLimits";
import { admins, offLimitsAreas, roaches } from "./schema";
import { errorCode } from "./signals";

/**
 * 禁放区 the owner draws on the map (off_limits_areas): refused, walked round and moved out of like the places in the
 * code (src/lib/offLimits.ts setExtraOffLimits), from the moment they are drawn. Every process holds the list in memory,
 * read before the first page asks (src/instrumentation-node.ts); drawing or lifting one tells every process at once
 * (reloadEverywhere), and each reads it again every RELOAD_MS anyway. The list never leaves the server: no page and no
 * answer holds where a place is, but the owner's look at one on the map (zone), which goes into the 操作记录.
 *
 * Drawing one moves the roaches already inside out of it, after the answer if it takes long (DRAW_WAIT_MS); one left
 * half done (the process stopped) is finished by the main process (finishZones). Lifting one moves nothing back.
 */

type Held = { loading: Promise<void> | null; again: boolean; started: boolean; moving: Set<Promise<unknown>> };
// on globalThis: Next.js can load this module once per route bundle
const g = globalThis as unknown as { zonesHeld?: Held };
const held = (g.zonesHeld ??= { loading: null, again: false, started: false, moving: new Set() });
const RELOAD_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** How long drawing one waits for the roaches inside to move out before it answers that they are still moving */
const DRAW_WAIT_MS = 5000;
/** The main finishes a place whose moving out was left undone once it is this old (src/instrumentation-node.ts) */
export const UNFINISHED_AFTER_MS = 10 * 60_000;
/** How near one of the site's own (阿米娅, the fire, 明河都尉's stations) a circle's edge comes before the owner is told */
const NEAR_M = 300;

/** A drawn place as src/lib/offLimits.ts knows it */
const placeOf = (row: { id: string; lng: number; lat: number; radiusM: number }): DrawnPlace => ({
  id: `zone:${row.id}`,
  at: { lng: row.lng, lat: row.lat },
  m: row.radiusM,
});

/** Read the places in force again. Asked again meanwhile, it reads once more after, so the last change is never missed. */
export function loadZones(): Promise<void> {
  if (held.loading) {
    held.again = true;
    return held.loading;
  }
  const loading = (async () => {
    try {
      do {
        held.again = false;
        const rows = await db
          .select({ id: offLimitsAreas.id, lng: offLimitsAreas.lng, lat: offLimitsAreas.lat, radiusM: offLimitsAreas.radiusM })
          .from(offLimitsAreas)
          .where(isNull(offLimitsAreas.liftedAt));
        setExtraOffLimits(rows.map(placeOf));
      } while (held.again);
    } finally {
      held.loading = null;
    }
  })();
  held.loading = loading;
  return loading;
}

// wherever this module is loaded, so the word from another process reaches it
onReload("zones", loadZones);

/**
 * At the start of every process (src/instrumentation-node.ts), before it answers anyone. Never throws: until they can
 * be read, only the code's places count.
 */
export async function startZones() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadZones().catch((e) => console.error("zones: reading them again failed", errorCode(e))), RELOAD_MS).unref();
  await loadZones().catch((e) => console.error("zones: reading them failed, so only the code's places count for now", errorCode(e)));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A label as the 操作记录 shows it: its first 20 characters */
const short = (label: string) => {
  const chars = [...label];
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : label;
};

/** A circle from the page: its middle, and a whole number of metres from ZONE_MIN_M to ZONE_MAX_M */
function circleOf(q: Record<string, unknown>): { at: LngLat; radiusM: number } {
  const { lng, lat, radiusM } = q;
  if (typeof lng !== "number" || typeof lat !== "number" || !(Math.abs(lng) <= 180) || !(Math.abs(lat) <= 85)) {
    throw new HttpError(400, "位置不对，在地图上重新对一下。");
  }
  if (typeof radiusM !== "number" || !Number.isInteger(radiusM) || radiusM < ZONE_MIN_M || radiusM > ZONE_MAX_M) {
    throw new HttpError(400, ZONE_RADIUS_WRONG);
  }
  return { at: { lng, lat }, radiusM };
}

/** Roaches standing in a circle now, and how many players they belong to: everyone's, the owner's own too, however many */
async function inside(at: LngLat, radiusM: number) {
  const [n] = await db
    .select({ count: count(), owners: countDistinct(roaches.userId) })
    .from(roaches)
    .where(sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography, ${radiusM})`);
  return n;
}

/** What of the site's own stands in a circle or within NEAR_M of its edge, which the owner should know before drawing it */
function warningsFor(at: LngLat, radiusM: number) {
  const near = (p: LngLat) => distanceKm(at, p) * 1000 < radiusM + NEAR_M;
  const warnings: string[] = [];
  if (near(AMIYA_AT)) warnings.push("圈里有阿米娅向导，她附近就不能放蟑螂了。");
  if (near(FIRE_AT)) warnings.push("圈里有塔露拉干员的篝火，蟑螂就不能坐到火边了。");
  if (ROUTE.some((s) => near(s.at))) warnings.push("圈里有明河都尉的一个站点。圈好以后，坐车到这一站的蟑螂下车时会放到圈外。");
  return warnings;
}

/** zonePreview: what a circle would take in now, as numbers only (never whose, nor where) */
export async function previewZone(q: unknown): Promise<ZonePreview> {
  const { at, radiusM } = circleOf(objectOf(q));
  return { ...(await inside(at, radiusM)), warnings: warningsFor(at, radiusM) };
}

/**
 * Move the roaches out of a place just drawn, and count what came out on its row. Kept while it goes on, so the
 * answer can wait for it a little and the tests for all of it (zoneMovesDone).
 */
function moveOut(id: string, place: DrawnPlace) {
  const moving = (async () => {
    const r = await moveOutOfOffLimits([place]);
    await db
      .update(offLimitsAreas)
      .set({ moved: sql`${offLimitsAreas.moved} + ${r.moved}`, sentHome: sql`${offLimitsAreas.sentHome} + ${r.home}`, movedAt: new Date() })
      .where(eq(offLimitsAreas.id, id));
    return r;
  })();
  held.moving.add(moving);
  const done = () => void held.moving.delete(moving);
  moving.then(done, (e) => {
    done();
    console.error("zones: moving the roaches out of a place just drawn failed; the main process finishes it", errorCode(e));
  });
  return moving;
}

/** Every move out of a place drawn that is still going on, settled (for the tests) */
export const zoneMovesDone = () => Promise.allSettled([...held.moving]);

/** A promise's value if it settles within ms, else null (as also when it fails) */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p.catch(() => null), late]).finally(() => clearTimeout(timer));
}

/**
 * drawZone { lng, lat, radiusM, label, sure }: keep a place, tell every process, then move the roaches inside out
 * (src/lib/server/offLimits.ts: just outside, owners told in 站长通知, no yellow card, visiting clones sent home, riders
 * of 明河都尉 left to his next station). More than ZONE_SURE_OVER inside and not sure: nothing kept, the page asks again.
 * Waits up to waitMs for the moving out; past that it answers that it goes on, and the list shows when it is done.
 */
export async function drawZone(actor: Actor, q: unknown, now = Date.now(), waitMs = DRAW_WAIT_MS): Promise<ZoneDrawn> {
  const body = objectOf(q);
  const { at, radiusM } = circleOf(body);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) throw new HttpError(400, "先写一句是哪儿、为什么圈，才能保存。");
  if ([...label].length > ZONE_LABEL_MAX) throw new HttpError(400, `是哪儿、为什么圈，最多写 ${ZONE_LABEL_MAX} 个字。`);
  const live = await db.$count(offLimitsAreas, isNull(offLimitsAreas.liftedAt));
  if (live >= ZONES_MAX) throw new HttpError(400, `正在生效的禁放区最多 ${ZONES_MAX} 处，先解除几处不用的。`);
  const { count: n } = await inside(at, radiusM);
  if (n > ZONE_SURE_OVER && body.sure !== true) return { needSure: true, count: n };

  const [row] = await db
    .insert(offLimitsAreas)
    .values({ lng: at.lng, lat: at.lat, radiusM, label, createdBy: actor.id, createdAt: new Date(now) })
    .returning();
  // this process first, so that the moving below knows the place (failing here fails the answer: the main finishes it),
  // then every other, which refuses a spot in it from now on
  await loadZones();
  await reloadEverywhere("zones");

  const moving = moveOut(row.id, placeOf(row));
  // the moving goes on after the answer: Next.js keeps it (outside a request, as in the tests, it simply goes on)
  try {
    after(moving.catch(() => {}));
  } catch {}
  const r = await within(moving, waitMs);
  const what = r ? `挪走 ${r.moved + r.home} 只` : `正在挪 ${n} 只`;
  await logAdmin(actor, "act", "act.zone", { detail: `${short(label)} · 半径 ${radiusM} 米 · ${what}` }, now);
  return r ? { id: row.id, done: true, count: n, ...r } : { id: row.id, done: false, count: n, moved: 0, home: 0, owners: 0 };
}

/** 禁放区: the places in force, the newest first, and those lifted within a year, the latest first; none of where they are */
export async function listZones(now = Date.now()): Promise<ZoneList> {
  const rows = await db
    .select({ zone: offLimitsAreas, by: admins.alias })
    .from(offLimitsAreas)
    .leftJoin(admins, eq(admins.userId, offLimitsAreas.createdBy))
    .where(or(isNull(offLimitsAreas.liftedAt), gt(offLimitsAreas.liftedAt, new Date(now - KEEP_ADMIN_LOG_DAYS * DAY_MS))))
    .orderBy(desc(offLimitsAreas.createdAt));
  const items = rows.map(
    ({ zone: z, by }): ZoneItem => ({
      id: z.id,
      label: z.label,
      radiusM: z.radiusM,
      by: by ?? OWNER_ALIAS,
      at: z.createdAt.getTime(),
      moved: z.moved,
      sentHome: z.sentHome,
      done: z.movedAt !== null,
      liftedAt: z.liftedAt?.getTime() ?? null,
    }),
  );
  return {
    live: items.filter((z) => z.liftedAt === null),
    lifted: items.filter((z) => z.liftedAt !== null).sort((a, b) => b.liftedAt! - a.liftedAt!),
    inCode: OFF_LIMITS.length,
  };
}

async function rowOf(id: unknown) {
  const [row] = typeof id === "string" && UUID.test(id) ? await db.select().from(offLimitsAreas).where(eq(offLimitsAreas.id, id)) : [];
  if (!row) throw new HttpError(404, "没有这一处，可能已经过了一年，删掉了。");
  return row;
}

/** zone { id }: one place's middle and size, for 去地图上看; the look goes into the 操作记录 */
export async function zoneSpot(actor: Actor, q: unknown, now = Date.now()): Promise<ZoneSpot> {
  const row = await rowOf(objectOf(q).id);
  await logAdmin(actor, "view", "view.zone", { detail: short(row.label) }, now);
  return { id: row.id, lng: row.lng, lat: row.lat, radiusM: row.radiusM, label: row.label, lifted: row.liftedAt !== null };
}

/** liftZone { id }: roaches may stand there again, on every process at once; those moved out stay where they went */
export async function liftZone(actor: Actor, q: unknown, now = Date.now()) {
  const row = await rowOf(objectOf(q).id);
  const [lifted] = await db
    .update(offLimitsAreas)
    .set({ liftedAt: new Date(now), liftedBy: actor.id })
    .where(and(eq(offLimitsAreas.id, row.id), isNull(offLimitsAreas.liftedAt)))
    .returning({ id: offLimitsAreas.id });
  if (!lifted) throw new HttpError(400, "这一处已经解除了。");
  await reloadEverywhere("zones");
  await logAdmin(actor, "act", "act.zoneLift", { detail: `${short(row.label)} · 半径 ${row.radiusM} 米` }, now);
}

/**
 * The main process, as it starts and every few minutes after (src/instrumentation-node.ts): places in force whose
 * moving out was left undone, as when the process drawing one stopped halfway, are finished, counted on their rows.
 * olderThan: only those drawn this long ago, so that one still moving elsewhere is left to it.
 */
export async function finishZones(now = Date.now(), olderThan = 0) {
  const rows = await db
    .select()
    .from(offLimitsAreas)
    .where(and(isNull(offLimitsAreas.movedAt), isNull(offLimitsAreas.liftedAt), lte(offLimitsAreas.createdAt, new Date(now - olderThan))));
  if (!rows.length) return 0;
  // as the database has them, so none is taken for done because this process missed it
  await loadZones();
  for (const row of rows) await moveOut(row.id, placeOf(row));
  return rows.length;
}
