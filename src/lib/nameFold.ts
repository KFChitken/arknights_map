import "server-only";
import data from "@/data/name-fold.json";

/**
 * Names are folded before they are compared with the blocked words (src/lib/nameCheck.ts), and so are
 * the words, so that writing a word another way does not get it past: 「臺獨」, 「臺 獨」 and 「臺‍獨」
 * (a zero-width joiner between) read 「台独」, 「Zhāng Sānfēng」 and 「zhаngsanfeng」 (with a Cyrillic а)
 * read 「zhangsanfeng」. The tables are built by scripts/build-name-fold.mjs. Only the server should
 * import this: they are big.
 */

function pairs(s: string) {
  const chars = Array.from(s);
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < chars.length; i += 2) map.set(chars[i], chars[i + 1]);
  return map;
}

/** Radicals, local variants and traditional characters, each to the simplified character it stands for */
const SIMPLIFIED = pairs(data.fold);
/** Letters of other scripts drawn like a Latin letter or digit: Cyrillic а, Greek ο */
const LOOKALIKE = pairs(data.latin);

const HAN = /\p{Script=Han}/u;
const KEPT = /[\p{L}\p{N}]/u;
const SPACE = /[\s​-‏⁠﻿]/u;

export const isHan = (c: string) => HAN.test(c);

/**
 * Each character as the plain one: compatibility forms (full width, circled, 𝐛𝐨𝐥𝐝) as NFKC makes them,
 * accents off, look-alike letters as Latin ones (before lower case, which changes their look), lower
 * case, then radicals and traditional or variant characters to the simplified ones. keep: which
 * characters stay.
 */
function plain(text: string, keep: (c: string) => boolean) {
  let out = "";
  const s = text.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  for (const c of s) {
    const lower = (LOOKALIKE.get(c) ?? c).toLowerCase();
    const p = SIMPLIFIED.get(lower) ?? lower;
    if (keep(p)) out += p;
  }
  return out;
}

/** Only letters (of any script) and digits, folded: what names and words are compared as. */
export const fold = (text: string) => plain(text, (c) => KEPT.test(c));

/** Folded but with the symbols kept (only spaces and zero-width characters go), for telling a link: 「аbc．соm」 reads 「abc.com」 */
export const foldLoose = (text: string) => plain(text, (c) => !SPACE.test(c));

/** Only the Chinese characters of a folded name, for a word broken up by other letters or digits: 「台a独」 */
export const hanOnly = (folded: string) => Array.from(folded).filter(isHan).join("");

// ---- sound -----------------------------------------------------------------------------------------

/**
 * A syllable as it is compared: without tones, and ü (typed v) as u. Nothing looser: with zh as z or
 * -ng as -n, a three-character name would sound like hundreds of everyday ones; the near misses people
 * use to get round a word go on the list as words of their own.
 */
export const syllable = (pinyin: string) => pinyin.replace(/v/g, "u");

let sounds: Map<string, Set<string>> | null = null;

const EMPTY: ReadonlySet<string> = new Set();

/** The syllables a (folded) character can be read as, as syllable() compares them; none for anything but a Chinese character */
export function soundsOf(c: string): ReadonlySet<string> {
  if (!sounds) {
    sounds = new Map();
    for (const [reading, chars] of Object.entries(data.sounds as Record<string, string>)) {
      for (const ch of chars) {
        let set = sounds.get(ch);
        if (!set) sounds.set(ch, (set = new Set()));
        set.add(syllable(reading));
      }
    }
  }
  return sounds.get(c) ?? EMPTY;
}

/** A word blocked by its sound: each of its characters as the syllables it can be read as */
export type SoundKey = { word: string; syllables: ReadonlySet<string>[] };

/**
 * Fewer syllables than this sound like too many everyday names and words (台独 like 太度), so a
 * shorter word is only blocked as it is written
 */
export const SOUND_MIN = 3;

/** The sound of a word, from its Chinese characters; null when it has anything else, a character without a reading, or is too short */
export function soundKey(word: string, shown = word): SoundKey | null {
  const chars = Array.from(fold(word));
  if (chars.length < SOUND_MIN || !chars.every(isHan)) return null;
  const syllables = chars.map(soundsOf);
  return syllables.every((s) => s.size) ? { word: shown, syllables } : null;
}

/** Longest syllable there is (zhuang, chuang, shuang) */
const LONGEST = 6;

/**
 * Which of the words a folded name sounds like, if any. Each syllable of the word is matched by a Chinese
 * character read that way, or by the syllable typed in pinyin, so 「章三峰」, 「zhang三丰」 and
 * 「zhangsanfeng」 all sound like 「张三丰」; anything that is neither (a digit, a kana) breaks the sound.
 */
export function soundMatcher(keys: SoundKey[]) {
  // by the syllables the word can start with, so only a few are tried at each character
  const byStart = new Map<string, SoundKey[]>();
  for (const k of keys) {
    for (const s of k.syllables[0]) {
      const list = byStart.get(s);
      if (list) list.push(k);
      else byStart.set(s, [k]);
    }
  }

  /** The syllables the name can be read as from character at, each with where the next one begins */
  function readAt(chars: string[], at: number): [string, number][] {
    const c = chars[at];
    if (isHan(c)) return [...soundsOf(c)].map((s) => [s, at + 1]);
    if (!/[a-z]/.test(c)) return [];
    const out: [string, number][] = [];
    let typed = "";
    for (let end = at; end < chars.length && end < at + LONGEST && /[a-z]/.test(chars[end]); end++) {
      typed += chars[end];
      out.push([syllable(typed), end + 1]);
    }
    return out;
  }

  function soundsFrom(chars: string[], at: number, key: SoundKey, i: number): boolean {
    if (i === key.syllables.length) return true;
    if (at >= chars.length) return false;
    return readAt(chars, at).some(([s, next]) => key.syllables[i].has(s) && soundsFrom(chars, next, key, i + 1));
  }

  return (folded: string): string | null => {
    if (!keys.length) return null;
    const chars = Array.from(folded);
    for (let at = 0; at < chars.length; at++) {
      for (const [s] of readAt(chars, at)) {
        for (const key of byStart.get(s) ?? []) if (soundsFrom(chars, at, key, 0)) return key.word;
      }
    }
    return null;
  };
}
