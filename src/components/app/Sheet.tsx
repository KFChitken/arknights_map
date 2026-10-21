"use client";

import { useEffect, type ReactNode } from "react";

/** Bottom sheet on phones, centered dialog on wide screens. */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          {onBack && (
            <button className="back" onClick={onBack}>
              ‹ 返回
            </button>
          )}
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}
