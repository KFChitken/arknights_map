#!/usr/bin/env node
// Make each song of music/catalog.json a smaller copy too, for a slow line (省流量): 48 kbps HE-AAC, half the bytes of
// the 96 kbps file the fetch made (scripts/fetch-msr-music.mjs), made from that file, stored in music/files/ the
// same way (under the first 16 hex digits of its content's sha256) and named in the catalogue as the song's lite
// (scripts/msr-music.mjs). Run on the main server through scripts/fetch-music.sh, in the throwaway container, which
// then has fdkaac too (ffmpeg's own AAC encoder makes no HE-AAC):
//
//   ~/arknights_map/scripts/fetch-music.sh lite --dry-run    how many songs it would make a copy of
//   ~/arknights_map/scripts/fetch-music.sh lite --limit 3    three songs, to try it
//   ~/arknights_map/scripts/fetch-music.sh lite              every song without one (the first time a few hours:
//                                                            best left running with nohup … >> ~/music-fetch.log 2>&1 &)
//
// One song at a time: its file decoded to a .wav in music/work-lite/, that encoded, then put in an .m4a with its moov
// box first (so a browser can start before the end comes), checked (HE-AAC, two channels, as long as the song), and
// stored; the catalogue is written again after every song (to a new file, renamed over the old one), so a run stopped
// halfway keeps what it made and the next takes up from there. Nothing else in the catalogue changes: the fetch and
// this both run under the container's one name (scripts/fetch-music.sh), so never at once.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { addLite, isFileName, liteProblem, moovFirst, readCatalog, songsToLighten, totals } from "./msr-music.mjs";

const OUT = path.resolve("music");
const FILES = path.join(OUT, "files");
const WORK = path.join(OUT, "work-lite");
const CATALOG = path.join(OUT, "catalog.json");
/** Stop before the disk gets this full: a song's .wav takes some 40–60 MB while it is encoded */
const MIN_FREE = 1024 ** 3;
/** Stop after this many songs failed in a row: something here is wrong */
const FAILS_IN_A_ROW = 5;
/** The copy's rate: HE-AAC keeps the highs as a description, so at half the bytes it still sounds like the song */
const BITRATE = 48000;
/** A copy must be at most this much of the song's own file, or it saves too little to be worth playing */
const SMALLER = 0.75;

const run = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
if (!(limit > 0)) {
  console.error("Usage: node scripts/make-lite-music.mjs [--dry-run] [--limit <songs>]");
  process.exit(1);
}
// who owns what this writes (uid:gid), when it runs as root in a container for someone else (scripts/fetch-music.sh)
const owner = /^(\d+):(\d+)$/.exec(process.env.OWNER ?? "");
const mine = (p) => owner && chownSync(p, Number(owner[1]), Number(owner[2]));
const started = Date.now();

const hasFile = (file) => isFileName(file) && existsSync(path.join(FILES, file));
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

/** The song's file (ownBytes long) made into its smaller copy (out), checked */
async function lighten(input, out, seconds, ownBytes) {
  const wav = `${out}.wav`;
  const raw = `${out}.raw.m4a`;
  try {
    // prettier-ignore
    await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", input, "-vn", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2", "-threads", "1", wav]);
    await run("fdkaac", ["-S", "-p", "5", "-b", String(BITRATE), "-o", raw, wav]);
    // the moov box first, whatever the encoder did, and nothing of the encoder's own tags
    // prettier-ignore
    await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-i", raw, "-map", "0:a", "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", out]);
  } finally {
    rmSync(wav, { force: true });
    rmSync(raw, { force: true });
  }
  // prettier-ignore
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,profile,channels:format=duration", "-of", "json", out]);
  const problem = liteProblem(JSON.parse(stdout), seconds);
  if (problem) throw new Error(problem);
  const bytes = readFileSync(out);
  if (!moovFirst(bytes)) throw new Error("its moov box is not first");
  if (bytes.length > ownBytes * SMALLER) throw new Error(`${mb(bytes.length)}, hardly smaller than the song's own ${mb(ownBytes)}`);
  return bytes;
}

/** The copy into music/files/ under the first 16 hex digits of its content's sha256 */
function store(m4a, bytes) {
  const file = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.m4a`;
  const to = path.join(FILES, file);
  if (existsSync(to)) rmSync(m4a);
  else renameSync(m4a, to);
  mine(to);
  return { file, bytes: bytes.length };
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
const todo = songsToLighten(catalog, hasFile);
console.log(`${Object.keys(catalog.songs).length} songs in the catalogue; ${todo.length} without a smaller copy`);
if (!dryRun) {
  // what a stopped run left half done
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  mine(WORK);
}

let done = 0;
let inARow = 0;
let stopped = "";
let made = 0;
const failed = [];
for (const cid of todo) {
  if (done >= limit) {
    stopped = `--limit ${limit}`;
    break;
  }
  const song = catalog.songs[cid];
  if (dryRun) {
    done++;
    continue;
  }
  if (freeBytes() < MIN_FREE) {
    stopped = `under ${gb(MIN_FREE)} free on the disk`;
    process.exitCode = 1;
    break;
  }
  const out = path.join(WORK, `${cid}.m4a`);
  try {
    const bytes = await lighten(path.join(FILES, song.file), out, song.seconds, song.bytes);
    const lite = store(out, bytes);
    addLite(catalog, cid, lite);
    save(catalog);
    done++;
    inARow = 0;
    made += lite.bytes;
    console.log(`[${done}] ${song.name}  ${mb(song.bytes)} → ${mb(lite.bytes)}`);
  } catch (e) {
    failed.push(`${song.name} (${cid}): ${e.message}`);
    if (++inARow >= FAILS_IN_A_ROW) {
      stopped = `${FAILS_IN_A_ROW} songs failed in a row`;
      process.exitCode = 1;
      break;
    }
  } finally {
    rmSync(out, { force: true });
  }
}
if (!dryRun) rmSync(WORK, { recursive: true, force: true });

const t = totals(catalog);
console.log(
  `${dryRun ? "Would make" : "Made"} ${done} smaller ${done === 1 ? "copy" : "copies"}${dryRun ? "" : ` (${mb(made)})`}` +
    `${stopped ? ` (stopped: ${stopped})` : ""}. Songs with one: ${t.lite} of ${t.songs}, ${gb(t.liteBytes)} beside ${gb(t.bytes)}. ` +
    `Took ${took(Date.now() - started)}.`,
);
if (failed.length) {
  console.log(`Failed, to try again next time:\n  ${failed.join("\n  ")}`);
  process.exitCode = 1;
}
