"use client";

import { useEffect, useState, type FormEvent } from "react";
import { finishSignup, requestCode, verifyCode } from "@/lib/authClient";
import { LOGIN_CODE_COOLDOWN_S, LOGIN_CODE_TTL_MIN, SITE_NAME } from "@/lib/rules";
import Sheet from "./Sheet";

type Step = "email" | "code" | "signup";

/**
 * A code sent from this tab and not used yet. Phones often reload the page
 * while the player is off reading the email, so the sheet comes back at the
 * code step instead of starting over.
 */
type Pending = { email: string; sentAt: number };
const PENDING = "zhoup.login";

export function pendingLogin(): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null");
    const fresh = typeof p?.sentAt === "number" && Date.now() - p.sentAt < LOGIN_CODE_TTL_MIN * 60_000;
    return fresh && typeof p.email === "string" ? { email: p.email, sentAt: p.sentAt } : null;
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

const waitAfter = (sentAt: number) => Math.max(0, LOGIN_CODE_COOLDOWN_S - Math.floor((Date.now() - sentAt) / 1000));

/** Email + 6-digit code sign-in; new players add their birth month and consent once. */
export default function LoginSheet({ reason, onDone, onClose }: { reason?: string; onDone: () => void; onClose: () => void }) {
  const [resumed] = useState(pendingLogin);
  const [step, setStep] = useState<Step>(resumed ? "code" : "email");
  const [email, setEmail] = useState(resumed?.email ?? "");
  const [code, setCode] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [wait, setWait] = useState(() => (resumed ? waitAfter(resumed.sentAt) : 0));

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
      keepPending({ email: email.trim(), sentAt: Date.now() });
      setWait(LOGIN_CODE_COOLDOWN_S);
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
      await finishSignup(Number(year), Number(month), agree);
      onDone();
    });
  };

  const thisYear = new Date().getFullYear();

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
          <button className="primary wide" disabled={busy || !email.trim()}>
            {busy ? "发送中…" : "发送验证码"}
          </button>
          <p className="hint">不用密码，每次用邮件里的 6 位验证码登录。第一次登录会自动注册。</p>
        </form>
      )}

      {step === "code" && (
        <form className="login" onSubmit={verify}>
          <p className="hint" style={{ marginTop: 0 }}>
            验证码发到了 {email}，10 分钟内有效。
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
              {wait > 0 ? `${wait} 秒后可重发` : "重新发送"}
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
            邮箱验证好了，还差一步。出生年月只用来确认年龄，不会保存。
          </p>
          <div className="birth">
            <select value={year} onChange={(e) => setYear(e.target.value)} required aria-label="出生年份">
              <option value="">出生年份</option>
              {Array.from({ length: 80 }, (_, i) => thisYear - i).map((y) => (
                <option key={y} value={y}>
                  {y} 年
                </option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} required aria-label="出生月份">
              <option value="">月份</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m} 月
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              我已阅读并同意{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                隐私说明
              </a>
            </span>
          </label>
          <button className="primary wide" disabled={busy || !year || !month || !agree}>
            {busy ? "注册中…" : "完成注册"}
          </button>
        </form>
      )}

      {error && <p className="login-error">{error}</p>}
    </Sheet>
  );
}
