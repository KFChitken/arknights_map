// What scripts/beat-music.mjs works out from a song's samples, kept apart from its reading and writing so it can be
// tested (src/lib/beatMusic.test.ts, src/lib/danceMap.test.ts): where the song's beats are, its steadiest
// RULES.windowS seconds of them at RULES.bpm, which of those beats start a bar, and which songs 325 节拍 plays, the hot
// ones first; and for 听歌's disco, every beat of the whole song at DANCE.bpm, how loud each is, and how far its smaller
// copy (省流量) is from it (danceOf, danceText, shiftOf).
//
// The beats are found much as librosa finds them (Ellis, "Beat tracking by dynamic programming", 2007): an onset
// envelope, how much louder each band of the spectrum got from one frame to the next; the tempo its autocorrelation
// is strongest at; and the beats a dynamic programme lays on it, a beat apart give or take. The stretch kept is the
// one whose beats lie nearest an even grid, so a clip's beats can be told by two numbers, its first beat and the
// time between two. Everything here is pure: samples in, numbers out.

/** Samples a second the songs are read at, between two frames (about 10 ms), and in a frame */
export const SR = 22050;
export const HOP = 220;
export const FPS = SR / HOP;
const N = 1024;

/** What a clip must be, all in one place */
export const RULES = {
  /** Beats a minute, both ends in */
  bpm: [100, 135],
  /** Seconds of beats from a clip's first beat */
  windowS: 40,
  /** Seconds of the song kept before the first beat and after the window */
  preS: 1.5,
  postS: 1.5,
  /** How far the beats are from an even grid at most: their root mean square (ms) */
  rmsMs: 15,
  /** How much stronger the onsets on the beats are than those halfway between them, at least */
  contrast: 1.25,
  /** The share of the beats with an onset on them, at least */
  hits: 0.6,
};

/** What the analysis of a song is, for a cache of them: a newer one makes the old ones be done again */
export const ANALYSIS_V = 1;

// ---- the spectrum ----

/** What an FFT of n points needs, worked out once: the bit-reversed order, and the twiddles */
export function fftTables(n) {
  const levels = Math.round(Math.log2(n));
  if (1 << levels !== n) throw new Error("an FFT needs a power of two");
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  return { n, rev, cos, sin };
}

/** The discrete Fourier transform of re + i·im, in place */
export function fft(re, im, t) {
  const n = t.n;
  for (let i = 0; i < n; i++) {
    const j = t.rev[i];
    if (j > i) {
      let x = re[i];
      re[i] = re[j];
      re[j] = x;
      x = im[i];
      im[i] = im[j];
      im[j] = x;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const l = j + half;
        const c = t.cos[k];
        const s = t.sin[k];
        const tre = re[l] * c - im[l] * s;
        const tim = re[l] * s + im[l] * c;
        re[l] = re[j] - tre;
        im[l] = im[j] - tim;
        re[j] += tre;
        im[j] += tim;
      }
    }
  }
}

/** The spectrum's bands, in bins of a frame: about a third of an octave each from 40 Hz to 8 kHz, at least a bin wide */
function bandsOf() {
  const edges = [];
  for (let k = 0; k <= 36; k++) edges.push(Math.round((40 * Math.pow(200, k / 36) * N) / SR));
  const cuts = [...new Set(edges)].sort((a, b) => a - b);
  const bands = [];
  for (let i = 0; i + 1 < cuts.length; i++) bands.push([cuts[i], cuts[i + 1]]);
  return bands;
}
const BANDS = bandsOf();
/** The bands of the kick drum and the bass: under 170 Hz */
const LOW = BANDS.filter(([, hi]) => (hi * SR) / N <= 170).length;
/** Each bin from 130 Hz to 2.1 kHz with its pitch class (C 0 … B 11), for which notes sound */
const CHROMA_BINS = (() => {
  const out = [];
  for (let k = Math.ceil((130 * N) / SR); k <= Math.floor((2100 * N) / SR); k++) {
    out.push([k, (((Math.round(12 * Math.log2((k * SR) / N / 440)) + 69) % 12) + 12) % 12]);
  }
  return out;
})();

