import { T } from "@/i18n";
import type { PassesDot } from "./passes";

/**
 * 转 ALL, 香艳制作人's wheel (src/lib/server/haimao.ts spinWheel): seven slices, one spin a player, for good, and only
 * for those 寻访 is open to (PASSES). Wherever the pointer stops, her hand (神之一手) pushes it on to ALL and every
 * slice is theirs at once: HAIMAO_WHEEL_TICKETS tickets into their 通行证, the badge HAIMAO_WHEEL_BADGE, her two
 * declarations (WHEEL_TEMPLATES, src/lib/declarations.ts) for good, and HAIMAO_WHEEL_LOVE more 好感度. All of it is
 * this site's, nothing of either game, as the wheel says under what it gave.
 */

export const HAIMAO_WHEEL_TICKETS = 3;
export const HAIMAO_WHEEL_LOVE = 5;
/** The badge it gives (src/lib/badges.ts): all 门信徒 */
export const HAIMAO_WHEEL_BADGE = "haimaoallmen";

/** The slices clockwise from the top, ALL first, as the design has them; an icon for each but ALL's */
export const WHEEL_SLICES = ["all", "ticket", "title", "say1", "say2", "ticket", "ticket"] as const;
export type WheelSlice = (typeof WHEEL_SLICES)[number];

/** A slice the pointer may stop on before her hand pushes it on: any but ALL (0) */
export const isLanded = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n < WHEEL_SLICES.length;

/** What a slice reads on the wheel (寻访券×1), and as she asks after it once the pointer stops (……寻访券？) */
export function sliceText(i: number) {
  const s = WHEEL_SLICES[i];
  return { label: T.guides.haimao.wheel.slice[s], short: T.guides.haimao.wheel.sliceShort[s] };
}

/**
 * A spin, as the server answers it: the slice the pointer stopped on, her 好感度 after it and what it added (0 when
 * they had spun already, again: then nothing more was given, and landed is that spin's), with the dot of the 寻访 button
 */
export type HaimaoSpin = { landed: number; love: number; plus: number; again: boolean } & PassesDot;
