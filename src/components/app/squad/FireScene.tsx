"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { fireColor, fireGlow, fireScale, fireStage, FIRE_STAGES, type FireStage } from "@/lib/squadFire";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";

/**
 * 篝火's scene at any level (篝火不封顶), drawn by us in CSS shapes and inline SVG, 366 × 300 as the design draws it
 * and scaled to the card's width: the sky, the flame and its glow growing to Lv.100, and each of the eight stages
 * (src/lib/squadFire.ts FIRE_STAGES) adding its own: stones and a skewered 源石虫, 大炎's hotpot, 龙门近卫局's sign,
 * the map lit up with pins and roaches walking in, 天灾信使's tape, 罗德岛 passing on the horizon. The room's roaches
 * sit round it (they dance from 近卫局 on); from Lv.220 the flame takes another colour each 20 levels.
 */

export const SCENE_W = 366;
export const SCENE_H = 300;

/** The flame's colours by fireColor: its core, middle and edge; and its glow's, as r,g,b */
const COLORS: [string, string, string][] = [
  ["#fff3b0", "#ffb341", "#ff6a2a"],
  ["#eef9ff", "#8fd3ff", "#3a7bff"],
  ["#fbeaff", "#d59bff", "#8a3aff"],
  ["#f1ffe4", "#9dff7a", "#22b84a"],
  ["#fffbe6", "#ffe066", "#ffae00"],
  ["#ffffff", "#ffc7e3", "#ff4f9a"],
];
const GLOWS = ["255,140,50", "90,160,255", "180,110,255", "120,255,120", "255,210,80", "255,110,170"];
/** A small flame's colour, as the board draws a room's (by fireColor) */
export const flameColor = (color: number) => COLORS[color]?.[2] ?? COLORS[0][2];
export const flameInner = (color: number) => COLORS[color]?.[1] ?? COLORS[0][1];

const SKIES: Record<FireStage, [string, string, string]> = {
  out: ["#151a28", "#232a3b", "#2e2a2a"],
  small: ["#151a28", "#232a3b", "#2e2a2a"],
  slug: ["#161a2a", "#262a3a", "#3a2c26"],
  pot: ["#181a2c", "#2a2a3a", "#4a3024"],
  guard: ["#1d1b2e", "#33293a", "#5a3422"],
  map: ["#111a34", "#1d2a4c", "#3a2a3a"],
  storm: ["#2a0f14", "#5a1c16", "#8a3a1a"],
  ship: ["#1a0f1f", "#4a1d22", "#9a4a1e"],
};
const STARRY: ReadonlySet<FireStage> = new Set(["out", "small", "slug", "pot", "guard", "map"]);
const STARS = [
  [30, 30],
  [90, 18],
  [140, 44],
  [220, 22],
  [300, 40],
  [340, 16],
  [60, 70],
  [270, 74],
];
const EMBERS = [0, 2, 4, 6, 8, 10, 12, 12];
/** Where the room's four roaches sit: two in front, two behind; the right ones face left */
const SEATS = [
  { x: 26, y: 214, s: 50, flip: false, delay: 0 },
  { x: 290, y: 214, s: 50, flip: true, delay: 0.35 },
  { x: 73, y: 244, s: 44, flip: false, delay: 0.18 },
  { x: 249, y: 244, s: 44, flip: true, delay: 0.52 },
];
const WALKERS = [
  { x: -6, y: 166, s: 22, dx: 34, t: 4, flip: false },
  { x: 350, y: 160, s: 20, dx: -30, t: 4.6, flip: true },
  { x: 150, y: 138, s: 14, dx: 22, t: 5, flip: false },
];
const PINS: [number, number, number, string, number][] = [
  [30, 146, 0.9, "#ff8a3a", 0],
  [96, 160, 1, "#ffd23f", 0.4],
  [258, 158, 1, "#ff8a3a", 0.8],
  [322, 144, 0.9, "#ffd23f", 1.2],
  [4, 186, 1.15, "#ffd23f", 0.6],
  [340, 184, 1.15, "#ff8a3a", 1],
];
const CRYSTALS: [number, number, number][] = [
  [22, 214, 1],
  [346, 214, 1],
  [124, 236, 0.75],
  [244, 236, 0.75],
  [8, 292, 1.1],
  [358, 294, 1],
];