/**
 * A song's frames, one every HOP samples, each centred on its sample: env, how much louder its bands got since the
 * frame before, over its whole spectrum (in dB, nothing under 80 dB below the song's loudest, the mean of the bands,
 * divided by its standard deviation over the song), and low, the same in the bands under 170 Hz; chroma, how much of
 * each of the twelve pitch classes it has (12 a frame); and loud, its level in dB
 */
export function features(samples) {
  const frames = Math.floor(samples.length / HOP) + 1;
  const nb = BANDS.length;
  const t = fftTables(N);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const power = new Float32Array(frames * nb);
  const chroma = new Float32Array(frames * 12);
  const loud = new Float32Array(frames);
  let most = 0;
  for (let f = 0; f < frames; f++) {
    const from = f * HOP - N / 2;
    let sq = 0;
    for (let i = 0; i < N; i++) {
      const s = from + i;
      const x = s >= 0 && s < samples.length ? samples[s] : 0;
      re[i] = x * win[i];
      im[i] = 0;
      sq += x * x;
    }
    loud[f] = 10 * Math.log10(sq / N + 1e-12);
    fft(re, im, t);
    for (let b = 0; b < nb; b++) {
      const [lo, hi] = BANDS[b];
      let p = 0;
      for (let k = lo; k < hi; k++) p += re[k] * re[k] + im[k] * im[k];
      p /= hi - lo;
      power[f * nb + b] = p;
      if (p > most) most = p;
    }
    for (const [k, pc] of CHROMA_BINS) chroma[f * 12 + pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  const floor = Math.max(most * 1e-8, 1e-20);
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let all = 0;
    let lows = 0;
    for (let b = 0; b < nb; b++) {
      const rise = 10 * Math.log10(Math.max(power[f * nb + b], floor) / Math.max(power[(f - 1) * nb + b], floor));
      if (rise > 0) {
        all += rise;
        if (b < LOW) lows += rise;
      }
    }
    env[f] = all / nb;
    low[f] = LOW ? lows / LOW : 0;
  }
  return { frames, env: scaled(env), low: scaled(low), chroma, loud };
}

/** Divided by its standard deviation, so that songs loud and quiet are told alike */
function scaled(x) {
  let sum = 0;
  for (const v of x) sum += v;
  const mean = sum / x.length;
  let sq = 0;
  for (const v of x) sq += (v - mean) * (v - mean);
  const sd = Math.sqrt(sq / Math.max(1, x.length - 1));
  if (sd > 0) for (let i = 0; i < x.length; i++) x[i] /= sd;
  return x;
}

// ---- the tempo and the beats ----

const lagOf = (bpm) => (60 * FPS) / bpm;
/** How much a tempo is weighed towards 120 beats a minute, as librosa weighs it, by its lag (frames) */
const prior = (lag) => Math.exp(-0.5 * Math.log2((60 * FPS) / lag / 120) ** 2);

/**
 * The tempo of an onset envelope, at RULES.bpm, or null when its beat lies elsewhere: where its autocorrelation is
 * strongest between 50 and 270 beats a minute, weighed towards 120 as librosa weighs it; taken as it is, or twice or
 * half as fast, whichever of those falls in RULES.bpm and is as strong as most (70 %) of the strongest; when more
 * than one does (a range wider than an octave), the strongest of them as they are, or weighed so too (rules.weigh).
 * period: frames between two beats, to a fraction of one.
 */
export function tempoOf(env, rules = RULES) {
  let sum = 0;
  for (const v of env) sum += v;
  const mean = sum / env.length;
  const lo = Math.floor(lagOf(270));
  const hi = Math.ceil(lagOf(50));
  const ac = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += (env[i] - mean) * (env[i + lag] - mean);
    ac[lag] = s / env.length;
  }
  let best = -1;
  let bestW = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const w = ac[lag] * prior(lag);
    if (w > bestW) {
      bestW = w;
      best = lag;
    }
  }
  if (best < 0 || !(ac[best] > 0)) return null;
  // the strongest lag in the range, and whether it is strong enough
  const inLo = Math.ceil(lagOf(rules.bpm[1]));
  const inHi = Math.floor(lagOf(rules.bpm[0]));
  const score = rules.weigh ? (l) => ac[l] * prior(l) : (l) => ac[l];
  let lag = -1;
  for (let l = inLo; l <= inHi; l++) if (lag < 0 || score(l) > score(lag)) lag = l;
  if (lag < 0 || ac[lag] < 0.7 * ac[best]) return null;
  // between frames: the peak of the parabola through it and its neighbours
  const a = ac[lag - 1];
  const b = ac[lag];
  const c = ac[lag + 1];
  const d = a - 2 * b + c;
  const period = d < 0 ? lag + (0.5 * (a - c)) / d : lag;
  return { bpm: (60 * FPS) / period, period };
}

