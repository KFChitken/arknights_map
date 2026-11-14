import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPassChar } from "../passCatalog";
import type { PassArtList } from "../passArt";
import { OPERATOR_ART_DIR, passArtOn, passArtSkipped } from "./env";

/**
 * The characters' pictures (立绘) on passes (src/lib/passArt.ts): made by scripts/fetch-pass-art.mjs into the pass
 * folder beside the small pictures (operatorArt.ts), so they travel to the servers and are served the same way
 * (scripts/deploy.sh; deploy/Caddyfile hands the files out itself). index.json there: catalogue id → the files'
 * name and the pass's colour. PASS_ART and PASS_ART_SKIP (env.ts) take all or some down: the pages stop asking for
 * them, and this server stops sending them (Caddy's straight copy goes on until the files are taken away too).
 */
export type PassArt = { file: string; color: string | null };

const DIR = path.join(OPERATOR_ART_DIR, "pass");
// named by their content, so a name never points at a different picture
const NAME = /^[0-9a-f]{16}$/;
const FILE = /^([0-9a-f]{16})(?:\.s|\.b)?\.(avif|webp)$/;
let cached: { at: number; all: ReadonlyMap<number, PassArt> } | null = null;

/** Every picture there is, read again a minute after the last time, so pictures copied in later show without a restart */
async function everyPicture(): Promise<ReadonlyMap<number, PassArt>> {
  if (cached && Date.now() - cached.at < 60_000) return cached.all;
  const all = new Map<number, PassArt>();
  try {
    const raw = JSON.parse(await readFile(path.join(DIR, "index.json"), "utf8")) as { art?: Record<string, { file?: unknown; color?: unknown }> };
    for (const [key, a] of Object.entries(raw.art ?? {})) {
      const id = Number(key);
      if (!isPassChar(id) || typeof a.file !== "string" || !NAME.test(a.file)) continue;
      const color = typeof a.color === "string" && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.toLowerCase() : null;
      all.set(id, { file: a.file, color });
    }
  } catch {
    // not made here: passes show the small pictures
  }
  cached = { at: Date.now(), all };
  return all;
}

/** The pictures that may be shown: none while PASS_ART is off, those PASS_ART_SKIP names left out */
export async function passArtIndex(): Promise<ReadonlyMap<number, PassArt>> {
  if (!passArtOn()) return new Map();
  const all = await everyPicture();
  const skip = passArtSkipped();
  return skip.size ? new Map([...all].filter(([id]) => !skip.has(id))) : all;
}

/** As the page gets them (/api/pass-art) */
export async function passArtList(): Promise<PassArtList> {
  const list: PassArtList = {};
  for (const [id, a] of await passArtIndex()) list[id] = [a.file, a.color];
  return list;
}

/** One of the files and its type, or null: switched off, skipped, missing, or not a picture's name at all */
export async function passArtFile(file: string): Promise<{ bytes: Buffer; type: string } | null> {
  const m = FILE.exec(file);
  if (!m) return null;
  const shown = [...(await passArtIndex()).values()].some((a) => a.file === m[1]);
  if (!shown) return null;
  const bytes = await readFile(path.join(DIR, file)).catch(() => null);
  return bytes && { bytes, type: `image/${m[2]}` };
}

/** Forget the index read last (the tests change it) */
export function forgetPassArt() {
  cached = null;
}
