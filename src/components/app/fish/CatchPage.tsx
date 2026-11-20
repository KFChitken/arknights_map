"use client";

import type { CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";
import type { FishCatch } from "@/lib/fish/rules";
import FishCard, { cmText, nameOf, wordsOf } from "./FishCard";

/**
 * A catch worth a page of its own (the first of one, a record size, purple or better), as the game's 获得物资 when a
 * task's reward comes: the bank blurred and dark under a fine dot grid, black edges at the sides; a crate and 钓上来了;
 * the disc popping in with the size where the game writes how many, NEW at its corner the first time; the name in a
 * black box, 新纪录 under it for a record, a grey line of its number, rarity and how many; a round ✓ at the bottom, and
 * a tap anywhere closes it. Purple and better: gold light behind it, beams, orange triangles and motes drifting, white
 * triangles rising by the ✓; grey, green and blue a little white light alone. In a box of the design's 390 × 700.
 */

const UP = "5,1 9.5,9 0.5,9";
const DOWN = "0.5,1 9.5,1 5,9";
// [x, y, size, rising, colour, seconds, delay]
const TRIS: [number, number, number, boolean, string, number, number][] = [
  [62, 310, 9, false, "#ff9a5c", 3.4, 0], [84, 266, 7, true, "#ffb07a", 3.0, 0.8], [96, 384, 11, false, "#ff8a4c", 3.8, 1.6],
  [70, 432, 6, true, "#ffc49a", 2.8, 0.4], [118, 216, 10, false, "#ff9a5c", 3.6, 2.2], [290, 226, 8, true, "#ffb07a", 3.2, 1.2],
  [300, 298, 11, false, "#ff8a4c", 3.9, 0.2], [318, 372, 7, true, "#ffc49a", 2.9, 2.0], [286, 428, 9, false, "#ff9a5c", 3.5, 0.9],
  [262, 194, 6, true, "#ffd2ae", 2.6, 1.8], [150, 450, 7, true, "#ffb07a", 3.1, 2.6], [236, 466, 8, false, "#ff9a5c", 3.3, 1.4],
];
// [x, y, size]
const MOTES: [number, number, number][] = [
  [104, 280, 3], [130, 330, 2], [88, 352, 2], [112, 412, 3], [276, 268, 2], [262, 332, 3], [296, 350, 2], [270, 400, 2],
  [140, 242, 2], [246, 246, 2], [180, 450, 2], [214, 456, 3], [168, 230, 2], [226, 218, 2],
];
// [x, y, width, height, alpha]
const BEAMS: [number, number, number, number, number][] = [
  [78, 200, 2, 240, 0.32], [100, 280, 6, 220, 0.18], [142, 170, 3, 300, 0.22], [244, 176, 3, 280, 0.24], [286, 230, 7, 240, 0.16], [308, 280, 2, 200, 0.3],
];
// [x, y, size, seconds, delay]
const WHITES: [number, number, number, number, number][] = [
  [128, 646, 12, 2.4, 0], [150, 664, 8, 2.0, 0.7], [236, 650, 9, 2.6, 1.3], [262, 670, 6, 2.2, 0.4], [196, 676, 7, 2.8, 1.8],
];

const anim = (rising: boolean, s: number, d: number) => `${rising ? "fish-rise" : "fish-drift"} ${s}s linear ${d}s infinite both`;

export default function CatchPage({ caught, onClose }: { caught: FishCatch; onClose: () => void }) {
  const item = itemOf(caught.no);
  if (!item) return null;
  const dust = item.tier >= 4;
  const name = nameOf(caught.no, caught.variant);
  const no = String(caught.no).padStart(3, "0");
  const line = caught.first
    ? caught.variant
      ? fmt(T.fish.banner.lineFirstVariant, { no, tier: item.tier, v: T.fish.variants[caught.variant] })
      : fmt(T.fish.banner.lineFirst, { no, tier: item.tier })
    : fmt(T.fish.banner.lineNth, { no, tier: item.tier, n: caught.n });
  return (
    <button type="button" className="fish-got" onClick={onClose} aria-label={`${T.fish.banner.title} ${name}`}>
      <span className="in">
        <span className="box">
          <svg width="62" height="58" viewBox="0 0 62 58" aria-hidden="true">
            <path d="M8 18 L29 8 L50 18 L29 28 Z" fill="#d9d9d9" />
            <path d="M8 18 L29 28 L29 54 L8 44 Z" fill="#bdbdbd" />
            <path d="M50 18 L29 28 L29 54 L50 44 Z" fill="#a3a3a3" />
            <path d="M18 13 L39 23 L39 32 L44 29.5 L44 20.5 L23 10.5 Z" fill="#8a8a8a" />
            <path d="M33 39 l3 -1.4 v8 l-3 1.4 Z M38 36.6 l3 -1.4 v8 l-3 1.4 Z M43 34.2 l3 -1.4 v8 l-3 1.4 Z" fill="#7a7a7a" />
            <path d="M52 2 h3 v6 h6 v3 h-6 v6 h-3 v-6 h-6 v-3 h6 Z" fill="#d9d9d9" />
          </svg>
          <span>{T.fish.banner.title}</span>
        </span>
        {dust ? (
          <>
            <span className="halo gold" aria-hidden="true" />
            {BEAMS.map(([x, y, w, h, a]) => (
              <span
                key={`b${x}`}
                className="streak"
                aria-hidden="true"
                style={{ left: x, top: y, width: w, height: h, background: `linear-gradient(180deg, rgba(255,170,100,0), rgba(255,170,100,${a}) 45%, rgba(255,210,170,${a}) 60%, rgba(255,170,100,0))` }}
              />
            ))}
            {TRIS.map(([x, y, s, up, fill, sec, d]) => (
              <svg key={`t${x}-${y}`} className="tri" width={s} height={s} viewBox="0 0 10 10" aria-hidden="true" style={{ left: x, top: y, animation: anim(up, sec, d) }}>
                <polygon points={up ? UP : DOWN} fill={fill} />
              </svg>
            ))}
            {MOTES.map(([x, y, s], i) => (
              <span
                key={`m${x}-${y}`}
                className="mote"
                aria-hidden="true"
                style={{ left: x, top: y, width: s, height: s, animation: anim(true, 3 + (i % 4) * 0.5, (i * 0.37) % 2.8) } as CSSProperties}
              />
            ))}
          </>
        ) : (
          <span className="halo" aria-hidden="true" />
        )}
        <span className="item">
          <FishCard no={caught.no} variant={caught.variant} size={150} cm={caught.cm} />
          {caught.first && <em className="fish-new">{T.fish.banner.fresh}</em>}
        </span>
        <span className="words">
          <span className="nm">{name}</span>
          {caught.record && (
            <span className="recrow">
              <span className="rec">{T.fish.banner.record}</span>
              {caught.top !== null && fmt(T.fish.banner.recordLine, { name: wordsOf(item.key)?.name ?? name, cm: cmText(caught.top) })}
            </span>
          )}
          <span className="ln">{line}</span>
        </span>
        <span className="ok" aria-hidden="true">
          <svg width="26" height="20" viewBox="0 0 26 20">
            <path d="M2 10 L10 17 L24 3" fill="none" stroke="#d6d6d6" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {dust &&
          WHITES.map(([x, y, s, sec, d]) => (
            <svg key={`w${x}`} className="tri white" width={s} height={s} viewBox="0 0 10 10" aria-hidden="true" style={{ left: x, top: y, animation: anim(true, sec, d) }}>
              <polygon points={UP} fill="#ffffff" />
            </svg>
          ))}
      </span>
    </button>
  );
}
