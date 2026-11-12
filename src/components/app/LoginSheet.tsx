"use client";

import { useEffect, useState, type FormEvent } from "react";
import { finishSignup, passwordLogin, redeemDeskCode, requestCode, savePassword, verifyCode } from "@/lib/authClient";
import { ADULT_TICK, CROSS_BORDER_TICK } from "@/lib/consent";
import { DESK_CODE_LENGTH, normalizeDeskCode } from "@/lib/deskCode";
import { suggestEmail } from "@/lib/emailTypos";
import { passwordProblem } from "@/lib/passwordRules";
import { LOGIN_CODE_COOLDOWNS_S, LOGIN_CODE_TTL_MIN, SITE_NAME, waitText } from "@/lib/rules";
import { isStandalone } from "./HomeScreen";
import PasswordField, { HiddenUsername } from "./PasswordField";
import Sheet from "./Sheet";

/**
 * desk: a 登录码 (src/lib/deskCode.ts) taken on a device already signed in, the iPhone home-screen icon's way in above all.
 * offer: signed in by code to an account with no password, asked whether to set one.
 */
type Step = "email" | "code" | "signup" | "desk" | "offer";
/** How the first step signs in: an emailed code, or the password set before */
type LoginWith = "code" | "password";

/** The way this device signed in last, offered first next time */
const LOGIN_WITH = "zhoup.loginWith";
/** When 「下次再说」 was tapped on the offer to set a password; it is not offered again here for OFFER_LATER_MS */
const OFFER_LATER = "zhoup.passwordLater";
const OFFER_LATER_MS = 30 * 86_400_000;

function storedLoginWith(): LoginWith {
  try {
    return localStorage.getItem(LOGIN_WITH) === "password" ? "password" : "code";
  } catch {
    return "code";
  }
}

export function keepLoginWith(how: LoginWith) {
  try {
    localStorage.setItem(LOGIN_WITH, how);
  } catch {}
}

function offerPutOff(): boolean {
  try {
    const at = Number(localStorage.getItem(OFFER_LATER));
    return at > 0 && Date.now() - at < OFFER_LATER_MS;
  } catch {
    return false;
  }
}

function putOffOffer() {
  try {
    localStorage.setItem(OFFER_LATER, String(Date.now()));
  } catch {}
}

/**
 * A code sent from this browser and not used yet. Phones often reload the page, or start the site from
 * its desktop icon afresh, while the player is off reading the email, so the sheet comes back at the code
 * step instead of starting over. In localStorage, not sessionStorage: a desktop icon on iPhone and some
 * in-app browsers start a new session on coming back (11/11: players got the code and found no box for it).
 * nextAt: when another code may be asked for, as the server said (the wait grows with each sending).
 */
type Pending = { email: string; sentAt: number; nextAt: number };
const PENDING = "zhoup.login";

export function pendingLogin(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? sessionStorage.getItem(PENDING) ?? "null");
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
    sessionStorage.removeItem(PENDING);
    if (p) localStorage.setItem(PENDING, JSON.stringify(p));
    else localStorage.removeItem(PENDING);
  } catch {}
}

const waitUntil = (nextAt: number) => Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));

/** What a mail service is called to the player: Gmail for both of its domains, else the domain itself */
export const serviceName = (domain: string) => (/^(gmail|googlemail)\.com$/.test(domain) ? "Gmail" : domain);

/**
 * Sign-in by email and a 6-digit code, or the password set before (密码登录); new players tick their age and
 * consents once, and may set a password there. paused: the mail domains no code goes to just now
 * (MAIL_SLOW_DAILY_LIMIT below 1 on the server), said before anyone types one in. Opened from the
 * home-screen icon (which on iPhone keeps cookies of its own), or on any device, a 登录码 taken where one is
 * signed in signs in without an email. fixedEmail: a signed-in player confirming it is them by code (to
 * set a password), with their own email, which cannot be changed.
 */
