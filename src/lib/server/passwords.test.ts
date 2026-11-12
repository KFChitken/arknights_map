import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { banAccount, deleteAccount } from "./account";
import { db } from "./db";
import {
  currentWrong,
  firstPassword,
  firstWithoutCode,
  freshFor,
  FRESH_MS,
  NeedsCode,
  passwordLogin,
  passwordNudge,
  passwordSetAt,
  passwordWrong,
  removePassword,
  setPassword,
  type SessionRow,
} from "./passwords";
import { sessions, userPasswords, users } from "./schema";
import { me } from "./world";

// Gmail slow to take our mail, as on the live site since 2026-11-10 (emptied in place to say it no longer is),
// and an admin whose sign-in is a Gmail address
const slow = vi.hoisted(() => ["gmail.com", "googlemail.com"]);
vi.mock("./env", async (original) => ({
  ...(await original<typeof import("./env")>()),
  MAIL_SLOW_DOMAINS: slow,
  ADMIN_EMAILS: ["admin@gmail.com"],
}));

const MINUTE = 60_000;
const PW = "roach-in-the-rain";

async function player(email: string) {
  const [u] = await db.insert(users).values({ email }).returning();
  return u;
}

/** A session of the player, signed in this way this long ago */
async function session(userId: string, id: string, method: string, minutesAgo: number): Promise<SessionRow> {
  const createdAt = new Date(Date.now() - minutesAgo * MINUTE);
  await db.insert(sessions).values({ id, userId, method, createdAt, expiresAt: new Date(Date.now() + 20 * 86_400_000) });
  return { id, method, createdAt };
}

const pausedUntil = async (userId: string) => (await db.select().from(userPasswords).where(eq(userPasswords.userId, userId)))[0]?.pausedUntil ?? null;

/** What a call failed with, as the player would be told */
const said = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: Error) => e.message,
  );

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("signing in with a password", () => {
  it("signs in with the right one, and says the same for every way it can fail", async () => {
    const u = await player("p@example.com");
    await player("nopw@example.com");
    await firstPassword({ id: u.id, email: u.email! }, PW);
    expect(await passwordLogin(" P@Example.com ", PW)).toBe(u.id);
    expect(await said(passwordLogin("p@example.com", "not-the-one"))).toBe(passwordWrong());
    expect(await said(passwordLogin("nopw@example.com", PW))).toBe(passwordWrong());
    expect(await said(passwordLogin("nobody@example.com", PW))).toBe(passwordWrong());
    expect(await said(passwordLogin("", PW))).toBe(passwordWrong());
  }, 20_000);

  it("pauses from the fifth wrong try in a row, even for the right one, and a right one after starts the count again", async () => {
    const u = await player("p@example.com");
    await firstPassword({ id: u.id, email: u.email! }, PW);
    const now = Date.now();
    for (let i = 0; i < 4; i++) await said(passwordLogin("p@example.com", "wrong-guess", now));
    expect(await pausedUntil(u.id)).toBeNull();
    await said(passwordLogin("p@example.com", "wrong-guess", now));
    const until = (await pausedUntil(u.id))!.getTime();
    expect(until - now).toBeGreaterThan(14 * MINUTE);
    expect(until - now).toBeLessThan(16 * MINUTE);
    // paused: the right one too
    expect(await said(passwordLogin("p@example.com", PW, now + MINUTE))).toBe(passwordWrong());
    // after the pause
    expect(await passwordLogin("p@example.com", PW, now + 16 * MINUTE)).toBe(u.id);
    expect(await pausedUntil(u.id)).toBeNull();
    const [row] = await db.select().from(userPasswords).where(eq(userPasswords.userId, u.id));
    expect(row.fails).toBe(0);
  }, 30_000);

  it("pauses twice as long for every five more", async () => {
    const u = await player("p@example.com");
    await firstPassword({ id: u.id, email: u.email! }, PW);
    await db.update(userPasswords).set({ fails: 9 }).where(eq(userPasswords.userId, u.id));
    const now = Date.now();
    await said(passwordLogin("p@example.com", "wrong-guess", now));
    const until = (await pausedUntil(u.id))!.getTime();
    expect(until - now).toBeGreaterThan(29 * MINUTE);
    expect(until - now).toBeLessThan(31 * MINUTE);
    // never more than a day
    await db.update(userPasswords).set({ fails: 200, pausedUntil: null }).where(eq(userPasswords.userId, u.id));
    await said(passwordLogin("p@example.com", "wrong-guess", now));
    expect((await pausedUntil(u.id))!.getTime() - now).toBeLessThanOrEqual(24 * 60 * MINUTE + 1000);
  }, 20_000);

  it("lets nobody in once the account is banned or gone, and takes its password with it", async () => {
    const banned = await player("banned@example.com");
    const gone = await player("gone@example.com");
    await firstPassword({ id: banned.id, email: banned.email! }, PW);
    await firstPassword({ id: gone.id, email: gone.email! }, PW);
    await banAccount(banned, "spam");
    await deleteAccount(gone);
    expect(await said(passwordLogin("banned@example.com", PW))).toBe(passwordWrong());
    expect(await said(passwordLogin("gone@example.com", PW))).toBe(passwordWrong());
    expect(await db.select().from(userPasswords)).toHaveLength(0);
  }, 20_000);
});

