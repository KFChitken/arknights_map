import type { ArtFrame } from "./passArt";

/**
 * 通行证寻访: tickets earned by playing (每日任务), spent to draw passes of the game characters, each pass numbered in the order
 * the whole site drew that character. The rules both sides go by; the server's part is src/lib/server/passes.ts,
 * the characters src/lib/passCatalog.ts. Nothing here reads the catalogue, so the map page can ask what it needs
 * (the entry's dot) without downloading it.
 */

/** Tickets a player may hold; claiming brings none past it, a 触须之交's gift goes past it */
export const TICKETS_CAP = 50;
/** Tickets given once, the first time a player opens the page */
export const WELCOME_TICKETS = 10;
/**
 * 每日任务: what a player does that a ticket is claimed for on the 寻访 page, each done at most so many times a site day
 * (src/lib/siteDay.ts) that counts: touching someone's roach (on the map or back from 消息, sneakily or boldly),
 * declaring, answering someone's declaration (its reply chips), touching one of the guides (NPC). In the order the
 * page lists them.
 */
export const TASK_MAX = { touch: 3, declare: 2, reply: 3, npc: 2 } as const;
export type Task = keyof typeof TASK_MAX;
export const TASKS = Object.keys(TASK_MAX) as Task[];
export const isTask = (t: unknown): t is Task => typeof t === "string" && Object.hasOwn(TASK_MAX, t);
/** All of them together: what 今天领了 x / 10 counts to */
export const DAY_TICKETS = TASKS.reduce((n, k) => n + TASK_MAX[k], 0);
/** One of the day's 每日任务 as the page shows it: done so many times today, so many of those claimed */
export type TaskState = { task: Task; done: number; got: number; max: number };
/** The tickets one may claim for a task now: done and not claimed yet, as many as TICKETS_CAP leaves room for */
export const claimable = (t: Pick<TaskState, "done" | "got">, tickets: number) => Math.max(0, Math.min(t.done - t.got, TICKETS_CAP - tickets));
/** The tickets done for and not claimed yet, all tasks together, room or not */
export const unclaimed = (tasks: readonly Pick<TaskState, "done" | "got">[]) => tasks.reduce((n, t) => n + Math.max(0, t.done - t.got), 0);
/** The tickets claimed today, all tasks together */
export const gotToday = (tasks: readonly Pick<TaskState, "got">[]) => tasks.reduce((n, t) => n + t.got, 0);
/** The dot on the 寻访 button: the first ten waiting, a ticket to claim (with room for it), or enough for a draw of ten */
export const passesDot = (welcomed: boolean, tickets: number, tasks: readonly Pick<TaskState, "done" | "got">[]) =>
  !welcomed || tickets >= 10 || (tickets < TICKETS_CAP && tasks.some((t) => t.done > t.got));
/** What a touch, a declaration or a reply also brings back when it counted towards 每日任务: the dot after it, for the map to light at once */
export type PassesDot = { passesDot?: boolean };
/** Tickets a player may be given by their 触须之交 a site day; each 触须之交 gives one a day at most */
export const GIFTS_IN_PER_DAY = 3;
/**
 * 送 1 张寻访券, as it stands between you and one 触须之交 today: you may (ok), you gave TA one (given), or TA was
 * given GIFTS_IN_PER_DAY already (full)
 */
export type GiftState = "ok" | "given" | "full";
/**
 * 关注 B 站领券: the owner's B 站 account sends its followers a code (the owner sets it in the 管理台, site_settings
 * pass_follow); typed on 寻访, it brings FOLLOW_TICKETS once for each account, past TICKETS_CAP too. The code is
 * compared on the server alone: the page is told the task's account and link, and whether it was claimed.
 */
export const FOLLOW_TICKETS = 10;
/** 「随机生成」's code: FOLLOW_CODE_LENGTH of these, nothing that reads like another (no 0 O 1 I) */
export const FOLLOW_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const FOLLOW_CODE_LENGTH = 6;
/** A code at most this long, spaces left out */
export const FOLLOW_CODE_MAX = 20;
/** The account's name, at most this long */
export const FOLLOW_NAME_MAX = 30;
/** A code as it is compared: spaces left out, in capitals */
export const followCode = (typed: string) => typed.replace(/\s+/g, "").toUpperCase();
/** A new code for 「随机生成」: 32 characters, so each random byte picks one as likely as any other */
export const randomFollowCode = (bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(FOLLOW_CODE_LENGTH))) =>
  Array.from(bytes, (b) => FOLLOW_CODE_CHARS[b % FOLLOW_CODE_CHARS.length]).join("");
