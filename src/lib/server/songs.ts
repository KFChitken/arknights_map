import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
import { freshSongs, isSongId, SAID_MIN, SAID_TOP, SONG_FILE, type ListenAlbum, type ListenCatalog, type SongSaid } from "../listen";
import { db } from "./db";
import { MUSIC_DIR } from "./env";
import { onReload, reloadEverywhere } from "./live";
import { siteSettings, songPlays, songReactions, songs } from "./schema";
import { errorCode, logError, note } from "./signals";

/**
 * 听歌's songs. The main process reads the catalogue the fetch writes (scripts/fetch-msr-music.mjs) into the songs
 * table when it changes (syncCatalog, at start and every 10 minutes): only the songs whose file is there, the rest
 * kept with gone_at. Every process keeps the list in memory (loadSongs), read again when the main says (reload
 * "songs") and every 10 minutes anyway, with what the page gets of it, its ETag and each song's file. A catalogue
 * that cannot be read changes nothing: the list stays as it was, or empty if there never was one. How often each
 * song is played is counted in memory and added to song_plays once a minute (saveSongPlays), with nothing of who; so
 * are the 短评 said to each by those listening alone, into song_reactions (saveSongReactions), whose most said make
 * 大家都在说 under it (songSaid). It lives on globalThis because Next.js can load this module once per route bundle.
 */

/**
 * A song the server plays: its file, its smaller copy for a slow line (省流量; null: none yet), how long it is, and its
 * album's name for the lock screen
 */
export type HeldSong = {
  id: string;
  name: string;
  seconds: number;
  file: string;
  lite: string | null;
  albumId: string;
  album: string;
  artists: string[];
};
type Held = {
  list: { catalog: ListenCatalog; json: string; etag: string; byId: Map<string, HeldSong> } | null;
  loading: Promise<void> | null;
  /** Asked again while reading: read once more after, so a change made meanwhile is not missed */
  again: boolean;
  started: boolean;
  /** The catalogue and the files' folder as last read in (a good one), and as last found bad */
  synced: string | null;
  bad: string | null;
  plays: Map<string, number>;
  /** 短评 said to a song by those listening alone, by `${song}#${number}`, since they were last saved */
  said: Map<string, number>;
  /** 大家都在说 as last read for each song, and when */
  saidRead: Map<string, { at: number; top: SongSaid[] }>;
};
const g = globalThis as unknown as { songsHeld?: Held };
const held = (g.songsHeld ??= {
  list: null,
  loading: null,
  again: false,
  started: false,
  synced: null,
  bad: null,
  plays: new Map(),
  said: new Map(),
  saidRead: new Map(),
});
// one held from before these were counted (a process that read this module again as it changed)
held.said ??= new Map();
held.saidRead ??= new Map();

const RELOAD_MS = 10 * 60_000;
/** site_settings' row for what the main process last read in (never a setting: only the 管理台 reads it) */
export const MUSIC_KEY = "music";
/** The catalogue's version this reads (scripts/msr-music.mjs CATALOG_VERSION) */
const CATALOG_V = 1;

// ---- the catalogue, into the database (the main process) ----

type Row = typeof songs.$inferInsert;

/**
 * The songs of a catalogue's text whose file is among those present, in the site's order: each album's place, each
 * song's on it; with its smaller copy (lite, scripts/make-lite-music.mjs) where that is present too. Throws when it is
 * not a catalogue this reads; a song that makes no sense is left out.
 */
export function catalogRows(text: string, present: ReadonlySet<string>): Row[] {
  const c = JSON.parse(text) as { v?: unknown; albums?: unknown; songs?: unknown };
  if (!c || c.v !== CATALOG_V || !Array.isArray(c.albums) || !c.songs || typeof c.songs !== "object") {
    throw new Error("not a catalogue this reads (v1)");
  }
  const all = c.songs as Record<string, unknown>;
  const rows: Row[] = [];
  const seen = new Set<string>();
  c.albums.forEach((a: unknown, order: number) => {
    const album = a && typeof a === "object" ? (a as { id?: unknown; name?: unknown; songs?: unknown }) : {};
    if (!isSongId(album.id) || typeof album.name !== "string" || !album.name.trim() || !Array.isArray(album.songs)) return;
    let track = 0;
    for (const id of album.songs) {
      if (!isSongId(id) || seen.has(id) || !Object.hasOwn(all, id)) continue;
      const s = all[id] as Record<string, unknown> | null;
      if (!s || typeof s !== "object") continue;
      const name = typeof s.name === "string" ? s.name.trim() : "";
      const seconds = Number(s.seconds);
      const bytes = Number(s.bytes);
      const added = Date.parse(String(s.added));
      const file = String(s.file);
      if (!name || s.game !== "arknights" || !SONG_FILE.test(file) || !present.has(file)) continue;
      const lite = typeof s.lite === "string" && SONG_FILE.test(s.lite) && present.has(s.lite) ? s.lite : null;
      if (!(seconds > 0 && seconds < 24 * 3600) || !Number.isInteger(bytes) || bytes <= 0 || !Number.isFinite(added)) continue;
      const artists = Array.isArray(s.artists) ? s.artists.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : [];
      seen.add(id);
      rows.push({
        id,
        game: "arknights",
        name,
        albumId: album.id,
        album: album.name.trim(),
        artists,
        seconds: Math.round(seconds * 100) / 100,
        file,
        bytes,
        liteFile: lite,
        albumOrder: order,
        track: track++,
        addedAt: new Date(added),
        goneAt: null,
      });
    }
  });
  return rows;
}