export type FireLook = { key: number; color: string; avatar: string };

const px = (n: number) => `${n}px`;

function Roach({ r, x, y, s, flip, hop, delay, style }: { r: FireLook; x: number; y: number; s: number; flip: boolean; hop: boolean; delay: number; style?: CSSProperties }) {
  return (
    <span
      className={`sqff-roach${hop ? (flip ? " hopf" : " hop") : flip ? " flip" : ""}`}
      style={{ left: px(x), top: px(y), width: px(s), height: px(s), animationDelay: hop ? `${delay}s` : undefined, ...style }}
    >
      <RoachIcon color={r.color as RoachColor} avatar={r.avatar as RoachAvatar} size={s} />
    </span>
  );
}

function Flame({ level, stage, colors }: { level: number; stage: number; colors: [string, string, string] }) {
  const { x, y } = fireScale(level);
  const [c1, c2, c3] = colors;
  const g = (a: string, b: string, c: string) => `radial-gradient(60% 70% at 50% 80%, ${a} 0%, ${b} 40%, ${c} 70%, rgba(0,0,0,0) 100%)`;
  return (
    <div className="sqff-flame" style={{ transform: `scale(${x}, ${y})` }}>
      {stage >= 4 && (
        <>
          <i className="e" style={{ background: g(c2, c3, c3) }} />
          <i className="f" style={{ background: g(c2, c3, c3) }} />
        </>
      )}
      {stage >= 2 && (
        <>
          <i className="c" style={{ background: g(c1, c2, c3) }} />
          <i className="d" style={{ background: g(c1, c2, c3) }} />
        </>
      )}
      <i className="a" style={{ background: g(c1, c2, c3) }} />
      <i className="b" style={{ background: `radial-gradient(60% 70% at 50% 80%, #ffffff 0%, ${c1} 45%, rgba(0,0,0,0) 100%)` }} />
    </div>
  );
}

const SVG_FONT = "Noto Sans SC, PingFang SC, sans-serif";

function Logs() {
  return (
    <svg className="sqff-at" width="140" height="40" viewBox="0 0 140 40" style={{ left: 113, top: 198 }} aria-hidden="true">
      <rect x="12" y="20" width="116" height="12" rx="6" fill="#6b4426" transform="rotate(-12 70 26)" />
      <rect x="12" y="20" width="116" height="12" rx="6" fill="#7d5130" transform="rotate(12 70 26)" />
      <ellipse cx="70" cy="34" rx="64" ry="6" fill="rgba(0,0,0,0.35)" />
    </svg>
  );
}

function Stones() {
  const stones: [number, number, number, number, string][] = [
    [14, 16, 12, 8, "#5d6270"],
    [36, 24, 13, 8, "#6b7080"],
    [62, 28, 12, 7, "#565b68"],
    [128, 28, 12, 7, "#606574"],
    [154, 24, 13, 8, "#6b7080"],
    [176, 16, 12, 8, "#585d6a"],
  ];
  return (
    <svg className="sqff-at" width="190" height="34" viewBox="0 0 190 34" style={{ left: 88, top: 214 }} aria-hidden="true">
      {stones.map(([cx, cy, rx, ry, c], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={c} stroke="#14161b" strokeWidth="1.5" />
      ))}
    </svg>
  );
}

