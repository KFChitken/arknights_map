import { isSongId } from "../listen";

/**
 * 325 节拍 (src/components/app/study/Beat325.tsx): a tune about 40 seconds long, made up afresh each round and played
 * in the browser (beatSound.ts), and its notes falling down a lane to a line; the player taps (anywhere, or Space) as
 * each reaches the line. A pass of 325 is a group of three notes, then two, then five, an eighth note apart within a
 * group, each note marked with its group's digit and sung mi, re or sol (numbered notation's 3, 2 and 5); the rests
 * between the groups and between the passes are dealt each round. A tap within BEAT.hitMs of a note hits it; one a
 * little further off, within BEAT.nearMs, was only early or late for it; one with no note that near, while the notes
 * are coming, is a stray, and takes a hit back. Hits less strays of at least BEAT.pass of the notes pass. A round
 * whose page is put away is void: it neither passes nor fails, and is not told.
 *
 * A round may instead be played to a clip of one of 听歌's songs (BeatSong, src/lib/server/beatClips.ts): its notes
 * then go by the song's beats, each pass starting on a bar's first beat, and nothing is sung.
 *
 * Everything here is pure but the songs this device played last (recentSongs): the chart, the tune it is sung in,
 * judging a tap, and what a round comes to. Times are ms from the tune's start, or a song's first beat.
 */

/** How it plays, all in one place: after Breeze has played it, only these change */
export const BEAT = {
  /** Beats a minute: one for the round, dealt from these, both ends in */
  bpm: [112, 120],
  /** About how long the tune is (ms): it ends two beats after its last note, by this */
  ms: 40_000,
  /** Beats at the start with no note in them */
  leadBeats: 2,
  /** Eighths of rest between the groups of a pass: fewest and most */
  groupRest: [1, 3],
  /** Beats of rest between passes: fewest and most, in the tune's second half one fewer at most */
  passRest: [2, 4],
  /** How far from a note a tap may be and hit it, and be 正好 (ms, either way) */
  hitMs: 100,
  exactMs: 45,
  /**
   * How far from a note a tap that missed it may be and be only early or late for it, not a stray (ms, either way):
   * a note tapped a little off costs it, not a hit more. As BEAT.hitMs, any tap off a note is a stray
   */
  nearMs: 200,
  /** The share of the notes that hits less strays must come to, to pass */
  pass: 0.8,
  /** Strays the result names: this many, or any that cost the pass */
  strayNote: 3,
  /** Songs this device played last, asked not to be given again while there are others: this many */
  recentSongs: 10,
  /** How long the end of a song's clip fades out, with no note in it (ms) */
  songFadeMs: 1500,
};

/** A pass's groups, in order: how many notes each has, which is the digit it is marked with */
export const BEAT_GROUPS = [3, 2, 5] as const;
export type BeatDigit = (typeof BEAT_GROUPS)[number];

/** A note: when it reaches the line (ms), its group's digit, the pass it is in (from 0), and its place in the group */
export type Note = { at: number; digit: BeatDigit; pass: number; k: number };
/**
 * A round's tune: its beats a minute, a beat (ms), which of its first four beats starts a bar (its bars are of four),
 * its notes in order, and when it ends (ms)
 */
export type Chart = { bpm: number; beat: number; bar: number; notes: Note[]; end: number };

/**
 * A clip of one of 听歌's songs to play a round to, as the server gives it (POST /api/listen/beat): its song, the
 * song's name and album, its link, a beat (ms), its first beat (ms from the clip's start), which of its first four
 * beats starts a bar, and how long it is (ms)
 */
export type BeatSong = { song: string; name: string; album: string; link: string; beat: number; first: number; bar: number; ms: number };

/**
 * A round's chart, from its random (mulberry32 of its seed): no note in the first BEAT.leadBeats beats, then passes of
 * 3, 2 and 5 notes, an eighth apart in a group, with BEAT.groupRest eighths between groups and BEAT.passRest beats
 * between passes (fewer at most in the second half), as many as end two beats before BEAT.ms. To a song's clip, at
 * its beat, each pass starts on a bar's first beat instead: the first after BEAT.leadBeats, then the first at least
 * BEAT.passRest's fewest beats after the pass before (one fewer in the second half); and they end two beats before
 * the clip starts to fade out, where that is sooner.
 */
