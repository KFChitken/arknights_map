import type { PublicProfile } from "./profile";

/**
 * 听歌, what the page (src/components/app/listening.ts) and the server (src/lib/server/listen.ts, songs.ts,
 * listenRooms.ts) both go by: the list of songs as the page gets it, 新歌, the next song of an album, the limits; and
 * 一起听's rooms: when each of a room's songs starts (roomAt), what the host's changes make of it (changeQueue), the
 * 短评, and what the server tells the room.
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

/**
 * What me() says of 听歌 for a player it is open to: whether the 站长 paused it for now (管理台 → 听歌), whether they
 * are in a room of 一起听 (the page then asks for it: a reload never takes anyone out of one), how many a room may
 * hold, and whether it is open to all or to the 站长 and admins alone (LISTEN), which is whom they may invite
 */
export type ListenMe = { paused: boolean; room: boolean; roomMax: number; mode: "admins" | "on" };

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
/** Why a room was refused: over (or the invitation ran out), full, closed to you (asked to leave, or blocking), not in one */
export const ROOM_GONE = "ROOM_GONE";
export const ROOM_FULL = "ROOM_FULL";
export const ROOM_SHUT = "ROOM_SHUT";
export const NO_ROOM = "NO_ROOM";

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
  /** Rooms of 一起听 now */
  rooms: number;
  /** The songs that may be played now; and the catalogue as the main process last read it in (src/lib/server/songs.ts) */
  songs: number;
  catalog: { updated: string | null; readAt: string; songs: number } | null;
};
export const LISTEN_DEFAULTS: ListenSettings = { paused: false, cap: 600, roomMax: 20 };
/** What the owner may set them to */
export const CAP_RANGE = [1, 10_000] as const;
export const ROOM_RANGE = [2, 50] as const;

// ---- 一起听 ----

/** A room's songs at most: the one playing and those still to come (what has played is dropped as the host changes it) */
export const QUEUE_MAX = 30;
/** Between one song of a room and the next */
export const ROOM_GAP_MS = 2_000;
/** What the host starts, skips to or starts again begins this long after, so it reaches every phone in time */
export const ROOM_LEAD_MS = 1_000;
/** An invitation holds this long */
export const INVITE_MS = 30 * 60_000;
/** A player invites the same 触须之交 this often a site day at most (src/lib/siteDay.ts), none of the day's touches */
export const INVITES_PER_DAY = 3;
/** A page gone (closed, reloaded) keeps its player's place in the room this long; a host's, the room */
export const AWAY_MS = 2 * 60_000;
/** A room whose songs are over ends this long after, unless the host adds more */
export const ROOM_IDLE_MS = 10 * 60_000;
/** Every room ends this long after it was opened */
export const ROOM_LIFE_MS = 6 * 3_600_000;
/** A room that ended, who was in it and the invitations to it, are deleted this long after */
export const ROOM_KEEP_MS = 24 * 3_600_000;
/** Each phone in a room checks it is in step this often, and every second while it is catching up */
export const SYNC_EVERY_MS = 5_000;
/**
 * How a phone keeps in step with its room: up to DRIFT_OK_S off is in step; up to DRIFT_SEEK_S it plays DRIFT_RATE
 * faster or slower until it is within DRIFT_DONE_S, which nobody hears; further off, it jumps to where the room is
 */
export const DRIFT_OK_S = 0.15;
export const DRIFT_DONE_S = 0.05;
export const DRIFT_SEEK_S = 2;
export const DRIFT_RATE = 0.03;

/** What to do about being drift seconds ahead of the room (behind, below 0), already catching up or not */
export function keepUp(drift: number, catching = false): { rate: number } | "seek" {
  if (!Number.isFinite(drift)) return { rate: 1 };
  const off = Math.abs(drift);
  if (off > DRIFT_SEEK_S) return "seek";
  if (off > DRIFT_OK_S || (catching && off > DRIFT_DONE_S)) return { rate: drift > 0 ? 1 - DRIFT_RATE : 1 + DRIFT_RATE };
  return { rate: 1 };
}

/** A room's songs; queue[idx] started at startedAt (the server's clock, ms), null until the host starts; its version */
export type RoomSchedule = { queue: string[]; idx: number; startedAt: number | null; version: number };

/** Where a room's songs are at a moment */
export type RoomAt =
  | { phase: "ready" }
  /** queue[i] starts (or started) at start, the server's clock; offset: seconds into it, below 0 until it starts */
  | { phase: "playing"; i: number; start: number; offset: number }
  /** all of them played, the last one over at end */
  | { phase: "done"; end: number };

/**
 * Where a room is at now, as the server and every phone in it work it out alike: each song from queue[idx] on starts
 * when the one before it ends and ROOM_GAP_MS more. seconds: how long a song is (one not known lasts nothing).
 */
export function roomAt(s: Pick<RoomSchedule, "queue" | "idx" | "startedAt">, seconds: (id: string) => number, now: number): RoomAt {
  if (s.startedAt === null) return { phase: "ready" };
  let start = s.startedAt;
  for (let i = Math.max(0, s.idx); i < s.queue.length; i++) {
    const len = seconds(s.queue[i]);
    const end = start + (Number.isFinite(len) && len > 0 ? len : 0) * 1000;
    if (now < end) return { phase: "playing", i, start, offset: (now - start) / 1000 };
    if (i + 1 === s.queue.length) return { phase: "done", end };
    start = end + ROOM_GAP_MS;
    if (now < start) return { phase: "playing", i: i + 1, start, offset: (now - start) / 1000 };
  }
  return { phase: "done", end: start };
}