/** 关注 B 站领券 as the owner keeps it (site_settings pass_follow): on or off, the account's name, its link, the code */
export type PassFollow = { on: boolean; name: string; url: string; code: string };
/** The task on 寻访, while it is on with all of it filled: the account and its link, and whether this player claimed it (that day) */
export type FollowTask = { name: string; url: string; got: boolean };
/** The 管理台's view of it: as kept, whether 寻访 shows it, PASSES (who may see 寻访 at all), and how many accounts claimed it */
export type PassFollowDesk = { settings: PassFollow; shown: boolean; passes: "on" | "admins" | "off"; claimed: number; today: number };

/** The pull that surely brings someone from the wish list: after PITY - 1 without one */
export const PITY = 30;
/** Characters on a wish list, at most */
export const WISH_MAX = 6;
/** How many passes one draw makes */
export const DRAW_SIZES = [1, 10] as const;
export type DrawSize = (typeof DRAW_SIZES)[number];
export const isDrawSize = (n: unknown): n is DrawSize => n === 1 || n === 10;
/**
 * 卡池: whom a pull brings when it brings nobody from the wish list: anyone of both games (both), or of one game alone
 * (Breeze, 2026-11-17). The wish list comes as often whichever (rollChars), its other game's characters too. Until a
 * player picks one, they draw from the game 我的资料's 在玩 says they play, or both when it says both or neither
 * (passPoolOf).
 */
export const PASS_POOLS = ["both", "ak", "ef"] as const;
export type PassPool = (typeof PASS_POOLS)[number];
export const isPassPool = (p: unknown): p is PassPool => typeof p === "string" && (PASS_POOLS as readonly string[]).includes(p);
/** The 卡池 a player draws from: the one they picked, else as users.games has it (arknights, endfield) */
export function passPoolOf(picked: PassPool | null, games: readonly string[]): PassPool {
  if (isPassPool(picked)) return picked;
  const ak = games.includes("arknights");
  const ef = games.includes("endfield");
  return ak === ef ? "both" : ak ? "ak" : "ef";
}

/**
 * What a pass was to its player when drawn: someone on their wish list (whichever copy), a character new to them,
 * their second copy of one (which unlocks the special look, 镭射), or a third or later (潜能 +1)
 */
export type Tier = "wish" | "new" | "up" | "dup";
/** The order the best of a draw is told in */
export const TIER_ORDER: readonly Tier[] = ["wish", "new", "up", "dup"];

/** One pass of a draw, in the order drawn */
export type Drawn = {
  charId: number;
  no: number;
  tier: Tier;
  /** this copy is the player's second of the character: the special look unlocks with it (a wish may be one too) */
  up: boolean;
  /** drawn in the special look: two or more copies, and the player has not picked the normal one for the character */
  fancy: boolean;
  /** a gold number: the first hundred, or 靓号 (isFoil) */
  foil: boolean;
};

/** The wallet as the page shows it, after every change */
export type PassState = {
  tickets: number;
  /** the day's 每日任务, in the order of TASKS */
  tasks: TaskState[];
  /** the tickets 触须之交 gave today */
  giftsIn: number;
  /** catalogue ids, at most WISH_MAX; empty when the player never had any 厨力 and never picked */
  wish: number[];
  /** whether the wish list may still be changed this site day (picking the first one never counts) */
  wishOpen: boolean;
  /** draws in a row without anyone from the wish list (0 while it is empty) */
  miss: number;
  /** the player's passes of each character on the wish list: how many, and their first, which a tap on them there shows at once */
  wishOwned: WishOwned[];
  /**
   * how many passes of each character on the wish list the whole site has drawn: the last number given them
   * (pass_counters.last_no), as numbers are never given twice; one nobody has drawn yet is left out
   */
  wishDrawn: { charId: number; lastNo: number }[];
  /** catalogue ids they picked the normal look for, though they have two or more */
  plain: number[];
  /** just now given WELCOME_TICKETS, the first time they opened the page */
  welcomed: boolean;
  /** when the next site day begins, for 「明天 4 点」 */
  nextDayAt: number;
  /** the pass they wear on their profile card, if any */
  worn: WornPass | null;
  /** 触须之交 may give each other tickets (PASS_GIFTS): 送来的 y / 3 and 送券 show */
  gifts: boolean;
  /** the 卡池 they draw from: the one they picked, else as their 在玩 has it (passPoolOf) */
  pool: PassPool;
  /** 关注 B 站领券, at the top of 每日任务: while it is on, until the site day after they claimed it */
  follow: FollowTask | null;
};

