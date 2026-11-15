import "server-only";
import { and, count, eq, gt, inArray, lte } from "drizzle-orm";
import { T } from "@/i18n";
import { beijingDate } from "../beijing";
import { COUNTED } from "../dashboard";
import {
  LISTEN_FULL,
  LISTEN_GRACE_MS,
  LISTEN_GRAY,
  LISTEN_PAUSED,
  listeningUntil,
  NO_SONG,
  type ListenDesk,
  type ListenMe,
  type ListenPlay,
} from "../listen";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { listenMode } from "./env";
import { HttpError } from "./http";
import { musicLink } from "./musicLinks";
import { listenNow, siteSettings, statCounts, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { countPlay, MUSIC_KEY, songList, songOf } from "./songs";
import { countStat, unsavedStats } from "./stats";

/**
 * 听歌 on the server (src/app/api/listen/[op]), switched by LISTEN (env.ts): a song played (play) gives its link
 * (musicLinks.ts) and the next one's, and writes what the player listens to now (listen_now): one row, until the song
 * should have ended and LISTEN_GRACE_MS more, gone when they stop. How many listen at once is counted from those
 * rows, every COUNT_MS at most in each process, against the 管理台's cap (siteSettings.ts): someone listening
 * already plays on whatever the count. Nothing about who played what is kept: plays are counted by song (songs.ts)
 * and by day (stats.ts) only. The main process sweeps away the rows that are past (sweepListening).
 */

/** How long a process goes by the count of listeners it last read */
const COUNT_MS = 10_000;

type Tally = { n: number; at: number; asking: Promise<number> | null };
const g = globalThis as unknown as { listenTally?: Tally };
const tally = (g.listenTally ??= { n: 0, at: -Infinity, asking: null });

/** Whether this player may listen: everyone (on), the 站长 and the admins (admins), or nobody (off) */
export function listenOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = listenMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/** What me() carries for the way in: undefined when the player may not listen */
export function listenMe(user: Pick<UserRow, "id" | "email">): ListenMe | undefined {
  return listenOpen(user) ? { paused: listenSettings().paused } : undefined;
}

/** Whether songs may go out now at all (/api/listen/ok): LISTEN not off, and not paused in the 管理台 */
export const songsGoOut = () => listenMode() !== "off" && !listenSettings().paused;

/** How many are listening now (rows not past), as this process last read it: at most COUNT_MS old */
export function listeningCount(now = Date.now()): Promise<number> {
  if (now - tally.at < COUNT_MS) return Promise.resolve(tally.n);
  tally.asking ??= (async () => {
    try {
      const [r] = await db.select({ n: count() }).from(listenNow).where(gt(listenNow.until, new Date(now)));
      tally.n = r.n;
      tally.at = now;
      return r.n;
    } finally {
      tally.asking = null;
    }
  })();
  return tally.asking;
}

/** For the tests: read the count afresh next time */
export function forgetListeningCount() {
  tally.n = 0;
  tally.at = -Infinity;
}

/**
 * A song played by the player, from `at` seconds in (0: from the start, which alone counts as a play), with the next
 * one's link too when asked for. Refused while the site is gray, while 听歌 is paused, and to a player who is not
 * listening yet when as many as the cap are.
 */
export async function playSong(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<ListenPlay> {
  if (grayUntil(now)) throw new HttpError(403, T.server.listen.gray, LISTEN_GRAY);
  const settings = listenSettings();
  if (settings.paused) throw new HttpError(503, T.server.listen.paused, LISTEN_PAUSED);
  const song = await songOf(body.song);
  if (!song) throw new HttpError(404, T.server.listen.noSong, NO_SONG);
  const at = typeof body.at === "number" && body.at > 0 ? Math.min(body.at, song.seconds) : 0;
  const until = listeningUntil(song.seconds, at, now);
  const [mine] = await db.select({ until: listenNow.until }).from(listenNow).where(eq(listenNow.userId, user.id));
  const listening = Boolean(mine && mine.until.getTime() > now);
  if (!listening && (await listeningCount(now)) >= settings.cap) {
    countStat(COUNTED.listenFull, 1, now);
    throw new HttpError(503, T.server.listen.full, LISTEN_FULL);
  }
  await db
    .insert(listenNow)
    .values({ userId: user.id, song: song.id, roomId: null, until: new Date(until) })
    .onConflictDoUpdate({ target: listenNow.userId, set: { song: song.id, roomId: null, until: new Date(until) } });
  // this process's count takes them in at once, so a crowd within COUNT_MS goes over the cap by less
  if (!listening) tally.n += 1;
  if (at === 0) {
    countPlay(song.id);
    countStat(COUNTED.listenPlay, 1, now);
  }
  const next = body.next === undefined ? undefined : await songOf(body.next);
  return { url: musicLink(song.file, now), ...(next ? { nextUrl: musicLink(next.file, now) } : {}), until, now };
}

/**
 * The player stopped: no longer listening. away: the page is going (closed, reloaded), so they stay counted
 * LISTEN_GRACE_MS more at most, for a page that comes straight back to go on.
 */
export async function stopSong(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<{ now: number }> {
  if (body.away === true) {
    const soon = new Date(now + LISTEN_GRACE_MS);
    await db
      .update(listenNow)
      .set({ until: soon })
      .where(and(eq(listenNow.userId, user.id), gt(listenNow.until, soon)));
  } else {
    const gone = await db.delete(listenNow).where(eq(listenNow.userId, user.id)).returning({ until: listenNow.until });
    if (gone.some((r) => r.until.getTime() > now) && tally.n > 0) tally.n -= 1;
  }
  return { now };
}

/** Rows that are past, swept away (the main process, every minute). Says how many went. */
export async function sweepListening(now = Date.now()): Promise<number> {
  const gone = await db.delete(listenNow).where(lte(listenNow.until, new Date(now))).returning({ userId: listenNow.userId });
  return gone.length;
}

/** What the 管理台's 听歌 shows: how it goes now, read afresh */
export async function listenDesk(now = Date.now()): Promise<ListenDesk> {
  const day = beijingDate(now);
  const names = [COUNTED.listenPlay, COUNTED.listenFull];
  const [[{ n: listening }], counted, [music], list] = await Promise.all([
    db.select({ n: count() }).from(listenNow).where(gt(listenNow.until, new Date(now))),
    db
      .select({ name: statCounts.name, n: statCounts.n })
      .from(statCounts)
      .where(and(eq(statCounts.day, day), inArray(statCounts.name, names))),
    db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, MUSIC_KEY)),
    songList(),
  ]);
  // what this process counted and has not saved yet goes on top (another process's shows within a minute)
  const unsaved = unsavedStats();
  const today = (name: string) => Number(counted.find((r) => r.name === name)?.n ?? 0) + (unsaved.get(`${day}|${name}`) ?? 0);
  const v = music?.value as { updated?: unknown; readAt?: unknown; songs?: unknown } | undefined;
  return {
    mode: listenMode(),
    settings: listenSettings(),
    listening,
    plays: today(COUNTED.listenPlay),
    full: today(COUNTED.listenFull),
    songs: list.byId.size,
    catalog:
      v && typeof v.readAt === "string"
        ? { updated: typeof v.updated === "string" ? v.updated : null, readAt: v.readAt, songs: Number(v.songs) || 0 }
        : null,
  };
}
