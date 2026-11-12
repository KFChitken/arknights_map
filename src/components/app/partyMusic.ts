/**
 * ⚡舟友的酒⚡'s music (src/lib/party.ts): a minute of 「⚡邦友の酒⚡」 by 活跃黑江乐 (bilibili),
 * played through Web Audio from the tap that starts the party. Its clock is the dance's, so
 * the phantoms stay on the beat however long the music took to load.
 */

import { isGray } from "@/lib/grayMode";

const MUSIC_URL = "/guide-art/zhouyou-jiu.m4a";
/** The song is mastered loud: well under full volume */
const VOLUME = 0.35;

let ctx: AudioContext | null = null;
let bytes: Promise<ArrayBuffer | null> | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;
let playing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
/** Counts starts and stops, so music still loading when the party is called off never starts */
let asked = 0;

const fetchBytes = () =>
  (bytes ??= fetch(MUSIC_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => {
      bytes = null;
      return null;
    }));

/** Fetch the music ahead of the tap (once the roach lies drunk), so it starts at once; not while the site is gray */
export function preloadPartyMusic() {
  if (!isGray()) void fetchBytes();
}

/** The music playing: seconds since it started, by the sound card's own clock */
export type PartyMusic = { time: () => number };

/** Fade the music out, if it is playing. */
export function stopPartyMusic() {
  asked++;
  if (!playing || !ctx) return;
  const { source, gain } = playing;
  playing = null;
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.5);
  source.stop(t + 0.55);
}

/**
 * The music from the start. Call it within the tap itself, which is what lets a browser
 * play sound. Resolves once it plays, or to null when it cannot (switched off on the
 * server, or no sound here) or may not (the site is gray, 全站变灰): the party then
 * dances to its own clock.
 */
export function playPartyMusic(): Promise<PartyMusic | null> {
  if (isGray()) return Promise.resolve(null);
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return Promise.resolve(null);
  ctx ??= new Context();
  const c = ctx;
  // within the tap: a browser only lets sound start from one
  void c.resume();
  // decoding takes the bytes over, so they are fetched once and decoded once; a failure is tried again next time
  const forget = () => {
    buffer = null;
    bytes = null;
    return null;
  };
  buffer ??= fetchBytes()
    .then((b) => (b ? c.decodeAudioData(b) : null))
    .then((d) => d ?? forget(), forget);
  stopPartyMusic();
  const mine = ++asked;
  return buffer.then((b) => {
    if (!b || mine !== asked) return null;
    const gain = c.createGain();
    gain.gain.value = VOLUME;
    gain.connect(c.destination);
    const source = c.createBufferSource();
    source.buffer = b;
    source.connect(gain);
    source.onended = () => {
      if (playing?.source === source) playing = null;
    };
    // a moment ahead, so the first beat is not clipped while the context wakes
    const start = c.currentTime + 0.05;
    source.start(start);
    playing = { source, gain };
    return { time: () => c.currentTime - start };
  });
}
