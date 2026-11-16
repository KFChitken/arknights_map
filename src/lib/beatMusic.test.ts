import { describe, expect, it } from "vitest";
import {
  analyse,
  ANALYSIS_V,
  candidatesOf,
  clipPlan,
  fft,
  fftTables,
  manifestOf,
  pickClips,
  RULES,
  squashName,
  SR,
  type Analysis,
  type Candidate,
} from "../../scripts/beat-analysis.mjs";
import type { Catalog } from "../../scripts/msr-music.mjs";

// scripts/beat-music.mjs, without the files: songs made up here at a known tempo, each beat a drum (or a bell), and
// chords that change on each bar's first beat

type Made = { bpm?: number; seconds?: number; start?: number; meter?: 3 | 4; drift?: number; drums?: boolean; bell?: boolean; kickOn?: number[] };

/** A made-up song's samples at SR, and when its beats are (s) */
function song({ bpm = 120, seconds = 60, start = 0.5, meter = 4, drift = 0, drums = true, bell = false, kickOn = [0, 2] }: Made = {}) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const y = new Float32Array(Math.round(SR * seconds));
  const add = (t: number, f: Float32Array) => {
    const at = Math.round(t * SR);
    for (let i = 0; i < f.length && at + i < y.length; i++) y[at + i] += f[i];
  };
  const make = (len: number, fn: (t: number) => number) => Float32Array.from({ length: Math.round(len * SR) }, (_, i) => fn(i / SR));
  const kick = make(0.25, (t) => Math.sin(2 * Math.PI * (50 * t + (80 / 30) * (1 - Math.exp(-30 * t)))) * Math.exp(-12 * t) * 0.9);
  const snare = make(0.2, (t) => (rnd() * 2 - 1) * Math.exp(-25 * t) * 0.4);
  const hat = make(0.05, (t) => (rnd() * 2 - 1) * Math.exp(-90 * t) * 0.12);
  const ding = make(0.12, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.min(1, t * 400) * Math.exp(-30 * t) * 0.5);
  const chords = [
    [261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  const beats: number[] = [];
  for (let t = start, b = 0; t < seconds - 1; b++) {
    beats.push(t);
    const inBar = b % meter;
    if (drums && bell) add(t, ding);
    else if (drums) {
      if (meter === 3 ? inBar === 0 : kickOn.includes(inBar)) add(t, kick);
      if (meter === 4 && inBar % 2 === 1) add(t, snare);
      add(t, hat);
    }
    const period = (60 / bpm) * (1 + drift * Math.sin((2 * Math.PI * t) / 13));
    if (inBar === 0) {
      const c = chords[Math.floor(b / meter) % 4];
      add(t, make(period * meter, (u) => c.reduce((a, f) => a + Math.sin(2 * Math.PI * f * u), 0) * 0.04 * Math.min(1, u * (drums ? 200 : 4)) * Math.exp(-u * 0.3)));
    }
    if (!drums && rnd() < 0.3) add(t + rnd() * period, make(0.8, (u) => Math.sin(2 * Math.PI * 523.25 * u) * 0.03 * Math.min(1, u * 10) * Math.exp(-u * 3)));
    t += period;
  }
  for (let i = 0; i < y.length; i++) y[i] += (rnd() * 2 - 1) * 0.003;
  return { samples: y, beats };
}

/** The made-up beat nearest a time, and its place among them */
const nearest = (beats: number[], t: number) => beats.reduce((k, b, i) => (Math.abs(b - t) < Math.abs(beats[k] - t) ? i : k), 0);

describe("the spectrum", () => {
  it("is the discrete Fourier transform", () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 5) * 0.1);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.3) * 0.2);
    const want = Array.from({ length: n }, (_, k) => {
      let r = 0;
      let j = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        r += re[t] * Math.cos(a) - im[t] * Math.sin(a);
        j += re[t] * Math.sin(a) + im[t] * Math.cos(a);
      }
      return [r, j];
    });
    fft(re, im, fftTables(n));
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(want[k][0], 9);
      expect(im[k]).toBeCloseTo(want[k][1], 9);
    }
    expect(() => fftTables(48)).toThrow();
  });
});

describe("a song's beats", () => {
  // each a few hundred ms alone, more with every other test running
  const LONG = 30_000;

  it("finds the tempo, the first beat and the bars of a steady song", { timeout: LONG }, () => {
    for (const [bpm, start, kickOn] of [
      [120, 0.5, [0, 2]],
      [103.5, 1.234, [0, 2]],
      [131.7, 0.05, [0, 2]],
      [118, 0.8, [0]],
    ] as const) {
      const made = song({ bpm, start, kickOn: [...kickOn], seconds: 70 });
      const a = analyse(made.samples);
      expect(a.none, `${bpm}`).toBeUndefined();
      expect(a.bpm!).toBeCloseTo(bpm, 1);
      expect(Math.abs(a.period! - 60 / bpm) * 1000).toBeLessThan(0.05);
      // on a beat as it is heard, give or take a few ms
      const k = nearest(made.beats, a.first!);
      expect(Math.abs(a.first! - made.beats[k]) * 1000).toBeLessThan(3);
      expect(a.rms!).toBeLessThan(3);
      // the first of the stretch's first four beats that starts a bar
      expect(a.bar).toBe((4 - (k % 4)) % 4);
    }
  });

  it("finds them on bells as on drums, no later and no earlier", { timeout: LONG }, () => {
    const made = song({ bpm: 125, bell: true, seconds: 60 });
    const a = analyse(made.samples);
    expect(a.none).toBeUndefined();
    const k = nearest(made.beats, a.first!);
    expect(Math.abs(a.first! - made.beats[k]) * 1000).toBeLessThan(3);
    expect(a.bar).toBe((4 - (k % 4)) % 4);
  });

  it("leaves out a song whose tempo drifts, one in threes, one with no beat, and one too fast", { timeout: LONG }, () => {
    const drifting = analyse(song({ drift: 0.03, seconds: 70 }).samples);
    expect(drifting.none).toBe("steady");
    expect(drifting.rms!).toBeGreaterThan(RULES.rmsMs);
    expect(analyse(song({ meter: 3, seconds: 70 }).samples).none).toBe("waltz");
    expect(analyse(song({ drums: false, bpm: 110, seconds: 70 }).samples).none).toBeTruthy();
    expect(analyse(song({ bpm: 150, seconds: 70 }).samples).none).toBe("tempo");
    // and one too short for a clip
    expect(analyse(song({ seconds: 30 }).samples).none).toBe("tempo");
  });
});

