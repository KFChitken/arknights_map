import { fmt, T } from "@/i18n";
import { beijingDate } from "@/lib/beijing";
import { CITIES, NOTE_KINDS, type CityId, type NoteKind } from "@/lib/dashboard";
import { declarationText, DRUNK_TEMPLATES, isReaction, isStayTemplate, REACTIONS, replyOf, STAY_TEMPLATES, TEMPLATES, type Declaration } from "@/lib/declarations";
import { EVENTS } from "@/lib/events";
import { GESTURE_NAMES } from "@/lib/friendly";

/**
 * The words 数据看板 (Dashboard.tsx) puts on the codes the server counts by (src/lib/dashboard.ts): cities, what
 * 触须之交 do, sentences and replies, looks and colours. The site's own words where it has them, so they read as the
 * players see them, with ___ where a player fills in.
 */

// ---- numbers, days and times, as the board writes them (Beijing time) ----

/** 1,234 */
export const num = (n: number) => Math.round(n).toLocaleString("en-US");
/** 38% */
export const pct = (x: number) => `${Math.round(x * 100)}%`;
/** A milestone's count: 「1 万」, 「20 万」 */
export const wan = (n: number) => (n >= 10_000 && n % 1_000 === 0 ? `${n / 10_000} 万` : num(n));

const WEEKDAYS = "日一二三四五六";
const monthDay = (day: string) => day.split("-").slice(1).map(Number);
/** 「11/13」 */
export const dayShort = (day: string) => monthDay(day).join("/");
/** 「11月13日」 */
export const dayWords = (day: string) => {
  const [m, d] = monthDay(day);
  return `${m}月${d}日`;
};
/** 「11月13日 周五」 */
export const dayLong = (day: string) => `${dayWords(day)} 周${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}`;
/** A moment's Beijing time of day: 「21:40」 */
export const clock = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(11, 16);
/** The hour of a moment, Beijing time: 0–23 */
export const hourOf = (t: number) => new Date(t + 8 * 3_600_000).getUTCHours();
/** 「11月10日 15:12」 */
export const momentWords = (t: number) => `${dayWords(beijingDate(t))} ${clock(t)}`;

export const CITY_NAMES: Record<CityId, string> = {
  shanghai: "上海",
  beijing: "北京",
  guangzhou: "广州",
  shenzhen: "深圳",
  chengdu: "成都",
  hangzhou: "杭州",
  chongqing: "重庆",
  wuhan: "武汉",
  nanjing: "南京",
  xian: "西安",
  tianjin: "天津",
  suzhou: "苏州",
  changsha: "长沙",
  zhengzhou: "郑州",
  shenyang: "沈阳",
  qingdao: "青岛",
  jinan: "济南",
  hefei: "合肥",
  fuzhou: "福州",
  xiamen: "厦门",
  kunming: "昆明",
  harbin: "哈尔滨",
  dalian: "大连",
  nanning: "南宁",
  hongkong: "香港",
  taipei: "台北",
  tokyo: "东京",
  seoul: "首尔",
  singapore: "新加坡",
  kualalumpur: "吉隆坡",
  sydney: "悉尼",
  losangeles: "洛杉矶",
  newyork: "纽约",
  london: "伦敦",
};

export const cityName = (id: string) => (Object.hasOwn(CITY_NAMES, id) ? CITY_NAMES[id as CityId] : id);
export const cityIds = () => CITIES.map((c) => c.id);

/** What 触须之交 did for each other, as the board ranks it: the two kinds of adding in a game as one */
export type Act = Exclude<NoteKind, "gameAsk" | "gameWant"> | "game";
export const ACT_KINDS: Record<Act, NoteKind[]> = {
  hug: ["hug"],
  highfive: ["highfive"],
  luck: ["luck"],
  sanity: ["sanity"],
  visit: ["visit"],
  blanket: ["blanket"],
  water: ["water"],
  game: ["gameAsk", "gameWant"],
};
export function actName(act: Act) {
  switch (act) {
    case "sanity":
      return "催理智";
    case "visit":
      return "串门";
    case "game":
      return "加游戏好友";
    default:
      return GESTURE_NAMES[act];
  }
}
/** Every kind counted is in one act */
export const actsCover = () => new Set(Object.values(ACT_KINDS).flat()).size === NOTE_KINDS.length;

