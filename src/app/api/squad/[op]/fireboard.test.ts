import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIREWATCH, FIREWATCH_DAYS } from "@/lib/badges";
import { WEEK, weekStartOf } from "@/lib/hotList";
import { type SquadRoom } from "@/lib/squad";
import type { FireBoard } from "@/lib/squadFire";
import { loadMods } from "@/lib/server/admins";
import { earnedBy, shownBadges } from "@/lib/server/badges";
import { db } from "@/lib/server/db";
import { forgetFireBoard, rankRooms, settleFireWeek, type BoardRoom } from "@/lib/server/fireBoard";
import { forgetHits } from "@/lib/server/rateLimit";
import { sessions, siteSettings, squadFireRooms, squadFireSticks, squadFireWeeks, squadMembers, squadRooms, userBadges, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { POST } from "./route";

// 火焰周榜 and 篝火守夜人 (篝火不封顶)

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
const KEY = "8di6kbgf9neg7e";
/** A Wednesday afternoon in Beijing: this week from the Monday 04:00 before */
const NOW = Date.parse("2026-11-18T08:00:00Z");
const WEEK0 = weekStartOf(NOW);

async function player(name: string, more: Partial<typeof users.$inferInsert> = {}) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, name, anonymous: false, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now, squadCore: 5, ...more })
    .returning();
  return u;
}
const tokens = new Map<string, string>();
async function signIn(u: Pick<User, "id">) {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
}
async function squad(u: Pick<User, "id">, op: string, body: unknown = {}) {
  await signIn(u);
  forgetHits();
  const req = new NextRequest(`http://localhost/api/squad/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const board = async (u: User, week: "this" | "last" = "this") => {
  forgetFireBoard();
  const res = await squad(u, "fireboard", { week });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as FireBoard;
};
/** The rows with names alone (their roach's look left out) */
const plain = (rows: FireBoard["rows"]) => rows.map((r) => ({ ...r, names: r.names.map((n) => ({ name: n.name, ...(n.you ? { you: n.you } : {}) })) }));

/** A room's fire this week (or the week given): its highest and when, and who put how many on (first at, ms after the week's start) */
async function fire(peak: number, peakAt: number, sticks: [User, number, number?][], week = WEEK0, room: string = randomUUID()) {
  await db.insert(squadFireRooms).values({ roomId: room, week: new Date(week), peak, peakAt: new Date(week + peakAt) });
  for (const [u, n, first] of sticks) {
    await db.insert(squadFireSticks).values({ roomId: room, userId: u.id, week: new Date(week), sticks: n, firstAt: new Date(week + (first ?? 0)) });
  }
  return room;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${siteSettings}, ${squadFireRooms}, ${squadFireSticks}, ${squadFireWeeks}, ${userBadges} cascade`,
  );
  await loadSettings();
  await loadMods();
  forgetHits();
  forgetSquad();
  forgetFireBoard();
  tokens.clear();
  jar.token = null;
  vi.stubEnv("SQUAD", "on");
});

