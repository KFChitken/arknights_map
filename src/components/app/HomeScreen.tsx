"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtParts } from "@/i18n";
import type { PageCount } from "@/lib/appCounts";
import { takeDeskCode } from "@/lib/authClient";
import { beijingDate } from "@/lib/beijing";
import { deviceOf, guideOf, type Guide } from "@/lib/homeScreen";
import { DESK_CODE_TTL_MIN, SITE_NAME } from "@/lib/rules";
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
        <small>存到桌面</small>
      </button>
      {hint && (
        <button className="desk-hint" onClick={onTap}>
          存到桌面，下次一点就开
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
        先登录，再拿登录码。
        {onSignIn && (
          <button className="link desk-sign-in" onClick={onSignIn}>
            去登录
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
      setError(e instanceof Error ? e.message : "出了点问题。");
    }
    setBusy(false);
  };
  return (
    <div className="desk-code">
      {code ? (
        <>
          <div className="desk-code-text" aria-label="登录码">
            {code}
          </div>
          <div className="row-actions">
            <button className="pill" onClick={async () => setCopied(await copy(code))}>
              {copied ? "已经复制了" : "复制"}
            </button>
            <button className="pill" disabled={busy} onClick={take}>
              换一个
            </button>
          </div>
        </>
      ) : (
        <button className="primary wide" disabled={busy} onClick={take}>
          {busy ? "正在拿…" : "拿登录码"}
        </button>
      )}
      <p className="hint">{fmtParts("这个码等于你的登录，{min} 分钟内有效，只能用一次，不要发给别人。", { min: DESK_CODE_TTL_MIN })}</p>
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
        {copied ? "已经复制了" : "复制网址"}
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
  if (done) return <p>装好了。存好以后，点桌面上的舟P图标就能直接打开地图。</p>;

  let steps: ReactNode;
  switch (guide) {
    case "inApp":
      steps = (
        <>
          <p>你是在 App 里打开的（比如微信、QQ、B站），这里存不了：</p>
          <Steps>
            <li>先点右上角「···」，选「在浏览器打开」（iPhone 上选「在 Safari 中打开」）</li>
            <li>在浏览器里再点一次「存到桌面」</li>
          </Steps>
          <p className="hint">找不到这个选项，就复制网址，粘贴到浏览器里打开。</p>
          <CopyAddress />
        </>
      );
      break;
    case "ios":
      steps = (
        <>
          <Steps>
            <li>点 Safari 的分享按钮（方框加向上的箭头；iOS 26 在底栏的「···」里）</li>
            <li>往下翻，选「添加到主屏幕」。iOS 26 会有「作为网页 App 打开」的开关，保持打开</li>
            <li>
              从桌面图标打开时要再登录一次：在这里拿一个登录码，打开后点「有登录码？」输入就行，不用再收验证码邮件。
              <LoginCodeBox signedIn={signedIn} onSignIn={onSignIn} />
            </li>
          </Steps>
          <p className="hint">iPhone 上的 Chrome 和 Edge 也能这样存：在分享里找「添加到主屏幕」。</p>
        </>
      );
      break;
    case "macSafari":
      steps = (
        <>
          <Steps>
            <li>点屏幕顶上菜单栏的「文件」</li>
            <li>选「添加到程序坞」，打开以后会自动带上登录</li>
          </Steps>
          <p className="hint">没有这个选项的话（macOS 14 以前的系统），按 ⌘D 收藏这个网站。</p>
        </>
      );
      break;
    case "harmony":
    case "android":
      steps = (
        <Steps>
          <li>打开浏览器的菜单（一般在右上角或底栏，「⋮」或「≡」）</li>
          <li>找「添加到桌面」「添加到主屏幕」或「添加快捷方式」（Chrome 里叫「添加到主屏幕」或「安装应用」）</li>
          <li>点了没反应：去手机「设置」里找到这个浏览器的权限，打开「桌面快捷方式」。还不行就用 Chrome 或 Edge 打开</li>
        </Steps>
      );
      break;
    case "chromium":
      steps = (
        <>
          <Steps>
            <li>点地址栏右边的「安装」小图标（一个小屏幕带向下的箭头）</li>
            <li>
              {fmtParts("没有的话打开菜单：Chrome 在「⋮」里找「安装 {site}」（可能在「投放、保存和分享」里面）；Edge 在「···」里的「应用」，选「将此站点作为应用安装」", { site: SITE_NAME })}
            </li>
            <li>{fmtParts("已经装过的话，去开始菜单或启动台里找「{site}」", { site: SITE_NAME })}</li>
          </Steps>
          <p className="hint">
            装好以后：Windows 的开始菜单里有舟P图标，Chrome 一般也会在桌面放一个，Edge 会让你选放哪里；Mac 在启动台里，可以拖进程序坞。打开是单独的窗口，没有地址栏，登录和浏览器里共用。
          </p>
        </>
      );
      break;
    default:
      steps = (
        <Steps>
          <li>用 Chrome 或 Edge 打开这个网站，再点一次「存到桌面」</li>
          <li>或者按 Ctrl+D（Mac 上 ⌘D）收藏这个网站</li>
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
          一键安装
        </button>
      )}
      {steps}
      <p className="desk-end">存好以后，点桌面上的舟P图标就能直接打开地图。</p>
    </div>
  );
}

/** The panel 存到桌面 opens where the browser offers no prompt */
export function HomeScreenSheet({ signedIn, onSignIn, onClose }: { signedIn: boolean; onSignIn?: () => void; onClose: () => void }) {
  return (
    <Sheet title="存到桌面" onClose={onClose}>
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
        存到桌面
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
