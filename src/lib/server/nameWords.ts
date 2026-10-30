import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { nameAllowed, parseNameWords, type NameWord } from "../nameRules";
import { WorldError } from "../world/types";
import { db } from "./db";
import { nameWords, users } from "./schema";

/**
 * The name blocklist kept on the admin page. The app runs as one process, so the
 * copy held in memory is simply dropped whenever the admin changes the list.
 */

let held: NameWord[] | null = null;

/** Read the list again on next use: after every change, and when tests empty the table. */
export function forgetNameWords() {
  held = null;
}

export async function blockedWords(): Promise<NameWord[]> {
  held ??= await db
    .select({ word: nameWords.word, whole: nameWords.whole })
    .from(nameWords)
    .orderBy(asc(nameWords.createdAt), asc(nameWords.word));
  return held;
}

/** Refuse a name the rules or the words block, without saying which word, so nobody can feel their way round it. */
export async function checkName(name: string) {
  if (name.trim() && !nameAllowed(name, await blockedWords())) throw new WorldError("这个名字用不了，换一个吧。");
}

/** 批量添加: returns how many words the box held; a word already listed takes the new 「=」 or not. */
export async function addNameWords(text: string) {
  const words = parseNameWords(String(text));
  if (!words.length) return 0;
  await db
    .insert(nameWords)
    .values(words)
    .onConflictDoUpdate({ target: nameWords.word, set: { whole: sql`excluded.whole` } });
  forgetNameWords();
  return words.length;
}

export async function removeNameWord(word: string) {
  await db.delete(nameWords).where(eq(nameWords.word, String(word)));
  forgetNameWords();
}

/** Players' names that the list blocks now, worked out when the admin page asks; nothing is changed by itself. */
export async function namesHit() {
  const words = await blockedWords();
  const named = await db
    .select({ id: users.id, name: users.name, anonymous: users.anonymous })
    .from(users)
    .where(and(ne(users.name, ""), isNull(users.demoKey)));
  return named.filter((u) => !nameAllowed(u.name, words));
}
