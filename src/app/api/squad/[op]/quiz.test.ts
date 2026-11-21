import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PASS_CATALOG } from "@/lib/passCatalog";
import { QUIZ_ANSWER_MS, QUIZ_INTRO_MS, QUIZ_LEAD_MS, QUIZ_REVEAL_MS, QUIZ_RESULT_MS, type QuizAsk, type QuizMode } from "@/lib/squadMode";
import { OPERATOR_ART_DIR } from "@/lib/server/env";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, sessions, siteSettings, songs, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetDanceBeats, openMode, startMatch, sweepModes } from "@/lib/server/squadModes";
import { forgetPassArt } from "@/lib/server/passArt";
import { forgetQuizArt } from "@/lib/server/quizArt";
import { POST } from "./route";

// 凯尔希随堂测 on the server (玩点什么's second mode)

// the owner is an admin; the pass pictures' folder a fresh one of the test's own (empty till a test puts some in)
vi.mock("@/lib/server/env", async (original) => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  return {
    ...(await original<typeof import("@/lib/server/env")>()),
    ADMIN_EMAILS: ["owner@example.com"],
    OPERATOR_ART_DIR: mkdtempSync(p.join(os.tmpdir(), "quiz-art-")),
  };
});

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
  forgetQuizArt();
  // no pass pictures till a test puts some in
  rmSync(path.join(OPERATOR_ART_DIR, "pass"), { recursive: true, force: true });
  forgetPassArt();
  forgetListeningCount();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const quizOf = async (u: Pick<User, "id">) => (await viewOf(u)).mode as QuizMode;
/** Each question's start, from a quiz opened at t0 with these kinds */
const starts = (t0: number, kinds: string[]) => {
  let t = t0 + QUIZ_LEAD_MS;
  return kinds.map((k) => {
    const q = { at: t, ends: t + (k === "intro" ? QUIZ_INTRO_MS : QUIZ_ANSWER_MS) };
    t = q.ends + QUIZ_REVEAL_MS;
    return q;
  });
};
/** Always the first: every question of the first kind there is, its first character, song or question */
const first = () => 0;

