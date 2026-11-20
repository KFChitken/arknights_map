"use client";

import { memo, type CSSProperties } from "react";
import { T } from "@/i18n";
import type { FishShadow } from "@/lib/fish/rules";
import { poseAt, SPOTS, type FishPhase } from "./pose";

/**
 * 钓鳞's bank, 龙门外环 at dusk (the design's Pier canvas), drawn in one SVG of 390 × 560 at the box's full width, down
 * at its foot (fish.css: a tall box gets more night sky over it, a short one loses sky first): the city across the water, the lamp and the sign, the pier with the player's roach
 * on it, the rod, the line and the float, and what happens at the float (a shadow passing, the bite's 咕咚 and the
 * yellow ring closing in every 1.4 s, the catch dragged in and leaping out to land by the roach).
 */

/** The scenery, which never moves but for its stars and steam */
const Backdrop = memo(function Backdrop() {
  return (
    <>
      <defs>
        <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f1c45" />
          <stop offset="0.38" stopColor="#5a2f66" />
          <stop offset="0.72" stopColor="#c4566a" />
          <stop offset="1" stopColor="#f6a35c" />
        </linearGradient>
        <radialGradient id="fs-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff2c4" />
          <stop offset="0.35" stopColor="#ffc56b" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff8a4a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fs-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b4a78" />
          <stop offset="0.25" stopColor="#3d3a6a" />
          <stop offset="1" stopColor="#171d38" />
        </linearGradient>
        <linearGradient id="fs-pier" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#57546a" />
          <stop offset="1" stopColor="#2c2a3a" />
        </linearGradient>
        <radialGradient id="fs-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe7a8" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffb35a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fs-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd58a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffd58a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="390" height="270" fill="url(#fs-sky)" />
      <circle className="fs-twinkle" cx="40" cy="38" r="1.2" fill="#fff" />
      <circle className="fs-twinkle" cx="120" cy="22" r="1" fill="#fff" style={{ animationDelay: "0.8s" }} />
      <circle className="fs-twinkle" cx="214" cy="52" r="1.3" fill="#fff" style={{ animationDelay: "1.4s" }} />
      <circle className="fs-twinkle" cx="344" cy="30" r="1" fill="#fff" style={{ animationDelay: "0.4s" }} />
      <ellipse cx="90" cy="120" rx="80" ry="6" fill="#f08a8a" opacity="0.18" />
      <ellipse cx="300" cy="150" rx="96" ry="7" fill="#ffb27a" opacity="0.2" />
      <ellipse cx="230" cy="96" rx="60" ry="4" fill="#d07aa0" opacity="0.18" />
      <circle cx="300" cy="236" r="70" fill="url(#fs-sun)" />
      <circle cx="300" cy="238" r="22" fill="#fff0c2" />
      <g fill="#3a2748">
        <rect x="6" y="170" width="22" height="66" />
        <rect x="30" y="148" width="18" height="88" />
        <rect x="34" y="132" width="3" height="16" />
        <rect x="50" y="186" width="26" height="50" />
        <rect x="78" y="120" width="24" height="116" />
        <path d="M78 120 L90 104 L102 120 Z" />
        <rect x="104" y="160" width="20" height="76" />
        <rect x="126" y="176" width="30" height="60" />
        <rect x="158" y="140" width="16" height="96" />
        <rect x="163" y="118" width="2" height="22" />
        <rect x="176" y="182" width="28" height="54" />
        <rect x="206" y="196" width="20" height="40" />
        <rect x="228" y="206" width="26" height="30" />
        <rect x="0" y="230" width="262" height="10" />
      </g>
      <g fill="#ffcf7a" opacity="0.75">
        {[
          [83, 132], [92, 146], [83, 170], [95, 190], [34, 160], [40, 184], [12, 186],
          [130, 190], [146, 206], [161, 156], [182, 196], [196, 210], [110, 176],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" />
        ))}
      </g>
      <g fill="#291c36">
        <rect x="0" y="240" width="262" height="10" />
        <rect x="8" y="248" width="64" height="20" rx="9" />
        <rect x="90" y="248" width="64" height="20" rx="9" />
        <rect x="172" y="248" width="64" height="20" rx="9" />
      </g>
      <g fill="#4b3a5c">
        {[22, 40, 58, 104, 122, 140, 186, 204, 222].map((x) => (
          <circle key={x} cx={x} cy="258" r="5" />
        ))}
      </g>
      <ellipse className="fs-steam" cx="70" cy="112" rx="10" ry="7" fill="#c9b6d6" />
      <ellipse className="fs-steam" cx="168" cy="110" rx="8" ry="6" fill="#c9b6d6" style={{ animationDelay: "1.3s" }} />
      <text x="236" y="226" fontSize="9" fill="#ffcf7a" opacity="0.7">
        {T.fish.scene.city}
      </text>
      <rect x="0" y="266" width="390" height="294" fill="url(#fs-water)" />
      <rect x="0" y="266" width="390" height="4" fill="#2a1d38" opacity="0.6" />
      <g fill="#ffcf8a">
        {[
          [282, 276, 36, 0.8], [286, 288, 28, 0.7], [278, 300, 40, 0.6], [288, 314, 22, 0.5],
          [280, 330, 34, 0.4], [290, 348, 18, 0.32], [284, 368, 26, 0.24], [292, 392, 14, 0.16],
        ].map(([x, y, w, o]) => (
          <rect key={y} x={x} y={y} width={w} height="2" opacity={o} />
        ))}
      </g>
      <g fill="#ffcf7a" opacity="0.25">
        <rect x="83" y="276" width="3" height="5" />
        <rect x="92" y="284" width="3" height="4" />
        <rect x="34" y="280" width="3" height="5" />
        <rect x="146" y="278" width="3" height="4" />
      </g>
      <g stroke="#cdbfe6" strokeWidth="1" fill="none" opacity="0.18">
        <path d="M200 300 q 20 -3 40 0" />
        <path d="M330 330 q 24 -3 48 0" />
        <path d="M220 390 q 30 -4 60 0" />
        <path d="M300 450 q 26 -3 52 0" />
        <path d="M210 500 q 34 -4 68 0" />
      </g>
      <rect x="0" y="410" width="182" height="150" fill="url(#fs-pier)" />
      <rect x="0" y="410" width="182" height="8" fill="#77738a" />
      <polygon points="182,410 192,416 192,560 182,560" fill="#232130" />
      <g stroke="#3a3748" strokeWidth="1">
        <path d="M0 450 H182 M0 492 H182 M0 534 H182" />
        <path d="M60 418 V450 M130 418 V450 M30 450 V492 M100 450 V492 M160 450 V492 M60 492 V534 M130 492 V534" />
      </g>
      <rect x="152" y="396" width="14" height="16" rx="3" fill="#2a2836" />
      <rect x="150" y="394" width="18" height="5" rx="2" fill="#3c394c" />
      <polygon points="26,262 6,410 46,410" fill="url(#fs-cone)" />
      <rect x="24" y="250" width="4" height="162" fill="#1f1d2b" />
      <rect x="18" y="246" width="16" height="6" rx="2" fill="#1f1d2b" />
      <circle cx="26" cy="256" r="26" fill="url(#fs-lamp)" />
      <circle cx="26" cy="256" r="4" fill="#fff4cf" />
      <rect x="6" y="318" width="40" height="15" rx="2" fill="#2f5a46" />
      <text x="26" y="329" textAnchor="middle" fontSize="8.5" fill="#e6f2ea">
        {T.fish.scene.sign}
      </text>
      <path d="M54 394 L84 394 L80 412 L58 412 Z" fill="#2f6fa6" />
      <rect x="52" y="391" width="34" height="4" rx="2" fill="#4a8cc4" />
      <path d="M70 392 l -6 -10 l 4 2 l 3 -6 l 2 6 l 4 -2 z" fill="#c9cdd3" />
      <g fill="#120f1f" opacity="0.9">
        <path d="M352 560 C 350 520, 356 490, 360 470 C 362 492, 360 520, 362 560 Z" />
        <path d="M364 560 C 366 530, 372 500, 380 486 C 378 512, 374 532, 374 560 Z" />
        <path d="M374 560 C 378 528, 386 512, 392 504 L 392 560 Z" />
        <ellipse cx="360" cy="468" rx="2.6" ry="8" fill="#3a2a22" />
        <ellipse cx="380" cy="484" rx="2.4" ry="7" fill="#3a2a22" />
      </g>
    </>
  );
});

