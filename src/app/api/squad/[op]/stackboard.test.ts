import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STACKTOP, STACKTOP_DAYS, badgeById } from "@/lib/badges";
import { WEEK, weekStartOf } from "@/lib/hotList";
import type { SquadRoom } from "@/lib/squad";
import { stackSwing, type StackBoard } from "@/lib/squadMode";
import { T } from "@/i18n";
import { loadMods } from "@/lib/server/admins";
import { earnedBy } from "@/lib/server/badges";
import { db } from "@/lib/server/db";
import { forgetHits } from "@/lib/server/rateLimit";
import { sessions, siteSettings, squadMembers, squadRooms, squadStackBlocks, squadStackTowers, squadStackWeeks, userBadges, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, flushStacksNow, forgetSquad } from "@/lib/server/squad";
import { forgetStackBoard, settleStackWeek } from "@/lib/server/stackBoard";
import { POST } from "./route";

// 基建周榜 and 基建狂魔

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
    // runs out by the database's clock, as the site checks it, not the faked one
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: sql`now() + interval '7 days'` });
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
  forgetStackBoard();
  const res = await squad(u, "stackboard", { week });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown as StackBoard;
};
/** The rows with names alone (their roach's look left out) */
const plain = (rows: StackBoard["rows"]) => rows.map((r) => ({ ...r, names: r.names.map((n) => ({ name: n.name, ...(n.you ? { you: n.you } : {}) })) }));

/** A tower this week (or the week given): its highest and when, and who put how many blocks on it (first at, ms after the week's start) */
async function tower(peak: number, peakAt: number, blocks: [User, number, number?][], week = WEEK0, room: string = randomUUID(), round = 1) {
  await db.insert(squadStackTowers).values({ roomId: room, round, week: new Date(week), peak, peakAt: new Date(week + peakAt) });
  for (const [u, n, first] of blocks) {
    await db.insert(squadStackBlocks).values({ roomId: room, round, userId: u.id, week: new Date(week), blocks: n, firstAt: new Date(week + (first ?? 0)) });
  }
  return room;
}

