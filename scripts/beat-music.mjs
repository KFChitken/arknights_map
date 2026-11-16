#!/usr/bin/env node
// Find a steady stretch of beats in each of 听歌's songs (music/catalog.json, scripts/fetch-msr-music.mjs) and cut the
// clips 325 节拍 plays from them. Run on the main server through scripts/beat-music.sh, which runs this in a
// throwaway container that has ffmpeg, or from the repository's folder anywhere with Node and ffmpeg:
//
//   node scripts/beat-music.mjs                      analyse the songs not analysed yet (every one the first time),
//                                                    list the candidates, and cut the clips when there are none yet:
//                                                    the hot ones first (scripts/beat-hot.json), then the steadiest,
//                                                    TOP of them
//   node scripts/beat-music.mjs --top 20             the same, and cut the first 20 again, clips or not
//   node scripts/beat-music.mjs --pick <cid>,<cid>   the same, and cut exactly these songs' clips, in this order
//   node scripts/beat-music.mjs --limit 5            analyse at most five songs this time, to try it: no clips are cut
//                                                    while songs are left to analyse, unless --top or --pick says so
//
// What it leaves in music/:
//   beat/analysis.json      what each song's file came to (scripts/beat-analysis.mjs), so a later run analyses only
//                           the songs added since
//   beat/candidates.json    the songs that could be played, best first, and beat/candidates.txt the same to read
//   files/<16 hex>.m4a      each clip: RULES.preS before its first beat to RULES.postS after its window, faded in and
//                           out, AAC at 64 kbps, named by its content like the songs, so the links and checks that let
//                           songs out let clips out too (deploy/Caddyfile, src/lib/server/musicLinks.ts)
//   beat.json               the clips the site plays, which its main process reads into the database
//                           (src/lib/server/beatClips.ts):
//     { v: 1, updated, clips: [{ song: "<cid>", file, beat: <ms between two beats>, first: <ms from the clip's start
//       to its first beat>, bar: <which of its first four beats starts a bar>, ms: <its length>, bytes }] }
//
// One song at a time, each read whole into memory (a few tens of MB at most). The analyses are written again every
// ten songs, so a run stopped halfway keeps what it did. A clip once cut is never taken out: beat.json only stops
// naming it. Nothing is downloaded. The songs and the clips belong to Hypergryph: music/ stays out of the repository.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { analyse, ANALYSIS_V, candidatesOf, clipPlan, manifestOf, pickClips, squashName, SR } from "./beat-analysis.mjs";
import { isFileName, readCatalog } from "./msr-music.mjs";

/** How many clips are cut when none are named */
const TOP = 30;
/** Songs longer than this are left out: a long mix would not fit in the container's memory, read whole (s) */
const MAX_S = 15 * 60;

const OUT = path.resolve("music");
const FILES = path.join(OUT, "files");
const BEAT = path.join(OUT, "beat");
const CATALOG = path.join(OUT, "catalog.json");
const ANALYSES = path.join(BEAT, "analysis.json");
const MANIFEST = path.join(OUT, "beat.json");
const HOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "beat-hot.json");

const run = promisify(execFile);
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const limit = valueOf("--limit") === undefined ? Infinity : Number(valueOf("--limit"));
const top = valueOf("--top") === undefined ? null : Number(valueOf("--top"));
const pick = valueOf("--pick")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
if (!(limit > 0) || (top !== null && !(top > 0)) || (pick && !pick.length)) {
  console.error("Usage: node scripts/beat-music.mjs [--limit <songs>] [--top <clips> | --pick <cid>,<cid>,…]");
  process.exit(1);
}
// who owns what this writes (uid:gid), when it runs as root in a container for someone else (scripts/beat-music.sh)
const owner = /^(\d+):(\d+)$/.exec(process.env.OWNER ?? "");
const mine = (p) => owner && chownSync(p, Number(owner[1]), Number(owner[2]));

/** Written whole to a new file, renamed over the old one, so it is never read half written */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  mine(tmp);
  renameSync(tmp, file);
}

/** A song's samples: mono, at SR, as 32-bit floats */
async function samplesOf(file) {
  // prettier-ignore
  const { stdout } = await run("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-threads", "1", "-"], { encoding: "buffer", maxBuffer: 1 << 30 });
  const copy = new Float32Array(stdout.byteLength >> 2);
  new Uint8Array(copy.buffer).set(stdout.subarray(0, copy.length << 2));
  return copy;
}

