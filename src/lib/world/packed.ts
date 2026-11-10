import type { MapRoach } from "./types";

/**
 * Every roach in the shared feed in as few bytes as plainly possible, for the whole-snapshot
 * download that every page starts with (src/lib/server/roachFeed.ts). In columns: each id as its
 * bytes, places to about a metre, the looks numbered, and the roaches ordered from west to
 * east, so that each longitude is a small step from the one before. The order says nothing more
 * than the places themselves already do.
 *
 * The ids are a roach's whole public id (sixteen bytes), or, in the feed's short form, only its
 * first four bytes (shortIds below): random either way, so they are most of the download, and
 * four bytes tell 25,000 roaches apart just as well.
 */
export type PackedRoaches = {
  /** [avatar, color] for each look number */
  looks: [MapRoach["avatar"], MapRoach["color"]][];
  /** Bytes per id: 4 in the short form; sixteen when left out */
  w?: 4;
  /** Every id's bytes, one roach after another, in base64 */
  ids: string;
  /** Longitudes in hundred-thousandths of a degree, each as the step from the roach before */
  x: number[];
  /** Latitudes in hundred-thousandths of a degree */
  y: number[];
  /** Look number × 8, plus 1 for a clone, 2 for asleep, 4 for riding with 明河都尉 */
  k: number[];
  /** Roaches whose ids are not of that form (the show roaches, world/bots.ts, and in the short form the rare few whose first four bytes are shared), as they are */
  rest?: MapRoach[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A roach's id in the feed's short form: the first four bytes of its public id, as hex */
export const SHORT_ID = /^[0-9a-f]{8}$/;

/** The short form of a public id (uuids only; anything else is its own) */
export const shortOf = (publicId: string) => (UUID.test(publicId) ? publicId.slice(0, 8) : publicId);

/**
 * The id each roach goes by in the feed's short form: the first four bytes of its public id,
 * except where two roaches' first four bytes are the same, which then both go by their whole
 * public ids. So no short id ever stands for two roaches in one snapshot.
 */
export function shortIds(publicIds: Iterable<string>): Map<string, string> {
  const count = new Map<string, number>();
  const all = [...publicIds];
  for (const id of all) if (UUID.test(id)) count.set(id.slice(0, 8), (count.get(id.slice(0, 8)) ?? 0) + 1);
  return new Map(all.map((id) => [id, UUID.test(id) && count.get(id.slice(0, 8)) === 1 ? id.slice(0, 8) : id]));
}

/** Every id a roach with this public id may go by in a page's copy of the feed, either form */
export const feedIdsOf = (publicId: string) => (UUID.test(publicId) ? [publicId, publicId.slice(0, 8)] : [publicId]);

/** Whether a roach's id in the feed (either form) and a public id are the same roach */
export const sameRoach = (feedId: string, publicId: string) =>
  feedId === publicId || (SHORT_ID.test(feedId) && UUID.test(publicId) && publicId.startsWith(feedId));
const STEP = 1e5;
const CLONE = 1;
const ASLEEP = 2;
const RIDE = 4;

/** A place to about a metre (1e-5°), as everyone's copy of the feed holds it */
export const nearMetre = (deg: number) => Math.round(deg * STEP) / STEP;

/**
 * Pack the roaches; their places should already be to the metre (nearMetre), or they come back so.
 * width 4: the short form, for a list whose ids already are short ids (shortIds) where they can be.
 */
export function packRoaches(list: MapRoach[], width: 4 | 16 = 16): PackedRoaches {
  const form = width === 4 ? SHORT_ID : UUID;
  const packable = list
    .filter((r) => form.test(r.id))
    .map((r) => ({ r, x: Math.round(r.lng * STEP), y: Math.round(r.lat * STEP) }))
    .sort((a, b) => a.x - b.x || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));
  const looks: PackedRoaches["looks"] = [];
  const lookNo = new Map<string, number>();
  const x: number[] = [];
  const y: number[] = [];
  const k: number[] = [];
  let bytes = "";
  let lastX = 0;
  for (const { r, x: rx, y: ry } of packable) {
    const key = `${r.avatar} ${r.color}`;
    let no = lookNo.get(key);
    if (no === undefined) {
      no = looks.length;
      lookNo.set(key, no);
      looks.push([r.avatar, r.color]);
    }
    k.push(no * 8 + (r.clone ? CLONE : 0) + (r.asleep ? ASLEEP : 0) + (r.ride ? RIDE : 0));
    x.push(rx - lastX);
    lastX = rx;
    y.push(ry);
    const hex = r.id.replace(/-/g, "");
    for (let i = 0; i < width * 2; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  const rest = list.filter((r) => !form.test(r.id));
  return { looks, ...(width === 4 ? { w: 4 as const } : {}), ids: btoa(bytes), x, y, k, ...(rest.length ? { rest } : {}) };
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** The roaches back from a packed snapshot, each just as the feed describes it elsewhere. */
export function unpackRoaches(p: PackedRoaches): MapRoach[] {
  const bytes = atob(p.ids);
  const w = p.w ?? 16;
  const out: MapRoach[] = [];
  let x = 0;
  for (let i = 0; i < p.k.length; i++) {
    x += p.x[i];
    let h = "";
    for (let j = i * w; j < i * w + w; j++) h += HEX[bytes.charCodeAt(j)];
    const k = p.k[i];
    const [avatar, color] = p.looks[k >> 3];
    const r: MapRoach = {
      id: w === 4 ? h : `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
      clone: Boolean(k & CLONE),
      avatar,
      color,
      lng: x / STEP,
      lat: p.y[i] / STEP,
    };
    if (k & ASLEEP) r.asleep = true;
    if (k & RIDE) r.ride = true;
    out.push(r);
  }
  return p.rest ? out.concat(p.rest) : out;
}
