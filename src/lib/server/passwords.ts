import "server-only";
import { eq, sql } from "drizzle-orm";
import { passwordProblem } from "../passwordRules";
import { isBanned } from "./account";
import { endSessionsExcept } from "./auth";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { isSlowMail } from "./mailQuota";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwordHash";
import { userPasswords, users } from "./schema";
import { note } from "./signals";

/**
 * 密码登录: a player may set a password (as an scrypt digest only, passwordHash.ts), and sign in with their
 * email and it instead of an emailed code. Setting the first one, or one forgotten, takes a sign-in by
 * code moments before (FRESH_MS), so being signed in somehow is never enough to take over an account;
 * changing it takes the current one or that, and signs out every other device. Wrong tries pause it.
 * One exception (firstWithoutCode): the first password of a player at a mail service our codes hardly
 * reach just now.
 */

export const passwordWrong = () => "邮箱或密码不对。没设过密码的话，用验证码登录。";
export const needsCode = () => "为了确认是你本人，先用验证码登录一次再设密码。";
export const currentWrong = () => "现在的密码不对。忘了的话，先用验证码登录一次再改。";
/** A sign-in by emailed code this recent counts as the player themself */
export const FRESH_MS = 30 * 60_000;
/** Wrong tries in a row before the password pauses: 15 minutes, twice as long for every PAUSE_FROM more, a day at most */
export const PAUSE_FROM = 5;

/** The session must be a sign-in by code moments ago; the page then offers one (needsCode) */
export class NeedsCode extends HttpError {
  constructor() {
    super(403, needsCode());
  }
}

export type SessionRow = { id: string; method: string; createdAt: Date };

/** How much longer a session counts as signed in by an emailed code moments ago (0: not, or no longer) */
export const freshFor = (s: Pick<SessionRow, "method" | "createdAt">, now = Date.now()) =>
  s.method === "code" ? Math.max(0, FRESH_MS - (now - s.createdAt.getTime())) : 0;

/** Signed in by an emailed code within FRESH_MS */
export const isFresh = (s: Pick<SessionRow, "method" | "createdAt">, now = Date.now()) => freshFor(s, now) > 0;

/**
 * Whether a signed-in player may set their first password without a sign-in by code moments before: their
 * address is at a mail service slow to take our mail just now (MAIL_SLOW_DOMAINS), whose codes may not
 * arrive at all, so the code would lock them out of a password. Never an admin account: a stolen sign-in of
 * theirs would keep its way in with a password. Changing a password or taking it away still takes the
 * current one or a code, as a change would also sign the player out everywhere else.
 */
export const firstWithoutCode = (email: string | null) =>
  Boolean(email && isSlowMail(email) && !ADMIN_EMAILS.includes(email.trim().toLowerCase()));

/**
 * The map asks such a player (firstWithoutCode) once to set a password while they are still signed in, as
 * without one a new phone or computer could not sign in. The password is looked up only for them (some 4%).
 */
export async function passwordNudge(user: { id: string; email: string | null }): Promise<boolean> {
  if (!firstWithoutCode(user.email)) return false;
  return (await passwordSetAt(user.id)) === null;
}

const normalEmail = (email: unknown) =>
  String(email ?? "")
    .trim()
    .toLowerCase();

/**
 * The account an email and password sign in. Every way it can fail (no such account, no password,
 * paused, wrong, banned) says the same, after the same work, so none tells whether an email has an
 * account or a password.
 */