/**
 * The beats a dynamic programme lays on an onset envelope, as frames: each beat's score is the onset there (smoothed
 * over a little of a beat) and the best of the scores of the beats before it, less how far that one is from a period
 * back (tightness times the square of the log of their ratio); from the last beat that scores well, back to the first
 * (librosa's beat_track, its leading and trailing weak beats left out)
 */
export function beatFrames(env, period, tightness = 100) {
  const n = env.length;
  let most = 0;
  for (const v of env) if (v > most) most = v;
  // the onsets, smoothed over a 32nd of a beat each way
  const half = Math.round(period);
  const kernel = [];
  for (let k = -half; k <= half; k++) kernel.push(Math.exp(-0.5 * ((k * 32) / period) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += env[j] * kernel[k + half];
    }
    local[i] = s;
  }
  let localMost = 0;
  for (const v of local) if (v > localMost) localMost = v;
  const from = Math.round(2 * period);
  const to = Math.round(period / 2);
  const txwt = new Float64Array(from - to + 1);
  for (let d = to; d <= from; d++) txwt[d - to] = -tightness * Math.log(d / period) ** 2;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let first = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let at = -1;
    for (let d = to; d <= from; d++) {
      const j = i - d;
      if (j < 0) break;
      const s = cum[j] + txwt[d - to];
      if (s > best) {
        best = s;
        at = j;
      }
    }
    cum[i] = local[i] + (at >= 0 ? best : 0);
    if (first && local[i] < 0.01 * localMost) back[i] = -1;
    else {
      back[i] = at;
      first = false;
    }
  }
  // the last beat: the last of the score's local peaks over half their median
  const peaks = [];
  for (let i = 1; i + 1 < n; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) peaks.push(i);
  if (!peaks.length) return [];
  const med = median(peaks.map((i) => cum[i]));
  let last = peaks[peaks.length - 1];
  for (let p = peaks.length - 1; p >= 0; p--) {
    if (cum[peaks[p]] >= 0.5 * med) {
      last = peaks[p];
      break;
    }
  }
  const beats = [last];
  while (back[beats[beats.length - 1]] >= 0) beats.push(back[beats[beats.length - 1]]);
  beats.reverse();
  // leading and trailing beats where nothing much happens
  const smooth = beats.map((b, i) => {
    let s = 0;
    let w = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= beats.length) continue;
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 3)) / 6);
      s += local[beats[j]] * h;
      w += h;
    }
    return s / w;
  });
  const th = 0.5 * Math.sqrt(smooth.reduce((s, v) => s + v * v, 0) / Math.max(1, smooth.length));
  let a = 0;
  let z = beats.length;
  while (a < z && smooth[a] <= th) a++;
  while (z > a && smooth[z - 1] <= th) z--;
  return beats.slice(a, z);
}

/**
 * The envelope rises a little before an onset is heard, as a frame's window takes in the start of it: how much later
 * a beat is than its peak (s), as measured on drums and bells whose onset is known (src/lib/beatMusic.test.ts)
 */
