import { fmt, T } from "@/i18n";
import { characterName, foodName, spouseName, titleName } from "@/i18n/names";
import { findLine } from "./events";
import { GAME_NAMES, type Game } from "./games";

/** 我想吃<角色>的<食物> */
export const FOODS = ["靴子泡面", "玉族配饭", "脚夹馍", "丝袜奶茶", "脚糖布丁", "洗角水煮面"] as const;
export type Food = (typeof FOODS)[number];

/** 氪了168，<角色>老婆/老公回家家 */
export const SPOUSES = ["老婆", "老公"] as const;
export type Spouse = (typeof SPOUSES)[number];

/** What players call themselves in 欢迎回家，<称呼> */
export const WELCOME_NAMES: Record<Game, string> = {
  get arknights() {
    return T.lib.declarations.welcomeNames.arknights;
  },
  get endfield() {
    return T.profile.avatar.endmin;
  },
};

/**
 * A declaration is always one of a few fixed sentences with blanks picked from
 * lists. `name` in 「我是<名字>，我要玩…」 is filled in by the server from the
 * sender's profile. "event" is a limited-time line from events.ts. "alsoplay"
 * can no longer be sent, but older ones still show. The DRUNK_TEMPLATES can only be
 * sent while your main roach lies drunk (摄入酒精); the STAY_TEMPLATES once your ink roach
 * has had a room at 祀掌柜's 缘缘庄 (src/lib/si.ts), and for good from then on.
 */
export type Declaration =
  | { template: "launch"; game: Game }
  | { template: "stronghold" }
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
  | { template: "rental" }
  | { template: "sihouse" }
  | { template: "simine" };

export type Template = Declaration["template"];

/** The ones a player can always send, in the order the sheet lists them; events come on top while they are on. */
export const TEMPLATES = ["launch", "stronghold", "iam", "love", "buff", "myname", "welcome", "canyou", "eat", "birthday"] as const;

/** What a drunk roach says on top of those, in the order the sheet lists them */
export const DRUNK_TEMPLATES = ["water", "drunklove", "kr168", "radar", "roguelike", "xianshu", "rental"] as const;
export const isDrunkTemplate = (t: unknown) => (DRUNK_TEMPLATES as readonly unknown[]).includes(t);

/** What a guest of 缘缘庄 may say, from the moment their ink roach gets a room, in the order the sheet lists them */
export const STAY_TEMPLATES = ["sihouse", "simine"] as const;
export const isStayTemplate = (t: unknown) => (STAY_TEMPLATES as readonly unknown[]).includes(t);
/** Why one who has not stayed cannot send them, on the sheet and from the server */
export const stayNeeded = () => T.lib.declarations.stayNeeded;

export function declarationText(d: Declaration): string {
  switch (d.template) {
    case "launch":
      return fmt(T.lib.declarations.text.launch, { game: GAME_NAMES[d.game] });
    case "stronghold":
      return T.declare.line.stronghold;
    case "iam":
      return fmt(T.lib.declarations.text.iam, { character: characterName(d.character), title: titleName(d.title) });
    case "love":
      return fmt(T.lib.declarations.text.love, { character: characterName(d.character) });
    case "buff":
      return fmt(T.lib.declarations.text.buff, { character: characterName(d.character) });
    case "myname":
      return fmt(T.lib.declarations.text.myname, { name: d.name ?? "……", game: GAME_NAMES[d.game] });
    case "welcome":
      return fmt(T.lib.declarations.text.welcome, { name: WELCOME_NAMES[d.game] });
    case "canyou":
      return fmt(T.lib.declarations.text.canyou, { character: characterName(d.character) });
    case "eat":
      return fmt(T.lib.declarations.text.eat, { character: characterName(d.character), food: foodName(d.food) });
    case "birthday":
      return T.declare.line.birthday;
    case "event":
      return findLine(d.line)?.line.text ?? T.lib.declarations.text.event;
    case "alsoplay":
      return fmt(T.lib.declarations.text.alsoplay, { game: GAME_NAMES[d.game] });
    case "water":
      return T.declare.line.water;
    case "drunklove":
      return fmt(T.lib.declarations.text.drunklove, { character: characterName(d.character) });
    case "kr168":
      return fmt(T.lib.declarations.text.kr168, { character: characterName(d.character), spouse: spouseName(d.spouse) });
    case "radar":
      return T.declare.line.radar;
    case "roguelike":
      return T.declare.line.roguelike;
    case "xianshu":
      return T.declare.line.cup;
    case "rental":
      return T.declare.line.roaches;
    case "sihouse":
      return T.declare.line.innBig;
    case "simine":
      return T.declare.line.innSi;
  }
}

