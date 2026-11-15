"use client";

import type { Sound } from "@/lib/study/beat325";

/**
 * 325 节拍's tune played in the browser (Beat325.tsx; what it plays is src/lib/study/beat325.ts beatTune): a square
 * wave sings the notes, a triangle plays the bass and the kick, and noise the snare, the hi-hat and the crash, with
 * nothing downloaded. Sounds are started a little ahead on the audio's own clock, each as much earlier as the browser
 * says the sound takes to come out of the speakers (baseLatency and outputLatency, where it tells them), so that a
 * note is heard as it reaches the line on the screen. The tune goes on while the sound is off, unheard, so it can be
 * turned on again in time. voice and noiseOf play into any audio context, an OfflineAudioContext too, so a tune can
 * be rendered to be listened to away from the game.
 */

/** How loud it all is, turned on */
const LOUD = 0.8;
/** How far ahead sounds are started (s), and how often the next are (ms) */
const AHEAD = 0.6;
const EVERY = 120;

export type Player = {
  /** Heard or not, from now on */
  setOn(on: boolean): void;
  /** Stops it for good */
  close(): void;
};

type Ctx = typeof AudioContext;

/**
 * Plays a tune whose time 0 is heard at t0 on performance.now()'s clock, the sounds of it still to come; null where
 * the browser has no Web Audio. Called in a press (开始, 声音), since a phone lets a page start sound only then.
 */
export function playTune(tune: readonly Sound[], t0: number, on: boolean): Player | null {
  const Made: Ctx | undefined =
    typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext);
  if (!Made) return null;
  let ctx: AudioContext;
  try {
    ctx = new Made({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  const out = ctx.createGain();
  out.gain.value = on ? LOUD : 0;
  out.connect(ctx.destination);
  const noise = noiseOf(ctx);
  let next = 0;
  let closed = false;
  /** The audio clock's time to start a sound at, to be heard at a moment on performance.now()'s (ms) */
  let startFor: ((ms: number) => number) | null = null;
  const pump = () => {
    if (closed || ctx.state !== "running") return;
    if (!startFor) {
      // the audio clock goes once the sound has started
      if (ctx.currentTime <= 0) return;
      const lag = (ctx.baseLatency || 0) + ((ctx as { outputLatency?: number }).outputLatency || 0);
      const c0 = ctx.currentTime;
      const p0 = performance.now();
      startFor = (ms) => c0 + (ms - p0) / 1000 - lag;
    }
    const now = ctx.currentTime;
    while (next < tune.length) {
      const at = startFor(t0 + tune[next].at);
      if (at > now + AHEAD) break;
      // one whose time has gone by is left out, rather than heard late
      if (at >= now) voice(ctx, out, noise, tune[next], at);
      next++;
    }
    if (next >= tune.length) window.clearInterval(timer);
  };
  const timer = window.setInterval(pump, EVERY);
  // the audio clock stood still while it was not running: the next is told afresh
  ctx.onstatechange = () => {
    startFor = null;
    pump();
  };
  ctx.resume().then(pump, () => {});
  pump();
  return {
    setOn(heard) {
      if (!closed) out.gain.setTargetAtTime(heard ? LOUD : 0, ctx.currentTime, 0.01);
    },
    close() {
      if (closed) return;
      closed = true;
      window.clearInterval(timer);
      ctx.onstatechange = null;
      ctx.close().catch(() => {});
    },
  };
}

/** A second and a half of white noise, the drums' and cymbals' */
export function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.5), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** A sound of the tune, started at `at` on the audio clock, into out */
export function voice(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, s: Sound, at: number) {
  const g = ctx.createGain();
  g.connect(out);
  switch (s.what) {
    case "lead": {
      // a square wave, a little softened: struck, then dying away within its eighth; the loudest of the parts, being
      // what is tapped
      const end = at + s.ms / 1000;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2600;
      f.connect(g);
      tone(ctx, "square", s.hz, at, end + 0.12, f);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.2, at + 0.006);
      g.gain.setTargetAtTime(0.08, at + 0.006, 0.07);
      g.gain.setTargetAtTime(0, end, 0.02);
      break;
    }
    case "bass": {
      const end = at + s.ms / 1000;
      tone(ctx, "triangle", s.hz, at, end + 0.2, g);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.23, at + 0.01);
      g.gain.setTargetAtTime(0.14, at + 0.01, 0.12);
      g.gain.setTargetAtTime(0, end, 0.04);
      break;
    }
    case "kick": {
      const o = tone(ctx, "triangle", 150, at, at + 0.32, g);
      o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      g.gain.setValueAtTime(0.75, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      break;
    }
    case "snare": {
      hiss(ctx, noise, 1400, at, 0.15, g);
      g.gain.setValueAtTime(0.34, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.15);
      // and its body
      const body = ctx.createGain();
      body.connect(out);
      tone(ctx, "triangle", 190, at, at + 0.1, body);
      body.gain.setValueAtTime(0.22, at);
      body.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      break;
    }
    case "hat": {
      hiss(ctx, noise, 7000, at, 0.04, g);
      g.gain.setValueAtTime(s.soft ? 0.08 : 0.13, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      break;
    }
    case "crash": {
      hiss(ctx, noise, 4500, at, 1.2, g);
      g.gain.setValueAtTime(0.13, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 1.2);
      break;
    }
  }
}

function tone(ctx: BaseAudioContext, type: OscillatorType, hz: number, at: number, stop: number, to: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, at);
  o.connect(to);
  o.start(at);
  o.stop(stop);
  return o;
}

/** The noise, with only what is over hz of it, for long seconds from somewhere in it */
function hiss(ctx: BaseAudioContext, noise: AudioBuffer, hz: number, at: number, long: number, to: AudioNode) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hz;
  src.connect(f);
  f.connect(to);
  src.start(at, Math.random() * Math.max(0, noise.duration - long - 0.05));
  src.stop(at + long + 0.02);
}
