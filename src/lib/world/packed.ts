import { OVERVIEW_CELLS, overviewCell } from "./area";
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
  /**
   * Instead of x and y, for the overview's tiles: each roach at the middle of its square of the overview
   * (world/area.ts overviewCell), the squares' columns and rows each as the step from the roach before,
   * the roaches in rows from the north, west to east
   */
  sx?: number[];
  sy?: number[];
  /** Look number × 8, plus 1 for a clone, 2 for asleep, 4 for riding with 明河都尉 */
  k: number[];
  /** In the overview (world/area.ts): how many roaches each stands for, itself included; left out when all are 1 */
  n?: number[];
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

/** The middle of a square of the overview (world/area.ts overviewCell), to the metre */
export function squareMiddle(column: number, row: number): { lng: number; lat: number } {
  return squareAt(column, row, 0.5, 0.5);
}

/** A point of a square of the overview, fx and fy of the way across and down it, to the metre */
function squareAt(column: number, row: number, fx: number, fy: number): { lng: number; lat: number } {
  const lng = ((column + fx) / OVERVIEW_CELLS) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + fy)) / OVERVIEW_CELLS))) * 180) / Math.PI;
  return { lng: nearMetre(lng), lat: nearMetre(lat) };
}

/**
 * Where a roach of the overview is drawn in its square: a spot of its own, the same every time (from its id), not
 * nearer an edge than a tenth of the square. At their squares' middles the roaches of a crowded city stood in rows
 * and columns, which showed zoomed in to a province, and for the moment after zooming in further, until the
 * roaches of the place came.
 */
export function squareSpot(column: number, row: number, id: string): { lng: number; lat: number } {
  // FNV-1a: the id's own bits, spread over 32
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return squareAt(column, row, 0.1 + (0.8 * (h & 0xffff)) / 0x10000, 0.1 + (0.8 * (h >>> 16)) / 0x10000);
}

/**
 * Pack the roaches; their places should already be to the metre (nearMetre), or they come back so.
 * width 4: the short form, for a list whose ids already are short ids (shortIds) where they can be.
 * squares: each at the middle of its square of the overview instead (one roach a square, as the
 * overview's tiles have them): a tenth of the bytes for the places, and none of them where it is.
 */
export function packRoaches(list: MapRoach[], width: 4 | 16 = 16, squares = false): PackedRoaches {
  const form = width === 4 ? SHORT_ID : UUID;
  if (squares) return packSquares(list, form, width);
  const packable = list
    .filter((r) => form.test(r.id))
    .map((r) => ({ r, x: Math.round(r.lng * STEP), y: Math.round(r.lat * STEP) }))
    .sort((a, b) => a.x - b.x || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));
  const looks: PackedRoaches["looks"] = [];
  const lookNo = new Map<string, number>();
  const x: number[] = [];
  const y: number[] = [];
  const k: number[] = [];
  const n: number[] = [];
  let bytes = "";
  let lastX = 0;
  for (const { r, x: rx, y: ry } of packable) {
    n.push(r.n ?? 1);
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
  const weighed = n.some((c) => c !== 1);
  return { looks, ...(width === 4 ? { w: 4 as const } : {}), ids: btoa(bytes), x, y, k, ...(weighed ? { n } : {}), ...(rest.length ? { rest } : {}) };
}

function packSquares(list: MapRoach[], form: RegExp, width: 4 | 16): PackedRoaches {
  const at = list.map((r) => {
    const cell = overviewCell(r);
    return { r, cx: cell % OVERVIEW_CELLS, cy: Math.floor(cell / OVERVIEW_CELLS) };
  });
  const packable = at
    .filter((a) => form.test(a.r.id))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));
  const looks: PackedRoaches["looks"] = [];
  const lookNo = new Map<string, number>();
  const sx: number[] = [];
  const sy: number[] = [];
  const k: number[] = [];
  const n: number[] = [];
  let bytes = "";
  let lastX = 0;
  let lastY = 0;
  for (const { r, cx, cy } of packable) {
    n.push(r.n ?? 1);
    const key = `${r.avatar} ${r.color}`;
    let no = lookNo.get(key);
    if (no === undefined) {
      no = looks.length;
      lookNo.set(key, no);
      looks.push([r.avatar, r.color]);
    }
    k.push(no * 8 + (r.clone ? CLONE : 0) + (r.asleep ? ASLEEP : 0) + (r.ride ? RIDE : 0));
    sx.push(cx - lastX);
    sy.push(cy - lastY);
    lastX = cx;
    lastY = cy;
    const hex = r.id.replace(/-/g, "");
    for (let i = 0; i < width * 2; i += 2) bytes += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  const rest = at.filter((a) => !form.test(a.r.id)).map(({ r, cx, cy }) => ({ ...r, ...squareMiddle(cx, cy) }));
  const weighed = n.some((c) => c !== 1);
  return {
    looks,
    ...(width === 4 ? { w: 4 as const } : {}),
    ids: btoa(bytes),
    x: [],
    y: [],
    sx,
    sy,
    k,
    ...(weighed ? { n } : {}),
    ...(rest.length ? { rest } : {}),
  };
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/**
 * The roaches back from a packed snapshot, each just as the feed describes it elsewhere. scatter: the overview's
 * roaches given as squares (sx, sy) each at a spot of its own in its square (squareSpot), as the map draws them,
 * not all at the middles.
 */
export function unpackRoaches(p: PackedRoaches, scatter = false): MapRoach[] {
  const bytes = atob(p.ids);
  const w = p.w ?? 16;
  const out: MapRoach[] = [];
  let x = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.k.length; i++) {
    let at: { lng: number; lat: number };
    let h = "";
    for (let j = i * w; j < i * w + w; j++) h += HEX[bytes.charCodeAt(j)];
    if (p.sx && p.sy) {
      cx += p.sx[i];
      cy += p.sy[i];
      at = scatter ? squareSpot(cx, cy, h) : squareMiddle(cx, cy);
    } else {
      x += p.x[i];
      at = { lng: x / STEP, lat: p.y[i] / STEP };
    }
    const k = p.k[i];
    const [avatar, color] = p.looks[k >> 3];
    const r: MapRoach = {
      id: w === 4 ? h : `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
      clone: Boolean(k & CLONE),
      avatar,
      color,
      lng: at.lng,
      lat: at.lat,
    };
    if (k & ASLEEP) r.asleep = true;
    if (k & RIDE) r.ride = true;
    if (p.n && p.n[i] !== 1) r.n = p.n[i];
    out.push(r);
  }
  return p.rest ? out.concat(p.rest) : out;
}
