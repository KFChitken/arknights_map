import { fmt, T } from "@/i18n";
import { beijingDate, beijingMidnight } from "./beijing";
import { distanceKm } from "./geo";
import { GUIDES } from "./guides";
import { ROUTE } from "./minghe";
import { mulberry32, hash128 } from "./prng";
import type { LngLat } from "./types";
import type { PublicRoach, SiItem } from "./world/types";

/**
 * 祀掌柜: the fifth guide (src/lib/guides.ts), whom every player shares. She keeps
 * 缘缘庄 by 南湖 in 宏村, Anhui, with a scroll hanging beside her. Touch her and she
 * answers once a day, the same way you touched her, and stamps your 集章本 with one of
 * 30 闲章 while she is at it; the first bold touch makes you 触须之交 and gets you a
 * portrait (one time in ten she hands over her own by mistake). The first time a
 * player touches her she paints an ink roach of them (墨小强) that queues for a room in
 * 缘缘庄 (src/lib/siInn.ts). She never reaches out on her own.
 *
 * Everything she says is word for word as Breeze approved it: proud and a little prickly.
 */

export const SI = GUIDES.si;
export const SI_ID = SI.id;

export const isSiItem = (id: string) => id.startsWith(SI.prefix);

/** Where she stands: the north bank of 南湖, in front of 南湖书院 (WGS84) */
export const SI_AT: LngLat = { lng: 117.98417, lat: 30.00362 };
/** Flying to her stops here (MapLibre levels), close enough to tell the ink roaches apart */
export const SI_ZOOM = 17;
/** No show roaches this close to her, so none looks like it queues for her inn */
export const SI_BOT_FREE_KM = 1;
/** 明河都尉's station nearest her (src/lib/minghe.ts ROUTE: 黄山, twenty-odd km off); on his day there her card says so */
export const MINGHE_NEAR = ROUTE.reduce((best, s, i) => (distanceKm(s.at, SI_AT) < distanceKm(ROUTE[best].at, SI_AT) ? i : best), 0);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---- 墨小强 as one of the player's clones (src/lib/server/si.ts) ----

/** touches.to_slot of a touch on an ink roach (a roach's is 0 for the main one, 1 to MAX_CLONES for its clones) */
export const INK_SLOT = -1;
/** How an ink roach is touched: this, then its public id (src/lib/world/types.ts InkTap) */
export const INK_PREFIX = "ink:";
/** Declaring from it: this among the ids of the roaches it goes out from */
export const INK_FROM = "ink";
/** Recalled, it does not queue again for her touches this long after, so nobody holds a room by recalling and queuing over and over */
export const RECALL_REST_MS = 12 * HOUR;
/** 消息 shows at most this many more declarations, sent near 缘缘庄, while your ink roach is on the map there */
export const INK_DECLARATIONS = 20;

