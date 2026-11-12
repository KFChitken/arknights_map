"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtParts, T } from "@/i18n";
import type { PageCount } from "@/lib/appCounts";
import { takeDeskCode } from "@/lib/authClient";
import { beijingDate } from "@/lib/beijing";
import { deviceOf, guideOf, type Guide } from "@/lib/homeScreen";
import { DESK_CODE_TTL_MIN, siteName } from "@/lib/rules";
import Sheet from "./Sheet";

/**
 * 存到桌面: putting the site on the desktop or home screen. Where the browser offers its own install
 * prompt (Chrome, Edge) a tap asks it at once; elsewhere a panel says how, by device and browser
 * (src/lib/homeScreen.ts), with a 登录码 on iPhone, whose home-screen icon keeps cookies of its own.
 * Not offered on the site opened from the icon, nor once this device installed it through the prompt.
 */

/** The browser's own install prompt, which it offers once, early; it can be shown only once */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: "accepted" | "dismissed" }> };

let installPrompt: InstallPrompt | null = null;
const watchers = new Set<() => void>();
const changed = () => watchers.forEach((w) => w());

/** Run when anything here changes: the prompt came or went, the site was installed */
export function watchHomeScreen(fn: () => void) {
  watchers.add(fn);
  return () => void watchers.delete(fn);
}

const INSTALLED = "zhoup.installed";
const HINT_SEEN = "zhoup.deskHintSeen";
const COUNTED = "zhoup.counted.";

function recall(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Whether it could be kept */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Opened from the home-screen or desktop icon */
export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Whether to offer 存到桌面 on this page: not from the icon, and not once this device installed it through the prompt */
export const deskOffered = () => !isStandalone() && recall(INSTALLED) !== "1";

const here = () => ({ ua: navigator.userAgent, touch: navigator.maxTouchPoints });

/** Count one of 存到桌面's numbers for this kind of device (src/lib/appCounts.ts): nothing else is sent */
function countPage(kind: PageCount) {
  const { ua, touch } = here();
  fetch("/api/app-count", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `${kind}:${deviceOf(ua, touch)}` }),
    keepalive: true,
  }).catch(() => {});
}

/** Once a device a day (as far as it can remember): opened from the icon, or in the browser */
export function countOpen() {
  const kind = isStandalone() ? "standalone" : "browser";
  const today = beijingDate(Date.now());
  if (recall(COUNTED + kind) === today || !remember(COUNTED + kind, today)) return;
  countPage(kind);
}

/** Installed through the prompt (or the browser said so): counted once, and not offered here again */
let installCounted = false;
function installed() {
  installPrompt = null;
  remember(INSTALLED, "1");
  if (!installCounted) {
    installCounted = true;
    countPage("installed");
  }
  changed();
}

/** Run once when the page loads, so the prompt is kept for whenever the player taps 存到桌面. */
export function keepInstallPrompt() {
  const offered = (e: Event) => {
    // no mini-infobar of the browser's own: 存到桌面 asks when the player wants it
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    changed();
  };
  window.addEventListener("beforeinstallprompt", offered);
  window.addEventListener("appinstalled", installed);
  return () => {
    window.removeEventListener("beforeinstallprompt", offered);
    window.removeEventListener("appinstalled", installed);
  };
}

/**
 * A tap on 存到桌面: the browser's install prompt when it offered one ("installed" or "dismissed"),
 * otherwise "guide": the panel says how.
 */
export async function installOrGuide(): Promise<"installed" | "dismissed" | "guide"> {
  countPage("tap");
  const p = installPrompt;
  if (!p) return "guide";
  installPrompt = null;
  changed();
  try {
    await p.prompt();
    const choice = await p.userChoice;
    if (choice?.outcome === "accepted") {
      installed();
      return "installed";
    }
  } catch {
    // shown already, or refused by the browser
  }
  return "dismissed";
}

/** The bubble beside 存到桌面 was shown on this device; where nothing can be remembered, it never pesters */
export function deskHintSeen() {
  try {
    return localStorage.getItem(HINT_SEEN) === "1";
  } catch {
    return true;
  }
}
export const markDeskHintSeen = () => void remember(HINT_SEEN, "1");

/**
 * The button under the guides, with the app's icon as it will be on the desktop, and once a device a
 * bubble beside it that goes by itself after 8 seconds.
 */
export function DeskButton({ className = "", hint, onTap, onHintDone }: { className?: string; hint: boolean; onTap: () => void; onHintDone: () => void }) {
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(onHintDone, 8000);
    return () => window.clearTimeout(t);
  }, [hint, onHintDone]);
  return (
    <div className={`desk-anchor ${className}`}>
      <button className="desk-btn" onClick={onTap}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the icon the desktop will show, small */}
        <img src="/icon-192.png" alt="" width={34} height={34} />
        <small>{T.desk.save}</small>
      </button>
      {hint && (
        <button className="desk-hint" onClick={onTap}>
          {T.desk.saveHint}
        </button>
      )}
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A 登录码 (src/lib/deskCode.ts): taken here, typed in on another device (or into the site opened from the iPhone
 * home-screen icon) to sign in there once. In 我的资料 for everyone, and in ③ on iPhone.
 */
