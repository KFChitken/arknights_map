/**
 * 香艳制作人's sounds (src/lib/haimao.ts), made in the browser through Web Audio, but for dame dame while the page lets
 * it (HAIMAO_CLIPS, allowClip): six seconds of damedane (Breeze's), from the server's own folder. Each plays only from
 * a tap (on her card, her gull, a touch of her), never on its own, and not at all while it is switched off in this
 * browser (her card's 静音), the site is gray (全站变灰, src/lib/grayMode.ts) or a song of 听歌 plays. They stop as the
 * page goes out of sight.
 *
 * dame: the clip, or, made in code, a little music box under a robot voice singing "da-me da-me da-me"; all: three
 * bells and a shout; tick: a click; ding: a bell; boing: a spring; meow: her gull.
 */

import { isGray } from "@/lib/grayMode";
import { isListening } from "./listening";

export type HaimaoSound = "dame" | "all" | "tick" | "ding" | "boing" | "meow";

const OFF_KEY = "zhoup.haimaoSound";
/** All of them a little under the level they were made at, about as loud as 阿米娅向导's dance music */
const VOLUME = 0.55;

type Bus = { in: GainNode; kill: () => void };

/** Her damedane clip (src/app/guide-art), cut from the start of Breeze's: 48 kbps AAC, as 听歌's 省流量 copies */
const CLIP_URL = "/guide-art/haimao-damedane.m4a";
/** As loud as 阿米娅向导's dance music: the two files are as loud, and hers plays at this (src/components/app/amiyaMusic.ts) */
const CLIP_VOLUME = 0.3;
/** How long it lasts, said before it is in */
const CLIP_SECONDS = 6;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let wet: GainNode | null = null;
let noise: AudioBuffer | null = null;
const buses = new Set<Bus>();
const plucks = new Map<string, { buf: AudioBuffer; rate: number }>();

// the clip: whether the page lets it play, fetched and decoded once; null while it is not in (or will not come)
let clipOn = false;
let clipLoad: Promise<AudioBuffer | null> | null = null;
let clip: AudioBuffer | null = null;

/**
 * Whether dame dame is her clip (HAIMAO_CLIPS, as the page says) or made in code. Off, a clip already in is let go of,
 * and nothing more of it is fetched.
 */
export function allowClip(on: boolean) {
  clipOn = on;
  if (on) return;
  clipLoad = null;
  clip = null;
}

/**
 * Fetch and decode her clip ahead of a tap (her card or her story opening), unless it is not let play, is switched off
 * here or the site is gray. Decoded without the page's sound, which only a tap may start, so the first tap has it.
 */
export function preloadClip() {
  if (!clipOn || clipLoad || !soundOn() || isGray()) return;
  const Offline =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const load = fetch(CLIP_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((bytes) => {
      // decoding takes the bytes over, so it is fetched once and decoded once
      const decoder = ctx ?? (Offline ? new Offline(2, 1, 44100) : null);
      return bytes && decoder ? decoder.decodeAudioData(bytes) : null;
    })
    .catch(() => null);
  clipLoad = load;
  void load.then((b) => {
    if (clipLoad !== load) return;
    clip = b;
    // one that failed is fetched again the next time her card opens
    if (!b) clipLoad = null;
  });
}

export function soundOn() {
  try {
    return localStorage.getItem(OFF_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Her card's 静音, kept in this browser; switching it off stops whatever plays */
export function setSoundOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, "off");
  } catch {}
  if (!on) stopSounds();
}

function make() {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return false;
  try {
    ctx = new Context();
  } catch {
    ctx = null;
    return false;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  out = ctx.createGain();
  out.gain.value = 0.85 * VOLUME;
  out.connect(comp);
  comp.connect(ctx.destination);
  // a room: noise fading over 1.7 seconds
  const conv = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 1.7);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  conv.buffer = ir;
  wet = ctx.createGain();
  wet.gain.value = 0.2;
  wet.connect(conv);
  conv.connect(out);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let j = 0; j < nd.length; j++) nd[j] = Math.random() * 2 - 1;
  return true;
}

/** The context, made or woken within the tap that wants a sound; null when none may play */
function ready() {
  if (!soundOn() || isGray() || isListening()) return null;
  if (!ctx && !make()) return null;
  if (ctx!.state === "suspended") void ctx!.resume().catch(() => {});
  return ctx;
}