function Skewer() {
  return (
    <>
      <svg className="sqff-at" width="110" height="80" viewBox="0 0 110 80" style={{ left: 50, top: 156, overflow: "visible" }} aria-hidden="true">
        <path d="M8 70 L92 22" stroke="#8a5a2b" strokeWidth="5" strokeLinecap="round" />
        <path d="M8 70 L92 22" stroke="#a8743d" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own small picture (扔东西's 源石虫) */}
      <img className="sqff-at sqff-slug" src="/fish/slug.webp" alt="" width={40} height={40} />
      <span className="sqff-at sqff-sizzle">{T.squad.fire.sizzle}</span>
    </>
  );
}

function Hotpot() {
  return (
    <>
      {[
        [164, 0],
        [180, 0.6],
        [196, 1.2],
      ].map(([x, d]) => (
        <span key={x} className="sqff-at sqff-steam" style={{ left: x, animationDelay: `${d}s` }} />
      ))}
      <svg className="sqff-at" width="180" height="170" viewBox="0 0 180 170" style={{ left: 93, top: 90, overflow: "visible" }} aria-hidden="true">
        <path d="M90 8 L30 142 M90 8 L150 142" stroke="#2a2420" strokeWidth="5" strokeLinecap="round" />
        <path d="M90 8 L30 142 M90 8 L150 142" stroke="#4a3a30" strokeWidth="2" strokeLinecap="round" />
        <path d="M90 10 L90 52" stroke="#1b1d22" strokeWidth="2.2" />
        <path d="M48 56 L132 56 L126 92 Q90 110 54 92 Z" fill="#2c2f36" stroke="#14161b" strokeWidth="2.4" strokeLinejoin="round" />
        <path d="M44 50 Q90 40 136 50 L136 58 Q90 68 44 58 Z" fill="#3a3e46" stroke="#14161b" strokeWidth="2.4" />
        <ellipse cx="90" cy="53" rx="42" ry="7" fill="#d8341f" />
        <ellipse cx="90" cy="52" rx="36" ry="4.5" fill="#f0582f" />
        <circle cx="74" cy="52" r="2.2" fill="#ffd23f" />
        <circle cx="98" cy="51" r="2.6" fill="#7a1a10" />
        <circle cx="108" cy="54" r="1.8" fill="#ffd23f" />
        <circle cx="84" cy="55" r="1.6" fill="#ffe9a8" />
        <path d="M110 50 L124 22 M116 51 L132 25" stroke="#c7924d" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="90" cy="78" r="12" fill="#d8341f" stroke="#14161b" strokeWidth="1.8" />
        <text x="90" y="83" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff3d6" fontFamily={SVG_FONT}>
          {T.squad.fire.yan}
        </text>
      </svg>
    </>
  );
}

function GuardSign() {
  return (
    <>
      <svg className="sqff-at" width="96" height="130" viewBox="0 0 96 130" style={{ left: 262, top: 96, overflow: "visible" }} aria-hidden="true">
        <rect x="44" y="40" width="7" height="92" fill="#6b6f78" stroke="#14161b" strokeWidth="1.5" />
        <rect x="4" y="6" width="88" height="54" rx="5" fill="#f4f6fa" stroke="#14161b" strokeWidth="2.2" />
        <rect x="4" y="6" width="88" height="17" rx="5" fill="#1c3fae" stroke="#14161b" strokeWidth="2.2" />
        <rect x="4" y="16" width="88" height="7" fill="#1c3fae" />
        <text x="48" y="19" textAnchor="middle" fontSize="10.5" fontWeight="900" fill="#fff" fontFamily={SVG_FONT}>
          {T.squad.fire.guardTitle}
        </text>
        <text x="48" y="40" textAnchor="middle" fontSize="13" fontWeight="900" fill="#b42318" fontFamily={SVG_FONT}>
          {T.squad.fire.guardLine}
        </text>
        <text x="48" y="54" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#4b5160" fontFamily={SVG_FONT}>
          {T.squad.fire.guardNote}
        </text>
      </svg>
      <span className="sqff-at sqff-siren" />
      <svg className="sqff-at" width="22" height="40" viewBox="0 0 22 40" style={{ left: 340, top: 196 }} aria-hidden="true">
        <rect x="4" y="8" width="14" height="30" rx="5" fill="#d8341f" stroke="#14161b" strokeWidth="1.8" />
        <rect x="8" y="3" width="6" height="6" fill="#2c2f36" stroke="#14161b" strokeWidth="1.4" />
        <path d="M14 5 Q22 6 20 16" stroke="#14161b" strokeWidth="2" fill="none" />
        <rect x="4" y="18" width="14" height="6" fill="#fff3d6" />
      </svg>
    </>
  );
}

function MapPlane() {
  const lines = [150, 158, 170, 188, 214, 250, 296];
  const rays = [-420, -240, -90, 40, 183, 326, 456, 606, 786];
  const blocks: [number, number, number, number][] = [
    [24, 152, 40, 5],
    [292, 160, 50, 7],
    [52, 194, 46, 14],
    [270, 194, 50, 14],
    [14, 222, 52, 24],
    [306, 224, 50, 24],
  ];
  return (
    <svg className="sqff-at" width="366" height="300" viewBox="0 0 366 300" style={{ left: 0, top: 0 }} aria-hidden="true">
      <path d="M0 144 L366 144 L366 300 L0 300 Z" fill="#1d2b4e" />
      <path d="M232 150 L290 150 L306 170 L240 172 Z" fill="rgba(90,200,120,0.35)" />
      <path d="M8 230 L70 226 L80 262 L0 270 Z" fill="rgba(90,200,120,0.30)" />
      <path
        d="M0 176 C60 168 100 186 150 180 C200 174 236 158 286 162 C326 166 344 156 366 152 L366 162 C344 166 326 176 288 172 C236 168 204 184 152 192 C100 200 62 182 0 188 Z"
        fill="rgba(110,170,255,0.55)"
      />
      {blocks.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="rgba(140,170,235,0.22)" />
      ))}
      {lines.map((y, i) => (
        <path key={y} d={`M0 ${y} L366 ${y}`} stroke={`rgba(170,200,255,${(0.22 + i * 0.05).toFixed(2)})`} strokeWidth={(1 + i * 0.35).toFixed(1)} />
      ))}
      {rays.map((x) => (
        <path key={x} d={`M${Math.round(183 + (x - 183) * 0.16)} 144 L${x} 300`} stroke="rgba(170,200,255,0.32)" strokeWidth="1.4" />
      ))}
      <path d="M150 144 L-60 300" stroke="rgba(255,214,120,0.55)" strokeWidth="7" />
      <path d="M150 144 L-60 300" stroke="rgba(30,40,70,0.9)" strokeWidth="1.2" strokeDasharray="6 6" />
      <path d="M226 144 L430 300" stroke="rgba(255,214,120,0.55)" strokeWidth="7" />
      <path d="M226 144 L430 300" stroke="rgba(30,40,70,0.9)" strokeWidth="1.2" strokeDasharray="6 6" />
    </svg>
  );
}

