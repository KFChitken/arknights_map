/**
 * 听歌's disco: a song's table, which the server sends with the song to those it is open to (ListenPlay.dance,
 * src/lib/server/listen.ts) and scripts/beat-analysis.mjs makes (danceText): when each of the song's beats is and how
 * loud, which of them start a bar; or, for a song with no beat to dance to, how loud each second is. As JSON:
 *
 *   {"v":1,"bpm":128.4,"bar":2,"w":1,"t":"52,47,47,…","e":"3345…","lite":-23}   with beats
 *   {"v":1,"none":"tempo","s":"0123…"}                                          without
 *
 * t: each beat's time from the one before, in 10 ms (the first's from the start); e: each beat's loudness, a digit
 * (0–9); bar: which of the first four beats starts a bar (of the first three, in threes: w); lite: ms to add to where
 * the smaller copy (省流量) is played, to get where the song is; s: each second's loudness; none: why there are no
 * beats (tempo, none found; clear, not clear or steady enough; long, too many to send).
 */

/** The longest table there is (characters): a longer one would be sent as the loudness alone */
export const DANCE_MAX = 6000;

/** A song's beats, as the page dances to them */
export type DanceBeats = {
  none?: undefined;
  bpm: number;
  bar: number;
  waltz: boolean;
  /** When each beat is (s), from the start of the song, the first at least 0 and each later than the one before */
  beats: Float64Array;
  /** How loud each beat is, 0–9 */
  energy: Uint8Array;
  /** Seconds to add to where the smaller copy (省流量) is played to get where the song is */
  liteS: number;
};
/** A song with no beat to dance to: how loud each second is, 0–9 */
export type DanceNone = { none: "tempo" | "clear" | "long"; secs: Uint8Array };
export type DanceMap = DanceBeats | DanceNone;

const DIGITS = /^[0-9]*$/;
const STEP = /^[0-9]{1,6}$/;
const NONE: ReadonlySet<string> = new Set(["tempo", "clear", "long"]);
/** The most a smaller copy is ever off (ms): more, and the table is not one this reads */
const LITE_MAX = 2000;

const digitsOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) - 48);

/** A table, read; or null when it is not one this reads */
export function readDance(text: unknown): DanceMap | null {
  if (typeof text !== "string" || text.length > DANCE_MAX) return null;
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.v !== 1) return null;
  if (o.none !== undefined) {
    if (typeof o.none !== "string" || !NONE.has(o.none) || typeof o.s !== "string" || !DIGITS.test(o.s)) return null;
    return { none: o.none as DanceNone["none"], secs: digitsOf(o.s) };
  }
  const { bpm, bar, t, e } = o;
  if (o.w !== undefined && o.w !== 1) return null;
  const waltz = o.w === 1;
  if (typeof bpm !== "number" || !(bpm >= 30 && bpm <= 300)) return null;
  if (typeof bar !== "number" || !Number.isInteger(bar) || bar < 0 || bar > (waltz ? 2 : 3)) return null;
  if (typeof t !== "string" || typeof e !== "string" || !e || !DIGITS.test(e)) return null;
  const steps = t.split(",");
  if (steps.length !== e.length) return null;
  const beats = new Float64Array(steps.length);
  let at = 0;
  for (let i = 0; i < steps.length; i++) {
    if (!STEP.test(steps[i])) return null;
    const step = Number(steps[i]);
    if (i > 0 && step === 0) return null;
    at += step;
    beats[i] = at / 100;
  }
  const lite = o.lite ?? 0;
  if (typeof lite !== "number" || !Number.isInteger(lite) || Math.abs(lite) > LITE_MAX) return null;
  return { bpm, bar, waltz, beats, energy: digitsOf(e), liteS: lite / 1000 };
}
