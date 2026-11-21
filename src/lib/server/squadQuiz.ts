import "server-only";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { PASS_CATALOG, passChar, type PassChar } from "../passCatalog";
import { NOT_IN_ROOM } from "../squad";
import { THROWS } from "../squadFire";
import {
  inRound,
  isLobbyData,
  QUIZ_EARLY_MS,
  QUIZ_FETCH_MS,
  QUIZ_LADLE_MS,
  QUIZ_LOAD_MAX_MS,
  QUIZ_QUESTIONS,
  quizLast,
  quizSchedule,
  quizUntil,
  type QuizAnswered,
  type QuizAsk,
  type QuizData,
  type QuizKind,
  type MatchRound,
  type QuizQuestion,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { listenOpen } from "./listen";
import { musicLink } from "./musicLinks";
import { passArtIndex } from "./passArt";
import { cropOf, quizArtReady, silhouetteOf } from "./quizArt";
import { squadMembers, squadRooms, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { songList } from "./songs";
import { roomOf, tellSquadPlay } from "./squad";

/**
 * 凯尔希随堂测 on the server (玩点什么; the rules in src/lib/squadMode.ts): a round's five questions made as its
 * initiator starts it and kept on the room (squad_rooms.mode_data) with their answers, never sent as they are; each
 * question's three and its picture or song given to the room's pages from just before it could start (askQuestion);
 * each page saying when it has it loaded, the question starting once everyone answering who is here has
 * (quizLoaded), or QUIZ_LOAD_MAX_MS late at most (quizSchedule); each answer judged on the server's clock, once a
 * question each of the round's players (who answered kept on the question), the first right one the point
 * (answerQuiz); at the round's end (squadModes.ts, as it comes: quizEnds), 漏勺 on the last.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
const notInRoom = () => refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
/** 漏勺, as 扔东西 puts it on a head */
const LADLE = THROWS.find((t) => t.key === "ladle")!.no;

const shuffle = <T>(list: T[], rand: (n: number) => number) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

type Q = QuizData["qs"][number];

/**
 * A quiz for these players in the room (as it opens; its first question QUIZ_LEAD_MS on at the soonest): five questions of the kinds
 * that can be asked here (pictures while there are any and sharp is here; an intro only when every one of them can
 * hear 听歌's songs now; 方舟梗 always), never the same character, song or question twice, the two others of a
 * character's from the same game. Null when none can be asked.
 */
export async function makeQuiz(people: Pick<UserRow, "id" | "email">[], now: number, rand: (n: number) => number): Promise<QuizData | null> {
  const art = await passArtIndex();
  const pictured = (await quizArtReady()) ? PASS_CATALOG.filter((c) => art.has(c.id)) : [];
  const byGame = new Map<string, PassChar[]>();
  for (const c of pictured) byGame.set(c.game, [...(byGame.get(c.game) ?? []), c]);
  for (const [g, list] of byGame) if (list.length < 3) byGame.delete(g);
  const askable = pictured.filter((c) => byGame.has(c.game));
  const songs = [...(await songList()).byId.values()];
  const hear = songs.length >= 3 && people.length > 0 && people.every((u) => listenOpen(u)) && !listenSettings().paused && !grayUntil(now);
  const memes = T.squad.quiz.memes.length;
  const kinds: QuizKind[] = [...(askable.length ? (["sil", "crop"] as const) : []), ...(hear ? (["intro"] as const) : []), ...(memes ? (["meme"] as const) : [])];
  if (!kinds.length) return null;
  const used = new Set<string>();
  const unused = <X>(list: readonly X[], key: (x: X) => string) => list.filter((x) => !used.has(key(x)));
  const take = <X>(list: readonly X[], key: (x: X) => string) => {
    const left = unused(list, key);
    const x = left[rand(left.length)];
    used.add(key(x));
    return x;
  };
  const others = <X>(list: readonly X[], not: X, name: (x: X) => string) =>
    shuffle(
      list.filter((x) => x !== not && name(x) !== name(not)),
      rand,
    )
      .filter((x, i, all) => all.findIndex((y) => name(y) === name(x)) === i)
      .slice(0, 2);
  const memeNos = Array.from({ length: memes }, (_, k) => k + 1);
  // each question of a kind that still has something not asked yet
  const left = (kind: QuizKind) =>
    kind === "sil" || kind === "crop"
      ? unused(askable, (x) => `c${x.id}`).length
      : kind === "intro"
        ? unused(songs, (x) => `s${x.id}`).length
        : unused(memeNos, (k) => `m${k}`).length;
  const made: Q[] = [];
  for (let i = 0; i < QUIZ_QUESTIONS; i++) {
    const open = kinds.filter((k) => left(k) > 0);
    if (!open.length) break;
    const kind = open[rand(open.length)];
    let ids: string[];
    let right: string;
    if (kind === "sil" || kind === "crop") {
      const c = take(askable, (x) => `c${x.id}`);
      right = String(c.id);
      ids = [right, ...others(byGame.get(c.game)!, c, (x) => x.name).map((x) => String(x.id))];
    } else if (kind === "intro") {
      const song = take(songs, (x) => `s${x.id}`);
      right = song.id;
      ids = [right, ...others(songs, song, (x) => x.name).map((x) => x.id)];
    } else {
      const no = take(memeNos, (k) => `m${k}`);
      right = `${no}:r`;
      ids = [right, `${no}:0`, `${no}:1`];
    }
    shuffle(ids, rand);
    made.push({ kind, ids, answer: ids.indexOf(right), seed: rand(2 ** 31) });
  }
  if (made.length < QUIZ_QUESTIONS) return null;
  return { qs: made };
}

/** When a quiz begun at `begun` is over at the latest (every question waiting QUIZ_LOAD_MAX_MS): the room's mode_until as it starts */
export const quizLatest = (data: QuizData, begun: number) => quizUntil(quizSchedule(data.qs, begun, Number.POSITIVE_INFINITY));
/** When a quiz is over (its results shown), once its last question is decided; else null */
export function quizEnds(data: QuizData, begun: number, now: number): number | null {
  const times = quizSchedule(data.qs, begun, now);
  return times.every((t) => t.decided) ? quizUntil(times) : null;
}

/** A question's three as names, in the language asked in; a 方舟梗 question's own words */
async function wordsOf(q: Q): Promise<{ ask?: string; options: string[] }> {
  if (q.kind === "sil" || q.kind === "crop") return { options: q.ids.map((id) => characterName(passChar(Number(id))?.name ?? "")) };
  if (q.kind === "intro") {
    const { byId } = await songList();
    return { options: q.ids.map((id) => byId.get(id)?.name ?? "") };
  }
  const [no] = q.ids[0].split(":");
  const m = T.squad.quiz.memes[Number(no) - 1];
  return {
    ask: m?.ask ?? "",
    options: q.ids.map((id) => {
      const k = id.split(":")[1];
      return (k === "r" ? m?.right : m?.wrong[Number(k)]) ?? "";
    }),
  };
}

/**
 * The quiz as the room's pages have it (SquadRoom.mode): each question's times (quizSchedule); the one waiting for
 * everyone to have it loaded, how many of those answering who are here (needed, by number) have it; the questions begun
 * with their three, and those decided with their answer
 */
export async function quizView(data: QuizData, begun: number, now: number, needed: readonly number[]): Promise<QuizQuestion[]> {
  const times = quizSchedule(data.qs, begun, now);
  return Promise.all(
    data.qs.map(async (q, n): Promise<QuizQuestion> => {
      const { from, at, ends, decided } = times[n];
      const waiting = !decided && (n === 0 || times[n - 1].decided);
      const base = { n, kind: q.kind, from, at, ends, ...(waiting ? { wait: { ready: needed.filter((h) => q.ready?.includes(h)).length, of: needed.length } } : {}) };
      if (!decided || now < at) return base;
      const done = Boolean(q.first) || now >= ends;
      return { ...base, ...(await wordsOf(q)), ...(done ? { answer: q.answer, ...(q.first ? { first: q.first } : {}) } : {}) };
    }),
  );
}

/** The player's room with its quiz now, when its round began, and their own row: refused when there is none to answer */
async function quizOf(userId: string) {
  const mine = await roomOf(db, userId);
  if (!mine) throw notInRoom();
  const [room] = await db.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id));
  if (!room || room.mode !== "quiz" || !room.modeData || isLobbyData(room.modeData) || !room.modeUntil) throw refuse(409, T.server.squad.noMode);
  const data = room.modeData as QuizData & Partial<MatchRound>;
  return { room, data, begun: data.begun ?? room.modeAt?.getTime() ?? 0, me: mine.me };
}