function Pins() {
  return (
    <>
      {PINS.map(([x, y, s, c, d]) => (
        <svg
          key={`${x}-${y}`}
          className="sqff-at sqff-pin"
          width={Math.floor(22 * s)}
          height={Math.floor(30 * s)}
          viewBox="-11 -16 22 30"
          style={{ left: x, top: y, animationDelay: `${d}s` }}
          aria-hidden="true"
        >
          <ellipse cx="0" cy="13" rx="5" ry="1.6" fill="rgba(0,0,0,0.35)" />
          <path d="M0,-15 C-7,-15 -10,-9 -10,-5 C-10,3 0,12 0,12 C0,12 10,3 10,-5 C10,-9 7,-15 0,-15 Z" fill={c} stroke="#1b1d22" strokeWidth="1.6" />
          <circle cx="0" cy="-5" r="3.6" fill="#fff" />
        </svg>
      ))}
    </>
  );
}

function StormBack() {
  return (
    <>
      <svg className="sqff-at" width="366" height="300" viewBox="0 0 366 300" style={{ left: 0, top: 0, overflow: "visible" }} aria-hidden="true">
        <ellipse cx="40" cy="10" rx="80" ry="26" fill="rgba(20,8,10,0.6)" />
        <ellipse cx="160" cy="0" rx="100" ry="24" fill="rgba(20,8,10,0.55)" />
        <ellipse cx="300" cy="8" rx="110" ry="28" fill="rgba(20,8,10,0.6)" />
        {CRYSTALS.map(([x, y, s]) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
            <path d="M0 0 L-8 -22 L0 -38 L8 -22 Z" fill="#1b1d22" stroke="#ff8a3a" strokeWidth="1.6" />
            <path d="M0 -36 L0 -4" stroke="#ff8a3a" strokeWidth="1.2" opacity=".8" />
            <path d="M-6 0 L-16 -14 L-11 -24 L-4 -12 Z" fill="#23262d" stroke="#ff8a3a" strokeWidth="1.3" />
          </g>
        ))}
      </svg>
      <div className="sqff-at sqff-shimmer" />
    </>
  );
}

