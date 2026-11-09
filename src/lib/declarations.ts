import { findLine } from "./events";
import { GAME_NAMES, type Game } from "./games";

/** 我想吃<角色>的<食物> */
export const FOODS = ["靴子泡面", "玉族配饭", "脚夹馍"] as const;
export type Food = (typeof FOODS)[number];

/** 氪了168，<角色>老婆/老公回家家 */
export const SPOUSES = ["老婆", "老公"] as const;
export type Spouse = (typeof SPOUSES)[number];

/** What players call themselves in 欢迎回家，<称呼> */
export const WELCOME_NAMES: Record<Game, string> = { arknights: "刀客塔", endfield: "管理员" };

/**
 * A declaration is always one of a few fixed sentences with blanks picked from
 * lists. `name` in 「我是<名字>，我要玩…」 is filled in by the server from the
 * sender's profile. "event" is a limited-time line from events.ts. "alsoplay"
 * can no longer be sent, but older ones still show. The DRUNK_TEMPLATES can only be
 * sent while your main roach lies drunk (摄入酒精).
 */
export type Declaration =
  | { template: "launch"; game: Game }
  | { template: "iam"; character: string; title: string }
  | { template: "love"; character: string }
  | { template: "buff"; character: string }
  | { template: "myname"; game: Game; name?: string }
  | { template: "welcome"; game: Game }
  | { template: "canyou"; character: string }
  | { template: "eat"; character: string; food: Food }
  | { template: "birthday" }
  | { template: "event"; line: string }
  | { template: "alsoplay"; game: Game }
  | { template: "water" }
  | { template: "drunklove"; character: string }
  | { template: "kr168"; character: string; spouse: Spouse }
  | { template: "radar" }
  | { template: "roguelike" }
  | { template: "xianshu" }
  | { template: "rental" };

export type Template = Declaration["template"];

/** The ones a player can always send, in the order the sheet lists them; events come on top while they are on. */
export const TEMPLATES = ["launch", "iam", "love", "buff", "myname", "welcome", "canyou", "eat", "birthday"] as const;

/** What a drunk roach says on top of those, in the order the sheet lists them */
export const DRUNK_TEMPLATES = ["water", "drunklove", "kr168", "radar", "roguelike", "xianshu", "rental"] as const;
export const isDrunkTemplate = (t: unknown) => (DRUNK_TEMPLATES as readonly unknown[]).includes(t);

export function declarationText(d: Declaration): string {
  switch (d.template) {
    case "launch":
      return `${GAME_NAMES[d.game]}，启动！`;
    case "iam":
      return `我是${d.character}的${d.title}`;
    case "love":
      return `我永远喜欢${d.character}`;
    case "buff":
      return `加强${d.character}`;
    case "myname":
      return `我是${d.name ?? "……"}，我要玩${GAME_NAMES[d.game]}`;
    case "welcome":
      return `欢迎回家，${WELCOME_NAMES[d.game]}`;
    case "canyou":
      return `${d.character}做得到吗？`;
    case "eat":
      return `我想吃${d.character}的${d.food}`;
    case "birthday":
      return "祝我生日快乐";
    case "event":
      return findLine(d.line)?.line.text ?? "（限定宣言）";
    case "alsoplay":
      return `原来，你也玩${GAME_NAMES[d.game]}`;
    case "water":
      return "这白开水怎么没味啊？";
    case "drunklove":
      return `我永远喜欢${d.character}！`;
    case "kr168":
      return `氪了168，${d.character}${d.spouse}回家家`;
    case "radar":
      return "我的方舟雷达💡的一下响了";
    case "roguelike":
      return "我要打集成战略！";
    case "xianshu":
      return "我要看仙术杯！";
    case "rental":
      return "我的出租屋里真的有很多蟑螂，但我认识的粥批真的没有几个";
  }
}

/**
 * The fixed replies of before, which still show on the messages that have them. All but
 * 生日快乐！ are the five every declaration has (GENERIC_REACTIONS), after its own four.
 */
export const REACTIONS = {
  alsoplay: "原来，你也玩舟？",
  birthday: "生日快乐！",
  zhouli: "合乎粥礼",
  shouwei: "舟P收收味",
  plusone: "+1",
  diplomat: "这种已经是外交官级别的了",
} as const;
export type Reaction = keyof typeof REACTIONS;

export function isReaction(v: unknown): v is Reaction {
  return typeof v === "string" && Object.hasOwn(REACTIONS, v);
}

/** The five every declaration can get, on a line of their own after its own four */
export const GENERIC_REACTIONS = ["alsoplay", "zhouli", "shouwei", "plusone", "diplomat"] as const;

/** One reply a declaration can get: its id (what is stored), its words filled in, and whether it is one of that sentence's own four */
export type Reply = { id: string; text: string; own: boolean };

