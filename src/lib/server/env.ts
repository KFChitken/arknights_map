export const isProd = process.env.NODE_ENV === "production";

export const DATABASE_URL = process.env.DATABASE_URL || "postgres://roach:roach@localhost:5432/roach";
export const SMTP_URL = process.env.SMTP_URL || "smtp://localhost:1025";
export const MAIL_FROM = process.env.MAIL_FROM || "粥P地图 <no-reply@roach.local>";

/** Port of a local test inbox (Mailpit) to link from the sign-in screen; unset in production. */
export const DEV_MAILBOX_PORT = process.env.DEV_MAILBOX_PORT || "";

/** Demo players and test identities: on in development unless DEMO=0, off in production unless DEMO=1. */
export const demoEnabled = process.env.DEMO ? process.env.DEMO === "1" : !isProd;

export function secret(name: "AUTH_SECRET"): string {
  const v = process.env[name];
  if (!v || v.length < 16) throw new Error(`${name} must be set to a random string of at least 16 characters`);
  return v;
}
