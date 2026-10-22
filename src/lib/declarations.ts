import { GAME_NAMES, type Game } from "./games";

/** 我想吃<角色>的<食物> */
export const FOODS = ["靴子泡面", "玉族配饭", "脚夹馍"] as const;
export type Food = (typeof FOODS)[number];

/** What players call themselves in 欢迎回家，<称呼> */
export const WELCOME_NAMES: Record<Game, string> = { arknights: "刀客塔", endfield: "管理员" };

/**
 * A declaration is always one of a few fixed sentences with blanks picked from
 * lists. `name` in 「我是<名字>，我要玩…」 is filled in by the server from the
 * sender's profile. "alsoplay" can no longer be sent, but older ones still show.
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
  | { template: "alsoplay"; game: Game };

export type Template = Declaration["template"];

/** The ones a player can send, in the order the sheet lists them. */
export const TEMPLATES = ["launch", "iam", "love", "buff", "myname", "welcome", "canyou", "eat", "birthday"] as const;

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
    case "alsoplay":
      return `原来，你也玩${GAME_NAMES[d.game]}`;
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
  const all = Object.keys(REACTIONS) as Reaction[];
  return template === "birthday" ? all : all.filter((r) => r !== "birthday");
}
