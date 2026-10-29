#!/usr/bin/env node
// Download the small round pictures of the characters on our lists into operator-art/,
// as 128px WebP files named by their content, with operator-art/index.json mapping each
// name to its file. Run on the Mac from the repository root:
//
//   node scripts/fetch-operator-art.mjs            only the ones still missing
//   node scripts/fetch-operator-art.mjs --refresh  all of them again
//
// The pictures belong to Hypergryph, so they stay out of the repository (.gitignore) and
// out of the app image (.dockerignore); scripts/deploy.sh copies the folder to the server.
// Arknights pictures come from PRTS, named by the same Chinese names as our list; Endfield
// ones from endfield.wiki.gg, whose pages give each character's Chinese name. sharp comes
// with Next.js.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("operator-art");
const INDEX = path.join(OUT, "index.json");
const SIZE = 128;
const AGENT = "zhoupmap-operator-art/1.0 (https://zhoupmap.com)";
// Collaboration characters: names only, no pictures
const COLLAB = new Set(["灰烬", "闪击", "战车", "霜华", "麒麟R夜刀", "火龙S黑角", "雷狼龙S空爆"]);

const refresh = process.argv.includes("--refresh");
const names = (file) => JSON.parse(readFileSync(file, "utf8")).operators.map((o) => o.name);
const lists = {
  arknights: names("src/data/arknights-operators.json"),
  endfield: names("src/data/endfield-operators.json"),
};
const old = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : {};
const index = { arknights: {}, endfield: {} };

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

/** Image URLs for file titles on a MediaWiki, followed through its title normalisation; missing ones are left out. */
async function imageUrls(api, titles) {
  const urls = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await getJson(api, { action: "query", prop: "imageinfo", iiprop: "url", titles: batch.join("|") });
    const renamed = new Map((data.query.normalized ?? []).map((n) => [n.to, n.from]));
    for (const page of Object.values(data.query.pages)) {
      const url = page.imageinfo?.[0]?.url;
      if (url) urls.set(renamed.get(page.title) ?? page.title, url);
    }
  }
  return urls;
}

/** Our Arknights name → its picture on PRTS, 「头像_<name>.png」 with plain brackets. */
async function arknightsUrls(wanted) {
  const title = (n) => `文件:头像_${n.replace(/（/g, "(").replace(/）/g, ")")}.png`;
  const urls = await imageUrls("https://prts.wiki/api.php", wanted.map(title));
  return new Map(wanted.flatMap((n) => (urls.has(title(n)) ? [[n, urls.get(title(n))]] : [])));
}

/** Our Endfield name → its picture on endfield.wiki.gg, found through the Chinese name on each character's page. */
async function endfieldUrls(wanted) {
  const api = "https://endfield.wiki.gg/api.php";
  const members = await getJson(api, { action: "query", list: "categorymembers", cmtitle: "Category:Operators", cmnamespace: "0", cmlimit: "200" });
  const pages = members.query.categorymembers.map((m) => m.title);
  const byChinese = new Map();
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
      // the first name field written in Chinese characters, such as the infobox's simplified Chinese name
      const cn = text.match(/name[\w ]*=\s*([一-鿿·]+)\s*(?:\||\n)/)?.[1];
      if (cn && !byChinese.has(cn)) byChinese.set(cn, page.title);
    }
  }
  const icon = (n) => `File:${byChinese.get(n)} icon.png`;
  const known = wanted.filter((n) => byChinese.has(n));
  const urls = await imageUrls(api, known.map(icon));
  return new Map(known.flatMap((n) => (urls.has(icon(n)) ? [[n, urls.get(icon(n))]] : [])));
}

/** Download one picture and store it as a small WebP named by its content; returns the file name. */
async function store(url) {
  const res = await get(url);
  if (!(res.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`not a picture: ${url}`);
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(SIZE, SIZE, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  const file = `${createHash("sha256").update(webp).digest("hex").slice(0, 16)}.webp`;
  writeFileSync(path.join(OUT, file), webp);
  return file;
}

mkdirSync(OUT, { recursive: true });
const missing = [];
for (const [game, find] of [
  ["arknights", arknightsUrls],
  ["endfield", endfieldUrls],
]) {
  const wanted = lists[game].filter((n) => !COLLAB.has(n));
  const todo = [];
  for (const n of wanted) {
    const kept = old[game]?.[n];
    if (!refresh && kept && existsSync(path.join(OUT, kept))) index[game][n] = kept;
    else todo.push(n);
  }
  const urls = todo.length ? await find(todo) : new Map();
  // a few at a time, to be gentle with the wikis
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (n) => {
        const url = urls.get(n);
        if (!url) return missing.push(`${game}: ${n}`);
        try {
          index[game][n] = await store(url);
        } catch (e) {
          missing.push(`${game}: ${n} (${e.message})`);
        }
      }),
    );
  }
  console.log(`${game}: ${Object.keys(index[game]).length} of ${lists[game].length}, ${todo.length} fetched now`);
}
writeFileSync(INDEX, JSON.stringify(index));
console.log(`Collaboration characters left as names: ${[...COLLAB].join("、")}`);
if (missing.length) console.log(`No picture found for:\n  ${missing.join("\n  ")}`);
