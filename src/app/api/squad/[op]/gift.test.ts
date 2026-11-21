import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import {
  GIFT_GAP_MS,
  GIFT_HOLD_MS,
  GIFT_LADLE_MS,
  GIFT_LEAD_MS,
  GIFT_ROUND_MIN_MS,
  GIFT_ROUNDS,
  giftAt,
  giftLatest,
  giftUntil,
  type GiftData,
  type GiftMode,
} from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, sessions, siteSettings, songs, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetDanceBeats, openMode, settleRoom, sweepModes } from "@/lib/server/squadModes";
import { forgetGift } from "@/lib/server/squadGift";
import { POST } from "./route";

// W 的礼物 on the server (玩点什么's third mode)

// the owner is an admin
vi.mock("@/lib/server/env", async (original) => ({
  ...(await original<typeof import("@/lib/server/env")>()),
  ADMIN_EMAILS: ["owner@example.com"],
}));

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

async function player(name: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, name, anonymous: false, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now, squadCore: 0 })
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
async function ask(route: typeof POST, path: string, u: Pick<User, "id">, op: string, body: unknown) {
  await signIn(u);
  forgetHits();
  const req = new NextRequest(`http://localhost/api/${path}/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await route(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const post = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(POST, "squad", u, op, body);
const viewOf = async (u: Pick<User, "id">) => (await post(u, "room")).body!.room as SquadRoom;

/** Beats every half second from half a second in, for 200 s */
const BEATS = `{"v":1,"bpm":120,"bar":0,"t":"${Array(400).fill("50").join(",")}","e":"${"9".repeat(400)}"}`;
/** Two songs with beats to dance to, one with none (never picked) */
async function seedSongs() {
  await db.insert(songs).values(
    ["s1", "s2", "s3"].map((id, i) => ({
      id,
      game: "arknights",
      name: `Song ${i + 1}`,
      albumId: "a1",
      album: "Album",
      artists: ["塞壬唱片-MSR"],
      seconds: 200,
      file: `000000000000000${i + 1}.m4a`,
      bytes: 1000,
      dance: i === 2 ? '{"v":1,"none":"tempo","s":"9"}' : BEATS,
      albumOrder: 0,
      track: i,
      addedAt: new Date(),
    })),
  );
  await loadSongs();
}

/** The 站长's room with a and b in it, SQUAD and LISTEN on, the songs there */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await player("owner");
  const a = await player("a");
  const b = await player("b");
  const room = (await post(host, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  return { host, a, b, room };
}

const offs: (() => void)[] = [];
function told(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

let clock = 0;
const at = (ms: number) => {
  clock = ms;
  vi.setSystemTime(new Date(ms));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(Date.parse("2026-11-20T08:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadBots}, ${songs}, ${listenNow}, ${listenRooms}, ${listenMembers}, ${listenInvites}, ${siteSettings} cascade`);
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetDanceBeats();
  forgetGift();
  forgetListeningCount();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  forgetGift();
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const giftOf = async (u: Pick<User, "id">) => (await viewOf(u)).mode as GiftMode;
/** The gift as the server keeps it, and kept again as a test sets it */
const dataOf = async (roomId: string) => (await db.select({ d: squadRooms.modeData }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].d as GiftData;
const setData = (roomId: string, d: GiftData) => db.update(squadRooms).set({ modeData: d, modeUntil: new Date(giftUntil(d.plan)), modeLast: new Date(giftUntil(d.plan)) }).where(eq(squadRooms.id, roomId));
/** Always the first: every round GIFT_ROUND_MIN_MS, the seed 0, the first song with beats */
const first = () => 0;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;
/** Round r's song stopping at `stop` instead, the rounds after it moved with it (as they would have been made) */
const stopAt = (d: GiftData, r: number, stop: number) => {
  const shift = stop - d.plan[r].stop;
  d.plan = d.plan.map((p, i) => (i < r ? p : i === r ? { ...p, stop } : { at: p.at + shift, stop: p.stop + shift }));
  return d;
};
const headOf = async (u: Pick<User, "id">, name: string) => (await viewOf(u)).members.find((m) => m.name === name)!.head;

describe("W 的礼物", () => {
  it("seats its opener, the room's 人机 and its own round the drum, its song and first round; a round's stop never told before it comes", async () => {
    const { host, a, b, room } = await cast();
    const t0 = clock;
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    await openMode(a, { kind: "gift" }, clock, first);
    const v = await viewOf(b);
    const aH = handleOf(v, "a");
    const bot = v.members.find((m) => m.bot)!.h;
    const mode = v.mode as GiftMode;
    expect(mode).toMatchObject({ kind: "gift", by: aH, in: [{ h: aH, combo: 0 }], song: "s1", name: "Song 1", songAt: t0 + GIFT_LEAD_MS, seed: 0 });
    // the mode's own 人机, numbered after the room's
    expect(mode.bots.map((x) => [x.h, x.no])).toEqual([
      [-100, 2],
      [-101, 3],
      [-102, 4],
    ]);
    expect(mode.rounds).toEqual([{ at: t0 + GIFT_LEAD_MS, seats: [aH, bot, -100, -101], from: 0, taps: [] }]);
    // its end as late as it could be, till its last round's song has stopped
    expect(mode.until).toBe(giftLatest(t0 + GIFT_LEAD_MS));
    // its song for the pages, as 龙门广场舞's
    expect(await post(b, "song")).toMatchObject({ status: 200, body: { song: "s1", url: expect.any(String) } });
    // b in before it starts: in the first round, in the first seat of the mode's own 人机; everyone else stays put
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    const bH = handleOf(v, "b");
    expect((await giftOf(b)).rounds[0].seats).toEqual([aH, bot, bH, -101]);
    void room;
  });

  it("goes round as the players pass it, by itself after two seconds, and a 人机's as it holds; only the one holding it passes", async () => {
    const { a, b, room } = await cast();
    await openMode(a, { kind: "gift" }, clock, first);
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const r0 = (await giftOf(a)).rounds[0];
    expect(r0.seats).toEqual([aH, bH, -101, -102]);
    // not yet
    expect(await post(a, "pass")).toMatchObject({ status: 409, body: { error: "这一轮还没开始。" } });
    const heard = told(b);
    at(r0.at + 300);
    expect(await post(a, "pass")).toMatchObject({ status: 200, body: { at: r0.at + 300 } });
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "gift", h: aH } });
    // a has not got it any more; b has
    expect(await post(a, "pass")).toMatchObject({ status: 409, body: { error: "礼物不在你手上。" } });
    const after = (await giftOf(a)).rounds[0];
    expect(after.taps).toEqual([{ at: r0.at + 300, seat: 0 }]);
    expect(giftAt(after, 0, 0, clock)).toMatchObject({ seat: 1, since: r0.at + 300 });
    // b holds it two seconds: it goes on by itself, to the 人机, who pass it as their seed has it
    at(r0.at + 300 + GIFT_HOLD_MS + 1);
    expect(await post(b, "pass")).toMatchObject({ status: 409, body: { error: "礼物不在你手上。" } });
    expect(giftAt(after, 0, 0, clock).seat).toBe(2);
    // round to a again: a pass at the page's own time, a little before the server's now, taken as it was then
    let t = r0.at + 2_400;
    while (giftAt(after, 0, 0, t).seat !== 0) t += 50;
    const back = giftAt(after, 0, 0, t);
    at(back.since + 600);
    expect(await post(a, "pass", { at: back.since + 300 })).toMatchObject({ status: 200, body: { at: back.since + 300 } });
    expect((await giftOf(a)).rounds[0].taps).toEqual([
      { at: r0.at + 300, seat: 0 },
      { at: back.since + 300, seat: 0 },
    ]);
  });

  it("hits the one holding it as the song stops: turned over, 漏勺 for a minute with two or more playing, the next round from them", async () => {
    const { a, b, room } = await cast();
    await openMode(a, { kind: "gift" }, clock, first);
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    const v = await viewOf(a);
    const bH = handleOf(v, "b");
    const data = await dataOf(room.id);
    const r0 = data.rounds[0];
    // a passes at once; b holds it as the song stops
    at(r0.at + 100);
    expect((await post(a, "pass")).status).toBe(200);
    const kept = stopAt(await dataOf(room.id), 0, r0.at + 1_000);
    await setData(room.id, kept);
    // before anything settles it, the pages see the stop and who was hit
    at(r0.at + 1_050);
    const seen = (await giftOf(a)).rounds[0];
    expect(seen).toMatchObject({ stop: r0.at + 1_000, hit: 1 });
    const heard = told(a);
    expect(await settleRoom(room.id, clock)).toEqual({ changed: true, ended: false });
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "gift" } });
    const mode = await giftOf(a);
    expect(mode.in.find((m) => m.h === bH)).toEqual({ h: bH, combo: 1 });
    expect(await headOf(a, "b")).toMatchObject({ until: r0.at + 1_000 + GIFT_LADLE_MS });
    // the next round GIFT_GAP_MS after the stop, from b
    expect(mode.rounds[1]).toEqual({ at: kept.plan[1].at, seats: r0.seats, from: 1, taps: [] });
    expect(kept.plan[1].at).toBe(r0.at + 1_000 + GIFT_GAP_MS);
    // settled once
    expect(await settleRoom(room.id, clock)).toEqual({ changed: false, ended: false });
    // a pass after the stop: refused
    expect(await post(b, "pass")).toMatchObject({ status: 409, body: { error: "这一轮已经停了。" } });
  });

  it("puts no 漏勺 on one alone (practice), takes one coming in from the next round, and seats a 人机 where one went out", async () => {
    const { a, b, room } = await cast();
    await openMode(a, { kind: "gift" }, clock, first);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const data = await dataOf(room.id);
    const r0 = data.rounds[0];
    // a alone holds it as it stops
    await setData(room.id, stopAt(data, 0, r0.at + 1_000));
    // b comes in during the round: not in it
    at(r0.at + 500);
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await giftOf(a)).rounds[0].seats).toEqual([aH, -100, -101, -102]);
    at(r0.at + 1_100);
    await sweepModes(clock);
    // b's coming makes two playing at the stop: a wears it (two in it as it stopped)
    const mode = await giftOf(a);
    expect(mode.rounds[0]).toMatchObject({ hit: 0 });
    expect(mode.in.find((m) => m.h === aH)?.combo).toBe(1);
    expect(await headOf(b, "a")).toBeDefined();
    // b sits in the next round, in a seat of the mode's own
    expect(mode.rounds[1].seats).toEqual([aH, bH, -101, -102]);
    // b goes to watch before it starts: their seat a 人机's again
    expect((await post(b, "modein", { in: false })).status).toBe(200);
    expect((await giftOf(a)).rounds[1].seats).toEqual([aH, -100, -101, -102]);
    // alone at the next stop: no 漏勺 (a's from before ends first), a hit still counted
    const d1 = await dataOf(room.id);
    await setData(room.id, stopAt(d1, 1, d1.rounds[1].at + 500));
    at(d1.rounds[1].at + 600);
    const before = await headOf(b, "a");
    await settleRoom(room.id, clock);
    expect(await headOf(b, "a")).toEqual(before);
    expect((await giftOf(a)).in).toEqual([{ h: aH, combo: 2 }]);
  });

  it("plays five rounds, then its results, and ends; with no player left it ends at the next stop", async () => {
    const { a, b, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "gift" }, clock, first);
    const data = await dataOf(room.id);
    expect(data.plan).toHaveLength(GIFT_ROUNDS);
    expect(data.plan[0]).toEqual({ at: t0 + GIFT_LEAD_MS, stop: t0 + GIFT_LEAD_MS + GIFT_ROUND_MIN_MS });
    const until = giftUntil(data.plan);
    // all five over: settled together, then the results till its end; the pages told its true end now
    at(data.plan[4].stop + 10);
    await settleRoom(room.id, clock);
    const mode = await giftOf(a);
    expect(mode.rounds).toHaveLength(GIFT_ROUNDS);
    expect(mode.rounds.every((r) => r.hit !== undefined)).toBe(true);
    expect(mode.until).toBe(until);
    const heard = told(b);
    at(until + 1);
    expect(await sweepModes(clock)).toBe(1);
    expect((await viewOf(a)).mode).toBeNull();
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", on: false } });
    expect(await viewOf(a)).not.toHaveProperty("modeAgain");
    // again at once, and a goes to watch: at the first stop no one plays it, and it ends
    await openMode(a, { kind: "gift" }, clock, first);
    expect((await post(a, "modein", { in: false })).status).toBe(200);
    const d2 = await dataOf(room.id);
    at(d2.plan[0].stop + 1);
    expect(await settleRoom(room.id, clock)).toEqual({ changed: true, ended: true });
    expect((await viewOf(a)).mode).toBeNull();
    void b;
  });

  it("lets only those in it pass", async () => {
    const { host, a, room } = await cast();
    await openMode(a, { kind: "gift" }, clock, first);
    const r0 = (await dataOf(room.id)).rounds[0];
    at(r0.at + 100);
    expect(await post(host, "pass")).toMatchObject({ status: 409, body: { error: "先加入才能传。" } });
  });
});