/** Five characters of the same game with pass pictures in the test's folder: a shape on nothing, red */
async function pictures() {
  const dir = path.join(OPERATOR_ART_DIR, "pass");
  mkdirSync(dir, { recursive: true });
  const chars = PASS_CATALOG.filter((c) => c.game === "ak").slice(0, 6);
  const art: Record<string, { file: string; color: string }> = {};
  for (const [i, c] of chars.entries()) {
    const file = `${String(i + 1).padStart(15, "0")}a`;
    const shape = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><ellipse cx="120" cy="170" rx="90" ry="140" fill="#d23c3c"/></svg>`,
    );
    writeFileSync(path.join(dir, `${file}.s.webp`), await sharp(shape).webp().toBuffer());
    writeFileSync(path.join(dir, `${file}.webp`), await sharp(shape).resize(480, 640).webp().toBuffer());
    art[String(c.id)] = { file, color: "#d23c3c" };
  }
  writeFileSync(path.join(dir, "index.json"), JSON.stringify({ art }));
  return chars;
}

/** The quiz picked by its initiator, those given ready, and started now (the first of everything) */
async function play(u: Pick<User, "id">, ready: Pick<User, "id">[] = [], now = clock) {
  await openMode(u, { kind: "quiz" }, now, first);
  for (const r of ready) expect((await post(r, "modein", { in: true })).status).toBe(200);
  await startMatch(u, now, first);
}

describe("凯尔希随堂测", () => {
  it("asks five questions one after another, each three to pick from once begun; the first right gets the point, the room told", async () => {
    const { host, a, b, room } = await cast();
    const heard = told(b);
    // no pictures here, and the songs to all: one of each kind there is; always the first, 方舟梗 when the songs are not
    await db.update(users).set({ email: "x@example.com" }).where(eq(users.id, host.id));
    vi.stubEnv("LISTEN", "admins");
    await play(a, [b]);
    const t0 = clock;
    const mode = await quizOf(b);
    expect(mode).toMatchObject({ kind: "quiz", by: 2, begun: t0, in: [{ h: 2, combo: 0 }, { h: 3, combo: 0 }], until: starts(t0, Array(5).fill("meme"))[4].ends + QUIZ_REVEAL_MS + QUIZ_RESULT_MS });
    expect(mode.questions.map((q) => [q.kind, q.at, q.ends])).toEqual(starts(t0, Array(5).fill("meme")).map((q) => ["meme", q.at, q.ends]));
    // nothing of a question till it begins
    expect(mode.questions[0]).not.toHaveProperty("options");
    const q0 = mode.questions[0];
    expect(await post(b, "question", { n: 0 })).toMatchObject({ status: 409, body: { error: "这题还没开始。" } });
    at(q0.at - 1_000);
    const asked = (await post(b, "question", { n: 0 })).body as unknown as QuizAsk;
    expect(asked).toMatchObject({ n: 0, kind: "meme", at: q0.at, ends: q0.ends });
    expect(asked.options).toHaveLength(3);
    expect(asked.ask).toMatch(/？$/);
    expect(await post(b, "answer", { n: 0, pick: 0 })).toMatchObject({ status: 409, body: { error: "这题还没开始。" } });
    at(q0.at + 800);
    const view = await quizOf(a);
    expect(view.questions[0].options).toEqual(asked.options);
    expect(view.questions[0]).not.toHaveProperty("answer");
    const wrong = (await post(b, "answer", { n: 0, pick: 0 })).body!;
    const answer = wrong.answer as number;
    expect(wrong).toMatchObject({ right: answer === 0, first: answer === 0 });
    // b answered: once a question
    expect(await post(b, "answer", { n: 0, pick: answer })).toMatchObject({ status: 409, body: { error: "这题你答过了。" } });
    if (answer !== 0) {
      expect((await post(a, "answer", { n: 0, pick: answer })).body).toMatchObject({ right: true, first: true, answer });
      expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "quiz", h: 2 } });
      const after = await quizOf(b);
      expect(after.questions[0]).toMatchObject({ answer, first: { h: 2, ms: 800 } });
      expect(after.in).toEqual([
        { h: 2, combo: 1 },
        { h: 3, combo: 0 },
      ]);
    }
    // the host is not in it; one late is refused
    expect(await post(host, "answer", { n: 0, pick: 0 })).toMatchObject({ status: 409, body: { error: "先加入才能答。" } });
    const q1 = mode.questions[1];
    at(q1.ends + 100);
    expect(await post(a, "answer", { n: 1, pick: 0, at: q1.ends + 100 })).toMatchObject({ status: 409, body: { error: "这题时间到了。" } });
    // in after its start: the next round, never this one
    const q2 = mode.questions[2];
    at(q2.at + 500);
    expect((await post(host, "modein", { in: true })).status).toBe(200);
    expect((await quizOf(b)).next).toEqual([1]);
    expect(await post(host, "answer", { n: 2, pick: 0 })).toMatchObject({ status: 409, body: { error: "这局开始以后才进来的，下一局再答。" } });
    at(mode.questions[3].at + 100);
    expect(await post(host, "answer", { n: 3, pick: 0 })).toMatchObject({ status: 409, body: { error: "这局开始以后才进来的，下一局再答。" } });
    expect((await post(b, "answer", { n: 3, pick: 0 })).status).toBe(200);
  });

  it("puts 漏勺 on the lowest at the end, two or more in it, all of those tied there, none when all are; one asking for the next is not in it", async () => {
    const { host, a, b, room } = await cast();
    vi.stubEnv("LISTEN", "admins");
    await play(a, [b, host]);
    const until = (await quizOf(a)).until;
    await db.update(squadMembers).set({ modeCombo: 3 }).where(eq(squadMembers.roomId, room.id));
    await db
      .update(squadMembers)
      .set({ modeCombo: 1 })
      .where(sql`${squadMembers.roomId} = ${room.id} and ${squadMembers.handle} in (1, 3)`);
    at(until + 1);
    expect(await sweepModes(clock)).toBe(1);
    const heads = await db.select({ h: squadMembers.handle, head: squadMembers.head, until: squadMembers.headUntil }).from(squadMembers).where(eq(squadMembers.roomId, room.id));
    expect(heads.sort((x, y) => x.h - y.h).map((r) => [r.h, r.head, r.until?.getTime() ?? null])).toEqual([
      [1, 5, until + 60_000],
      [2, null, null],
      [3, 5, until + 60_000],
    ]);
    // 再来一局 with the host out to watch and back for the next: a tie all round between a and b, nobody wears it
    at(clock + 30_000);
    await startMatch(a, clock, first);
    expect((await post(host, "modein", { in: false })).status).toBe(200);
    expect((await post(host, "modein", { in: true })).status).toBe(200);
    await db.update(squadMembers).set({ head: null, headUntil: null, modeCombo: 2 }).where(eq(squadMembers.roomId, room.id));
    await db.update(squadMembers).set({ modeCombo: 0 }).where(sql`${squadMembers.roomId} = ${room.id} and ${squadMembers.handle} = 1`);
    at((await quizOf(a)).until + 1);
    await sweepModes(clock);
    expect((await db.select({ head: squadMembers.head }).from(squadMembers).where(eq(squadMembers.roomId, room.id))).every((r) => r.head === null)).toBe(true);
  });

  it("makes each picture on the server, its silhouette or a part of it, never saying whose; the same character never twice", async () => {
    const chars = await pictures();
    const { a } = await cast();
    vi.stubEnv("LISTEN", "admins");
    await play(a);
    const mode = await quizOf(a);
    expect(mode.questions.map((q) => q.kind)).toEqual(Array(5).fill("sil"));
    at(mode.questions[0].at);
    const q = (await post(a, "question", { n: 0 })).body as unknown as QuizAsk;
    expect(q.pic).toMatch(/^data:image\/webp;base64,/);
    expect(chars.map((c) => c.name)).toEqual(expect.arrayContaining(q.options));
    // the shape kept, its colour gone
    const raw = await sharp(Buffer.from(q.pic!.split(",")[1], "base64"))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mid = (Math.floor(raw.info.height / 2) * raw.info.width + Math.floor(raw.info.width / 2)) * raw.info.channels;
    expect([raw.data[mid], raw.data[mid + 1], raw.data[mid + 2]].every((v) => v < 40)).toBe(true);
    expect(raw.data[3]).toBe(0);
    // five different characters
    const answers = new Set<string>();
    for (let n = 0; n < 5; n++) {
      at(mode.questions[n].at + 10);
      const pick = (await post(a, "answer", { n, pick: 0 })).body!.answer as number;
      answers.add((await quizOf(a)).questions[n].options![pick]);
    }
    expect(answers.size).toBe(5);
  });

  it("asks a song's intro only when everyone in the room can hear it, its link to each who can", async () => {
    const { a } = await cast();
    // LISTEN on: everyone hears; no pictures: intro first of what there is
    await play(a);
    const mode = await quizOf(a);
    // three songs: three intros, never the same song twice, then 方舟梗
    expect(mode.questions.map((q) => q.kind)).toEqual(["intro", "intro", "intro", "meme", "meme"]);
    expect(mode.questions[0].ends - mode.questions[0].at).toBe(QUIZ_INTRO_MS);
    at(mode.questions[0].at - 500);
    const q = (await post(a, "question", { n: 0 })).body as unknown as QuizAsk;
    expect(q.url).toMatch(/^\/music\//);
    expect(q.options.sort()).toEqual(["Song 1", "Song 2", "Song 3"]);
    // one who cannot hear 听歌: no intro at all in the next round
    at(clock + 600_000);
    await sweepModes(clock);
    vi.stubEnv("LISTEN", "admins");
    await startMatch(a, clock + 60_000, first);
    expect((await quizOf(a)).questions.every((x) => x.kind === "meme")).toBe(true);
  });
});
