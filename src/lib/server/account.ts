import "server-only";
import { createHmac } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { secret } from "./env";
import { forgetLoginCodes } from "./loginCodes";
import { roachesChanged } from "./roachFeed";
import { bannedEmails, friendCuts, friendStars, users, type UserRow } from "./schema";
import { guestsLeave } from "./friendly";

/** Delete a player and everything tied to them (roaches, touches, declarations, friends, blocks, reports about them). */
export async function deleteAccount(user: UserRow) {
  // clones visiting their roaches go home first; their own visiting clones go with their roaches
  await guestsLeave(user.id);
  await db.delete(users).where(eq(users.id, user.id));
  if (user.email) await forgetLoginCodes(user.email);
  // the tables that name players without a foreign key
  await db.delete(friendCuts).where(or(eq(friendCuts.a, user.id), eq(friendCuts.b, user.id)));
  await db.delete(friendStars).where(eq(friendStars.other, user.id));
  roachesChanged();
}

// Keyed by AUTH_SECRET, so a new secret also forgets every ban
const banHash = (email: string) => createHmac("sha256", secret("AUTH_SECRET")).update(`ban|${email}`).digest("base64url");

/**
 * The ways of writing one mailbox that a ban covers: the address as given (trimmed, lower case), and,
 * when it differs, the same without what follows a 「+」 before the @, and for Gmail without the dots
 * either (googlemail.com is Gmail too). Mail to any of them lands in the same inbox.
 */
export function mailboxForms(email: string): string[] {
  const given = email.trim().toLowerCase();
  const at = given.lastIndexOf("@");
  if (at < 0) return [given];
  let local = given.slice(0, at);
  let domain = given.slice(at + 1);
  const plus = local.indexOf("+");
  // 「+tag@」 alone is not a mailbox of its own to fold into
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "") || local;
    domain = "gmail.com";
  }
  const plain = `${local}@${domain}`;
  return plain === given ? [given] : [given, plain];
}

/** Delete the account and refuse its email from now on, however it is written. Only HMACs are kept, never the address. */
export async function banAccount(user: UserRow) {
  if (user.email) {
    const hashes = mailboxForms(user.email).map((f) => ({ emailHash: banHash(f) }));
    await db.insert(bannedEmails).values(hashes).onConflictDoNothing();
  }
  await deleteAccount(user);
}

export const BANNED = "这个邮箱的账号被封了，不能再登录。";

/** Bans before 2026-11 kept only the address as it was written, so only that one finds them. */
export async function isBanned(email: string) {
  const hashes = mailboxForms(email).map(banHash);
  const [row] = await db.select().from(bannedEmails).where(inArray(bannedEmails.emailHash, hashes)).limit(1);
  return Boolean(row);
}
