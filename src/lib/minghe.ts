import { fmt, T } from "@/i18n";
import { addDays, beijingDate, beijingMidnight, daysBetween } from "./beijing";
import { GUIDES } from "./guides";
import { isOffLimits } from "./offLimits";
import type { LngLat } from "./types";
import type { MingheItem, PublicRoach } from "./world/types";

/**
 * 明河都尉: the fourth guide (src/lib/guides.ts), whom every player shares. He rides
 * his black horse 怒骊 around the mainland, a city a day: each day at 04:00 Beijing
 * time he moves on to the next station of ROUTE, round the 30 of them in a month,
 * with the last 7 behind him drawn as a trail of stars (明河 is the Milky Way).
 * Players send a clone to ride along for 7 stations, a new city a day, where the
 * roaches there can touch it. Touch him and he answers the same way; the first bold
 * touch makes you 触须之交. He never reaches out on his own.
 *
 * Where he is follows from the date alone, worked out the same way by every page and
 * by the server (which moves the riders along at 04:00, src/lib/server/minghe.ts);
 * nothing of it is stored.
 */

export const MINGHE = GUIDES.minghe;
export const MINGHE_ID = MINGHE.id;

export const isMingheItem = (id: string) => id.startsWith(MINGHE.prefix);

/** The Beijing date he sets out from 张家界·武陵源, the first station: the day he went live */
export const MINGHE_FIRST_DAY = "2026-11-07";
/** A clone rides along this many stations, then he sees it home */
export const RIDE_STOPS = 7;
/** Stations in the trail of stars, his own included */
export const TRAIL_STOPS = 7;
/** Flying to him stops here (MapLibre levels), close enough to tell his riders apart */
export const MINGHE_ZOOM = 17;
/** No show roaches this close to any station, so none looks like it rides with him */
export const MINGHE_BOT_FREE_KM = 1;

export type Station = {
  /** As the cards write it */
  name: string;
  at: LngLat;
  /** Which way his riders queue behind him, in degrees clockwise from north; towards the station before by default */
  queue?: number;
  /** His own line about the place; the others share three (stationLines) */
  line?: string;
};

/**
 * The route, WGS84, each spot checked on OpenStreetMap: on land, with land for a few
 * hundred metres where the riders queue.
 */
export const ROUTE: Station[] = [
  {
    get name() {
      return T.lib.minghe.stations.s1.name;
    },
    at: { lng: 110.4352, lat: 29.3499 },
    get line() {
      return T.lib.minghe.stations.s1.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s2.name;
    },
    at: { lng: 111.4203, lat: 28.7774 },
    get line() {
      return T.lib.minghe.stations.s2.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s3.name;
    },
    at: { lng: 112.9561, lat: 28.1897 },
    queue: 0,
  },
  {
    get name() {
      return T.lib.minghe.stations.s4.name;
    },
    at: { lng: 113.0883, lat: 29.3847 },
    queue: 90,
  },
  {
    get name() {
      return T.lib.minghe.stations.s5.name;
    },
    at: { lng: 114.2971, lat: 30.5471 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s6.name;
    },
    at: { lng: 115.8784, lat: 28.6814 },
    queue: 90,
    get line() {
      return T.lib.minghe.stations.s6.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s7.name;
    },
    at: { lng: 118.1639, lat: 30.1348 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s8.name;
    },
    at: { lng: 120.1627, lat: 30.2585 },
    queue: 90,
  },
  {
    get name() {
      return T.lib.minghe.stations.s9.name;
    },
    at: { lng: 121.4856, lat: 31.2393 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s10.name;
    },
    at: { lng: 120.6297, lat: 31.3149 },
    queue: 180,
  },
  {
    get name() {
      return T.lib.minghe.stations.s11.name;
    },
    at: { lng: 118.7822, lat: 32.072 },
    queue: 200,
  },
  {
    get name() {
      return T.lib.minghe.stations.s12.name;
    },
    at: { lng: 117.2882, lat: 31.8603 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s13.name;
    },
    at: { lng: 117.0215, lat: 36.6712 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s14.name;
    },
    at: { lng: 120.3144, lat: 36.062 },
    queue: 0,
  },
  {
    get name() {
      return T.lib.minghe.stations.s15.name;
    },
    at: { lng: 121.581, lat: 38.8805 },
    queue: 0,
    get line() {
      return T.lib.minghe.stations.s15.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s16.name;
    },
    at: { lng: 123.4544, lat: 41.799 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s17.name;
    },
    at: { lng: 117.1775, lat: 39.1535 },
    queue: 270,
  },
  {
    get name() {
      return T.lib.minghe.stations.s18.name;
    },
    at: { lng: 116.268, lat: 39.9978 },
    queue: 0,
  },
  {
    get name() {
      return T.lib.minghe.stations.s19.name;
    },
    at: { lng: 113.5285, lat: 34.9445 },
    queue: 180,
  },
  {
    get name() {
      return T.lib.minghe.stations.s20.name;
    },
    at: { lng: 112.4707, lat: 34.5571 },
    queue: 270,
    get line() {
      return T.lib.minghe.stations.s20.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s21.name;
    },
    at: { lng: 108.9423, lat: 34.2545 },
    queue: 0,
  },
  {
    get name() {
      return T.lib.minghe.stations.s22.name;
    },
    at: { lng: 104.0812, lat: 30.6453 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s23.name;
    },
    at: { lng: 106.5841, lat: 29.5697 },
    queue: 235,
  },
  {
    get name() {
      return T.lib.minghe.stations.s24.name;
    },
    at: { lng: 106.716, lat: 26.5758 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s25.name;
    },
    at: { lng: 102.6495, lat: 24.9759 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s26.name;
    },
    at: { lng: 108.3348, lat: 22.7971 },
    queue: 0,
  },
  {
    get name() {
      return T.lib.minghe.stations.s27.name;
    },
    at: { lng: 110.4859, lat: 24.9384 },
    queue: 270,
    get line() {
      return T.lib.minghe.stations.s27.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s28.name;
    },
    at: { lng: 113.319, lat: 23.1225 },
    get line() {
      return T.lib.minghe.stations.s28.line;
    },
  },
  {
    get name() {
      return T.lib.minghe.stations.s29.name;
    },
    at: { lng: 113.965, lat: 22.5222 },
  },
  {
    get name() {
      return T.lib.minghe.stations.s30.name;
    },
    at: { lng: 118.0619, lat: 24.4475 },
  },
];

