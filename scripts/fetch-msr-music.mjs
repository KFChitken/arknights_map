#!/usr/bin/env node
// Download the Arknights songs of the Monster Siren Records site (monster-siren.hypergryph.com) into music/: each song
// as a 96 kbps AAC file (.m4a) named by its content in music/files/, and music/catalog.json listing the albums and
// their songs (what is in it: scripts/msr-music.mjs). The site reads the catalogue, and Caddy serves the files. Run on
// the main server through scripts/fetch-music.sh, which runs this in a throwaway container that has ffmpeg, or from
// the repository's folder anywhere with Node and ffmpeg:
//
//   node scripts/fetch-msr-music.mjs              the songs not here yet: a run after another only adds
//   node scripts/fetch-msr-music.mjs --dry-run    only list the songs it would fetch
//   node scripts/fetch-msr-music.mjs --limit 5    at most five songs this time, to try it
//
// One song at a time: its original (a .wav of 37–60 MB, at a link that lasts only a few hours, so it is asked for
// just before) is downloaded into music/work/, made into the .m4a and deleted, so the originals never stay. Each
// request waits 1–2 s after the one before. The catalogue is written again after every song (to a new file, renamed
// over the old one, so it is never read half written): a run stopped halfway keeps what it fetched, and the next
// takes up from there. Only albums whose detail says they are Arknights' (belong) are taken, and nothing is ever
// taken out (scripts/msr-music.mjs). The songs belong to Hypergryph: music/ stays out of the repository
// (.gitignore) and out of the app image (.dockerignore).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  addSong,
  albumsToCheck,
  clean,
  emptyCatalog,
  isArknights,
  isCid,
  isFileName,
  keepAlbum,
  orderAlbums,
  readCatalog,
  songsToFetch,
  totals,
} from "./msr-music.mjs";

const API = "https://monster-siren.hypergryph.com/api";
const OUT = path.resolve("music");
const FILES = path.join(OUT, "files");
const WORK = path.join(OUT, "work");
const CATALOG = path.join(OUT, "catalog.json");
// a plain name, nobody's
const AGENT = "msr-music-fetch/1.0";
/** The originals come from Hypergryph's own hosts */
const SOURCE_HOSTS = /(^|\.)(hycdn\.cn|hypergryph\.com)$/;
/** Stop before the disk gets this full: an original takes up to some 60 MB while it is made into the .m4a */
const MIN_FREE = 1024 ** 3;
/** Stop after this many songs failed in a row: the site is refusing, or something here is wrong */
const FAILS_IN_A_ROW = 5;