function StormTape() {
  return (
    <svg className="sqff-at" width="366" height="60" viewBox="0 0 366 60" style={{ left: 0, top: 30, overflow: "visible" }} aria-hidden="true">
      <g transform="rotate(-3 183 22)">
        <rect x="-20" y="10" width="406" height="24" fill="#ffd23f" stroke="#14161b" strokeWidth="2" />
        {Array.from({ length: 14 }, (_, i) => -10 + i * 30).map((x) => (
          <path key={x} d={`M${x} 10 L${x + 12} 10 L${x - 2} 34 L${x - 14} 34 Z`} fill="#14161b" />
        ))}
        <rect x="70" y="13" width="226" height="18" rx="3" fill="#ffd23f" />
        <text x="183" y="27" textAnchor="middle" fontSize="11.5" fontWeight="900" fill="#14161b" fontFamily={SVG_FONT}>
          {T.squad.fire.stormTape}
        </text>
      </g>
    </svg>
  );
}

function Ship() {
  return (
    <>
      <div className="sqff-at sqff-ship">
        <svg width="170" height="48" viewBox="0 0 250 70" style={{ position: "absolute", left: -14, top: 118 }} aria-hidden="true">
          <path d="M6 50 L22 30 L226 30 L244 50 Z" fill="#3a2a30" stroke="#120c0e" strokeWidth="2" />
          <rect x="70" y="10" width="48" height="22" fill="#45323a" stroke="#120c0e" strokeWidth="2" />
          <rect x="88" y="0" width="14" height="12" fill="#45323a" stroke="#120c0e" strokeWidth="2" />
          {Array.from({ length: 12 }, (_, i) => 34 + i * 16).map((x) => (
            <rect key={x} x={x} y="38" width="7" height="4" fill="#ffcf6b" />
          ))}
          {[76, 88, 100, 110].map((x) => (
            <rect key={x} x={x} y="16" width="6" height="4" fill="#ffcf6b" />
          ))}
          <rect x="14" y="50" width="222" height="14" rx="7" fill="#2c2f36" stroke="#0d0e10" strokeWidth="2" />
          {Array.from({ length: 11 }, (_, i) => 26 + i * 20).map((x) => (
            <circle key={x} cx={x} cy="57" r="4.2" fill="#14161b" stroke="#50555e" strokeWidth="1.2" />
          ))}
        </svg>
      </div>
      <span className="sqff-at sqff-bubble">{T.squad.fire.shipSay}</span>
      <span className="sqff-at sqff-bubble-tail" />
    </>
  );
}

function Embers({ stage, color }: { stage: number; color: string }) {
  return (
    <>
      {Array.from({ length: EMBERS[stage] }, (_, k) => {
        const s = 3 + (k % 3);
        return (
          <span
            key={k}
            className="sqff-ember"
            style={{
              left: 183 + ((k * 37) % 90) - 45,
              bottom: 200 + ((k * 23) % 50),
              width: s,
              height: s,
              background: color,
              animationDelay: `${((k * 0.37) % 2.2).toFixed(2)}s`,
              animationDuration: `${(1.8 + (k % 4) * 0.35).toFixed(2)}s`,
            }}
          />
        );
      })}
    </>
  );
}

