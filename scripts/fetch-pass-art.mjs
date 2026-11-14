#!/usr/bin/env node
// Download the picture (立绘) of every character a pass can be drawn for (src/data/pass-catalog.json) into
// operator-art/pass/, beside the small round ones (scripts/fetch-operator-art.mjs), so they travel to the servers and
// are served the same way (scripts/deploy.sh, deploy/Caddyfile). Run on the Mac from the repository root:
//
//   node scripts/fetch-pass-art.mjs              only the characters still missing
//   node scripts/fetch-pass-art.mjs --refresh    all of them again
//   node scripts/fetch-pass-art.mjs --add <game> <name> <picture>
//       one picture by hand (best a PNG with a transparent background), for a character the wikis have none of, or
//       whose picture should be another: 普瑞赛斯's is the story picture her small one was cut from. game: ak or ef
//
// Each picture is cut to the character (its transparent border taken off) and saved as <hash>.avif and <hash>.webp
// 480 wide (the whole pass), <hash>.s.webp 240 wide (the small ones) and <hash>.b.webp 20 wide (a blur shown while the
// picture comes), <hash> from the picture itself, so a changed picture gets new names and browsers keep each file for
// good. The colour of the character's pass is picked from the picture too: index.json has both, by catalogue id;
// colors.json the colours alone, for
//   node scripts/build-pass-catalog.mjs --colors operator-art/pass/colors.json
// which keeps them in the catalogue for when the pictures are switched off (PASS_ART=off).
//
// A picture already here stays whenever the wiki gives none for that character (the wiki no longer has it, or fails
// to send it just then), and one added by hand stays even through --refresh: only another --add replaces it. Files no
// longer named in index.json are deleted at the end. Arknights pictures come from PRTS (「立绘_<name>_1.png」),
// Endfield ones from endfield.wiki.gg (the picture in each character's infobox), both asked for 960 wide. They belong
// to Hypergryph, so they stay out of the repository (.gitignore) and out of the app image (.dockerignore).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("operator-art", "pass");
const INDEX = path.join(OUT, "index.json");
const AGENT = "zhoupmap-pass-art/1.0 (https://zhoupmap.com)";
/** Asked of the wikis: wide enough for the 480 one once cut to the character */
const ASK_WIDTH = 960;
/** Narrower than this is a small picture, not a 立绘 */
const MIN_HEIGHT = 600;
/** The pipeline's version: changing how the files are made changes every hash, so no browser keeps an old one */
const MAKE = "1";
const FILE = /^[0-9a-f]{16}(?:\.s|\.b)?\.(?:avif|webp)$/;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const catalog = JSON.parse(readFileSync("src/data/pass-catalog.json", "utf8")).characters;
const old = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")).art ?? {} : {};
/** catalogue id → { file, color, from } (from: where it came from, "hand" for --add) */
const art = {};

/** fetch, tried again a couple of times when the network drops it */
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": AGENT } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function getJson(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ format: "json", ...params })) u.searchParams.set(k, v);
  return (await get(u)).json();
}

/**
 * For file titles on a MediaWiki: the address of each one tall enough to be a 立绘, scaled by the wiki to ASK_WIDTH
 * when it is wider, followed through the wiki's title normalisation; the rest are left out.
 */
async function imageUrls(api, titles) {
  const urls = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await getJson(api, {
      action: "query",
      prop: "imageinfo",
      iiprop: "url|size",
      iiurlwidth: String(ASK_WIDTH),
      titles: batch.join("|"),
    });
    const renamed = new Map((data.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0];
      if (!info?.url || (info.height ?? 0) < MIN_HEIGHT) continue;
      urls.set(renamed.get(page.title) ?? page.title, info.thumburl ?? info.url);
    }
  }
  return urls;
}

/** Arknights names → their 立绘 on PRTS, 「立绘_<name>_1.png」 with plain brackets (the first, before promotion) */
async function arknightsUrls(wanted) {
  const title = (n) => `文件:立绘_${n.replace(/（/g, "(").replace(/）/g, ")")}_1.png`;
  const urls = await imageUrls("https://prts.wiki/api.php", wanted.map(title));
  return new Map(wanted.flatMap((n) => (urls.has(title(n)) ? [[n, urls.get(title(n))]] : [])));
}