const BLANK = "___";
/** A blank next to a Chinese character gets a space, as 「我永远喜欢 ___」 */
const spaced = (s: string) => s.replace(/(\p{Script=Han}|[A-Za-z0-9])___/gu, "$1 ___").replace(/___(\p{Script=Han}|[A-Za-z0-9])/gu, "___ $1");

/** A sentence with nothing filled in, for its replies' words */
const blankOf = (template: string) =>
  ({ template, game: "arknights", character: BLANK, title: BLANK, name: BLANK, food: BLANK, spouse: "老婆", line: "" }) as unknown as Declaration;

/** A sentence (declarations.template) in words, ___ where the player fills in */
export function templateWords(template: string): string {
  const x = T.lib.declarations.text;
  const drunk = (DRUNK_TEMPLATES as readonly string[]).includes(template) ? "（醉酒限定）" : "";
  const stay = isStayTemplate(template) ? "（住过缘缘庄才能发）" : "";
  switch (template) {
    case "launch":
      return spaced(fmt(x.launch, { game: BLANK }));
    case "iam":
      return spaced(fmt(x.iam, { character: BLANK, title: BLANK }));
    case "love":
    case "buff":
    case "canyou":
      return spaced(fmt(x[template], { character: BLANK }));
    case "myname":
      return spaced(fmt(x.myname, { name: BLANK, game: BLANK }));
    case "welcome":
      return spaced(fmt(x.welcome, { name: BLANK }));
    case "eat":
      return spaced(fmt(x.eat, { character: BLANK, food: BLANK }));
    case "alsoplay":
      return spaced(fmt(x.alsoplay, { game: BLANK }));
    case "drunklove":
      return spaced(fmt(x.drunklove, { character: BLANK })) + drunk;
    case "kr168":
      return spaced(fmt(x.kr168, { character: BLANK, spouse: "老婆" })) + drunk;
    case "event":
      return "限定宣言（几句合起来算）";
    default:
      if ([...TEMPLATES, ...DRUNK_TEMPLATES, ...STAY_TEMPLATES].includes(template as never)) {
        return declarationText(blankOf(template)) + drunk + stay;
      }
      return template;
  }
}

/** A reply (declaration_reactions.reaction) in words, ___ where the sentence's own words go */
export function replyWords(id: string): string {
  if (isReaction(id)) return REACTIONS[id];
  const dot = id.lastIndexOf(".");
  const key = dot > 0 ? id.slice(0, dot) : id;
  const n = Number(id.slice(dot + 1));
  if ([...TEMPLATES, ...DRUNK_TEMPLATES, ...STAY_TEMPLATES].includes(key as never)) {
    const r = replyOf(blankOf(key), id);
    if (r) return spaced(r.text);
  }
  // a limited line's own, by its replyKey (or id)
  for (const e of EVENTS) {
    for (const l of e.lines) {
      if ((l.replyKey ?? l.id) === key && l.replies && l.replies[n - 1]) return `${l.replies[n - 1]}（限定宣言的）`;
    }
  }
  return id;
}

export const GAME_PARTS = [
  { key: "arknights", name: "只玩明日方舟" },
  { key: "both", name: "两个都玩" },
  { key: "endfield", name: "只玩终末地" },
  { key: "none", name: "没填" },
] as const;

export const avatarName = (a: string) => (T.profile.avatar as Record<string, string>)[a] ?? a;
export const colorName = (c: string) => (T.profile.color as Record<string, string>)[c] ?? c;
