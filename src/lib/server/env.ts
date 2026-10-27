import { SITE_NAME } from "../rules";

export const isProd = process.env.NODE_ENV === "production";

export const DATABASE_URL = process.env.DATABASE_URL || "postgres://roach:roach@localhost:5432/roach";
export const SMTP_URL = process.env.SMTP_URL || "smtp://localhost:1025";
export const MAIL_FROM = process.env.MAIL_FROM || `${SITE_NAME} <no-reply@roach.local>`;

/** Emails the whole site may send in any 24 hours (codes and report digests); kept under the mail provider's daily quota (100 on Resend's free plan). */
export const MAIL_DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT) || 90;

/** Show roaches on the map that belong to nobody (src/lib/world/bots.ts); 0 or unset shows none. */
export const SHOW_BOTS = Math.min(Math.max(Math.floor(Number(process.env.SHOW_BOTS) || 0), 0), 20_000);

/** Where links in emails point. */
export const SITE_URL = process.env.SITE_URL || (isProd ? "https://zhoupmap.com" : "http://localhost:3000");

/** Accounts (by sign-in email, comma separated) that may open /admin; they also get the report digest. */
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Port of a local test inbox (Mailpit) to link from the sign-in screen; unset in production. */
export const DEV_MAILBOX_PORT = process.env.DEV_MAILBOX_PORT || "";

/** Demo players and test identities: on in development unless DEMO=0, off in production unless DEMO=1. */
export const demoEnabled = process.env.DEMO ? process.env.DEMO === "1" : !isProd;

export function secret(name: "AUTH_SECRET"): string {
  const v = process.env[name];
  if (!v || v.length < 16) throw new Error(`${name} must be set to a random string of at least 16 characters`);
  return v;
}
