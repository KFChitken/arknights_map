import { describe, expect, it } from "vitest";
import {
  analyse,
  barOf,
  DANCE,
  danceOf,
  danceText,
  features,
  FPS,
  levelsOf,
  RULES,
  shiftOf,
  SR,
  type Dance,
} from "../../scripts/beat-analysis.mjs";
import { DANCE_MAX, readDance, type DanceBeats } from "./dance";

// The disco's tables (scripts/beat-analysis.mjs danceOf, danceText; src/lib/dance.ts readDance), without the files:
// songs made up here at a known tempo, with a kick, a snare, hats on the beats and between them, a bass line, chords
// that change on each bar's first beat, and now and then a note of their own

/** Numbers that look random, the same each time (mulberry32) */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Made = { bpm?: number; seconds?: number; start?: number; meter?: 3 | 4; drums?: boolean; eighths?: boolean; jitterMs?: number; seed?: number };

/** A made-up song's samples at SR, and when its beats are (s): the first starts a bar */
function track({ bpm = 120, seconds = 60, start = 1, meter = 4, drums = true, eighths = true, jitterMs = 0, seed = 1 }: Made = {}) {
  const rnd = random(seed);
  const y = new Float32Array(Math.round(SR * seconds));
  const add = (t: number, f: Float32Array, gain = 1) => {
    const at = Math.round(t * SR);
    for (let i = 0; i < f.length && at + i < y.length; i++) if (at + i >= 0) y[at + i] += f[i] * gain;
  };
  const make = (len: number, fn: (t: number) => number) => Float32Array.from({ length: Math.round(len * SR) }, (_, i) => fn(i / SR));
  const kick = make(0.25, (t) => Math.sin(2 * Math.PI * (50 * t + (80 / 30) * (1 - Math.exp(-30 * t)))) * Math.exp(-12 * t) * 0.9);
  const snare = make(0.2, (t) => (rnd() * 2 - 1) * Math.exp(-25 * t) * 0.4 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-30 * t) * 0.2);
  const hat = make(0.05, (t) => (rnd() * 2 - 1) * Math.exp(-90 * t) * 0.12);
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let b = 0; start + b * period < seconds - 1.5; b++) {
    const on = start + b * period;
    const t = on + (jitterMs ? ((rnd() * 2 - 1) * jitterMs) / 1000 : 0);
    const inBar = b % meter;
    if (drums) {
      beats.push(t);
      if (meter === 3 ? inBar === 0 : inBar % 2 === 0) add(t, kick);
      if (meter === 4 && inBar % 2 === 1) add(t, snare);
      add(t, hat, 0.8 + rnd() * 0.4);
      if (eighths) add(t + period / 2, hat, 0.5);
      add(t, make(period * 0.9, (u) => Math.sin(2 * Math.PI * [65.4, 55, 43.65, 49][Math.floor(b / meter) % 4] * u) * 0.15 * Math.min(1, u * 100) * Math.exp(-u * 2)));
    }
    if (inBar === 0) {
      const c = chords[Math.floor(b / meter) % 4];
      add(on, make(period * meter, (u) => c.reduce((a, f) => a + Math.sin(2 * Math.PI * f * u), 0) * 0.04 * Math.min(1, u * (drums ? 50 : 3)) * Math.exp(-u * 0.3)));
    }
    if (rnd() < 0.35) {
      const f0 = 300 + rnd() * 300;
      add(on + rnd() * period, make(0.3 + rnd() * 0.5, (u) => (Math.sin(2 * Math.PI * f0 * u) + 0.5 * Math.sin(4 * Math.PI * f0 * u)) * 0.05 * Math.min(1, u * 20) * Math.exp(-u * 2)));
    }
  }
  for (let i = 0; i < y.length; i++) y[i] += (rnd() * 2 - 1) * 0.002;
  return { samples: y, beats };
}

/** How far each made-up beat is from the nearest beat found (s), and the place of the one nearest the first */
function against(found: ArrayLike<number>, beats: number[]) {
  const near = (t: number) => {
    let k = 0;
    for (let i = 1; i < found.length; i++) if (Math.abs(found[i] - t) < Math.abs(found[k] - t)) k = i;
    return k;
  };
  const off = beats.map((t) => Math.abs(found[near(t)] - t));
  return { mean: off.reduce((a, b) => a + b, 0) / off.length, most: Math.max(...off), first: near(beats[0]) };
}

const LONG = 60_000;