/** A sound's way out, which stopSounds fades: into the room (verb, how much of it) and the squeeze, or straight to "to" */
function bus(c: AudioContext, level = 1, verb = 1, to: AudioNode = out!): Bus {
  const g = c.createGain();
  g.gain.value = level;
  g.connect(to);
  const s = c.createGain();
  s.gain.value = verb;
  if (verb > 0) {
    g.connect(s);
    s.connect(wet!);
  }
  const b: Bus = {
    in: g,
    kill: () => {
      const t = c.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 0.08);
      } catch {}
      window.setTimeout(() => {
        try {
          g.disconnect();
          s.disconnect();
        } catch {}
      }, 240);
      buses.delete(b);
    },
  };
  buses.add(b);
  return b;
}

/** Stop whatever of hers plays */
export function stopSounds() {
  for (const b of [...buses]) b.kill();
}

function env(p: AudioParam, t: number, a: number, peak: number, hold: number, rel: number) {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + hold);
  p.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
}

/** A plucked string (Karplus-Strong), tuned exactly through its playback rate; each kept once made */
function ks(c: AudioContext, freq: number, dur: number, bright: number, v: number) {
  const key = `${freq}|${dur}|${bright}|${v}`;
  const kept = plucks.get(key);
  if (kept) return kept;
  const sr = c.sampleRate;
  const n = Math.floor(sr * dur);
  const N = Math.max(2, Math.round(sr / freq + 0.5));
  const buf = c.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const raw = new Float32Array(N);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < N; i++) {
    lp += bright * (Math.random() * 2 - 1 - lp);
    raw[i] = lp;
    mean += lp;
  }
  mean /= N;
  const P = Math.max(1, Math.round(N * 0.13));
  const line = new Float32Array(N);
  let mx = 0;
  for (let i = 0; i < N; i++) {
    const x = raw[i] - mean - (i >= P ? raw[i - P] - mean : 0);
    line[i] = x;
    mx = Math.max(mx, Math.abs(x));
  }
  for (let i = 0; i < N; i++) line[i] /= mx || 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = line[k];
    const k2 = k + 1 === N ? 0 : k + 1;
    d[i] = a;
    line[k] = 0.9968 * 0.5 * (a + line[k2]);
    k = k2;
  }
  const fade = Math.min(512, n);
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  const made = { buf, rate: (freq * (N - 0.5)) / sr };
  plucks.set(key, made);
  return made;
}

function pluck(c: AudioContext, dest: AudioNode, t: number, freq: number, vel: number, bright: number) {
  const it = ks(c, freq, freq < 200 ? 1.9 : 1.3, bright, Math.floor(Math.random() * 3));
  const src = c.createBufferSource();
  src.buffer = it.buf;
  src.playbackRate.setValueAtTime(it.rate, t);
  const g = c.createGain();
  g.gain.setValueAtTime(vel, t);
  src.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + it.buf.duration / it.rate + 0.05);
}

// ---- a robot voice: a saw through three band-pass filters a vowel ----

type Formants = [freq: number, level: number, q: number][];
const VOWELS: Record<string, Formants> = {
  a: [
    [760, 1, 9],
    [1250, 0.55, 11],
    [2550, 0.24, 14],
  ],
  e: [
    [470, 1, 8],
    [1900, 0.45, 12],
    [2600, 0.22, 14],
  ],
  o: [
    [580, 1, 8],
    [920, 0.62, 10],
    [2450, 0.18, 14],
  ],
  u: [
    [340, 1, 7],
    [820, 0.42, 10],
    [2300, 0.1, 14],
  ],
  i: [
    [310, 1, 7],
    [2250, 0.4, 12],
    [3000, 0.2, 14],
  ],
  m: [
    [260, 1, 6],
    [1150, 0.08, 10],
    [2400, 0.03, 14],
  ],
  l: [
    [390, 1, 7],
    [1080, 0.32, 10],
    [2600, 0.12, 14],
  ],
  d: [
    [430, 0.7, 8],
    [1750, 0.5, 12],
    [2700, 0.22, 14],
  ],
};

/** A syllable: pitch, length, its consonant and vowel, the vowel it slides to, the pitch it slides to, how loud */
type Syllable = { f: number; d: number; v: string; c?: string; to?: string; slide?: number; amp?: number };

function burst(c: AudioContext, dest: AudioNode, t: number, f: number, lv: number, len: number, q = 1.2) {
  const s = c.createBufferSource();
  s.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = c.createGain();
  env(g.gain, t, 0.002, lv, 0.001, len);
  s.connect(bp);
  bp.connect(g);
  g.connect(dest);
  s.start(t, Math.random() * 0.5);
  s.stop(t + len + 0.05);
}

