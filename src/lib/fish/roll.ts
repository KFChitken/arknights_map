import {
  FISH_ITEMS,
  GIANT,
  isNight,
  KIND_ODDS,
  MINI,
  MOON,
  ODDS_WEIGHT,
  SIZE_GIANT,
  SIZE_MINI,
  TIER_ODDS,
  VARIANT_CHANCE,
  variantsOf,
  type FishItem,
  type FishSpot,
} from "./items";
import { PITY_AFTER, SCHOOL_BOOST, type FishShadow } from "./rules";

/**
 * What is on the hook, drawn as the line goes in (src/lib/server/fish.ts cast). 寻访券 and 漂流瓶 first, each at its
 * own chance (KIND_ODDS) while the server says it may come (the day's, the wallet's room, PASSES), never from the net,
 * whatever the pity or a 鱼群; one that may not come is no share at all. Else the tier (TIER_ODDS; blue or better once
 * PITY_AFTER casts in a row had none), then an item of it that may bite there and then, by its odds; a tier with none
 * drops to the one under it. Fish, junk and 卫戍限定 come as a variant now and then (月夜的 only at night); measured
 * ones get a size, smaller more often than not. The shadow by the float follows the size, else the tier.
 */

/** What decides a cast */
export type RollAsk = {
  spot: FishSpot;
  /** Casts in a row today with nothing blue or better */
  dry: number;
  /** The hour by the player's own clock; -1 none (only what bites at any hour, and no 月夜的) */
  hour: number;
  /** Others on the bank with a line in the water */
  crowd: number;
  /** How many of an item (by number) the player caught, any variant */
  caught: (no: number) => number;
  /** A 寻访券 may come: PASSES lets the player draw, the day's TICKETS_A_DAY are not all given, the wallet has room */
  ticket?: boolean;
  /** A 漂流瓶 may come: PASSES lets the player draw, and none came today */
  bottle?: boolean;
  /** 卫戍池塘: real players in the room with a line in, this cast's included */
  together?: number;
  /** 卫戍池塘: a 鱼群 is on, blue and better SCHOOL_BOOST times as likely */
  school?: boolean;
  random: () => number;
};

export type Roll = { no: number; variant: number; cm: number | null; tier: number; shadow: FishShadow };

/** Whether an item may bite here and now */
export function mayBite(item: FishItem, ask: Omit<RollAsk, "dry" | "random">): boolean {
  if (item.off || item.cat === "game" || !item.at[ask.spot]) return false;
  if ((item.kind === "ticket" && !ask.ticket) || (item.kind === "bottle" && !ask.bottle)) return false;
  // 自动钓: grey, green and blue only, no 通行证 things
  if (ask.spot === "auto" && (item.tier > 3 || item.kind)) return false;
  const w = item.when;
  if (!w) return true;
  if (w.hours && (ask.hour < 0 || !inHours(ask.hour, w.hours))) return false;
  if (w.crowd && (ask.spot !== "pier" || ask.crowd < w.crowd)) return false;
  if (w.after && ask.caught(w.after[0]) < w.after[1]) return false;
  // four fishing together in 卫戍池塘
  if (w.squad4 && (ask.spot !== "pond" || (ask.together ?? 0) < 4)) return false;
  // 一起听, after 龙门广场舞 (later parts)
  if (w.listen || w.dance) return false;
  return true;
}

const inHours = (hour: number, [from, to]: [number, number]) => (from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** One of the weights, by a draw in [0, 1) */
function pick<T>(list: readonly T[], weight: (t: T) => number, r: number): T {
  const total = list.reduce((s, t) => s + weight(t), 0);
  let x = r * total;
  for (const t of list) {
    x -= weight(t);
    if (x < 0) return t;
  }
  return list[list.length - 1];
}

/** The shadow by the float of an item with no size, by its tier */
const shadowOf = (tier: number): FishShadow => (tier <= 2 ? "s" : tier <= 4 ? "m" : "l");

/** Casts in a row with nothing blue or better, after one more of this tier */
export const dryAfter = (dry: number, tier: number) => (tier >= 3 ? 0 : dry + 1);
/** Junk catches in a row, after one more of this item (寻访券 and 漂流瓶 are not junk here) */
export const junkAfter = (run: number, item: Pick<FishItem, "cat" | "kind">) => (item.cat === "junk" && !item.kind ? run + 1 : 0);

/**
 * tier: this one rather than one drawn (a 寻访券 or 漂流瓶 that may no longer come by the pull: something else of its
 * tier, else under it)
 */
export function rollCatch(ask: RollAsk, items: readonly FishItem[] = FISH_ITEMS, tier?: number): Roll {
  // the 通行证 things, on their own (a draw spent only where one may come)
  if (tier === undefined) {
    const kinds = items.filter((i) => i.kind && KIND_ODDS[i.kind] && mayBite(i, ask));
    if (kinds.length) {
      let x = ask.random() * 100;
      for (const item of kinds) {
        x -= KIND_ODDS[item.kind!]!;
        if (x < 0) return { no: item.no, variant: 0, cm: null, tier: item.tier, shadow: shadowOf(item.tier) };
      }
    }
  }
  const pity = ask.dry >= PITY_AFTER;
  // 自动钓 never goes past blue; after a dry spell, nothing under blue
  const top = ask.spot === "auto" ? 3 : 6;
  const floor = pity ? 3 : 1;
  const tiers = [1, 2, 3, 4, 5, 6].filter((t) => t <= top && t >= floor);
  const drawn = tier ?? pick(tiers, (t) => TIER_ODDS[t - 1] * (ask.school && t >= 3 ? SCHOOL_BOOST : 1), ask.random());
  // a tier with nothing that may bite: the one under it, else (down to the floor) the one over it
  const order = [...tiers.filter((t) => t <= drawn).reverse(), ...tiers.filter((t) => t > drawn)];
  let can: FishItem[] = [];
  for (const t of order) {
    can = items.filter((i) => i.tier === t && !i.kind && mayBite(i, ask));
    if (can.length) break;
  }
  if (!can.length) throw new Error(`nothing bites at ${ask.spot}`);
  const item = pick(can, (i) => ODDS_WEIGHT[i.at[ask.spot]!], ask.random());
  // a variant now and then (none from the net)
  let variant = 0;
  const fam = ask.spot === "auto" ? [] : variantsOf(item).filter((v) => v !== MOON || (ask.hour >= 0 && isNight(ask.hour)));
  if (fam.length && ask.random() < VARIANT_CHANCE) variant = fam[Math.min(fam.length - 1, Math.floor(ask.random() * fam.length))];
  let cm: number | null = null;
  let shadow = shadowOf(item.tier);
  if (item.cm) {
    const [lo, hi] = item.cm;
    const f = Math.pow(ask.random(), 2);
    const scale = variant === MINI ? SIZE_MINI : variant === GIANT ? SIZE_GIANT : 1;
    cm = Math.max(1, Math.round((lo + (hi - lo) * f) * scale * 100));
    shadow = variant === GIANT ? "l" : variant === MINI ? "s" : f < 1 / 3 ? "s" : f < 2 / 3 ? "m" : "l";
  }
  return { no: item.no, variant, cm, tier: item.tier, shadow };
}
