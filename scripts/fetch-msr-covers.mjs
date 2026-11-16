#!/usr/bin/env node
// Each album of music/catalog.json its cover too, from the Monster Siren Records site: made into a 300×300 JPEG,
// stored in music/files/ the way the songs are (under the first 16 hex digits of its content's sha256) and named in the
// catalogue as the album's cover (scripts/msr-music.mjs). Caddy serves them from there as they are (deploy/Caddyfile).
// Run on the main server through scripts/fetch-music.sh, in the throwaway container that has ffmpeg:
//
//   ~/arknights_map/scripts/fetch-music.sh covers --dry-run    how many albums it would get the cover of
//   ~/arknights_map/scripts/fetch-music.sh covers --limit 3    three albums, to try it
//   ~/arknights_map/scripts/fetch-music.sh covers              every album without one (some minutes)
//
// The site's list of albums gives each one's cover (an album it no longer lists: its detail does). One album at a
// time: its cover downloaded into music/work-covers/, made into the JPEG, checked, stored, and the catalogue written
// again (to a new file, renamed over the old one), so a run stopped halfway keeps what it got. Each request waits 1–2 s
// after the one before. Nothing else in the catalogue changes: the fetch, 省流量 and this all run under the
// container's one name (scripts/fetch-music.sh), so never at once. The covers belong to Hypergryph, as the songs do.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { addCover, albumsToCover, COVER_SIZE, coverProblem, coverSource, isCid, isCoverName, pictureKind, readCatalog, totals } from "./msr-music.mjs";

const API = "https://monster-siren.hypergryph.com/api";
const OUT = path.resolve("music");
const FILES = path.join(OUT, "files");
const WORK = path.join(OUT, "work-covers");
const CATALOG = path.join(OUT, "catalog.json");
// a plain name, nobody's (as scripts/fetch-msr-music.mjs)
const AGENT = "msr-music-fetch/1.0";
/** A cover bigger than this as the site gives it is not downloaded */
const SOURCE_MAX = 30 * 1024 ** 2;
/** A made cover outside these is not kept: nothing much in it, or not made small */
const MADE_MIN = 500; // one of a single colour is some 760 bytes
const MADE_MAX = 300 * 1024;
/** Stop before the disk gets this full */
const MIN_FREE = 1024 ** 3;
/** Stop after this many albums failed in a row: the site is refusing, or something here is wrong */
const FAILS_IN_A_ROW = 5;

const run = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
if (!(limit > 0)) {
  console.error("Usage: node scripts/fetch-msr-covers.mjs [--dry-run] [--limit <albums>]");
  process.exit(1);
}
// who owns what this writes (uid:gid), when it runs as root in a container for someone else (scripts/fetch-music.sh)
const owner = /^(\d+):(\d+)$/.exec(process.env.OWNER ?? "");
const mine = (p) => owner && chownSync(p, Number(owner[1]), Number(owner[2]));
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastDone = 0;

