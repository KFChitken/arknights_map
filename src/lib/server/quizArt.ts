import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { OPERATOR_ART_DIR } from "./env";

/**
 * 凯尔希随堂测's pictures (src/lib/squadMode.ts), made from a character's pass picture (operator-art/pass, passArt.ts)
 * as a question asks for one, with sharp (Next.js's own, for its pictures): a silhouette, the picture's shape in one
 * dark colour (from its small copy), or a square part of it that is mostly the character (from its whole copy; seed
 * picks where, the same for everyone in the room), as a small WebP in a data: URL, so a page never learns whose
 * picture it is. Each made once a process (KEEP of them kept). Null when sharp cannot be had here, or the file is not.
 */

type Sharp = typeof import("sharp").default;
let sharpHeld: Promise<Sharp | null> | null = null;
const loadSharp = () =>
  (sharpHeld ??= import("sharp").then(
    (m) => m.default,
    () => null,
  ));

/** Whether pictures can be made in this process */
export const quizArtReady = async () => (await loadSharp()) !== null;

const KEEP = 200;
const made = new Map<string, string>();
function keep(key: string, url: string) {
  made.set(key, url);
  if (made.size > KEEP) made.delete(made.keys().next().value!);
  return url;
}

/** A number from a seed, the same each time: mulberry32 */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAME = /^[0-9a-f]{16}$/;
const dataUrl = (b: Buffer) => `data:image/webp;base64,${b.toString("base64")}`;

/** A character's shape, dark, from the small copy of their pass picture (file: its name) */
export async function silhouetteOf(file: string): Promise<string | null> {
  if (!NAME.test(file)) return null;
  const key = `sil:${file}`;
  const hit = made.get(key);
  if (hit) return hit;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const src = await readFile(path.join(OPERATOR_ART_DIR, "pass", `${file}.s.webp`));
    const { data, info } = await sharp(src).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const out = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: { r: 17, g: 19, b: 23 } } })
      .joinChannel(data, { raw: { width: info.width, height: info.height, channels: 1 } })
      .webp({ quality: 70 })
      .toBuffer();
    return keep(key, dataUrl(out));
  } catch {
    return null;
  }
}

/** The side of the square cut out, of the picture's width; how much of it must be the character */
const CUT = 0.36;
const FULL = 0.8;
const TRIES = 40;

/** A square part of a character's whole pass picture, mostly them, where seed picks; on the scene's dark ground */
export async function cropOf(file: string, seed: number): Promise<string | null> {
  if (!NAME.test(file)) return null;
  const key = `crop:${file}:${seed}`;
  const hit = made.get(key);
  if (hit) return hit;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const src = await readFile(path.join(OPERATOR_ART_DIR, "pass", `${file}.webp`));
    const { data, info } = await sharp(src).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const side = Math.max(16, Math.round(Math.min(info.width, info.height) * CUT));
    const rand = seeded(seed);
    // how much of a square is the character, sampled every 4 px
    const cover = (x: number, y: number) => {
      let on = 0;
      let all = 0;
      for (let j = y; j < y + side; j += 4) {
        for (let i = x; i < x + side; i += 4) {
          all += 1;
          if (data[j * info.width + i] > 128) on += 1;
        }
      }
      return all ? on / all : 0;
    };
    let best = { x: 0, y: 0, c: -1 };
    for (let k = 0; k < TRIES; k++) {
      const x = Math.floor(rand() * (info.width - side));
      const y = Math.floor(rand() * (info.height - side));
      const c = cover(x, y);
      if (c > best.c) best = { x, y, c };
      if (c >= FULL) break;
    }
    const out = await sharp(src)
      .extract({ left: best.x, top: best.y, width: side, height: side })
      .flatten({ background: { r: 42, g: 44, b: 49 } })
      .resize(200, 200)
      .webp({ quality: 72 })
      .toBuffer();
    return keep(key, dataUrl(out));
  } catch {
    return null;
  }
}

/** For the tests: what was made, forgotten */
export function forgetQuizArt() {
  made.clear();
}
