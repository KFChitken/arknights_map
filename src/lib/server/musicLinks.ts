import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SONG_FILE } from "../listen";
import { secret } from "./env";

/**
 * 听歌's songs go out at links that last 6 to 12 hours: /music/<file>?k=<exp>.<sig>, where exp is a moment in Unix
 * seconds, the end of the 6-hour block now plus 6 hours, and sig the first 22 characters (base64url) of an HMAC of
 * "<file>.<exp>". Every link given in one block is the same for everyone, so a browser's copy of a song is used
 * again (on repeat, or 再来亿遍). Caddy asks /api/listen/ok before each file goes out (deploy/Caddyfile), which checks
 * the link with no database, no sign-in and no limit; src/app/music checks it the same way in development.
 * The key comes from AUTH_SECRET, the same on every server: nothing new to keep.
 */

const BLOCK_S = 6 * 3600;
/** A link is never good for longer than this from now */
export const LINK_MAX_S = 2 * BLOCK_S;

const LINK = /^\/music\/([0-9a-f]{16}\.m4a)\?k=(\d{1,12})\.([A-Za-z0-9_-]{22})$/;

let keyed: { from: string; key: Buffer } | null = null;
function key() {
  const from = secret("AUTH_SECRET");
  if (keyed?.from !== from) keyed = { from, key: createHmac("sha256", from).update("music-link").digest() };
  return keyed.key;
}

const signature = (file: string, exp: number) => createHmac("sha256", key()).update(`${file}.${exp}`).digest("base64url").slice(0, 22);

/** When the links given now stop working, in Unix seconds */
export function linkExpiry(now = Date.now()) {
  return (Math.floor(now / 1000 / BLOCK_S) + 2) * BLOCK_S;
}

/** The link to a song's file, as given now */
export function musicLink(file: string, now = Date.now()) {
  if (!SONG_FILE.test(file)) throw new Error(`not a song's file: ${file}`);
  const exp = linkExpiry(now);
  return `/music/${file}?k=${exp}.${signature(file, exp)}`;
}

/** Whether a path with its query (as Caddy passes it on, X-Forwarded-Uri) is a song's link good now */
export function linkGood(uri: string, now = Date.now()) {
  const m = LINK.exec(uri);
  if (!m) return false;
  const exp = Number(m[2]);
  const s = now / 1000;
  if (!(exp > s) || exp > s + LINK_MAX_S) return false;
  const want = Buffer.from(signature(m[1], exp));
  const got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got);
}
