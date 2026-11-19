import { useSyncExternalStore } from "react";

/**
 * 一起卫戍's one sound: 啵, as a line is said in the room, made in the browser (a sine falling 1100 → 380 Hz in 0.13 s,
 * nothing downloaded), each seat two semitones above the one before so the ear tells who; a line said to you rings
 * two more, higher (squadDing). A phone lets a page start
 * sound only in a press, so the audio opens at the first one that matters (准备, 开始游戏, opening the room or the
 * panel: squadSoundReady); until then nothing is heard. Muted (🔔) on this device alone, kept in its storage.
 */

const MUTE_KEY = "squad.mute";

function readMuted() {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

let muted: boolean | null = null;
const fns = new Set<() => void>();
const mutedNow = () => (muted ??= typeof window === "undefined" ? false : readMuted());
const onMuted = (fn: () => void) => {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
};

/** 🔔: whether the room's sound is off on this device */
export const useSquadMuted = () => useSyncExternalStore(onMuted, mutedNow, () => false);

export function setSquadMuted(on: boolean) {
  muted = on;
  try {
    if (on) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // kept for this page only
  }
  for (const fn of [...fns]) fn();
  if (!on) squadSoundReady();
}

let audio: AudioContext | null = null;

/** In a press: the page's audio opened (or woken), so the room's sounds can be heard from now on */
export function squadSoundReady() {
  if (typeof window === "undefined") return;
  if (!audio) {
    const Made = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Made) return;
    try {
      audio = new Made();
    } catch {
      return;
    }
  }
  if (audio.state === "suspended") audio.resume().catch(() => {});
}

/** One 啵 at `delay` s from now, `lift` times higher than the first seat's */
function pop(ctx: AudioContext, lift: number, delay: number) {
  const at = ctx.currentTime + 0.01 + delay;
  const len = 0.13;
  const o = ctx.createOscillator();
  const v = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(1100 * lift, at);
  o.frequency.exponentialRampToValueAtTime(380 * lift, at + len * 0.7);
  v.gain.setValueAtTime(0.0001, at);
  v.gain.exponentialRampToValueAtTime(0.32, at + 0.008);
  v.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(v).connect(ctx.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

/** 啵 for the seat given (0 the first in the room), unless muted or the audio was never opened */
export function squadPop(seat: number) {
  if (!audio || mutedNow() || audio.state !== "running") return;
  pop(audio, Math.pow(2, (Math.max(0, seat) * 2) / 12), 0);
}

/** A line said to you (对 TA 说): two more 啵 after its own, a fifth and an octave up, unless muted */
export function squadDing() {
  if (!audio || mutedNow() || audio.state !== "running") return;
  pop(audio, 1.5, 0.16);
  pop(audio, 2, 0.3);
}
