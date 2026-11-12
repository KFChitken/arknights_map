import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticator codes (RFC 6238 TOTP: HMAC-SHA-1, 6 digits, a new one every 30 seconds), as Google Authenticator,
 * Microsoft Authenticator and the iPhone's own 「密码」 app make them. A code one step early or late still counts,
 * for a phone's clock that is a little off.
 */

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
/** Steps either side of now that still count */
const DRIFT = 1;
/** What the authenticator app shows above the codes (the account name beside it is the alias, never an email) */
export const TOTP_ISSUER = "舟P 管理台";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, without the padding authenticator apps do not want */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** base32 back to bytes: spaces and case do not matter; null for anything else */
export function fromBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const i = BASE32.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A new secret: 20 random bytes (RFC 4226's length for SHA-1), in base32 */
export const newTotpSecret = () => base32(randomBytes(20));

/** The secret for typing in by hand, in groups of four */
export const groupedSecret = (secret: string) => secret.replace(/(.{4})(?=.)/g, "$1 ");

/** What the QR code holds: the issuer and the alias, never the email */
export function totpUri(secret: string, alias: string) {
  const issuer = encodeURIComponent(TOTP_ISSUER);
  return `otpauth://totp/${issuer}:${encodeURIComponent(alias)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_S}`;
}

/** The 30-second step a moment falls in */
export const totpStep = (now: number) => Math.floor(now / 1000 / TOTP_PERIOD_S);

/** The code of one step (RFC 4226's dynamic truncation) */
export function totpCode(secret: string | Buffer, step: number) {
  const key = typeof secret === "string" ? fromBase32(secret) : secret;
  if (!key) throw new Error("not a base32 secret");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(n).padStart(TOTP_DIGITS, "0");
}

/** Six digits as typed, spaces and all; null for anything else */
export function cleanCode(code: unknown): string | null {
  const digits = String(code ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The step a code is right for, within DRIFT steps of now; null when it is right for none. A step at or before
 * lastStep was used already, so its code counts as used (null too): matchTotpUsed tells the two apart.
 */
export function matchTotp(secret: string, code: unknown, now: number, lastStep: number | null): number | null {
  const step = rightStep(secret, code, now);
  return step !== null && (lastStep === null || step > lastStep) ? step : null;
}

/** The step a code is right for, used or not */
export function rightStep(secret: string, code: unknown, now: number): number | null {
  const digits = cleanCode(code);
  if (!digits) return null;
  const at = totpStep(now);
  let found: number | null = null;
  // every step is compared, so the time taken never tells which one matched
  for (let step = at - DRIFT; step <= at + DRIFT; step++) {
    if (same(totpCode(secret, step), digits) && found === null) found = step;
  }
  return found;
}
