import { GUIDES, guideProfile } from "./guides";
import type { LngLat } from "./types";
import type { PerlicaItem, PublicRoach } from "./world/types";

/**
 * 佩丽卡监督: the second guide roach (src/lib/guides.ts). Unlike 阿米娅向导 she
 * lives nowhere in particular: each player's page puts her somewhere within a
 * kilometre of their own main roach, for them alone, and the server never
 * knows where. Touch her and she touches back the same way; touch her boldly
 * and you are 触须之交. Once the player says yes to her 离开计时, the server
 * keeps the last moment they were looking at the site, and on their return she
 * tells them how long they were gone, to the second (src/lib/server/perlica.ts).
 * She always says 管理员.
 */

export const PERLICA = GUIDES.perlica;
export const PERLICA_ID = PERLICA.id;
export const PERLICA_NAME = PERLICA.name;

export const isPerlicaItem = (id: string) => id.startsWith(PERLICA.prefix);

/** Away at least this long (seconds), she says how long */
export const AWAY_REPORT_S = 600;
/** Her latest reports of time away each player keeps */
export const AWAY_KEPT = 5;

/** Her lines, word for word as Breeze approved them (… is two of 「…」, unlike Amiya's three dots) */
export const PERLICA_LINES = {
  sneaky: "……刚才那一下是管理员吧。不用偷偷的，我认得出来。",
  bold: (times: number) => `管理员主动碰我了。今天第 ${times} 次，我记下了。`,
  friend: "好，记下了。……以后不许再一声不吭地走掉。",
  unfriend: "……收到。我还在这里，你随时可以回来。",
  ask: "从现在起，管理员每次离开，我都会记下来。……可以吗？",
  declined: "……好。想让我记的时候，再跟我说。",
};

/** Time away, from the seconds each band starts at, and what she says in it (three lines each, one picked at random) */
const AWAY_BANDS: [number, [string, string, string]][] = [
  [600, ["……我没有在数，是计时器自己在走。", "我也刚好忙完，不算在等你。", "下次出门，管理员可以先跟我说一声。"]],
  [
    3600,
    ["监督的工作早就做完了，剩下的时间都在等你。", "通讯我看了好几次。……例行检查而已。", "管理员不在的时候，帝江号一切正常。……我也正常。"],
  ],
  [86400, ["饭我照常吃了，就是吃不出味道。", "我没有不高兴。……只是想确认你没事。", "这两天的风景我先替你看了，下次一起去。"]],
  [259200, ["这一次，我每一秒都记着。", "你不在的这几天，我一直守在你的蟑螂附近。", "我没有生气。……下次别走这么久了，好吗？"]],
  [1209600, ["你又睡了好久。上次是十年，我也等过来了。", "我一直算着，你一定会回来。……你看，算对了。", "很久，但还不算最久。我等过更久的。"]],
];

/** Lines to pick from in each band */
export const AWAY_LINES = AWAY_BANDS[0][1].length;

/** Which band a time away falls in, 0 (10 minutes to an hour) to 4 (two weeks or more) */
export function awayBand(seconds: number) {
  let band = 0;
  AWAY_BANDS.forEach(([from], i) => {
    if (seconds >= from) band = i;
  });
  return band;
}

/** 2 天 3 小时 14 分 27 秒: from the largest unit there is, then every one after it, zeros included */
export function formatAway(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [`${m} 分`, `${s % 60} 秒`];
  if (d || h) parts.unshift(`${h} 小时`);
  if (d) parts.unshift(`${d} 天`);
  return parts.join(" ");
}

/** What she says about a time away: how long, then the line picked for it */
export function awaySentence(seconds: number, line: number) {
  const lines = AWAY_BANDS[awayBand(seconds)][1];
  return `${formatAway(seconds)}。${lines[Math.min(Math.max(0, Math.floor(line)), lines.length - 1)]}`;
}

/** What she says when she touches back: as a new 触须之交, boldly (the how-manieth today), or sneakily */
export function touchBackLine(what: "touch" | "friend", bold: boolean, times: number | null) {
  if (what === "friend") return PERLICA_LINES.friend;
  return bold ? PERLICA_LINES.bold(times ?? 1) : PERLICA_LINES.sneaky;
}

/** What one of hers in the inbox says, in her own words. */
export function perlicaText(item: Pick<PerlicaItem, "what" | "bold" | "seconds" | "line" | "times">) {
  if (item.what === "away") return `${PERLICA_NAME}：「${awaySentence(item.seconds ?? AWAY_REPORT_S, item.line ?? 0)}」`;
  const line = touchBackLine(item.what, item.bold, item.times);
  return item.bold ? `${PERLICA_NAME}大胆地碰回来了：「${line}」` : `${PERLICA_NAME}偷偷碰回来了：「${line}」`;
}

/** What ending it with her means; also the question before it */
export const PERLICA_UNFRIEND = "解除后佩丽卡还在你附近，离开计时照常；想让她不再计时，去「资料」里关掉。";

/** Nearest and furthest she stands from the main roach, in metres */
export const NEAR_M = 100;
export const FAR_M = 1000;
const M_PER_DEG = 111_320;

/**
 * Where she stands around a main roach, for two numbers u and v in [0, 1): spread
 * evenly over the ring NEAR_M to FAR_M away from it. On land or water alike.
 */
export function spotNear(main: LngLat, u: number, v: number): LngLat {
  const r = Math.sqrt(u * (FAR_M ** 2 - NEAR_M ** 2) + NEAR_M ** 2);
  const angle = 2 * Math.PI * v;
  return {
    lng: main.lng + (r * Math.sin(angle)) / (M_PER_DEG * Math.cos((main.lat * Math.PI) / 180)),
    lat: main.lat + (r * Math.cos(angle)) / M_PER_DEG,
  };
}

/** Her card for anyone who opens it: no games, UID, favourites or badges */
export const PERLICA_PROFILE = guideProfile(PERLICA);

export function perlicaRoach(at: LngLat, friend: boolean): PublicRoach {
  return { id: PERLICA_ID, clone: false, avatar: PERLICA.avatar, color: PERLICA.color, friend, guide: true, ...at };
}
