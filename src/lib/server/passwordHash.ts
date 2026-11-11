import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { HttpError } from "./http";

/**
 * Passwords as only an scrypt digest of them (密码登录, src/lib/server/passwords.ts), with the costs written
 * in, so digests made before a change of costs still check: scrypt$<log2 N>$<r>$<p>$<salt>$<digest>. Node's
 * own scrypt, run in its thread pool (never the Sync one), at most HASHING_AT_ONCE at a time in each
 * process, about 0.2 s and 16 MiB each; one kept waiting over WAIT_MS is turned away, as the page is told.
 */

const LOG_N = 14;
const R = 8;
const P = 5;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

export const HASHING_AT_ONCE = 2;
export const WAIT_MS = 3000;
export const BUSY = "现在登录的人有点多，过几秒再试。";

/**
 * Checked against when there is no password to check (no such account, none set, paused), so every
 * answer takes as long and none says which it was. Of no password anyone knows.
 */
export const DUMMY_HASH = "scrypt$14$8$5$k3JfO0dGhSx1lT2b9VYw7A$Qy8bT1wR6c4vZpN3sK0mJ5hX2gL7dF9aE1uC8yB4nW0";

const derive = (password: string, salt: Buffer, length: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, length, { ...options, maxmem: MAX_MEMORY }, (e, key) => (e ? reject(e) : resolve(key))),
  );

// a slot to hash in: taken at once while there is one, else waited for, the longest waiting first
let running = 0;
const waiting: (() => void)[] = [];

async function inSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < HASHING_AT_ONCE) running++;
  else {
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = waiting.indexOf(go);
        if (i >= 0) waiting.splice(i, 1);
        reject(new HttpError(503, BUSY));
      }, WAIT_MS);
      waiting.push(go);
    });
  }
  try {
    return await work();
  } finally {
    // the slot goes straight to the next one waiting
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await inSlot(() => derive(password, salt, KEY_LENGTH, { N: 2 ** LOG_N, r: R, p: P }));
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

type Digest = { logN: number; r: number; p: number; salt: Buffer; key: Buffer };

function parse(stored: string): Digest | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (![logN, r, p].every((n) => Number.isInteger(n) && n > 0) || logN > 20 || !salt.length || !key.length) return null;
  return { logN, r, p, salt, key };
}

const DUMMY = parse(DUMMY_HASH)!;

/** Whether the password is the one this digest was made of, at the costs it was made with (a bad digest: never, as slowly) */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parsed = parse(stored);
  const d = parsed ?? DUMMY;
  const key = await inSlot(() => derive(password, d.salt, d.key.length, { N: 2 ** d.logN, r: d.r, p: d.p }));
  return Boolean(parsed) && key.length === d.key.length && timingSafeEqual(key, d.key);
}
