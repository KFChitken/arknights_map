import { siteName } from "../rules";

export const isProd = process.env.NODE_ENV === "production";

export const DATABASE_URL = process.env.DATABASE_URL || "postgres://roach:roach@localhost:5432/roach";
export const SMTP_URL = process.env.SMTP_URL || "smtp://localhost:1025";
export const mailFrom = () => process.env.MAIL_FROM || `${siteName()} <no-reply@roach.local>`;

/** Sign-in code emails the whole site may send in any 24 hours (report reminders have rules of their own, src/lib/server/safety.ts); kept within the mail provider's quota. */
export const MAIL_DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT) || 90;

/**
 * Mail services slow to take our mail just now (comma separated, e.g. gmail.com,googlemail.com): an
 * address there is told after its code is sent that it may take long, and that QQ or 163 is quicker
 * for a new account. A switch on the server: empty or unset says nothing (2026-11-11, for Gmail).
 */
export const MAIL_SLOW_DOMAINS = (process.env.MAIL_SLOW_DOMAINS || "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
/**
 * While a service is slow (MAIL_SLOW_DOMAINS), codes to it have caps of their own, for every address
 * there together: in any 24 hours, in any hour, and to one address in a day (2026-11-11: Gmail limits
 * a sending domain whose mail grew too fast; Resend's advice is to send it less and raise it slowly).
 */
export const MAIL_SLOW_DAILY_LIMIT = Number(process.env.MAIL_SLOW_DAILY_LIMIT) || 500;
export const MAIL_SLOW_HOURLY_LIMIT = Number(process.env.MAIL_SLOW_HOURLY_LIMIT) || 30;
export const MAIL_SLOW_PER_ADDRESS = Number(process.env.MAIL_SLOW_PER_ADDRESS) || 3;
/**
 * Of those caps, the share codes to an address with no account yet may take (rounded down, each of the
 * day's and the hour's), so the players who have one can still sign in. 0 reads as the default, like the
 * caps above; below 0 (e.g. -1) sends none to a new address there, and to players with an account as before.
 */
export const MAIL_SLOW_NEW_SHARE = Number(process.env.MAIL_SLOW_NEW_SHARE) || 0.3;

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
 * SI_PICTURE=off, 祀掌柜's (a red-lit hood; her scroll, ink butterflies and inn are drawn in code and stay).
 * AMIYA_DANCE=off takes down 阿米娅向导's dance and its music (from a video by a bilibili
 * artist, 疚刃), and tapping her only opens her card again. PARTY_MUSIC=off takes down
 * ⚡舟友的酒⚡'s music (by 活跃黑江乐 on bilibili); the phantoms then dance in silence.
 */
export const AMIYA_PICTURE = process.env.AMIYA_PICTURE !== "off";
export const PERLICA_PICTURE = process.env.PERLICA_PICTURE !== "off";
export const TALULAH_PICTURE = process.env.TALULAH_PICTURE !== "off";
export const MINGHE_PICTURE = process.env.MINGHE_PICTURE !== "off";
export const SI_PICTURE = process.env.SI_PICTURE !== "off";
export const AMIYA_DANCE = AMIYA_PICTURE && process.env.AMIYA_DANCE !== "off";
export const PARTY_MUSIC = process.env.PARTY_MUSIC !== "off";
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

/**
 * The site's own checks (src/lib/server/watch.ts), which email WATCH_EMAILS (comma separated;
 * ADMIN_EMAILS when unset) about problems: on in production unless WATCH=off, off in
 * development unless WATCH=1. WATCH_TLS_HOST: where to ask for the HTTPS certificate
 * (Caddy, "caddy" on the live site's network; none in development unless set). WATCH_DOORS:
 * the other ways in to ask the site through (comma separated addresses, with :port when it is
 * not 443): the second server's private address on the live site (deploy/relay).
 */
export const watchEnabled = process.env.WATCH ? !["off", "0"].includes(process.env.WATCH) : isProd;
export const WATCH_EMAILS = process.env.WATCH_EMAILS
  ? process.env.WATCH_EMAILS.split(",")
      .map((e) => e.trim())
      .filter(Boolean)
  : ADMIN_EMAILS;
export const WATCH_TLS_HOST = process.env.WATCH_TLS_HOST || "";
export const WATCH_DOORS = (process.env.WATCH_DOORS || "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

/** The Beijing hour from which the checks' daily digest goes out (the first round at or after it), 9 unless set to 0–23 */
const digestHour = Number(process.env.WATCH_DIGEST_HOUR || 9);
export const WATCH_DIGEST_HOUR = Number.isInteger(digestHour) && digestHour >= 0 && digestHour <= 23 ? digestHour : 9;

/**
 * Which map visitors from mainland China start with (src/lib/server/mainlandMap.ts): auto (the default) is 高德's,
 * or 腾讯's for the rest of a Beijing month in which 高德's map loads ran out; amap, tencent or own (ours) holds
 * one whatever happens, until set back. Each still falls back to the next when it cannot load.
 */
export const MAINLAND_MAP = (["amap", "tencent", "own"] as const).find((m) => m === process.env.MAINLAND_MAP) ?? "auto";

/** Port of a local test inbox (Mailpit) to link from the sign-in screen; unset in production. */
export const DEV_MAILBOX_PORT = process.env.DEV_MAILBOX_PORT || "";

/** Demo players and test identities: on in development unless DEMO=0, off in production unless DEMO=1. */
export const demoEnabled = process.env.DEMO ? process.env.DEMO === "1" : !isProd;

export function secret(name: "AUTH_SECRET"): string {
  const v = process.env[name];
  if (!v || v.length < 16) throw new Error(`${name} must be set to a random string of at least 16 characters`);
  return v;
}
