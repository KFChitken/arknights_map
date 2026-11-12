import { daysFromTo, deviceDay } from "./deviceDay";
import { GUIDES } from "./guides";
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
const awayBands = (): [number, [string, string, string]][] => [
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
export const AWAY_LINES = 3;

/** Which band a time away falls in, 0 (10 minutes to an hour) to 4 (two weeks or more) */
export function awayBand(seconds: number) {
  let band = 0;
  awayBands().forEach(([from], i) => {
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
  const lines = awayBands()[awayBand(seconds)][1];
  return `${formatAway(seconds)}。${lines[Math.min(Math.max(0, Math.floor(line)), lines.length - 1)]}`;
}

// ---- her second step: jealousy, visiting, her birthday, the weight of missing you, anniversaries, the weekly report ----

/** Her lines from the second step, word for word as Breeze approved them */
export const PERLICA_MORE = {
  /** Jealous, when the only one touched before her today was 阿米娅向导 */
  onlyAmiya: "……先去罗德岛了啊。没关系，我排第二也会等。",
  /** When you touched 阿米娅向导 today too, once a day either way round */
  aside: "罗德岛那位……我知道。",
  birthdaySneaky: "……今天是我的生日。管理员偷偷来，我也认得出来。",
  birthdayBold: "今天是我的生日。……管理员来了，我很高兴。",
  /** On her card while she keeps watch by your drunk main roach */
  guarding: "你醉倒了，她在旁边守着，等你醒。",
  /** After 「你睡了 …。」, one picked at random */
  slept: ["我一直在旁边，没走开。", "你睡着的时候我一直数着，一秒都没漏。", "……下次喝之前，先跟我说一声。"],
  /** As she rides her 鬼火 up to where your main roach moved, one picked at random */
  bike: ["油门拧到底，总算追上了。", "管理员搬家也不说一声。……还好我车快。", "新地方有点远，不过对我的车来说不算什么。"],
  /** How the weekly report ends, by the line kept with it */
  weekEnds: ["……数据我都核对过了。", "……这周也拜托了，管理员。", "……下周的，我也会好好记着。"],
};

/** Jealous: you touched n others today before her */
export const jealousLine = (n: number) => `今天你碰了 ${n} 只蟑螂，我是第 ${n + 1} 个。`;

/** 3 月 16 日, Beijing time, until 04:00 the next morning, every year */
export function perlicaBirthday(now = Date.now()) {
  const d = new Date(now + 8 * 3_600_000);
  const [month, day, hour] = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours()];
  return month === 3 && (day === 16 || (day === 17 && hour < 4));
}

/** What she says as she touches back: one line, the first that fits of new 触须之交, birthday, jealous, visiting, then the usual */
export function touchBackLine(
  what: "touch" | "friend" | "jealous" | "aside" | "birthday",
  bold: boolean,
  times: number | null,
  others: number | null = null,
  line: number | null = null,
) {
  switch (what) {
    case "friend":
      return PERLICA_LINES.friend;
    case "birthday":
      return bold ? PERLICA_MORE.birthdayBold : PERLICA_MORE.birthdaySneaky;
    case "jealous":
      return line === 1 ? PERLICA_MORE.onlyAmiya : jealousLine(others ?? 1);
    case "aside":
      return PERLICA_MORE.aside;
    default:
      return bold ? PERLICA_LINES.bold(times ?? 1) : PERLICA_LINES.sneaky;
  }
}

/** The weight of missing you: a kilogram every five hours, to 0.1 kg, never less than 0.1 kg */
export const missKg = (seconds: number) => Math.max(0.1, Math.round(seconds / 1800) / 10);

/** 「4.7 kg」, or 「1.04 吨」 from a tonne on */
export const formatKg = (kg: number) => (kg >= 1000 ? `${(kg / 1000).toFixed(2)} 吨` : `${kg.toFixed(1)} kg`);

/** Her lines about it, three to a band of time away as with her reports; {w} is the weight */
const weightLines = (): [string, string, string][] => [
  ["这次只攒了 {w} 的思念，轻轻的，一点也不重。", "{w}。这点思念不算重。……真的不算。", "才 {w}。这么轻的思念，我一只手就拿得动。"],
  ["这次攒了 {w} 重重的思念，你终于回来了。", "{w} 的思念，开始有点重了。我先替你收着。", "攒到 {w} 了。……不重，我还拿得动。"],
  [
    "这次攒了 {w} 的思念，重得我一个人抱不动，你来了正好。",
    "{w} 重的思念，压得帝江号都往下沉了一点。",
    "思念攒到 {w}，有点重。……不过你回来了，就轻多了。",
  ],
  ["这次攒了 {w} 的思念。很重，可我一直没放下。", "{w}。思念太重的时候，我就去你的蟑螂附近坐一会儿。", "{w} 重的思念，我每天都抱着它等你。"],
  [
    "这次攒了 {w} 的思念。上次攒了十年，比这重得多，我也扛过来了。",
    "{w} 的思念，重到秤都快放不下了。……没关系，你回来就好。",
    "思念有 {w} 重了。不过你一回来，就一点都不重了。",
  ],
];

/** What she says about the weight of a time away: the same line every time for the same seconds */
export function weightSentence(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const w = formatKg(missKg(s));
  // 「1.04 吨的思念」: no space after 吨, as after kg
  return weightLines()[awayBand(s)][s % 3].replace("{w}", w).replace("吨 ", "吨");
}

/** Her report of a time away, then its weight */
export const awayWithWeight = (seconds: number, line: number) => `${awaySentence(seconds, line)}${weightSentence(seconds)}`;

/** 「你睡了 7 小时 3 分 2 秒。」 and one of her lines about it */
export const sleptSentence = (seconds: number, pick: number) =>
  `你睡了 ${formatAway(seconds)}。${PERLICA_MORE.slept[Math.abs(Math.floor(pick)) % PERLICA_MORE.slept.length]}`;

/** Which day of being 触须之交 again it is, by the device's clock from 04:00: the day they became so is day 1 */
export function friendDay(since: number, offsetMin: number, now = Date.now()) {
  return daysFromTo(deviceDay(offsetMin, since).day, deviceDay(offsetMin, now).day) + 1;
}

/** Days she marks: the 7th, 30th and 100th, and every whole year */
export const isAnniversary = (day: number) => day === 7 || day === 30 || day === 100 || (day > 0 && day % 365 === 0);

/** 一年, 两年 … 十年: 一 to 十; bigger numbers are written as digits, a space either side */
export function yearsWord(years: number) {
  const words = ["一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
  return years <= words.length ? words[years - 1] : ` ${years} `;
}

/** What she says on one of those days */
export function anniversaryLine(day: number) {
  if (day < 365) return `今天是我们再次相遇的第 ${day} 天。……我没有特意记，是日历提醒的。`;
  const years = Math.floor(day / 365);
  const n = yearsWord(years);
  return `今天是我们再次相遇的第 ${day} 天。……上次我等了十年，这次我们一起过了${n}年。`;
}

/** Her weekly report: n others touched last week, m touches of her, and how it ends */
export function weekLine(n: number, m: number, line: number) {
  const end = PERLICA_MORE.weekEnds[Math.abs(Math.floor(line)) % PERLICA_MORE.weekEnds.length];
  if (n && !m) return `监督周报：上周你碰了 ${n} 只蟑螂。……碰我的次数是 0。这一项，下周记得补上。`;
  if (!n) return `监督周报：上周你谁都没碰，只碰了我，一共 ${m} 次。${end}`;
  return `监督周报：上周你碰了 ${n} 只蟑螂，碰了我 ${m} 次。${end}`;
}

/** What one of hers in the inbox says, in her own words. */
export function perlicaText(item: Pick<PerlicaItem, "what" | "bold" | "seconds" | "line" | "times" | "others">) {
  if (item.what === "away") return `${PERLICA.name}：「${awayWithWeight(item.seconds ?? AWAY_REPORT_S, item.line ?? 0)}」`;
  if (item.what === "week") return `${PERLICA.name}：「${weekLine(item.others ?? 0, item.times ?? 0, item.line ?? 0)}」`;
  // what she said as you touched 阿米娅向导: not an answer to a touch of yours
  if (item.what === "aside" && item.line === 1) return `${PERLICA.name}：「${PERLICA_MORE.aside}」`;
  const line = touchBackLine(item.what, item.bold, item.times, item.others, item.line);
  return item.bold ? `${PERLICA.name}大胆地碰回来了：「${line}」` : `${PERLICA.name}偷偷碰回来了：「${line}」`;
}

/** What ending it with her means; also the question before it */
export const perlicaUnfriend = () => "解除后佩丽卡还在你附近，离开计时照常；想让她不再计时，去「资料」里关掉。";

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


export function perlicaRoach(at: LngLat, friend: boolean): PublicRoach {
  return { id: PERLICA_ID, clone: false, avatar: PERLICA.avatar, color: PERLICA.color, friend, guide: true, ...at };
}
