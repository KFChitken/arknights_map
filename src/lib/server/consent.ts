import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { TICK_MISSING, type Tick } from "../consent";
import { POLICY_UPDATED_AT } from "../rules";
import { db } from "./db";
import { HttpError } from "./http";
import { users, type UserRow } from "./schema";

/** The fixed refusal the map answers with 「隐私说明更新了」 (HTTP 428). */
export const RECONSENT_NEEDED = "隐私说明更新了，同意以后才能继续。";

/**
 * Accounts that agreed to an older privacy policy, or signed up before the separate
 * consents existed, agree again before doing anything others see. Demo players never do.
 */
export const mustReconsent = (u: UserRow) =>
  !u.demoKey && (!u.policyAcceptedAt || u.policyAcceptedAt < POLICY_UPDATED_AT || !u.crossBorderAcceptedAt);

/** Agreed that the roaches they put down show their exact spot to everyone, visitors included. */
export const agreedPublicPlace = (u: UserRow) => Boolean(u.demoKey || u.publicPlaceAcceptedAt);

/** Throws the message for the first tick the request body leaves out. */
export function requireTicks(body: Record<string, unknown>, ticks: Tick[]) {
  const missing = ticks.find((t) => body[t] !== true);
  if (missing) throw new HttpError(400, TICK_MISSING[missing]);
}

/** 隐私说明更新了: everything an older account ticked, as of now. */
export async function agreeAgain(userId: string) {
  const now = new Date();
  await db
    .update(users)
    .set({ ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .where(eq(users.id, userId));
}

/** 「确认」 on the card before a player's first roach; the first time given is kept. */
export async function acceptPublicPlace(userId: string) {
  await db
    .update(users)
    .set({ publicPlaceAcceptedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.publicPlaceAcceptedAt)));
}
