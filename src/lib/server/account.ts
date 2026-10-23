import "server-only";
import { createHmac } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { db } from "./db";
import { secret } from "./env";
import { forgetLoginCodes } from "./loginCodes";
import { roachesChanged } from "./roachFeed";
import { bannedEmails, friendCuts, users, type UserRow } from "./schema";

/** Delete a player and everything tied to them (roaches, touches, declarations, friends, blocks, reports about them). */
export async function deleteAccount(user: UserRow) {
  await db.delete(users).where(eq(users.id, user.id));
  if (user.email) await forgetLoginCodes(user.email);
  // the one table that names players without a foreign key
  await db.delete(friendCuts).where(or(eq(friendCuts.a, user.id), eq(friendCuts.b, user.id)));
  roachesChanged();
}

// Keyed by AUTH_SECRET, so a new secret also forgets every ban
const banHash = (email: string) => createHmac("sha256", secret("AUTH_SECRET")).update(`ban|${email}`).digest("base64url");

/** Delete the account and refuse its email from now on. */
export async function banAccount(user: UserRow) {
  if (user.email) await db.insert(bannedEmails).values({ emailHash: banHash(user.email) }).onConflictDoNothing();
  await deleteAccount(user);
}

export const BANNED = "这个邮箱的账号被封了，不能再登录。";

export async function isBanned(email: string) {
  const [row] = await db.select().from(bannedEmails).where(eq(bannedEmails.emailHash, banHash(email))).limit(1);
  return Boolean(row);
}