/** What he says at the stations without a line of their own, taking turns by the day */
export const stationLines = () => [T.lib.minghe.stationLines.l1, T.lib.minghe.stationLines.l2, T.lib.minghe.stationLines.l3];

/** His lines, word for word as Breeze approved them */
export const MINGHE_LINES = {
  get sneaky() {
    return T.lib.minghe.line.sneaky;
  },
  get bold() {
    return T.lib.minghe.line.bold;
  },
  get friend() {
    return T.lib.minghe.line.friend;
  },
  get unfriend() {
    return T.lib.minghe.line.unfriend;
  },
  get unfriendAsk() {
    return T.lib.minghe.line.unfriendAsk;
  },
  get intro() {
    return T.lib.minghe.line.intro;
  },
};

const HOUR = 3_600_000;

/**
 * Which day of his journey it is: 0 on MINGHE_FIRST_DAY (and before it), turning at
 * 04:00 Beijing time like 好久没来自动翻. shift: days added in development only (明河快进一天).
 */
export function mingheDay(now = Date.now(), shift = 0) {
  return Math.max(0, daysBetween(MINGHE_FIRST_DAY, beijingDate(now - 4 * HOUR)) + shift);
}

/** The next 04:00 in Beijing, when he moves on */
export function nextStationAt(now = Date.now()) {
  return beijingMidnight(beijingDate(now - 4 * HOUR)) + 28 * HOUR;
}

/** The station of a day (0–29), round and round */
export const stopOf = (day: number) => ((day % ROUTE.length) + ROUTE.length) % ROUTE.length;
export const stationOf = (day: number) => ROUTE[stopOf(day)];
/** The Beijing date (YYYY-MM-DD) of a day of his journey */
export const dateOfDay = (day: number) => addDays(MINGHE_FIRST_DAY, day);

/** What he says about the day's station on his card */
export function stationLine(day: number) {
  const shared = stationLines();
  return stationOf(day).line ?? shared[day % shared.length];
}

/** The stations of the trail of stars, oldest first and his own last: only those already passed in his first days */
export function trailOf(day: number): LngLat[] {
  const from = Math.max(0, day - (TRAIL_STOPS - 1));
  return Array.from({ length: day - from + 1 }, (_, i) => stationOf(from + i).at);
}

const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;

/** Compass bearing from a to b, in degrees clockwise from north */
export function bearing(a: LngLat, b: LngLat) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Which way a station's riders queue behind him: as the route table says, or back towards the station before */
export function queueBearing(stop: number) {
  const s = ROUTE[stopOf(stop)];
  return s.queue ?? bearing(s.at, ROUTE[stopOf(stop - 1)].at);
}

/** A point some metres away along a bearing, and some metres to its right */
function offset(from: LngLat, deg: number, ahead: number, right: number): LngLat {
  const north = ahead * Math.cos(rad(deg)) - right * Math.sin(rad(deg));
  const east = ahead * Math.sin(rad(deg)) + right * Math.cos(rad(deg));
  return { lng: from.lng + east / (M_PER_DEG * Math.cos(rad(from.lat))), lat: from.lat + north / M_PER_DEG };
}

/** Riders queue three abreast this far apart, the first row this far behind him and each next row this much further */
export const QUEUE = { across: 10, first: 14, apart: 12, abreast: 3 };
/** A spot with a roach this close is taken */
export const SPOT_TAKEN_M = 5;

