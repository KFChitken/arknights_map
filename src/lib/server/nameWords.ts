import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { nameJudge } from "../nameCheck";
import { fold } from "../nameFold";
import { bare, parseNameWords } from "../nameRules";
import { WorldError } from "../world/types";
import { db } from "./db";
import { nameWords, users } from "./schema";

/**
 * The name blocklist kept on the admin page. The live site runs the app as several processes and
 * only the one that took the admin's change hears of it, so each also looks again once what it holds
 * is FRESH_MS old: a word added or taken off counts everywhere within a minute. Looking is one small
 * query; the list is only read and built again when it changed.
 */
const FRESH_MS = 60_000;

type Judge = (name: string) => string | null;
let held: { at: number; version: string; judge: Judge } | null = null;
let looking: Promise<Judge> | null = null;
/** Counts forgetNameWords calls, so a look that started before one does not put back what it forgot */
let generation = 0;

/** Read the list again on next use: after every change, and when tests empty the table. */
export function forgetNameWords() {
  held = null;
  looking = null;
  generation++;
}

/** Changes whenever a word is added, taken off or changes its 「=」 */
const VERSION = sql<string>`count(*)::text || ':' || coalesce(sum(hashtext(${nameWords.word} || ${nameWords.whole}::text)), 0)::text`;

/** What stops a name now (src/lib/nameCheck.ts nameJudge), as the list stands within FRESH_MS */
export function nameJudgeNow(): Promise<Judge> {
  if (held && Date.now() - held.at < FRESH_MS) return Promise.resolve(held.judge);
  if (looking) return looking;
  const started = generation;
  const look = (async () => {
    const [{ version }] = await db.select({ version: VERSION }).from(nameWords);
    let judge = held?.version === version ? held.judge : null;
    if (!judge) judge = nameJudge(await db.select({ word: nameWords.word, whole: nameWords.whole }).from(nameWords));
    if (generation === started) held = { at: Date.now(), version, judge };
    return judge;
  })();
  looking = look;
  const done = () => {
    if (looking === look) looking = null;
  };
  look.then(done, done);
  return look;
}

/** Refuse a name the rules or the words block, without saying which word, so nobody can feel their way round it. */
export async function checkName(name: string) {
  if (name.trim() && (await nameJudgeNow())(name)) throw new WorldError("这个名字用不了，换一个吧。");
}

/** The admin page's view of the list: how many words, and those matching a search (newest first), at most SHOWN. */
const SHOWN = 300;
export async function listNameWords(search: string) {
  // as typed, and folded: 「獨」 finds 「台独」 too
  const qs = [...new Set([bare(String(search)), fold(String(search))])].filter(Boolean);
  const where = qs.length ? or(...qs.map((q) => like(nameWords.word, `%${q.replace(/[%_\\]/g, "\\$&")}%`))) : undefined;
  const [{ total }] = await db.select({ total: count() }).from(nameWords);
  const [{ found }] = await db.select({ found: count() }).from(nameWords).where(where);
  const words = await db
    .select({ word: nameWords.word, whole: nameWords.whole })
    .from(nameWords)
    .where(where)
    .orderBy(desc(nameWords.createdAt), asc(nameWords.word))
    .limit(SHOWN);
  return { total, found, words };
}

// Rows per statement, well under the database's limit on parameters
const CHUNK = 2000;

/** 批量添加: returns how many words the box held; a word already listed takes the new 「=」 or not. */
export async function addNameWords(text: string) {
  const words = parseNameWords(String(text));
  for (let i = 0; i < words.length; i += CHUNK) {
    await db
      .insert(nameWords)
      .values(words.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target: nameWords.word, set: { whole: sql`excluded.whole` } });
  }
  forgetNameWords();
  return words.length;
}

/** 批量删除, cleaned the same way as 批量添加; returns how many were on the list. */
export async function removeNameWords(text: string) {
  const words = parseNameWords(String(text)).map((w) => w.word);
  let gone = 0;
  for (let i = 0; i < words.length; i += CHUNK) {
    const rows = await db
      .delete(nameWords)
      .where(inArray(nameWords.word, words.slice(i, i + CHUNK)))
      .returning({ word: nameWords.word });
    gone += rows.length;
  }
  forgetNameWords();
  return gone;
}

export async function removeNameWord(word: string) {
  await db.delete(nameWords).where(eq(nameWords.word, String(word)));
  forgetNameWords();
}

/**
 * A player's name the list blocks now, with what blocks it (the word as the list shows it, or the rule).
 * held: hidden while a report about it waits, so it is settled with that case, not cleared from here.
 */
export type NameHit = { id: string; name: string; anonymous: boolean; held: boolean; word: string };

/** At most this many hits go to the admin page, the names others can see first */
const HITS_SHOWN = 500;
/** Names read at a time, with a pause between for the other requests */
const SCAN_CHUNK = 5000;

/**
 * Players' names that the list blocks now, worked out when the admin page asks; nothing is changed by
 * itself. Every named account is read, a part at a time, so a site of a hundred thousand players keeps
 * answering meanwhile. checked: how many names were looked at; count: how many are blocked.
 */
export async function namesHit(): Promise<{ checked: number; count: number; hits: NameHit[] }> {
  const judge = await nameJudgeNow();
  const shown: NameHit[] = [];
  const anonymous: NameHit[] = [];
  let checked = 0;
  let found = 0;
  let after: string | null = null;
  for (;;) {
    const rows: Omit<NameHit, "word">[] = await db
      .select({ id: users.id, name: users.name, anonymous: users.anonymous, held: sql<boolean>`${users.profileHeldAt} is not null` })
      .from(users)
      .where(and(ne(users.name, ""), isNull(users.demoKey), after ? gt(users.id, after) : undefined))
      .orderBy(asc(users.id))
      .limit(SCAN_CHUNK);
    for (const u of rows) {
      checked++;
      const word = judge(u.name);
      if (!word) continue;
      found++;
      const list = u.anonymous ? anonymous : shown;
      if (list.length < HITS_SHOWN) list.push({ ...u, word });
    }
    if (rows.length < SCAN_CHUNK) break;
    after = rows[rows.length - 1].id;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { checked, count: found, hits: [...shown, ...anonymous].slice(0, HITS_SHOWN) };
}

/** 试一个名字: what would stop it (as namesHit says it), or null when it may be used */
export async function testName(name: unknown) {
  const judge = await nameJudgeNow();
  return { word: judge(String(name ?? "").slice(0, 100)) };
}