/** The stage name (top left), the level with its stars (top right), what floats up as a stick goes on, a line at the foot */
export default function FireScene({
  level,
  seats,
  pop,
  foot,
  children,
}: {
  level: number;
  /** The room's roaches round it, the first four */
  seats: FireLook[];
  /** What floats up a moment (+1 根, Lv.48！), keyed to start again */
  pop?: { key: number; text: string } | null;
  /** The line at its foot (who put the last on, when it goes down) */
  foot?: string | null;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / SCENE_W || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const i = fireStage(level);
  const key = FIRE_STAGES[i].key;
  const { color, stars } = fireColor(level);
  const colors = COLORS[color];
  const glow = fireGlow(level);
  const sky = SKIES[key];
  const hop = i >= 4;
  return (
    <div className="sqff-box" ref={box} style={{ height: SCENE_H * k }}>
      <div className="sqff" style={{ transform: `scale(${k})`, background: `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} 55%, ${sky[2]} 100%)` }}>
        {STARRY.has(key) && STARS.map(([x, y]) => <span key={`${x}-${y}`} className="sqff-star" style={{ left: x, top: y }} />)}
        {key === "storm" && <StormBack />}
        {key === "ship" && <Ship />}
        {key === "map" && <MapPlane />}
        <div
          className="sqff-glow"
          style={{
            top: Math.round(232 - glow.size / 2),
            width: glow.size,
            height: glow.size,
            marginLeft: -Math.round(glow.size / 2),
            background: `radial-gradient(circle, rgba(${GLOWS[color]},${glow.a.toFixed(3)}) 0%, rgba(${GLOWS[color]},0) 62%)`,
          }}
        />
        {key === "map" && (
          <>
            {WALKERS.map((w, n) => {
              const r = seats[n % Math.max(1, seats.length)];
              return r ? (
                <span
                  key={n}
                  className={`sqff-roach sqff-walker${w.flip ? " flip" : ""}`}
                  style={{ left: w.x, top: w.y, width: w.s, height: w.s, ["--dx" as string]: `${w.dx}px`, animationDuration: `${w.t}s` }}
                >
                  <RoachIcon color={r.color as RoachColor} avatar={r.avatar as RoachAvatar} size={w.s} />
                </span>
              ) : null;
            })}
            <Pins />
          </>
        )}
        {i >= 2 && <Stones />}
        {level > 0 && <Flame level={level} stage={i} colors={colors} />}
        <Logs />
        {key === "out" && (
          <>
            {[
              [176, 0],
              [186, 0.9],
              [180, 1.7],
            ].map(([x, d]) => (
              <span key={x} className="sqff-at sqff-smoke" style={{ left: x, animationDelay: `${d}s` }} />
            ))}
            <span className="sqff-at sqff-out">{T.squad.fire.out}</span>
          </>
        )}
        {key === "slug" && <Skewer />}
        {key === "pot" && <Hotpot />}
        {key === "guard" && <GuardSign />}
        {key === "storm" && <StormTape />}
        {seats.slice(0, SEATS.length).map((r, n) => (
          <Roach key={r.key} r={r} {...SEATS[n]} hop={hop} />
        ))}
        {level > 0 && <Embers stage={i} color={colors[1]} />}
        {key === "map" && <span className="sqff-at sqff-sun">{T.squad.fire.sunIsland}</span>}
        <span className="sqff-at sqff-tag">{T.squad.fire.stages[key]}</span>
        <span className="sqff-at sqff-lv">
          {fmt(T.squad.fire.level, { n: level })}
          {T.squad.fire.star.repeat(stars)}
        </span>
        {pop && (
          <span key={pop.key} className="sqff-at sqff-pop">
            {pop.text}
          </span>
        )}
        {foot && <span className="sqff-at sqff-foot">{foot}</span>}
        {children}
      </div>
    </div>
  );
}
