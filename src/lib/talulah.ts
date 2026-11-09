import { homeGame, type Game } from "./games";
import { distanceKm } from "./geo";
import { GUIDES, guideProfile } from "./guides";
import type { LngLat } from "./types";
import type { PublicRoach, TalulahItem } from "./world/types";

/**
 * 塔露拉干员: the third guide (src/lib/guides.ts), who keeps a fire on Sun Island
 * in Harbin. Every player shares her and her fire. Players send a clone to sit
 * by it, and the more roaches there are within FIRE_RADIUS_M, the bigger it
 * burns; the page counts them from the shared roach list and seats newcomers in
 * rings around it. Touch her and she answers the same way; the first bold touch
 * is a handshake that makes you 触须之交. She never reaches out on her own: she
 * welcomes your first roach at the fire, and answers a 触须之交's birthday
 * declaration once a year (src/lib/server/talulah.ts).
 */

export const TALULAH = GUIDES.talulah;
export const TALULAH_ID = TALULAH.id;
export const TALULAH_NAME = TALULAH.name;

export const isTalulahItem = (id: string) => id.startsWith(TALULAH.prefix);

/** Her fire: open ground in Sun Island Park, Harbin, just east of 太阳湖 (WGS84) */
export const FIRE_AT: LngLat = { lng: 126.5915, lat: 45.791 };
/** Roaches this close to the fire sit by it, and count towards its size */
export const FIRE_RADIUS_M = 300;
/** Flying to her stops here (MapLibre levels), close enough to tell the roaches round the fire apart */
export const FIRE_ZOOM = 17;
/** No show roaches this close to the fire, so they never look like they sit by it */
export const FIRE_BOT_FREE_KM = 2;

/** Her lines, word for word as Breeze approved them; the handshake and birthday ones are her own voice lines */
export const TALULAH_LINES = {
  sneaky: "我看见你了。不用躲，过来坐吧，火边暖和。",
  bold: "来得正好，火刚添过柴。",
  welcome: "一起在篝火边休息一下吧。",
  birthday:
    "原来今天是你的生日吗？抱歉，自从离开龙门，过生日这件事就变得很陌生了。我随身带着的这本书可以当作礼物吗？明年这个时候我一定会认真准备的。嗯，除了晖洁的生日，现在我也记住你的了。",
  hood: "这兜帽……让我想起一些老朋友。",
  /** The start of the handshake, all a speech bubble has room for */
  hello: "你好！终于见到你了",
  unfriendAsk: "解除和塔露拉干员的触须之交？她还在太阳岛守着火。",
  unfriend: "我明白。火会一直烧着，你想回来就回来。",
};

/** The handshake, the one line that says 博士: 管理员 for those who play only Endfield */
export function handshakeLine(games: Game[]) {
  const you = homeGame(games) === "endfield" ? "管理员" : "罗德岛的博士";
  return `${TALULAH_LINES.hello}，${you}，我很荣幸。重新认识一下，塔露拉·雅特利亚斯，一名来自乌萨斯的感染者。来，握个手吧。`;
}

/** What she says back to a touch: the handshake when it made you 触须之交; she always answers openly */
export function talulahTouchLine(what: "touch" | "friend", bold: boolean, games: Game[]) {
  if (what === "friend") return handshakeLine(games);
  return bold ? TALULAH_LINES.bold : TALULAH_LINES.sneaky;
}

/** One of hers in the inbox, in her own words. */
export function talulahText(item: Pick<TalulahItem, "line" | "bold">, games: Game[]) {
  switch (item.line) {
    case "handshake":
      return `${TALULAH_NAME}和你握了握手：「${handshakeLine(games)}」`;
    case "welcome":
      return `你的克隆体坐到了火边，${TALULAH_NAME}说：「${TALULAH_LINES.welcome}」`;
    case "birthday":
      return `${TALULAH_NAME}看到了你的生日宣言：「${TALULAH_LINES.birthday}」`;
    default:
      return `${TALULAH_NAME}回了你：「${item.bold ? TALULAH_LINES.bold : TALULAH_LINES.sneaky}」`;
  }
}

export const isNearFire = (p: LngLat) => distanceKm(p, FIRE_AT) * 1000 <= FIRE_RADIUS_M;

// ---- the fire: how big it burns, and where the next roach sits ----

export type FireLevel = 1 | 2 | 3 | 4;

/** Roaches by the fire: real players' (main and clones), within FIRE_RADIUS_M; she does not count herself */
export function fireCount(roaches: { lng: number; lat: number; bot?: true }[]) {
  // a quick box first, then the distance
  const dLat = (FIRE_RADIUS_M / 111_000) * 1.05;
  const dLng = dLat / Math.cos((FIRE_AT.lat * Math.PI) / 180);
  let n = 0;
  for (const r of roaches) {
    if (r.bot || Math.abs(r.lat - FIRE_AT.lat) > dLat || Math.abs(r.lng - FIRE_AT.lng) > dLng) continue;
    if (isNearFire(r)) n += 1;
  }
  return n;
}