describe("setting, changing and taking away a password", () => {
  it("takes a sign-in by code moments ago for the first one", async () => {
    const u = await player("p@example.com");
    const stale = await session(u.id, "stale", "code", FRESH_MS / MINUTE + 1);
    const desk = await session(u.id, "desk", "desk", 1);
    const fresh = await session(u.id, "fresh", "code", 5);
    await expect(setPassword(u, stale, PW, undefined)).rejects.toBeInstanceOf(NeedsCode);
    await expect(setPassword(u, desk, PW, undefined)).rejects.toBeInstanceOf(NeedsCode);
    expect(await passwordSetAt(u.id)).toBeNull();
    expect(await setPassword(u, fresh, PW, undefined)).toEqual({ changed: false });
    expect(await passwordSetAt(u.id)).not.toBeNull();
    // nothing else of the player's was signed out by a first password
    expect(await db.select().from(sessions)).toHaveLength(3);
  }, 20_000);

  it("changes it with the current one, or a fresh sign-in by code, and signs out every other device", async () => {
    const u = await player("p@example.com");
    await firstPassword({ id: u.id, email: u.email! }, PW);
    const here = await session(u.id, "here", "password", 60);
    await session(u.id, "phone", "code", 600);
    await session(u.id, "laptop", "desk", 6000);
    expect(await said(setPassword(u, here, "a-new-one-please", "not-the-one"))).toBe(currentWrong());
    expect(await setPassword(u, here, "a-new-one-please", PW)).toEqual({ changed: true });
    expect((await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id)).toEqual(["here"]);
    expect(await passwordLogin("p@example.com", "a-new-one-please")).toBe(u.id);
    // forgotten: a fresh sign-in by code is enough
    const fresh = await session(u.id, "fresh", "code", 2);
    expect(await setPassword(u, fresh, "and-another-one", undefined)).toEqual({ changed: true });
    expect(await passwordLogin("p@example.com", "and-another-one")).toBe(u.id);
  }, 30_000);

  it("turns away a password that will not do", async () => {
    const u = await player("wangxiaoming@qq.com");
    const fresh = await session(u.id, "fresh", "code", 1);
    expect(await said(setPassword(u, fresh, "12345678", undefined))).toMatch(/太常见/);
    expect(await said(setPassword(u, fresh, "wangxiaoming-123", undefined))).toMatch(/QQ 号/);
    expect(await said(firstPassword({ id: u.id, email: u.email! }, "short"))).toMatch(/至少/);
    expect(await passwordSetAt(u.id)).toBeNull();
  });

  it("takes it away with the current one, or a sign-in by code moments ago", async () => {
    const u = await player("p@example.com");
    await firstPassword({ id: u.id, email: u.email! }, PW);
    const here = await session(u.id, "here", "password", 60);
    expect(await said(removePassword(u.id, here, "not-the-one"))).toMatch(/不对/);
    expect(await said(removePassword(u.id, here, undefined))).toMatch(/不对/);
    expect(await passwordSetAt(u.id)).not.toBeNull();
    await removePassword(u.id, here, PW);
    expect(await passwordSetAt(u.id)).toBeNull();
    expect(await said(passwordLogin("p@example.com", PW))).toBe(passwordWrong());
    // forgotten: a fresh sign-in by code is enough
    await firstPassword({ id: u.id, email: u.email! }, PW);
    await removePassword(u.id, await session(u.id, "fresh", "code", 3), undefined);
    expect(await passwordSetAt(u.id)).toBeNull();
  }, 20_000);

  it("lets a player at a slow mail service set the first one without a code, and no more than that", async () => {
    const u = await player("doctor@gmail.com");
    const stale = await session(u.id, "stale", "code", FRESH_MS / MINUTE + 1);
    await session(u.id, "laptop", "desk", 600);
    expect(await setPassword(u, stale, PW, undefined)).toEqual({ changed: false });
    expect(await passwordLogin("doctor@gmail.com", PW)).toBe(u.id);
    // nothing else of the player's was signed out by a first password
    expect(await db.select().from(sessions)).toHaveLength(2);
    // a change takes the current one, as before
    expect(await said(setPassword(u, stale, "a-new-one-please", undefined))).toBe(currentWrong());
    expect(await said(setPassword(u, stale, "a-new-one-please", "not-the-one"))).toBe(currentWrong());
    expect(await passwordLogin("doctor@gmail.com", PW)).toBe(u.id);
    expect(await setPassword(u, stale, "a-new-one-please", PW)).toEqual({ changed: true });
    expect((await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id)).toEqual(["stale"]);
    // and so does taking it away
    expect(await said(removePassword(u.id, stale, undefined))).toMatch(/不对/);
    expect(await passwordSetAt(u.id)).not.toBeNull();
    // the service's other domain too, signed in any way
    const g = await player("doctor@googlemail.com");
    expect(await setPassword(g, await session(g.id, "desk", "desk", 1), PW, undefined)).toEqual({ changed: false });
  }, 30_000);

  it("still takes a code for an admin there, for any other address, and there once it is no longer slow", async () => {
    const admin = await player("admin@gmail.com");
    const other = await player("doctor@qq.com");
    const g = await player("doctor@gmail.com");
    for (const u of [admin, other]) {
      await expect(setPassword(u, await session(u.id, `stale-${u.id}`, "code", 600), PW, undefined)).rejects.toBeInstanceOf(NeedsCode);
    }
    slow.splice(0);
    try {
      await expect(setPassword(g, await session(g.id, "stale", "code", 600), PW, undefined)).rejects.toBeInstanceOf(NeedsCode);
    } finally {
      slow.push("gmail.com", "googlemail.com");
    }
    for (const u of [admin, other, g]) expect(await passwordSetAt(u.id)).toBeNull();
    // a sign-in by code moments ago is enough for every one of them, as before
    expect(await setPassword(admin, await session(admin.id, "fresh", "code", 2), PW, undefined)).toEqual({ changed: false });
  }, 20_000);

  it("has the map ask such a player to set one until they have it, and nobody else", async () => {
    const g = await player("doctor@gmail.com");
    const admin = await player("admin@gmail.com");
    const other = await player("doctor@qq.com");
    expect(await passwordNudge(g)).toBe(true);
    expect((await me(g.id))!.passwordNudge).toBe(true);
    expect(await passwordNudge(admin)).toBe(false);
    expect(await passwordNudge(other)).toBe(false);
    expect((await me(other.id))!.passwordNudge).toBe(false);
    expect(await passwordNudge({ id: g.id, email: null })).toBe(false);
    expect(firstWithoutCode(" Admin@Gmail.com ")).toBe(false);
    expect(firstWithoutCode("Doctor@GMAIL.com")).toBe(true);
    slow.splice(0);
    try {
      expect(await passwordNudge(g)).toBe(false);
    } finally {
      slow.push("gmail.com", "googlemail.com");
    }
    await setPassword(g, await session(g.id, "stale", "code", 600), PW, undefined);
    expect(await passwordNudge(g)).toBe(false);
    expect((await me(g.id))!.passwordNudge).toBe(false);
  }, 20_000);

  it("says how much longer a sign-in by code counts as moments ago", () => {
    const now = Date.now();
    expect(freshFor({ method: "code", createdAt: new Date(now - 10 * MINUTE) }, now)).toBe(FRESH_MS - 10 * MINUTE);
    expect(freshFor({ method: "code", createdAt: new Date(now - FRESH_MS - 1) }, now)).toBe(0);
    expect(freshFor({ method: "password", createdAt: new Date(now) }, now)).toBe(0);
    expect(freshFor({ method: "desk", createdAt: new Date(now) }, now)).toBe(0);
  });
});