const run = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
if (!(limit > 0)) {
  console.error("Usage: node scripts/fetch-msr-music.mjs [--dry-run] [--limit <songs>]");
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

const hasFile = (file) => isFileName(file) && existsSync(path.join(FILES, file));

/** A song's original, downloaded into music/work/: its link asked for again on each try, as they do not last */
async function original(cid) {
  return tries(async () => {
    const song = await api(`/song/${encodeURIComponent(cid)}`);
    const url = new URL(song?.sourceUrl ?? "");
    if (url.protocol !== "https:" || !SOURCE_HOSTS.test(url.hostname)) throw new Error(`unexpected source ${url.origin}`);
    const file = path.join(WORK, `${cid}${path.extname(url.pathname).replace(/[^.a-z0-9]/gi, "") || ".bin"}`);
    const res = await paced(url.href, 10 * 60_000);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
    return { song, file };
  });
}

/** The original made into 96 kbps AAC, its moov box first so a browser can start before the end comes */
async function transcode(input, output) {
  // prettier-ignore
  await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", input, "-vn", "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", "-threads", "1", output]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
  const seconds = Number(stdout.trim());
  if (!(seconds > 0)) throw new Error("ffprobe found no duration");
  return seconds;
}

/** The .m4a into music/files/ under the first 16 hex digits of its content's sha256 */
function store(m4a) {
  const bytes = readFileSync(m4a);
  const file = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.m4a`;
  const to = path.join(FILES, file);
  if (existsSync(to)) rmSync(m4a);
  else renameSync(m4a, to);
  mine(to);
  return { file, bytes: bytes.length };
}

function save(catalog, siteAlbums) {
  orderAlbums(catalog, siteAlbums);
  catalog.updated = new Date().toISOString();
  const tmp = `${CATALOG}.tmp`;
  writeFileSync(tmp, JSON.stringify(catalog));
  mine(tmp);
  renameSync(tmp, CATALOG);
}

const freeBytes = () => {
  const s = statfsSync(OUT);
  return s.bavail * s.bsize;
};
const mb = (bytes) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const took = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

mkdirSync(FILES, { recursive: true });
// what a stopped run left half done
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
[OUT, FILES, WORK].forEach(mine);

const catalog = existsSync(CATALOG) ? readCatalog(readFileSync(CATALOG, "utf8")) : emptyCatalog();
const siteAlbums = (await api("/albums")).filter((a) => isCid(a?.cid));
let siteSongs = null;
try {
  const list = (await api("/songs"))?.list;
  if (Array.isArray(list)) siteSongs = list.filter((s) => isCid(s?.cid) && isCid(s?.albumCid));
} catch (e) {
  console.log(`The list of songs could not be read (${e.message}): looking at every album`);
}
const check = albumsToCheck(siteAlbums, siteSongs, catalog, hasFile);
console.log(`${siteAlbums.length} albums on the site; ${check.length} to look at`);

let done = 0;
let inARow = 0;
let stopped = "";
const failed = [];
const others = [];
albums: for (const albumCid of check) {
  let detail;
  try {
    detail = await api(`/album/${encodeURIComponent(albumCid)}/detail`);
  } catch (e) {
    failed.push(`album ${albumCid} (${e.message})`);
    continue;
  }
  const album = clean(detail?.name) || albumCid;
  if (!isArknights(detail)) {
    others.push(`${album} (${detail?.belong ?? "?"})`);
    continue;
  }
  detail.cid = albumCid;
  for (const cid of songsToFetch(detail, catalog, hasFile)) {
    if (done >= limit) {
      stopped = `--limit ${limit}`;
      break albums;
    }
    const name = clean(detail.songs.find((s) => s.cid === cid)?.name) || cid;
    if (dryRun) {
      console.log(`  ${album} · ${name}`);
      done++;
      continue;
    }
    if (freeBytes() < MIN_FREE) {
      stopped = `under ${gb(MIN_FREE)} free on the disk`;
      process.exitCode = 1;
      break albums;
    }
    let input = null;
    const m4a = path.join(WORK, `${cid}.m4a`);
    try {
      const got = await original(cid);
      input = got.file;
      const seconds = await transcode(input, m4a);
      const { file, bytes } = store(m4a);
      addSong(catalog, cid, { name: clean(got.song.name) || name, album: albumCid, artists: got.song.artists, seconds, file, bytes });
      keepAlbum(catalog, detail);
      save(catalog, siteAlbums);
      done++;
      inARow = 0;
      console.log(`[${done}] ${album} · ${name}  ${mb(bytes)}, ${seconds.toFixed(2)} s`);
    } catch (e) {
      failed.push(`${album} · ${name} (${e.message})`);
      if (++inARow >= FAILS_IN_A_ROW) {
        stopped = `${FAILS_IN_A_ROW} songs failed in a row`;
        process.exitCode = 1;
        break albums;
      }
    } finally {
      if (input) rmSync(input, { force: true });
      rmSync(m4a, { force: true });
    }
  }
  if (!dryRun) {
    keepAlbum(catalog, detail);
    save(catalog, siteAlbums);
  }
}
rmSync(WORK, { recursive: true, force: true });
if (!dryRun && existsSync(CATALOG)) save(catalog, siteAlbums);

const t = totals(catalog);
const many = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
console.log(
  `${dryRun ? "Would fetch" : "Fetched"} ${many(done, "song")}${stopped ? ` (stopped: ${stopped})` : ""}. ` +
    `The catalogue: ${many(t.albums, "album")}, ${many(t.songs, "song")}, ${gb(t.bytes)}. Took ${took(Date.now() - started)}.`,
);
if (others.length) console.log(`Not Arknights', left out:\n  ${others.join("\n  ")}`);
if (failed.length) {
  console.log(`Failed, to try again next time:\n  ${failed.join("\n  ")}`);
  process.exitCode = 1;
}