/** A candidate's clip, cut from its song into files/ under its content's name */
async function cut(c) {
  const plan = clipPlan(c);
  const tmp = path.join(BEAT, `clip-${c.song}.m4a`);
  const fadeOut = Math.max(0, plan.seconds - 1.5).toFixed(3);
  // prettier-ignore
  await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-ss", String(plan.start), "-i", path.join(FILES, c.file), "-t", String(plan.seconds), "-vn", "-af", `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5`, "-c:a", "aac", "-b:a", "64k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", "-threads", "1", tmp]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", tmp]);
  const ms = Number(stdout.trim()) * 1000;
  if (!(ms > 0)) throw new Error("ffprobe found no duration");
  const bytes = readFileSync(tmp);
  const file = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.m4a`;
  const to = path.join(FILES, file);
  if (existsSync(to)) rmSync(tmp);
  else renameSync(tmp, to);
  mine(to);
  return { c, plan, file, bytes: bytes.length, ms };
}

const took = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const started = Date.now();
if (!existsSync(CATALOG)) {
  console.error("No music/catalog.json: fetch the songs first (scripts/fetch-music.sh)");
  process.exit(1);
}
mkdirSync(BEAT, { recursive: true });
mine(BEAT);
const catalog = readCatalog(readFileSync(CATALOG, "utf8"));
const analyses = existsSync(ANALYSES) ? JSON.parse(readFileSync(ANALYSES, "utf8")) : {};
const hot = JSON.parse(readFileSync(HOT, "utf8")).names;

// ---- analyse the songs not analysed yet ----
const songs = Object.values(catalog.songs).filter((s) => s.game === "arknights" && isFileName(s.file) && existsSync(path.join(FILES, s.file)));
const long = songs.filter((s) => !(s.seconds <= MAX_S));
const todo = [...new Map(songs.filter((s) => s.seconds <= MAX_S && analyses[s.file]?.v !== ANALYSIS_V).map((s) => [s.file, s])).values()];
console.log(
  `${songs.length} songs${long.length ? ` (${long.length} longer than ${MAX_S / 60} minutes, left out)` : ""}; ${todo.length} to analyse${todo.length > limit ? `, ${limit} of them this time` : ""}`,
);
let done = 0;
const failed = [];
for (const s of todo.slice(0, limit)) {
  try {
    analyses[s.file] = { v: ANALYSIS_V, ...analyse(await samplesOf(path.join(FILES, s.file))) };
  } catch (e) {
    failed.push(`${s.name} (${e.message})`);
    continue;
  }
  done++;
  const a = analyses[s.file];
  console.log(`[${done}] ${s.name}  ${a.none ? `none: ${a.none}` : `${a.bpm} bpm, ${a.rms} ms`}`);
  if (done % 10 === 0) writeAtomic(ANALYSES, JSON.stringify(analyses));
}
if (done) writeAtomic(ANALYSES, JSON.stringify(analyses));

// ---- the candidates ----
const candidates = candidatesOf(catalog, analyses, hot);
writeAtomic(path.join(BEAT, "candidates.json"), JSON.stringify(candidates, null, 1));
const rows = candidates.map((c, i) =>
  [String(i + 1).padStart(4), c.song.padEnd(8), (c.hot ? `hot ${c.hot}` : "").padEnd(7), `${c.bpm.toFixed(1)} bpm`.padEnd(10), `${c.rms.toFixed(1)} ms`.padEnd(8), `${c.name} · ${c.album}`].join("  "),
);
writeAtomic(path.join(BEAT, "candidates.txt"), `${["   #", "song".padEnd(8), "".padEnd(7), "tempo".padEnd(10), "steady".padEnd(8), "name · album"].join("  ")}\n${rows.join("\n")}\n`);
const reasons = {};
for (const s of songs) {
  const a = analyses[s.file];
  if (a?.none) reasons[a.none] = (reasons[a.none] ?? 0) + 1;
}
const hotFound = new Set(candidates.filter((c) => c.hot).map((c) => c.hot));
console.log(
  `${candidates.length} candidates (${candidates.filter((c) => c.hot).length} of them hot); left out: ${Object.entries(reasons).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
);
// each song of the hot list that is not a candidate, and why: what its analysis came to, or not in the catalogue
const why = (name) => {
  const s = songs.find((x) => squashName(x.name) === squashName(name));
  if (!s) return "not in the catalogue";
  return s.seconds > MAX_S ? "too long" : (analyses[s.file]?.none ?? "not analysed yet");
};
const hotMissing = hot.map((name, i) => [name, i + 1]).filter(([, rank]) => !hotFound.has(rank));
if (hotMissing.length) console.log(`On the hot list but not a candidate:\n  ${hotMissing.map(([name, rank]) => `${rank} ${name} (${why(name)})`).join("\n  ")}`);

// ---- the clips ----
// cut when asked, or when there are none yet and every song has been analysed (a try with --limit cuts none)
const left = Math.max(0, todo.length - limit);
if (pick || top !== null || (!existsSync(MANIFEST) && !left)) {
  const chosen = pickClips(candidates, top ?? TOP, pick);
  const made = [];
  for (const c of chosen) {
    try {
      made.push(await cut(c));
      console.log(`clip ${made.length}: ${c.name} · ${c.album}  ${made.at(-1).file}`);
    } catch (e) {
      failed.push(`clip of ${c.name} (${e.message})`);
    }
  }
  if (made.length) {
    writeAtomic(MANIFEST, JSON.stringify(manifestOf(made)));
    console.log(`music/beat.json: ${made.length} clips, ${(made.reduce((n, m) => n + m.bytes, 0) / 1024 ** 2).toFixed(1)} MB`);
  }
} else if (!existsSync(MANIFEST)) {
  console.log(`No clips cut yet: ${left} songs are left to analyse; a run without --limit analyses them, then cuts the clips.`);
}
console.log(`Took ${took(Date.now() - started)}.`);
if (failed.length) {
  console.log(`Failed:\n  ${failed.join("\n  ")}`);
  process.exitCode = 1;
}
