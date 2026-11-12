import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_DAYS } from "../rules";
import { db } from "./db";
import { secret } from "./env";
import { sessions, users, type UserRow } from "./schema";

export const SESSION_COOKIE = "sid";
const SIGNUP_COOKIE = "signup";
const SIGNUP_MIN = 15;

const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const sign = (s: string) => createHmac("sha256", secret("AUTH_SECRET")).update(s).digest("base64url");

function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieBase(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return { httpOnly: true, sameSite: "lax" as const, secure: proto === "https", path: "/" };
}

/** How a session signed in: an emailed code, a 登录码 taken on another device, a password, or a test identity */
export type SessionMethod = "code" | "desk" | "password" | "dev";

export async function startSession(req: NextRequest, userId: string, method: SessionMethod = "code") {
  const jar = await cookies();
  // the session this browser was signed in with till now (signing in again, say to confirm it is the player
  // by code) ends with it: nothing could use it once its cookie is gone
  const old = jar.get(SESSION_COOKIE)?.value;
  if (old) {
    await db.delete(sessions).where(eq(sessions.id, sha256(old)));
    checked.delete(sha256(old));
  }
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt: expires, method });
  jar.set(SESSION_COOKIE, token, { ...cookieBase(req), expires });
}

// Renewed at most once a day: only a session with less than SESSION_DAYS - 1 days left is written
const renewQuery = db
  .update(sessions)
  .set({ expiresAt: sql`now() + interval '${sql.raw(String(SESSION_DAYS))} days'` })
  .where(
    and(
      eq(sessions.id, sql.placeholder("id")),
      gt(sessions.expiresAt, sql`now()`),
      lt(sessions.expiresAt, sql`now() + interval '${sql.raw(String(SESSION_DAYS - 1))} days'`),
    ),
  )
  .returning({ expiresAt: sessions.expiresAt })
  .prepare("renew_session");

/** A session (by its stored id) running SESSION_DAYS from now, at most once a day: its new end, or null when nothing changed */
export async function renewSessionById(id: string): Promise<Date | null> {
  const [row] = await renewQuery.execute({ id });
  return row?.expiresAt ?? null;
}

/**
 * Coming back keeps a player signed in: SESSION_DAYS are days without opening the site, not since signing
 * in. From the world route's "me", which every page asks on opening (only a route handler sets cookies).
 */
export async function renewSession(req: NextRequest) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const expires = await renewSessionById(sha256(token));
  if (expires) jar.set(SESSION_COOKIE, token, { ...cookieBase(req), expires });
}

/** Every session of this player but the one kept ends; how many did */
export async function endSessionsExcept(userId: string, keepId: string) {
  const gone = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepId)))
    .returning({ id: sessions.id });
  for (const { id } of gone) checked.delete(id);
  return gone.length;
}

/** 退出其他设备: the player's sessions on other phones and computers end, this one stays */
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? endSessionsExcept(userId, sha256(token)) : 0;
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, sha256(token)));
    checked.delete(sha256(token));
  }
  jar.delete(SESSION_COOKIE);
}

/**
 * How long this process believes a session is signed in once it has looked (sessionAlive). One ended
 * meanwhile on another device, or in another process, still gets the roach list until then: what any
 * signed-in player sees anyway.
 */
export const SESSION_CHECK_MS = 10 * 60_000;
/** How long a token found to sign nobody in is believed so: made-up cookies cost a lookup a minute each */
const SIGNED_OUT_MS = 60_000;
const CHECKS_KEPT = 100_000;
// by session id: until when the answer holds, and whether it signs someone in
const checked = new Map<string, { until: number; alive: boolean }>();

const aliveQuery = db
  .select({ expiresAt: sessions.expiresAt })
  .from(sessions)
  .where(and(eq(sessions.id, sql.placeholder("id")), gt(sessions.expiresAt, sql`now()`)))
  .limit(1)
  .prepare("session_alive");

/**
 * Whether a session token signs someone in, for the roach list every signed-in page asks for every two
 * minutes: kept for SESSION_CHECK_MS (never past the session's end), so the sessions table is read about
 * once per page per ten minutes, and the player's own row not at all.
 */
export async function sessionAlive(token: string, now = Date.now()): Promise<boolean> {
  const id = sha256(token);
  const known = checked.get(id);
  if (known && known.until > now) return known.alive;
  const [row] = await aliveQuery.execute({ id });
  if (checked.size >= CHECKS_KEPT) {
    for (const [k, c] of checked) if (c.until <= now) checked.delete(k);
    // still full, of made-up tokens: start again
    if (checked.size >= CHECKS_KEPT) checked.clear();
  }
  const until = row ? Math.min(now + SESSION_CHECK_MS, row.expiresAt.getTime()) : now + SIGNED_OUT_MS;
  checked.set(id, { until, alive: Boolean(row) });
  return Boolean(row);
}

/** Tests: nothing believed about any session */
export function forgetSessionChecks() {
  checked.clear();
}

/**
 * The session this request is signed in with, as stored (how and when it signed in): whether it signed
 * in by code a moment ago decides what it may do to a password (src/lib/server/passwords.ts)
 */
export async function currentSession(): Promise<{ id: string; userId: string; method: string; createdAt: Date } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId, method: sessions.method, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

// Every request asks who sent it: the statement is put together once, not by drizzle on each request
// (on 2026-11-10 putting queries together was the biggest single use of the site's CPU)
const currentUserQuery = db
  .select({ user: users })
  .from(sessions)
  .innerJoin(users, eq(users.id, sessions.userId))
  .where(and(eq(sessions.id, sql.placeholder("id")), gt(sessions.expiresAt, sql`now()`)))
  .limit(1)
  .prepare("current_user");

export async function currentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await currentUserQuery.execute({ id: sha256(token) });
  return row?.user ?? null;
}

/** Signed, short-lived proof that this browser just verified `email`; lets a new player finish signing up. */
export async function setSignupProof(req: NextRequest, email: string) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SIGNUP_MIN * 60_000 })).toString("base64url");
  (await cookies()).set(SIGNUP_COOKIE, `${payload}.${sign(`signup|${payload}`)}`, {
    ...cookieBase(req),
    maxAge: SIGNUP_MIN * 60,
  });
}

export async function readSignupProof(): Promise<string | null> {
  const raw = (await cookies()).get(SIGNUP_COOKIE)?.value;
  const [payload, sig] = raw?.split(".") ?? [];
  if (!payload || !sig || !sameString(sign(`signup|${payload}`), sig)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof email === "string" && Date.now() < exp ? email : null;
  } catch {
    return null;
  }
}

export async function clearSignupProof() {
  (await cookies()).delete(SIGNUP_COOKIE);
}

/** Development only: remember who you really are while stepping into demo players. */
const HOME_COOKIE = "dev_home";
export async function homeUserId() {
  const raw = (await cookies()).get(HOME_COOKIE)?.value;
  const [id, sig] = raw?.split(".") ?? [];
  return id && sig && sameString(sign(`home|${id}`), sig) ? id : null;
}
export async function setHomeUserId(req: NextRequest, id: string | null) {
  const jar = await cookies();
  if (!id) jar.delete(HOME_COOKIE);
  else jar.set(HOME_COOKIE, `${id}.${sign(`home|${id}`)}`, { ...cookieBase(req), maxAge: 30 * 86_400 });
}