/** The songs as they are now, into the table: the others kept, gone since now */
async function writeSongs(rows: Row[], now: number) {
  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(songs)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: songs.id,
          set: {
            game: sql`excluded.game`,
            name: sql`excluded.name`,
            albumId: sql`excluded.album_id`,
            album: sql`excluded.album`,
            artists: sql`excluded.artists`,
            seconds: sql`excluded.seconds`,
            file: sql`excluded.file`,
            bytes: sql`excluded.bytes`,
            liteFile: sql`excluded.lite_file`,
            albumOrder: sql`excluded.album_order`,
            track: sql`excluded.track`,
            addedAt: sql`excluded.added_at`,
            goneAt: null,
          },
        });
    }
    const ids = rows.map((r) => r.id);
    await tx
      .update(songs)
      .set({ goneAt: new Date(now) })
      .where(ids.length ? and(isNull(songs.goneAt), notInArray(songs.id, ids)) : isNull(songs.goneAt));
  });
}

/**
 * Read the catalogue in, if it or the files changed since last time. Says what came of it: same, updated, missing
 * (no catalogue yet: nothing changes) or bad (one that cannot be read: nothing changes, and it is not tried again
 * until it changes). Each process is told to read the list again when it changed.
 */
export async function syncCatalog(dir = MUSIC_DIR, now = Date.now()): Promise<"same" | "updated" | "missing" | "bad"> {
  const file = path.join(dir, "catalog.json");
  const files = path.join(dir, "files");
  const [c, f] = await Promise.all([stat(file).catch(() => null), stat(files).catch(() => null)]);
  if (!c?.isFile()) return "missing";
  const stamp = `${c.mtimeMs}:${c.size}:${f?.mtimeMs ?? 0}`;
  if (stamp === held.synced) return "same";
  if (stamp === held.bad) return "bad";
  let rows: Row[];
  let updated: string | null = null;
  try {
    const text = await readFile(file, "utf8");
    rows = catalogRows(text, new Set(await readdir(files).catch(() => [])));
    const u = (JSON.parse(text) as { updated?: unknown }).updated;
    updated = typeof u === "string" && Number.isFinite(Date.parse(u)) ? u : null;
  } catch (e) {
    held.bad = stamp;
    logError("songs: the catalogue could not be read, so the list stays as it was", e);
    // once for each catalogue found bad, for the site's own checks (src/lib/server/watch.ts)
    note("job", "songs");
    return "bad";
  }
  await writeSongs(rows, now);
  // for the 管理台's 听歌: when the fetch last ran, and when this read it in
  const value = { updated, readAt: new Date(now).toISOString(), songs: rows.length };
  await db
    .insert(siteSettings)
    .values({ key: MUSIC_KEY, value, updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: new Date(now) } });
  held.synced = stamp;
  held.bad = null;
  await reloadEverywhere("songs");
  return "updated";
}

/** For the tests: read the catalogue in next time whatever it was */
export function forgetSynced() {
  held.synced = null;
  held.bad = null;
}

// ---- the list, in memory (every process) ----

/** Read the list again. Asked again meanwhile, the reading under way reads once more before it answers both. */
export function loadSongs(): Promise<void> {
  if (held.loading) {
    held.again = true;
    return held.loading;
  }
  const loading = (async () => {
    try {
      do {
        held.again = false;
        const rows = await db
          .select({
            id: songs.id,
            name: songs.name,
            seconds: songs.seconds,
            file: songs.file,
            lite: songs.liteFile,
            albumId: songs.albumId,
            album: songs.album,
            artists: songs.artists,
          })
          .from(songs)
          .where(isNull(songs.goneAt))
          .orderBy(songs.albumOrder, songs.track);
        held.list = listOf(rows);
      } while (held.again);
    } finally {
      held.loading = null;
    }
  })();
  held.loading = loading;
  return loading;
}

onReload("songs", loadSongs);

