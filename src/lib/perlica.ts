import { fmt, sentences, T } from "@/i18n";
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
  get sneaky() {
    return T.lib.perlica.line.sneaky;
  },
  bold: (times: number) => fmt(T.lib.perlica.line.bold, { times }),
  get friend() {
    return T.lib.perlica.line.friend;
  },
  get unfriend() {
    return T.lib.perlica.line.unfriend;
  },
  get ask() {
    return T.lib.perlica.line.ask;
  },
  get declined() {
    return T.lib.perlica.line.declined;
  },
};

/** Time away, from the seconds each band starts at, and what she says in it (three lines each, one picked at random) */
const awayBands = (): [number, [string, string, string]][] => [
  [600, [T.lib.perlica.away.band1.line1, T.lib.perlica.away.band1.line2, T.lib.perlica.away.band1.line3]],
  [
    3600,
    [T.lib.perlica.away.band2.line1, T.lib.perlica.away.band2.line2, T.lib.perlica.away.band2.line3],
  ],
  [86400, [T.lib.perlica.away.band3.line1, T.lib.perlica.away.band3.line2, T.lib.perlica.away.band3.line3]],
  [259200, [T.lib.perlica.away.band4.line1, T.lib.perlica.away.band4.line2, T.lib.perlica.away.band4.line3]],
  [1209600, [T.lib.perlica.away.band5.line1, T.lib.perlica.away.band5.line2, T.lib.perlica.away.band5.line3]],
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
  const parts = [fmt(T.lib.perlica.time.minutes, { m }), fmt(T.lib.perlica.time.seconds, { s: s % 60 })];
  if (d || h) parts.unshift(fmt(T.lib.perlica.time.hours, { h }));
  if (d) parts.unshift(fmt(T.lib.perlica.time.days, { d }));
  return parts.join(" ");
}

/** What she says about a time away: how long, then the line picked for it */
export function awaySentence(seconds: number, line: number) {
  const lines = awayBands()[awayBand(seconds)][1];
  return fmt(T.lib.perlica.away.sentence, { time: formatAway(seconds), line: lines[Math.min(Math.max(0, Math.floor(line)), lines.length - 1)] });
}

// ---- her second step: jealousy, visiting, her birthday, the weight of missing you, anniversaries, the weekly report ----

/** Her lines from the second step, word for word as Breeze approved them */
export const PERLICA_MORE = {
  /** Jealous, when the only one touched before her today was 阿米娅向导 */
  get onlyAmiya() {
    return T.lib.perlica.more.onlyAmiya;
  },
  /** When you touched 阿米娅向导 today too, once a day either way round */
  get aside() {
    return T.lib.perlica.more.aside;
  },
  get birthdaySneaky() {
    return T.lib.perlica.more.birthdaySneaky;
  },
  get birthdayBold() {
    return T.lib.perlica.more.birthdayBold;
  },
  /** On her card while she keeps watch by your drunk main roach */
  get guarding() {
    return T.lib.perlica.more.guarding;
  },
  /** After 「你睡了 …。」, one picked at random */
  get slept() {
    return [T.lib.perlica.more.slept1, T.lib.perlica.more.slept2, T.lib.perlica.more.slept3];
  },
  /** As she rides her 鬼火 up to where your main roach moved, one picked at random */
  get bike() {
    return [T.lib.perlica.more.bike1, T.lib.perlica.more.bike2, T.lib.perlica.more.bike3];
  },
  /** How the weekly report ends, by the line kept with it */
  get weekEnds() {
    return [T.lib.perlica.more.weekEnds1, T.lib.perlica.more.weekEnds2, T.lib.perlica.more.weekEnds3];
  },
};

/** Jealous: you touched n others today before her */
export const jealousLine = (n: number) => fmt(T.lib.perlica.jealous, { n, rank: n + 1 });

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
export const formatKg = (kg: number) => (kg >= 1000 ? fmt(T.lib.perlica.tonnes, { t: (kg / 1000).toFixed(2) }) : `${kg.toFixed(1)} kg`);

