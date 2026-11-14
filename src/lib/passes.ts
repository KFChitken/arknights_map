/**
 * 通行证寻访: tickets earned by playing, spent to draw passes of the game characters, each pass numbered in the order
 * the whole site drew that character. The rules both sides go by; the server's part is src/lib/server/passes.ts,
 * the characters src/lib/passCatalog.ts. Nothing here reads the catalogue, so the map page can ask what it needs
 * (the entry's dot) without downloading it.
 */

/** Tickets a player may hold; playing adds none past it, a 触须之交's gift goes past it */
export const TICKETS_CAP = 50;
/** Tickets given once, the first time a player opens the page */
export const WELCOME_TICKETS = 10;
/** Tickets a site day (src/lib/siteDay.ts) brings for each kind of play, at most */
export const EARN_CAPS = { social: 6, guide: 2, declare: 2 } as const;
export type EarnKind = keyof typeof EARN_CAPS;
export const EARN_KINDS = Object.keys(EARN_CAPS) as EarnKind[];
/** All of them together: what 今天拿到 x / 10 counts to */
export const DAY_TICKETS = EARN_KINDS.reduce((n, k) => n + EARN_CAPS[k], 0);
/** Tickets a player may be given by their 触须之交 a site day */
export const GIFTS_IN_PER_DAY = 3;
/** The pull that surely brings someone from the wish list: after PITY - 1 without one */
export const PITY = 30;
/** Characters on a wish list, at most */
export const WISH_MAX = 6;
/** How many passes one draw makes */
export const DRAW_SIZES = [1, 10] as const;
export type DrawSize = (typeof DRAW_SIZES)[number];
export const isDrawSize = (n: unknown): n is DrawSize => n === 1 || n === 10;

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
  /** tickets this site day brought, by kind, and how many 触须之交 gave */
  today: Record<EarnKind, number> & { giftsIn: number };
  /** catalogue ids, at most WISH_MAX; empty when the player never had any 厨力 and never picked */
  wish: number[];
  /** whether the wish list may still be changed this site day (picking the first one never counts) */
  wishOpen: boolean;
  /** draws in a row without anyone from the wish list (0 while it is empty) */
  miss: number;
  /** copies the player has of each character on the wish list, and the number of the first */
  wishOwned: { charId: number; copies: number; no: number }[];
  /** catalogue ids they picked the normal look for, though they have two or more */
  plain: number[];
  /** just now given WELCOME_TICKETS, the first time they opened the page */
  welcomed: boolean;
  /** when the next site day begins, for 「明天 4 点」 */
  nextDayAt: number;
  /** the pass they wear on their profile card, if any */
  worn: WornPass | null;
};

/** One character in 我的通行证 */
export type OwnedChar = { charId: number; copies: number; no: number; lastAt: number };
/** One of a player's passes of a character, for picking which one they wear */
export type PassCopy = { id: number; no: number; at: number };
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
  /** the character's small round picture's file (/operator-art), shown where there is no 立绘 */
  avatar: string | null;
  drawnAt: number;
};
/** The pass a player wears, as their own pages have it: also which of their passes it is */
export type WornPass = PassOnCard & { passId: number };
/** 我的通行证: every character the player has, and how many passes in all */
export type Collection = { chars: OwnedChar[]; passes: number };
/** A line of 寻访记录, newest first */
export type LogRow = { id: number; charId: number; no: number; wish: boolean; at: number };
export type LogPage = { rows: LogRow[]; more: boolean };

/** What me() carries for the map page's 寻访 button, when the player may draw */
export type PassesMe = {
  tickets: number;
  /** the dot on the button: tickets enough for a draw of ten, or the first ten waiting */
  dot: boolean;
  /** the pass they wear, for 我的资料 */
  worn: WornPass | null;
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
 * A gold number, and which: the first hundred of a character (No.0001–0100), or 靓号, one with 325 or 799 in it
 * (325, 1325, 3250, 7990, 13258…); "" for any other. The rule is here alone: the server marks a drawn pass foil by it,
 * the page writes the chip's words (前 100, 靓号) from it.
 */
export type GoldKind = "top" | "lucky" | "";
export const goldKind = (n: number): GoldKind => (n >= 1 && n <= 100 ? "top" : /325|799/.test(String(n)) ? "lucky" : "");
/** A gold number gets a gold chip on the whole pass and a gold corner on the small one, in either look */
export const isFoil = (n: number) => goldKind(n) !== "";

/** A pass's number as printed: four digits below 10000, as it is from there */
export const padNo = (n: number) => (n < 10000 ? String(n).padStart(4, "0") : String(n));

/** Draws in a row without a wish before the next one surely brings one (0 for the pity pull itself) */
export const pityLeft = (miss: number) => Math.max(1, PITY - miss);

/**
 * Who a draw brings, pass by pass: anyone in the catalogue with the same chance, but once PITY - 1 draws in a row
 * brought nobody from the wish list, the next brings one of the wish list, each of them as likely, those the player
 * has already included (Breeze, 2026-11-13: a player who wants no copies takes them off). Anyone from the wish list
 * starts the count again, however they came. An empty wish list keeps no count. rand(n) is a whole number from 0
 * to n - 1 (crypto.randomInt on the server).
 */
export function rollChars(
  ids: readonly number[],
  wish: readonly number[],
  miss: number,
  n: number,
  rand: (n: number) => number,
): { picks: { charId: number; wish: boolean }[]; miss: number } {
  const wished = new Set(wish);
  const picks: { charId: number; wish: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const charId = wish.length && miss >= PITY - 1 ? wish[rand(wish.length)] : ids[rand(ids.length)];
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
