import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as countRoute } from "@/app/api/app-count/route";
import { POST as redeemRoute } from "@/app/api/auth/desk-code/redeem/route";
import { DESK_CODE_ALPHABET, DESK_CODE_WRONG, formatDeskCode } from "../deskCode";
import { banAccount } from "./account";
import { appCountDays, countApp, forgetAppCounts, saveAppCounts } from "./appCounts";
import { startSession } from "./auth";
import { db } from "./db";
import { issueDeskCode, pruneDeskCodes, redeemDeskCode } from "./deskCodes";
import { appCounts, bannedEmails, deskCodes, users } from "./schema";
import { recent } from "./signals";

// a session is only started, as the route would on a real request
vi.mock("./auth", async (original) => ({ ...(await original<typeof import("./auth")>()), startSession: vi.fn(async () => {}) }));

const MINUTE = 60_000;
let ip = 0;

/** A request to one of the routes, from an address of its own unless told */
const request = (path: string, body: unknown, from = `10.0.0.${++ip}`) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify(body),
  });

async function redeem(code: unknown, from?: string) {
  const res = await redeemRoute(request("/api/auth/desk-code/redeem", { code }, from), undefined);
  return { status: res.status, body: (await res.json()) as { status?: string; error?: string } };
}

const player = async (email: string) => (await db.insert(users).values({ email }).returning({ id: users.id }))[0].id;

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${deskCodes}, ${appCounts}, ${bannedEmails} cascade`);
  vi.mocked(startSession).mockClear();
  forgetAppCounts();
});

describe("登录码", () => {
  it("gives eight easy-to-read characters, keeps only their HMAC, and signs in once with them however typed", async () => {
    const me = await player("me@example.com");
    const { code, expiresAt } = await issueDeskCode(me);
    expect(code).toMatch(new RegExp(`^[${DESK_CODE_ALPHABET}]{8}$`));
    expect(expiresAt - Date.now()).toBeGreaterThan(9 * MINUTE);
    const [row] = await db.select().from(deskCodes);
    expect(row.codeHash).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(code);

    // lower case, with the dash and spaces as shown and copied
    expect(await redeem(` ${formatDeskCode(code).toLowerCase()} `)).toEqual({ status: 200, body: { status: "ok" } });
    expect(vi.mocked(startSession).mock.calls.map(([, id]) => id)).toEqual([me]);
    // once only
    expect(await redeem(code)).toEqual({ status: 400, body: { error: DESK_CODE_WRONG } });
  });

  it("works ten minutes, one at a time an account, and not at all once replaced", async () => {
    const me = await player("me@example.com");
    const first = await issueDeskCode(me);
    const second = await issueDeskCode(me);
    expect(await db.$count(deskCodes)).toBe(1);
    expect(await redeemDeskCode(first.code)).toBeNull();
    expect(await redeemDeskCode(second.code, Date.now() + 11 * MINUTE)).toBeNull();
    expect(await redeemDeskCode(second.code)).toBe(me);

    // run out: pruned
    const other = await player("other@example.com");
    await issueDeskCode(other, Date.now() - 20 * MINUTE);
    await pruneDeskCodes();
    expect((await db.select({ userId: deskCodes.userId }).from(deskCodes)).map((r) => r.userId)).toEqual([me]);
  });

  it("signs in once when the same code comes twice at the same moment", async () => {
    const me = await player("me@example.com");
    const { code } = await issueDeskCode(me);
    const results = await Promise.all(Array.from({ length: 5 }, () => redeemDeskCode(code)));
    expect(results.filter(Boolean)).toEqual([me]);
  });

  it("gives an account five codes an hour", async () => {
    const me = await player("me@example.com");
    for (let i = 0; i < 5; i++) await issueDeskCode(me);
    await expect(issueDeskCode(me)).rejects.toThrow("这一小时拿得太多了");
  });

  it("lets a network try ten codes in ten minutes, says the same whatever went wrong, and notes the failures", async () => {
    const before = recent("codeRefused", 60 * MINUTE).length;
    for (const typed of ["", "ABCD", "ABCD-EFGH", "0O1I-LLLL", 12345678]) {
      expect(await redeem(typed, "192.0.2.1")).toEqual({ status: 400, body: { error: DESK_CODE_WRONG } });
    }
    for (let i = 0; i < 5; i++) await redeem("ABCD-EFGH", "192.0.2.1");
    const me = await player("me@example.com");
    const { code } = await issueDeskCode(me);
    // the eleventh try, right or wrong
    expect(await redeem(code, "192.0.2.1")).toEqual({ status: 429, body: { error: "试得太频繁了，过几分钟再试。" } });
    expect(await redeem(code, "192.0.2.2")).toMatchObject({ status: 200 });
    const noted = recent("codeRefused", 60 * MINUTE).slice(before).map((s) => s.code);
    expect(noted.filter((c) => c === "desk-wrong")).toHaveLength(10);
    expect(noted.filter((c) => c === "desk-ip")).toHaveLength(1);
  });

  it("signs no banned mailbox in, however it was written when banned", async () => {
    const me = await player("a.b@gmail.com");
    const { code } = await issueDeskCode(me);
    const [twin] = await db.select().from(users).where(eq(users.id, await player("ab+old@gmail.com")));
    await banAccount(twin);
    expect(await redeem(code)).toEqual({ status: 400, body: { error: DESK_CODE_WRONG } });
    expect(startSession).not.toHaveBeenCalled();
  });
});

describe("存到桌面's counts", () => {
  it("adds what each process counted to the day's totals, once a minute in one statement", async () => {
    countApp("standalone:iphone");
    countApp("standalone:iphone");
    countApp("code-issued");
    await saveAppCounts();
    countApp("standalone:iphone");
    await saveAppCounts();
    await saveAppCounts();
    const [today] = await appCountDays();
    expect(today.counts).toEqual({ "standalone:iphone": 3, "code-issued": 1 });
    // a desk code taken and used counts too
    const me = await player("me@example.com");
    const { code } = await issueDeskCode(me);
    await redeem(code);
    await saveAppCounts();
    expect((await appCountDays())[0].counts).toMatchObject({ "code-issued": 2, "code-redeemed": 1 });
  });

  it("takes only the names a page may send, and nothing about who sent them", async () => {
    for (const name of ["browser:android", "tap:desktop", "installed:harmony", "code-issued", "evil", "standalone:fridge", 3]) {
      const res = await countRoute(request("/api/app-count", { name }), undefined);
      expect(res.status).toBe(200);
    }
    await saveAppCounts();
    expect((await appCountDays())[0].counts).toEqual({ "browser:android": 1, "tap:desktop": 1, "installed:harmony": 1 });
    expect(Object.keys((await db.select().from(appCounts))[0]).sort()).toEqual(["day", "n", "name"]);
  });

  it("keeps what could not be saved for the next time", async () => {
    countApp("tap:iphone");
    const spy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("database away");
    });
    await expect(saveAppCounts()).rejects.toThrow("database away");
    spy.mockRestore();
    await saveAppCounts();
    expect((await appCountDays())[0].counts).toEqual({ "tap:iphone": 1 });
  });
});
