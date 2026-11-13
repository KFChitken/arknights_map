"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { DEFAULT_UI, UI_NAMES, type UiName } from "@/lib/uiChoice";
import { UiThumb } from "./UiMenu";
import "./picker.css";

/**
 * Which 界面, asked once on a device (MapApp.tsx asksUi): the three as small pictures, 浮岛 chosen to begin with. A
 * tap on one only chooses it; the yellow button changes to it. 先不选 (or a tap beside it, or Escape) keeps 浮岛.
 */
export default function UiPicker({ onPick, onSkip }: { onPick: (ui: UiName) => void; onSkip: () => void }) {
  const [chosen, setChosen] = useState<UiName>(DEFAULT_UI);
  const box = useRef<HTMLDivElement>(null);
  const skip = useRef(onSkip);
  skip.current = onSkip;

  useEffect(() => {
    // into the card for the keyboard and screen readers, with no ring drawn round it
    box.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && skip.current();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, []);

  return (
    <>
      <div className="ui-picker-dim" onClick={onSkip} />
      <div ref={box} className="ui-picker" role="dialog" aria-modal="true" aria-labelledby="ui-picker-title" tabIndex={-1}>
        <div className="pk-h">
          <b id="ui-picker-title">{T.ui.picker.title}</b>
          <small>{T.ui.picker.note}</small>
        </div>
        <div className="pk-opts" role="radiogroup" aria-labelledby="ui-picker-title">
          {UI_NAMES.map((u) => (
            <button key={u} className={`pk-o${u === chosen ? " on" : ""}`} role="radio" aria-checked={u === chosen} onClick={() => setChosen(u)}>
              <UiThumb ui={u} />
              <b>{T.ui.names[u]}</b>
              <small>
                {u === "drawer" ? (
                  <>
                    <span className="on-phone">{T.ui.lines.drawer}</span>
                    <span className="on-computer">{T.ui.lines.drawerWide}</span>
                  </>
                ) : (
                  T.ui.lines[u]
                )}
              </small>
              {u === chosen && (
                <i className="ck" aria-hidden="true">
                  ✓
                </i>
              )}
            </button>
          ))}
        </div>
        <button className="pk-go" onClick={() => onPick(chosen)}>
          {fmt(T.ui.picker.use, { name: T.ui.names[chosen] })}
        </button>
        <button className="pk-skip" onClick={onSkip}>
          {T.ui.picker.skip}
        </button>
      </div>
    </>
  );
}
