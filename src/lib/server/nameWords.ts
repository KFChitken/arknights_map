import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { bare, nameChecker, parseNameWords } from "../nameRules";
import { WorldError } from "../world/types";
import { db } from "./db";
import { nameWords, users } from "./schema";

/**
 * The name blocklist kept on the admin page. The app runs as one process, so the
 * checker held in memory is simply dropped whenever the admin changes the list.
 */

let held: Promise<(name: string) => boolean> | null = null;

/** Read the list again on next use: after every change, and when tests empty the table. */
export function forgetNameWords() {
  held = null;
}

function checker() {
  held ??= db
    .select({ word: nameWords.word, whole: nameWords.whole })
    .from(nameWords)
    .then(nameChecker);
  held.catch(() => (held = null));
  return held;
}

/** Refuse a name the rules or the words block, without saying which word, so nobody can feel their way round it. */
export async function checkName(name: string) {
  if (name.trim() && !(await checker())(name)) throw new WorldError("这个名字用不了，换一个吧。");
}

/** The admin page's view of the list: how many words, and those matching a search (newest first), at most SHOWN. */
const SHOWN = 300;
export async function listNameWords(search: string) {
  const q = bare(String(search));
  const where = q ? like(nameWords.word, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined;
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

/** Players' names that the list blocks now, worked out when the admin page asks; nothing is changed by itself. */
export async function namesHit() {
  const allowed = await checker();
  const named = await db
    .select({ id: users.id, name: users.name, anonymous: users.anonymous })
    .from(users)
    .where(and(ne(users.name, ""), isNull(users.demoKey)));
  return named.filter((u) => !allowed(u.name));
}
