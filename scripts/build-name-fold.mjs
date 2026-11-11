#!/usr/bin/env node
// Write src/data/name-fold.json: the tables src/lib/nameFold.ts cleans names with before they are
// compared with the blocked words (src/lib/nameCheck.ts), so a word written in traditional or variant
// characters, or in look-alike letters, reads the same as the simplified one, and the sound of each
// character for the words blocked by sound too. Only characters, never a word. Run from the
// repository root when a source has news; the sources are pinned to the commits below:
//
//   node scripts/build-name-fold.mjs
//
// - OpenCC (Apache-2.0, https://github.com/BYVoid/OpenCC): traditional to simplified
//   (TSCharacters), and the Taiwan, Hong Kong and Japanese variants of a character (TWVariants,
//   HKVariants, JPShinjitaiCharacters), read backwards.
// - Unicode (https://www.unicode.org/terms_of_use.html): radicals to the characters they stand for
//   (EquivalentUnifiedIdeograph), and letters of other scripts that look like a Latin letter
//   (confusables, Cyrillic, Greek and the like only).
// - pinyin-data (MIT, https://github.com/mozillazg/pinyin-data): the readings of each character,
//   those of 通用规范汉字字典 (kTGHZ2013) where it has the character.
import { writeFileSync } from "node:fs";

const OUT = "src/data/name-fold.json";
const OPENCC = "https://raw.githubusercontent.com/BYVoid/OpenCC/fae2a0a911c30764e669a7d8b0591cd8e852934a/data/dictionary";
const PINYIN = "https://raw.githubusercontent.com/mozillazg/pinyin-data/fe29ad32bdf352b31a02b9936e537f575432e9a6";
const UNICODE = "https://raw.githubusercontent.com/unicode-org/unicodetools/61ec77ece26fc882fe0d970ccb530e8c32fb6b61/unicodetools/data";

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const lines = (text) => text.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const cp = (hex) => String.fromCodePoint(parseInt(hex, 16));

/** An OpenCC table: each key with its values, the first being the usual one */
const opencc = async (name) =>
  lines(await get(`${OPENCC}/${name}.txt`)).map((l) => {
    const [key, values] = l.split("\t");
    return [key, values.trim().split(" ")];
  });

/** pinyin-data: each character's readings, without tones; ü as v (as pinyin is typed) */
const toneless = (r) =>
  r
    .normalize("NFD")
    .replace(/ü/g, "v")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