/**
 * The fixed replies of before, which still show on the messages that have them. All but
 * 生日快乐！ are the five every declaration has (GENERIC_REACTIONS), after its own four; the
 * last four are the playful ones every declaration has too (FUN_REACTIONS), on a line below.
 */
export const REACTIONS = {
  get alsoplay() {
    return T.lib.declarations.reactions.alsoplay;
  },
  get birthday() {
    return T.lib.declarations.reactions.birthday;
  },
  get zhouli() {
    return T.lib.declarations.reactions.zhouli;
  },
  get shouwei() {
    return T.lib.declarations.reactions.shouwei;
  },
  plusone: "+1",
  get diplomat() {
    return T.lib.declarations.reactions.diplomat;
  },
  get dian() {
    return T.lib.declarations.reactions.dian;
  },
  get six() {
    return T.lib.declarations.reactions.six;
  },
  get beng() {
    return T.lib.declarations.reactions.beng;
  },
  get jietu() {
    return T.lib.declarations.reactions.jietu;
  },
} as const;
export type Reaction = keyof typeof REACTIONS;

export function isReaction(v: unknown): v is Reaction {
  return typeof v === "string" && Object.hasOwn(REACTIONS, v);
}

/** The five every declaration can get, on a line of their own after its own four */
export const GENERIC_REACTIONS = ["alsoplay", "zhouli", "shouwei", "plusone", "diplomat"] as const;

/** The four playful ones every declaration can get too, on a third line after the five */
export const FUN_REACTIONS = ["dian", "six", "beng", "jietu"] as const;
const isFun = (id: string) => (FUN_REACTIONS as readonly string[]).includes(id);

/**
 * One reply a declaration can get: its id (what is stored), its words filled in, whether it is one of that
 * sentence's own four, and fun when it is one of the playful four (FUN_REACTIONS)
 */
export type Reply = { id: string; text: string; own: boolean; fun?: true };

/**
 * Each sentence's own four replies, stored as "<template>.<n>" (the birthday one's first is
 * the old 生日快乐！, "birthday"); the fourth always asks for a touch. {角色} {游戏} {名字}
 * {称呼} are filled in from the declaration, {汪汪} is 汪汪！, or 喵～ for a 猫. Limited
 * lines keep theirs in events.ts. Short: about 12 characters besides a character's name.
 */