export function beatChart(random: () => number, song?: Pick<BeatSong, "beat" | "bar" | "first" | "ms">): Chart {
  const int = (lo: number, hi: number) => lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
  const bpm = song ? 60_000 / song.beat : int(BEAT.bpm[0], BEAT.bpm[1]);
  const beat = song ? song.beat : 60_000 / bpm;
  const bar = song ? ((Math.round(song.bar) % 4) + 4) % 4 : 0;
  const eighth = beat / 2;
  const last = (song ? Math.min(BEAT.ms, song.ms - song.first - BEAT.songFadeMs) : BEAT.ms) - 2 * beat;
  /** The first eighth at or after e that starts a bar */
  const onBar = (e: number) => {
    const b = Math.ceil(e / 2);
    return 2 * (b + ((((bar - b) % 4) + 4) % 4));
  };
  const notes: Note[] = [];
  /** The eighth the next pass starts on */
  let e = song ? onBar(2 * BEAT.leadBeats) : 2 * BEAT.leadBeats;
  for (let pass = 0; ; pass++) {
    const laid: Note[] = [];
    let at = e;
    BEAT_GROUPS.forEach((digit, g) => {
      if (g) at += int(BEAT.groupRest[0], BEAT.groupRest[1]);
      for (let k = 0; k < digit; k++) laid.push({ at: at++ * eighth, digit, pass, k });
    });
    if (laid[laid.length - 1].at > last) break;
    notes.push(...laid);
    const later = laid[laid.length - 1].at > BEAT.ms / 2;
    e = song
      ? onBar(at + 2 * (BEAT.passRest[0] - (later ? 1 : 0)))
      : at + 2 * int(BEAT.passRest[0], BEAT.passRest[1] - (later ? 1 : 0));
  }
  return { bpm, beat, bar, notes, end: notes[notes.length - 1].at + 2 * beat };
}

/** What each group sings (Hz): 3 mi, 2 re, 5 sol, over the C an octave above middle C */
export const SING: Record<BeatDigit, number> = { 3: 659.26, 2: 587.33, 5: 783.99 };
/** The bass under each bar of four beats, round and round: C, A, F, G (the chords 1、6、4、5), in Hz */
export const BASS = [130.81, 110, 87.31, 98];

/** A sound of the tune: when it starts (ms), what plays it, and for the bass and the tune its pitch and length */
export type Sound =
  | { at: number; what: "lead" | "bass"; hz: number; ms: number }
  | { at: number; what: "kick" | "snare" | "crash" }
  | { at: number; what: "hat"; soft: boolean };

/**
 * The tune a chart is sung in, in order: on every beat a drum (the kick on the first and third of a bar, the snare on
 * the second and fourth), a hi-hat every eighth, the bass's root and then its octave under each bar's chord; over it
 * a note for each of the chart's; and a beat after the last of them it closes, on a kick, a crash and a low C
 */
export function beatTune(c: Chart): Sound[] {
  const eighth = c.beat / 2;
  const last = Math.round(c.notes[c.notes.length - 1].at / eighth);
  /** The beat it closes on: the first after the last note's eighth is over */
  const close = Math.ceil((last + 1) / 2);
  const out: Sound[] = [];
  for (let b = 0; b < close; b++) {
    const at = b * c.beat;
    const root = BASS[Math.floor(b / 4) % BASS.length];
    out.push(
      { at, what: b % 2 ? "snare" : "kick" },
      { at, what: "hat", soft: false },
      { at: at + eighth, what: "hat", soft: true },
      { at, what: "bass", hz: b % 2 ? 2 * root : root, ms: 0.85 * c.beat },
    );
  }
  for (const n of c.notes) out.push({ at: n.at, what: "lead", hz: SING[n.digit], ms: 0.9 * eighth });
  const at = close * c.beat;
  out.push({ at, what: "kick" }, { at, what: "crash" }, { at, what: "bass", hz: BASS[0], ms: 1.5 * c.beat });
  return out.sort((a, b) => a.at - b.at);
}