/**
 * Each sentence's own four replies, stored as "<template>.<n>" (the birthday one's first is
 * the old 生日快乐！, "birthday"); the fourth always asks for a touch. {角色} {游戏} {名字}
 * {称呼} are filled in from the declaration, {汪汪} is 汪汪！, or 喵～ for a 猫. Limited
 * lines keep theirs in events.ts. Short: about 12 characters besides a character's name.
 */
const OWN_REPLIES: Partial<Record<Template, readonly [string, string, string, string]>> = {
  launch: ["上号！", "先把理智清了", "现在还不能休息哦", "一起启动，碰我一下"],
  iam: ["{汪汪}", "我也是{角色}的{称呼}", "{角色}知道吗？", "同一窝的！碰我一下"],
  love: ["我也永远喜欢{角色}！", "{角色}是我的！", "你上次也是这么说的", "同担！碰我一下"],
  buff: ["{角色}值得更好的！", "鹰角，听到了吗！", "不是{角色}弱，是练度不够", "同求加强，碰我一下"],
  myname: ["好名字！", "我也要玩{游戏}！", "准了！", "{名字}你好，碰我一下"],
  welcome: ["我回来了！", "回来就好", "这次真的不退坑了", "我也刚回来，碰我一下"],
  canyou: ["{角色}当然做得到！", "你在质疑{角色}？", "做不到也没关系，喜欢就够了", "我也厨{角色}，碰我一下"],
  eat: ["给我也来一份", "这边建议去医疗部挂个号", "{角色}：？", "同道中人？碰我一下"],
  birthday: ["生日快乐！", "生日快乐，十连双黄！", "今天寿星最大", "寿星碰我一下，沾沾喜气"],
  water: ["那是白酒！", "别喝了别喝了", "我给你倒杯真的", "醒了碰我一下"],
  drunklove: ["酒后吐真言", "醒了还算数吗？", "敬{角色}，干杯！", "同担干杯，碰我一下"],
  kr168: ["恭喜接{角色}回家！", "168 就出了？我 648 都没出", "醒醒，你还没抽", "欧皇碰我一下，分点欧气"],
  radar: ["我的也响了！", "响的就是我", "喝多了吧，雷达在乱响", "碰我一下，看看准不准"],
  roguelike: ["这把必出好藏品！", "喝成这样还打肉鸽？", "醉拳流，一层就寄", "打完碰我一下，比比分"],
  xianshu: ["我也要看！", "看会了，手没会", "喝醉了看，更像仙术了", "看完碰我一下"],
  rental: ["现在认识一个了", "那些蟑螂也玩舟吗？", "所以你来对地方了", "碰我一下，这就多一个"],
};

/** A reply's blanks, filled in from the declaration it answers */
function fillReply(text: string, d: Declaration) {
  const character = ("character" in d && d.character) || "TA";
  return text
    .replaceAll("{角色}", character)
    .replaceAll("{游戏}", "game" in d ? GAME_NAMES[d.game] : "舟")
    .replaceAll("{名字}", d.template === "myname" ? (d.name ?? "") : "")
    .replaceAll("{称呼}", d.template === "iam" ? d.title : "")
    .replaceAll("{汪汪}", d.template === "iam" && d.title === "猫" ? "喵～" : "汪汪！");
}

/** A sentence's own four, filled in; none for one without them (an older sentence, a limited line written without) */
function ownReplies(d: Declaration): Reply[] {
  if (d.template === "event") {
    const line = findLine(d.line)?.line;
    if (!line?.replies) return [];
    const key = line.replyKey ?? line.id;
    return line.replies.map((text, i) => ({ id: `${key}.${i + 1}`, text, own: true }));
  }
  const own = OWN_REPLIES[d.template];
  if (!own) return [];
  return own.map((text, i) => ({
    id: d.template === "birthday" && i === 0 ? "birthday" : `${d.template}.${i + 1}`,
    text: fillReply(text, d),
    own: true,
  }));
}

/** What a declaration can be answered with: its own four, then the five every one has */
export function repliesFor(d: Declaration): Reply[] {
  return [...ownReplies(d), ...GENERIC_REACTIONS.map((id) => ({ id, text: REACTIONS[id], own: false }))];
}

/** A reply someone left on this declaration, its words filled in; the fixed ones of before still read; null when unknown */
export function replyOf(d: Declaration, id: unknown): Reply | null {
  if (typeof id !== "string") return null;
  const found = repliesFor(d).find((r) => r.id === id);
  if (found) return found;
  return isReaction(id) ? { id, text: REACTIONS[id], own: id === "birthday" } : null;
}

/** Whether a reply may be left on this declaration now */
export const canReply = (d: Declaration, id: unknown) => repliesFor(d).some((r) => r.id === id);