/** Her lines, word for word as Breeze approved them; {…} are filled in by the page */
export const SI_LINES = {
  get sneaky() {
    return [T.lib.si.line.sneaky1, T.lib.si.line.sneaky2, T.lib.si.line.sneaky3];
  },
  get bold() {
    return [T.lib.si.line.bold1, T.lib.si.line.bold2, T.lib.si.line.bold3];
  },
  get away() {
    return T.lib.si.line.away;
  },
  get longaway() {
    return T.lib.si.line.longAway;
  },
  get night() {
    return T.lib.si.line.night;
  },
  get friend() {
    return T.lib.si.line.friend;
  },
  get unfriendAsk() {
    return T.lib.si.line.unfriendAsk;
  },
  get unfriend() {
    return T.lib.si.line.unfriend;
  },

  get portraitWrong() {
    return T.lib.si.line.portraitWrong;
  },
  get portraitReturn() {
    return T.lib.si.line.portraitReturn;
  },
  get portraitKeep() {
    return T.lib.si.line.portraitKeep;
  },
  get stamp() {
    return [
      T.lib.si.line.stamp1,
      T.lib.si.line.stamp2,
      T.lib.si.line.stamp3,
    ];
  },

  get open() {
    return T.lib.si.line.open;
  },
  get reopen() {
    return T.lib.si.line.reopen;
  },
  get intro() {
    return T.lib.si.line.intro;
  },
  get nickname() {
    return T.lib.si.line.nickname;
  },
  get visitor() {
    return T.lib.si.line.visitor;
  },
  get introCard() {
    return T.lib.si.line.introCard;
  },
  get find() {
    return T.lib.si.line.find;
  },

  get vacancy() {
    return T.guides.si.freeRooms;
  },
  get in() {
    return T.lib.si.line.in;
  },
  get queued() {
    return T.lib.si.line.queued;
  },
  get place() {
    return T.lib.si.line.place;
  },
  get checkin() {
    return T.lib.si.line.checkin;
  },
  get checkout() {
    return T.lib.si.line.checkout;
  },
  get out() {
    return T.lib.si.line.out;
  },
  get again() {
    return T.lib.si.line.again;
  },
  get againIn() {
    return T.lib.si.line.againIn;
  },
  // someone else's ink roach lying outside, tapped; yours drawn while your clones were five, and held; yours recalled
  get thrownOut() {
    return T.lib.si.line.thrownOut;
  },
  get full() {
    return T.lib.si.line.full;
  },
  get held() {
    return T.lib.si.line.held;
  },
};

/** What she says when your stamps come to these many */
export const STAMP_MILESTONES: Record<number, string> = {
  get 7() {
    return T.lib.si.milestone7;
  },
  get 30() {
    return T.lib.si.milestone30;
  },
  get 100() {
    return T.lib.si.milestone100;
  },
};

/** Her 30 闲章, the last her own name; each player gets the first 29 in an order of their own */
export const STAMPS = [
  "勉强及格",
  "下不为例",
  "顺手而已",
  "才不是",
  "看你可怜",
  "就这一次",
  "别得意",
  "哼",
  "记账",
  "不许擦",
  "才没等",
  "别误会",
  "还凑合",
  "准了",
  "早该来了",
  "又迟到",
  "随便盖的",
  "墨还没干",
  "今日营业",
  "本店认证",
  "心情尚可",
  "不是想你",
  "算你识相",
  "小家伙",
  "有点意思",
  "不算太差",
  "赏你的",
  "呆货",
  "明天也行",
  "祀",
] as const;
export const STAMPS_PER_ROUND = STAMPS.length;

const orders = new Map<string, number[]>();
/** The order a player's first 29 stamps come in, every round: shuffled by their account, the same everywhere */
export function stampOrder(userId: string): number[] {
  let order = orders.get(userId);
  if (!order) {
    const rand = mulberry32(hash128(`si-stamps:${userId}`)[0]);
    order = Array.from({ length: STAMPS_PER_ROUND - 1 }, (_, i) => i);
    // Fisher–Yates
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (orders.size > 1000) orders.clear();
    orders.set(userId, order);
  }
  return order;
}

/** Which of STAMPS a player's k-th stamp is (k from 0): the round's 30th is always 「祀」 */
export function stampAt(userId: string, k: number): number {
  const place = k % STAMPS_PER_ROUND;
  return place === STAMPS_PER_ROUND - 1 ? STAMPS_PER_ROUND - 1 : stampOrder(userId)[place];
}

/**
 * Her line as she stamps (one of the three at random, the same every time for the same stamp, so 消息 can say it
 * again from what it keeps), and what she adds at 7, 30 and 100
 */
export function stampLine(stamp: number, stamps: number) {
  const pick = hash128(`si-stamp-line:${stamps}:${stamp}`)[0] % SI_LINES.stamp.length;
  const said = SI_LINES.stamp[pick].replace("{stamp}", STAMPS[stamp] ?? "");
  const more = STAMP_MILESTONES[stamps];
  return more ? `${said}${more}` : said;
}

// ---- the portraits ----