/** A request, 1–2 s after the one before ended */
async function paced(url, timeoutMs) {
  const wait = lastDone + 1000 + Math.random() * 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const res = await fetch(url, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${res.status} ${new URL(url).pathname}`);
    return res;
  } finally {
    lastDone = Date.now();
  }
}

/** Tried again a couple of times when the network drops it */
async function tries(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(5000 * attempt);
    } finally {
      lastDone = Date.now();
    }
  }
}

/** What the site's API answers: its data, when its code says all is well */
const api = (pathname) =>
  tries(async () => {
    const body = await (await paced(`${API}${pathname}`, 30_000)).json();
    if (body?.code !== 0) throw new Error(`${pathname}: code ${body?.code} ${body?.msg ?? ""}`);
    return body.data;
  });

const hasFile = (file) => isCoverName(file) && existsSync(path.join(FILES, file));
const freeBytes = () => {
  const s = statfsSync(OUT);
  return s.bavail * s.bsize;
};
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const took = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** ffmpeg or ffprobe run; should it fail, why in a line for the list of those failed: the first thing it said */
async function tool(name, argv) {
  try {
    return await run(name, argv);
  } catch (e) {
    const first = String(e?.stderr ?? "")
      .split("\n")
      .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim())
      .find(Boolean);
    throw new Error(`${name}: ${(first ?? String(e?.message ?? e).split("\n")[0]).slice(0, 160)}`);
  }
}

/** The cover as the site gives it, downloaded into music/work-covers/, and what sort of picture it is (pictureKind) */
async function download(id, url) {
  const bytes = await tries(async () => {
    const res = await paced(url, 60_000);
    if (Number(res.headers.get("content-length")) > SOURCE_MAX) throw new Error(`over ${kb(SOURCE_MAX)}`);
    const got = Buffer.from(await res.arrayBuffer());
    if (got.length > SOURCE_MAX) throw new Error(`over ${kb(SOURCE_MAX)}`);
    if (!got.length) throw new Error("nothing came");
    return got;
  });
  const kind = pictureKind(bytes);
  if (!kind) throw new Error("not a JPEG, PNG or WebP picture");
  // named apart from the JPEG made of it (shrink)
  const file = path.join(WORK, `${id}.site`);
  writeFileSync(file, bytes);
  return { file, kind };
}

/**
 * The site's cover made into a COVER_SIZE square JPEG (out), read only as the picture it is: cut to a square first
 * should it not be one, and what of it is see-through (some are PNG) on white, as the panel would show it; checked
 */
async function shrink(input, out) {
  const fit = `scale=${COVER_SIZE}:${COVER_SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=${COVER_SIZE}:${COVER_SIZE}`;
  const graph = `color=c=white:s=${COVER_SIZE}x${COVER_SIZE}[bg];[0:v]${fit},format=rgba[fg];[bg][fg]overlay=format=auto:shortest=1,format=yuvj420p`;
  // prettier-ignore
  await tool("ffmpeg", ["-nostdin", "-v", "error", "-y", "-f", input.kind, "-i", input.file, "-filter_complex", graph, "-frames:v", "1", "-q:v", "3", "-map_metadata", "-1", "-threads", "1", out]);
  // prettier-ignore
  const { stdout } = await tool("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", out]);
  const problem = coverProblem(JSON.parse(stdout));
  if (problem) throw new Error(problem);
  const bytes = readFileSync(out);
  if (bytes.length < MADE_MIN || bytes.length > MADE_MAX) throw new Error(`${bytes.length} bytes made`);
  return bytes;
}

/** The cover into music/files/ under the first 16 hex digits of its content's sha256 */
function store(jpg, bytes) {
  const file = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.jpg`;
  const to = path.join(FILES, file);
  if (existsSync(to)) rmSync(jpg);
  else renameSync(jpg, to);
  mine(to);
  return file;
}

function save(catalog) {
  catalog.updated = new Date().toISOString();
  const tmp = `${CATALOG}.tmp`;
  writeFileSync(tmp, JSON.stringify(catalog));
  mine(tmp);
  renameSync(tmp, CATALOG);
}

if (!existsSync(CATALOG)) {
  console.error("No music/catalog.json: fetch the songs first (scripts/fetch-msr-music.mjs)");
  process.exit(1);
}
const catalog = readCatalog(readFileSync(CATALOG, "utf8"));
const todo = albumsToCover(catalog, hasFile);
console.log(`${catalog.albums.length} albums in the catalogue; ${todo.length} without a cover`);

let done = 0;
let inARow = 0;
let stopped = "";
const failed = [];
if (dryRun) done = Math.min(todo.length, limit);
else if (todo.length) {
  // every album's cover, as the site lists them
  const listed = new Map();
  try {
    for (const a of (await api("/albums")) ?? []) if (isCid(a?.cid)) listed.set(a.cid, coverSource(a));
  } catch (e) {
    console.error(`The site's list of albums could not be had (${e.message}): nothing changed, try again later`);
    process.exit(1);
  }
  // what a stopped run left half done
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mine(WORK);
  for (const id of todo) {
    if (done >= limit) {
      stopped = `--limit ${limit}`;
      break;
    }
    if (freeBytes() < MIN_FREE) {
      stopped = `under ${gb(MIN_FREE)} free on the disk`;
      process.exitCode = 1;
      break;
    }
    const name = catalog.albums.find((a) => a.id === id)?.name ?? id;
    const out = path.join(WORK, `${id}.jpg`);
    let input = null;
    try {
      // an album the site's list no longer has, or gives no cover for: its detail
      const from = listed.get(id) ?? coverSource(await api(`/album/${encodeURIComponent(id)}/detail`));
      if (!from) throw new Error("the site gives no cover");
      input = await download(id, from);
      const file = store(out, await shrink(input, out));
      addCover(catalog, id, file);
      save(catalog);
      done++;
      inARow = 0;
      console.log(`[${done}] ${name}  ${file}`);
    } catch (e) {
      failed.push(`${name} (${id}): ${e.message}`);
      if (++inARow >= FAILS_IN_A_ROW) {
        stopped = `${FAILS_IN_A_ROW} albums failed in a row`;
        process.exitCode = 1;
        break;
      }
    } finally {
      if (input) rmSync(input.file, { force: true });
      rmSync(out, { force: true });
    }
  }
  rmSync(WORK, { recursive: true, force: true });
}

const t = totals(catalog);
console.log(
  `${dryRun ? "Would get" : "Got"} ${done} ${done === 1 ? "cover" : "covers"}${stopped ? ` (stopped: ${stopped})` : ""}. ` +
    `Albums with one: ${t.covers} of ${t.albums}. Took ${took(Date.now() - started)}.`,
);
if (failed.length) {
  console.log(`Failed, to try again next time:\n  ${failed.join("\n  ")}`);
  process.exitCode = 1;
}
