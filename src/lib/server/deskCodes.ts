import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { T } from "@/i18n";
import { DESK_CODE_ALPHABET, DESK_CODE_LENGTH, isDeskCode, normalizeDeskCode } from "../deskCode";
import { DESK_CODE_TTL_MIN, DESK_CODES_PER_HOUR } from "../rules";
import { countApp } from "./appCounts";
import { db } from "./db";
import { secret } from "./env";
import { HttpError } from "./http";
import { allow } from "./rateLimit";
import { deskCodes } from "./schema";

/**
 * 登录码 (src/lib/deskCode.ts). A signed-in player takes one in the browser; typed into the site on another
 * device (or opened from the iPhone home-screen icon), it starts a session there once. One code per account (a new one
 * replaces the old), working DESK_CODE_TTL_MIN, used once; only its HMAC is kept.
 */

const MINUTE = 60_000;

const hashOf = (code: string) => createHmac("sha256", secret("AUTH_SECRET")).update(`desk|${code}`).digest("base64url");

function newCode() {
  let code = "";
  for (let i = 0; i < DESK_CODE_LENGTH; i++) code += DESK_CODE_ALPHABET[randomInt(DESK_CODE_ALPHABET.length)];
  return code;
}

/** Whether an insert ran into the unique index on code_hash: another account holds the same code just now */
function sameCodeTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown } | null;
  if (!err || typeof err !== "object") return false;
  return (err.code === "23505" && err.constraint_name === "desk_codes_code_hash_unique") || sameCodeTaken(err.cause);
}

/** A new code for this account, and when it stops working; at most DESK_CODES_PER_HOUR an hour */
export async function issueDeskCode(userId: string, now = Date.now()): Promise<{ code: string; expiresAt: number }> {
  if (!allow(`deskcode-get:${userId}`, DESK_CODES_PER_HOUR, 60 * MINUTE)) throw new HttpError(429, T.server.deskCodes.hourUsedUp);
  const createdAt = new Date(now);
  const expiresAt = new Date(now + DESK_CODE_TTL_MIN * MINUTE);
  for (let tries = 0; ; tries++) {
    const code = newCode();
    const row = { codeHash: hashOf(code), createdAt, expiresAt, usedAt: null };
    try {
      await db
        .insert(deskCodes)
        .values({ userId, ...row })
        .onConflictDoUpdate({ target: deskCodes.userId, set: row });
      countApp("code-issued", now);
      return { code, expiresAt: expiresAt.getTime() };
    } catch (e) {
      if (!sameCodeTaken(e) || tries >= 2) throw e;
    }
  }
}

/**
 * The account a typed code signs in, or null when it is no code, used, run out or unknown. Marked
 * used in the same statement that finds it, so two requests with one code sign in once.
 */
export async function redeemDeskCode(typed: unknown, now = Date.now()): Promise<string | null> {
  const code = normalizeDeskCode(typed);
  if (!isDeskCode(code)) return null;
  const at = new Date(now);
  const [row] = await db
    .update(deskCodes)
    .set({ usedAt: at })
    .where(and(eq(deskCodes.codeHash, hashOf(code)), isNull(deskCodes.usedAt), gt(deskCodes.expiresAt, at)))
    .returning({ userId: deskCodes.userId });
  return row?.userId ?? null;
}

/** Codes run out: nothing left to sign in with (src/lib/server/retention.ts) */
export async function pruneDeskCodes(now = Date.now()) {
  await db.delete(deskCodes).where(lt(deskCodes.expiresAt, new Date(now)));
}