const DIGITS = "〇一二三四五六七八九";
/** 1–31 as written in a date: 十一, 二十, 三十一 */
function tens(n: number) {
  if (n < 10) return DIGITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return `${t > 1 ? DIGITS[t] : ""}十${u ? DIGITS[u] : ""}`;
}
/** A day as written down the side of a painting: 二〇二六年十一月十一日 (this device's date) */
export function chineseDate(at: number) {
  const d = new Date(at);
  const year = [...String(d.getFullYear())].map((c) => DIGITS[Number(c)]).join("");
  return `${year}年${tens(d.getMonth() + 1)}月${tens(d.getDate())}日`;
}

/** What is written on your portrait: your name as the map shows it, or 管理员 for the anonymous and the nameless */
export const portraitTitle = (name: string | null) => `${name?.trim() || "管理员"}小像`;

// ---- which line she answers with ----

export type SiLine = SiItem["line"];
/** Two to fourteen days away (a 触须之交's) and the small hours on their device, as she answers */
export const AWAY_MS = 3 * DAY;
export const LONG_AWAY_MS = 14 * DAY;

/** The hour on the player's device (0–23), from the time zone the page sends; Beijing without one */
export function deviceHour(offsetMin: unknown, now: number) {
  const n = Number(offsetMin);
  const offset = Number.isFinite(n) ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(n))) : -480;
  return new Date(now - offset * 60_000).getUTCHours();
}

/**
 * How she answers a touch, the first that fits: it made you 触须之交; a 触须之交 who last touched
 * her 14 days ago or more, or 3; between midnight and five on your device; or as usual.
 */
export function answerKind({
  newFriend,
  friend,
  last,
  now,
  hour,
}: {
  newFriend: boolean;
  friend: boolean;
  /** Their touch of her before this one, if any */
  last: number | null;
  now: number;
  hour: number;
}): Extract<SiLine, "friend" | "longaway" | "away" | "night" | "touch"> {
  if (newFriend) return "friend";
  if (friend && last !== null && now - last >= LONG_AWAY_MS) return "longaway";
  if (friend && last !== null && now - last >= AWAY_MS) return "away";
  if (hour < 5) return "night";
  return "touch";
}

/** Her whole answer to a touch */
export function answerLine(line: SiLine, bold: boolean, variant: number | null) {
  switch (line) {
    case "friend":
      return SI_LINES.friend;
    case "longaway":
      return SI_LINES.longaway;
    case "away":
      return SI_LINES.away;
    case "night":
      return SI_LINES.night;
    default: {
      const lines = bold ? SI_LINES.bold : SI_LINES.sneaky;
      return lines[(variant ?? 0) % lines.length];
    }
  }
}

/** All a speech bubble has room for: the first sentence, to its first full stop, ! or ? in any language */
export function firstSentence(line: string) {
  const m = /^.*?\p{Sentence_Terminal}/u.exec(line);
  return m ? m[0] : line;
}

// ---- how long ----

/** 「不到 1 小时」, 「{h} 小时」 rounded up, or 「{d} 天」 rounded */
export function howLong(ms: number) {
  if (ms < HOUR) return T.lib.si.howLong.underAnHour;
  if (ms < DAY) return fmt(T.lib.si.howLong.hours, { n: Math.ceil(ms / HOUR) });
  return fmt(T.lib.si.howLong.days, { n: Math.round(ms / DAY) });
}
/** A length of time after a word, with the space a number gets: 「排了 3 小时」, 「排了不到 1 小时」 */
const after = (ms: number) => {
  const d = howLong(ms);
  return /^\d/.test(d) ? ` ${d}` : d;
};

export const vacancyLine = (free: number) => SI_LINES.vacancy.replace("{n}", free.toLocaleString());
export const inLine = (room: number) => SI_LINES.in.replace("{room}", String(room));
export const placeLine = (place: number, waitMs: number) =>
  SI_LINES.place.replace("{n}", place.toLocaleString()).replace("{wait}", after(waitMs));
export const checkinLine = (room: number, waitedMin: number) =>
  waitedMin > 0 ? SI_LINES.checkin.replace("{wait}", after(waitedMin * 60_000)).replace("{room}", String(room)) : inLine(room);
