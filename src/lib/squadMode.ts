/**
 * 玩点什么 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑥): one mode at a time, opened by anyone in the room, the others told
 * and free to join or only watch (fishing, throwing, the fire and talking all go on beside it); each ends on its own,
 * after which anyone may open the next, though one who opened a mode waits MODE_AGAIN_MS after it ended before opening
 * another. The fight goes on above it, and a round starting never stops it. The server keeps it
 * (src/lib/server/squadModes.ts) and judges everything; the page draws it.
 *
 * 龙门广场舞 (dance): its opener leads, those who join dance in a row to one of 听歌's songs, to its table of beats
 * (src/lib/dance.ts): the song 卫戍的一起听 is playing, else one at random that has beats. A tap of 跳 on a beat (within
 * DANCE_WINDOW_MS of one) puts one's combo up, and the dance gets livelier (晃 → 跳 → 转圈); off the beat, back to 0.
 * The music is 听歌's (LISTEN), each muting their own; it ends with its song, or DANCE_IDLE_MS after the last tap.
 */

/** The modes there are (⑦ adds the other four) */
export const MODE_KINDS = ["dance"] as const;
export type SquadModeKind = (typeof MODE_KINDS)[number];
export const isModeKind = (v: unknown): v is SquadModeKind => typeof v === "string" && (MODE_KINDS as readonly string[]).includes(v);

/** One who opened a mode opens another this long after it ended at the soonest */
export const MODE_AGAIN_MS = 60_000;

/** 龙门广场舞: its song starts this long after it opens (time for the pages to fetch it), unless 一起听's is playing */
export const DANCE_LEAD_MS = 3_000;
/** It ends this long after the last tap anyone made */
export const DANCE_IDLE_MS = 15_000;
/** A tap within this of a beat (either side) is on it */
export const DANCE_WINDOW_MS = 150;
/**
 * A tap's own time, as the page sends it on the server's clock, is taken when it is no more than this before the
 * server's now (the way here) nor this after it; else the server's now is
 */
export const DANCE_TAP_EARLY_MS = 400;
export const DANCE_TAP_LATE_MS = 50;
/** Taps closer together than this count as one */
export const DANCE_TAP_EVERY_MS = 180;
/** From this combo the roach jumps, and from this it spins */
export const DANCE_HOP = 5;
export const DANCE_SPIN = 10;

export type DanceMove = "sway" | "hop" | "spin";
export const danceMove = (combo: number): DanceMove => (combo >= DANCE_SPIN ? "spin" : combo >= DANCE_HOP ? "hop" : "sway");

/** How far a time (ms from the song's start) is from the nearest of its beats (s from its start), in ms */
export function beatOff(beats: ArrayLike<number>, tMs: number): number {
  const n = beats.length;
  if (!n) return Number.POSITIVE_INFINITY;
  const t = tMs / 1000;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.min(Math.abs(t - beats[lo]), Math.abs(t - beats[hi])) * 1000;
}

/** When a dance ends by itself: its song over, or DANCE_IDLE_MS after its last tap, whichever comes first */
export const danceEnds = (until: number, last: number) => Math.min(until, last + DANCE_IDLE_MS);

/**
 * The mode a room is playing, as its pages have it (SquadRoom.mode): which, opened by whom (one's number) and when;
 * those in it (not only watching) with each one's combo; when it ends by itself unless something happens. 龙门广场舞:
 * its song (id and name), where its start is on the server's clock (songAt, the song's 0) and till when it plays
 */
export type SquadMode = {
  kind: SquadModeKind;
  by: number;
  at: number;
  in: { h: number; combo: number }[];
  endsAt: number;
  song: string;
  name: string;
  songAt: number;
  until: number;
};

/**
 * 龙门广场舞's song for a page (POST /api/squad/song): its table of beats always; its link (and its smaller copy's)
 * only to one 听歌 is open to (LISTEN), while it is not paused and the site not gray
 */
export type DanceSong = { song: string; dance: string; url?: string; lite?: string; now: number };
