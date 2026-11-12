"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { finishSignup, passwordLogin, redeemDeskCode, requestCode, savePassword, verifyCode } from "@/lib/authClient";
import { adultTick, crossBorderTick } from "@/lib/consent";
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return setError(T.login.emailFirst);
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
      if ("needsCode" in r) throw new Error(T.login.passwordNotSet);
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
    ? T.login.title.confirm
    : step === "signup"
      ? fmt(T.login.title.first, { site: SITE_NAME })
      : step === "desk"
        ? T.login.title.deskCode
        : step === "offer"
          ? T.login.title.done
          : T.common.signIn;

  return (
    <Sheet title={title} onClose={close}>
      {step === "email" && standalone && !fixedEmail && (
        <div className="desk-login">
          <p>{T.login.deskHint}</p>
          <button type="button" className="primary wide" onClick={() => setStep("desk")}>
            {T.login.enterDeskCode}
          </button>
        </div>
      )}
      {step === "email" && (
        <form className="login" onSubmit={byPassword ? signInWithPassword : send}>
          {reason && <p className="hint" style={{ marginTop: 0 }}>{reason}</p>}
          {!byPassword && pausedNames.length > 0 && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)", fontWeight: 600 }}>
              {fmtParts(T.login.paused, { names: pausedNames.join(T.common.listSep) })}
              {!fixedEmail && T.login.pausedPassword}
            </p>
          )}
          <label className="field">
            {T.login.email}
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
              {T.login.didYouMean}{" "}
              <button
                type="button"
                className="link"
                style={{ fontSize: "inherit", color: "var(--ink)", textDecoration: "underline" }}
                onClick={() => setEmail(fix)}
              >
                {fix}
              </button>
              {T.login.didYouMeanEnd}
            </p>
          )}
          {!byPassword && pausedHere && (
            <p className="hint" style={{ marginTop: 0, color: "var(--ink)" }}>
              {fmtParts(T.login.serviceDown, { service: serviceName(typedDomain), then: fixedEmail ? T.login.serviceDownWait : T.login.serviceDownSwitch })}
            </p>
          )}
          {!fixedEmail && (
            <div className="seg login-with" role="group" aria-label={T.login.method}>
              <button type="button" className={byPassword ? "" : "on"} aria-pressed={!byPassword} onClick={() => switchTo("code")}>
                {T.login.code}
              </button>
              <button type="button" className={byPassword ? "on" : ""} aria-pressed={byPassword} onClick={() => switchTo("password")}>
                {T.password.label}
              </button>
            </div>
          )}
          {byPassword ? (
            <>
              <PasswordField label={T.password.label} autoComplete="current-password" value={password} onChange={setPassword} />
              <button className="primary wide" disabled={busy || !email.trim() || !password}>
                {busy ? T.login.signingIn : T.common.signIn}
              </button>
              <div className="row-actions">
                <button type="button" className="pill" onClick={() => switchTo("code")}>
                  {T.login.forgot}
                </button>
                {!standalone && (
                  <button type="button" className="pill" onClick={() => setStep("desk")}>
                    {T.login.haveDeskCode}
                  </button>
                )}
              </div>
              <p className="hint">{T.login.firstTimeCode}</p>
            </>
          ) : (
            <>
              <button className="primary wide" disabled={busy || !email.trim() || pausedHere}>
                {busy ? T.login.sending : T.login.sendCode}
              </button>
              <div className="row-actions">
                {/* the email came, but this page no longer knows a code went out: another tab, or the desktop icon started afresh */}
                <button type="button" className="pill" onClick={haveCode}>
                  {T.login.haveCode}
                </button>
                {/* a 登录码 from a device already signed in; opened from the iPhone home-screen icon, it is offered above */}
                {!standalone && !fixedEmail && (
                  <button type="button" className="pill" onClick={() => setStep("desk")}>
                    {T.login.haveDeskCode}
                  </button>
                )}
              </div>
              <p className="hint">
                {!fixedEmail && (
                  <>
                    {T.login.firstTime}
                    <br />
                  </>
                )}
                {T.login.resendNote}
              </p>
            </>
          )}
        </form>
      )}

      {step === "code" && (
        <form className="login" onSubmit={verify}>
          <p className="hint" style={{ marginTop: 0 }}>
            {typedIn ? (
              <>{fmtParts(T.login.enterCode, { email: email })}</>
            ) : (
              <>
                {fmtParts(T.login.codeSent, { sent: sent?.again ? T.login.sentAgain : T.login.sentTo, email: email, min: sent ? Math.max(1, Math.round((sent.expiresAt - Date.now()) / 60_000)) : LOGIN_CODE_TTL_MIN })}
              </>
            )}
          </p>
          {sent?.slow && (
            <p className="hint" style={{ color: "var(--ink)", fontWeight: 600 }}>
              {T.login.gmailSlow}
              {/* said to every address there, known or not, so it tells nobody who has an account or a password */}
              {!fixedEmail &&
                fmtNodes(T.login.usePassword, {
                  link: (
                    <button
                      type="button"
                      className="link"
                      style={{ fontSize: "inherit", fontWeight: "inherit", color: "inherit", textDecoration: "underline" }}
                      onClick={toPassword}
                    >
                      {T.login.usePasswordLink}
                    </button>
                  ),
                })}
            </p>
          )}
          <p className="hint">
            {T.login.onTheWay}
          </p>
          {mailbox && (
            <p className="hint">
              {T.login.dev.before}{" "}
              <a href={mailbox} target="_blank" rel="noreferrer">
                {T.login.dev.inbox}
              </a>{" "}
              {T.login.dev.after}
            </p>
          )}
          <label className="field">
            {T.login.code}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder={T.login.codePlaceholder}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <button className="primary wide" disabled={busy || code.length !== 6}>
            {busy ? T.login.checking : fixedEmail ? T.common.confirm : T.common.signIn}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" disabled={busy || wait > 0} onClick={() => send()}>
              {wait > 0 ? fmt(T.login.resendIn, { wait: waitText(wait) }) : T.login.resend}
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
                {T.login.otherEmail}
              </button>
            )}
          </div>
        </form>
      )}

      {step === "desk" && (
        <form className="login" onSubmit={redeem}>
          <p className="hint" style={{ marginTop: 0 }}>
            {fmtParts(T.login.deskCodeHow, { site: SITE_NAME, len: DESK_CODE_LENGTH })}
          </p>
          <label className="field">
            {T.common.loginCode}
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
            {busy ? T.login.signingIn : T.common.signIn}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setStep("email")}>
              {T.login.useEmail}
            </button>
          </div>
        </form>
      )}

      {step === "signup" && (
        <form className="login" onSubmit={signup}>
          <p className="hint" style={{ marginTop: 0 }}>
            {T.login.oneMoreStep}
          </p>
          <div className="ticks">
            <label className="check">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <span>{adultTick()}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                {T.login.agreeTo}{" "}
                <a href="/privacy" target="_blank" rel="noreferrer">
                  {T.common.privacy}
                </a>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} />
              <span>
                {crossBorderTick()}{" "}
                <a href="/privacy#abroad" target="_blank" rel="noreferrer">
                  {T.common.details}
                </a>
              </span>
            </label>
          </div>
          <HiddenUsername email={email.trim()} />
          <div>
            <PasswordField
              label={T.login.signUp.passwordLabel}
              autoComplete="new-password"
              required={false}
              placeholder={T.password.minLength}
              value={newPassword}
              onChange={setNewPassword}
            />
            <p className="hint" style={newProblem ? { color: "#b42318" } : undefined}>
              {newProblem ?? T.login.signUp.passwordHint}
            </p>
          </div>
          <button className="primary wide" disabled={busy || !adult || !agree || !abroad || Boolean(newProblem)}>
            {busy ? T.login.signUp.busy : T.login.signUp.done}
          </button>
        </form>
      )}

      {step === "offer" && (
        <form className="login" onSubmit={keepOffered}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{T.login.nudge.title}</p>
          <HiddenUsername email={email.trim()} />
          <div>
            <PasswordField label={T.password.label} autoComplete="new-password" placeholder={T.password.minLength} value={newPassword} onChange={setNewPassword} />
            <p className="hint" style={newProblem ? { color: "#b42318" } : undefined}>
              {newProblem ?? T.login.nudge.hint}
            </p>
          </div>
          <button className="primary wide" disabled={busy || !newPassword || Boolean(newProblem)}>
            {busy ? T.common.saving : T.password.done}
          </button>
          <div className="row-actions">
            <button type="button" className="pill" disabled={busy} onClick={later}>
              {T.password.notNow}
            </button>
          </div>
        </form>
      )}

      {error && <p className="login-error">{error}</p>}
    </Sheet>
  );
}