export const againInLine = (room: number) => SI_LINES.againIn.replace("{room}", String(room));
/** What the card says about your room while you stay (the site's words, not hers) */
export const stayLine = (room: number, leftMs: number) => fmt(T.lib.si.stay, { room, left: after(leftMs) });

/** One of hers in the inbox, in her own words: whole lines, then the stamp and what she adds about it */
export function siText(item: Pick<SiItem, "line" | "bold" | "variant" | "stamp" | "stamps" | "room" | "waited">) {
  const stamped = item.stamp !== null && item.stamps ? stampLine(item.stamp, item.stamps) : "";
  switch (item.line) {
    case "friend":
      return fmt(T.lib.si.text.friend, { name: SI.name, line: SI_LINES.friend, stamped });
    case "checkin":
      return fmt(T.lib.guides.says, { name: SI.name, line: checkinLine(item.room ?? 0, item.waited ?? 0) });
    case "again":
      return fmt(T.lib.guides.says, { name: SI.name, line: againInLine(item.room ?? 0) });
    case "checkout":
      return fmt(T.lib.guides.says, { name: SI.name, line: SI_LINES.checkout });
    default:
      return fmt(T.lib.si.text.answered, { name: SI.name, line: answerLine(item.line, item.bold, item.variant), stamped });
  }
}

// ---- 今天的画 ----

/** Her painting's day, the same for everyone: Beijing time, turning at 04:00 */
export const paintingDay = (now: number) => beijingDate(now - 4 * HOUR);
/** When today's painting began */
export const paintingStart = (now: number) => beijingMidnight(paintingDay(now)) + 4 * HOUR;

export type PaintingTier = 0 | 1 | 2 | 3 | 4;
/** How far today's painting has got by how many players touched her today: a blank sheet, then four tiers */
export const paintingTier = (n: number): PaintingTier => (n <= 0 ? 0 : n <= 1000 ? 1 : n <= 5000 ? 2 : n <= 10000 ? 3 : 4);
/** What she says about it on her card */
export const PAINTING_LINES: Record<PaintingTier, string> = {
  get 0() {
    return T.lib.si.painting.tier0;
  },
  get 1() {
    return T.lib.si.painting.tier1;
  },
  get 2() {
    return T.lib.si.painting.tier2;
  },
  get 3() {
    return T.lib.si.painting.tier3;
  },
  get 4() {
    return T.lib.si.painting.tier4;
  },
};

// ---- her card ----

/** Her place on the map */
export function siRoach(friend: boolean): PublicRoach {
  return { id: SI_ID, clone: false, avatar: SI.avatar, color: SI.color, friend, guide: true, ...SI_AT };
}

/** Her family in the players' 厨力 lists (src/data/arknights-operators.json), each with what she says about them */
const FAMILY: { name: string; line: string }[] = [
  {
    name: "年",
    get line() {
      return T.lib.si.family.nian;
    },
  },
  {
    name: "夕",
    get line() {
      return T.lib.si.family.xi;
    },
  },
  {
    name: "令",
    get line() {
      return T.lib.si.family.ling;
    },
  },
  {
    name: "重岳",
    get line() {
      return T.lib.si.family.chongyue;
    },
  },
  {
    name: "黍",
    get line() {
      return T.lib.si.family.shu;
    },
  },
  {
    name: "余",
    get line() {
      return T.lib.si.family.yu;
    },
  },
  {
    name: "望",
    get line() {
      return T.lib.si.family.wang;
    },
  },
];
/** On the day 明河都尉 reaches 黄山, his 7th station */
export const mingheHereLine = () => T.lib.si.mingheHere;
/** Her own name in the Endfield list */
export const SI_OPERATOR = "祀";

/**
 * What she says about the player's 厨力 lists under her introduction: herself among their Endfield
 * ones; otherwise the first of her family in their Arknights list, in the order they put them.
 */
export function favouriteLine(fav: { arknights: string[]; endfield: string[] }) {
  if (fav.endfield.includes(SI_OPERATOR)) return T.lib.si.selfFav;
  for (const name of fav.arknights) {
    const kin = FAMILY.find((f) => f.name === name);
    if (kin) return kin.line;
  }
  return null;
}
