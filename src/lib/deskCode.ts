/**
 * 登录码: a code a signed-in player takes (in 我的资料, or in Safari for the iPhone home-screen icon, which keeps
 * cookies of its own) and types into the site on another device to sign in there once (src/lib/server/deskCodes.ts). Eight
 * characters with nothing easy to misread (no 0 O 1 I L), shown as ABCD-EFGH; typed in any case,
 * with or without spaces and the dash.
 */

import { T } from "@/i18n";
export const DESK_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const DESK_CODE_LENGTH = 8;

/** What was typed, as a code to look up: upper case, without spaces or dashes */
export const normalizeDeskCode = (typed: unknown) =>
  String(typed ?? "")
    .toUpperCase()
    .replace(/[\s\-‐-―－]/g, "");

const WELL_FORMED = new RegExp(`^[${DESK_CODE_ALPHABET}]{${DESK_CODE_LENGTH}}$`);

/** Whether a normalized code could be one at all, so a mistyped one is not looked up */
export const isDeskCode = (code: string) => WELL_FORMED.test(code);

/** ABCDEFGH as ABCD-EFGH */
export const formatDeskCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** What every failed try is told, whichever way it failed */
export const deskCodeWrong = () => T.lib.deskCode.wrong;
