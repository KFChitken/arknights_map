import type { FishSpot } from "./items";

/**
 * 钓鳞 (src/lib/server/fish.ts): the rules both sides go by. The server decides everything (when it bites, what is on
 * the hook, how big, whether the pull was on time, the day's casts); the page only draws it.
 */

/** Casts a site day (from 04:00 Beijing time), the bank, 卫戍池塘 and 自动钓 together */
export const CASTS_A_DAY = 100;
/** A cast bites this long after it goes in, at the soonest and the latest */
export const BITE_MIN_MS = 20_000;
export const BITE_MAX_MS = 180_000;
/** Once it bites, a yellow ring closes in on the float every RING_MS; pulled in its last PERFECT_MS, it is on time */
export const RING_MS = 1_400;
export const PERFECT_MS = 400;
/**
 * A pull that reaches the server just after a ring closed still counts as on time, for the time it took to get here
 * (the server judges by its own clock)
 */
export const PERFECT_GRACE_MS = 150;
/** After this many casts in a row with nothing blue or better, the next is blue or better (the day's, by the server) */
export const PITY_AFTER = 8;
/** This many junk catches in a row in a day make the player that day's 空军司令 */
export const ADMIRAL_AFTER = 10;
/** Purple or better: said on the bank (no name), and in the room in 卫戍池塘 */
export const SHOUT_TIER = 4;
/** How often the bank's page asks how things stand there */
export const BANK_POLL_MS = 15_000;
/** 吱, the player's own roach, once every so often (only they hear it) */
export const ZHI_EVERY_MS = 3_000;

/** The refusals the page tells apart: the day's casts gone, not bitten yet, no line in */
export const FISH_FULL = "FISH_FULL";
export const FISH_NOT_YET = "FISH_NOT_YET";
export const FISH_NO_LINE = "FISH_NO_LINE";

/** Whether a pull this long after the bite is on time: in a ring's last PERFECT_MS, or just after it (the grace) */
export function onTime(sinceBite: number): boolean {
  if (sinceBite < 0) return false;
  const inRing = sinceBite % RING_MS;
  return inRing >= RING_MS - PERFECT_MS || (sinceBite >= RING_MS && inRing < PERFECT_GRACE_MS);
}

/** When a cast bites: 20 s to 3 min after it goes in, sooner more often than not */
export const biteAfter = (random: () => number) => Math.round(BITE_MIN_MS + (BITE_MAX_MS - BITE_MIN_MS) * Math.pow(random(), 1.6));

/** A shadow by the float while waiting: the bigger it is, the bigger what is on the hook */
export type FishShadow = "s" | "m" | "l";

/** The line in the water, as the page is told: where, when it went in and bites (ms, the server's clock), and its shadow */
export type FishLine = { spot: FishSpot; castAt: number; biteAt: number; shadow: FishShadow };

/** A catch, as the page is told once it is pulled in */
export type FishCatch = {
  no: number;
  variant: number;
  /** Size in hundredths of a cm, for those measured */
  cm: number | null;
  tier: number;
  onTime: boolean;
  /** The first of this one (variant apart) the player caught */
  first: boolean;
  /** Bigger than any of this one the player caught before */
  record: boolean;
  /** Times caught now, this one included */
  n: number;
  /** The site's biggest of this one now, for those measured (who caught it is never said) */
  top: number | null;
};

/** A purple-or-better catch said on the bank, nobody named: what and how big */
export type FishShout = { id: number; no: number; variant: number; cm: number | null };

/** How the bank stands for the player (POST /api/fish/state, and after each step) */
export type FishState = {
  now: number;
  day: string;
  casts: number;
  line: FishLine | null;
  /** Dex cells caught, and all of them */
  owned: number;
  cells: number;
  /** Others on the bank with a line in the water */
  bank: number;
  /** 空军司令 today */
  admiral: boolean;
  shouts: FishShout[];
};

/** The player's dex: each cell caught (item, variant), and the site's biggest of each measured one */
export type FishDexEntry = { no: number; variant: number; n: number; best: number | null; firstAt: number; firstSpot: FishSpot };
export type FishDex = { mine: FishDexEntry[]; records: { no: number; variant: number; cm: number }[] };
