"use client";

import { useEffect, type ReactNode } from "react";

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

  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="close" onClick={close} aria-label={onBack ? "返回" : "关闭"}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}
