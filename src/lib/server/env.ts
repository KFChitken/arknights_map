import { SITE_NAME } from "../rules";

export const isProd = process.env.NODE_ENV === "production";

export const DATABASE_URL = process.env.DATABASE_URL || "postgres://roach:roach@localhost:5432/roach";
export const SMTP_URL = process.env.SMTP_URL || "smtp://localhost:1025";
export const MAIL_FROM = process.env.MAIL_FROM || `${SITE_NAME} <no-reply@roach.local>`;

/** Emails the whole site may send in any 24 hours (codes and report digests); kept under the mail provider's daily quota (100 on Resend's free plan). */
export const MAIL_DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT) || 90;

/** Show roaches on the map that belong to nobody (src/lib/world/bots.ts); 0 or unset shows none. */
export const SHOW_BOTS = Math.min(Math.max(Math.floor(Number(process.env.SHOW_BOTS) || 0), 0), 20_000);

/**
 * Small pictures of the game characters, which belong to Hypergryph. They live in a folder
 * outside the repository (scripts/fetch-operator-art.mjs); OPERATOR_AVATARS=off takes them
 * all down at once, and names show alone.
 */
export const OPERATOR_AVATARS = process.env.OPERATOR_AVATARS !== "off";
export const OPERATOR_ART_DIR = process.env.OPERATOR_ART_DIR || "operator-art";

/**
 * The guides' pictures are not ours to publish either: they live in their own folder outside
 * the repository (cut out with scripts/cutout.mjs). AMIYA_PICTURE=off takes 阿米娅向导's down,
 * and she shows as a pink-lit hood instead; PERLICA_PICTURE=off, 佩丽卡监督's (a cyan-lit hood);
 * TALULAH_PICTURE=off, 塔露拉干员's (an orange-lit hood, her fire still burning).
 * MINGHE_PICTURE=off, 明河都尉's (a white-lit hood riding his horse, which is drawn in code).
 * AMIYA_DANCE=off takes down 阿米娅向导's dance and its music (from a video by a bilibili
 * artist, 疚刃), and tapping her only opens her card again.
 */
export const AMIYA_PICTURE = process.env.AMIYA_PICTURE !== "off";
export const PERLICA_PICTURE = process.env.PERLICA_PICTURE !== "off";
export const TALULAH_PICTURE = process.env.TALULAH_PICTURE !== "off";
export const MINGHE_PICTURE = process.env.MINGHE_PICTURE !== "off";
export const AMIYA_DANCE = AMIYA_PICTURE && process.env.AMIYA_DANCE !== "off";
export const GUIDE_ART_DIR = process.env.GUIDE_ART_DIR || "guide-art";

/** Our own overseas map's files in development (src/app/tiles); Caddy serves them on the live site */
export const TILES_DIR = process.env.TILES_DIR || "tiles";

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
