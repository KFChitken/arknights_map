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

/** Fixed replies a player can leave on a declaration they received, one per declaration. */
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

/** 生日快乐！ only fits a birthday declaration */
export function reactionsFor(template: string): Reaction[] {
  const others = (Object.keys(REACTIONS) as Reaction[]).filter((r) => r !== "birthday");
  // a birthday declaration has 生日快乐！ first
  return template === "birthday" ? ["birthday", ...others] : others;
}