/** Her lines about it, three to a band of time away as with her reports; {w} is the weight */
const weightLines = (): [string, string, string][] => [
  [T.lib.perlica.weight.band1.line1, T.lib.perlica.weight.band1.line2, T.lib.perlica.weight.band1.line3],
  [T.lib.perlica.weight.band2.line1, T.lib.perlica.weight.band2.line2, T.lib.perlica.weight.band2.line3],
  [
    T.lib.perlica.weight.band3.line1,
    T.lib.perlica.weight.band3.line2,
    T.lib.perlica.weight.band3.line3,
  ],
  [T.lib.perlica.weight.band4.line1, T.lib.perlica.weight.band4.line2, T.lib.perlica.weight.band4.line3],
  [
    T.lib.perlica.weight.band5.line1,
    T.lib.perlica.weight.band5.line2,
    T.lib.perlica.weight.band5.line3,
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
export const awayWithWeight = (seconds: number, line: number) => sentences(awaySentence(seconds, line), weightSentence(seconds));

/** 「你睡了 7 小时 3 分 2 秒。」 and one of her lines about it */
export const sleptSentence = (seconds: number, pick: number) =>
  fmt(T.lib.perlica.slept, { time: formatAway(seconds), line: PERLICA_MORE.slept[Math.abs(Math.floor(pick)) % PERLICA_MORE.slept.length] });

/** Which day of being 触须之交 again it is, by the device's clock from 04:00: the day they became so is day 1 */
export function friendDay(since: number, offsetMin: number, now = Date.now()) {
  return daysFromTo(deviceDay(offsetMin, since).day, deviceDay(offsetMin, now).day) + 1;
}

/** Days she marks: the 7th, 30th and 100th, and every whole year */
export const isAnniversary = (day: number) => day === 7 || day === 30 || day === 100 || (day > 0 && day % 365 === 0);

/** 一年, 两年 … 十年: 一 to 十; bigger numbers are written as digits, a space either side */
export function yearsWord(years: number) {
  const words = [T.lib.perlica.years.n1, T.lib.perlica.years.n2, T.lib.perlica.years.n3, T.lib.perlica.years.n4, T.lib.perlica.years.n5, T.lib.perlica.years.n6, T.lib.perlica.years.n7, T.lib.perlica.years.n8, T.lib.perlica.years.n9, T.lib.perlica.years.n10];
  return years <= words.length ? words[years - 1] : ` ${years} `;
}

/** What she says on one of those days */
export function anniversaryLine(day: number) {
  if (day < 365) return fmt(T.lib.perlica.anniversary.day, { day });
  const years = Math.floor(day / 365);
  const n = yearsWord(years);
  return fmt(T.lib.perlica.anniversary.years, { day, years: n });
}

/** Her weekly report: n others touched last week, m touches of her, and how it ends */
export function weekLine(n: number, m: number, line: number) {
  const end = PERLICA_MORE.weekEnds[Math.abs(Math.floor(line)) % PERLICA_MORE.weekEnds.length];
  if (n && !m) return fmt(T.lib.perlica.week.othersOnly, { n });
  if (!n) return fmt(T.lib.perlica.week.meOnly, { times: m, end });
  return fmt(T.lib.perlica.week.both, { n, times: m, end });
}

/** What one of hers in the inbox says, in her own words. */
export function perlicaText(item: Pick<PerlicaItem, "what" | "bold" | "seconds" | "line" | "times" | "others">) {
  if (item.what === "away") return fmt(T.lib.guides.says, { name: PERLICA.name, line: awayWithWeight(item.seconds ?? AWAY_REPORT_S, item.line ?? 0) });
  if (item.what === "week") return fmt(T.lib.guides.says, { name: PERLICA.name, line: weekLine(item.others ?? 0, item.times ?? 0, item.line ?? 0) });
  // what she said as you touched 阿米娅向导: not an answer to a touch of yours
  if (item.what === "aside" && item.line === 1) return fmt(T.lib.guides.says, { name: PERLICA.name, line: PERLICA_MORE.aside });
  const line = touchBackLine(item.what, item.bold, item.times, item.others, item.line);
  return item.bold ? fmt(T.lib.perlica.touchedBackBold, { name: PERLICA.name, line }) : fmt(T.lib.perlica.touchedBackSneaky, { name: PERLICA.name, line });
}

/** What ending it with her means; also the question before it */
export const perlicaUnfriend = () => T.lib.perlica.unfriendAsk;

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