/**
 * Those of the round answering whose pages are here (暂离's away_at not set), by number: whose loading a question waits
 * for. Within the transaction keeping a page's word, the room's row locked.
 */
async function neededOf(tx: Tx, roomId: string, begun: number): Promise<number[]> {
  const rows = await tx
    .select({ h: squadMembers.handle, tapAt: squadMembers.modeTapAt, away: squadMembers.awayAt })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true)));
  return rows.filter((r) => inRound(r.tapAt?.getTime() ?? null, begun) && !r.away).map((r) => r.h);
}

const questionOf = (data: QuizData, n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < data.qs.length ? data.qs[n as number] : null);

/**
 * A question for a page, from QUIZ_FETCH_MS before it could start (the one before it decided): its three (and a 方舟梗
 * question's words), and its picture (made here, whose not told) or, to one 听歌 is open to, its song's link (its
 * smaller copy's too); its times as they are now (quizSchedule)
 */
export async function askQuestion(user: Pick<UserRow, "id" | "email">, body: Record<string, unknown>, now = Date.now()): Promise<QuizAsk> {
  const { data, begun } = await quizOf(user.id);
  const q = questionOf(data, body.n);
  if (!q) throw refuse(400, T.server.squad.badQuestion);
  const n = body.n as number;
  const times = quizSchedule(data.qs, begun, now);
  if ((n > 0 && !times[n - 1].decided) || now < times[n].from - QUIZ_FETCH_MS) throw refuse(409, T.server.squad.notYet);
  const words = await wordsOf(q);
  const out: QuizAsk = { n, kind: q.kind, at: times[n].at, ends: times[n].ends, ...words, now };
  if (q.kind === "sil" || q.kind === "crop") {
    const file = (await passArtIndex()).get(Number(q.ids[q.answer]))?.file;
    const pic = file ? (q.kind === "sil" ? await silhouetteOf(file) : await cropOf(file, q.seed)) : null;
    if (pic) out.pic = pic;
  }
  if (q.kind === "intro" && listenOpen(user) && !listenSettings().paused && !grayUntil(now)) {
    const song = (await songList()).byId.get(q.ids[q.answer]);
    if (song) Object.assign(out, { url: musicLink(song.file, now), ...(song.lite ? { lite: musicLink(song.lite, now) } : {}) });
  }
  return out;
}

