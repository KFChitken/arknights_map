"use client";

import { useEffect, type CSSProperties, type ReactNode } from "react";
import { T } from "@/i18n";

/**
 * Bottom sheet on phones, centered dialog on wide screens. A sheet opened from
 * another one (onBack) goes back to it on ×, Escape or a tap outside, so the
 * player lands where they were, say still able to touch back. head, say tabs,
 * takes the title's place at the top (the title still names the dialog), and
 * className marks a sheet laid out its own way (globals.css), and style is the sheet's own. onUp, a page within a sheet
 * (the new 我的资料's): a ‹ at the top left goes up to it, as Escape and a tap outside do, while × closes the whole.
 * shut: what the × is instead, for a sheet that shuts into something rather than closing (听歌's ⌄, into its bar).
 */
export default function Sheet({
  title,
  head,
  className,
  style,
  onClose,
  onBack,
  onUp,
  shut,
  footer,
  children,
}: {
  title: string;
  head?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
  onBack?: () => void;
  onUp?: () => void;
  shut?: { icon: ReactNode; label: string };
  footer?: ReactNode;
  children: ReactNode;
}) {
  const close = onUp ?? onBack ?? onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(fitToScreen, []);

  return (
    <div className={className ? `sheet-backdrop ${className}` : "sheet-backdrop"} onClick={close}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} style={style} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          {onUp && (
            <button className="up" onClick={onUp} aria-label={T.common.back}>
              ‹
            </button>
          )}
          {head ?? <h2>{title}</h2>}
          <button
            className={shut ? "close shut" : "close"}
            onClick={onUp ? onClose : close}
            aria-label={shut?.label ?? (onBack && !onUp ? T.common.back : T.common.close)}
          >
            {shut?.icon ?? "×"}
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
