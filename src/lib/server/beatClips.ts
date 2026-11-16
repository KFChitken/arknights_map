import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { isSongId, SONG_FILE } from "../listen";
import type { BeatSong } from "../study/beat325";
import { db } from "./db";
import { MUSIC_DIR } from "./env";
import { onReload, reloadEverywhere } from "./live";
import { musicLink } from "./musicLinks";
import { siteSettings, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { songOf } from "./songs";
import { logError } from "./signals";

/**
 * 325 节拍's clips of 听歌's songs (scripts/beat-music.mjs cuts them, and lists them in music/beat.json): the main
 * process reads the list into site_settings when it changes (syncBeatClips, at start and every 10 minutes, with the
 * catalogue), and every process keeps it in memory (loadBeatClips), read again when the main says (reload "beat")
 * and every 10 minutes anyway. A clip goes out as a song does, at a link of musicLinks.ts, checked by /api/listen/ok,
 * so pausing 听歌 or LISTEN=off stops the clips too; it is not counted as listening. A list that cannot be read
 * changes nothing. It lives on globalThis because Next.js can load this module once per route bundle.
 */

/** A clip as the list has it: its song, its file, ms between two beats, ms to its first, which of its first four starts a bar, its length (ms) */
export type BeatClip = { song: string; file: string; beat: number; first: number; bar: number; ms: number };

type Held = { clips: BeatClip[] | null; loading: Promise<void> | null; started: boolean; synced: string | null; bad: string | null };
const g = globalThis as unknown as { beatClipsHeld?: Held };
const held = (g.beatClipsHeld ??= { clips: null, loading: null, started: false, synced: null, bad: null });

/** site_settings' row for the list (never a setting: the main process writes it) */
export const BEAT_KEY = "beat";
const RELOAD_MS = 10 * 60_000;
/** Clips kept at most, and songs a player may ask not to be given again */
const MAX_CLIPS = 200;
const NOT_MAX = 20;

/**
 * The clips of a list's text whose file is among those present, in its order; a clip that makes no sense is left out
 * (a beat of 100 to 135 a minute, a first beat in its first five seconds, 30 seconds to a minute long). Throws when
 * it is not a list this reads.
 */
export function beatClipsOf(text: string, present: ReadonlySet<string>): BeatClip[] {
  const m = JSON.parse(text) as { v?: unknown; clips?: unknown };
  if (!m || m.v !== 1 || !Array.isArray(m.clips)) throw new Error("not a list of clips this reads (v1)");
  const out: BeatClip[] = [];
  const seen = new Set<string>();
  for (const c of m.clips as Record<string, unknown>[]) {
    if (!c || typeof c !== "object") continue;
    const { song, file } = c;
    const beat = Number(c.beat);
    const first = Number(c.first);
    const bar = Number(c.bar);
    const ms = Number(c.ms);
    if (!isSongId(song) || seen.has(song) || typeof file !== "string" || !SONG_FILE.test(file) || !present.has(file)) continue;
    if (!(beat >= 60_000 / 135 - 1 && beat <= 60_000 / 100 + 1) || !(first >= 0 && first <= 5000)) continue;
    if (!Number.isInteger(bar) || bar < 0 || bar > 3 || !(ms >= 30_000 && ms <= 60_000)) continue;
    seen.add(song);
    out.push({ song, file, beat, first, bar, ms });
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}

/**
 * Read the list in (the main process), if it or the files changed since last time: same, updated, missing (no list:
 * nothing changes) or bad (one that cannot be read: nothing changes, and it is not tried again until it changes).
 * Each process is told to read it again when it changed.
 */
export async function syncBeatClips(dir = MUSIC_DIR, now = Date.now()): Promise<"same" | "updated" | "missing" | "bad"> {
  const file = path.join(dir, "beat.json");
  const files = path.join(dir, "files");
  const [c, f] = await Promise.all([stat(file).catch(() => null), stat(files).catch(() => null)]);
  if (!c?.isFile()) return "missing";
  const stamp = `${c.mtimeMs}:${c.size}:${f?.mtimeMs ?? 0}`;
  if (stamp === held.synced) return "same";
  if (stamp === held.bad) return "bad";
  let clips: BeatClip[];
  try {
    clips = beatClipsOf(await readFile(file, "utf8"), new Set(await readdir(files).catch(() => [])));
  } catch (e) {
    held.bad = stamp;
    logError("beat: the list of clips could not be read, so it stays as it was", e);
    return "bad";
  }
  const value = { clips, readAt: new Date(now).toISOString() };
  await db
    .insert(siteSettings)
    .values({ key: BEAT_KEY, value, updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: new Date(now) } });
  held.synced = stamp;
  held.bad = null;
  await reloadEverywhere("beat");
  return "updated";
}

/** For the tests: read the list in next time whatever it was */
export function forgetBeatSynced() {
  held.synced = null;
  held.bad = null;
}

/** Read the list again (every process): none, if there is no row or it is not a list */
export function loadBeatClips(): Promise<void> {
  held.loading ??= (async () => {
    try {
      const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, BEAT_KEY));
      const clips = (row?.value as { clips?: unknown } | undefined)?.clips;
      held.clips = Array.isArray(clips) ? (clips as BeatClip[]) : [];
    } finally {
      held.loading = null;
    }
  })();
  return held.loading;
}

onReload("beat", loadBeatClips);

/** At the start of every process (src/instrumentation-node.ts). Never throws: until it can be read, there are no clips. */
export async function startBeatClips() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadBeatClips().catch((e) => logError("beat: reading the clips again failed", e)), RELOAD_MS).unref();
  await loadBeatClips().catch((e) => logError("beat: reading the clips failed, so there are none for now", e));
}

/**
 * A clip for a round of 325 节拍 (POST /api/listen/beat {not?}), at random, of a song not among those named (the
 * last played on the player's device) where another is left: its song's name and album, its link, and its beats.
 * None while the site is gray or 听歌 is paused, or when there are no clips.
 */
export async function beatClip(_user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<{ clip: BeatSong | null; now: number }> {
  if (grayUntil(now) || listenSettings().paused) return { clip: null, now };
  if (!held.clips) await loadBeatClips();
  const not = new Set(Array.isArray(body.not) ? body.not.filter(isSongId).slice(0, NOT_MAX) : []);
  const playable: { c: BeatClip; name: string; album: string }[] = [];
  for (const c of held.clips ?? []) {
    const s = await songOf(c.song);
    if (s) playable.push({ c, name: s.name, album: s.album });
  }
  const fresh = playable.filter((p) => !not.has(p.c.song));
  const from = fresh.length ? fresh : playable;
  if (!from.length) return { clip: null, now };
  const { c, name, album } = from[Math.floor(Math.random() * from.length)];
  return { clip: { song: c.song, name, album, link: musicLink(c.file, now), beat: c.beat, first: c.first, bar: c.bar, ms: c.ms }, now };
}