async function readings(name) {
  const out = new Map();
  for (const l of lines(await get(`${PINYIN}/${name}`))) {
    const m = /^U\+([0-9A-F]+):\s*([^#]+)/.exec(l);
    if (!m) continue;
    out.set(cp(m[1]), [...new Set(m[2].trim().split(",").map(toneless))].filter((r) => /^[a-z]+$/.test(r)));
  }
  return out;
}

const [ts, tw, hk, jp, radicalsText, confusablesText, standard, all] = await Promise.all([
  opencc("TSCharacters"),
  opencc("TWVariants"),
  opencc("HKVariants"),
  opencc("JPShinjitaiCharacters"),
  get(`${UNICODE}/ucd/dev/EquivalentUnifiedIdeograph.txt`),
  get(`${UNICODE}/security/dev/confusables.txt`),
  readings("kTGHZ2013.txt"),
  readings("pinyin.txt"),
]);

// ---- characters: variant or traditional to simplified -------------------------------------------

const toSimplified = new Map(ts.map(([t, [s]]) => [t, s]));
/** Characters of 通用规范汉字表: already the mainland's own, so a variant table never turns one into another */
const own = new Set(standard.keys());
const variantOf = new Map();
const addVariant = (local, std) => {
  if (local !== std && !own.has(local) && !variantOf.has(local)) variantOf.set(local, std);
};
// The Taiwan and Hong Kong tables map the standard traditional character to the local one(s): read backwards
for (const table of [tw, hk]) {
  for (const [std, locals] of table) for (const local of locals) addVariant(local, std);
}
// The Japanese one maps the shinjitai (沢) to the traditional character (澤)
for (const [local, [std]] of jp) addVariant(local, std);
// A few variants none of the tables has, seen used to write a character in a way that slips past
for (const [variant, std] of [
  ["囯", "国"],
  ["囶", "国"],
  ["圀", "国"],
  ["囻", "国"],
  ["産", "产"],
  ["闘", "斗"],
  ["鬪", "斗"],
  ["鬭", "斗"],
]) {
  if (!variantOf.has(variant)) variantOf.set(variant, std);
}
const radical = new Map();
for (const l of lines(radicalsText)) {
  const m = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([0-9A-F]+)/.exec(l);
  if (!m) continue;
  for (let c = parseInt(m[1], 16); c <= parseInt(m[2] ?? m[1], 16); c++) radical.set(String.fromCodePoint(c), cp(m[3]));
}

/** One step: a radical to its character, a local variant to the standard one, traditional to simplified */
function step(c) {
  const character = radical.get(c) ?? c;
  const std = variantOf.get(character) ?? character;
  return toSimplified.get(std) ?? std;
}
/** The simplified character a character stands for, after as many steps as it takes */
function simplified(c) {
  let s = c;
  for (let i = 0; i < 4; i++) {
    const next = step(s);
    if (next === s) break;
    s = next;
  }
  return s;
}
const fold = new Map();
for (const c of new Set([...toSimplified.keys(), ...variantOf.keys(), ...radical.keys()])) {
  const s = simplified(c);
  if (s !== c) fold.set(c, s);
}

// ---- letters of other scripts that look like a Latin letter ---------------------------------------

/** Scripts whose letters are written to look like Latin ones: Latin's own extras and IPA, Greek, Cyrillic, Armenian, Cherokee */
const LOOKALIKE = [
  [0x00c0, 0x024f],
  [0x0250, 0x02af],
  [0x0370, 0x03ff],
  [0x0400, 0x052f],
  [0x0530, 0x058f],
  [0x13a0, 0x13ff],
  [0x1c80, 0x1c8f],
  [0x1d00, 0x1dbf],
  [0x1e00, 0x1fff],
  [0x2c60, 0x2c7f],
  [0x2de0, 0x2dff],
  [0xa640, 0xa69f],
  [0xa720, 0xa7ff],
  [0xab30, 0xabbf],
];
const lookalike = (c) => LOOKALIKE.some(([a, b]) => c >= a && c <= b);
/**
 * Before the name goes to lower case, since the look is the case's: Greek capital Ν looks like N, its small
 * ν like v. Only letters NFKC leaves as they are and without an accent (it comes off first), to a Latin
 * letter or digit, in lower case. confusables.txt draws capital I and small l alike and calls both l, so a
 * capital letter it calls l (Greek Ι, Cyrillic І) is taken as the I it stands for in capitals.
 */
const latin = new Map();
for (const l of lines(confusablesText)) {
  const [from, to] = l.split(";").map((p) => p.trim());
  if (!from || !to || from.includes(" ") || to.includes(" ")) continue;
  const f = cp(from);
  const t = cp(to);
  if (!lookalike(f.codePointAt(0)) || !/^[a-z0-9]$/i.test(t)) continue;
  if (f.normalize("NFKC") !== f || f.normalize("NFD") !== f || latin.has(f)) continue;
  const capital = f !== f.toLowerCase();
  latin.set(f, t === "l" && capital ? "i" : t.toLowerCase());
}

// ---- readings ------------------------------------------------------------------------------------

/** Every character of the common blocks, with 通用规范汉字字典's readings where it has them */
const bySound = new Map();
const common = (c) => {
  const n = c.codePointAt(0);
  return (n >= 0x3400 && n <= 0x4dbf) || (n >= 0x4e00 && n <= 0x9fff);
};
for (const [c, rs] of all) {
  if (!common(c)) continue;
  for (const r of standard.get(c) ?? rs) {
    if (!bySound.has(r)) bySound.set(r, []);
    bySound.get(r).push(c);
  }
}
for (const [c, rs] of standard) {
  if (all.has(c) && common(c)) continue;
  for (const r of rs) {
    if (!bySound.has(r)) bySound.set(r, []);
    bySound.get(r).push(c);
  }
}

const pairs = (m) => [...m].map(([a, b]) => a + b).join("");
const sounds = Object.fromEntries([...bySound].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, cs]) => [r, [...new Set(cs)].join("")]));
writeFileSync(
  OUT,
  `${JSON.stringify({
    sources: { opencc: OPENCC, pinyin: PINYIN, unicode: UNICODE },
    fold: pairs(fold),
    latin: pairs(latin),
    sounds,
  })}\n`,
);
console.log(`${OUT}: ${fold.size} characters to simplified, ${latin.size} look-alike letters, ${Object.keys(sounds).length} sounds`);