/** Under 10 a small fire, then 10–49, 50–199, and 200 or more is a bonfire party */
export const fireLevel = (n: number): FireLevel => (n >= 200 ? 4 : n >= 50 ? 3 : n >= 10 ? 2 : 1);

/** What she says on her card about the fire, by its size */
export const FIRE_LINES: Record<FireLevel, string> = {
  1: "火还小，不过够暖和了。坐过来吧。",
  2: "人多起来了。记住彼此的名字吧。",
  3: "你听，火边有人在唱歌。",
  4: "……原来大家都在。你并不孤单。",
};

const M_PER_DEG = 111_320;
/** Metres east and north of a centre (the fire unless said otherwise) */
function offsetOf(p: LngLat, c: LngLat = FIRE_AT) {
  return {
    x: (p.lng - c.lng) * M_PER_DEG * Math.cos((c.lat * Math.PI) / 180),
    y: (p.lat - c.lat) * M_PER_DEG,
  };
}
function pointAt(x: number, y: number, c: LngLat = FIRE_AT): LngLat {
  return { lng: c.lng + x / (M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)), lat: c.lat + y / M_PER_DEG };
}

/** Ring k of seats around the fire: its radius in metres, and how many seats it has, 15 m apart */
export const ringRadius = (k: number) => 10 + 15 * k;
export const ringSeats = (k: number) => Math.floor((2 * Math.PI * ringRadius(k)) / 15);
/** A seat with a roach this close is taken */
export const SEAT_TAKEN_M = 6;
/**
 * Where she stands, in metres from the fire, and how far her picture reaches, as the
 * map draws her at FIRE_ZOOM (just west of the fire, see guideShift in guideMarker.ts):
 * nobody is seated behind her, where they could not be seen.
 */
export const HER_SPOT_M = { x: -14, y: 8, r: 10 };
const MAX_RINGS = 200;

/** The seats of ring k, each ring turned half a seat from the one inside it, in metres from the fire */
export function ringSpots(k: number) {
  const n = ringSeats(k);
  const r = ringRadius(k);
  const turn = (k % 2) * (Math.PI / n);
  return Array.from({ length: n }, (_, i) => {
    const a = turn + (2 * Math.PI * i) / n;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}

/**
 * Where the next roach sits: a free seat (no roach within SEAT_TAKEN_M, and not
 * behind her) picked at random in the innermost ring that has one, nudged up to a metre either way so
 * two pages picking at once rarely land on the same spot. Beyond FIRE_RADIUS_M
 * the rings go on, though roaches there no longer count towards the fire.
 *
 * The same rings serve 串门 (src/lib/server/friendly.ts): center, the rings around a 触须之交's
 * roach instead of the fire; nearest, the free seat among the fire's own rings closest to that
 * spot (a roach by the fire has its guests sit by the fire too).
 */
export function pickSeat(
  roaches: { lng: number; lat: number }[],
  random: () => number = Math.random,
  { center = FIRE_AT, nearest }: { center?: LngLat; nearest?: LngLat } = {},
): LngLat {
  const fire = center.lng === FIRE_AT.lng && center.lat === FIRE_AT.lat;
  const reach = FIRE_RADIUS_M * 2;
  const near = roaches.map((p) => offsetOf(p, center)).filter((p) => Math.abs(p.x) < reach && Math.abs(p.y) < reach);
  const freeOf = (k: number) => {
    const r = ringRadius(k);
    // only roaches near this ring can take one of its seats
    const close = near.filter((p) => Math.abs(Math.hypot(p.x, p.y) - r) <= SEAT_TAKEN_M);
    return ringSpots(k).filter(
      (s) =>
        (!fire || Math.hypot(s.x - HER_SPOT_M.x, s.y - HER_SPOT_M.y) >= HER_SPOT_M.r) &&
        !close.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < SEAT_TAKEN_M),
    );
  };
  const nudged = (s: { x: number; y: number }) => pointAt(s.x + (random() * 2 - 1), s.y + (random() * 2 - 1), center);
  if (nearest) {
    const to = offsetOf(nearest, center);
    const seats = Array.from({ length: MAX_RINGS }, (_, k) => k)
      .filter((k) => ringRadius(k) <= FIRE_RADIUS_M)
      .flatMap(freeOf);
    if (seats.length) return nudged(seats.reduce((a, b) => (Math.hypot(b.x - to.x, b.y - to.y) < Math.hypot(a.x - to.x, a.y - to.y) ? b : a)));
  }
  for (let k = 0; k < MAX_RINGS; k++) {
    const free = freeOf(k);
    if (!free.length) continue;
    return nudged(free[Math.floor(random() * free.length)]);
  }
  return pointAt(ringRadius(MAX_RINGS), 0, center);
}

/** Her card for anyone who opens it: no games, UID, favourites or badges */
export const TALULAH_PROFILE = guideProfile(TALULAH);

/** Her place on the map: by her fire (the map draws the fire beside her) */
export function talulahRoach(friend: boolean): PublicRoach {
  return { id: TALULAH_ID, clone: false, avatar: TALULAH.avatar, color: TALULAH.color, friend, guide: true, ...FIRE_AT };
}
