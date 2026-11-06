/**
 * 阿米娅向导's dance music (from the video by 疾刃 her dance comes from), played
 * quietly through Web Audio when she is tapped, never on its own. Whether it plays
 * at all is kept in this browser, switched on her card.
 */

const MUSIC_URL = "/guide-art/amiya-dance.m4a";
/** The video's music is loud: well under full volume */
const VOLUME = 0.3;
const OFF_KEY = "zhoup.amiyaMusic";

let ctx: AudioContext | null = null;
let buffer: Promise<AudioBuffer | null> | null = null;
let playing: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

export function musicOn() {
  try {
    return localStorage.getItem(OFF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMusicOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, "off");
  } catch {}
  if (!on) stopMusic();
}

/** Fade the music out, if it is playing. */
export function stopMusic() {
  if (!playing || !ctx) return;
  const { source, gain } = playing;
  playing = null;
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.4);
  source.stop(t + 0.45);
}

/**
 * The music from the start, over whatever was playing. Call it within the tap itself,
 * which is what lets a browser play sound. Resolves to how long it lasts (ms), or null
 * when it is off, switched off on the server, or cannot play here.
 */
export function playMusic(): Promise<number | null> {
  if (!musicOn()) return Promise.resolve(null);
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return Promise.resolve(null);
  ctx ??= new Context();
  const c = ctx;
  // within the tap: a browser only lets sound start from one
  void c.resume();
  buffer ??= fetch(MUSIC_URL)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((bytes) => (bytes ? c.decodeAudioData(bytes) : null))
    .catch(() => {
      buffer = null;
      return null;
    });
  stopMusic();
  return buffer.then((b) => {
    if (!b || !musicOn()) return null;
    stopMusic();
    const gain = c.createGain();
    gain.gain.value = VOLUME;
    gain.connect(c.destination);
    const source = c.createBufferSource();
    source.buffer = b;
    source.connect(gain);
    source.onended = () => {
      if (playing?.source === source) playing = null;
    };
    source.start();
    playing = { source, gain };
    return b.duration * 1000;
  });
}