describe("a whole song's beats, for the disco", () => {
  it("are found at 90, 120 and 150 beats a minute, each within a few ms, with the bar they start", { timeout: LONG }, () => {
    for (const [bpm, start, jitterMs] of [
      [90, 1, 0],
      [120, 0.73, 0],
      [150, 1.2, 0],
      [120, 1, 8],
    ] as const) {
      const made = track({ bpm, start, jitterMs, seed: bpm + jitterMs });
      const d = danceOf(made.samples);
      expect(d.none, `${bpm}`).toBeUndefined();
      if (d.none) continue;
      expect(d.bpm).toBeCloseTo(bpm, 0);
      const { mean, most, first } = against(d.beats, made.beats);
      expect(mean * 1000, `${bpm}`).toBeLessThan(15);
      expect(most * 1000, `${bpm}`).toBeLessThan(20);
      // the made-up first beat starts a bar
      expect(d.bar, `${bpm}`).toBe(first % 4);
      expect(d.waltz).toBe(false);
      expect(d.energy).toHaveLength(d.beats.length);
    }
  });

  it("goes in threes for a waltz, with the bar of three", { timeout: LONG }, () => {
    const made = track({ meter: 3, bpm: 120, seed: 3 });
    const d = danceOf(made.samples);
    expect(d.none).toBeUndefined();
    if (d.none) return;
    expect(d.waltz).toBe(true);
    expect(d.bar).toBe(against(d.beats, made.beats).first % 3);
    expect(JSON.parse(danceText(d))).toMatchObject({ w: 1, bar: d.bar });
  });

  it("keeps the last beat of four minutes as near as the first, as the page reads the table", { timeout: LONG }, () => {
    const made = track({ bpm: 123.4, seconds: 240, start: 1.11, seed: 9 });
    const d = danceOf(made.samples);
    expect(d.none).toBeUndefined();
    if (d.none) return;
    const text = danceText(d);
    expect(text.length).toBeLessThan(DANCE.maxChars);
    const read = readDance(text) as DanceBeats;
    expect(read.beats).toHaveLength(d.beats.length);
    // each beat's time is rounded where it is, never the rounding of all those before it added up
    for (let i = 0; i < d.beats.length; i++) expect(Math.abs(read.beats[i] - d.beats[i])).toBeLessThanOrEqual(0.005 + 1e-9);
    const last = made.beats.at(-1)!;
    let nearest = Infinity;
    for (const t of read.beats) nearest = Math.min(nearest, Math.abs(t - last));
    expect(nearest * 1000).toBeLessThan(10);
  });

  it("has none for a song slower than 60 a minute, noise, silence and chords alone, only each second's loudness", { timeout: LONG }, () => {
    const noise = (() => {
      const rnd = random(5);
      return Float32Array.from({ length: SR * 60 }, () => (rnd() * 2 - 1) * 0.2);
    })();
    for (const [label, samples] of [
      ["45 a minute", track({ bpm: 45, seconds: 90, eighths: false }).samples],
      ["noise", noise],
      ["silence", new Float32Array(SR * 30)],
      ["chords alone", track({ drums: false, bpm: 100, seconds: 120, seed: 4 }).samples],
      ["chords alone, slower", track({ drums: false, bpm: 80, seconds: 120, seed: 8 }).samples],
    ] as const) {
      const d = danceOf(samples);
      expect(d.none, label).toMatch(/^(tempo|clear)$/);
      expect(d.secs, label).toHaveLength(Math.ceil(samples.length / SR));
      const t = JSON.parse(danceText(d));
      expect(Object.keys(t).sort(), label).toEqual(["none", "s", "v"]);
      expect(t.s, label).toMatch(/^[0-9]+$/);
    }
    // silence is 0 throughout, however quiet the whole song is
    expect(danceOf(new Float32Array(SR * 10)).secs.every((v) => v === 0)).toBe(true);
  });

  it("works out the same features once for both, and 325's analysis comes out as it did", { timeout: LONG }, () => {
    const { samples } = track({ bpm: 118, seed: 2, seconds: 70 });
    const f = features(samples);
    expect(analyse(samples, RULES, f)).toEqual(analyse(samples));
    // a bar looked for on the beats where they are lies where it does on an even grid, when that is where they are
    const w = { first: 1.0, period: 60 / 118, from: 0, to: 63 };
    const grid = Array.from({ length: 70 }, (_, k) => w.first + w.period * k);
    expect(barOf(f, w, grid)).toEqual(barOf(f, w));
  });
});

describe("loudness in steps", () => {
  it("is 9 at the 90th percentile, a step less for each 2.2 dB less, and 0 in silence", () => {
    const db = [-10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -12.2, -14.4, -30, -70];
    expect(levelsOf(db)).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 7, 0, 0]);
    expect(levelsOf([-5, -20])).toEqual([9, 2]);
    expect(levelsOf([-100, -100])).toEqual([0, 0]);
    expect(levelsOf([])).toEqual([]);
  });
});

