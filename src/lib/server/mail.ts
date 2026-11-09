import nodemailer from "nodemailer";
import { LOGIN_CODE_TTL_MIN, SITE_NAME } from "../rules";
import { MAIL_FROM, SMTP_URL } from "./env";

// Mailpit in development; any SMTP provider (e.g. Resend's SMTP relay) in production. A mail server
// that cannot be reached is given up on after 15 seconds rather than nodemailer's two minutes.
const transport = nodemailer.createTransport({ url: SMTP_URL, connectionTimeout: 15_000, greetingTimeout: 10_000 });

/**
 * Whether the mail server was never reached (it could not be found, connected to or did not greet),
 * so nothing was handed over: sending again cannot make two, and a code in it never arrived.
 */
export function neverReached(e: unknown) {
  const x = e as { code?: unknown; timeoutType?: unknown } | null;
  return x?.code === "EDNS" || (x?.code === "ETIMEDOUT" && ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(String(x.timeoutType)));
}

/** Send, once more when the mail server could not be reached the first time */
async function send(mail: Parameters<typeof transport.sendMail>[0]) {
  try {
    await transport.sendMail(mail);
  } catch (e) {
    if (!neverReached(e)) throw e;
    await transport.sendMail(mail);
  }
}

export async function sendLoginCode(to: string, code: string) {
  await send({
    from: MAIL_FROM,
    to,
    subject: `${code} 是你的${SITE_NAME}登录验证码`,
    text: [`你的登录验证码是：${code}`, "", `${LOGIN_CODE_TTL_MIN} 分钟内有效。如果不是你本人在登录，忽略这封邮件就好。`].join(
      "\n",
    ),
    html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">
<p>你的${SITE_NAME}登录验证码是：</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="color:#6b7280">${LOGIN_CODE_TTL_MIN} 分钟内有效。如果不是你本人在登录，忽略这封邮件就好。</p>
</div>`,
  });
}

/** A plain note to the admins; it never carries anyone's personal details. */
export async function sendAdminMail(to: string[], subject: string, text: string) {
  await send({ from: MAIL_FROM, to, subject, text });
}