export const ONSET_LAG_S = 0.0105;

/**
 * Beats as times (s): each frame moved to the peak of the onset envelope within two frames of it, to a fraction of a
 * frame (the parabola through the peak and its neighbours)
 */
export function beatTimes(env, frames) {
  const out = new Float64Array(frames.length);
  frames.forEach((b, i) => {
    let p = b;
    for (let k = -2; k <= 2; k++) {
      const j = b + k;
      if (j > 0 && j + 1 < env.length && env[j] > env[p]) p = j;
    }
    let at = p;
    if (p > 0 && p + 1 < env.length) {
      const d = env[p - 1] - 2 * env[p] + env[p + 1];
      if (d < 0) at = p + Math.max(-0.5, Math.min(0.5, (0.5 * (env[p - 1] - env[p + 1])) / d));
    }
    out[i] = at / FPS + ONSET_LAG_S;
  });
  return out;
}

// ---- the steadiest stretch ----

/**
 * The stretch of RULES.windowS seconds of beats that lie nearest an even grid at RULES.bpm, or null: its first beat
 * and the time between two by least squares (s), how far they lie from that grid (root mean square and most, ms),
 * and which beats it is (from, to: indices, both in)
 */
export function steadiest(beats, rules = RULES) {
  let best = null;
  for (let i = 0, j = 0; i < beats.length; i++) {
    while (j < beats.length && beats[j] < beats[i] + rules.windowS) j++;
    // the window must reach its end: a beat at or past it
    if (j >= beats.length) break;
    const n = j - i + 1;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let k = 0; k < n; k++) {
      const y = beats[i + k];
      sx += k;
      sy += y;
      sxx += k * k;
      sxy += k * y;
    }
    const period = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const first = (sy - period * sx) / n;
    const bpm = 60 / period;
    if (!(bpm >= rules.bpm[0] && bpm <= rules.bpm[1])) continue;
    let sq = 0;
    let most = 0;
    for (let k = 0; k < n; k++) {
      const r = Math.abs(beats[i + k] - (first + period * k));
      sq += r * r;
      if (r > most) most = r;
    }
    const rms = Math.sqrt(sq / n) * 1000;
    if (!best || rms < best.rms) best = { first, period, bpm, rms, most: most * 1000, from: i, to: j };
  }
  return best;
}

/** The highest of x within `reach` frames of frame f (between frames, the nearest) */
function peakNear(x, f, reach) {
  const c = Math.round(f);
  let m = -Infinity;
  for (let k = -reach; k <= reach; k++) {
    const j = c + k;
    if (j >= 0 && j < x.length && x[j] > m) m = x[j];
  }
  return m === -Infinity ? 0 : m;
}

/**
 * How clear a stretch's beats are on an even grid (its first beat, period, from and to): contrast, the mean onset on
 * the beats over that halfway between them; hits, the share of its beats with an onset on them (within two frames)
 * at least half the median of those on the beats
 */
export function clarity(env, w) {
  const n = w.to - w.from + 1;
  const on = [];
  const off = [];
  for (let k = 0; k < n; k++) {
    const t = w.first + w.period * k;
    on.push(peakNear(env, t * FPS, 2));
    if (k + 1 < n) off.push(peakNear(env, (t + w.period / 2) * FPS, 2));
  }
  return clearOf(on, off);
}

/** The contrast and the hits of the onsets on some beats and of those halfway between them */
function clearOf(on, off) {
  const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const med = median(on);
  return { contrast: mean(on) / Math.max(1e-9, mean(off)), hits: on.filter((v) => v >= 0.5 * med && v > 0.5).length / Math.max(1, on.length) };
}

/**
 * Which of a stretch's first four beats starts a bar (0–3): bars of four, whose first beat has the most kick and bass
 * under it, and the most change in which notes sound since the beat before; and whether its beats go in threes
 * rather than fours (a waltz), as far as those tell, and which of its first three starts a bar of three (bar3). Its
 * beats are on an even grid (its first beat and period), or where they were found: times, all the song's (s), of
 * which the stretch's are from to to.
 */
