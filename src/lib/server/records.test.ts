import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { declarationText, REACTIONS } from "../declarations";
import { DAY_INDEX, type DayField, type RecordsSummary, type TimelineItem, type TimelineQuery } from "../records";
import { db } from "./db";
import { forgetRecords, keptAnswers, recordsLite, recordsSummary, recordsTimeline } from "./records";
import { recordsOpen } from "./recordsOpen";
import {
  amiyaTouches,
  blocks,
  declarations,
  drinks,
  friendCuts,
  friendNotes,
  friendships,
  moves,
  passes,
  pokes,
  reactions,
  touches,
  userBadges,
  users,
  type UserRow,
} from "./schema";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// Runs against the database named in vitest.config.mts, which is wiped before every test

const BEIJING = 480;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Noon in Beijing on 11/16: the summary's now */
const NOW = Date.parse("2026-11-16T12:00:00+08:00");
const bj = (s: string) => new Date(Date.parse(`${s}+08:00`));

async function player(name: string): Promise<string> {
  const [u] = await db.insert(users).values({ email: `${name}@example.com`, name, anonymous: false }).returning({ id: users.id });
  return u.id;
}
const row = async (id: string): Promise<UserRow> => (await db.select().from(users).where(eq(users.id, id)))[0];
const befriend = (x: string, y: string, at: Date) => db.insert(friendships).values({ ...(x < y ? { a: x, b: y } : { a: y, b: x }), createdAt: at });
const touch = (from: string, to: string, at: Date, more: Partial<typeof touches.$inferInsert> = {}) =>
  db
    .insert(touches)
    .values({ fromUserId: from, toUserId: to, bold: true, toSlot: 0, createdAt: at, ...more })
    .returning({ id: touches.id })
    .then((r) => r[0].id);
const declare = (sender: string, at: Date, more: Partial<typeof declarations.$inferInsert> = {}) =>
  db
    .insert(declarations)
    .values({ senderId: sender, template: "stronghold", recipients: 7, createdAt: at, ...more })
    .returning({ id: declarations.id })
    .then((r) => r[0].id);
