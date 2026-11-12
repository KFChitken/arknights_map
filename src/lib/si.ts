import { beijingDate, beijingMidnight } from "./beijing";
import { distanceKm } from "./geo";
import { GUIDES, guideProfile } from "./guides";
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
export const SI_NAME = SI.name;

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

/** Her lines, word for word as Breeze approved them; {…} are filled in by the page */
export const SI_LINES = {
  sneaky: ["谁在戳我？……哼，偷偷摸摸的，我早就看见了。", "鬼鬼祟祟的。想碰就大大方方地碰，我又不咬人。", "偷偷碰我？……才、才不是在等你。"],
  bold: ["干、干嘛突然这么大胆！……下不为例。", "哼，管理员总算想起我了？我可没在等你。", "墨都被你碰洒了！……算了，就原谅你这一次。"],
  away: "哟，还记得我啊？我还以为你又把我忘了。",
  longaway: "一百五十年都别想我理你！……好、好吧，就理你这一下。",
  night: "都几点了还不睡？再不睡，我就去告诉那位小监督。……才、才不是担心你。快去睡！",
  friend: "才、才不想和你交朋友呢！……这幅画是顺手画的，拿着。画的什么不重要，重要的是我的印。还有，不许再忘了我的名字！",
  unfriendAsk: "解除和祀掌柜的触须之交？画像和集章本都会留着。",
  unfriend: "走就走！……画像不用还，章也不用擦。哼。",

  portraitWrong: "等等！那张是我的自画像！……练笔用的！呆货，快还给我！",
  portraitReturn: "哼，算你识相。……给你的是这张。",
  portraitKeep: "你！……那、那就借你几天！不许给别人看！",
  stamp: [
    "顺手给你盖了个章：「{stamp}」。在我盖新的之前，不许擦掉。",
    "今天的章：「{stamp}」。……别、别多想，随手盖的。",
    "「{stamp}」。哼，就这个了，不满意也不换。",
  ],

  open: "哼，惹了麻烦，才想起来找我？",
  reopen: "刚才点开又走了？……当我没看见吗？",
  intro: "缘缘庄掌柜，祀。……别误会，我才不是来给管理员当向导的，出来找找灵感而已。要盖章就过来，别磨蹭。",
  nickname: "不许叫我小葱！……叫、叫一次就算了。",
  visitor: "没登录就想碰我？……先登录再说。",
  introCard: "缘缘庄开到地图上来了。……才、才不是请你来的。有空就来碰我一下，顺手给你盖个章。",
  find: "喏，就是这只。……我、我才没有一眼就认出来。",

  vacancy: "还有 {n} 间空房。……才、才不是特意给你留的。",
  in: "正好有空房，{room} 号。……来得巧而已，别得意。",
  queued: "客满了，门口排着去。……排队的路，我都给你画好了。",
  place: "你排在第 {n} 位，大概还要{wait}。……我才没有特意帮你算。",
  checkin: "排了{wait}，总算轮到你了。{room} 号房，就住半天。……被子是新晒的，才、才不是为你晒的。",
  checkout: "住够半天了，退房！……我、我才没有舍不得，是后面排着的人等急了。",
  out: "住过就别赖着了，在外面躺着吧。……还想住？那、那就再碰我一下，乖乖去后面排着。",
  again: "又来了？……哼，想住就去后面排着，我可不给你插队。",
  againIn: "又是你。{room} 号房，还是住半天。……我才没记得你上回睡的哪间。",
};

/** What she says when your stamps come to these many */
export const STAMP_MILESTONES: Record<number, string> = {
  7: "才七个？……还早着呢。",
  30: "三十种都被你集齐了？……哼，集章本盖满了，我再给你加几页。",
  100: "一百个……你就这么闲吗？……明、明天也来。",
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
  if (ms < HOUR) return "不到 1 小时";
  if (ms < DAY) return `${Math.ceil(ms / HOUR)} 小时`;
  return `${Math.round(ms / DAY)} 天`;
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
export const stayLine = (room: number, leftMs: number) => `${room} 号房，还能住${after(leftMs)}`;

/** One of hers in the inbox, in her own words: whole lines, then the stamp and what she adds about it */
export function siText(item: Pick<SiItem, "line" | "bold" | "variant" | "stamp" | "stamps" | "room" | "waited">) {
  const stamped = item.stamp !== null && item.stamps ? stampLine(item.stamp, item.stamps) : "";
  switch (item.line) {
    case "friend":
      return `${SI_NAME}和你成为了触须之交：「${SI_LINES.friend}」${stamped}`;
    case "checkin":
      return `${SI_NAME}：「${checkinLine(item.room ?? 0, item.waited ?? 0)}」`;
    case "again":
      return `${SI_NAME}：「${againInLine(item.room ?? 0)}」`;
    case "checkout":
      return `${SI_NAME}：「${SI_LINES.checkout}」`;
    default:
      return `${SI_NAME}回了你：「${answerLine(item.line, item.bold, item.variant)}」${stamped}`;
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
  0: "今天还没人来？……哼，正好清静。",
  1: "就这么几笔？……我、我是故意留白的。",
  2: "有点样子了。……才不是因为你们来了，我才画得顺。",
  3: "来的人还真不少。挤一挤吧，画里还画得下。",
  4: "……画完了。今天这张，勉强可以盖章。",
};

// ---- her card ----

/** Her card for anyone who opens it: no games, UID, favourites or badges */
export const SI_PROFILE = guideProfile(SI);

/** Her place on the map */
export function siRoach(friend: boolean): PublicRoach {
  return { id: SI_ID, clone: false, avatar: SI.avatar, color: SI.color, friend, guide: true, ...SI_AT };
}

/** Her family in the players' 厨力 lists (src/data/arknights-operators.json), each with what she says about them */
const FAMILY: { name: string; line: string }[] = [
  { name: "年", line: "年姐姐？……她打的东西倒是结实，就是人太吵。……她现在还好吗？" },
  { name: "夕", line: "夕姐姐的画？……比我的好那么一点点。就、就一点点！" },
  { name: "令", line: "令姐姐是不是又喝多了？……我才不担心。" },
  { name: "重岳", line: "大哥还天天练拳吗？……哼，我才不想他。" },
  { name: "黍", line: "黍姐姐种的东西？……我田里种的也不差。" },
  { name: "余", line: "你也认识余？……哼，我才没想哥哥们。……就一点点。" },
  { name: "望", line: "你也认识望？……哼，我才没想哥哥们。……就一点点。" },
];
/** Herself in an Endfield 厨力 list */
export const SELF_FAV_LINE = "你的厨力角色……是我？哼，眼光还算凑合。";
/** On the day 明河都尉 reaches 黄山, his 7th station */
export const MINGHE_HERE_LINE = "那个头发亮晃晃的小子今天跑到黄山来了，吵死了。……我才没有特意去看。";
/** Her own name in the Endfield list */
export const SI_OPERATOR = "祀";

/**
 * What she says about the player's 厨力 lists under her introduction: herself among their Endfield
 * ones; otherwise the first of her family in their Arknights list, in the order they put them.
 */
export function favouriteLine(fav: { arknights: string[]; endfield: string[] }) {
  if (fav.endfield.includes(SI_OPERATOR)) return SELF_FAV_LINE;
  for (const name of fav.arknights) {
    const kin = FAMILY.find((f) => f.name === name);
    if (kin) return kin.line;
  }
  return null;
}