/** How the round is going: each note not hit (0), hit (1) or hit 正好 (2); and the strays */
export type Tally = { got: readonly (0 | 1 | 2)[]; strays: number };
export const tallyStart = (c: Chart): Tally => ({ got: c.notes.map(() => 0), strays: 0 });

/**
 * What a tap did: hit a note (its index), 正好 or not; missed the nearest one by a little, early or late (its index);
 * hit nothing, a stray; or came before or after the notes, nothing
 */
export type Tapped = { tally: Tally; did: "exact" | "hit" | "early" | "late" | "stray" | "off"; i: number };

/**
 * A tap at t: on the nearest note not hit yet, if within BEAT.hitMs (正好 within BEAT.exactMs); else early or late for
 * the first note not hit yet within BEAT.nearMs, so that a tap behind a note let go is late for it, not early for the
 * next; else a stray, while the notes are coming (from the first's reach to the last's); before them, in the empty
 * beats, or after, nothing
 */
export function tapAt(c: Chart, s: Tally, t: number): Tapped {
  let best = -1;
  let off = Infinity;
  let near = -1;
  for (let i = 0; i < c.notes.length; i++) {
    if (s.got[i]) continue;
    const d = Math.abs(t - c.notes[i].at);
    if (d < off) {
      best = i;
      off = d;
    }
    if (near < 0 && d <= BEAT.nearMs) near = i;
  }
  if (off > BEAT.hitMs) {
    if (near >= 0) return { tally: s, did: t < c.notes[near].at ? "early" : "late", i: near };
    const coming = t >= c.notes[0].at - BEAT.nearMs && t <= c.notes[c.notes.length - 1].at + BEAT.nearMs;
    return coming ? { tally: { got: s.got, strays: s.strays + 1 }, did: "stray", i: -1 } : { tally: s, did: "off", i: -1 };
  }
  const exact = off <= BEAT.exactMs;
  const got = s.got.slice();
  got[best] = exact ? 2 : 1;
  return { tally: { got, strays: s.strays }, did: exact ? "exact" : "hit", i: best };
}

const RECENT_KEY = "zhoup.study.beatSongs";
/** The songs this page played last, for a browser that keeps nothing (a private window) */
let held: string[] = [];

/** The songs this device played 325 节拍 to last, the latest last: BEAT.recentSongs at most */
export function recentSongs(): string[] {
  let kept: string[] = [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (Array.isArray(v)) kept = v.filter(isSongId);
  } catch {}
  return [...kept.filter((k) => !held.includes(k)), ...held].slice(-BEAT.recentSongs);
}

/** A song a round was played to on this device: not asked for again until BEAT.recentSongs others were */
export function playedSong(song: string) {
  held = [...recentSongs().filter((r) => r !== song), song].slice(-BEAT.recentSongs);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(held));
  } catch {}
}

/** Whether a note is past hitting at t, not hit */
export const missed = (c: Chart, s: Tally, i: number, t: number) => !s.got[i] && t > c.notes[i].at + BEAT.hitMs;

/** What a round came to: notes hit and all of them, strays, whether it passed, and whether the strays are named */
export type BeatResult = { hits: number; total: number; strays: number; won: boolean; strayNamed: boolean };

/** The round once the tune has played: hits less strays against BEAT.pass of the notes */
export function beatResult(c: Chart, s: Tally): BeatResult {
  const hits = s.got.filter((g) => g > 0).length;
  const total = c.notes.length;
  const won = hits - s.strays >= BEAT.pass * total;
  const cost = !won && hits >= BEAT.pass * total;
  return { hits, total, strays: s.strays, won, strayNamed: s.strays >= BEAT.strayNote || (s.strays > 0 && cost) };
}

/** How a round stopped: the tune played out, or the page was put away first; this one is void, and nothing is told */
export const roundEnd = (c: Chart, s: Tally, why: "played" | "hidden"): BeatResult | null => (why === "played" ? beatResult(c, s) : null);