describe("the songs played", () => {
  const catalog: Catalog = {
    v: 1,
    updated: null,
    albums: [
      { id: "a1", name: "Album One", order: 0, songs: ["s1", "s2", "s3"] },
      { id: "a2", name: "Album Two", order: 1, songs: ["s4", "s5", "s6"] },
    ],
    songs: {
      s1: { name: "Steady Song", album: "a1", artists: [], seconds: 200, file: "0000000000000001.m4a", bytes: 1, game: "arknights", added: "" },
      s2: { name: "Speed of Light", album: "a1", artists: [], seconds: 180, file: "0000000000000002.m4a", bytes: 1, game: "arknights", added: "" },
      s3: { name: "Drifting", album: "a1", artists: [], seconds: 180, file: "0000000000000003.m4a", bytes: 1, game: "arknights", added: "" },
      s4: { name: "ＲＵＮＮＩＮＧ in the dark!", album: "a2", artists: [], seconds: 150, file: "0000000000000004.m4a", bytes: 1, game: "arknights", added: "" },
      s5: { name: "Speed of Light", album: "a2", artists: [], seconds: 180, file: "0000000000000005.m4a", bytes: 1, game: "arknights", added: "" },
      s6: { name: "Old Analysis", album: "a2", artists: [], seconds: 180, file: "0000000000000006.m4a", bytes: 1, game: "arknights", added: "" },
    },
  };
  const found = (rms: number, contrast = 2): Analysis & { v: number } => ({ v: ANALYSIS_V, first: 12.5, period: 0.5, bpm: 120, beats: 81, rms, contrast, bar: 2 });
  const analyses = {
    "0000000000000001.m4a": found(2, 3),
    "0000000000000002.m4a": found(9),
    "0000000000000003.m4a": { v: ANALYSIS_V, none: "steady" as const, rms: 40 },
    "0000000000000004.m4a": found(12),
    "0000000000000005.m4a": found(1),
    "0000000000000006.m4a": { ...found(1), v: ANALYSIS_V - 1 },
  };
  const hot = ["Missing Song", "Running In The Dark", "speed  of  light"];

  it("puts the hot ones first, in the hot list's order, then the steadiest", () => {
    const c = candidatesOf(catalog, analyses, hot);
    expect(c.map((x) => [x.song, x.hot])).toEqual([
      ["s4", 2],
      // the same name under two albums: both hot, the steadier first
      ["s5", 3],
      ["s2", 3],
      ["s1", null],
    ]);
    expect(c[0]).toMatchObject({ name: "ＲＵＮＮＩＮＧ in the dark!", album: "Album Two", file: "0000000000000004.m4a", seconds: 150, bar: 2 });
    expect(squashName(" Speed of Light ")).toBe(squashName("SPEED-OF-LIGHT"));
    expect(squashName("火与尘")).not.toBe(squashName("火与沙"));
  });

  it("plays the first of them, a song under two albums once, or exactly those named", () => {
    const c: Candidate[] = candidatesOf(catalog, analyses, hot);
    expect(pickClips(c, 30).map((x) => x.song)).toEqual(["s4", "s5", "s1"]);
    expect(pickClips(c, 2).map((x) => x.song)).toEqual(["s4", "s5"]);
    expect(pickClips(c, 30, ["s1", "s2"]).map((x) => x.song)).toEqual(["s1", "s2"]);
    expect(() => pickClips(c, 30, ["s3"])).toThrow(/s3/);
  });

  it("cuts a clip from before its first beat to after its window, and lists it", () => {
    expect(clipPlan({ first: 12.5, seconds: 200 })).toEqual({ start: 11, seconds: 43 });
    // a first beat near the song's start, and a window near its end
    expect(clipPlan({ first: 0.4, seconds: 200 })).toEqual({ start: 0, seconds: 41.9 });
    expect(clipPlan({ first: 100, seconds: 141 })).toEqual({ start: 98.5, seconds: 42.5 });
    const c = candidatesOf(catalog, analyses, hot)[0];
    const m = manifestOf([{ c: { ...c, period: 0.4687551 }, plan: clipPlan(c), file: "00000000000000aa.m4a", bytes: 350_000, ms: 43000.4 }], new Date(Date.UTC(2026, 10, 16)));
    expect(m).toEqual({
      v: 1,
      updated: "2026-11-16T00:00:00.000Z",
      clips: [{ song: "s4", file: "00000000000000aa.m4a", beat: 468.755, first: 1500, bar: 2, ms: 43000, bytes: 350_000 }],
    });
  });
});
