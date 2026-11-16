// Types of scripts/beat-analysis.mjs, for its tests (src/lib/beatMusic.test.ts)
import type { Catalog } from "./msr-music.mjs";

export type Rules = {
  bpm: [number, number];
  windowS: number;
  preS: number;
  postS: number;
  rmsMs: number;
  contrast: number;
  hits: number;
};
export const SR: number;
export const HOP: number;
export const FPS: number;
export const RULES: Rules;
export const ANALYSIS_V: number;
export const ONSET_LAG_S: number;

export type FftTables = { n: number; rev: Uint32Array; cos: Float64Array; sin: Float64Array };
export function fftTables(n: number): FftTables;
export function fft(re: Float64Array, im: Float64Array, t: FftTables): void;

export type Features = { frames: number; env: Float32Array; low: Float32Array; chroma: Float32Array; loud: Float32Array };
export function features(samples: Float32Array): Features;
export function tempoOf(env: Float32Array, rules?: Rules): { bpm: number; period: number } | null;
export function beatFrames(env: Float32Array, period: number, tightness?: number): number[];
export function beatTimes(env: Float32Array, frames: number[]): Float64Array;

export type Stretch = { first: number; period: number; bpm: number; rms: number; most: number; from: number; to: number };
export function steadiest(beats: ArrayLike<number>, rules?: Rules): Stretch | null;
export function clarity(env: Float32Array, w: Stretch): { contrast: number; hits: number };
export function barOf(f: Features, w: Stretch): { bar: number; waltz: boolean };

/** What a song's samples come to: a clip's beats, or why it has none (with the beats it found, where it got that far) */
export type Analysis = {
  none?: "tempo" | "steady" | "clear" | "waltz";
  first?: number;
  period?: number;
  bpm?: number;
  beats?: number;
  rms?: number;
  most?: number;
  contrast?: number;
  hits?: number;
  bar?: number;
};
export function analyse(samples: Float32Array, rules?: Rules): Analysis;

export function squashName(s: unknown): string;
export type Candidate = {
  song: string;
  name: string;
  album: string;
  file: string;
  seconds: number;
  first: number;
  period: number;
  bpm: number;
  bar: number;
  rms: number;
  contrast: number;
  hot: number | null;
};
export function candidatesOf(catalog: Catalog, analyses: Record<string, Analysis & { v: number }>, hotNames: string[]): Candidate[];
export function pickClips(candidates: Candidate[], n: number, named?: string[] | null): Candidate[];
export function clipPlan(c: Pick<Candidate, "first" | "seconds">, rules?: Rules): { start: number; seconds: number };
export type Cut = { c: Candidate; plan: { start: number; seconds: number }; file: string; bytes: number; ms: number };
export type Manifest = {
  v: 1;
  updated: string;
  clips: { song: string; file: string; beat: number; first: number; bar: number; ms: number; bytes: number }[];
};
export function manifestOf(cut: Cut[], now?: Date): Manifest;
