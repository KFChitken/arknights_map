import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FISH_ART_DIR, fishGameMode } from "./env";

// the pictures' files, named by their content, so a name never points at a different picture
const FILE = /^[0-9a-f]{16}\.webp$/;

/** One of 钓鳞's 方舟原物 pictures, or null while FISH_GAME is off, when it is missing, or not such a file's name at all */
export async function fishArtFile(file: string) {
  if (fishGameMode() === "off" || !FILE.test(file)) return null;
  return readFile(path.join(FISH_ART_DIR, file)).catch(() => null);
}
