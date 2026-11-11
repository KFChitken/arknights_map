"use client";

import { useEffect, useState, type FormEvent } from "react";
import { finishSignup, requestCode, verifyCode } from "@/lib/authClient";
import { ADULT_TICK, CROSS_BORDER_TICK } from "@/lib/consent";
import { suggestEmail } from "@/lib/emailTypos";
import { LOGIN_CODE_COOLDOWNS_S, LOGIN_CODE_TTL_MIN, SITE_NAME, waitText } from "@/lib/rules";
import Sheet from "./Sheet";

type Step = "email" | "code" | "signup";

/**
 * A code sent from this tab and not used yet. Phones often reload the page
 * while the player is off reading the email, so the sheet comes back at the
 * code step instead of starting over.
 */
/** nextAt: when another code may be asked for, as the server said (the wait grows with each sending) */
type Pending = { email: string; sentAt: number; nextAt: number };
const PENDING = "zhoup.login";

export function pendingLogin(): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
    const fresh = typeof p?.sentAt === "number" && Date.now() - p.sentAt < LOGIN_CODE_TTL_MIN * 60_000;
    // one kept before nextAt was: the shortest wait after its sending
    const nextAt = typeof p?.nextAt === "number" ? p.nextAt : p?.sentAt + LOGIN_CODE_COOLDOWNS_S[0] * 1000;
    return fresh && typeof p.email === "string" ? { email: p.email, sentAt: p.sentAt, nextAt } : null;
  } catch {
    return null;
  }
}

function keepPending(p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(PENDING, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING);
  } catch {}
}

const waitUntil = (nextAt: number) => Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));

/** What a mail service is called to the player: Gmail for both of its domains, else the domain itself */
const serviceName = (domain: string) => (/^(gmail|googlemail)\.com$/.test(domain) ? "Gmail" : domain);

/**
 * Email + 6-digit code sign-in; new players tick their age and consents once. paused: the mail domains no
 * code goes to just now (MAIL_SLOW_DAILY_LIMIT below 1 on the server), said before anyone types one in.
 */