/** The k-th spot in a station's queue (from 0): row floor(k / 3), the middle one first */
export function queueSpot(stop: number, k: number): LngLat {
  const row = Math.floor(k / QUEUE.abreast);
  const col = k % QUEUE.abreast;
  const side = col === 0 ? 0 : col === 1 ? -QUEUE.across : QUEUE.across;
  return offset(stationOf(stop).at, queueBearing(stop), QUEUE.first + QUEUE.apart * row, side);
}

/** Metres between two nearby points, flat-earth, plenty for spots a few metres apart */
export function metresApart(a: LngLat, b: LngLat) {
  const dy = (a.lat - b.lat) * M_PER_DEG;
  const dx = (a.lng - b.lng) * M_PER_DEG * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dx, dy);
}

/**
 * The first n free spots of a station's queue, in order: a spot is taken when one of
 * `taken` (roaches already standing there, not those being laid out) is within SPOT_TAKEN_M,
 * and skipped where no roach may stand (src/lib/offLimits.ts).
 * The queue has no end (Breeze, 2026-11-10): once it reached 2 km, which was as far as it
 * looked, every rider after landed on the same spot. The taken roaches go into squares of
 * SPOT_TAKEN_M by where they stand, so a queue of thousands is laid out at once.
 */
export function queueSpots(stop: number, n: number, taken: LngLat[] = []): LngLat[] {
  const at = stationOf(stop).at;
  const cos = Math.cos(rad(at.lat));
  const cellOf = (p: LngLat) => [Math.floor(((p.lng - at.lng) * M_PER_DEG * cos) / SPOT_TAKEN_M), Math.floor(((p.lat - at.lat) * M_PER_DEG) / SPOT_TAKEN_M)];
  const cells = new Map<string, LngLat[]>();
  for (const t of taken) {
    const [x, y] = cellOf(t);
    const key = `${x},${y}`;
    const list = cells.get(key);
    if (list) list.push(t);
    else cells.set(key, [t]);
  }
  const isTaken = (spot: LngLat) => {
    const [x, y] = cellOf(spot);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (cells.get(`${x + dx},${y + dy}`)?.some((t) => metresApart(t, spot) < SPOT_TAKEN_M)) return true;
      }
    return false;
  };
  const out: LngLat[] = [];
  // each taken roach blocks at most one spot (spots are 10 m apart), and each skipped spot is made up for, so this always finds n
  for (let k = 0, skipped = 0; out.length < n && k < taken.length + n + skipped; k++) {
    const spot = queueSpot(stop, k);
    if (isOffLimits(spot)) skipped++;
    else if (!isTaken(spot)) out.push(spot);
  }
  return out;
}

// ---- what he says ----

const stationName = (stop: number | null) => (stop === null ? "" : stationOf(stop).name);

export const rideLine = (stop: number) => fmt(T.lib.minghe.ride, { today: stationName(stop), tomorrow: stationName(stop + 1) });
export const dismountLine = (stop: number) => fmt(T.lib.minghe.dismount, { station: stationName(stop) });
export const tripLine = (times: number) => fmt(T.lib.minghe.trip, { stops: RIDE_STOPS, times });

/** What he says back to a touch, over his head */
export function mingheTouchLine(what: "touch" | "friend", bold: boolean) {
  if (what === "friend") return MINGHE_LINES.friend;
  return bold ? MINGHE_LINES.bold : MINGHE_LINES.sneaky;
}

/** The stations a ride that set out from stop went through, in order */
export const tripStops = (stop: number) => Array.from({ length: RIDE_STOPS }, (_, i) => stationOf(stop + i).name);

/** One of his in the inbox, in his own words. */
export function mingheText(item: Pick<MingheItem, "line" | "bold" | "stop" | "times">) {
  const stop = item.stop ?? 0;
  switch (item.line) {
    case "friend":
      return fmt(T.lib.minghe.text.friend, { name: MINGHE.name, line: MINGHE_LINES.friend });
    case "ride":
      return fmt(T.lib.minghe.text.ride, { name: MINGHE.name, line: rideLine(stop) });
    case "dismount":
      return fmt(T.lib.minghe.text.dismount, { station: stationName(stop), name: MINGHE.name, line: dismountLine(stop) });
    case "trip":
      return fmt(T.lib.minghe.text.trip, { name: MINGHE.name, line: tripLine(item.times ?? 0) });
    default:
      return fmt(T.lib.guides.answered, { name: MINGHE.name, line: item.bold ? MINGHE_LINES.bold : MINGHE_LINES.sneaky });
  }
}


/** His place on the map: today's station */
export function mingheRoach(day: number, friend: boolean): PublicRoach {
  return { id: MINGHE_ID, clone: false, avatar: MINGHE.avatar, color: MINGHE.color, friend, guide: true, ...stationOf(day).at };
}
