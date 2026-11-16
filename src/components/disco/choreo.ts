import type { DanceBeats } from "@/lib/dance";

/**
 * 听歌's disco, what the roaches dance: worked out from the song's table alone, the same on every phone at the same
 * beat (no random numbers, no clocks), so those listening together dance alike. A phrase is four bars from the first
 * downbeat, and how loud its beats are on average picks its move: quiet ones sway, louder ones bob and sway by turns,
 * the loudest are climaxes, each its own of the big four in turn; the bar before a climax bangs heads. Each new move
 * comes in over a beat. In threes (a waltz) there is only swaying and bobbing.
 */

// the moves, numbered as the shaders have them (glsl.ts)
export const SWAY = 0;
export const BOB = 1;
export const JUMP = 2;
export const WAVE = 3;
export const SPIN = 4;
export const BANG = 5;
export const WILD = 6;
/** The slow sway with no beat to it: before the first downbeat, after the last beat, and for a song with no beats */
export const FREE = 7;

/** A phrase this loud or louder (its beats' average, 0–9) is a climax; under CALM_BELOW it only sways */
export const CLIMAX_FROM = 7;
export const CALM_BELOW = 4.5;
/** The free sway's size */
const FREE_AMP = 0.55;
const FREE_LEVEL = 0.3;
const CLIMAXES = [JUMP, WAVE, SPIN, WILD] as const;

type Phrase = {
  move: number;
  amp: number;
  /** How loud, 0..1 */
  level: number;
  climax: boolean;
  /** The beat of the phrase from which it bangs heads, leading into a climax (-1: it does not) */
  bang: number;
  /** A climax after what was none */
  drop: boolean;
};

/** A song's dance, worked out once from its table */
export type Plan = {
  /** Beats to a bar, and to a phrase */
  bar: number;
  per: number;
  /** The first downbeat (an index into beats): beats are counted from it */
  first: number;
  /** The last beat, counted from the first downbeat */
  end: number;
  phrases: Phrase[];
  beats: Float64Array;
  bpm: number;
};

/** What to dance now: from move a to move b (mix 0..1), how big, how loud for the lights */
export type Step = {
  a: number;
  b: number;
  mix: number;
  amp: number;
  level: number;
  /** A climax: the hoods' sleeves go up at the top of the big jumps */
  climax: boolean;
  /** The first beat of a climax after what was none: everyone hops, and the glow behind the ball flares */
  drop: boolean;
};

export const FREE_STEP: Step = { a: FREE, b: FREE, mix: 1, amp: FREE_AMP, level: FREE_LEVEL, climax: false, drop: false };

export function planOf(t: DanceBeats): Plan {
  const bar = t.waltz ? 3 : 4;
  const per = bar * 4;
  const n = t.beats.length;
  const first = Math.min(t.bar, n);
  const phrases: Phrase[] = [];
  let climaxes = 0;
  for (let from = first; from < n; from += per) {
    const to = Math.min(n, from + per);
    let sum = 0;
    for (let i = from; i < to; i++) sum += t.energy[i];
    const avg = sum / (to - from);
    const climax = avg >= CLIMAX_FROM;
    const before = phrases[phrases.length - 1];
    let move: number;
    if (avg < CALM_BELOW) move = SWAY;
    else if (climax && !t.waltz) move = CLIMAXES[climaxes++ % CLIMAXES.length];
    // in threes a climax bobs; louder than calm, bobbing and swaying by turns
    else if (climax) move = BOB;
    else move = before?.move === BOB ? SWAY : BOB;
    const level = avg / 9;
    phrases.push({ move, amp: 0.45 + 0.55 * level, level, climax, bang: -1, drop: climax && !before?.climax });
  }
  phrases.forEach((p, k) => {
    if (!t.waltz && !p.climax && phrases[k + 1]?.climax) p.bang = per - bar;
  });
  return { bar, per, first, end: n - 1 - first, phrases, beats: t.beats, bpm: t.bpm };
}

/** What a phrase ends with, for the move after it to come in from */
const endOf = (p: Phrase) => ({ move: p.bang >= 0 ? BANG : p.move, amp: p.amp, level: p.level });

/**
 * The dance at a beat counted from the first downbeat: before it (below 0, and NaN), the free sway; on from a beat past
 * the last one, the last move easing back into the free sway
 */
export function stepAt(plan: Plan, beat: number): Step {
  const { per, phrases } = plan;
  if (!phrases.length || !(beat >= 0)) return FREE_STEP;
  const over = beat - (plan.end + 1);
  if (over >= 0) {
    const last = endOf(phrases[phrases.length - 1]);
    const mix = Math.min(1, over);
    return {
      a: last.move,
      b: FREE,
      mix,
      amp: last.amp + (FREE_AMP - last.amp) * mix,
      level: last.level + (FREE_LEVEL - last.level) * mix,
      climax: false,
      drop: false,
    };
  }
  const k = Math.min(phrases.length - 1, Math.floor(beat / per));
  const p = phrases[k];
  const o = beat - k * per;
  const banging = p.bang >= 0 && o >= p.bang;
  const start = k * per + (banging ? p.bang : 0);
  const from = banging ? { move: p.move, amp: p.amp, level: p.level } : k > 0 ? endOf(phrases[k - 1]) : { move: FREE, amp: FREE_AMP, level: FREE_LEVEL };
  const mix = Math.min(1, Math.max(0, beat - start));
  return {
    a: from.move,
    b: banging ? BANG : p.move,
    mix,
    amp: from.amp + (p.amp - from.amp) * mix,
    level: from.level + (p.level - from.level) * mix,
    climax: p.climax,
    drop: p.drop && o < 1,
  };
}

/** The first downbeat of the next bar at least most of a beat away, to start dancing on all together */
export const nextBar = (plan: Plan, beat: number) => Math.max(0, Math.ceil((beat + 0.75) / plan.bar) * plan.bar);

/** 省电版's moves: bobbing and swaying only */
export const liteMove = (m: number) => (m === SWAY || m === FREE ? m : BOB);

/** The free sway's size for a song with no beats, at t (s): bigger where it is louder (its loudness each second) */
export function freeAmp(secs: Uint8Array | null, t: number): number {
  if (!secs?.length) return FREE_AMP;
  const at = Math.max(0, Math.min(secs.length - 1, t - 0.5));
  const i = Math.floor(at);
  const f = at - i;
  const v = secs[i] + ((secs[Math.min(secs.length - 1, i + 1)] ?? secs[i]) - secs[i]) * f;
  return 0.35 + 0.45 * (v / 9);
}

/**
 * A roach's own part of the dance, from its seed (a 32-bit number, roachTraits): where its picks of 群魔乱舞 start and
 * how they step (the shader works out the move for each four bars from these, in whole numbers, so every phone picks
 * alike), and its floor light's first colour
 */
export function danceTraits(seed: number): [number, number, number] {
  const s = seed >>> 0;
  return [s % 6, 1 + (Math.floor(s / 6) % 5), Math.floor(s / 30) % 6];
}

/** The move a roach dances in 群魔乱舞 in the four bars from beat: one of the first six, as the shaders pick it */
export function wildMove(traits: readonly [number, number, number], beat: number): number {
  const x = traits[0] + traits[1] * Math.floor(beat / 16);
  return x - 6 * Math.floor((x + 0.5) / 6);
}