/** One character in 我的通行证 */
export type OwnedChar = { charId: number; copies: number; no: number; lastAt: number };
/** One of a player's passes of a character, for picking which one they wear */
export type PassCopy = { id: number; no: number; at: number };
/** A character on the wish list the player has: how many passes of them, and the first (the lowest number) */
export type WishOwned = { charId: number; copies: number; first: PassCopy };
/** A player's passes of one character, lowest number first */
export type CharCopies = { charId: number; copies: PassCopy[] };

/**
 * A pass as profile cards show it: the one a player wears (PublicProfile.pass), with what a card prints on it, so
 * that a card needs no catalogue. Its holder is the card's name.
 */
export type PassOnCard = {
  game: PassGame;
  charId: number;
  /** the character's name, and in English (null: none known) */
  name: string;
  en: string | null;
  rarity: number | null;
  no: number;
  /** how many passes of the character the player has (潜能) */
  copies: number;
  /** drawn in the special look (isFancy) */
  fancy: boolean;
  /** the colour of the pass, and its picture's files (src/lib/passArt.ts; null: none here, or switched off) */
  color: string;
  art: string | null;
  /** where the picture is moved in its boxes, for the few that are (src/lib/passArt.ts ArtFrame) */
  frame?: ArtFrame;
  /** the character's small round picture's file (/operator-art), shown where there is no 立绘 */
  avatar: string | null;
  drawnAt: number;
};
/** The pass a player wears, as their own pages have it: also which of their passes it is */
export type WornPass = PassOnCard & { passId: number };
/**
 * The pass the owner of a main roach wears, as its card on the map shows it to anyone else (GET /api/passes/roach):
 * hung over the card whole, with its number and the day drawn (gold where the number is), never how many they
 * have; and printed with no holder's name, as the map names nobody (FullPass anon)
 */
export type RoachPass = Omit<PassOnCard, "copies">;
/** 我的通行证: every character the player has, and how many passes in all */
export type Collection = { chars: OwnedChar[]; passes: number };
/** A line of 寻访记录, newest first */
export type LogRow = { id: number; charId: number; no: number; wish: boolean; at: number };
export type LogPage = { rows: LogRow[]; more: boolean };

/** What me() carries for the map page's 寻访 button, when the player may draw */
export type PassesMe = {
  tickets: number;
  /** the dot on the button (passesDot) */
  dot: boolean;
  /** the pass they wear, for 我的资料 */
  worn: WornPass | null;
  /** 地图卡片上挂出通行证: the pass they wear hangs over their main roach's card on the map (RoachPass) */
  onMap: boolean;
};

/** The look a pass is drawn in, by game: the normal ones, and the special ones a second copy unlocks */
export type PassStyle = "ra" | "rax" | "tag" | "tagx";
export type PassGame = "ak" | "ef";
const NORMAL: Record<PassGame, PassStyle> = { ak: "ra", ef: "tag" };
const SPECIAL: Record<PassGame, PassStyle> = { ak: "rax", ef: "tagx" };
/** ① ③ normally, ② ④ when fancy; a gold number changes nothing but a gold chip and corner */
export const styleFor = (game: PassGame, fancy: boolean): PassStyle => (fancy ? SPECIAL : NORMAL)[game];
/** The special look is on: two copies or more, and not switched back to the normal one */
export const isFancy = (copies: number, plain: boolean) => copies >= 2 && !plain;

