import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";
import { secret } from "./env";

/**
 * What the 管理台 keeps secret at rest (src/lib/server/admins.ts): authenticator secrets sealed with AES-256-GCM,
 * backup codes kept only as an HMAC. Both keys come from AUTH_SECRET, so changing it means setting up every
 * authenticator again: every process must have the same one.
 */

const key = (info: string) => Buffer.from(hkdfSync("sha256", secret("AUTH_SECRET"), "admin-seal", info, 32));

const SEALED = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** text, sealed: v1.<iv>.<ciphertext>.<tag>, each base64url */
export function seal(text: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key("totp v1"), iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [SEALED, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** What seal() sealed; throws for anything changed, or sealed under another AUTH_SECRET */
export function open(sealed: string): string {
  const [version, iv, body, tag, ...rest] = sealed.split(".");
  if (version !== SEALED || !iv || body === undefined || !tag || rest.length) throw new Error("not a sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key("totp v1"), Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** How many backup codes each person gets at a time */
export const BACKUP_CODES = 10;
/** Without 0, O, 1, I and L, which are easy to mix up */
const BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BACKUP_LENGTH = 8;

/** A new set of backup codes, each like 7KQ2-M9XD */
export function makeBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < BACKUP_CODES) {
    let code = "";
    for (let i = 0; i < BACKUP_LENGTH; i++) code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
    codes.add(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return [...codes];
}

/** A backup code as typed: upper case, without spaces or dashes; null when it cannot be one */
export function normalBackupCode(code: unknown): string | null {
  const clean = String(code ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  return clean.length === BACKUP_LENGTH && [...clean].every((c) => BACKUP_ALPHABET.includes(c)) ? clean : null;
}

/** What is kept of one person's backup code; null for anything that cannot be a code */
export function backupHash(userId: string, code: unknown): string | null {
  const clean = normalBackupCode(code);
  return clean ? createHmac("sha256", key("backup v1")).update(`${userId}:${clean}`).digest("base64url") : null;
}
