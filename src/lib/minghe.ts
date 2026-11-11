import { addDays, beijingDate, beijingMidnight, daysBetween } from "./beijing";
import { GUIDES, guideProfile } from "./guides";
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
export const MINGHE_NAME = MINGHE.name;

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
  /** His own line about the place; the others share three (STATION_LINES) */
  line?: string;
};

/**
 * The route, WGS84, each spot checked on OpenStreetMap: on land, with land for a few
 * hundred metres where the riders queue.
 */
export const ROUTE: Station[] = [
  {
    name: "张家界·武陵源",
    at: { lng: 110.4352, lat: 29.3499 },
    line: "这里也叫武陵。山像是谁一笔一笔画出来的。",
  },
  { name: "常德·桃花源", at: { lng: 111.4203, lat: 28.7774 }, line: "缘溪行，忘路之远近。……古人走到这里，也迷了路。" },
  { name: "长沙·橘子洲", at: { lng: 112.9561, lat: 28.1897 }, queue: 0 },
  { name: "岳阳·岳阳楼", at: { lng: 113.0883, lat: 29.3847 }, queue: 90 },
  { name: "武汉·黄鹤楼", at: { lng: 114.2971, lat: 30.5471 } },
  { name: "南昌·滕王阁", at: { lng: 115.8784, lat: 28.6814 }, queue: 90, line: "落霞与孤鹜齐飞，秋水共长天一色。" },
  { name: "黄山", at: { lng: 118.1639, lat: 30.1348 } },
  { name: "杭州·西湖", at: { lng: 120.1627, lat: 30.2585 }, queue: 90 },
  { name: "上海·外滩", at: { lng: 121.4856, lat: 31.2393 } },
  { name: "苏州·平江路", at: { lng: 120.6297, lat: 31.3149 }, queue: 180 },
  { name: "南京·玄武湖", at: { lng: 118.7822, lat: 32.072 }, queue: 200 },
  { name: "合肥·包公园", at: { lng: 117.2882, lat: 31.8603 } },
  { name: "济南·大明湖", at: { lng: 117.0215, lat: 36.6712 } },
  { name: "青岛·栈桥", at: { lng: 120.3144, lat: 36.062 }, queue: 0 },
  { name: "大连·星海湾", at: { lng: 121.581, lat: 38.8805 }, queue: 0, line: "星海。……好名字。" },
  { name: "沈阳·中街", at: { lng: 123.4544, lat: 41.799 } },
  { name: "天津·海河", at: { lng: 117.1775, lat: 39.1535 }, queue: 270 },
  { name: "北京·颐和园", at: { lng: 116.268, lat: 39.9978 }, queue: 0 },
  { name: "郑州·黄河", at: { lng: 113.5285, lat: 34.9445 }, queue: 180 },
  { name: "洛阳·龙门", at: { lng: 112.4707, lat: 34.5571 }, queue: 270, line: "龙门。这名字，跟我们龙族有点缘分。" },
  { name: "西安·城墙", at: { lng: 108.9423, lat: 34.2545 }, queue: 0 },
  { name: "成都·锦江", at: { lng: 104.0812, lat: 30.6453 } },
  { name: "重庆·朝天门", at: { lng: 106.5841, lat: 29.5697 }, queue: 235 },
  { name: "贵阳·甲秀楼", at: { lng: 106.716, lat: 26.5758 } },
  { name: "昆明·滇池", at: { lng: 102.6495, lat: 24.9759 } },
  { name: "南宁·邕江", at: { lng: 108.3348, lat: 22.7971 }, queue: 0 },
  {
    name: "桂林·漓江画山",
    at: { lng: 110.4859, lat: 24.9384 },
    queue: 270,
    line: "山壁上画了九匹马。怒骊看了好一会儿，不太服气。",
  },
  { name: "广州·天河", at: { lng: 113.319, lat: 23.1225 }, line: "这里叫天河。天河、明河，说的是同一条河。" },
  { name: "深圳·深圳湾", at: { lng: 113.965, lat: 22.5222 } },
  { name: "厦门·鼓浪屿", at: { lng: 118.0619, lat: 24.4475 } },
];

/** What he says at the stations without a line of their own, taking turns by the day */
export const STATION_LINES = ["路上帮人把车推上了坡，来晚了些。", "怒骊跑累了，今晚在这儿歇脚。", "这里的灯火，比上一站还亮。"];

/** His lines, word for word as Breeze approved them */
export const MINGHE_LINES = {
  sneaky: "这一下很轻，不过我察觉到了。管理员，一路可好？",
  bold: "管理员。来得正好，前面的路，一起走一段？",
  friend: "你给过我的答案，我一直记着。往后这一路，有我。",
  unfriend: "明白。路还长，想同行的时候，再叫我。",
  unfriendAsk: "解除和明河都尉的触须之交？他还会在各地走。",
  intro: "宏山科学院，明河。都尉这个头衔，在这里就不必提了。这些日子骑着怒骊四处走走，路上遇到要帮忙的，搭把手。",
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
  return stationOf(day).line ?? STATION_LINES[day % STATION_LINES.length];
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

export const rideLine = (stop: number) => `上来吧。今天在${stationName(stop)}，明天去${stationName(stop + 1)}。`;
export const dismountLine = (stop: number) => `就在${stationName(stop)}下吗？好，这里的灯火不错。`;
export const tripLine = (times: number) => `${RIDE_STOPS} 站走完了。这一路，你的克隆体被碰了 ${times} 次。辛苦了，我送你回去。`;

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
      return `${MINGHE_NAME}和你成为了触须之交：「${MINGHE_LINES.friend}」`;
    case "ride":
      return `你的克隆体跟上了${MINGHE_NAME}：「${rideLine(stop)}」`;
    case "dismount":
      return `你的克隆体在${stationName(stop)}下了马，${MINGHE_NAME}说：「${dismountLine(stop)}」`;
    case "trip":
      return `${MINGHE_NAME}送你的克隆体回来了：「${tripLine(item.times ?? 0)}」`;
    default:
      return `${MINGHE_NAME}回了你：「${item.bold ? MINGHE_LINES.bold : MINGHE_LINES.sneaky}」`;
  }
}

/** Their card for anyone who opens it: no games, UID, favourites or badges */
export const MINGHE_PROFILE = guideProfile(MINGHE);

/** His place on the map: today's station */
export function mingheRoach(day: number, friend: boolean): PublicRoach {
  return { id: MINGHE_ID, clone: false, avatar: MINGHE.avatar, color: MINGHE.color, friend, guide: true, ...stationOf(day).at };
}
