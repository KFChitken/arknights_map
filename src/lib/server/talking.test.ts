import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/world/[op]/route";
import { AGE_CHECK_NEEDED } from "../consent";
import { EMPTY_PROFILE } from "../profile";
import { db } from "./db";
import { users, type UserRow } from "./schema";

// The player signed in for each request: set by the test, as a session cookie would
const signedIn: { user: UserRow | null } = { user: null };
vi.mock("./auth", async (original) => ({ ...(await original<typeof import("./auth")>()), currentUser: vi.fn(async () => signedIn.user) }));

async function call(op: string, ...args: unknown[]) {
  const res = await POST(
    new NextRequest(`http://localhost/api/world/${op}`, {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }),
    { params: Promise.resolve({ op }) },
  );
  return { status: res.status, error: ((await res.json()) as { error?: string }).error ?? "" };
}

const DAY = 86_400_000;
let player: UserRow;
const refresh = async () => {
  [player] = await db.select().from(users).where(eq(users.id, player.id));
  signedIn.user = player;
};

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  const now = new Date();
  [player] = await db
    .insert(users)
    .values({ email: "p@example.com", ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  signedIn.user = player;
});

describe("a paused player", () => {
  it("may look and leave, but not reach anyone, until the pause is over", async () => {
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 7 * DAY) }).where(eq(users.id, player.id));
    await refresh();
    for (const op of ["touch", "reply", "poke", "declare", "react", "gesture", "visit", "followHost", "askHelp", "answerHelp", "remindSanity", "friendsAct", "gameAsk"]) {
      const res = await call(op, "x", "y");
      expect([op, res.status], op).toEqual([op, 403]);
      expect(res.error).toMatch(/^你的互动被站长暂停到 \d+ 月 \d+ 日，这期间你还能看地图和消息，但不能碰人、发宣言、回应、戳一戳和做客。$/);
    }
    for (const op of ["goHome", "sendHome", "closeHelp", "report", "reportRoach", "appeal", "block", "inbox", "blocks", "saveProfile"]) {
      const res = await call(op, op === "saveProfile" ? EMPTY_PROFILE : "x", "y");
      expect([op, res.error.includes("暂停")], op).toEqual([op, false]);
    }

    await db.update(users).set({ suspendedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, player.id));
    await refresh();
    expect((await call("touch", "x", true)).error).not.toContain("暂停");
  });
});

describe("a player the admin asked to say again they are 18", () => {
  it("does nothing others see until they do, and then all of it", async () => {
    await db.update(users).set({ ageCheckAt: new Date() }).where(eq(users.id, player.id));
    await refresh();
    expect(await call("saveProfile", EMPTY_PROFILE)).toEqual({ status: 428, error: AGE_CHECK_NEEDED });
    expect(await call("touch", "x", true)).toEqual({ status: 428, error: AGE_CHECK_NEEDED });
    // reporting, blocking and appealing stay open
    for (const op of ["report", "reportRoach", "appeal"]) expect((await call(op, "x", "spam")).status, op).not.toBe(428);

    expect((await call("confirmAge")).status).toBe(200);
    await refresh();
    expect(player.ageCheckAt).toBeNull();
    expect((await call("saveProfile", EMPTY_PROFILE)).status).toBe(200);
  });
});
