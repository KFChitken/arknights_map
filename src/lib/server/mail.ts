import nodemailer from "nodemailer";
import { fmt, T } from "@/i18n";
import { SITE_NAME } from "../rules";
import { MAIL_FROM, SMTP_URL } from "./env";

// Mailpit in development; any SMTP provider (e.g. Resend's SMTP relay) in production. A mail server
// that cannot be reached is given up on after 15 seconds rather than nodemailer's two minutes. A few
// connections stay open and are reused (2026-11-11: with a new connection and TLS handshake for every
// code, hundreds an hour could not reach Resend while the server's outgoing traffic was held down).
const transport = nodemailer.createTransport({
  url: SMTP_URL,
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  connectionTimeout: 15_000,
  greetingTimeout: 10_000,
});

/**
 * Whether the mail server was never reached (it could not be found, connected to or did not greet),
 * so nothing was handed over: sending again cannot make two, and a code in it never arrived.
 */
export function neverReached(e: unknown) {
  const x = e as { code?: unknown; timeoutType?: unknown } | null;
  return x?.code === "EDNS" || (x?.code === "ETIMEDOUT" && ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(String(x.timeoutType)));
}

/**
 * Resend turning a mail away for coming too fast (it takes 10 a second for a team): it took nothing, so
 * sending again cannot make two. Any other 550 (an address it will not send to) is final.
 */
export function rateLimited(e: unknown) {
  const x = e as { responseCode?: unknown; response?: unknown } | null;
  return x?.responseCode === 550 && /too many requests/i.test(String(x.response ?? ""));
}

/** Times a mail turned away for coming too fast is sent again, each a second or two later */
const BUSY_TRIES = 2;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send: once more when the mail server could not be reached the first time, and up to BUSY_TRIES more,
 * 1 to 2 seconds apart, when it said too many came at once (11/11 peak: 16 codes lost to that in 89 minutes)
 */
export async function sendWith(
  t: { sendMail: (mail: Parameters<typeof transport.sendMail>[0]) => Promise<unknown> },
  mail: Parameters<typeof transport.sendMail>[0],
  wait: (ms: number) => Promise<unknown> = pause,
) {
  let unreached = 0;
  let busy = 0;
  for (;;) {
    try {
      await t.sendMail(mail);
      return;
    } catch (e) {
      if (neverReached(e) && unreached < 1) unreached++;
      else if (rateLimited(e) && busy < BUSY_TRIES) {
        busy++;
        await wait(1000 + Math.random() * 1000);
      } else throw e;
    }
  }
}

const send = (mail: Parameters<typeof transport.sendMail>[0]) => sendWith(transport, mail);

/** The sign-in code's email, for a code that works minutes more */
export function loginCodeMail(code: string, minutes: number) {
  const codeIs = fmt(T.server.mail.siteCodeIs, { site: SITE_NAME });
  const valid = fmt(T.server.mail.valid, { minutes });
  return {
    subject: fmt(T.server.mail.subject, { code, site: SITE_NAME }),
    text: [fmt(T.server.mail.codeIs, { code }), "", valid].join("\n"),
    html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">
<p>${codeIs}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="color:#6b7280">${valid}</p>
</div>`,
  };
}

/** A code that works until expiresAt (an earlier code sent again has less left) */
export async function sendLoginCode(to: string, code: string, expiresAt: Date) {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  await send({ from: MAIL_FROM, to, ...loginCodeMail(code, minutes) });
}

/** A plain note to the admins; it never carries anyone's personal details. */
export async function sendAdminMail(to: string[], subject: string, text: string) {
  await send({ from: MAIL_FROM, to, subject, text });
}