const SHADOW_SIZE: Record<FishShadow, [number, number]> = { s: [40, 11], m: [58, 16], l: [84, 22] };

export default function FishScene({
  phase,
  ms,
  shadow,
  ringDelay,
  catchPic,
  roach,
  label,
  zhi,
}: {
  phase: FishPhase;
  /** How far into this step (cast, reel, leap) */
  ms: number;
  /** A shadow passing by the float now, and its size */
  shadow: FishShadow | null;
  /** Where in its 1.4 s the closing ring is, as a CSS delay (negative), so it closes on the float as the server counts */
  ringDelay: number;
  /** The catch's picture, while it comes in and once it is out */
  catchPic: string | null;
  /** The player's roach as a picture */
  roach: string | null;
  /** Under the roach: 你, and 空军司令 on such a day */
  label: string;
  zhi: boolean;
}) {
  const p = poseAt(phase, ms);
  const B = SPOTS.B;
  const ring: CSSProperties = { animationDelay: `${ringDelay}ms` };
  return (
    <svg className="fish-scene" viewBox="0 0 390 560" aria-hidden="true">
      <Backdrop />
      {p.line && <path d={p.line} stroke="#eef2f8" strokeWidth="0.9" fill="none" opacity="0.85" />}
      <path d={p.rod} stroke="#2a1a10" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d={p.grip} stroke="#6b3d1e" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx={p.reel[0]} cy={p.reel[1]} r="4" fill="#9aa0aa" stroke="#3a3f47" strokeWidth="1" />
      {roach && <image href={roach} x="86" y="340" width="72" height="72" />}
      <g transform="translate(122 420)">
        <rect className="fs-label" x={-label.length * 6.5 - 6} y="-1" width={label.length * 13 + 12} height="17" rx="6" />
        <text className="fs-label-t" x="0" y="12" textAnchor="middle">
          {label}
        </text>
      </g>
      {zhi && (
        // a CSS transform would take the place of the group's own, so the pop is a group inside it
        <g transform="translate(90 326)">
          <g className="fs-pop">
            <rect x="-20" y="-14" width="40" height="22" rx="10" fill="#fff" />
            <text x="0" y="2" textAnchor="middle" className="fs-bubble-t">
              {T.fish.zhiSaid}
            </text>
          </g>
        </g>
      )}
      {phase === "wait" && shadow && (
        <ellipse className="fs-swim" cx={B[0]} cy={B[1] + 18} rx={SHADOW_SIZE[shadow][0] / 2} ry={SHADOW_SIZE[shadow][1] / 2} fill="rgba(6,10,26,0.6)" filter="url(#fs-blur)" />
      )}
      <defs>
        <filter id="fs-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      {(phase === "wait" || phase === "bite") && (
        <g transform={`translate(${B[0]} ${B[1] + 2})`}>
          <ellipse className="fs-ripple" rx="20" ry="10" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" />
        </g>
      )}
      {phase === "bite" && (
        <>
          <circle className="fs-ring" cx={B[0]} cy={B[1]} r="15.5" fill="none" stroke="#ffd23f" strokeWidth="3" style={ring} />
          <g transform={`translate(${B[0]} ${B[1] - 36})`}>
            <g className="fs-pop">
              <rect x="-26" y="-14" width="52" height="22" rx="10" fill="#fff" />
              <text x="0" y="2" textAnchor="middle" className="fs-bubble-t">
                {T.fish.bang}
              </text>
            </g>
          </g>
        </>
      )}
      {p.bob && (
        <g transform={`translate(${p.bob[0]} ${p.bob[1]})`}>
          <g className={phase === "bite" ? "fs-dip" : phase === "wait" ? "fs-bob" : undefined}>
            <path d="M0 -12 L0 -5" stroke="#1b1d22" strokeWidth="1.2" />
            <path d="M-4.5 0 A4.5 6 0 0 1 4.5 0 Z" fill="#ff4a2e" />
            <path d="M-4.5 0 A4.5 6 0 0 0 4.5 0 Z" fill="#ffffff" />
          </g>
        </g>
      )}
      {p.fish && catchPic && (
        <g transform={`translate(${p.fish.at[0]} ${p.fish.at[1]}) rotate(${p.fish.rot}) scale(${p.fish.scale})`}>
          {p.fish.under && <ellipse rx="20" ry="8" cy="8" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2" />}
          <image
            href={catchPic}
            x={p.fish.under ? -24 : -28}
            y={p.fish.under ? -24 : -28}
            width={p.fish.under ? 48 : 56}
            height={p.fish.under ? 48 : 56}
            className={p.fish.under ? "fs-thrash fs-dark" : undefined}
          />
        </g>
      )}
      {phase === "leap" && ms < 500 && (
        <g transform={`translate(${SPOTS.S[0]} ${SPOTS.S[1] + 2})`}>
          <ellipse className="fs-ripple" rx="24" ry="12" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" />
        </g>
      )}
      {phase === "caught" && catchPic && <image className="fs-float" href={catchPic} x="98" y="262" width="60" height="60" />}
    </svg>
  );
}