function voice(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  syl: Syllable[],
  o: { level?: number; rate?: number; vib?: number; echo?: number; peak?: number } = {},
) {
  const src = c.createOscillator();
  src.type = "sawtooth";
  const sub = c.createOscillator();
  sub.type = "square";
  const sg = c.createGain();
  sg.gain.value = 0.14;
  const amp = c.createGain();
  amp.gain.value = 0.0001;
  src.connect(amp);
  sub.connect(sg);
  sg.connect(amp);
  const mix = c.createGain();
  mix.gain.value = o.level ?? 1;
  const bank = [0, 1, 2].map(() => {
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    const g = c.createGain();
    g.gain.value = 0;
    amp.connect(f);
    f.connect(g);
    g.connect(mix);
    return { f, g };
  });
  const lfo = c.createOscillator();
  lfo.frequency.value = o.rate ?? 5.6;
  const lg = c.createGain();
  lg.gain.value = o.vib ?? 16;
  lfo.connect(lg);
  lg.connect(src.detune);
  lg.connect(sub.detune);
  const dl = c.createDelay(1);
  dl.delayTime.value = o.echo ?? 0.17;
  const fb = c.createGain();
  fb.gain.value = 0.26;
  mix.connect(dest);
  mix.connect(dl);
  dl.connect(fb);
  fb.connect(dl);
  fb.connect(dest);
  const setV = (vw: Formants, at: number, tc: number) =>
    vw.forEach(([freq, level, q], i) => {
      bank[i].f.frequency.setTargetAtTime(freq, at, tc);
      bank[i].f.Q.setTargetAtTime(q, at, tc);
      bank[i].g.gain.setTargetAtTime(level * 4, at, tc);
    });
  VOWELS[syl[0].c ?? syl[0].v].forEach(([freq, level, q], i) => {
    bank[i].f.frequency.setValueAtTime(freq, t);
    bank[i].f.Q.setValueAtTime(q, t);
    bank[i].g.gain.setValueAtTime(level * 4, t);
  });
  let tt = t;
  const pk = o.peak ?? 0.5;
  syl.forEach((s, i) => {
    const t0 = tt;
    if (i === 0) {
      src.frequency.setValueAtTime(s.f, t0);
      sub.frequency.setValueAtTime(s.f / 2, t0);
    } else {
      src.frequency.setTargetAtTime(s.f, t0, 0.02);
      sub.frequency.setTargetAtTime(s.f / 2, t0, 0.02);
    }
    if (s.slide) {
      src.frequency.setTargetAtTime(s.slide, t0 + s.d * 0.3, s.d * 0.35);
      sub.frequency.setTargetAtTime(s.slide / 2, t0 + s.d * 0.3, s.d * 0.35);
    }
    const cd = s.c === "m" ? 0.07 : s.c === "l" ? 0.06 : s.c === "d" ? 0.035 : 0;
    const a = pk * (s.amp ?? 1);
    if (s.c === "d") {
      amp.gain.setTargetAtTime(0.01, t0, 0.005);
      amp.gain.setTargetAtTime(a, t0 + cd, 0.012);
      burst(c, dest, t0 + cd - 0.006, 3400, 0.18, 0.012);
    } else if (s.c) {
      amp.gain.setTargetAtTime(a * (s.c === "m" ? 0.45 : 0.7), t0, 0.012);
      amp.gain.setTargetAtTime(a, t0 + cd, 0.02);
    } else amp.gain.setTargetAtTime(a, t0, 0.015);
    if (s.c && i > 0) setV(VOWELS[s.c], t0, 0.008);
    setV(VOWELS[s.v], t0 + cd, 0.025);
    if (s.to) setV(VOWELS[s.to], t0 + s.d * 0.45, s.d * 0.22);
    tt += s.d;
  });
  amp.gain.setTargetAtTime(0.0001, tt, 0.05);
  for (const node of [src, sub, lfo]) {
    node.start(t);
    node.stop(tt + 0.6);
  }
  return tt - t;
}

function bell(c: AudioContext, dest: AudioNode, t: number, f: number, lv: number) {
  for (const [mul, level, len] of [
    [1, 1, 1.1],
    [2.76, 0.35, 0.45],
    [5.4, 0.15, 0.22],
  ]) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f * mul;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lv * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + len + 0.05);
  }
}

const BOX = [174.61, 220, 261.63, 349.23];

