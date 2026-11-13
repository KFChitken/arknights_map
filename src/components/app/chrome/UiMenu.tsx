"use client";

import { useEffect, useRef } from "react";
import { T } from "@/i18n";
import { UI_NAMES, type UiName } from "@/lib/uiChoice";
import { WIDE_QUERY } from "./parts";

/** A layout's small picture: a phone's screen, or a computer's where the screen is wide */
export function UiThumb({ ui }: { ui: UiName }) {
  return (
    <picture>
      <source media={WIDE_QUERY} srcSet={`/ui/wide-${ui}.webp`} />
      <img src={`/ui/phone-${ui}.webp`} alt="" />
    </picture>
  );
}

/**
 * 界面's menu: the three layouts as small pictures, a tap changing to one at once (kept on this device), and under them
 * 存到桌面 where it is offered. It closes with a tap anywhere else, Escape, or 界面 again. choices: false when the
 * server keeps everyone on 浮岛 (UI_CHOICE=off), leaving 存到桌面 alone.
 */
export default function UiMenu({
  ui,
  choices,
  desk,
  onPick,
  onDesk,
  onClose,
}: {
  ui: UiName;
  choices: boolean;
  desk: boolean;
  onPick: (ui: UiName) => void;
  onDesk: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // 界面 itself closes it with its own tap
      if (!t || ref.current?.contains(t) || t.closest?.("[data-ui-btn]")) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="uimenu glass" role="menu" aria-label={choices ? T.ui.menu.title : T.desk.save}>
      {choices && (
        <>
          <div className="um-h">
            <b>{T.ui.menu.title}</b>
            <small>
              <span className="on-phone">{T.ui.menu.keptPhone}</span>
              <span className="on-computer">{T.ui.menu.keptComputer}</span>
            </small>
          </div>
          <div className="um-opts">
            {UI_NAMES.map((u) => (
              <button key={u} className={`um-o${u === ui ? " on" : ""}`} role="menuitemradio" aria-checked={u === ui} onClick={() => onPick(u)}>
                <UiThumb ui={u} />
                {T.ui.names[u]}
                {u === ui && (
                  <i className="ck" aria-hidden="true">
                    ✓
                  </i>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {choices && desk && <div className="um-sep" />}
      {desk && (
        <button className="um-row" role="menuitem" onClick={onDesk}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the icon the desktop will show, small */}
          <img src="/icon-192.png" alt="" width={32} height={32} />
          <span>
            <b>{T.desk.save}</b>
            <small>
              <span className="on-phone">{T.ui.menu.deskPhone}</span>
              <span className="on-computer">{T.ui.menu.deskComputer}</span>
            </small>
          </span>
          <span className="go" aria-hidden="true">
            ›
          </span>
        </button>
      )}
    </div>
  );
}