export default function LoginSheet({
  reason,
  paused = [],
  onDone,
  onClose,
}: {
  reason?: string;
  paused?: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [resumed] = useState(pendingLogin);
  const [step, setStep] = useState<Step>(resumed ? "code" : "email");
  const [email, setEmail] = useState(resumed?.email ?? "");
  const [code, setCode] = useState("");
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [wait, setWait] = useState(() => (resumed ? waitUntil(resumed.nextAt) : 0));
  // when the code sent stops working, and whether the last email carried the code sent before
  const [sent, setSent] = useState<{ expiresAt: number; again: boolean; slow: boolean } | null>(null);
  // a likely typo in the address's domain, offered and never applied by itself
  const fix = suggestEmail(email);
  // the services codes are paused to, by name, and whether the address typed is at one of them
  const pausedNames = [...new Set(paused.map(serviceName))];
  const typedDomain = email.trim().toLowerCase().slice(email.trim().lastIndexOf("@") + 1);
  const pausedHere = email.includes("@") && paused.includes(typedDomain);

  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    run(async () => {
      const r = await requestCode(email.trim());
      setMailbox(r.devMailboxPort ? `${location.protocol}//${location.hostname}:${r.devMailboxPort}` : null);
      keepPending({ email: email.trim(), sentAt: Date.now(), nextAt: Date.now() + r.waitS * 1000 });
      setSent({ expiresAt: r.expiresAt, again: r.again, slow: r.slow });
      setWait(r.waitS);
      setStep("code");
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await verifyCode(email.trim(), code.trim());
      keepPending(null);
      if (r.status === "ok") onDone();
      else setStep("signup");
    });
  };

  const signup = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await finishSignup({ adult, acceptPolicy: agree, acceptCrossBorder: abroad });
      onDone();
    });
  };

  // closed on purpose, so a reload should not bring it back
  const close = () => {
    keepPending(null);
    onClose();
  };

  return (
    <Sheet title={step === "signup" ? `第一次来${SITE_NAME}` : "登录"} onClose={close}>
      {step === "email" && (
        <form className="login" onSubmit={send}>
          {reason && <p className="hint" style={{ marginTop: 0 }}>{reason}</p>}
          {pausedNames.length > 0 && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)", fontWeight: 600 }}>
              {pausedNames.join("、")} 最近收不到我们的验证码邮件，发往 {pausedNames.join("、")} 的验证码先暂停了。请用 QQ、163 或
              Outlook 等邮箱登录；已经登录的不受影响。
            </p>
          )}
          <label className="field">
            邮箱
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {fix && (
            <p className="hint" style={{ marginTop: 0 }}>
              是不是{" "}
              <button
                type="button"
                className="link"
                style={{ fontSize: "inherit", color: "var(--ink)", textDecoration: "underline" }}
                onClick={() => setEmail(fix)}
              >
                {fix}
              </button>
              ？
            </p>
          )}
          {pausedHere && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)" }}>
              这是 {serviceName(typedDomain)} 邮箱，现在收不到验证码，请换一个邮箱。
            </p>
          )}
          <button className="primary wide" disabled={busy || !email.trim() || pausedHere}>
            {busy ? "发送中…" : "发送验证码"}
          </button>
          <p className="hint">
            不用密码，每次用邮件里的 6 位验证码登录。第一次登录会自动注册。
            <br />
            验证码邮件由 Resend USA 代发，会用到你的邮箱地址。
          </p>
        </form>
      )}

      {step === "code" && (
        <form className="login" onSubmit={verify}>
          <p className="hint" style={{ marginTop: 0 }}>
            {sent?.again ? "又发了一次" : "验证码发到了"} {email}，
            {sent ? Math.max(1, Math.round((sent.expiresAt - Date.now()) / 60_000)) : LOGIN_CODE_TTL_MIN} 分钟内有效。
          </p>
          {sent?.slow && (
            <p className="hint" style={{ color: "var(--ink)", fontWeight: 600 }}>
              Gmail 最近收我们的信比较慢，可能要等很久。还没注册的话，用 QQ 或 163 邮箱更快。
            </p>
          )}
          <p className="hint">
            邮件在路上，一般 1–3 分钟到。先翻一下「垃圾邮件」和「所有邮件」。有效期内重新发送的还是同一个验证码，哪封先到都能用。
          </p>
          {mailbox && (
            <p className="hint">
              本地测试：验证码在{" "}
              <a href={mailbox} target="_blank" rel="noreferrer">
                测试邮箱
              </a>{" "}
              里。
            </p>
          )}
          <label className="field">
            验证码
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="6 位数字"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button className="primary wide" disabled={busy || code.length !== 6}>
            {busy ? "验证中…" : "登录"}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" disabled={busy || wait > 0} onClick={() => send()}>
              {wait > 0 ? `${waitText(wait)}后可重发` : "重新发送"}
            </button>
            <button
              type="button"
              className="pill"
              onClick={() => {
                keepPending(null);
                setStep("email");
              }}
            >
              换个邮箱
            </button>
          </div>
        </form>
      )}

      {step === "signup" && (
        <form className="login" onSubmit={signup}>
          <p className="hint" style={{ marginTop: 0 }}>
            邮箱验证好了，还差一步。
          </p>
          <div className="ticks">
            <label className="check">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <span>{ADULT_TICK}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                我已阅读并同意{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  隐私说明
                </a>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} />
              <span>
                {CROSS_BORDER_TICK}{" "}
                <a href="/privacy#abroad" target="_blank" rel="noreferrer">
                  详情
                </a>
              </span>
            </label>
          </div>
          <button className="primary wide" disabled={busy || !adult || !agree || !abroad}>
            {busy ? "注册中…" : "完成注册"}
          </button>
        </form>
      )}

      {error && <p className="login-error">{error}</p>}
    </Sheet>
  );
}
