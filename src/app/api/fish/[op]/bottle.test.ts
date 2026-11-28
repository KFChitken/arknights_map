import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";
import { BOTTLES_A_DAY, NOTE_DAYS, noteKm, SAY_GROUPS, SAYS, TICKETS_A_DAY } from "@/lib/fish/rules";
import { PASS_CATALOG, passChar } from "@/lib/passCatalog";
import { TICKETS_CAP, WELCOME_TICKETS } from "@/lib/passes";
import { db } from "@/lib/server/db";
import { castLine, forgetBank } from "@/lib/server/fish";
import { openBottle } from "@/lib/server/fishBottle";
import { openWallet } from "@/lib/server/passes";
import { forgetHits } from "@/lib/server/rateLimit";
import {
  blocks,
  fishBottles,
  fishDays,
  fishLines,
  fishNotes,
  passCounters,
  passes,
  passWallets,
  roaches,
  sessions,
  users,
} from "@/lib/server/schema";
import { siteDay } from "@/lib/siteDay";
import { POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

type User = typeof users.$inferSelect;
type Answer = { status: number; body: Record<string, unknown> };
type Opened = { id: number; pass: { charId: number; no: number; tier: string }; note: { say: number; km: number | null } | null; thrown: number | null; today: number };

async function call(op: string, body?: unknown): Promise<Answer> {
  const req = new NextRequest(`http://localhost/api/fish/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function account(email: string, games: string[] = []): Promise<User> {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, games, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

const tokens = new Map<string, string>();
async function signIn(u: Pick<User, "id">) {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    // runs out by the database's clock, as the site checks it, not the faked one
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: sql`now() + interval '30 days'` });
    tokens.set(u.id, token);
  }
  jar.token = token;
}

/** A line in the water bitten a moment ago, with this on the hook */
async function hooked(userId: string, item: number) {
  const now = Date.now();
  const row = { spot: "pier", castAt: new Date(now - 60_000), biteAt: new Date(now - 100), item, variant: 0, cm: null, shadow: "l" };
  await db.insert(fishLines).values({ userId, ...row }).onConflictDoUpdate({ target: fishLines.userId, set: row });
}

/** A bottle caught as if by the pull, waiting to be opened */
async function bottle(userId: string): Promise<number> {
  const [b] = await db.insert(fishBottles).values({ userId }).returning({ id: fishBottles.id });
  return b.id;
}

/** The player's main roach, there */
const mainAt = (userId: string, lng: number, lat: number) => db.insert(roaches).values({ userId, slot: 0, lng, lat });

const dayRow = async (userId: string) => (await db.select().from(fishDays).where(and(eq(fishDays.userId, userId), eq(fishDays.day, siteDay()))))[0];
const wallet = async (userId: string) => (await db.select().from(passWallets).where(eq(passWallets.userId, userId)))[0];
const lineItem = async (userId: string) => (await db.select({ item: fishLines.item }).from(fishLines).where(eq(fishLines.userId, userId)))[0]?.item;
const caughtNo = (a: Answer) => (a.body.caught as { no: number }).no;

const TICKET = 27;
const BOTTLE = 30;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${passCounters}, ${fishNotes} cascade`);
  jar.token = null;
  tokens.clear();
  forgetBank();
  forgetHits();
  vi.stubEnv("FISH", "on");
  vi.stubEnv("PASSES", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("钓鳞's 寻访券", () => {
  it("goes into the wallet, made for one who never opened 寻访, whose first ten still come; three a site day", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    await hooked(a.id, TICKET);
    const reel = await call("reel");
    expect(reel.status).toBe(200);
    expect(reel.body).toMatchObject({ caught: { no: TICKET, wallet: 1 }, passesDot: true });
    expect(await wallet(a.id)).toMatchObject({ tickets: 1, welcomed: false });
    expect((await dayRow(a.id)).tickets).toBe(1);
    expect((await openWallet(a)).tickets).toBe(1 + WELCOME_TICKETS);

    await db.update(fishDays).set({ tickets: TICKETS_A_DAY }).where(eq(fishDays.userId, a.id));
    await hooked(a.id, TICKET);
    const fourth = await call("reel");
    expect(caughtNo(fourth)).not.toBe(TICKET);
    expect(fourth.body.caught).not.toHaveProperty("wallet");
    expect((await wallet(a.id)).tickets).toBe(1 + WELCOME_TICKETS);
    expect((await dayRow(a.id)).tickets).toBe(TICKETS_A_DAY);
  });

  it("never comes while the wallet holds 50: the cast draws something else, and one on the hook as it filled is swapped at the pull", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    // a draw of 0.01 every time: inside the 寻访券's own 1.7 in a hundred
    const low = () => 0.01;
    await castLine(a, { spot: "pier" }, Date.now(), low);
    expect(await lineItem(a.id)).toBe(TICKET);
    await db.insert(passWallets).values({ userId: a.id, day: siteDay(), tickets: TICKETS_CAP, welcomed: true });
    await castLine(a, { spot: "pier" }, Date.now(), low);
    // the wallet full: no share of the draw, so the same draw is something plain
    expect(await lineItem(a.id)).not.toBe(TICKET);

    await hooked(a.id, TICKET);
    const reel = await call("reel");
    expect(reel.status).toBe(200);
    // swapped for something else of its tier
    expect(caughtNo(reel)).not.toBe(TICKET);
    expect(itemOf(caughtNo(reel))!.tier).toBe(itemOf(TICKET)!.tier);
    expect((await wallet(a.id)).tickets).toBe(TICKETS_CAP);
    expect((await dayRow(a.id)).tickets).toBe(0);
  });

  it("is only for a player PASSES lets draw", async () => {
    vi.stubEnv("PASSES", "admins");
    const a = await account("a@example.com");
    await signIn(a);
    await castLine(a, { spot: "pier" }, Date.now(), () => 0.01);
    expect([TICKET, BOTTLE]).not.toContain(await lineItem(a.id));
    await hooked(a.id, TICKET);
    expect(caughtNo(await call("reel"))).not.toBe(TICKET);
    expect(await wallet(a.id)).toBeUndefined();
    expect((await call("state")).body.bottles).toEqual([]);
    expect((await call("open", { id: await bottle(a.id) })).status).toBe(404);
  });
});

describe("钓鳞's 漂流瓶", () => {
  it("is kept to open, one a site day: a second on the hook that day is something else", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    // a draw of 0.019 every time: past the 寻访券's 1.7 in a hundred, inside the 漂流瓶's 0.4 after it
    await castLine(a, { spot: "pier" }, Date.now(), () => 0.019);
    expect(await lineItem(a.id)).toBe(BOTTLE);
    await hooked(a.id, BOTTLE);
    const reel = await call("reel");
    const id = (reel.body.caught as { bottle: number }).bottle;
    expect(reel.body.caught).toMatchObject({ no: BOTTLE, first: true });
    expect(id).toBeGreaterThan(0);
    expect((await dayRow(a.id)).bottles).toBe(BOTTLES_A_DAY);
    expect((await call("state")).body).toMatchObject({ bottles: [id] });

    // the day's one came: the cast draws no other, and one on the hook is swapped
    await castLine(a, { spot: "pier" }, Date.now(), () => 0.019);
    expect([TICKET, BOTTLE]).not.toContain(await lineItem(a.id));
    await hooked(a.id, BOTTLE);
    const second = await call("reel");
    expect(caughtNo(second)).not.toBe(BOTTLE);
    expect(second.body.caught).not.toHaveProperty("bottle");
    expect(await db.select().from(fishBottles)).toHaveLength(1);
  });

  it("opens to one pass from the player's 卡池, numbered on with 寻访's, and leaves the wish list's count and the tickets alone", async () => {
    // a 卡池 of one game, as one may be picked once PASS_POOLS is on (else both, as passes.test.ts shows)
    vi.stubEnv("PASS_POOLS", "on");
    const a = await account("a@example.com", ["arknights"]);
    await signIn(a);
    const ef = PASS_CATALOG.find((c) => c.game === "ef")!;
    const ak = PASS_CATALOG.find((c) => c.game === "ak")!;
    const drewAt = new Date(Date.now() - 3_600_000);
    await db.insert(passWallets).values({ userId: a.id, day: siteDay(), tickets: 7, welcomed: true, wish: [ef.id], miss: 12, pool: "ak", drawnAt: drewAt });
    await db.insert(passCounters).values({ charId: ef.id, lastNo: 41 });

    // the first die says the wish list (one in the catalogue's size), as a draw of one does
    const first = await openBottle(a, await bottle(a.id), Date.now(), () => 0);
    expect(first).toMatchObject({ pass: { charId: ef.id, no: 42, tier: "wish" }, note: null, thrown: null });
    expect(await wallet(a.id)).toMatchObject({ tickets: 7, miss: 12, drawnAt: drewAt });

    // else anyone of the one game picked, the copies before it counted
    await db.insert(passes).values({ userId: a.id, charId: ak.id, no: 1 });
    await db.insert(passCounters).values({ charId: ak.id, lastNo: 1 });
    const id = await bottle(a.id);
    const second = await openBottle(a, id, Date.now(), (n) => (n === PASS_CATALOG.length ? n - 1 : 0));
    expect(passChar(second.pass.charId)?.game).toBe("ak");
    expect(second.pass).toMatchObject({ charId: ak.id, no: 2, tier: "up" });
    expect(await wallet(a.id)).toMatchObject({ tickets: 7, miss: 12 });

    // opened already: told again as it was, nothing drawn
    const again = await call("open", { id });
    expect(again.body).toMatchObject({ id, pass: { charId: ak.id, no: 2, tier: "up" } });
    expect(await db.select().from(passes).where(eq(passes.userId, a.id))).toHaveLength(3);
    expect((await call("state")).body.bottles).toEqual([]);
    expect((await call("open", { id: id + 99 })).status).toBe(404);
  });
});

