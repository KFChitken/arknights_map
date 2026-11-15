/**
 * 听歌, what the page (src/components/app/listening.ts) and the server (src/lib/server/listen.ts, songs.ts) both go
 * by: the list of songs as the page gets it, 新歌, the next song of an album, and the limits.
 */

/** A song's id as the Monster Siren Records site gives it (its cid), and the file the fetch made of it */
export const SONG_ID = /^[0-9A-Za-z_-]{1,32}$/;
export const SONG_FILE = /^[0-9a-f]{16}\.m4a$/;
export const isSongId = (id: unknown): id is string => typeof id === "string" && SONG_ID.test(id);

/** A song in the list: artists only where they are not the list's usual ones (ListenCatalog.artists) */
export type ListenSongRow = { id: string; name: string; seconds: number; artists?: string[] };
/** An album, its songs in its own order */
export type ListenAlbum = { id: string; name: string; songs: ListenSongRow[] };
/**
 * The whole list (GET /api/listen/songs): the albums in the site's order, newest first; the artists most songs have,
 * which the songs then leave out; and 新歌, by id
 */
export type ListenCatalog = { albums: ListenAlbum[]; artists: string[]; fresh: string[] };

/** A song as the page plays it: its album and artists filled in */
export type ListenTrack = { id: string; name: string; seconds: number; artists: string[]; album: ListenAlbum };

/** What me() says of 听歌 for a player it is open to: whether the 站长 paused it for now (管理台 → 听歌) */
export type ListenMe = { paused: boolean };

/** 新歌: the songs of this many of the newest albums, at most NEW_MAX of them */
export const NEW_ALBUMS = 2;
export const NEW_MAX = 12;

/** The songs at the top of the list, from the newest albums down */
export function freshSongs(albums: readonly ListenAlbum[]): string[] {
  return albums
    .slice(0, NEW_ALBUMS)
    .flatMap((a) => a.songs.map((s) => s.id))
    .slice(0, NEW_MAX);
}

/** Each song by id, with its album and artists, and the songs in the list's order */
export function indexCatalog(c: ListenCatalog): Map<string, ListenTrack> {
  const out = new Map<string, ListenTrack>();
  for (const album of c.albums) {
    for (const s of album.songs) {
      if (!out.has(s.id)) out.set(s.id, { id: s.id, name: s.name, seconds: s.seconds, artists: s.artists ?? c.artists, album });
    }
  }
  return out;
}

/** The song after this one on its album, or null after its last */
export function nextOnAlbum(track: ListenTrack): string | null {
  const at = track.album.songs.findIndex((s) => s.id === track.id);
  return at >= 0 && at + 1 < track.album.songs.length ? track.album.songs[at + 1].id : null;
}

/** Whether a search finds the song: by its name or its album's, whatever the case or spaces */
export function songMatches(track: ListenTrack, query: string): boolean {
  const q = squash(query);
  return !q || squash(track.name).includes(q) || squash(track.album.name).includes(q);
}
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

/** m:ss, for how long a song is and how far it has got */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Someone listening (listen_now) counts until the song they play should have ended, and this much after: a player
 * whose page stopped telling (locked, closed) drops out within it
 */
export const LISTEN_GRACE_MS = 2 * 60_000;

/** Until when a song played from `at` seconds in, now, keeps its player counted as listening */
export function listeningUntil(seconds: number, at: number, now: number): number {
  const from = Number.isFinite(at) ? Math.min(Math.max(at, 0), seconds) : 0;
  return now + Math.ceil((seconds - from) * 1000) + LISTEN_GRACE_MS;
}

/** What play answers: the song's link, the next one's to fetch early, and the server's clock */
export type ListenPlay = { url: string; nextUrl?: string; until: number; now: number };

/** Why play was refused (the error's code), which the page tells apart: too many listening, paused, gray, no such song */
export const LISTEN_FULL = "LISTEN_FULL";
export const LISTEN_PAUSED = "LISTEN_PAUSED";
export const LISTEN_GRAY = "LISTEN_GRAY";
export const NO_SONG = "NO_SONG";

/** The 管理台's 听歌 (src/lib/server/siteSettings.ts): paused for now, how many may listen at once, how many to a room */
export type ListenSettings = { paused: boolean; cap: number; roomMax: number };

/** What the 管理台's 听歌 shows (src/components/admin/Site.tsx, from src/lib/server/listen.ts listenDesk) */
export type ListenDesk = {
  /** LISTEN (src/lib/server/env.ts) */
  mode: "on" | "admins" | "off";
  settings: ListenSettings;
  /** Listening now, counted now */
  listening: number;
  /** Today (Beijing time): songs played from their start, and players turned away because as many as the cap were listening */
  plays: number;
  full: number;
  /** The songs that may be played now; and the catalogue as the main process last read it in (src/lib/server/songs.ts) */
  songs: number;
  catalog: { updated: string | null; readAt: string; songs: number } | null;
};
export const LISTEN_DEFAULTS: ListenSettings = { paused: false, cap: 600, roomMax: 20 };
/** What the owner may set them to */
export const CAP_RANGE = [1, 10_000] as const;
export const ROOM_RANGE = [2, 50] as const;