/** What the host may do to a room's songs: start it, skip to the next, start this one again, or add one at the end */
export type QueueChange = "start" | "next" | "restart" | { add: string };
/** Why a change does nothing: no next song, the queue full (QUEUE_MAX), or nothing to change (started already) */
export type QueueRefusal = "noNext" | "full" | "same";

/**
 * The room's songs after the host's change at now. What has played is dropped first, the one playing (the last, once
 * all are over) staying first with its start, so every phone goes on as it was. A song skipped to or started again,
 * the room started, or one added when all were over, begins at now and ROOM_LEAD_MS; one added otherwise just waits
 * its turn.
 */
export function changeQueue(s: RoomSchedule, change: QueueChange, seconds: (id: string) => number, now: number): RoomSchedule | QueueRefusal {
  const at = roomAt(s, seconds, now);
  let queue = s.queue.slice(Math.max(0, s.idx));
  let startedAt = s.startedAt;
  if (at.phase === "playing") {
    queue = s.queue.slice(at.i);
    startedAt = at.start;
  } else if (at.phase === "done") {
    queue = s.queue.slice(-1);
    startedAt = null;
  }
  const lead = now + ROOM_LEAD_MS;
  const version = s.version + 1;
  if (change === "start") return at.phase === "ready" ? { queue, idx: 0, startedAt: lead, version } : "same";
  if (change === "restart") return at.phase === "ready" || !queue.length ? "same" : { queue, idx: 0, startedAt: lead, version };
  if (change === "next") return at.phase === "playing" && queue.length > 1 ? { queue: queue.slice(1), idx: 0, startedAt: lead, version } : "noNext";
  if (at.phase === "done") return { queue: [change.add], idx: 0, startedAt: lead, version };
  if (queue.length >= QUEUE_MAX) return "full";
  return { queue: [...queue, change.add], idx: 0, startedAt, version };
}

/**
 * 短评 (T.listen.rx, by number: the server knows them by their numbers alone): how many each row has, the first two for
 * any song, the third only in a room (等等我, 跟上了, 下一首！, 再来亿遍)
 */
export const RX_ROWS = [8, 7, 4] as const;
export const RX_COUNT = 19;
export const RX_ROOM_FROM = 15;
export const isRx = (r: unknown): r is number => Number.isInteger(r) && (r as number) >= 0 && (r as number) < RX_COUNT;
/** One player's 短评: one every this long at most, and this many to a song */
export const RX_EVERY_MS = 3_000;
export const RX_PER_SONG = 10;
/** A 短评 floats this long; the same one from several within RX_MERGE_MS shows once, ×N */
export const RX_SHOW_MS = 3_000;
export const RX_MERGE_MS = 2_000;

/**
 * Someone in a room, as another in it sees them: the room's own number for them (never an id), and their card as
 * anyone may see it (src/lib/server/world.ts cardsOf: 匿名舟P when it is not open)
 */
export type RoomMember = {
  h: number;
  card: PublicProfile;
  /** Their card is open (a name of their own, not 匿名舟P) */
  open: boolean;
  /** A 触须之交 of the one looking */
  friend: boolean;
  host: boolean;
  /** In it now, or left it (kicked: asked to leave, as only the host sees it) */
  state: "in" | "left" | "kicked";
};
/** Someone the host invited who is not in: waiting for an answer, or not come (said 下次吧, or the invitation ran out) */
export type RoomInvited = { card: PublicProfile; state: "waiting" | "missed" };
/** Why a room ended: the host (ended it, left, went off), nothing more to play or nobody left, the 管理台, 全站变灰 */
export type RoomEnd = "host" | "idle" | "admin" | "gray";
/** A room as someone in it sees it (POST /api/listen/room) */
export type ListenRoom = RoomSchedule & {
  id: string;
  /** How many may be in it, the host too */
  max: number;
  /** Your own number in it */
  you: number;
  /** You are its host */
  host: boolean;
  hostName: string;
  /** Its host sent 宣言一起听 for it (once a room) */
  declared: boolean;
  members: RoomMember[];
  /** The host's alone */
  invited: RoomInvited[];
  /** The server's clock, which a room's times are on */
  now: number;
};
/** What the event stream tells a room (event: listen): never anything of who */
export type ListenTell =
  | ({ t: "state"; room: string; how: "start" | "next" | "restart" | "add" } & RoomSchedule)
  | { t: "members"; room: string }
  | { t: "rx"; room: string; items: { h: number; r: number }[] }
  | { t: "end"; room: string; why: RoomEnd }
  /** To one alone: the host asked you to leave (kicked), or you are out of it by blocking its host (left) */
  | { t: "you"; room: string; why: "kicked" | "left" };

/**
 * 宣言一起听 (template listen) as one who got it sees its room, in 消息 → 宣言 and on its card on the map: open to go
 * in at (n of max in it), full, you in it, closed to you (the host asked you to leave it), or over (the room ended;
 * gone a day after)
 */
export type ListenCall = { state: "open" | "full" | "in" | "shut" | "over"; n: number; max: number };
/** A page shows the card of a 宣言一起听 that came this often at most; the rest go to 消息 alone */
export const CALL_CARD_EVERY_MS = 10 * 60_000;

/** One of your 触须之交 who may listen, to invite (id: their Friend id): how many times more today, and whether TA is in your room */
export type ListenFriend = { id: string; card: PublicProfile; left: number; inRoom: boolean };
/** How each invitation went (id: the Friend id given): sent (or TA had one, or is in), or why not */
export type InviteSent = { id: string; ok: boolean; why?: string };