/**
 * An answer (pick: 0–2) to question n, at `at` (the server's clock as the page has it: taken within QUIZ_EARLY_MS
 * of now, else now): once a question each player of the round (one who asked for the next one does not answer this
 * one); in its time; the first right gets the point, the room told.
 */
export async function answerQuiz(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<QuizAnswered> {
  const { room, data, begun, me } = await quizOf(user.id);
  const q = questionOf(data, body.n);
  if (!q || !Number.isInteger(body.pick) || (body.pick as number) < 0 || (body.pick as number) > 2) throw refuse(400, T.server.squad.badQuestion);
  if (!me.modeIn) throw refuse(409, T.server.squad.notAnswering);
  if (!inRound(me.modeTapAt?.getTime() ?? null, begun)) throw refuse(409, T.server.squad.notThisRound);
  const n = body.n as number;
  const asked = typeof body.at === "number" && Number.isFinite(body.at) ? body.at : now;
  const t = asked >= now - QUIZ_EARLY_MS && asked <= now + 50 ? asked : now;
  const timed = quizSchedule(data.qs, begun, now)[n];
  if (!timed.decided || t < timed.at) throw refuse(409, T.server.squad.notYet);
  if (t > timed.ends) throw refuse(409, T.server.squad.answerLate);
  const right = body.pick === q.answer;
  const mine = and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true));
  // once a question each: who answered kept on the question, the room's row locked
  const first = await db.transaction(async (tx: Tx) => {
    const [locked] = await tx.select().from(squadRooms).where(eq(squadRooms.id, room.id)).for("update");
    const fresh = locked?.mode === "quiz" && !isLobbyData(locked.modeData) ? (locked.modeData as QuizData | null) : null;
    const fq = fresh?.qs[n];
    if (!fresh || !fq) throw refuse(409, T.server.squad.noMode);
    if (fq.did?.includes(me.handle)) throw refuse(409, T.server.squad.answered);
    fq.did = [...(fq.did ?? []), me.handle];
    const won = right && !fq.first;
    if (won) fq.first = { h: me.handle, ms: Math.max(0, Math.round(t - timed.at)) };
    await tx.update(squadRooms).set({ modeData: fresh }).where(eq(squadRooms.id, room.id));
    if (won) {
      const [row] = await tx.select({ combo: squadMembers.modeCombo }).from(squadMembers).where(mine);
      await tx
        .update(squadMembers)
        .set({ modeCombo: (row?.combo ?? 0) + 1 })
        .where(mine);
    }
    return won;
  });
  if (first) await tellSquadPlay(room.id, { kind: "quiz", h: me.handle });
  return { right, first, answer: q.answer, now };
}