export default function LoginSheet({
  reason,
  paused = [],
  fixedEmail,
  onDone,
  onClose,
}: {
  reason?: string;
  paused?: string[];
  fixedEmail?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [resumed] = useState(() => {
    const p = pendingLogin();
    return p && (!fixedEmail || p.email === fixedEmail) ? p : null;
  });
  const [step, setStep] = useState<Step>(resumed ? "code" : "email");
  const [loginWith, setLoginWith] = useState<LoginWith>(() => (fixedEmail || resumed ? "code" : storedLoginWith()));
  const [email, setEmail] = useState(fixedEmail ?? resumed?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  // one to keep: picked at sign-up, or on the offer after a code sign-in
  const [newPassword, setNewPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [wait, setWait] = useState(() => (resumed ? waitUntil(resumed.nextAt) : 0));
  // when the code sent stops working, and whether the last email carried the code sent before
  const [sent, setSent] = useState<{ expiresAt: number; again: boolean; slow: boolean } | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [desk, setDesk] = useState("");
  useEffect(() => setStandalone(isStandalone()), []);
  const byPassword = loginWith === "password" && !fixedEmail;
  // a likely typo in the address's domain, offered and never applied by itself
  const fix = fixedEmail ? null : suggestEmail(email);
  // the services codes are paused to, by name, and whether the address typed is at one of them
  const pausedNames = [...new Set(paused.map(serviceName))];
  const typedDomain = email.trim().toLowerCase().slice(email.trim().lastIndexOf("@") + 1);
  const pausedHere = email.includes("@") && paused.includes(typedDomain);
  // what the password to keep breaks of the rules, if anything (the server checks again)
  const newProblem = newPassword ? passwordProblem(newPassword, email.trim()) : null;

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

  // a code asked for earlier, from this page or another: straight to the box for it, nothing sent
  const [typedIn, setTypedIn] = useState(false);
  const haveCode = () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return setError("先在上面填好收到验证码的那个邮箱。");
    setError(null);
    setSent(null);
    setWait(0);
    setTypedIn(true);
    keepPending({ email: to, sentAt: Date.now(), nextAt: Date.now() });
    setStep("code");
  };

  const switchTo = (how: LoginWith) => {
    setLoginWith(how);
    keepLoginWith(how);
    setError(null);
  };

  // from the code step, where a slow mail service may hold the code back: the password, same email (the code
  // asked for stays good, should it come after all)
  const toPassword = () => {
    switchTo("password");
    setStep("email");
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    run(async () => {
      const r = await requestCode(email.trim());
      setMailbox(r.devMailboxPort ? `${location.protocol}//${location.hostname}:${r.devMailboxPort}` : null);
      keepPending({ email: email.trim(), sentAt: Date.now(), nextAt: Date.now() + r.waitS * 1000 });
      setSent({ expiresAt: r.expiresAt, again: r.again, slow: r.slow });
      setTypedIn(false);
      setWait(r.waitS);
      setStep("code");
    });
  };

  const signInWithPassword = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await passwordLogin(email.trim(), password);
      keepPending(null);
      onDone();
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await verifyCode(email.trim(), code.trim());
      keepPending(null);
      if (r.status === "signup") return setStep("signup");
      // a player without a password is asked once whether to set one, unless they said 下次再说 lately
      if (!fixedEmail && r.hasPassword === false && !offerPutOff()) return setStep("offer");
      onDone();
    });
  };

  const signup = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await finishSignup({ adult, acceptPolicy: agree, acceptCrossBorder: abroad, password: newPassword || undefined });
      if (newPassword) keepLoginWith("password");
      onDone();
    });
  };

  // the offer after a code sign-in, moments ago, so no more is asked
  const keepOffered = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await savePassword(newPassword);
      if ("needsCode" in r) throw new Error("没设上。在「我的资料」里再设一次。");
      keepLoginWith("password");
      onDone();
    });
  };

  const later = () => {
    putOffOffer();
    onDone();
  };

  const redeem = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await redeemDeskCode(desk);
      keepPending(null);
      onDone();
    });
  };

  // closed on purpose, so a reload should not bring it back; closing the offer, the player is signed in all the same
  const close = () => {
    keepPending(null);
    if (step === "offer") onDone();
    else onClose();
  };

  const title = fixedEmail
    ? "确认是你本人"
    : step === "signup"
      ? `第一次来${SITE_NAME}`
      : step === "desk"
        ? "用登录码登录"
        : step === "offer"
          ? "登录好了"
          : "登录";

  return (
    <Sheet title={title} onClose={close}>
      {step === "email" && standalone && !fixedEmail && (
        <div className="desk-login">
          <p>从桌面图标打开的？用在 Safari 里拿的登录码登录，不用再收验证码邮件。</p>
          <button type="button" className="primary wide" onClick={() => setStep("desk")}>
            输入登录码
          </button>
        </div>
      )}
      {step === "email" && (
        <form className="login" onSubmit={byPassword ? signInWithPassword : send}>
          {reason && <p className="hint" style={{ marginTop: 0 }}>{reason}</p>}
          {!byPassword && pausedNames.length > 0 && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)", fontWeight: 600 }}>
              {pausedNames.join("、")} 最近收不到我们的验证码邮件，发往 {pausedNames.join("、")} 的验证码先暂停了。请用 QQ、163 或
              Outlook 等邮箱登录；已经登录的不受影响。{!fixedEmail && "设过密码的可以切到「密码」直接登录。"}
            </p>
          )}
          <label className="field">
            邮箱
            <input
              type="email"
              inputMode="email"
              autoComplete={byPassword ? "username" : "email"}
              required
              readOnly={Boolean(fixedEmail)}
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
          {!byPassword && pausedHere && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)" }}>
              这是 {serviceName(typedDomain)} 邮箱，现在收不到验证码，{fixedEmail ? "等恢复了再来。" : "请换一个邮箱。"}
            </p>
          )}
          {!fixedEmail && (
            <div className="seg login-with" role="group" aria-label="登录方式">
              <button type="button" className={byPassword ? "" : "on"} aria-pressed={!byPassword} onClick={() => switchTo("code")}>
                验证码
              </button>
              <button type="button" className={byPassword ? "on" : ""} aria-pressed={byPassword} onClick={() => switchTo("password")}>
                密码
              </button>
            </div>
          )}
          {byPassword ? (
            <>
              <PasswordField label="密码" autoComplete="current-password" value={password} onChange={setPassword} />
              <button className="primary wide" disabled={busy || !email.trim() || !password}>
                {busy ? "登录中…" : "登录"}
              </button>
              <div className="row-actions">
                <button type="button" className="pill" onClick={() => switchTo("code")}>
                  忘记密码？用验证码登录
                </button>
                {!standalone && (
                  <button type="button" className="pill" onClick={() => setStep("desk")}>
                    有登录码？
                  </button>
                )}
              </div>
              <p className="hint">第一次来请用验证码，会自动注册。</p>
            </>
          ) : (
            <>
              <button className="primary wide" disabled={busy || !email.trim() || pausedHere}>
                {busy ? "发送中…" : "发送验证码"}
              </button>
              <div className="row-actions">
                {/* the email came, but this page no longer knows a code went out: another tab, or the desktop icon started afresh */}
                <button type="button" className="pill" onClick={haveCode}>
                  已经收到验证码？
                </button>
                {/* a 登录码 from a device already signed in; opened from the iPhone home-screen icon, it is offered above */}
                {!standalone && !fixedEmail && (
                  <button type="button" className="pill" onClick={() => setStep("desk")}>
                    有登录码？
                  </button>
                )}
              </div>
              <p className="hint">
                {!fixedEmail && (
                  <>
                    第一次来用验证码登录，会自动注册；设过密码的可以直接用密码。
                    <br />
                  </>
                )}
                验证码邮件由 Resend USA 代发，会用到你的邮箱地址。
              </p>
            </>
          )}
        </form>
      )}

      {step === "code" && (
        <form className="login" onSubmit={verify}>
          <p className="hint" style={{ marginTop: 0 }}>
            {typedIn ? (
              <>填 {email} 收到的 6 位验证码。</>
            ) : (
              <>
                {sent?.again ? "又发了一次" : "验证码发到了"} {email}，
                {sent ? Math.max(1, Math.round((sent.expiresAt - Date.now()) / 60_000)) : LOGIN_CODE_TTL_MIN} 分钟内有效。
              </>
            )}
          </p>
          {sent?.slow && (
            <p className="hint" style={{ color: "var(--ink)", fontWeight: 600 }}>
              Gmail 最近收我们的信比较慢，可能要等很久。还没注册的话，用 QQ 或 163 邮箱更快。
              {/* said to every address there, known or not, so it tells nobody who has an account or a password */}
              {!fixedEmail && (
                <>
                  设过密码的，可以
                  <button
                    type="button"
                    className="link"
                    style={{ fontSize: "inherit", fontWeight: "inherit", color: "inherit", textDecoration: "underline" }}
                    onClick={toPassword}
                  >
                    直接用密码登录
                  </button>
                  。
                </>
              )}
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
            {busy ? "验证中…" : fixedEmail ? "确认" : "登录"}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" disabled={busy || wait > 0} onClick={() => send()}>
              {wait > 0 ? `${waitText(wait)}后可重发` : "重新发送"}
            </button>
            {!fixedEmail && (
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
            )}
          </div>
        </form>
      )}

      {step === "desk" && (
        <form className="login" onSubmit={redeem}>
          <p className="hint" style={{ marginTop: 0 }}>
            在已经登录的手机或电脑上打开{SITE_NAME}，在「我的资料」里拿一个登录码，把那 {DESK_CODE_LENGTH} 位码填在这里。
          </p>
          <label className="field">
            登录码
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              spellCheck={false}
              maxLength={14}
              required
              placeholder="ABCD-EFGH"
              value={desk}
              onChange={(e) => setDesk(e.target.value.toUpperCase())}
            />
          </label>
          <button className="primary wide" disabled={busy || normalizeDeskCode(desk).length !== DESK_CODE_LENGTH}>
            {busy ? "登录中…" : "登录"}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setStep("email")}>
              用邮箱登录
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
          <HiddenUsername email={email.trim()} />
          <div>
            <PasswordField
              label="设个密码（可以不填）"
              autoComplete="new-password"
              required={false}
              placeholder="至少 8 个字符"
              value={newPassword}
              onChange={setNewPassword}
            />
            <p className="hint" style={newProblem ? { color: "#b42318" } : undefined}>
              {newProblem ?? "以后换手机或电脑，用邮箱和这个密码就能登录，不用等验证码。"}
            </p>
          </div>
          <button className="primary wide" disabled={busy || !adult || !agree || !abroad || Boolean(newProblem)}>
            {busy ? "注册中…" : "完成注册"}
          </button>
        </form>
      )}

      {step === "offer" && (
        <form className="login" onSubmit={keepOffered}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>设个密码，下次换手机不用等邮件？</p>
          <HiddenUsername email={email.trim()} />
          <div>
            <PasswordField label="密码" autoComplete="new-password" placeholder="至少 8 个字符" value={newPassword} onChange={setNewPassword} />
            <p className="hint" style={newProblem ? { color: "#b42318" } : undefined}>
              {newProblem ?? "以后换手机或电脑，用邮箱和这个密码就能登录，不用等验证码。在「我的资料」里随时能改，也能取消。"}
            </p>
          </div>
          <button className="primary wide" disabled={busy || !newPassword || Boolean(newProblem)}>
            {busy ? "保存中…" : "设好了"}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" disabled={busy} onClick={later}>
              下次再说
            </button>
          </div>
        </form>
      )}

      {error && <p className="login-error">{error}</p>}
    </Sheet>
  );
}
