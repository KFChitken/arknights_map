#!/usr/bin/env node
// Write src/data/pass-catalog.json: every character a pass can be drawn for, from the two lists players pick their
// 厨力 from (src/data/arknights-operators.json, src/data/endfield-operators.json), characters of the story and
// collaborations included. Run from the repository root after a list changes:
//
//   node scripts/build-pass-catalog.mjs                          add the characters new to the lists
//   node scripts/build-pass-catalog.mjs --rename <game> <old> <new>
//       a character the lists now call by another name keeps their id, and so their passes and numbers
//   node scripts/build-pass-catalog.mjs --colors <file.json>
//       colours by name ({ "<game>:<name>": "#rrggbb" }, game ak or ef), as the art script picks them from each
//       character's picture (operator-art/pass/colors.json); a character without one keeps theirs
//   node scripts/build-pass-catalog.mjs --english <file.json>
//       English names by Chinese name ({ "<name>": "<English>" }), when the English words (src/i18n/en.ts) do not
//       have them yet; once they do, every run takes them from there
//
// An id is given once and never changes, nor is it given to anyone else: passes are stored by it. New characters
// come after the rest, and nobody is ever taken out, so a pass already drawn always has its character. Until the art
// script gives one, a character's colour is worked out from their name. The English name is printed on the pass
// (null: none known, the pass prints the Chinese one alone); a character without one in the table keeps theirs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OUT = "src/data/pass-catalog.json";
const LISTS = { ak: "src/data/arknights-operators.json", ef: "src/data/endfield-operators.json" };
const NOTE = "Every character a pass can be drawn for, by id (scripts/build-pass-catalog.mjs): ids are only ever added, never changed or given again";

const args = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const catalog = existsSync(OUT) ? read(OUT).characters : [];
const key = (c) => `${c.game}:${c.name}`;

const rename = args.indexOf("--rename");
if (rename >= 0) {
  const [game, from, to] = args.slice(rename + 1, rename + 4);
  const c = catalog.find((x) => x.game === game && x.name === from);
  if (!c || !to) throw new Error(`no ${game} character called ${from} to rename`);
  if (catalog.some((x) => x.game === game && x.name === to)) throw new Error(`${game}:${to} is in the catalogue already`);
  c.name = to;
}

let added = 0;
for (const [game, file] of Object.entries(LISTS)) {
  for (const o of read(file).operators) {
    const known = catalog.find((c) => c.game === game && c.name === o.name);
    if (known) {
      known.rarity = o.rarity ?? null;
      continue;
    }
    catalog.push({ id: catalog.reduce((m, c) => Math.max(m, c.id), 0) + 1, game, name: o.name, rarity: o.rarity ?? null, color: nameColor(o.name), en: null });
    added++;
  }
}

// the English names: the file given, else the English words' table of characters (en.names.characters)
const english = args.indexOf("--english");
const { en } = await import(pathToFileURL(path.resolve("src/i18n/en.ts")).href);
const named = english >= 0 ? read(args[english + 1]) : (en.names?.characters ?? {});
for (const c of catalog) {
  const n = named[c.name];
  if (typeof n === "string" && n.trim()) c.en = n.trim();
  c.en ??= null;
}

const colors = args.indexOf("--colors");
if (colors >= 0) {
  const picked = read(args[colors + 1]);
  for (const c of catalog) if (/^#[0-9a-f]{6}$/i.test(picked[key(c)] ?? "")) c.color = picked[key(c)].toLowerCase();
}

const names = new Set(catalog.map(key));
if (names.size !== catalog.length) throw new Error("two characters of one game share a name");
const lines = catalog.map((c) => "    " + JSON.stringify({ id: c.id, game: c.game, name: c.name, en: c.en, rarity: c.rarity, color: c.color }));
writeFileSync(OUT, `{\n  "note": ${JSON.stringify(NOTE)},\n  "characters": [\n${lines.join(",\n")}\n  ]\n}\n`);
console.log(`${catalog.length} characters, ${added} new`);

/** A colour of the character's own until their picture gives one: a deep hue from their name, white text reads on it */
function nameColor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return hslHex((h % 360 + 24) % 360, 0.46, 0.37);
}

function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
