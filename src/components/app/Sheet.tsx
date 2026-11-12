"use client";

import { useEffect, type ReactNode } from "react";
import { T } from "@/i18n";

/**
 * Bottom sheet on phones, centered dialog on wide screens. A sheet opened from
 * another one (onBack) goes back to it on ×, Escape or a tap outside, so the
 * player lands where they were, say still able to touch back.
 */
export default function Sheet({
  title,
  onClose,
  onBack,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  onBack?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const close = onBack ?? onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(fitToScreen, []);

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="close" onClick={close} aria-label={onBack ? T.common.back : T.common.close}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

/**
 * What is really on screen, for every open sheet (globals.css): below Safari's address bar and
 * above the keyboard, which the window's own height does not leave out. Returns the undo.
 */
function fitToScreen() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const fit = () => {
    root.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
    root.setProperty("--vv-h", `${Math.round(vv.height)}px`);
  };
  fit();
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  return () => {
    vv.removeEventListener("resize", fit);
    vv.removeEventListener("scroll", fit);
    // the last sheet to close leaves the page as it was; one opened in its place has set them again
    if (!document.querySelector(".sheet-backdrop")) {
      root.removeProperty("--vv-top");
      root.removeProperty("--vv-h");
    }
  };
}