const num = (s: RecordsSummary, i: number, f: DayField) => s.days[i][DAY_INDEX[f]];
const all: TimelineQuery = { before: null, dir: "all", cat: "all", kind: null };

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  forgetRecords();
  vi.stubEnv("RECORDS", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("who 「我的记录」 is open to", () => {
  it("follows RECORDS: everyone, the 站长 and admins only, or nobody", async () => {
    const owner = await row(await player("owner"));
    const a = await row(await player("a"));
    expect([recordsOpen(owner), recordsOpen(a)]).toEqual([true, true]);
    vi.stubEnv("RECORDS", "admins");
    expect([recordsOpen(owner), recordsOpen(a)]).toEqual([true, false]);
    vi.stubEnv("RECORDS", "off");
    expect([recordsOpen(owner), recordsOpen(a)]).toEqual([false, false]);
  });
});

describe("the summary", () => {
  it("puts each thing on the day and hour of the player's own clock", async () => {
    const [me, b] = [await player("me"), await player("b")];
    await touch(me, b, bj("2026-11-15T23:30:00"));
    await touch(me, b, bj("2026-11-16T00:30:00"), { bold: false });
    const beijing = await recordsSummary(await row(me), BEIJING, NOW);
    expect([num(beijing, 0, "outBold"), num(beijing, 0, "outSneaky"), num(beijing, 1, "outBold")]).toEqual([0, 1, 1]);
    expect(beijing.hours[0][23]).toBe(1);
    expect(beijing.hours[0][0]).toBe(1);
    // on a clock at UTC both were on 11/15, at 15:30 and 16:30
    const utc = await recordsSummary(await row(me), 0, NOW);
    expect([num(utc, 0, "outBold") + num(utc, 0, "outSneaky"), num(utc, 1, "outBold"), num(utc, 1, "outSneaky")]).toEqual([0, 1, 1]);
    expect([utc.hours[0][15], utc.hours[0][16]]).toEqual([1, 1]);
    // noon in Beijing is still 11/16 at UTC
    expect(utc.today).toBe(beijing.today);
  });

  it("counts touches got, which roach, touched back or crawled away from, leaving out withheld ones and blocked players", async () => {
    const [me, b, c, blocked] = [await player("me"), await player("b"), await player("c"), await player("blocked")];
    const t1 = await touch(b, me, bj("2026-11-16T09:00:00"), { toSlot: 0 });
    await touch(c, me, bj("2026-11-16T09:10:00"), { bold: false, toSlot: 2, ignoredAt: new Date() });
    await touch(me, b, bj("2026-11-16T09:20:00"), { replyTo: `t:${t1}`, toSlot: null });
    await touch(c, me, bj("2026-11-16T09:30:00"), { withheld: true });
    await db.insert(blocks).values({ blockerId: me, blockedId: blocked });
    await touch(blocked, me, bj("2026-11-16T09:40:00"));
    await touch(me, blocked, bj("2026-11-16T09:41:00"));
    const s = await recordsSummary(await row(me), BEIJING, NOW);
    const today = (f: DayField) => num(s, 0, f);
    expect([today("inBold"), today("inSneaky"), today("inMain"), today("inClone2"), today("touchedBack"), today("crawled")]).toEqual([1, 1, 1, 1, 1, 1]);
    expect([today("outBold"), today("outSneaky")]).toEqual([1, 0]);
  });

  it("counts each sentence declared, and the reactions got by their words alone", async () => {
    const [me, b, c] = [await player("me"), await player("b"), await player("c")];
    const d1 = await declare(me, bj("2026-11-16T08:00:00"));
    await declare(me, bj("2026-11-10T08:00:00"));
    await declare(me, bj("2026-10-01T08:00:00"), { template: "launch", game: "arknights" });
    await declare(me, bj("2026-11-16T09:00:00"), { template: "listen", song: "某首歌" });
    await db.insert(reactions).values([
      { declarationId: d1, fromUserId: b, reaction: "plusone", createdAt: bj("2026-11-16T08:05:00") },
      { declarationId: d1, fromUserId: c, reaction: "plusone", createdAt: bj("2026-11-16T08:06:00"), withheld: true },
    ]);
    const s = await recordsSummary(await row(me), BEIJING, NOW);
    const stronghold = declarationText({ template: "stronghold" });
    expect(s.lines).toEqual([
      // 11/10 is the 7th day back: in the last 7 days
      [stronghold, 2, 2, 2],
      [T.server.records.listenLine, 1, 1, 1],
      [declarationText({ template: "launch", game: "arknights" }), 0, 0, 1],
    ]);
    expect(JSON.stringify(s)).not.toContain("某首歌");
    expect(s.reactionsIn).toEqual([[REACTIONS.plusone, 1, 1, 1]]);
    expect(num(s, 0, "reactedIn")).toBe(1);
    expect(JSON.stringify(s)).not.toMatch(/"b"|"c"/);
  });

  it("counts with each 触须之交 only what says who: their bold touches, never a sneaky one", async () => {
    const [me, f] = [await player("me"), await player("f")];
    await befriend(me, f, bj("2026-11-01T10:00:00"));
    await touch(me, f, bj("2026-11-16T08:00:00"), { bold: false });
    await touch(f, me, bj("2026-11-16T08:01:00"));
    await touch(f, me, bj("2026-11-16T08:02:00"), { bold: false });
    await db.insert(friendNotes).values([
      { fromUserId: f, toUserId: me, kind: "hug", period: "2026-11-16", createdAt: bj("2026-11-16T08:03:00") },
      { fromUserId: me, toUserId: f, kind: "listenAsk", period: "x", song: "s", createdAt: bj("2026-11-16T08:04:00") },
    ]);
    await db.insert(pokes).values({ fromUserId: me, toUserId: f, day: "2026-11-16", createdAt: bj("2026-11-16T08:05:00") });
    const s = await recordsSummary(await row(me), BEIJING, NOW);
    expect(s.friends).toMatchObject([{ name: "f", touch: [2, 2, 2], gest: [1, 1, 1], poke: [1, 1, 1] }]);
    expect(num(s, 0, "gestures")).toBe(1);
  });

  it("lists the drinks, and gives the totals as the clean-up counted them and what is kept", async () => {
    const [me, b] = [await player("me"), await player("b")];
    await db.insert(drinks).values({ userId: me, at: bj("2026-11-15T23:00:00"), until: bj("2026-11-16T08:00:00"), soberAt: bj("2026-11-16T01:00:00") });
    await db.update(users).set({ oldTouchesOut: 10, oldTouchesIn: 5, oldDeclarations: 2, visitDays: 9 }).where(eq(users.id, me));
    await touch(me, b, bj("2026-11-16T08:00:00"));
    await touch(b, me, bj("2026-11-16T08:00:00"), { withheld: true });
    await declare(me, bj("2026-11-16T08:00:00"));
    const s = await recordsSummary(await row(me), BEIJING, NOW);
    expect(s.drinks).toEqual([{ at: bj("2026-11-15T23:00:00").getTime(), until: bj("2026-11-16T08:00:00").getTime(), soberAt: bj("2026-11-16T01:00:00").getTime() }]);
    expect(num(s, 1, "drinks")).toBe(1);
    expect(s.totals).toMatchObject({ visitDays: 9, touchesOut: 11, touchesIn: 5, declarations: 3 });
  });

  it("says nothing of 寻访 while it is closed to the player, and counts it once open", async () => {
    const [me, f] = [await player("me"), await player("f")];
    await befriend(me, f, bj("2026-11-01T10:00:00"));
    const at = bj("2026-11-16T08:00:00");
    await db.insert(passes).values([
      { userId: me, charId: 1, no: 7, wish: true, drawnAt: at },
      { userId: me, charId: 1, no: 900, drawnAt: at },
      { userId: me, charId: 2, no: 325, drawnAt: at },
    ]);
    await db.insert(friendNotes).values({ fromUserId: f, toUserId: me, kind: "gift", period: "2026-11-16", createdAt: at });
    const closed = await recordsSummary(await row(me), BEIJING, NOW);
    expect(closed.passes).toBeUndefined();
    expect([num(closed, 0, "draws"), num(closed, 0, "gifts")]).toEqual([0, 0]);
    expect(closed.friends[0].gest).toEqual([0, 0, 0]);
    vi.stubEnv("PASSES", "on");
    forgetRecords();
    const open = await recordsSummary(await row(me), BEIJING, NOW);
    expect(open.passes).toEqual({ draws: 3, chars: 2, wish: 1, laser: 1, gold: 2 });
    expect([num(open, 0, "draws"), num(open, 0, "gifts")]).toEqual([1, 1]);
  });

  it("gives 「我的资料」's card the last 7 days only", async () => {
    const [me, b] = [await player("me"), await player("b")];
    await touch(me, b, bj("2026-11-16T08:00:00"));
    await touch(b, me, bj("2026-11-14T08:00:00"));
    await touch(b, me, bj("2026-11-01T08:00:00"));
    await declare(me, bj("2026-11-10T08:00:00"));
    expect(await recordsLite(await row(me), BEIJING, NOW)).toMatchObject({ out: [1, 0, 0, 0, 0, 0, 0], in: [0, 0, 1, 0, 0, 0, 0], declared: [0, 0, 0, 0, 0, 0, 1] });
  });

  it("keeps an answer a minute, then lets it go from memory", async () => {
    const [me, b] = [await player("me"), await player("b")];
    const u = await row(me);
    for (let k = 0; k < 5; k++) await recordsLite(u, BEIJING - k, NOW);
    expect(keptAnswers()).toBe(5);
    await touch(me, b, bj("2026-11-16T08:00:00"));
    expect((await recordsLite(u, BEIJING, NOW + 59_000)).out[0]).toBe(0);
    expect((await recordsLite(u, BEIJING, NOW + 60_000)).out[0]).toBe(1);
    expect(keptAnswers()).toBe(1);
  });
});

describe("the timeline's names", () => {
  const items = async (me: string, q: Partial<TimelineQuery> = {}) => (await recordsTimeline(await row(me), { ...all, ...q })).items;
  const of = <K extends TimelineItem["kind"]>(list: TimelineItem[], kind: K) => list.filter((i): i is Extract<TimelineItem, { kind: K }> => i.kind === kind);

  it("names who touched boldly, never who touched sneakily, 触须之交 or not", async () => {
    const [me, b, f] = [await player("me"), await player("b"), await player("f")];
    await befriend(me, f, bj("2026-11-01T10:00:00"));
    await touch(b, me, bj("2026-11-16T08:00:00"), { toSlot: 1 });
    await touch(f, me, bj("2026-11-16T08:01:00"), { bold: false });
    const got = of(await items(me), "tin");
    expect(got.map((t) => [t.bold, t.who, t.slot])).toEqual([
      [false, null, 0],
      [true, { name: "b" }, 1],
    ]);
  });

  it("names whom you touched only when you knew: a 触须之交 then, or one who boldly touched back; never whose clone", async () => {
    const [me, f, s, back, ex] = [await player("me"), await player("f"), await player("s"), await player("back"), await player("ex")];
    await befriend(me, f, bj("2026-11-01T10:00:00"));
    await touch(me, f, bj("2026-11-16T08:00:00"), { bold: false });
    await touch(me, s, bj("2026-11-16T08:01:00"), { toSlot: 2 });
    const t = await touch(me, back, bj("2026-11-16T08:02:00"), { bold: false, toSlot: 1 });
    await touch(back, me, bj("2026-11-16T08:03:00"), { replyTo: `t:${t}`, toSlot: null });
    // once 触须之交: 「一位舟P」
    const e = await touch(me, ex, bj("2026-11-16T08:04:00"));
    await touch(ex, me, bj("2026-11-16T08:05:00"), { replyTo: `t:${e}`, toSlot: null });
    await db.insert(friendCuts).values({ ...(me < ex ? { a: me, b: ex } : { a: ex, b: me }), cutAt: bj("2026-11-16T09:00:00") });
    // touched back sneakily: still nobody to name; crawled away from: never said
    const quiet = await touch(me, s, bj("2026-11-16T08:06:00"), { bold: false, toSlot: 0 });
    await touch(s, me, bj("2026-11-16T08:07:00"), { bold: false, replyTo: `t:${quiet}`, toSlot: null });
    const ignored = await touch(me, s, bj("2026-11-16T08:08:00"), { bold: true, toSlot: 0 });
    await db.update(touches).set({ ignoredAt: new Date() }).where(eq(touches.id, ignored));

    const sent = of(await items(me), "tout");
    expect(sent.map((x) => [x.who, x.clone, x.got])).toEqual([
      [null, false, null],
      [null, false, "sneaky"],
      [{ ex: true }, false, "bold"],
      [{ name: "back" }, true, "bold"],
      [null, true, null],
      [{ name: "f" }, false, null],
    ]);
    expect(JSON.stringify(sent)).not.toMatch(/ignored/);
  });

  it("says what reactions came and what you answered, never who, and nothing at all of players you blocked", async () => {
    const [me, b, blocked] = [await player("me"), await player("b"), await player("blocked")];
    const mine = await declare(me, bj("2026-11-16T08:00:00"));
    const theirs = await declare(b, bj("2026-11-16T07:00:00"), { template: "launch", game: "arknights" });
    await db.insert(reactions).values([
      { declarationId: mine, fromUserId: b, reaction: "plusone", createdAt: bj("2026-11-16T08:10:00") },
      { declarationId: mine, fromUserId: blocked, reaction: "six", createdAt: bj("2026-11-16T08:11:00") },
      { declarationId: theirs, fromUserId: me, reaction: "alsoplay", createdAt: bj("2026-11-16T08:20:00") },
    ]);
    await db.insert(blocks).values({ blockerId: me, blockedId: blocked });
    await touch(blocked, me, bj("2026-11-16T08:30:00"));
    await db.insert(pokes).values({ fromUserId: blocked, toUserId: me, day: "2026-11-16", createdAt: bj("2026-11-16T08:31:00") });
    const list = await items(me);
    expect(of(list, "rxin")).toMatchObject([{ rx: [[REACTIONS.plusone, 1]], declaredAt: bj("2026-11-16T08:00:00").getTime() }]);
    expect(of(list, "decl")[0].rx).toEqual([[REACTIONS.plusone, 1]]);
    expect(of(list, "rxout")).toMatchObject([{ text: declarationText({ template: "launch", game: "arknights" }), reaction: REACTIONS.alsoplay }]);
    expect(of(list, "tin")).toEqual([]);
    expect(of(list, "poke")).toEqual([]);
    expect(JSON.stringify(list)).not.toMatch(/"name":"b"|"blocked"/);
  });

  it("leaves out 想一起听 and, while 寻访 is closed, the draws and 寻访券", async () => {
    const [me, f] = [await player("me"), await player("f")];
    await befriend(me, f, bj("2026-11-01T10:00:00"));
    await db.insert(friendNotes).values([
      { fromUserId: f, toUserId: me, kind: "listenAsk", period: "x", song: "s", createdAt: bj("2026-11-16T08:00:00") },
      { fromUserId: f, toUserId: me, kind: "gift", period: "2026-11-16", createdAt: bj("2026-11-16T08:01:00") },
      { fromUserId: me, toUserId: f, kind: "highfive", period: "2026-11-16", createdAt: bj("2026-11-16T08:02:00") },
    ]);
    await db.insert(passes).values({ userId: me, charId: 1, no: 5, drawnAt: bj("2026-11-16T08:03:00") });
    const closed = await items(me);
    expect(closed.map((i) => i.kind).sort()).toEqual(["friend", "note"]);
    vi.stubEnv("PASSES", "on");
    const open = await items(me);
    expect(of(open, "note").map((n) => [n.note, n.dir])).toEqual([
      ["highfive", "out"],
      ["gift", "in"],
    ]);
    expect(of(open, "pass")).toMatchObject([{ cards: [{ charId: 1, no: 5, tag: "new", gold: "top" }] }]);
  });
});

describe("the timeline's pages", () => {
  it("never loses or repeats an item, however many share a moment and a source", async () => {
    const [me, b] = [await player("me"), await player("b")];
    const at = bj("2026-11-16T08:00:00");
    // 40 touches each way, 10 drinks and moves at one moment, and 25 more a second before
    for (let i = 0; i < 40; i++) {
      await touch(me, b, at);
      await touch(b, me, at);
    }
    for (let i = 0; i < 10; i++) {
      await db.insert(drinks).values({ userId: me, at, until: new Date(at.getTime() + HOUR) });
      await db.insert(moves).values({ userId: me, slot: 0, at });
    }
    for (let i = 0; i < 25; i++) await touch(me, b, new Date(at.getTime() - 1000));
    await db.insert(amiyaTouches).values({ userId: me, direction: "to_amiya", bold: true, createdAt: at });
    await db.insert(userBadges).values({ userId: me, badge: "tipsy", earnedAt: at });
    const seen: string[] = [];
    let before: string | null = null;
    for (let n = 0; n < 20; n++) {
      const page = await recordsTimeline(await row(me), { ...all, before });
      seen.push(...page.items.map((i) => i.key));
      expect(page.items.length).toBeLessThanOrEqual(30);
      if (!page.next) break;
      before = page.next;
    }
    expect(seen).toHaveLength(40 + 40 + 10 + 10 + 25 + 1 + 1);
    expect(new Set(seen).size).toBe(seen.length);
    // newest first throughout
    const ats = seen.map((k) => BigInt(k.split("|")[0]));
    expect(ats.every((x, i) => i === 0 || x <= ats[i - 1])).toBe(true);
  });

  it("filters by side, kind of record, and the overview's numbers", async () => {
    const [me, b] = [await player("me"), await player("b")];
    await touch(me, b, bj("2026-11-16T08:00:00"));
    await touch(b, me, bj("2026-11-16T08:01:00"));
    await declare(me, bj("2026-11-16T08:02:00"));
    await db.insert(drinks).values({ userId: me, at: bj("2026-11-16T08:03:00"), until: bj("2026-11-16T09:00:00") });
    const kinds = async (q: Partial<TimelineQuery>) => (await recordsTimeline(await row(me), { ...all, ...q })).items.map((i) => i.kind);
    expect(await kinds({ dir: "in" })).toEqual(["tin"]);
    expect(await kinds({ dir: "out" })).toEqual(["drink", "decl", "tout"]);
    expect(await kinds({ cat: "touch" })).toEqual(["tin", "tout"]);
    expect(await kinds({ kind: "decl" })).toEqual(["decl"]);
    expect(await kinds({ before: "garbage" })).toHaveLength(4);
    void DAY;
  });
});
