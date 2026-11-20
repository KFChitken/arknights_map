"use client";

import { memo, type CSSProperties } from "react";
import { T } from "@/i18n";
import type { FishShadow } from "@/lib/fish/rules";
import { poseAt, type FishPhase, type Geo } from "./pose";

/** One of the room's others by the pond: their picture, name, a line in the water, 爆护, 空军司令, what they just said */
export type PondSeat = {
  key: number;
  pic: string | null;
  name: string;
  fishing: boolean;
  protect: boolean;
  admiral: boolean;
  said: string | null;
};
/**
 * A flag on the wall for a strategy picked in the room: its operator's picture (pic), else the first character of
 * their name (text); its colours (its core alliance's)
 */
export type PondFlag = { text: string; pic: string | null; bg: string; fg: string };

/**
 * 钓鳞's two scenes in its small window (FishWin.tsx), 360 × 190 (the design's FishWin canvas): the bank (龙门外环's
 * sky, the city, the river, the pier with its lamp) and 卫戍池塘 (the defence wall with a flag for each strategy
 * picked, the fight's glow past it while a round plays, the pond, the room round it, the campfire). The rod, line,
 * float, shadows, the bite's ring and 咕咚, the reel and the leap are the full scenes' own (pose.ts), at this size.
 */

/** The bank's rod and water in the window */
export const WIN_PIER: Geo = { P: [86, 138], L: 93, a0: -46.7, back: 55, B: [250, 148], S: [150, 160], K: [76, 72], sag: 10, pull: 18 };
/** 卫戍池塘's, in the window */
export const WIN_POND: Geo = { P: [70, 152], L: 71, a0: -42.7, back: 45, B: [190, 130], S: [122, 150], K: [57, 100], sag: 8, pull: 16 };

/** Where the room's others sit (their picture's top left and size), and their rod and float while they fish */
const SEATS: { x: number; y: number; s: number; rod: string; line: string; float: [number, number] }[] = [
  { x: 296, y: 78, s: 42, rod: "M302 98 Q 284 92 270 100", line: "M270 100 Q 262 108 262 114", float: [262, 116] },
  { x: 66, y: 66, s: 40, rod: "M100 88 Q 116 86 128 94", line: "M128 94 Q 134 102 134 108", float: [134, 110] },
  { x: 300, y: 134, s: 40, rod: "M302 150 Q 284 146 272 150", line: "M272 150 Q 266 154 264 154", float: [264, 156] },
];
/** The flags' places on the wall */
const POLES = [41, 141, 241, 321];

