import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_DAYS } from "../rules";
import { db } from "./db";
import { secret } from "./env";
import { sessions, users, type UserRow } from "./schema";

const SESSION_COOKIE = "sid";
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

export async function startSession(req: NextRequest, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt: expires });
  (await cookies()).set(SESSION_COOKIE, token, { ...cookieBase(req), expires });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
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
