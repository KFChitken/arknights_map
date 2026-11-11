import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { endSessionsExcept, renewSessionById } from "./auth";
import { db } from "./db";
import { pruneOldActivity } from "./retention";
import { sessions, users } from "./schema";

const DAY_MS = 86_400_000;

async function player(email: string) {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  return u.id;
}

/** A session for a player, ending this many days from now (negative: ended that long ago) */
async function session(userId: string, id: string, daysLeft: number) {
  await db.insert(sessions).values({ id, userId, expiresAt: new Date(Date.now() + daysLeft * DAY_MS) });
}

const endOf = async (id: string) => (await db.select({ at: sessions.expiresAt }).from(sessions).where(eq(sessions.id, id)))[0]?.at;

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("sessions", () => {
  it("runs a session in use 30 days from now again, at most once a day, and never one that ran out", async () => {
    const u = await player("p@example.com");
    await session(u, "fresh", 29.5);
    await session(u, "older", 10);
    await session(u, "gone", -0.001);

    // signed in less than a day ago: nothing written
    expect(await renewSessionById("fresh")).toBeNull();
    const renewed = await renewSessionById("older");
    expect(renewed!.getTime()).toBeGreaterThan(Date.now() + 29.9 * DAY_MS);
    // the same day again: nothing written
    expect(await renewSessionById("older")).toBeNull();
    expect((await endOf("older"))!.getTime()).toBe(renewed!.getTime());

    expect(await renewSessionById("gone")).toBeNull();
    expect((await endOf("gone"))!.getTime()).toBeLessThan(Date.now());
  });

  it("ends a player's other sessions and keeps the one asking, and nobody else's", async () => {
    const u = await player("p@example.com");
    const other = await player("q@example.com");
    await session(u, "phone", 20);
    await session(u, "laptop", 20);
    await session(u, "this", 20);
    await session(other, "theirs", 20);

    expect(await endSessionsExcept(u, "this")).toBe(2);
    const left = (await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id).sort();
    expect(left).toEqual(["theirs", "this"]);
  });

  it("forgets sessions that ran out more than a day ago", async () => {
    const u = await player("p@example.com");
    await session(u, "long-gone", -2);
    await session(u, "just-gone", -0.5);
    await session(u, "live", 20);

    await pruneOldActivity();
    const left = (await db.select({ id: sessions.id }).from(sessions)).map((s) => s.id).sort();
    expect(left).toEqual(["just-gone", "live"]);
  });
});