const OWN_REPLIES: Partial<Record<Template, readonly [string, string, string, string]>> = {
  get launch() {
    return [T.lib.declarations.replies.launch.r1, T.lib.declarations.replies.launch.r2, T.lib.declarations.replies.launch.r3, T.lib.declarations.replies.launch.r4] as const;
  },
  get stronghold() {
    return [T.lib.declarations.replies.stronghold.r1, T.lib.declarations.replies.stronghold.r2, T.lib.declarations.replies.stronghold.r3, T.lib.declarations.replies.stronghold.r4] as const;
  },
  get iam() {
    return [T.lib.declarations.replies.iam.r1, T.lib.declarations.replies.iam.r2, T.lib.declarations.replies.iam.r3, T.lib.declarations.replies.iam.r4] as const;
  },
  get love() {
    return [T.lib.declarations.replies.love.r1, T.lib.declarations.replies.love.r2, T.lib.declarations.replies.love.r3, T.lib.declarations.replies.love.r4] as const;
  },
  get buff() {
    return [T.lib.declarations.replies.buff.r1, T.lib.declarations.replies.buff.r2, T.lib.declarations.replies.buff.r3, T.lib.declarations.replies.buff.r4] as const;
  },
  get myname() {
    return [T.lib.declarations.replies.myname.r1, T.lib.declarations.replies.myname.r2, T.lib.declarations.replies.myname.r3, T.lib.declarations.replies.myname.r4] as const;
  },
  get welcome() {
    return [T.lib.declarations.replies.welcome.r1, T.lib.declarations.replies.welcome.r2, T.lib.declarations.replies.welcome.r3, T.lib.declarations.replies.welcome.r4] as const;
  },
  get canyou() {
    return [T.lib.declarations.replies.canyou.r1, T.lib.declarations.replies.canyou.r2, T.lib.declarations.replies.canyou.r3, T.lib.declarations.replies.canyou.r4] as const;
  },
  get eat() {
    return [T.lib.declarations.replies.eat.r1, T.lib.declarations.replies.eat.r2, T.lib.declarations.replies.eat.r3, T.lib.declarations.replies.eat.r4] as const;
  },
  get birthday() {
    return [T.lib.declarations.reactions.birthday, T.lib.declarations.replies.birthday.r2, T.lib.declarations.replies.birthday.r3, T.lib.declarations.replies.birthday.r4] as const;
  },
  get water() {
    return [T.lib.declarations.replies.water.r1, T.lib.declarations.replies.water.r2, T.lib.declarations.replies.water.r3, T.lib.declarations.replies.water.r4] as const;
  },
  get drunklove() {
    return [T.lib.declarations.replies.drunklove.r1, T.lib.declarations.replies.drunklove.r2, T.lib.declarations.replies.drunklove.r3, T.lib.declarations.replies.drunklove.r4] as const;
  },
  get kr168() {
    return [T.lib.declarations.replies.kr168.r1, T.lib.declarations.replies.kr168.r2, T.lib.declarations.replies.kr168.r3, T.lib.declarations.replies.kr168.r4] as const;
  },
  get radar() {
    return [T.lib.declarations.replies.radar.r1, T.lib.declarations.replies.radar.r2, T.lib.declarations.replies.radar.r3, T.lib.declarations.replies.radar.r4] as const;
  },
  get roguelike() {
    return [T.lib.declarations.replies.roguelike.r1, T.lib.declarations.replies.roguelike.r2, T.lib.declarations.replies.roguelike.r3, T.lib.declarations.replies.roguelike.r4] as const;
  },
  get xianshu() {
    return [T.lib.declarations.replies.xianshu.r1, T.lib.declarations.replies.xianshu.r2, T.lib.declarations.replies.xianshu.r3, T.lib.declarations.replies.xianshu.r4] as const;
  },
  get rental() {
    return [T.lib.declarations.replies.rental.r1, T.lib.declarations.replies.rental.r2, T.lib.declarations.replies.rental.r3, T.lib.declarations.replies.rental.r4] as const;
  },
  get sihouse() {
    return [T.lib.declarations.replies.sihouse.r1, T.lib.declarations.replies.sihouse.r2, T.lib.declarations.replies.sihouse.r3, T.lib.declarations.replies.sihouse.r4] as const;
  },
  get simine() {
    return [T.lib.declarations.replies.simine.r1, T.lib.declarations.replies.simine.r2, T.lib.declarations.replies.simine.r3, T.lib.declarations.replies.simine.r4] as const;
  },
};

/** A reply's blanks, filled in from the declaration it answers */
function fillReply(text: string, d: Declaration) {
  const character = ("character" in d && d.character && characterName(d.character)) || "TA";
  return text
    .replaceAll("{角色}", character)
    .replaceAll("{游戏}", "game" in d ? GAME_NAMES[d.game] : T.lib.declarations.fill.game)
    .replaceAll("{名字}", d.template === "myname" ? (d.name ?? "") : "")
    .replaceAll("{称呼}", d.template === "iam" ? titleName(d.title) : "")
    .replaceAll("{汪汪}", d.template === "iam" && d.title === "猫" ? T.lib.declarations.fill.meow : T.lib.declarations.fill.woof);
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

/** What a declaration can be answered with: its own four, then the five every one has, then the playful four */
export function repliesFor(d: Declaration): Reply[] {
  return [
    ...ownReplies(d),
    ...GENERIC_REACTIONS.map((id) => ({ id, text: REACTIONS[id], own: false })),
    ...FUN_REACTIONS.map((id) => ({ id, text: REACTIONS[id], own: false, fun: true as const })),
  ];
}

/** A reply someone left on this declaration, its words filled in; the fixed ones of before still read; null when unknown */
export function replyOf(d: Declaration, id: unknown): Reply | null {
  if (typeof id !== "string") return null;
  const found = repliesFor(d).find((r) => r.id === id);
  if (found) return found;
  if (isReaction(id)) return { id, text: REACTIONS[id], own: id === "birthday", ...(isFun(id) && { fun: true as const }) };
  // 缘缘庄's two read as 「明日方舟，启动！」 until the server read them back as themselves (storedDeclaration in
  // server/world.ts), and some were answered as that: those replies still read as they were picked
  return isStayTemplate(d.template) && id.startsWith("launch.") ? replyOf({ template: "launch", game: "arknights" }, id) : null;
}

/** Whether a reply may be left on this declaration now */
export const canReply = (d: Declaration, id: unknown) => repliesFor(d).some((r) => r.id === id);