export function LoginCodeBox({ signedIn, onSignIn }: { signedIn: boolean; onSignIn?: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!signedIn) {
    return (
      <p className="hint">
        {T.desk.signInFirst}
        {onSignIn && (
          <button className="link desk-sign-in" onClick={onSignIn}>
            {T.desk.toSignIn}
          </button>
        )}
      </p>
    );
  }
  const take = async () => {
    setBusy(true);
    setError(null);
    try {
      const got = await takeDeskCode();
      setCode(got.code);
      setCopied(await copy(got.code));
    } catch (e) {
      setError(e instanceof Error ? e.message : T.desk.failed);
    }
    setBusy(false);
  };
  return (
    <div className="desk-code">
      {code ? (
        <>
          <div className="desk-code-text" aria-label={T.common.loginCode}>
            {code}
          </div>
          <div className="row-actions">
            <button className="pill" onClick={async () => setCopied(await copy(code))}>
              {copied ? T.desk.copied : T.common.copy}
            </button>
            <button className="pill" disabled={busy} onClick={take}>
              {T.desk.another}
            </button>
          </div>
        </>
      ) : (
        <button className="primary wide" disabled={busy} onClick={take}>
          {busy ? T.desk.getting : T.desk.getCode}
        </button>
      )}
      <p className="hint">{fmtParts(T.desk.codeNote, { min: DESK_CODE_TTL_MIN })}</p>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

/** Opened inside an app: its address, to copy (or to long-press when copying is not allowed) */
function CopyAddress() {
  const [copied, setCopied] = useState<boolean | null>(null);
  const url = typeof location === "undefined" ? "" : `${location.origin}/`;
  return (
    <div className="desk-copy">
      <button className="pill" onClick={async () => setCopied(await copy(url))}>
        {copied ? T.desk.copied : T.desk.copyUrl}
      </button>
      {copied === false && <p className="desk-url">{url}</p>}
    </div>
  );
}

const Steps = ({ children }: { children: ReactNode }) => <ol className="desk-steps">{children}</ol>;

/** How to put the site on the desktop here, in at most three steps, the same in the panel and in 资料 */
export function HomeScreenGuide({ signedIn, onSignIn }: { signedIn: boolean; onSignIn?: () => void }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [prompt, setPrompt] = useState<boolean>(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const { ua, touch } = here();
    setGuide(guideOf(ua, touch));
    const update = () => setPrompt(Boolean(installPrompt));
    update();
    return watchHomeScreen(update);
  }, []);
  if (!guide) return null;
  if (done) return <p>{T.desk.installed}</p>;

  let steps: ReactNode;
  switch (guide) {
    case "inApp":
      steps = (
        <>
          <p>{T.desk.inApp.title}</p>
          <Steps>
            <li>{T.desk.inApp.open}</li>
            <li>{T.desk.inApp.again}</li>
          </Steps>
          <p className="hint">{T.desk.inApp.copy}</p>
          <CopyAddress />
        </>
      );
      break;
    case "ios":
      steps = (
        <>
          <Steps>
            <li>{T.desk.ios.share}</li>
            <li>{T.desk.ios.add}</li>
            <li>
              {T.desk.ios.signIn}
              <LoginCodeBox signedIn={signedIn} onSignIn={onSignIn} />
            </li>
          </Steps>
          <p className="hint">{T.desk.ios.otherBrowsers}</p>
        </>
      );
      break;
    case "macSafari":
      steps = (
        <>
          <Steps>
            <li>{T.desk.mac.file}</li>
            <li>{T.desk.mac.dock}</li>
          </Steps>
          <p className="hint">{T.desk.mac.bookmark}</p>
        </>
      );
      break;
    case "harmony":
    case "android":
      steps = (
        <Steps>
          <li>{T.desk.android.menu}</li>
          <li>{T.desk.android.add}</li>
          <li>{T.desk.android.permission}</li>
        </Steps>
      );
      break;
    case "chromium":
      steps = (
        <>
          <Steps>
            <li>{T.desk.pc.icon}</li>
            <li>
              {fmtParts(T.desk.pc.menu, { site: siteName() })}
            </li>
            <li>{fmtParts(T.desk.pc.installed, { site: siteName() })}</li>
          </Steps>
          <p className="hint">
            {T.desk.pc.after}
          </p>
        </>
      );
      break;
    default:
      steps = (
        <Steps>
          <li>{T.desk.anyBrowser.open}</li>
          <li>{T.desk.anyBrowser.bookmark}</li>
        </Steps>
      );
  }

  return (
    <div className="desk-guide">
      {prompt && guide !== "inApp" && (
        <button
          className="primary wide"
          onClick={async () => {
            if ((await installOrGuide()) === "installed") setDone(true);
          }}
        >
          {T.desk.install}
        </button>
      )}
      {steps}
      <p className="desk-end">{T.desk.afterSave}</p>
    </div>
  );
}

/** The panel 存到桌面 opens where the browser offers no prompt */
export function HomeScreenSheet({ signedIn, onSignIn, onClose }: { signedIn: boolean; onSignIn?: () => void; onClose: () => void }) {
  return (
    <Sheet title={T.desk.save} onClose={onClose}>
      <HomeScreenGuide signedIn={signedIn} onSignIn={onSignIn} />
    </Sheet>
  );
}

/** 「存到桌面」 in 资料: the same guide, opened in place; on every kind of device but the site opened from the icon */
export default function HomeScreenRow() {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setShown(!isStandalone()), []);
  if (!shown) return null;
  return (
    <div className={`home-screen ${open ? "open" : ""}`}>
      <button
        className="link-row"
        aria-expanded={open}
        onClick={() => {
          if (!open) countPage("tap");
          setOpen((o) => !o);
        }}
      >
        {T.desk.save}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="home-steps">
          <HomeScreenGuide signedIn />
        </div>
      )}
    </div>
  );
}