describe("漂流瓶's 纸条", () => {
  it("is thrown back once a bottle, one of the 17 lines, and only from one opened", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    const shut = await bottle(a.id);
    expect(await call("throw", { id: shut, say: 1 })).toMatchObject({ status: 409, body: { error: T.server.fish.notOpened } });
    const id = await bottle(a.id);
    await call("open", { id });
    expect((await call("throw", { id, say: 0 })).status).toBe(400);
    expect((await call("throw", { id, say: SAYS + 1 })).status).toBe(400);
    expect((await call("throw", { id, say: "晚上好" })).status).toBe(400);
    expect(await call("throw", { id, say: 16 })).toMatchObject({ status: 200, body: { id, thrown: 16 } });
    expect(await call("throw", { id, say: 3 })).toMatchObject({ status: 409, body: { error: T.server.fish.thrownAlready } });
    expect(await db.select({ fromId: fishNotes.fromId, say: fishNotes.say }).from(fishNotes)).toEqual([{ fromId: a.id, say: 16 }]);
  });

  it("goes into the next bottle someone else opens, oldest first, to one player, never to its writer nor between two who blocked each other", async () => {
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((n) => account(`${n}@example.com`)));
    await mainAt(a.id, 116.4, 39.9); // Beijing
    await mainAt(c.id, 121.47, 31.23); // Shanghai
    await mainAt(d.id, 116.45, 39.92); // a few km from a
    for (const say of [5, 9]) {
      await signIn(a);
      const id = await bottle(a.id);
      expect((await call("open", { id })).body.note).toBeNull();
      await call("throw", { id, say });
    }
    // not to its writer
    await signIn(a);
    expect((await call("open", { id: await bottle(a.id) })).body.note).toBeNull();
    // b blocked a: nothing of a's
    await db.insert(blocks).values({ blockerId: b.id, blockedId: a.id });
    await signIn(b);
    expect((await call("open", { id: await bottle(b.id) })).body.note).toBeNull();
    // c: a's first, how far to 10 km
    await signIn(c);
    const toC = (await call("open", { id: await bottle(c.id) })).body as Opened;
    expect(toC.note).toEqual({ say: 5, km: 1070 });
    // d, a few km off: a's other, 附近; then the sea is empty
    await signIn(d);
    expect(((await call("open", { id: await bottle(d.id) })).body as Opened).note).toEqual({ say: 9, km: 0 });
    expect(((await call("open", { id: await bottle(d.id) })).body as Opened).note).toBeNull();
    expect(await db.select().from(fishNotes)).toHaveLength(0);
    // what each was told stays with their bottle
    expect((await db.select({ say: fishBottles.noteSay }).from(fishBottles).where(eq(fishBottles.userId, c.id)))[0].say).toBe(5);
  });

  it("is from far away when either has no main roach, and goes after 30 days in the sea", async () => {
    const [a, b] = await Promise.all(["a", "b"].map((n) => account(`${n}@example.com`)));
    await mainAt(b.id, 121.47, 31.23);
    await db.insert(fishNotes).values({ fromId: a.id, say: 2, at: new Date(Date.now() - (NOTE_DAYS + 1) * 86_400_000) });
    await db.insert(fishNotes).values({ fromId: a.id, say: 4, at: new Date(Date.now() - (NOTE_DAYS - 1) * 86_400_000) });
    await signIn(b);
    expect(((await call("open", { id: await bottle(b.id) })).body as Opened).note).toEqual({ say: 4, km: null });
    expect(((await call("open", { id: await bottle(b.id) })).body as Opened).note).toBeNull();
    // the old one goes as the next is thrown
    const id = await bottle(b.id);
    await call("open", { id });
    await call("throw", { id, say: 17 });
    expect(await db.select({ say: fishNotes.say }).from(fishNotes)).toEqual([{ say: 17 }]);
  });

  it("has 17 lines in five groups to pick from, and a distance to 10 km", () => {
    expect(T.fish.bottle.says).toHaveLength(SAYS);
    expect(SAYS).toBe(17);
    expect(T.fish.bottle.groups).toHaveLength(SAY_GROUPS.length);
    expect([noteKm(0.4), noteKm(9.9), noteKm(10), noteKm(14.9), noteKm(15), noteKm(819), noteKm(1066.6)]).toEqual([0, 0, 10, 10, 20, 820, 1070]);
  });
});
