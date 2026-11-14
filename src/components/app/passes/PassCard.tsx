"use client";
/* eslint-disable @next/next/no-img-element -- the site's own small pictures, shown as they are */

import type { CSSProperties } from "react";
import { GAME_OF, type PassChar } from "@/lib/passCatalog";
import { isFoil, padNo, styleFor } from "@/lib/passes";
import type { Art } from "../OperatorNames";

/**
 * A pass, small (2:3), as the results of a draw, the wish list and 我的通行证 show it: ① 通行认证 for a character of
 * 明日方舟, ③ 长条挂牌 for one of 终末地, and their special looks ② ④ (fancy: two copies or more, src/lib/passes.ts
 * isFancy). 首张 and 靓号 add a gold corner, nothing else. Everything inside is sized in cqw (passes.css), so it looks
 * the same at any width. The picture is the character's small one (/operator-art) while there is one, else a figure
 * drawn in their colour.
 */

/** A figure drawn in the character's colour, where there is no picture of them */
const FIGURE =
  "M150 40c-30 0-50 22-50 54 0 22 6 38 14 50-30 10-52 34-60 70-6 26-8 60-8 106h208c0-46-2-80-8-106-8-36-30-60-60-70 8-12 14-28 14-50 0-32-20-54-50-54z";

/** Dark or white words on a block of a colour (#rrggbb), by how light it is */
export function inkOf(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => {
    const x = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? "#15181d" : "#ffffff";
}

/** The character's small picture, or their figure; its address, for fetching it ahead (artUrl) */
export function artUrl(c: PassChar, art: Art | null): string | null {
  const file = art?.[GAME_OF[c.game]]?.[c.name];
  return file ? `/operator-art/${file}` : null;
}

function Picture({ c, art }: { c: PassChar; art: Art | null }) {
  const src = artUrl(c, art);
  return (
    <div className={`art${src ? "" : " drawn"}`}>
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
          <path d={FIGURE} transform="translate(0 80)" />
        </svg>
      )}
    </div>
  );
}

export function MiniPass({
  c,
  no,
  fancy,
  art,
  className,
}: {
  c: PassChar;
  /** null leaves the number off (a wish not drawn yet) */
  no: number | null;
  fancy: boolean;
  art: Art | null;
  className?: string;
}) {
  const style = styleFor(c.game, fancy);
  const corner = no !== null && isFoil(no) && <i className="mfo" aria-hidden="true" />;
  const number = no !== null && <b>{padNo(no)}</b>;
  const vars = { "--pc": c.color, "--pk": style === "rax" ? "#1b2330" : inkOf(c.color) } as CSSProperties;
  return (
    <div className={`mp${className ? ` ${className}` : ""}`} aria-hidden="true">
      {style === "ra" || style === "rax" ? (
        <div className={`mpc ra${style === "rax" ? " rax" : ""}`} style={vars}>
          <Picture c={c} art={art} />
          <span className="mra-t">ZHOUP MAP</span>
          <i className="mra-l" />
          <i className="mra-p" />
          {number}
          {corner}
        </div>
      ) : (
        <div className={`mpc tag${style === "tagx" ? " tagx" : ""}`} style={vars}>
          <Picture c={c} art={art} />
          <i className="mtg-b" />
          <i className="mtg-k" />
          <i className="mtg-f" />
          {number}
          {corner}
        </div>
      )}
    </div>
  );
}

/** Our own mark: two feelers over a little head, in a ring */
export function Feelers({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 30.5c-4.6 0-7.4-3.2-7.4-7.2 0-3.6 3-6.3 7.4-6.3s7.4 2.7 7.4 6.3c0 4-2.8 7.2-7.4 7.2z" fill="currentColor" />
      <path
        d="M17.2 17.6C15.4 11.6 12 8.4 7.6 8.2M22.8 17.6c1.8-6 5.2-9.2 9.6-9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A pass face down, before it is turned over */
export function CardBack() {
  return (
    <div className="zb">
      <Feelers />
      <small>PASS</small>
    </div>
  );
}