const SOUNDS: Record<HaimaoSound, (c: AudioContext, b: Bus, t: number) => number> = {
  dame: (c, b, t) => {
    [0, 0.12, 0.24, 0.36, 0.96, 1.08, 1.2, 1.32].forEach((dt, i) => pluck(c, b.in, t + dt, BOX[i % 4], 0.16, 0.5));
    const len = voice(
      c,
      b.in,
      t + 0.04,
      [
        { f: 261.63, d: 0.23, c: "d", v: "a" },
        { f: 220, d: 0.25, c: "m", v: "e" },
        { f: 261.63, d: 0.23, c: "d", v: "a" },
        { f: 220, d: 0.27, c: "m", v: "e" },
        { f: 293.66, d: 0.22, c: "d", v: "a" },
        { f: 261.63, d: 0.22, c: "m", v: "e" },
        { f: 220, d: 0.72, v: "e", amp: 0.9 },
      ],
      { vib: 20, peak: 0.5 },
    );
    bell(c, b.in, t + 0.08 + len, 1396.9, 0.14);
    return len + 0.8;
  },
  all: (c, b, t) => {
    bell(c, b.in, t, 1046.5, 0.22);
    bell(c, b.in, t + 0.11, 1318.5, 0.22);
    bell(c, b.in, t + 0.22, 1568, 0.26);
    const syl: Syllable[] = [
      { f: 300, d: 0.34, v: "o", slide: 235, amp: 1.15 },
      { f: 228, d: 0.16, v: "l", amp: 0.9 },
    ];
    voice(c, b.in, t + 0.4, syl, { vib: 0, peak: 0.62, echo: 0.14 });
    voice(
      c,
      b.in,
      t + 0.415,
      syl.map((s) => ({ ...s, f: s.f * 1.5, slide: s.slide ? s.slide * 1.5 : 0 })),
      { vib: 0, peak: 0.3, echo: 0.14 },
    );
    for (let k = 0; k < 5; k++) bell(c, b.in, t + 0.95 + k * 0.07, 2093 + Math.random() * 1400, 0.07);
    return 1.5;
  },
  tick: (c, b, t) => {
    burst(c, b.in, t, 2300, 0.32, 0.008, 3);
    return 0.05;
  },
  ding: (c, b, t) => {
    bell(c, b.in, t, 1318.5, 0.2);
    return 1.1;
  },
  boing: (c, b, t) => {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(560, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.5);
    const l = c.createOscillator();
    l.frequency.value = 16;
    const lg = c.createGain();
    lg.gain.setValueAtTime(260, t);
    lg.gain.exponentialRampToValueAtTime(5, t + 0.5);
    l.connect(lg);
    lg.connect(o.detune);
    const g = c.createGain();
    env(g.gain, t, 0.005, 0.45, 0.05, 0.45);
    o.connect(g);
    g.connect(b.in);
    for (const node of [o, l]) {
      node.start(t);
      node.stop(t + 0.62);
    }
    return 0.6;
  },
  meow: (c, b, t) =>
    voice(
      c,
      b.in,
      t,
      [
        { f: 640, d: 0.09, c: "m", v: "i" },
        { f: 920, d: 0.17, v: "i", to: "a" },
        { f: 780, d: 0.3, v: "a", to: "u", slide: 520 },
      ],
      { vib: 10, peak: 0.4, echo: 0.11 },
    ),
};

/** Her clip from its start at t, through b; how long it lasts */
function playClip(c: AudioContext, b: Bus, sung: AudioBuffer, t: number) {
  const src = c.createBufferSource();
  src.buffer = sung;
  src.connect(b.in);
  src.start(t);
  return sung.duration || CLIP_SECONDS;
}

/**
 * One of her sounds; solo: over whatever of hers plays, which stops. Call it within the tap itself, which is what lets
 * a browser play sound. Resolves nothing; returns how long it lasts (seconds), 0 when it does not play.
 */
export function playSound(name: HaimaoSound, solo = false) {
  const c = ready();
  if (!c) return 0;
  if (solo) stopSounds();
  // dame dame is her clip once it is in; made in code until then (it is fetched now, if her card did not already)
  const sung = name === "dame" ? clip : null;
  if (name === "dame" && !sung) preloadClip();
  // the music box's strings are made the first time, before the clock starts
  if (name === "dame" && !sung) for (const f of BOX) for (let v = 0; v < 3; v++) ks(c, f, f < 200 ? 1.9 : 1.3, 0.5, v);
  const light = name === "tick";
  // the clip straight out, as loud as 阿米娅向导's music: none of the room or the squeeze that the made sounds go through
  const b = sung ? bus(c, CLIP_VOLUME, 0, c.destination) : bus(c, light ? 0.8 : 1, light ? 0.2 : 1);
  const d = sung ? playClip(c, b, sung, c.currentTime + 0.05) : SOUNDS[name](c, b, c.currentTime + 0.05) || 1;
  window.setTimeout(
    () => {
      if (!buses.has(b)) return;
      buses.delete(b);
      window.setTimeout(() => {
        try {
          b.in.disconnect();
        } catch {}
      }, 3000);
    },
    (d + 0.5) * 1000,
  );
  return d;
}

/** Wake the sound within a tap, for a sound that comes later (after the server answers) */
export const primeSound = () => Boolean(ready());

// whatever of hers plays stops as the page goes out of sight
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") stopSounds();
  });
}