/**
 * A gold number, and which: the first hundred of a character (No.000001–000100), or 靓号, one with 325 or 799 in it
 * (325, 1325, 3250, 7990, 13258…); "" for any other. The rule is here alone: the server marks a drawn pass foil by it,
 * the page writes the chip's words (前 100, 靓号) from it.
 */
export type GoldKind = "top" | "lucky" | "";
/** Each character's first hundred passes are gold */
export const GOLD_TOP = 100;
export const goldKind = (n: number): GoldKind => (n >= 1 && n <= GOLD_TOP ? "top" : /325|799/.test(String(n)) ? "lucky" : "");
/** A gold number gets a gold chip on the whole pass and a gold corner on the small one, in either look */
export const isFoil = (n: number) => goldKind(n) !== "";
/** Of a character's gold first hundred, how many are still to be drawn, after the last number given (lastNo) */
export const goldLeft = (lastNo: number) => Math.max(0, GOLD_TOP - lastNo);

/** A pass's number as printed: six digits (No.000042), as it is from a million on */
export const PRINTED_DIGITS = 6;
export const padNo = (n: number) => String(n).padStart(PRINTED_DIGITS, "0");

/** Draws in a row without a wish before the next one surely brings one (0 for the pity pull itself) */
export const pityLeft = (miss: number) => Math.max(1, PITY - miss);

/**
 * Who a draw brings, pass by pass: anyone in the catalogue with the same chance, but once PITY - 1 draws in a row
 * brought nobody from the wish list, the next brings one of the wish list, each of them as likely, those the player
 * has already included (Breeze, 2026-11-13: a player who wants no copies takes them off). Anyone from the wish list
 * starts the count again, however they came. An empty wish list keeps no count. rand(n) is a whole number from 0
 * to n - 1 (crypto.randomInt on the server).
 * game: the characters of the one game a 卡池 of one game draws from (none: both, the draw just as before). A pull
 * short of PITY then brings someone from the wish list as often as with both, wish.length in ids.length, each of
 * them as likely; else anyone of that game who is not on it, each as likely.
 */
export function rollChars(
  ids: readonly number[],
  wish: readonly number[],
  miss: number,
  n: number,
  rand: (n: number) => number,
  game?: readonly number[] | null,
): { picks: { charId: number; wish: boolean }[]; miss: number } {
  const wished = new Set(wish);
  const rest = game?.filter((id) => !wished.has(id));
  const picks: { charId: number; wish: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    let charId: number;
    if (wish.length && miss >= PITY - 1) charId = wish[rand(wish.length)];
    else if (!rest) charId = ids[rand(ids.length)];
    else {
      const r = rand(ids.length);
      // a game with nobody off the wish list (none has so few) draws as both
      charId = r < wish.length ? wish[r] : rest.length ? rest[rand(rest.length)] : ids[r];
    }
    const hit = wished.has(charId);
    miss = hit || !wish.length ? 0 : miss + 1;
    picks.push({ charId, wish: hit });
  }
  return { picks, miss };
}

/**
 * What each pass of a draw is to the player (Tier), in the order drawn: owned holds the copies they had of each
 * character before it, so a character drawn twice in one draw is new the first time and unlocks the special look
 * the second. plain: the characters they keep in the normal look.
 */
export function tiersOf(
  picks: readonly { charId: number; wish: boolean }[],
  owned: ReadonlyMap<number, number>,
  plain: readonly number[],
): { tier: Tier; up: boolean; fancy: boolean }[] {
  const had = new Map(owned);
  return picks.map(({ charId, wish }) => {
    const before = had.get(charId) ?? 0;
    had.set(charId, before + 1);
    const tier: Tier = wish ? "wish" : before === 0 ? "new" : before === 1 ? "up" : "dup";
    return { tier, up: before === 1, fancy: isFancy(before + 1, plain.includes(charId)) };
  });
}

/** The best pass of a draw, as the summary names it: a wish, a new character, a special look unlocked, else the first */
export function bestOf<D extends { tier: Tier }>(drawn: readonly D[]): D | undefined {
  for (const t of TIER_ORDER) {
    const d = drawn.find((x) => x.tier === t);
    if (d) return d;
  }
  return undefined;
}
