"use client";

import { useEffect, useState } from "react";

/**
 * 「放到手机桌面」: how to put the site on this phone's home screen. Not shown
 * on computers, or when the site was already opened from the home screen.
 */

/** Android Chrome's own install prompt, which it offers once, early */
type InstallPrompt = Event & { prompt: () => Promise<void> };

let installPrompt: InstallPrompt | null = null;
const watchers = new Set<() => void>();
const changed = () => watchers.forEach((w) => w());

/** Run once when the page loads, so the prompt is still there when the player opens 资料. */
export function keepInstallPrompt() {
  const offered = (e: Event) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    changed();
  };
  const installed = () => {
    installPrompt = null;
    changed();
  };
  window.addEventListener("beforeinstallprompt", offered);
  window.addEventListener("appinstalled", installed);
  return () => {
    window.removeEventListener("beforeinstallprompt", offered);
    window.removeEventListener("appinstalled", installed);
  };
}

type Phone = { kind: "iphone" | "android"; inApp: boolean };

function thisPhone(): Phone | null {
  const standalone =
    matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  const ua = navigator.userAgent;
  // iPads say they are Macs, but have a touch screen
  const iphone = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!iphone && !/Android/.test(ua)) return null;
  // WeChat and QQ open links in a browser of their own, which cannot add to the home screen
  return { kind: iphone ? "iphone" : "android", inApp: /MicroMessenger|\bQQ\//.test(ua) };
}

export default function HomeScreenRow() {
  const [phone, setPhone] = useState<Phone | null>(null);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(installPrompt);
  useEffect(() => {
    setPhone(thisPhone());
    const update = () => setPrompt(installPrompt);
    watchers.add(update);
    return () => void watchers.delete(update);
  }, []);
  if (!phone) return null;

  // a prompt can be shown only once, whatever the player picks
  const install = async () => {
    const p = installPrompt;
    installPrompt = null;
    changed();
    await p?.prompt();
  };

  return (
    <div className={`home-screen ${open ? "open" : ""}`}>
      <button className="link-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        放到手机桌面
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="home-steps">
          {phone.inApp && <p>你是在微信或 QQ 里打开的：先点右上角的「···」，选「在浏览器打开」，再照下面做。</p>}
          {phone.kind === "iphone" ? (
            <>
              <p>用 Safari 打开，点分享按钮（找不到就先点「···」），再选「添加到主屏幕」。</p>
              <p className="hint">从桌面图标打开时，要再登录一次。</p>
            </>
          ) : (
            <>
              <p>打开浏览器的菜单，选「添加到主屏幕」，有的浏览器叫「安装应用」。</p>
              {prompt && !phone.inApp && (
                <button className="primary wide" onClick={install}>
                  安装
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