export function barOf(f, w, times = null) {
  const n = w.to - w.from + 1;
  const kick = [];
  const change = [];
  let before = null;
  for (let k = 0; k < n; k++) {
    const t = times ? times[w.from + k] : w.first + w.period * k;
    const end = times ? (times[w.from + k + 1] ?? t + w.period) : t + w.period;
    kick.push(peakNear(f.low, t * FPS, 2));
    // the notes over the beat
    const a = Math.max(0, Math.round(t * FPS));
    const b = Math.min(f.frames, Math.max(a + 1, Math.round(end * FPS)));
    const c = new Float64Array(12);
    for (let i = a; i < b; i++) for (let p = 0; p < 12; p++) c[p] += f.chroma[i * 12 + p];
    let norm = 0;
    for (const v of c) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let p = 0; p < 12; p++) c[p] /= norm;
    let dot = 0;
    if (before) for (let p = 0; p < 12; p++) dot += before[p] * c[p];
    change.push(before ? 1 - dot : 0);
    before = c;
  }
  const z = (a) => {
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) || 1;
    return a.map((v) => (v - mean) / sd);
  };
  const zk = z(kick);
  const zc = z(change);
  const both = zk.map((v, k) => v + zc[k]);
  const by = (m) => {
    const s = new Float64Array(m);
    const c = new Float64Array(m);
    both.forEach((v, k) => {
      if (k === 0) return;
      s[k % m] += v;
      c[k % m]++;
    });
    return [...s].map((v, i) => v / Math.max(1, c[i]));
  };
  const fours = by(4);
  const threes = by(3);
  const lead = (a) => Math.max(...a) - a.reduce((s, v) => s + v, 0) / a.length;
  const bar = fours.indexOf(Math.max(...fours));
  return { bar, bar3: threes.indexOf(Math.max(...threes)), waltz: lead(threes) > 1.5 * lead(fours) };
}

/**
 * What a song's samples come to: where its clip would be (its first beat, the time between two, beats a minute),
 * how steady and clear its beats are there, which of the first four starts a bar; or why it has none (none: tempo,
 * no beat at RULES.bpm; steady, none steady enough; clear, not clear enough; waltz, in threes). f: their features,
 * when they were worked out already.
 */