/**
 * Endfield names → their 立绘 on endfield.wiki.gg: each character's page is found by the Chinese name written on it,
 * as for the small pictures, and the picture is the first of its infobox's image fields that is tall enough, else
 * one named after the page as such pictures usually are.
 */
async function endfieldUrls(wanted) {
  const api = "https://endfield.wiki.gg/api.php";
  const members = await getJson(api, { action: "query", list: "categorymembers", cmtitle: "Category:Operators", cmnamespace: "0", cmlimit: "200" });
  const pages = members.query.categorymembers.map((m) => m.title);
  /** Chinese name → the files to try, best first */
  const tries = new Map();
  for (let i = 0; i < pages.length; i += 50) {
    const data = await getJson(api, {
      action: "query",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: pages.slice(i, i + 50).join("|"),
    });
    for (const page of Object.values(data.query.pages)) {
      const text = page.revisions?.[0]?.slots?.main?.["*"] ?? "";
      const cn = text.match(/name[\w ]*=\s*([一-鿿·]+)\s*(?:\||\n)/)?.[1];
      if (!cn || tries.has(cn)) continue;
      const fields = [...text.matchAll(/\|\s*(?:image|art|splash|illustration)\w*\s*=\s*(?:\[\[)?(?:File:)?([^|\]\n]+?\.(?:png|webp|jpg))/gi)].map(
        (m) => `File:${m[1].trim()}`,
      );
      const guesses = ["Splash Art", "Splash", "Art", "Full"].map((s) => `File:${page.title} ${s}.png`);
      tries.set(cn, [...new Set([...fields, ...guesses, `File:${page.title}.png`])]);
    }
  }
  const known = wanted.filter((n) => tries.has(n));
  const urls = await imageUrls(api, [...new Set(known.flatMap((n) => tries.get(n)))]);
  return new Map(known.flatMap((n) => {
    const hit = tries.get(n).find((t) => urls.has(t));
    return hit ? [[n, urls.get(hit)]] : [];
  }));
}

/**
 * The colour of a character's pass, from the picture: the hue most of their coloured pixels share (the white, grey,
 * black and skin-like ones count for little), as the average of those pixels, then brought to the middle so that a
 * block of it carries words: neither too light nor too dark, and not washed out.
 */
async function colourOf(picture) {
  const { data, info } = await sharp(picture).resize(64, 64, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = Array.from({ length: 36 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let all = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = hsl(r, g, b);
    all = { w: all.w + 1, r: all.r + r, g: all.g + g, b: all.b + b };
    // skin: warm, light and only a little coloured
    const skin = h >= 10 && h <= 40 && l > 0.6 && s < 0.6;
    const w = s < 0.18 || l < 0.08 || l > 0.94 ? 0 : s * (1 - Math.abs(2 * l - 1)) * (skin ? 0.25 : 1);
    if (!w) continue;
    const bin = bins[Math.floor(h / 10) % 36];
    bin.w += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
  }
  // a hue with its neighbours, so one spread over two bins is not split
  const near = (i) => bins[(i + 35) % 36].w + bins[i].w + bins[(i + 1) % 36].w;
  let best = -1;
  for (let i = 0; i < 36; i++) if (bins[i].w > 0 && (best < 0 || near(i) > near(best))) best = i;
  const pick = best >= 0 && near(best) > 0.6 ? [(best + 35) % 36, best, (best + 1) % 36].map((i) => bins[i]) : null;
  const sum = pick ? pick.reduce((a, x) => ({ w: a.w + x.w, r: a.r + x.r, g: a.g + x.g, b: a.b + x.b })) : all;
  if (!sum.w) return null;
  let [h, s, l] = hsl(sum.r / sum.w, sum.g / sum.w, sum.b / sum.w);
  l = Math.min(0.5, Math.max(0.3, l));
  if (pick) s = Math.min(0.75, Math.max(0.35, s));
  return hex(h, s, l);
}

function hsl(r, g, b) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Make a character's files from their picture; returns { file, color } */
async function storePicture(input) {
  const source = await sharp(input, { limitInputPixels: 80_000_000 }).ensureAlpha().png().toBuffer();
  // the character alone: a transparent border cut off (one with none stays as it is)
  const cut = await sharp(source)
    .trim({ threshold: 10 })
    .png()
    .toBuffer()
    .catch(() => source);
  const file = createHash("sha256").update(MAKE).update(cut).digest("hex").slice(0, 16);
  const width = (w) => sharp(cut).resize({ width: w, withoutEnlargement: true });
  const out = {
    [`${file}.avif`]: await width(480).avif({ quality: 52, effort: 6 }).toBuffer(),
    [`${file}.webp`]: await width(480).webp({ quality: 80, alphaQuality: 90, effort: 5 }).toBuffer(),
    [`${file}.s.webp`]: await width(240).webp({ quality: 78, alphaQuality: 85, effort: 5 }).toBuffer(),
    [`${file}.b.webp`]: await width(20).webp({ quality: 60, alphaQuality: 60 }).toBuffer(),
  };
  for (const [name, bytes] of Object.entries(out)) writeFileSync(path.join(OUT, name), bytes);
  return { file, color: (await colourOf(cut)) ?? undefined };
}

/** Download one picture and make its files */
async function store(url) {
  const res = await get(url);
  if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`not a picture: ${url}`);
  return storePicture(Buffer.from(await res.arrayBuffer()));
}

/** What a character has here already, while its files are still there */
function kept(id) {
  const k = old[id];
  return k && existsSync(path.join(OUT, `${k.file}.webp`)) ? k : null;
}

const key = (c) => `${c.game}:${c.name}`;

mkdirSync(OUT, { recursive: true });

const add = args.indexOf("--add");
if (add >= 0) {
  const [game, name, picture] = args.slice(add + 1, add + 4);
  const c = catalog.find((x) => x.game === game && x.name === name);
  if (!c || !picture) throw new Error("usage: --add <ak|ef> <name as in src/data/pass-catalog.json> <picture>");
  Object.assign(art, old);
  art[c.id] = { ...(await storePicture(readFileSync(picture))), from: "hand" };
  console.log(`${key(c)}: added by hand`);
} else {
  for (const c of catalog) {
    const k = kept(c.id);
    // one added by hand stays, --refresh or not; any other stays unless asked for again
    if (k && (k.from === "hand" || !refresh)) art[c.id] = k;
  }
  const wanted = (game) => catalog.filter((c) => c.game === game && !art[c.id]).map((c) => c.name);
  const missing = [];
  for (const [game, find] of [
    ["ak", arknightsUrls],
    ["ef", endfieldUrls],
  ]) {
    const names = wanted(game);
    if (!names.length) continue;
    let urls = new Map();
    try {
      urls = await find(names);
    } catch (e) {
      console.warn(`${game}: could not ask the wiki (${e.message}); the pictures here stay`);
    }
    for (const name of names) {
      const c = catalog.find((x) => x.game === game && x.name === name);
      const url = urls.get(name);
      try {
        if (!url) throw new Error("the wiki has no picture of them");
        art[c.id] = { ...(await store(url)), from: new URL(url).hostname };
        process.stdout.write(".");
      } catch (e) {
        const k = kept(c.id);
        if (k) art[c.id] = k;
        else missing.push(`${key(c)} (${e.message})`);
      }
      // one at a time, a little apart: the wikis are run by players too
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (missing.length) console.log(`\nno picture for ${missing.length}:\n  ${missing.join("\n  ")}`);
}

const sorted = Object.fromEntries(Object.entries(art).sort(([a], [b]) => Number(a) - Number(b)));
writeFileSync(INDEX, JSON.stringify({ note: "scripts/fetch-pass-art.mjs: catalogue id → files <file>.avif/.webp/.s.webp/.b.webp and the pass's colour", art: sorted }, null, 1) + "\n");
const colors = {};
for (const c of catalog) if (art[c.id]?.color) colors[key(c)] = art[c.id].color;
writeFileSync(path.join(OUT, "colors.json"), JSON.stringify(colors, null, 1) + "\n");

// the files no character uses any more
const used = new Set(Object.values(art).map((a) => a.file));
let gone = 0;
for (const f of readdirSync(OUT)) {
  if (FILE.test(f) && !used.has(f.slice(0, 16))) {
    unlinkSync(path.join(OUT, f));
    gone++;
  }
}
console.log(`\n${Object.keys(art).length} of ${catalog.length} characters have a picture${gone ? `; ${gone} old files deleted` : ""}`);
