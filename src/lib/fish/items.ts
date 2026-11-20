import table from "@/data/fish-items.json";

/**
 * 钓鳞's items (src/data/fish-items.json): what can bite, where, how likely, how big, in which variants. The numbers
 * live in the table, the words in zh.ts (fish.items, by key), the pictures in public/fish (by key), so that the whole
 * list can grow without the code changing.
 */

export type FishCat = "fish" | "junk" | "squad" | "game";
/** Where a line goes in: 河堤 (the bank, on its own), 卫戍池塘 (in a room of 一起卫戍), 自动钓 (the bank's net) */
export type FishSpot = "pier" | "pond" | "auto";
export type FishOdds = "big" | "mid" | "small" | "rare";
export type FishFam = "fish" | "junk" | "squad";
/** Only then: local hours [from, to), at least so many others on the bank, after another item caught so many times, four fishing together in a room, in 一起听, after 龙门广场舞 */
export type FishWhen = { hours?: [number, number]; crowd?: number; after?: [number, number]; squad4?: boolean; listen?: boolean; dance?: boolean };
export type FishItem = {
  no: number;
  key: string;
  cat: FishCat;
  /** 1 grey, 2 green, 3 blue, 4 purple, 5 gold, 6 red */
  tier: number;
  fam?: FishFam;
  at: Partial<Record<FishSpot, FishOdds>>;
  /** Its size range in cm, for those measured */
  cm?: [number, number];
  when?: FishWhen;
  /** A 通行证 thing (寻访券, 漂流瓶), only where PASSES lets the player draw */
  kind?: "ticket" | "bottle";
  /** Not caught yet: shown in the dex as a shadow, never on a hook */
  off?: boolean;
  /** 盟约徽章: a cell of its own, with this many to collect in it */
  badges?: number;
};

type Table = {
  tiers: number[];
  kinds: Partial<Record<NonNullable<FishItem["kind"]>, number>>;
  weights: Record<FishOdds, number>;
  variantChance: number;
  sizes: { mini: number; giant: number; perfect: number };
  items: FishItem[];
};

const TABLE = table as Table;

export const FISH_ITEMS: readonly FishItem[] = TABLE.items;
/** The chance of each tier on a cast, 1 to 6, in percent, for everything but the 通行证 things (KIND_ODDS) */
export const TIER_ODDS: readonly number[] = TABLE.tiers;
/**
 * 寻访券 and 漂流瓶, each its own chance a cast in percent, drawn before the rest wherever it may come: the same
 * whatever else the table holds
 */
export const KIND_ODDS: Readonly<Partial<Record<NonNullable<FishItem["kind"]>, number>>> = TABLE.kinds;
export const ODDS_WEIGHT: Readonly<Record<FishOdds, number>> = TABLE.weights;
/** How often a fish, junk or 卫戍限定 item comes as a variant */
export const VARIANT_CHANCE = TABLE.variantChance;
/** Sizes of the two size variants, and of a pull on time, against the plain one */
export const SIZE_MINI = TABLE.sizes.mini;
export const SIZE_GIANT = TABLE.sizes.giant;
export const SIZE_PERFECT = TABLE.sizes.perfect;

const BY_NO = new Map(FISH_ITEMS.map((i) => [i.no, i]));
export const itemOf = (no: number): FishItem | undefined => BY_NO.get(no);

/**
 * The variants, by number (0: none): 1 金色的, 2 源石结晶的, 3 月夜的 (only from 20:00 to 06:00, the player's own
 * time), 4 透明的, 5 冻住的, 6 迷你, 7 巨大, 8 崭新的; drawn with CSS (filters and scales), never a picture of their own
 */
export const VARIANT_KEYS = ["", "gold", "crystal", "moon", "clear", "frozen", "mini", "giant", "fresh"] as const;
export const MOON = 3;
export const MINI = 6;
export const GIANT = 7;
/** Which variants each family comes in, in the dex's order */
export const FAMILY: Readonly<Record<FishFam, readonly number[]>> = {
  fish: [1, 2, 3, 4, 5, 6, 7],
  junk: [1, 8, 2, 6, 7],
  squad: [1, 2],
};
export const variantsOf = (item: FishItem): readonly number[] => (item.fam ? FAMILY[item.fam] : []);

/** The dex shows the 方舟原物 only once their pictures and words may be (none yet) */
export const inDex = (item: FishItem) => item.cat !== "game";

/** The dex's cells: an item and each of its variants, a cell each */
export function dexCells(items: readonly FishItem[] = FISH_ITEMS): number {
  return items.filter(inDex).reduce((n, i) => n + 1 + variantsOf(i).length, 0);
}

/** Night for 月夜的: from 20:00 to 06:00 by the player's own clock */
export const isNight = (hour: number) => hour >= 20 || hour < 6;