describe("a song's table, written and read", () => {
  const beats = (at: number[]): Dance => ({
    bpm: 120.04,
    bar: 2,
    waltz: false,
    beats: Float64Array.from(at),
    energy: at.map((_, i) => i % 10),
    secs: [1, 2, 3],
  });

  it("gives each beat's time from the one before in 10 ms, rounded where each is", () => {
    const text = danceText(beats([0.524, 1.026, 1.523, 2.031]));
    expect(JSON.parse(text)).toEqual({ v: 1, bpm: 120, bar: 2, t: "52,51,49,51", e: "0123" });
    expect(readDance(text)).toEqual({
      bpm: 120,
      bar: 2,
      waltz: false,
      beats: Float64Array.from([0.52, 1.03, 1.52, 2.03]),
      energy: Uint8Array.from([0, 1, 2, 3]),
      liteS: 0,
    });
  });

  it("says how far the smaller copy is off only when that is 20 ms or more", () => {
    const d = beats([0.5, 1, 1.5]);
    expect(JSON.parse(danceText(d, -85.34)).lite).toBe(-85);
    expect(JSON.parse(danceText(d, 23)).lite).toBe(23);
    expect(JSON.parse(danceText(d, -19.9)).lite).toBeUndefined();
    expect(JSON.parse(danceText(d, null)).lite).toBeUndefined();
    expect((readDance(danceText(d, -85.34)) as DanceBeats).liteS).toBeCloseTo(-0.085, 9);
  });

  it("is each second's loudness alone with no beats, or with too many to send", () => {
    expect(danceText({ none: "clear", secs: [0, 4, 9] })).toBe('{"v":1,"none":"clear","s":"049"}');
    expect(readDance('{"v":1,"none":"clear","s":"049"}')).toEqual({ none: "clear", secs: Uint8Array.from([0, 4, 9]) });
    // a long song's thousands of beats
    const many = beats(Array.from({ length: 2000 }, (_, i) => 0.5 + i * 0.5));
    const text = danceText(many);
    expect(JSON.parse(text)).toEqual({ v: 1, none: "long", s: "123" });
    expect(DANCE_MAX).toBe(DANCE.maxChars);
  });

  it("reads none that is not a table", () => {
    const good = '{"v":1,"bpm":120,"bar":1,"t":"50,50,50","e":"123"}';
    expect(readDance(good)).not.toBeNull();
    for (const bad of [
      null,
      42,
      "",
      "not json",
      "[]",
      '{"v":2,"bpm":120,"bar":1,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":4,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":3,"w":1,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"w":true,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1.5,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":"120","bar":1,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":1000,"bar":1,"t":"50,50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,0,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,-5,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,5.5,50","e":"123"}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,50,50","e":"12a"}',
      '{"v":1,"bpm":120,"bar":1,"t":"","e":""}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,50,50","e":"123","lite":3000}',
      '{"v":1,"bpm":120,"bar":1,"t":"50,50,50","e":"123","lite":1.5}',
      '{"v":1,"none":"other","s":"123"}',
      '{"v":1,"none":"tempo","s":"1x3"}',
      '{"v":1,"none":"tempo"}',
      `{"v":1,"none":"tempo","s":"${"1".repeat(DANCE_MAX)}"}`,
    ]) {
      expect(readDance(bad), String(bad).slice(0, 80)).toBeNull();
    }
  });
});

describe("how much later a smaller copy is", () => {
  it("is found from the start of both, to a few ms", { timeout: LONG }, () => {
    const { samples } = track({ bpm: 126, seconds: 100, seed: 6 });
    const a = features(samples).env;
    const later = (ms: number) => {
      const n = Math.round((ms / 1000) * SR);
      // the copy: its first 90 s, a little duller, a little noisier
      const rnd = random(11);
      const out = new Float32Array(SR * 90);
      let low = 0;
      for (let i = 0; i < out.length; i++) {
        const j = i - n;
        low += 0.7 * ((j >= 0 && j < samples.length ? samples[j] : 0) - low);
        out[i] = low + (rnd() * 2 - 1) * 0.003;
      }
      return features(out).env;
    };
    for (const ms of [0, 23, 85.3, -15]) expect(Math.abs(shiftOf(a, later(ms))! - ms), `${ms}`).toBeLessThan(3);
    // further than it looks, or nothing alike
    expect(shiftOf(a, later(85.3), 5)).toBeNull();
    const rnd = random(12);
    expect(shiftOf(a, Float32Array.from({ length: a.length }, () => rnd()))).toBeNull();
    expect(shiftOf(a.subarray(0, 100), a.subarray(0, 100))).toBeNull();
    expect(Math.round(FPS)).toBe(100);
  });
});
