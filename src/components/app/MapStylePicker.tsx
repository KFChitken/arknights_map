"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAP_STYLE_NAMES,
  MAP_STYLE_NOTES,
  MAP_STYLES,
  type MapStyle,
} from "@/lib/mapStyle";
import { HEART_D } from "@/lib/touchArt";

/** 地图画风's small pictures: a radial dark patch (国度版), a roach (默认), a heart (舟u本色) */
function StyleIcon({ style }: { style: MapStyle }) {
  if (style === "nation") {
    return (
      <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
        <defs>
          <radialGradient id="map-style-nation" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0.3" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle
          cx="8"
          cy="8"
          r="7.5"
          fill="url(#map-style-nation)"
          opacity="0.9"
        />
        <circle cx="8" cy="8" r="3.2" fill="#1b1d22" />
      </svg>
    );
  }
  if (style === "hearts") {
    return (
      <svg className="ic" viewBox="0 0 24 23" aria-hidden="true">
        <path d={HEART_D} fill="#ff4f8b" stroke="#fff" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg className="ic" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 11 C3 6 5.5 3.5 8 3.5 C10.5 3.5 13 6 13 11 Z" fill="#fff" />
      <path
        d="M6.5 4.2 C6 2.6 4.6 1.6 3 1.6 M9.5 4.2 C10 2.6 11.4 1.6 13 1.6"
        stroke="#fff"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <rect
        x="4.2"
        y="11.5"
        width="7.6"
        height="2.6"
        rx="1.2"
        fill="#fff"
        opacity="0.7"
      />
    </svg>
  );
}

/**
 * 地图画风 in the top bar: a button with the style in use, and a card of the three to pick from, each
 * with a small picture (fetched only when the card opens). Picking one changes the map at once.
 * unavailable: styles that cannot be picked here, with why. hint: show once that the style can change.
 */
export default function MapStylePicker({
  style,
  onPick,
  unavailable,
  hint,
  onHintDone,
  onRaise,
}: {
  style: MapStyle;
  onPick: (style: MapStyle) => void;
  unavailable: Partial<Record<MapStyle, string>>;
  hint: boolean;
  onHintDone: () => void;
  /** The card or the hint is out: the top bar should sit over what is under it on the map */
  onRaise: (raised: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => onRaise(open || hint), [open, hint, onRaise]);

  // a tap anywhere else closes the card
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !pillRef.current?.contains(t))
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  // the hint goes by itself after a few seconds, and for good
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(onHintDone, 6000);
    return () => window.clearTimeout(t);
  }, [hint, onHintDone]);

  const toggle = () => {
    if (hint) onHintDone();
    setOpen((o) => !o);
  };

  return (
    <>
      <span className="style-anchor">
        <button
          ref={pillRef}
          className="style-pill"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`地图画风：${MAP_STYLE_NAMES[style]}`}
          onClick={toggle}
        >
          <StyleIcon style={style} />
          <span className="label">{MAP_STYLE_NAMES[style]}</span>
          <svg className="caret" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M1.5 3.5 L5 7 L8.5 3.5"
              fill="none"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {hint && !open && (
          <button className="style-hint" onClick={toggle}>
            地图画风能换了，点这里 ↑
          </button>
        )}
      </span>
      {open && (
        <div
          ref={menuRef}
          className="style-menu"
          role="menu"
          aria-label="地图画风"
        >
          <div className="head">地图画风 · 只改这台设备上的样子</div>
          {MAP_STYLES.map((s) => (
            <button
              key={s}
              className="style-opt"
              role="menuitemradio"
              aria-checked={s === style}
              disabled={Boolean(unavailable[s])}
              onClick={() => {
                setOpen(false);
                onPick(s);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- three small pictures, only once the card opens */}
              <img alt="" src={`/map-style-${s}.png`} width={64} height={40} />
              <span>
                <b>{MAP_STYLE_NAMES[s]}</b>
                <small>{unavailable[s] ?? MAP_STYLE_NOTES[s]}</small>
              </span>
              <svg className="tick" viewBox="0 0 18 18" aria-hidden="true">
                <circle cx="9" cy="9" r="9" fill="#ffd23f" />
                <path
                  d="M5 9.2 L7.8 12 L13 6.5"
                  fill="none"
                  stroke="#1b1d22"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