const PierBack = memo(function PierBack() {
  return (
    <>
      <defs>
        <linearGradient id="wsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2257" />
          <stop offset="0.7" stopColor="#7a4a7a" />
          <stop offset="1" stopColor="#d07a6a" />
        </linearGradient>
        <linearGradient id="wwater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b4a78" />
          <stop offset="0.3" stopColor="#3d3a6a" />
          <stop offset="1" stopColor="#171d38" />
        </linearGradient>
        <linearGradient id="wpier" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#57546a" />
          <stop offset="1" stopColor="#2c2a3a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="360" height="92" fill="url(#wsky)" />
      <circle className="fw-twinkle" cx="40" cy="18" r="1.1" fill="#fff" />
      <circle className="fw-twinkle" cx="190" cy="12" r="1" fill="#fff" style={{ animationDelay: "0.9s" }} />
      <circle className="fw-twinkle" cx="300" cy="22" r="1.1" fill="#fff" style={{ animationDelay: "1.6s" }} />
      <circle cx="292" cy="84" r="20" fill="#fff0c2" opacity="0.9" />
      <g fill="#3a2748">
        <rect x="6" y="54" width="18" height="40" />
        <rect x="26" y="40" width="14" height="54" />
        <rect x="42" y="60" width="22" height="34" />
        <rect x="66" y="30" width="20" height="64" />
        <path d="M66 30 L76 18 L86 30 Z" />
        <rect x="88" y="52" width="16" height="42" />
        <rect x="106" y="62" width="26" height="32" />
        <rect x="134" y="44" width="12" height="50" />
        <rect x="148" y="66" width="24" height="28" />
        <rect x="174" y="72" width="18" height="22" />
        <rect x="194" y="78" width="22" height="16" />
      </g>
      <g fill="#ffcf7a" opacity="0.75">
        <rect x="70" y="42" width="3" height="3" />
        <rect x="78" y="58" width="3" height="3" />
        <rect x="30" y="52" width="3" height="3" />
        <rect x="138" y="56" width="3" height="3" />
        <rect x="112" y="72" width="3" height="3" />
      </g>
      <text x="198" y="74" fontSize="8" fill="#ffcf7a" opacity="0.7">
        {T.fish.scene.city}
      </text>
      <rect x="0" y="92" width="360" height="98" fill="url(#wwater)" />
      <g fill="#ffcf8a">
        <rect x="276" y="98" width="32" height="2" opacity="0.8" />
        <rect x="280" y="108" width="24" height="2" opacity="0.6" />
        <rect x="274" y="120" width="34" height="2" opacity="0.45" />
        <rect x="284" y="134" width="16" height="2" opacity="0.3" />
      </g>
      <g stroke="#cdbfe6" strokeWidth="1" fill="none" opacity="0.2">
        <path d="M190 112 q 18 -3 36 0" />
        <path d="M300 150 q 20 -3 40 0" />
        <path d="M210 172 q 26 -4 52 0" />
      </g>
      <rect x="0" y="140" width="128" height="50" fill="url(#wpier)" />
      <rect x="0" y="140" width="128" height="6" fill="#77738a" />
      <polygon points="128,140 136,145 136,190 128,190" fill="#232130" />
      <rect x="10" y="118" width="3" height="24" fill="#1f1d2b" />
      <circle cx="11.5" cy="118" r="10" fill="#ffd58a" opacity="0.35" />
      <circle cx="11.5" cy="118" r="2.6" fill="#fff4cf" />
    </>
  );
});

const PondBack = memo(function PondBack({ glow, school }: { glow: boolean; school: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id="psky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0f1f" />
          <stop offset="1" stopColor="#3a2c38" />
        </linearGradient>
        <radialGradient id="pfire" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff8a3a" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ff8a3a" stopOpacity="0" />
        </radialGradient>
        <pattern id="phaz" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect x="0" y="0" width="6" height="12" fill="#f2c230" />
          <rect x="6" y="0" width="6" height="12" fill="#1b1d22" />
        </pattern>
        <radialGradient id="pwater" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#3f8fb0" />
          <stop offset="0.55" stopColor="#23607f" />
          <stop offset="1" stopColor="#143850" />
        </radialGradient>
        {/* a flag's operator picture, round */}
        <clipPath id="pflag" clipPathUnits="objectBoundingBox">
          <circle cx="0.5" cy="0.5" r="0.5" />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="360" height="40" fill="url(#psky)" />
      {glow && <ellipse className="fw-glow" cx="240" cy="40" rx="150" ry="34" fill="url(#pfire)" />}
      <rect x="0" y="36" width="360" height="30" fill="#434a57" />
      <rect x="0" y="33" width="360" height="5" fill="url(#phaz)" />
      <g stroke="#2f343e" strokeWidth="1.2">
        <path d="M60 38 V66 M120 38 V66 M180 38 V66 M240 38 V66 M300 38 V66" />
      </g>
      <rect x="0" y="66" width="360" height="124" fill="#262a31" />
      <ellipse cx="190" cy="128" rx="128" ry="44" fill="#4d525c" />
      <ellipse cx="190" cy="127" rx="123" ry="41" fill="url(#pwater)" />
      <ellipse cx="160" cy="114" rx="50" ry="7" fill="#d8efff" opacity="0.12" />
      <g stroke="#d8efff" strokeWidth="1" fill="none" opacity="0.28">
        <path d="M120 130 q 12 -3 24 0" />
        <path d="M220 142 q 14 -3 28 0" />
        <path d="M250 112 q 12 -2 24 0" />
      </g>
      {school && (
        <g className="fw-school">
          <ellipse cx="200" cy="124" rx="70" ry="20" fill="#bff3ff" opacity="0.16" />
          {[
            [168, 118], [196, 128], [226, 116], [182, 136], [214, 140],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} className="fw-twinkle" cx={x} cy={y} r="1.6" fill="#fff6c8" />
          ))}
        </g>
      )}
    </>
  );
});