let clock = NOW;
const at = (ms: number) => {
  clock = ms;
  vi.setSystemTime(new Date(ms));
};
/** 放 by u with the swing at x over the room's tower as it is, the earliest after now */
async function dropAt(u: User, x: number) {
  const s = ((await squad(u, "room")).body!.room as SquadRoom).stack;
  let t = Math.max(clock, s.at);
  while (Math.round(stackSwing(s.swingAt, s.n, t)) !== x) t++;
  at(t + 30);
  return squad(u, "stack", { do: "drop", round: s.round, at: t });
}
/** A room u opens, the others in it */
async function roomOf(u: User, ...others: User[]) {
  const room = (await squad(u, "open", { key: KEY, server: "cn", level: 3, tags: [2] })).body!.room as SquadRoom;
  for (const o of others) expect((await squad(o, "join", { room: room.id })).status).toBe(200);
  return room.id;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(NOW);
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${siteSettings}, ${squadStackTowers}, ${squadStackBlocks}, ${squadStackWeeks}, ${userBadges} cascade`,
  );
  await loadSettings();
  await loadMods();
  forgetHits();
  forgetSquad();
  forgetStackBoard();
  tokens.clear();
  jar.token = null;
  vi.stubEnv("SQUAD", "on");
});

afterEach(async () => {
  await flushStacksNow();
  await flushSaysNow();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("基建周榜's counts", () => {
  it("counts each block that stood to its player (their first kept), the tower's highest and when it first got there; not the one that felled it", async () => {
    const a = await player("a");
    const b = await player("b");
    const room = await roomOf(a, b);
    await dropAt(a, 0);
    const aFirst = clock;
    await dropAt(b, 0);
    const bFirst = clock;
    at(clock + 1_000);
    await dropAt(a, 5);
    const peakAt = clock;
    // 45 px off: down, not counted
    at(clock + 1_000);
    expect(await dropAt(b, 50)).toMatchObject({ body: { falls: true } });
    const towers = await db.select().from(squadStackTowers);
    expect(towers.map((t) => [t.roomId, t.round, t.week.getTime(), t.peak, t.peakAt?.getTime()])).toEqual([[room, 1, WEEK0, 3, peakAt]]);
    const blocks = await db.select().from(squadStackBlocks);
    expect(blocks.map((r) => [r.userId, r.blocks, r.firstAt.getTime()]).sort()).toEqual(
      [
        [a.id, 2, aFirst],
        [b.id, 1, bFirst],
      ].sort(),
    );
  });

  it("counts a tower in the week of its first block that stood; one standing past Monday 04:00 counts nothing more, its next round this week's", async () => {
    // Monday 03:59 Beijing
    at(WEEK0 + WEEK - 60_000);
    const a = await player("a");
    const b = await player("b");
    const room = await roomOf(a, b);
    await dropAt(a, 0);
    const [first] = await db.select().from(squadStackTowers);
    expect(first.week.getTime()).toBe(WEEK0);
    // past 04:00: put, but counted nowhere
    at(WEEK0 + WEEK + 60_000);
    expect(await dropAt(b, 0)).toMatchObject({ status: 200, body: { n: 2 } });
    expect((await db.select().from(squadStackBlocks)).map((r) => r.userId)).toEqual([a.id]);
    expect((await db.select().from(squadStackTowers))[0].peak).toBe(1);
    // it falls; the next round counts in the new week
    at(clock + 1_000);
    expect(await dropAt(a, 50)).toMatchObject({ body: { falls: true } });
    at(clock + 3_500);
    expect(await dropAt(b, 0)).toMatchObject({ status: 200, body: { round: 2, n: 1 } });
    const rows = await db.select().from(squadStackTowers).where(eq(squadStackTowers.roomId, room));
    expect(rows.map((r) => [r.round, r.week.getTime(), r.peak]).sort()).toEqual([
      [1, WEEK0, 1],
      [2, WEEK0 + WEEK, 1],
    ]);
  });
});

describe("基建周榜 for a page", () => {
  it("lists towers once two have put 5 blocks or more on one, highest first, the earlier first; names four at most, most first; each once, in their highest", async () => {
    const me = await player("me");
    const [a, b, c, d, e, f] = await Promise.all(["a", "b", "c", "d", "e", "f"].map((n) => player(n)));
    // one alone: not listed
    await tower(90, 0, [[a, 50]]);
    // b, c, d, e, f: the four with most, the earlier first among equals
    await tower(40, 20, [
      [b, 5, 3],
      [c, 9],
      [d, 5, 1],
      [e, 7],
      [f, 6],
      [me, 4],
    ]);
    // as high, later there
    await tower(40, 30, [
      [a, 6],
      [me, 5],
    ]);
    // c and e named higher up: only f is left, and it drops
    await tower(20, 0, [
      [c, 9],
      [e, 9],
      [f, 5],
    ]);
    const got = await board(me);
    expect(plain(got.rows)).toEqual([
      { rank: 1, peak: 40, names: [{ name: "c" }, { name: "e" }, { name: "f" }, { name: "d" }] },
      { rank: 2, peak: 40, names: [{ name: "a" }, { name: "你", you: true }], mine: true },
    ]);
    expect(got.holders).toBe(6);
    expect(got.left).toBe(WEEK0 + WEEK - NOW);
    // not in a room, named: its tower pinned
    expect(got.mine).toMatchObject({ rank: 2, peak: 40, say: "in", n: 2 });
    // nothing in what the page gets says when anyone did anything
    for (const r of got.rows) expect(Object.keys(r).filter((k) => k !== "mine").sort()).toEqual(["names", "peak", "rank"]);
    expect(JSON.stringify(got)).not.toMatch(/peakAt|firstAt|"first"|settled/);
  });

  it("leaves out the suspended, and writes 一位舟P for one who keeps their name off (their place and title as anyone's)", async () => {
    const me = await player("me");
    const a = await player("a");
    const hid = await player("hid", { squadFireHide: true });
    const banned = await player("banned", { suspendedUntil: new Date(NOW + 86_400_000) });
    await tower(30, 0, [
      [banned, 50],
      [a, 10],
      [hid, 8],
    ]);
    const got = await board(me);
    expect(got.rows[0].names[0]).toMatchObject({ name: "a", look: { color: "cyan", avatar: "hood" } });
    expect(got.rows[0].names[1]).toEqual({ name: "一位舟P" });
    expect(got.rows).toHaveLength(1);
    expect(got.mine).toBeNull();
  });

  it("says where the asker's tower is: a few blocks short, named in the top, below it, not listed, last week's", async () => {
    const me = await player("me");
    const mate = await player("mate");
    const o = await player("o");
    const room = await roomOf(me, mate);
    // no block put: nothing pinned
    expect((await board(me)).mine).toBeNull();
    // listed, the asker short of 5
    await tower(
      10,
      0,
      [
        [mate, 9],
        [o, 6],
        [me, 2],
      ],
      WEEK0,
      room,
    );
    expect((await board(me)).mine).toMatchObject({ rank: 1, peak: 10, say: "short", k: 3 });
    // named
    await db.update(squadStackBlocks).set({ blocks: 5 }).where(eq(squadStackBlocks.userId, me.id));
    const named = (await board(me)).mine!;
    expect(named).toMatchObject({ rank: 1, say: "in", n: 3 });
    expect(named.names.map((n) => n.name)).toEqual(["mate", "o", "你"]);
    // the tower that began last week: said so, and so is the room's (old) on the way in
    await db.update(squadStackTowers).set({ week: new Date(WEEK0 - WEEK) }).where(eq(squadStackTowers.roomId, room));
    await db.update(squadStackBlocks).set({ week: new Date(WEEK0 - WEEK) }).where(eq(squadStackBlocks.roomId, room));
    const old = await board(me);
    expect(old.mine).toMatchObject({ rank: null, say: "old" });
    expect(old.old).toBe(true);
    // a tower of the room's this week not listed: off
    await db.delete(squadStackTowers);
    await db.delete(squadStackBlocks);
    await tower(3, 0, [[me, 3]], WEEK0, room);
    const off = await board(me);
    expect(off.mine).toMatchObject({ rank: null, say: "off" });
    expect(off.old).toBeUndefined();
  });

  it("says 离前 100 还差 for a tower listed below the hundredth", async () => {
    const me = await player("me");
    const mate = await player("mate");
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
      await tower(140 - i, 0, [
        [crowd[2 * i], 5],
        [crowd[2 * i + 1], 5],
      ]);
    }
    await tower(33, 0, [
      [me, 5],
      [mate, 5],
    ]);
    const got = await board(me);
    expect(got.rows).toHaveLength(101);
    expect(got.holders).toBe(200);
    expect(got.mine).toMatchObject({ rank: 101, peak: 33, say: "below", d: 9 });
  });

  it("is kept off the board with the one 周榜写我的名字 switch on the 卫戍名片, as 火焰周榜 is", async () => {
    const me = await player("me");
    const a = await player("a");
    expect((await squad(a, "card", { card: null, fireHide: true })).body).toMatchObject({ fireHide: true });
    await tower(12, 0, [
      [a, 6],
      [me, 5],
    ]);
    expect(plain((await board(me)).rows)[0].names).toEqual([{ name: "一位舟P" }, { name: "你", you: true }]);
  });
});

describe("基建狂魔", () => {
  it("settles last week once: keeps its board, gives the named of the top 100 towers 基建狂魔 for a week with their place, clears what is older", async () => {
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((n) => player(n)));
    const last = WEEK0 - WEEK;
    const r1 = await tower(
      80,
      0,
      [
        [a, 8],
        [b, 6],
      ],
      last,
    );
    await tower(
      60,
      0,
      [
        [c, 9],
        [d, 5],
      ],
      last,
    );
    // c held it from the week before: worn on, a new place
    await db.insert(userBadges).values({ userId: c.id, badge: STACKTOP, earnedAt: new Date(last), serial: 9, seenAt: new Date(last + 1000) });
    // two weeks ago: cleared
    await tower(5, 0, [[a, 30]], last - WEEK);
    await db.insert(squadStackWeeks).values({ week: new Date(last - WEEK), board: [] });
    const given = await settleStackWeek(NOW);
    expect(new Set(given)).toEqual(new Set([a.id, b.id, c.id, d.id]));
    // once only
    expect(await settleStackWeek(NOW + 60_000)).toBeNull();
    const rows = await db.select().from(userBadges);
    expect(rows.map((r) => [r.userId, r.badge, r.earnedAt.getTime(), r.serial, r.seenAt]).sort()).toEqual(
      [
        [a.id, STACKTOP, WEEK0, 1, null],
        [b.id, STACKTOP, WEEK0, 1, null],
        [c.id, STACKTOP, WEEK0, 2, null],
        [d.id, STACKTOP, WEEK0, 2, null],
      ].sort(),
    );
    const weeks = await db.select().from(squadStackWeeks);
    expect(weeks.map((w) => w.week.getTime())).toEqual([last]);
    expect(weeks[0].board.map((r) => [r.rank, r.peak, r.room, r.round, r.users])).toEqual([
      [1, 80, r1, 1, [a.id, b.id]],
      [2, 60, expect.any(String), 1, [c.id, d.id]],
    ]);
    expect((await db.select().from(squadStackTowers)).every((r) => r.week.getTime() >= last)).toBe(true);
    expect((await db.select().from(squadStackBlocks)).every((r) => r.week.getTime() >= last)).toBe(true);
    // last week's page: who won, as it was
    const page = await board(a, "last");
    expect(plain(page.rows)).toEqual([
      { rank: 1, peak: 80, names: [{ name: "你", you: true }, { name: "b" }], got: true, mine: true },
      { rank: 2, peak: 60, names: [{ name: "c" }, { name: "d" }], got: true },
    ]);
    expect(page.holders).toBe(4);
    expect(page.mine).toMatchObject({ rank: 1, say: "old" });
  });

  it("is worn a week then gone; says its own place in the popup; shows as a small tower by its wearer's name in a room", async () => {
    const a = await player("a");
    const b = await player("b");
    const host = await player("host");
    await tower(
      80,
      0,
      [
        [a, 8],
        [b, 6],
      ],
      WEEK0 - WEEK,
    );
    await settleStackWeek(NOW);
    expect((await earnedBy(a.id)).find((e) => e.id === STACKTOP)).toMatchObject({ serial: 1, until: WEEK0 + STACKTOP_DAYS * 86_400_000 });
    expect(badgeById(STACKTOP)?.place).toBe(T.lib.badges.stacktop.place);
    expect(T.lib.badges.stacktop.place).toBe("上周基建周榜第 {n} 名");
    // in a room: a and b wear it, the host not
    await roomOf(host, a);
    const v = (await squad(host, "room")).body!.room as SquadRoom;
    expect(v.members.map((m) => [m.name, Boolean(m.stackTop), Boolean(m.fireTop)])).toEqual([
      ["host", false, false],
      ["a", true, false],
    ]);
    // a week on: gone
    at(WEEK0 + WEEK + 1);
    expect((await earnedBy(a.id)).some((e) => e.id === STACKTOP)).toBe(false);
    const later = (await squad(host, "room")).body!.room as SquadRoom | null;
    expect(later?.members.every((m) => !m.stackTop) ?? true).toBe(true);
  });

  it("keeps last week's names as they show now: turned off since, 一位舟P", async () => {
    const a = await player("a");
    const b = await player("b");
    const me = await player("me");
    await tower(
      50,
      0,
      [
        [a, 8],
        [b, 6],
      ],
      WEEK0 - WEEK,
    );
    await settleStackWeek(NOW);
    await db.update(users).set({ squadFireHide: true }).where(eq(users.id, b.id));
    expect(plain((await board(me, "last")).rows)).toEqual([{ rank: 1, peak: 50, names: [{ name: "a" }, { name: "一位舟P" }], got: true }]);
  });
});