function listOf(rows: HeldSong[]) {
  // the artists most songs have go once, for the whole list
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(JSON.stringify(r.artists), (tally.get(JSON.stringify(r.artists)) ?? 0) + 1);
  const usual = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "[]";
  const albums: ListenAlbum[] = [];
  const byId = new Map<string, HeldSong>();
  for (const r of rows) {
    let album = albums.at(-1);
    if (album?.id !== r.albumId) albums.push((album = { id: r.albumId, name: r.album, songs: [] }));
    const own = JSON.stringify(r.artists);
    album.songs.push(own === usual ? { id: r.id, name: r.name, seconds: r.seconds } : { id: r.id, name: r.name, seconds: r.seconds, artists: r.artists });
    byId.set(r.id, r);
  }
  const catalog: ListenCatalog = {
    albums,
    artists: JSON.parse(usual) as string[],
    fresh: freshSongs(albums),
    // the panel offers 省流量 once there are smaller copies to play
    ...(rows.some((r) => r.lite) ? { lite: true as const } : {}),
  };
  const json = JSON.stringify(catalog);
  return { catalog, json, etag: `"${createHash("sha256").update(json).digest("base64url").slice(0, 16)}"`, byId };
}

/** At the start of every process (src/instrumentation-node.ts). Never throws: until it can be read, there are no songs. */
export async function startSongs() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadSongs().catch((e) => console.error("songs: reading the list again failed", errorCode(e))), RELOAD_MS).unref();
  await loadSongs().catch((e) => console.error("songs: reading the list failed, so there are no songs for now", errorCode(e)));
}

/** The list as the page gets it, its JSON and ETag: read now if it never was (a process that started without it) */
export async function songList() {
  if (!held.list) await loadSongs();
  return held.list!;
}

/** A song that may be played now, or undefined */
export async function songOf(id: unknown): Promise<HeldSong | undefined> {
  return isSongId(id) ? (await songList()).byId.get(id) : undefined;
}

/** The first of 新歌, else of the whole list: what a room opened with no song named starts with */
export async function firstSong(): Promise<HeldSong | undefined> {
  const { catalog, byId } = await songList();
  const id = catalog.fresh[0] ?? catalog.albums[0]?.songs[0]?.id;
  return id ? byId.get(id) : undefined;
}

// ---- how often each was played ----

/** One more play of a song */
export function countPlay(id: string) {
  held.plays.set(id, (held.plays.get(id) ?? 0) + 1);
}

/** What was counted since last time, added to song_plays in one statement; kept for next time when that fails */
export async function saveSongPlays() {
  const taken = held.plays;
  if (!taken.size) return;
  held.plays = new Map();
  try {
    await db
      .insert(songPlays)
      .values([...taken].map(([song, plays]) => ({ song, plays })))
      .onConflictDoUpdate({ target: songPlays.song, set: { plays: sql`${songPlays.plays} + excluded.plays` } });
  } catch (e) {
    for (const [song, n] of taken) held.plays.set(song, (held.plays.get(song) ?? 0) + n);
    throw e;
  }
}

// ---- 大家都在说: the 短评 said to each song by those listening alone ----

/** How long 大家都在说 is read once for each song, and for how many songs at most it is kept */
const SAID_READ_MS = 60_000;
const SAID_READ_MAX = 5_000;

/** One more 短评 (by its number) said to a song by someone listening alone */
export function countSaid(song: string, r: number) {
  const key = `${song}#${r}`;
  held.said.set(key, (held.said.get(key) ?? 0) + 1);
}

/** What was counted since last time, added to song_reactions in one statement; kept for next time when that fails */
export async function saveSongReactions() {
  const taken = held.said;
  if (!taken.size) return;
  held.said = new Map();
  try {
    await db
      .insert(songReactions)
      .values(
        [...taken].map(([key, n]) => {
          const at = key.lastIndexOf("#");
          return { song: key.slice(0, at), phrase: Number(key.slice(at + 1)), n };
        }),
      )
      .onConflictDoUpdate({ target: [songReactions.song, songReactions.phrase], set: { n: sql`${songReactions.n} + excluded.n` } });
  } catch (e) {
    for (const [key, n] of taken) held.said.set(key, (held.said.get(key) ?? 0) + n);
    throw e;
  }
}

/** 大家都在说 under a song: its SAID_TOP 短评 said more than SAID_MIN times, most first; read once a minute at most */
export async function songSaid(song: string, now = Date.now()): Promise<SongSaid[]> {
  const kept = held.saidRead.get(song);
  if (kept && now - kept.at < SAID_READ_MS) return kept.top;
  const top = await db
    .select({ r: songReactions.phrase, n: songReactions.n })
    .from(songReactions)
    .where(and(eq(songReactions.song, song), gt(songReactions.n, SAID_MIN)))
    .orderBy(desc(songReactions.n), asc(songReactions.phrase))
    .limit(SAID_TOP);
  if (held.saidRead.size >= SAID_READ_MAX) held.saidRead.clear();
  held.saidRead.set(song, { at: now, top });
  return top;
}

/** For the tests: 大家都在说 read afresh next time */
export function forgetSaid() {
  held.saidRead.clear();
}