/** The room's 篝火 by the pond (src/lib/squadFire.ts): two logs, and flames as big as its level, none once it is out */
function Camp({ level }: { level: number }) {
  const s = 0.55 + level * 0.15;
  return (
    <g>
      {level > 0 && (
        <>
          <defs>
            <radialGradient id="pcamp">
              <stop offset="0" stopColor="#ffb05a" stopOpacity="0.8" />
              <stop offset="1" stopColor="#ffb05a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle className="fw-camp-glow" cx="336" cy="172" r={14 + level * 5} fill="url(#pcamp)" fillOpacity={0.35 + level * 0.13} />
        </>
      )}
      <rect x="325" y="176" width="22" height="4" rx="2" fill="#6b4426" transform="rotate(-14 336 178)" />
      <rect x="325" y="176" width="22" height="4" rx="2" fill="#7d5130" transform="rotate(14 336 178)" />
      {level > 0 && (
        <g transform={`translate(336 178) scale(${s.toFixed(2)}) translate(-336 -178)`}>
          <path className="fw-flick" d="M336 156 C 343 164, 346 170, 342 178 L 330 178 C 326 170, 329 164, 336 156 Z" fill="#ff8a2a" />
          <path className="fw-flick" d="M336 166 C 340 170, 341 174, 339 178 L 333 178 C 331 174, 332 170, 336 166 Z" fill="#ffd36a" style={{ animationDelay: "-0.2s" }} />
        </g>
      )}
    </g>
  );
}

const SHADOW: Record<FishShadow, [number, number]> = { s: [26, 7], m: [36, 10], l: [52, 14] };

/** The float, red over white, bobbing while it waits, dipping at the bite */
function Float({ x, y, phase }: { x: number; y: number; phase?: FishPhase }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={phase === "bite" ? "fs-dip" : "fs-bob"}>
        <path d="M0 -8 L0 -3" stroke="#1b1d22" strokeWidth="1" />
        <path d="M-3 0 A3 4 0 0 1 3 0 Z" fill="#ff4a2e" />
        <path d="M-3 0 A3 4 0 0 0 3 0 Z" fill="#ffffff" />
      </g>
    </g>
  );
}

/** A label under a roach: a dark rounded box with white words, centred on x */
function Label({ x, y, text, warm = false }: { x: number; y: number; text: string; warm?: boolean }) {
  const w = text.length * 8.6 + 10;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-w / 2} y="0" width={w} height="13" rx="5" fill={warm ? "rgba(122,83,0,0.85)" : "rgba(0,0,0,0.5)"} />
      <text x="0" y="10" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#fff">
        {text}
      </text>
    </g>
  );
}