/**
 * A page has question n loaded (its three, and its picture or song ready to show or play): kept on the question, once
 * each, while it waits (the ones before it decided). Everyone answering whose page is here having it (neededOf), it is
 * decided: it starts then, or at its from when that is later (readyAt); once QUIZ_LOAD_MAX_MS has gone by, it has
 * started by itself and this changes nothing. The room told, for how many have it.
 */
export async function quizLoaded(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const { room, begun, me } = await quizOf(user.id);
  if (!me.modeIn || !inRound(me.modeTapAt?.getTime() ?? null, begun)) throw refuse(409, T.server.squad.notAnswering);
  const told = await db.transaction(async (tx: Tx) => {
    const [locked] = await tx.select().from(squadRooms).where(eq(squadRooms.id, room.id)).for("update");
    const fresh = locked?.mode === "quiz" && locked.modeData && !isLobbyData(locked.modeData) ? (locked.modeData as QuizData & Partial<MatchRound>) : null;
    const q = fresh ? questionOf(fresh, body.n) : null;
    if (!fresh || !q) throw refuse(fresh ? 400 : 409, fresh ? T.server.squad.badQuestion : T.server.squad.noMode);
    const n = body.n as number;
    const times = quizSchedule(fresh.qs, begun, now);
    if (n > 0 && !times[n - 1].decided) throw refuse(409, T.server.squad.notYet);
    if (times[n].decided || q.ready?.includes(me.handle)) return false;
    q.ready = [...(q.ready ?? []), me.handle];
    const needed = await neededOf(tx, room.id, begun);
    if (needed.every((h) => q.ready!.includes(h)) && now < times[n].from + QUIZ_LOAD_MAX_MS) q.readyAt = now;
    await tx.update(squadRooms).set({ modeData: fresh }).where(eq(squadRooms.id, room.id));
    return true;
  });
  if (told) await tellSquadPlay(room.id, { kind: "quiz" });
  return { now };
}

/**
 * A quiz's round over (its end at `at`; begun as its initiator started it): with two or more in it, 漏勺 on the lowest
 * (all of those tied there, unless everyone is) for QUIZ_LADLE_MS from its end; those who asked for the next round
 * are not in this one. Within the transaction ending it, before the combos go back to 0.
 */
export async function endQuiz(tx: Tx, roomId: string, at: number, begun: number) {
  const rows = await tx
    .select({ h: squadMembers.handle, combo: squadMembers.modeCombo })
    .from(squadMembers)
    .where(
      and(
        eq(squadMembers.roomId, roomId),
        isNull(squadMembers.leftAt),
        eq(squadMembers.modeIn, true),
        or(isNull(squadMembers.modeTapAt), lte(squadMembers.modeTapAt, new Date(begun))),
      ),
    );
  const last = quizLast(rows);
  if (!last.length) return;
  await tx
    .update(squadMembers)
    .set({ head: LADLE, headUntil: new Date(at + QUIZ_LADLE_MS) })
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt), inArray(squadMembers.handle, last)));
}