export function analyse(samples, rules = RULES, f = features(samples)) {
  const tempo = tempoOf(f.env, rules);
  if (!tempo) return { none: "tempo" };
  const beats = beatTimes(f.env, beatFrames(f.env, tempo.period));
  const w = steadiest(beats, rules);
  if (!w) return { none: "tempo" };
  const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  const c = clarity(f.env, w);
  const out = {
    first: round(w.first, 4),
    period: round(w.period, 6),
    bpm: round(w.bpm, 3),
    beats: w.to - w.from + 1,
    rms: round(w.rms, 1),
    most: round(w.most, 1),
    contrast: round(c.contrast, 2),
    hits: round(c.hits, 2),
  };
  if (w.rms > rules.rmsMs) return { none: "steady", ...out };
  if (c.contrast < rules.contrast || c.hits < rules.hits) return { none: "clear", ...out };
  const { bar, waltz } = barOf(f, w);
  if (waltz) return { none: "waltz", ...out };
  return { ...out, bar };
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- the whole song, for 听歌's disco ----

/** What a song's table for 听歌's disco is made of, all in one place (src/lib/dance.ts reads the tables) */
export const DANCE = {
  /** Beats a minute, both ends in; of two in it an octave apart, the one weighed nearer 120 (tempoOf) */
  bpm: [60, 180],
  weigh: true,
  /** How alike the onsets are a beat apart, at least: their autocorrelation there, of 1 */
  periodic: 0.2,
  /** How much stronger the onsets on the beats are than those halfway between them, at least (as clarity) */
  contrast: 1.1,
  /** Under this, the beat is twice as fast where that is clearer, and in DANCE.bpm: a kick and a snare in turn */
  twice: 1.3,
  /** The share of the beats with an onset on them, at least */
  hits: 0.45,
  /** How far a beat is from halfway between the two around it, at most: the median of the song's (ms) */
  wobbleMs: 15,
  /** Beats a song must have, at least */
  minBeats: 16,
  /** The song's first beats, of which the first of a bar is found */
  barBeats: 64,
  /** Of the song's beats (or seconds), the 90th percentile of their loudness is 9, each step down this much less (dB) */
  stepDb: 2.2,
  /** Quieter than this is silence: 0, however quiet the whole song is (dB) */
  quietDb: -60,
  /** A table longer than this (characters) is the song's loudness alone, as a song's with no beat */
  maxChars: 6000,
  /** A smaller copy (省流量) as far from its song as this or more (ms) has it written in the song's table */
  liteMinMs: 20,
};

/** What the tables are worked out as, for a cache of them: a newer one has them all done again, and not 325's */
export const DANCE_V = 1;

/** How clear beats are where they were found (s), as clarity tells it of an even grid: on each, and halfway to the next */
export function beatClarity(env, beats) {
  const on = [];
  const off = [];
  for (let k = 0; k < beats.length; k++) {
    on.push(peakNear(env, beats[k] * FPS, 2));
    if (k + 1 < beats.length) off.push(peakNear(env, ((beats[k] + beats[k + 1]) / 2) * FPS, 2));
  }
  return clearOf(on, off);
}

/** How alike an onset envelope is a period (frames) later: its autocorrelation there, of 1 */
export function periodicity(env, period) {
  const lag = Math.round(period);
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let all = 0;
  let at = 0;
  for (let i = 0; i < env.length; i++) {
    const x = env[i] - mean;
    all += x * x;
    if (i + lag < env.length) at += x * (env[i + lag] - mean);
  }
  return all > 0 ? at / all : 0;
}

/** How far beats (s) are from halfway between the two around each: the median (ms) */
export function wobbleOf(beats) {
  const off = [];
  for (let i = 1; i + 1 < beats.length; i++) off.push(Math.abs(beats[i] - (beats[i - 1] + beats[i + 1]) / 2) * 1000);
  return median(off);
}

/** Loudness (dB) in steps of 0–9: the 90th percentile of the values 9, a step less for each DANCE.stepDb less, silence 0 */
export function levelsOf(db) {
  if (!db.length) return [];
  const top = [...db].sort((a, b) => b - a)[Math.floor(db.length * 0.1)];
  return db.map((d) => (d < DANCE.quietDb ? 0 : Math.max(0, Math.min(9, Math.round(9 + (d - top) / DANCE.stepDb)))));
}

/** The loudest of a song's frames from a to b, b not in (at least the one at a), in dB */
function loudest(f, a, b) {
  let m = -Infinity;
  const from = Math.min(Math.max(0, a), f.frames - 1);
  for (let i = from; i < Math.min(f.frames, Math.max(from + 1, b)); i++) if (f.loud[i] > m) m = f.loud[i];
  return m;
}

/**
 * What a whole song's samples come to for 听歌's disco: its beats (s), all of them, at DANCE.bpm; beats a minute, by
 * the median time between two; which of its first four beats starts a bar (of its first three, in threes: waltz); how
 * loud each beat is (0–9, from it to the next) and each second (secs); or why it has no beats (none: tempo, no beat
 * at DANCE.bpm, too few, or onsets not alike enough a beat apart; clear, beats not clear or not steady enough), with
 * each second's loudness alone. How the beats were (periodic, wobble, contrast, hits) comes with either, for the log.
 * f: the samples' features, when they were worked out already.
 */
export function danceOf(samples, f = features(samples)) {
  const seconds = Math.max(1, Math.ceil(samples.length / SR));
  const secs = levelsOf(Array.from({ length: seconds }, (_, s) => loudest(f, Math.round(s * FPS), Math.round((s + 1) * FPS))));
  const tempo = tempoOf(f.env, DANCE);
  if (!tempo) return { none: "tempo", secs };
  // the beats laid on a period (frames), and how they are
  const laid = (period) => {
    const beats = beatTimes(f.env, beatFrames(f.env, period));
    return { beats, how: { periodic: periodicity(f.env, period), wobble: wobbleOf(beats), ...beatClarity(f.env, beats) } };
  };
  let { beats, how } = laid(tempo.period);
  // nearly as strong halfway between the beats as on them: the beat is twice as fast, where that is clearer
  if (how.contrast < DANCE.twice && tempo.bpm * 2 <= DANCE.bpm[1]) {
    const twice = laid(tempo.period / 2);
    if (twice.how.contrast >= DANCE.twice && twice.how.contrast > how.contrast) ({ beats, how } = twice);
  }
  if (beats.length < DANCE.minBeats || how.periodic < DANCE.periodic) return { none: "tempo", secs, ...how };
  if (how.contrast < DANCE.contrast || how.hits < DANCE.hits || how.wobble > DANCE.wobbleMs) return { none: "clear", secs, ...how };
  const gaps = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
  const period = median(gaps);
  // a first beat much nearer the next than a beat is where the song starts, not a beat
  if (beats[1] - beats[0] < 0.75 * period) beats = beats.subarray(1);
  const { bar, bar3, waltz } = barOf(f, { first: beats[0], period, from: 0, to: Math.min(beats.length, DANCE.barBeats) - 1 }, beats);
  const energy = levelsOf(Array.from(beats, (t, i) => loudest(f, Math.round(t * FPS), Math.round((i + 1 < beats.length ? beats[i + 1] : t + period) * FPS))));
  return { bpm: 60 / period, bar: waltz ? bar3 : bar, waltz, beats, energy, secs, ...how };
}

/**
 * A song's table as 听歌 sends it (src/lib/dance.ts readDance): JSON with its beats, each the time from the one before
 * in 10 ms (the first's from the start), every one rounded where it is so that the last is as near as the first; and
 * each beat's loudness, a digit; or, with no beats, each second's loudness. lite: ms to add to where its smaller copy
 * (省流量) is played to get where the song is, written down when it is DANCE.liteMinMs or more either way. A table
 * longer than DANCE.maxChars is the loudness alone (none: long).
 */
export function danceText(d, lite = null) {
  const alone = (none) => JSON.stringify({ v: 1, none, s: d.secs.join("") });
  if (d.none) return alone(d.none);
  const cs = Array.from(d.beats, (t) => Math.round(t * 100));
  const text = JSON.stringify({
    v: 1,
    bpm: Math.round(d.bpm * 10) / 10,
    bar: d.bar,
    ...(d.waltz ? { w: 1 } : {}),
    t: cs.map((c, i) => (i ? c - cs[i - 1] : c)).join(","),
    e: d.energy.join(""),
    ...(lite !== null && Math.abs(lite) >= DANCE.liteMinMs ? { lite: Math.round(lite) } : {}),
  });
  return text.length <= DANCE.maxChars ? text : alone("long");
}

/**
 * How much later b is than a (ms), the onset envelopes of the same sound at its start (a song's and its smaller
 * copy's): where they are most alike within reach frames either way, to a fraction of a frame; or null when they are
 * not alike enough (a correlation under 0.5), the most alike is at the end of the reach, or they are too short
 */
export function shiftOf(a, b, reach = 30) {
  const lo = reach;
  const hi = Math.min(a.length, b.length) - reach;
  if (hi - lo < 4 * reach) return null;
  const n = hi - lo;
  let ma = 0;
  for (let i = lo; i < hi; i++) ma += a[i];
  ma /= n;
  let aa = 0;
  for (let i = lo; i < hi; i++) aa += (a[i] - ma) ** 2;
  const r = new Float64Array(2 * reach + 1);
  for (let lag = -reach; lag <= reach; lag++) {
    let mb = 0;
    for (let i = lo; i < hi; i++) mb += b[i + lag];
    mb /= n;
    let ab = 0;
    let bb = 0;
    for (let i = lo; i < hi; i++) {
      const x = a[i] - ma;
      const y = b[i + lag] - mb;
      ab += x * y;
      bb += y * y;
    }
    r[lag + reach] = aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
  }
  let k = 0;
  for (let i = 1; i < r.length; i++) if (r[i] > r[k]) k = i;
  if (r[k] < 0.5 || k === 0 || k === r.length - 1) return null;
  const d = r[k - 1] - 2 * r[k] + r[k + 1];
  return ((k - reach + (d < 0 ? (0.5 * (r[k - 1] - r[k + 1])) / d : 0)) / FPS) * 1000;
}

// ---- which songs are played ----

/** A song's name as it is compared with a hot list's: whatever its case, width, spaces and punctuation */
export const squashName = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

/**
 * The songs that could be played, best first: each song of the catalogue (scripts/msr-music.mjs) whose analysis
 * found a clip, with its place on the hot list (from 1) if its name is there. The hot ones come first, in the hot
 * list's order, then the others, the steadiest and clearest first. analyses: by the song's file.
 */
export function candidatesOf(catalog, analyses, hotNames) {
  const hot = new Map();
  hotNames.forEach((name, i) => {
    const key = squashName(name);
    if (key && !hot.has(key)) hot.set(key, i + 1);
  });
  const albums = new Map(catalog.albums.map((a) => [a.id, a.name]));
  const out = [];
  for (const [song, s] of Object.entries(catalog.songs)) {
    const a = analyses[s.file];
    if (!a || a.none || a.v !== ANALYSIS_V) continue;
    out.push({
      song,
      name: s.name,
      album: albums.get(s.album) ?? "",
      file: s.file,
      seconds: s.seconds,
      first: a.first,
      period: a.period,
      bpm: a.bpm,
      bar: a.bar,
      rms: a.rms,
      contrast: a.contrast,
      hot: hot.get(squashName(s.name)) ?? null,
    });
  }
  const key = (c) => c.rms / Math.min(Math.max(c.contrast, 1), 3);
  return out.sort((x, y) => (x.hot ?? Infinity) - (y.hot ?? Infinity) || key(x) - key(y) || x.song.localeCompare(y.song));
}

/**
 * The candidates played: the first n, or those named (song cids, in that order); a song under two albums only once,
 * the first time its name comes. Throws for a named song that is not a candidate.
 */
export function pickClips(candidates, n, named = null) {
  const by = new Map(candidates.map((c) => [c.song, c]));
  const list = named
    ? named.map((id) => {
        const c = by.get(id);
        if (!c) throw new Error(`${id} is not among the candidates`);
        return c;
      })
    : candidates;
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = squashName(c.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (!named && out.length >= n) break;
  }
  return out;
}

/** Where a candidate's clip is cut from its song (s): from RULES.preS before its first beat, to RULES.postS after the window */
export function clipPlan(c, rules = RULES) {
  const start = Math.max(0, c.first - rules.preS);
  const end = Math.min(c.seconds, c.first + rules.windowS + rules.postS);
  return { start: Math.round(start * 1000) / 1000, seconds: Math.round((end - Math.round(start * 1000) / 1000) * 1000) / 1000 };
}

/** The clips' list the site reads (music/beat.json), from each candidate cut and what its clip came to */
export function manifestOf(cut, now = new Date()) {
  return {
    v: 1,
    updated: now.toISOString(),
    clips: cut.map(({ c, plan, file, bytes, ms }) => ({
      song: c.song,
      file,
      beat: Math.round(c.period * 1e6) / 1e3,
      first: Math.round((c.first - plan.start) * 1e4) / 10,
      bar: c.bar,
      ms: Math.round(ms),
      bytes,
    })),
  };
}
