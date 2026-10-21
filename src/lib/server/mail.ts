import nodemailer from "nodemailer";
import { LOGIN_CODE_TTL_MIN, SITE_NAME } from "../rules";
import { MAIL_FROM, SMTP_URL } from "./env";

// Mailpit in development; any SMTP provider (e.g. Resend's SMTP relay) in production
const transport = nodemailer.createTransport(SMTP_URL);

export async function sendLoginCode(to: string, code: string) {
  await transport.sendMail({
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
