import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Game } from "../games";
import { OPERATOR_ART_DIR, OPERATOR_AVATARS } from "./env";

/** Each game's characters that have a picture, and its file. */
export type OperatorArtIndex = Record<Game, Record<string, string>>;

const NONE: OperatorArtIndex = { arknights: {}, endfield: {} };
// files are named by their content, so a name never points at a different picture
const FILE = /^[0-9a-f]{16}\.webp$/;
let cached: { at: number; index: OperatorArtIndex } | null = null;

/** Read again a minute after the last time, so pictures copied in later show up without a restart. */
export async function operatorArtIndex(): Promise<OperatorArtIndex> {
  if (!OPERATOR_AVATARS) return NONE;
  if (cached && Date.now() - cached.at < 60_000) return cached.index;
  let index = NONE;
  try {
    const raw = JSON.parse(await readFile(path.join(OPERATOR_ART_DIR, "index.json"), "utf8"));
    index = { arknights: raw.arknights ?? {}, endfield: raw.endfield ?? {} };
  } catch {
    // not downloaded here: names show alone
  }
  cached = { at: Date.now(), index };
  return index;
}

/** One picture, or null when switched off, missing, or not a picture's file name at all. */
export async function operatorArtFile(file: string) {
  if (!OPERATOR_AVATARS || !FILE.test(file)) return null;
  return readFile(path.join(OPERATOR_ART_DIR, file)).catch(() => null);
}