export async function passwordLogin(emailIn: unknown, passwordIn: unknown, now = Date.now()): Promise<string> {
  const email = normalEmail(emailIn);
  const password = String(passwordIn ?? "");
  const wrong = (why: "none" | "paused" | "wrong" | "banned") => {
    note("passwordFail", why);
    return new HttpError(400, passwordWrong());
  };
  const [row] = email
    ? await db
        .select({ id: users.id, hash: userPasswords.hash, pausedUntil: userPasswords.pausedUntil })
        .from(users)
        .innerJoin(userPasswords, eq(userPasswords.userId, users.id))
        .where(eq(users.email, email))
        .limit(1)
    : [];
  if (!row) {
    await verifyPassword(DUMMY_HASH, password);
    throw wrong("none");
  }
  if (row.pausedUntil && row.pausedUntil.getTime() > now) {
    await verifyPassword(DUMMY_HASH, password);
    throw wrong("paused");
  }
  if (!(await verifyPassword(row.hash, password))) {
    // counted and paused in one statement, so every process sees the same count (2^7 quarters of an hour are past
    // the day already: no bigger power, nor count, that could overflow)
    await db
      .update(userPasswords)
      .set({
        fails: sql`least(${userPasswords.fails} + 1, 10000)`,
        pausedUntil: sql`case when ${userPasswords.fails} + 1 >= ${PAUSE_FROM}
          then ${new Date(now).toISOString()}::timestamptz + least(interval '15 minutes' * power(2, least((${userPasswords.fails} + 1) / ${PAUSE_FROM} - 1, 7)), interval '24 hours')
          else ${userPasswords.pausedUntil} end`,
      })
      .where(eq(userPasswords.userId, row.id));
    throw wrong("wrong");
  }
  if (await isBanned(email)) throw wrong("banned");
  await db.update(userPasswords).set({ fails: 0, pausedUntil: null }).where(eq(userPasswords.userId, row.id));
  return row.id;
}

/** When the player set their password, or null without one */
export async function passwordSetAt(userId: string): Promise<number | null> {
  const [row] = await db.select({ setAt: userPasswords.setAt }).from(userPasswords).where(eq(userPasswords.userId, userId)).limit(1);
  return row ? row.setAt.getTime() : null;
}

async function store(userId: string, password: string, now: number) {
  const hash = await hashPassword(password);
  const set = { hash, setAt: new Date(now), fails: 0, pausedUntil: null };
  await db
    .insert(userPasswords)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: userPasswords.userId, set });
}

/** The password picked while signing up (optional there): the email was verified a moment ago */
export async function firstPassword(user: { id: string; email: string }, passwordIn: unknown, now = Date.now()) {
  const password = String(passwordIn ?? "");
  const problem = passwordProblem(password, user.email);
  if (problem) throw new HttpError(400, problem);
  await store(user.id, password, now);
}

/**
 * Set a password, or change it. The first, or one forgotten, takes a fresh sign-in by code (NeedsCode),
 * but for the first at a slow mail service (firstWithoutCode); a change takes the current password or
 * that. A change signs out every other device of the player.
 */
export async function setPassword(
  user: { id: string; email: string | null },
  session: SessionRow,
  passwordIn: unknown,
  current: unknown,
  now = Date.now(),
): Promise<{ changed: boolean }> {
  const password = String(passwordIn ?? "");
  const problem = passwordProblem(password, user.email ?? "");
  if (problem) throw new HttpError(400, problem);
  const [row] = await db.select({ hash: userPasswords.hash }).from(userPasswords).where(eq(userPasswords.userId, user.id)).limit(1);
  if (!isFresh(session, now)) {
    if (!row) {
      if (!firstWithoutCode(user.email)) throw new NeedsCode();
    } else if (typeof current !== "string" || !current || !(await verifyPassword(row.hash, current))) {
      throw new HttpError(400, currentWrong());
    }
  }
  await store(user.id, password, now);
  if (row) await endSessionsExcept(user.id, session.id);
  return { changed: Boolean(row) };
}

/** No password any more: with the current one, or a sign-in by code moments ago (one forgotten) */
export async function removePassword(userId: string, session: Pick<SessionRow, "method" | "createdAt">, current: unknown, now = Date.now()) {
  const [row] = await db.select({ hash: userPasswords.hash }).from(userPasswords).where(eq(userPasswords.userId, userId)).limit(1);
  if (!row) return;
  if (!isFresh(session, now) && (typeof current !== "string" || !current || !(await verifyPassword(row.hash, current)))) {
    throw new HttpError(400, "现在的密码不对。忘了的话，先用验证码登录一次再取消。");
  }
  await db.delete(userPasswords).where(eq(userPasswords.userId, userId));
}