afterEach(async () => {
  await flushSaysNow();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("火焰周榜's rows", () => {
  const room = (id: string, peak: number, peakAt: number, sticks: [string, number, number?][]): BoardRoom => ({
    room: id,
    peak,
    peakAt,
    sticks: sticks.map(([user, n, first]) => ({ user, sticks: n, first: first ?? 0 })),
  });
  const all = () => true;

  it("lists a room once two have put 20 sticks or more on it, naming the four who put most, the earlier first", () => {
    const rows = rankRooms(
      [
        room("lonely", 90, 0, [["p", 200]]),
        room("short", 80, 0, [
          ["q", 25],
          ["r", 19],
        ]),
        room("big", 50, 0, [
          ["a", 20, 5],
          ["b", 40],
          ["c", 20, 1],
          ["d", 30],
          ["e", 21],
        ]),
      ],
      all,
    );
    expect(rows).toEqual([
      {
        room: "big",
        peak: 50,
        named: [
          { user: "b", sticks: 40 },
          { user: "d", sticks: 30 },
          { user: "e", sticks: 21 },
          { user: "c", sticks: 20 },
        ],
      },
    ]);
  });

  it("puts the higher first, the earlier there first among equals; names each once, in the highest; a room left with one drops", () => {
    const rows = rankRooms(
      [
        room("later", 60, 500, [
          ["x", 30],
          ["y", 30],
        ]),
        // a is named higher up: b and f fill the row
        room("earlier", 60, 100, [
          ["a", 30],
          ["b", 30],
          ["f", 20],
        ]),
        room("top", 70, 900, [
          ["a", 20],
          ["c", 20],
        ]),
        // a and b named higher up: only z is left, and it drops
        room("again", 55, 0, [
          ["a", 99],
          ["b", 99],
          ["z", 20],
        ]),
        room("refill", 50, 0, [
          ["a", 99],
          ["d", 20],
          ["e", 20],
        ]),
      ],
      all,
    );
    expect(rows.map((r) => [r.room, r.named.map((n) => n.user)])).toEqual([
      ["top", ["a", "c"]],
      ["earlier", ["b", "f"]],
      ["later", ["x", "y"]],
      ["refill", ["d", "e"]],
    ]);
  });

  it("leaves out the suspended", () => {
    const rows = rankRooms(
      [
        room("r", 30, 0, [
          ["ok", 20],
          ["banned", 50],
          ["ok2", 20],
        ]),
      ],
      (u) => u !== "banned",
    );
    expect(rows[0].named.map((n) => n.user)).toEqual(["ok", "ok2"]);
  });
});

describe("火焰周榜 for a page", () => {
  it("keeps 火焰周榜写我的名字 on the 卫戍名片 as 别人扔我 is kept: saved with it, and kept when the card is cleared", async () => {
    const a = await player("a");
    expect((await squad(a, "card", { card: { core: 5, strategy: null, level: 3 }, fireHide: true })).body).toMatchObject({ fireHide: true, noThrow: false });
    expect((await db.select().from(users).where(eq(users.id, a.id)))[0].squadFireHide).toBe(true);
    expect((await squad(a, "card", { card: null })).body).toMatchObject({ card: null, fireHide: true });
    expect((await squad(a, "card", { card: null, fireHide: false })).body).toMatchObject({ fireHide: false });
    expect((await squad(a, "card", { card: null, fireHide: "yes" })).status).toBe(400);
  });

  it("lists this week's rooms with their names (一位舟P for one who keeps theirs off, 你 for the asker), no times at all", async () => {
    const me = await player("me");
    const a = await player("a");
    const hid = await player("hid", { squadFireHide: true });
    const b = await player("b");
    const c = await player("c");
    await fire(40, 10, [
      [a, 30],
      [hid, 20],
    ]);
    await fire(30, 5, [
      [b, 25],
      [c, 25, 1],
      [me, 20, 2],
    ]);
    const got = await board(me);
    expect(got.week).toBe("this");
    // a name with its roach's look; one kept off, without
    expect(got.rows[0].names[0]).toMatchObject({ name: "a", look: { color: "cyan", avatar: "hood" } });
    expect(got.rows[0].names[1]).toEqual({ name: "一位舟P" });
    expect(plain(got.rows)).toEqual([
      { rank: 1, peak: 40, color: 0, names: [{ name: "a" }, { name: "一位舟P" }] },
      { rank: 2, peak: 30, color: 0, names: [{ name: "b" }, { name: "c" }, { name: "你", you: true }] },
    ]);
    expect(got.holders).toBe(5);
    expect(got.left).toBe(WEEK0 + WEEK - NOW);
    // not in a room: no 你们这堆
    expect(got.mine).toBeNull();
    // nothing in its rows says when anyone did anything
    for (const r of got.rows) expect(Object.keys(r).sort()).toEqual(["color", "names", "peak", "rank"]);
    expect(JSON.stringify(got)).not.toMatch(/peakAt|firstAt|"first"|settled/);
  });

  it("says where the asker's room is: named in the top, a few sticks short, named elsewhere, below the top, not listed, last week's", async () => {
    const me = await player("me");
    const mate = await player("mate");
    const opened = await squad(me, "open", { key: KEY, server: "cn", level: 3, tags: [2] });
    const room = (opened.body!.room as SquadRoom).id;
    const others = await Promise.all([1, 2, 3, 4].map((i) => player(`o${i}`)));
    // not listed yet
    expect((await board(me)).mine).toMatchObject({ rank: null, say: "off" });
    // listed, the asker short of 20
    await fire(
      10,
      0,
      [
        [mate, 30],
        [others[0], 25],
        [me, 12],
      ],
      WEEK0,
      room,
    );
    expect((await board(me)).mine).toMatchObject({ rank: 1, peak: 10, say: "short", k: 8 });
    // named
    await db.update(squadFireSticks).set({ sticks: 20 }).where(eq(squadFireSticks.userId, me.id));
    const named = (await board(me)).mine!;
    expect(named).toMatchObject({ rank: 1, say: "in", n: 3 });
    expect(named.names.map((n) => n.name)).toEqual(["mate", "o1", "你"]);
    // named in a higher room: counted there, not here
    await fire(99, 0, [
      [me, 50],
      [others[1], 50],
    ]);
    expect((await board(me)).mine).toMatchObject({ rank: 2, say: "elsewhere", r: 1 });
  });

  it("says 离前 100 还差 for a room listed below the hundredth, and 算在上周 for one opened last week", async () => {
    const me = await player("me");
    const mate = await player("mate");
    const opened = await squad(me, "open", { key: KEY, server: "cn", level: 3, tags: [2] });
    const room = (opened.body!.room as SquadRoom).id;
    // a hundred rooms above, the last of them at Lv.41: nine levels more to go past it
    const crowd = await db
      .insert(users)
      .values(
        Array.from({ length: 200 }, (_, i) => ({
          email: `p${i}@example.com`,
          name: `p${i}`,
          anonymous: false,
          ageConfirmedAt: new Date(),
          policyAcceptedAt: new Date(),
          crossBorderAcceptedAt: new Date(),
          publicPlaceAcceptedAt: new Date(),
        })),
      )
      .returning();
    for (let i = 0; i < 100; i++) {
      await fire(140 - i, 0, [
        [crowd[2 * i], 30],
        [crowd[2 * i + 1], 30],
      ]);
    }
    await fire(
      33,
      0,
      [
        [me, 30],
        [mate, 30],
      ],
      WEEK0,
      room,
    );
    const got = await board(me);
    expect(got.rows).toHaveLength(101);
    expect(got.holders).toBe(200);
    expect(got.mine).toMatchObject({ rank: 101, peak: 33, say: "below", d: 9 });
    // the room was opened last week
    await db.update(squadRooms).set({ createdAt: new Date(WEEK0 - 60_000) }).where(eq(squadRooms.id, room));
    expect((await board(me)).mine).toMatchObject({ rank: null, say: "old" });
  });

  it("settles last week once: keeps its board, gives the named of the top 100 rooms 篝火守夜人 for a week with their place, clears what is older", async () => {
    const a = await player("a");
    const b = await player("b");
    const c = await player("c");
    const d = await player("d");
    const last = WEEK0 - WEEK;
    await fire(
      80,
      0,
      [
        [a, 30],
        [b, 25],
      ],
      last,
    );
    await fire(
      60,
      0,
      [
        [c, 30],
        [d, 25],
      ],
      last,
    );
    // c held it from the week before: worn on, a new place
    await db.insert(userBadges).values({ userId: c.id, badge: FIREWATCH, earnedAt: new Date(last), serial: 9, seenAt: new Date(last + 1000) });
    // two weeks ago: cleared
    await fire(5, 0, [[a, 30]], last - WEEK);
    await db.insert(squadFireWeeks).values({ week: new Date(last - WEEK), board: [] });
    const given = await settleFireWeek(NOW);
    expect(new Set(given)).toEqual(new Set([a.id, b.id, c.id, d.id]));
    // once only
    expect(await settleFireWeek(NOW + 60_000)).toBeNull();
    const rows = await db.select().from(userBadges);
    expect(rows.map((r) => [r.userId, r.badge, r.earnedAt.getTime(), r.serial, r.seenAt]).sort()).toEqual(
      [
        [a.id, FIREWATCH, WEEK0, 1, null],
        [b.id, FIREWATCH, WEEK0, 1, null],
        [c.id, FIREWATCH, WEEK0, 2, null],
        [d.id, FIREWATCH, WEEK0, 2, null],
      ].sort(),
    );
    const weeks = await db.select().from(squadFireWeeks);
    expect(weeks.map((w) => w.week.getTime())).toEqual([last]);
    expect(weeks[0].board.map((r) => [r.rank, r.peak, r.users])).toEqual([
      [1, 80, [a.id, b.id]],
      [2, 60, [c.id, d.id]],
    ]);
    expect((await db.select().from(squadFireRooms)).every((r) => r.week.getTime() >= last)).toBe(true);
    // last week's page: who won, as it was
    const page = await board(a, "last");
    expect(plain(page.rows)).toEqual([
      { rank: 1, peak: 80, color: 0, names: [{ name: "你", you: true }, { name: "b" }], got: true },
      { rank: 2, peak: 60, color: 0, names: [{ name: "c" }, { name: "d" }], got: true },
    ]);
    expect(page.holders).toBe(4);
  });

  it("is worn a week, then gone (and taken off where worn) till it is won again; its place is said only to its holder", async () => {
    const a = await player("a");
    const b = await player("b");
    const last = WEEK0 - WEEK;
    await fire(
      80,
      0,
      [
        [a, 30],
        [b, 25],
      ],
      last,
    );
    await settleFireWeek(NOW);
    await db.update(users).set({ wornBadge: FIREWATCH }).where(eq(users.id, a.id));
    expect((await earnedBy(a.id)).find((e) => e.id === FIREWATCH)).toMatchObject({ serial: 1, until: WEEK0 + FIREWATCH_DAYS * 86_400_000 });
    const [shown] = [...(await shownBadges([{ ...a, wornBadge: FIREWATCH }])).values()];
    expect(shown.worn).toBe(FIREWATCH);
    expect(shown.badges.find((x) => x.id === FIREWATCH)).toEqual({ id: FIREWATCH });
    // a week on: gone
    vi.setSystemTime(new Date(WEEK0 + WEEK + 1));
    expect((await earnedBy(a.id)).some((e) => e.id === FIREWATCH)).toBe(false);
    const [after] = [...(await shownBadges([{ ...a, wornBadge: FIREWATCH }])).values()];
    expect(after.worn).toBeNull();
    // won again: worn again, as it was left on
    await db.update(userBadges).set({ earnedAt: new Date(WEEK0 + WEEK) }).where(eq(userBadges.userId, a.id));
    const [again] = [...(await shownBadges([{ ...a, wornBadge: FIREWATCH }])).values()];
    expect(again.worn).toBe(FIREWATCH);
  });
});