export default function WinScene({
  pond,
  phase,
  ms,
  shadow,
  ringDelay,
  catchPic,
  roach,
  label,
  zhi,
  seats = [],
  flags = [],
  fire = false,
  school = false,
  camp = 0,
}: {
  /** 卫戍池塘 rather than the bank */
  pond: boolean;
  phase: FishPhase;
  ms: number;
  shadow: FishShadow | null;
  /** Where in its 1.4 s the closing ring is, as a CSS delay (negative) */
  ringDelay: number;
  catchPic: string | null;
  roach: string | null;
  label: string;
  zhi: boolean;
  /** 卫戍池塘: up to three others, in seat order; the flags; the fight's glow (a round plays); a 鱼群 */
  seats?: PondSeat[];
  flags?: PondFlag[];
  fire?: boolean;
  school?: boolean;
  /** 卫戍池塘: the room's 篝火, its level now (0: out) */
  camp?: number;
}) {
  const G = pond ? WIN_POND : WIN_PIER;
  const p = poseAt(phase, ms, G);
  const B = G.B;
  const ring: CSSProperties = { animationDelay: `${ringDelay}ms` };
  // the player's roach: on the pier, or at the pond's near side
  const me = pond ? { x: 34, y: 120, s: 46 } : { x: 50, y: 92, s: 50 };
  return (
    <svg className="fish-scene fw-scene" viewBox="0 0 360 190" aria-hidden="true">
      {pond ? <PondBack glow={fire} school={school} /> : <PierBack />}
      {pond && <Camp level={camp} />}
      {pond &&
        flags.slice(0, POLES.length).map((f, i) => (
          <g key={i}>
            <polygon points={`${POLES[i] - 13},38 ${POLES[i] + 13},38 ${POLES[i] + 13},66 ${POLES[i]},61 ${POLES[i] - 13},66`} fill={f.bg} />
            {f.pic ? (
              <>
                <circle cx={POLES[i]} cy="49" r="10.2" fill={f.fg} />
                <image href={f.pic} x={POLES[i] - 9.3} y="39.7" width="18.6" height="18.6" clipPath="url(#pflag)" />
              </>
            ) : (
              <text x={POLES[i]} y="55" textAnchor="middle" fontSize="12.5" fontWeight="900" fill={f.fg}>
                {f.text}
              </text>
            )}
          </g>
        ))}
      {pond &&
        seats.slice(0, SEATS.length).map((s, i) => {
          const at = SEATS[i];
          return (
            <g key={s.key}>
              {s.fishing && (
                <>
                  <path d={at.rod} stroke="#2a1a10" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                  <path d={at.line} stroke="#eef2f8" strokeWidth="0.7" fill="none" opacity="0.8" />
                  <Float x={at.float[0]} y={at.float[1]} />
                </>
              )}
              {s.pic && <image href={s.pic} x={at.x} y={at.y} width={at.s} height={at.s} />}
              <Label x={at.x + at.s / 2} y={at.y + at.s - 4} text={s.admiral ? `${s.name} · ${T.fish.admiral}` : s.name} />
              {s.protect && <Label x={at.x + at.s / 2} y={at.y + at.s + 10} text={T.fish.pond.protect} warm />}
              {s.said && (
                <g transform={`translate(${at.x + at.s / 2} ${at.y - 4})`}>
                  <rect x={-s.said.length * 4.6 - 5} y="-12" width={s.said.length * 9.2 + 10} height="14" rx="6" fill="#fff" />
                  <text x="0" y="-1.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1b1d22">
                    {s.said}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      {p.line && <path d={p.line} stroke="#eef2f8" strokeWidth="0.8" fill="none" opacity="0.85" />}
      <path d={p.rod} stroke="#2a1a10" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d={p.grip} stroke="#6b3d1e" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      {roach && <image href={roach} x={me.x} y={me.y} width={me.s} height={me.s} />}
      <Label x={me.x + me.s / 2} y={me.y + me.s - 2} text={label} />
      {zhi && (
        <g transform={`translate(${me.x + 8} ${me.y - 4})`}>
          <g className="fs-pop">
            <rect x="-14" y="-10" width="28" height="15" rx="7" fill="#fff" />
            <text x="0" y="1.5" textAnchor="middle" fontSize="10" fontWeight="900" fill="#1b1d22">
              {T.fish.zhiSaid}
            </text>
          </g>
        </g>
      )}
      {phase === "wait" && shadow && (
        <ellipse className="fs-swim" cx={B[0]} cy={B[1] + 11} rx={SHADOW[shadow][0] / 2} ry={SHADOW[shadow][1] / 2} fill="rgba(6,10,26,0.6)" filter="url(#fw-blur)" />
      )}
      <defs>
        <filter id="fw-blur" x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {(phase === "wait" || phase === "bite") && (
        <g transform={`translate(${B[0]} ${B[1] + 1})`}>
          <ellipse className="fs-ripple" rx="16" ry="6" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.4" />
        </g>
      )}
      {phase === "bite" && (
        <>
          <circle className="fs-ring" cx={B[0]} cy={B[1]} r="11" fill="none" stroke="#ffd23f" strokeWidth="2.6" style={ring} />
          <g transform={`translate(${B[0] + 30} ${B[1] - 26})`}>
            <g className="fs-pop">
              <rect x="-24" y="-12" width="48" height="19" rx="8" fill="#fff" />
              <text x="0" y="2" textAnchor="middle" fontSize="12" fontWeight="900" fill="#1b1d22">
                {T.fish.bang}
              </text>
            </g>
          </g>
        </>
      )}
      {p.bob && <Float x={p.bob[0]} y={p.bob[1]} phase={phase} />}
      {p.fish && catchPic && (
        <g transform={`translate(${p.fish.at[0]} ${p.fish.at[1]}) rotate(${p.fish.rot}) scale(${p.fish.scale})`}>
          {p.fish.under && <ellipse rx="13" ry="5" cy="5" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.4" />}
          <image
            href={catchPic}
            x={p.fish.under ? -15 : -18}
            y={p.fish.under ? -15 : -18}
            width={p.fish.under ? 30 : 36}
            height={p.fish.under ? 30 : 36}
            className={p.fish.under ? "fs-thrash fs-dark" : undefined}
          />
        </g>
      )}
      {phase === "leap" && ms < 500 && (
        <g transform={`translate(${G.S[0]} ${G.S[1] + 1})`}>
          <ellipse className="fs-ripple" rx="16" ry="7" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" />
        </g>
      )}
      {phase === "caught" && catchPic && <image className="fs-float" href={catchPic} x={G.K[0] - 19} y={G.K[1] - 19} width="38" height="38" />}
    </svg>
  );
}
