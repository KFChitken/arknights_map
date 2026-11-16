/**
 * Where a song is, for 听歌's disco: from its <audio> element's currentTime alone (never Web Audio, which would keep a
 * phone from playing on with its screen locked; see listening.ts), on the song's own time even while its smaller copy
 * (省流量) plays, and as a beat of its table (src/lib/dance.ts): which beat it is at, and how far on to the next.
 */

/**
 * How much later than its element has played it a song is heard (s): from a phone's speaker a little, through a
 * Bluetooth earphone more. The picture is drawn this much behind the element, so the roaches land as the beat is heard.
 */
export const DISCO_LAG_S = 0.05;
/** Between two readings of currentTime that are the same, the clock goes on by itself for up to this long (ms) */
const CARRY_MS = 600;
/** Further than this from where the clock had got to (s): a jump (a seek, another song), not drift */
const SNAP_S = 0.25;
/** Drift is taken out over about this long (ms), so the dance never stops short or skips */
const EASE_MS = 150;
/** With no beat to go by, a slow sway: one way and back in twice this long (s) */
export const FREE_S = 1.15;

/**
 * The time to draw a song at (s, on the song's own time). Some browsers move currentTime on only now and then: while the
 * song sounds, the clock goes on with performance.now() between two readings, and drifts back to them gently. Held
 * (paused, waiting for more of the song, seeking), it is where the element is. A seek, or another song, it jumps to.
 */
export class SongClock {
  private song: string | null = null;
  private read = Number.NaN;
  private readAt = 0;
  private shown = Number.NaN;
  private shownAt = 0;

  /** t: the element's currentTime on the song's own time; rate: its playbackRate; now: performance.now() (ms) */
  at(song: string | null, t: number, rate: number, sounding: boolean, now: number): number {
    if (song !== this.song) {
      this.song = song;
      this.read = Number.NaN;
      this.shown = Number.NaN;
    }
    if (t !== this.read) {
      this.read = t;
      this.readAt = now;
    }
    const goes = sounding ? t + (Math.min(Math.max(0, now - this.readAt), CARRY_MS) / 1000) * rate : t;
    if (!sounding || Number.isNaN(this.shown)) {
      this.shown = goes;
      this.shownAt = now;
      return goes;
    }
    const dt = Math.max(0, now - this.shownAt);
    const was = this.shown + (dt / 1000) * rate;
    const off = goes - was;
    this.shown = Math.abs(off) > SNAP_S ? goes : was + off * Math.min(1, dt / EASE_MS);
    this.shownAt = now;
    return this.shown;
  }
}

/** The song's own time while its element plays a copy liteS later than it (省流量), drawn DISCO_LAG_S behind */
export const pictureTime = (currentTime: number, liteS: number) => currentTime + liteS - DISCO_LAG_S;

/**
 * Which beat a time (s) is at: i + how far on to beat i + 1, for beats (s, from the song's start, each later than the one
 * before). Before the first and after the last, it goes on at the pace of the first or last two (60 / bpm with one beat).
 */
export function beatAt(beats: Float64Array, t: number, bpm: number): number {
  const n = beats.length;
  if (!n) return Number.NaN;
  const lone = 60 / bpm;
  if (t < beats[0]) return (t - beats[0]) / (n > 1 ? beats[1] - beats[0] : lone);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (n > 1 ? beats[n - 1] - beats[n - 2] : lone);
  // the last beat at or before t
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}
