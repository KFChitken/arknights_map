"use client";

import { memo } from "react";
import { T } from "@/i18n";
import type { FishShadow } from "@/lib/fish/rules";
import { POND, poseAt, type FishPhase } from "./pose";

/**
 * 卫戍池塘 (the design's Main canvas, 366 × 470): a pond behind a defence wall; past the wall the fight's glow, smoke and
 * searchlights while a round plays (none while the room waits); on the wall a flag for each core alliance someone in
 * the room picked; the pond's campfire (drawn; 添柴 comes with ⑤); round it the room's roaches, the player at the
 * bottom left with the rod, the others at three seats with their names, 爆护, what they said last and a float when they
 * have a line in (人机 sit and watch); a 鱼群 lights the water.
 */

export type PondSeat = { key: number; pic: string | null; name: string; fishing: boolean; protect: boolean; admiral: boolean; said: string | null };
export type PondFlag = { text: string; bg: string; fg: string };

/** The three seats round the pond besides the player's, their rods and floats, where names and words go */
const SEATS = [
  { x: 66, y: 186, size: 46, flip: false, rod: "M106 214 Q134 196 164 192", line: "M164 192 Q168 220 168 246", bob: [168, 250], name: [82, 236], said: [70, 166] },
  { x: 282, y: 182, size: 46, flip: true, rod: "M288 212 Q262 196 234 192", line: "M234 192 Q230 220 230 244", bob: [230, 248], name: [306, 232], said: [296, 162] },
  { x: 304, y: 364, size: 56, flip: true, rod: "M310 398 Q292 362 268 334", line: "M268 334 Q271 344 270 350", bob: [270, 354], name: [330, 428], said: [326, 346] },
] as const;
/** The wall's four flagpoles */
const POLES = [44, 132, 220, 290];

const Backdrop = memo(function Backdrop({ fire, school }: { fire: boolean; school: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a0f1f" />
          <stop offset="0.62" stopColor="#1b2238" />
          <stop offset="1" stopColor="#43303a" />
        </linearGradient>
        <radialGradient id="ps-fire" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff8a3a" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ff8a3a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ps-beam" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff3d0" stopOpacity="0.34" />
          <stop offset="1" stopColor="#fff3d0" stopOpacity="0" />
        </linearGradient>
        <pattern id="ps-haz" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect x="0" y="0" width="7" height="14" fill="#f2c230" />
          <rect x="7" y="0" width="7" height="14" fill="#1b1d22" />
        </pattern>
        <linearGradient id="ps-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5260" />
          <stop offset="1" stopColor="#353b47" />
        </linearGradient>
        <linearGradient id="ps-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3139" />
          <stop offset="1" stopColor="#20242a" />
        </linearGradient>
        <radialGradient id="ps-water" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#3f8fb0" />
          <stop offset="0.55" stopColor="#23607f" />
          <stop offset="1" stopColor="#143850" />
        </radialGradient>
        <radialGradient id="ps-cry" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff9a4a" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ff9a4a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ps-camp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffb05a" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ffb05a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="366" height="150" fill="url(#ps-sky)" />
      <circle className="fs-twinkle" cx="28" cy="30" r="1.1" fill="#fff" />
      <circle className="fs-twinkle" cx="150" cy="18" r="1" fill="#fff" style={{ animationDelay: "0.7s" }} />
      <circle className="fs-twinkle" cx="236" cy="44" r="1.2" fill="#fff" style={{ animationDelay: "1.3s" }} />
      <circle className="fs-twinkle" cx="300" cy="22" r="1" fill="#fff" style={{ animationDelay: "0.3s" }} />
      {fire && (
        <g>
          <ellipse className="ps-glow" cx="246" cy="146" rx="160" ry="62" fill="url(#ps-fire)" />
          <ellipse className="ps-glow" cx="60" cy="150" rx="96" ry="40" fill="url(#ps-fire)" style={{ animationDelay: "1.1s" }} />
          <circle className="ps-flash" cx="208" cy="100" r="3.5" fill="#ffd08a" />
          <circle className="ps-flash" cx="292" cy="88" r="2.6" fill="#ffd08a" style={{ animationDelay: "1.2s" }} />
          <circle className="ps-flash" cx="116" cy="108" r="3" fill="#ffd08a" style={{ animationDelay: "2.1s" }} />
          <ellipse className="ps-rise" cx="150" cy="112" rx="12" ry="8" fill="#5d5262" />
          <ellipse className="ps-rise" cx="270" cy="106" rx="10" ry="7" fill="#5d5262" style={{ animationDelay: "1.6s" }} />
          <polygon className="ps-sweep" points="91,122 101,122 128,-20 64,-20" fill="url(#ps-beam)" />
          <polygon className="ps-sweep" points="334,80 344,80 370,-30 308,-30" fill="url(#ps-beam)" style={{ animationDelay: "-3s" }} />
        </g>
      )}
      <rect x="330" y="84" width="18" height="40" fill="#2b303a" />
      <rect x="324" y="70" width="30" height="16" fill="#353b47" />
      <polygon points="320,70 339,60 358,70" fill="#2b303a" />
      <circle cx="339" cy="80" r="3" fill="#fff3cf" />
      <rect x="0" y="124" width="366" height="54" fill="url(#ps-wall)" />
      <rect x="0" y="120" width="366" height="7" fill="url(#ps-haz)" />
      <path d="M52 127 V178 M104 127 V178 M156 127 V178 M208 127 V178 M260 127 V178 M312 127 V178 M0 154 H366" stroke="#2f343e" strokeWidth="1.5" />
      <rect x="88" y="114" width="16" height="8" rx="2" fill="#2b303a" />
      <circle cx="96" cy="118" r="2.5" fill="#fff3cf" />
      <rect x="0" y="178" width="366" height="292" fill="url(#ps-ground)" />
      <rect x="0" y="178" width="366" height="5" fill="#15181d" opacity="0.6" />
      <path d="M8 262 l14 6 l8 -4 M330 404 l10 -6 l12 4 M120 446 l12 -4 l10 6 M250 196 l12 4 l6 -3" stroke="#3a3f48" strokeWidth="1" fill="none" />
      <g fill="#3f5b3e">
        {[
          [130, 206], [250, 214], [352, 312], [6, 318], [144, 420], [262, 432],
        ].map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y} l3 -8 l2 8 l3 -6 l2 6 z`} />
        ))}
      </g>
      <ellipse className="ps-glow" cx="24" cy="204" rx="28" ry="20" fill="url(#ps-cry)" />
      <g fill="#1d1b24" stroke="#ff8a3a" strokeWidth="0.8">
        <polygon points="8,216 14,186 20,216" />
        <polygon points="16,216 24,172 32,216" />
        <polygon points="27,216 35,192 41,216" />
      </g>
      <path d="M24 178 L24 210 M14 192 L14 212" stroke="#ffb070" strokeWidth="1" opacity="0.8" />
      <ellipse className="ps-glow" cx="346" cy="210" rx="28" ry="20" fill="url(#ps-cry)" style={{ animationDelay: "1.3s" }} />
      <g fill="#1d1b24" stroke="#ff8a3a" strokeWidth="0.8">
        <polygon points="330,222 336,198 342,222" />
        <polygon points="338,222 346,182 354,222" />
        <polygon points="350,222 357,202 363,222" />
      </g>
      <path d="M346 188 L346 216" stroke="#ffb070" strokeWidth="1" opacity="0.8" />
      <ellipse cx="196" cy="298" rx="157" ry="81" fill="#4d525c" />
      <ellipse cx="196" cy="297" rx="151" ry="77" fill="#18303f" />
      <ellipse cx="196" cy="297" rx="148" ry="74" fill="url(#ps-water)" />
      <ellipse cx="158" cy="270" rx="64" ry="12" fill="#d8efff" opacity="0.12" />
      <ellipse cx="252" cy="240" rx="70" ry="7" fill="#ff9a5a" opacity="0.14" />
      <g className="ps-drift" stroke="#d8efff" strokeWidth="1" fill="none" opacity="0.3">
        <path d="M118 290 q 14 -3 28 0" />
        <path d="M200 324 q 16 -3 32 0" />
        <path d="M262 270 q 14 -3 28 0" />
        <path d="M150 342 q 12 -2 24 0" />
      </g>
      {school && (
        <g>
          <g fill="#0a1a26" opacity="0.5">
            <ellipse className="ps-school" cx="200" cy="314" rx="12" ry="4" />
            <ellipse className="ps-school" cx="252" cy="332" rx="10" ry="3.5" style={{ animationDelay: "-1.2s" }} />
            <ellipse className="ps-school" cx="178" cy="288" rx="11" ry="3.5" style={{ animationDelay: "-2.1s" }} />
            <ellipse className="ps-school" cx="296" cy="304" rx="9" ry="3" style={{ animationDelay: "-0.6s" }} />
          </g>
          <g fill="#fff6c8">
            {[
              [190, 286, 1.7, 0], [216, 320, 1.5, 0.4], [264, 292, 1.7, 0.9], [176, 334, 1.4, 1.3], [240, 342, 1.6, 0.6], [300, 318, 1.4, 1.6],
            ].map(([x, y, r, d]) => (
              <circle key={`${x}-${y}`} className="fs-twinkle" cx={x} cy={y} r={r} style={{ animationDelay: `${d}s` }} />
            ))}
          </g>
        </g>
      )}
      <ellipse className="ps-glow" cx="196" cy="434" rx="64" ry="28" fill="url(#ps-camp)" />
      <ellipse cx="196" cy="440" rx="22" ry="6" fill="#3a3e46" />
      <rect x="178" y="432" width="36" height="6" rx="3" fill="#6b4426" transform="rotate(-14 196 435)" />
      <rect x="178" y="432" width="36" height="6" rx="3" fill="#7d5130" transform="rotate(14 196 435)" />
      <path className="ps-flick" d="M196 402 C 207 414, 213 423, 207 436 L 185 436 C 179 423, 185 414, 196 402 Z" fill="#ff8a2a" />
      <path className="ps-flick" d="M196 416 C 202 423, 204 429, 201 436 L 191 436 C 188 429, 190 423, 196 416 Z" fill="#ffd36a" style={{ animationDelay: "-0.2s" }} />
      <circle className="ps-ember" cx="190" cy="404" r="1.5" fill="#ffcf6b" />
      <circle className="ps-ember" cx="203" cy="398" r="1.2" fill="#ffcf6b" style={{ animationDelay: "0.7s" }} />
      <g fill="#8b7b5b" stroke="#6a5d43" strokeWidth="1">
        <rect x="-4" y="448" width="34" height="15" rx="7" />
        <rect x="26" y="450" width="34" height="15" rx="7" />
        <rect x="10" y="437" width="34" height="15" rx="7" />
        <rect x="320" y="450" width="34" height="15" rx="7" />
        <rect x="348" y="448" width="30" height="15" rx="7" />
        <rect x="334" y="437" width="32" height="15" rx="7" />
      </g>
    </>
  );
});

/** A float on the water, bobbing */
function Float({ x, y, delay = 0, big = false }: { x: number; y: number; delay?: number; big?: boolean }) {
  const s = big ? 1.15 : 1;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className="fs-bob" style={{ animationDelay: `${delay}s` }}>
        <path d="M0 -9 L0 -4" stroke="#1b1d22" strokeWidth="1" />
        <path d="M-3.5 0 A3.5 4.6 0 0 1 3.5 0 Z" fill="#ff4a2e" />
        <path d="M-3.5 0 A3.5 4.6 0 0 0 3.5 0 Z" fill="#ffffff" />
      </g>
    </g>
  );
}

/** A tag in the scene: a dark pill with white words, or 爆护's */
function Tag({ x, y, text, kind = "name" }: { x: number; y: number; text: string; kind?: "name" | "protect" | "said" }) {
  const w = text.length * (kind === "said" ? 11 : 10) + 10;
  // kept inside the scene's edges
  const at = Math.min(Math.max(x, w / 2 + 4), 366 - w / 2 - 4);
  return (
    <g transform={`translate(${at} ${y})`}>
      <rect x={-w / 2} y="-9" width={w} height="16" rx={kind === "said" ? 8 : 5} className={`ps-tag ${kind}`} />
      <text x="0" y="3" textAnchor="middle" className={`ps-tag-t ${kind}`}>
        {text}
      </text>
    </g>
  );
}

export default function PondScene({
  phase,
  ms,
  shadow,
  ringDelay,
  catchPic,
  roach,
  label,
  zhi,
  seats,
  flags,
  fire,
  school,
}: {
  phase: FishPhase;
  ms: number;
  shadow: FishShadow | null;
  ringDelay: number;
  catchPic: string | null;
  roach: string | null;
  label: string;
  zhi: boolean;
  /** Up to three others, in seat order */
  seats: PondSeat[];
  /** Up to four flags on the wall, the core alliances picked in the room */
  flags: PondFlag[];
  /** The fight's glow past the wall: a round plays */
  fire: boolean;
  /** A 鱼群 is on */
  school: boolean;
}) {
  const p = poseAt(phase, ms, POND);
  const B = POND.B;
  return (
    <svg className="fish-scene pond" viewBox="0 0 366 470" aria-hidden="true">
      <Backdrop fire={fire} school={school} />
      {flags.slice(0, 4).map((f, i) => (
        <g key={i}>
          <rect x={POLES[i] - 17} y="126" width="34" height="3" fill="#8a8f99" />
          <polygon points={`${POLES[i] - 14},128 ${POLES[i] + 14},128 ${POLES[i] + 14},168 ${POLES[i]},160 ${POLES[i] - 14},168`} fill={f.bg} />
          <text x={POLES[i]} y="152" textAnchor="middle" fontSize="15" fontWeight="900" fill={f.fg}>
            {f.text}
          </text>
        </g>
      ))}
      {seats.slice(0, 3).map((s, i) => {
        const at = SEATS[i];
        return (
          <g key={s.key}>
            {s.fishing && (
              <>
                <path d={at.rod} stroke="#2a1a10" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                <path d={at.line} stroke="#eef2f8" strokeWidth="0.8" fill="none" opacity="0.8" strokeLinecap="round" />
                <Float x={at.bob[0]} y={at.bob[1]} delay={-0.5 * i} big={i === 2} />
              </>
            )}
            {s.pic && (
              <image
                href={s.pic}
                x={at.x}
                y={at.y}
                width={at.size}
                height={at.size}
                transform={at.flip ? `translate(${2 * at.x + at.size} 0) scale(-1 1)` : undefined}
              />
            )}
            <Tag x={at.name[0]} y={at.name[1]} text={s.admiral ? `${s.name} · ${T.fish.admiral}` : s.name} />
            {s.protect && <Tag x={at.name[0]} y={at.name[1] + 17} text={T.fish.pond.protect} kind="protect" />}
            {s.said && <Tag x={at.said[0]} y={at.said[1]} text={s.said} kind="said" />}
          </g>
        );
      })}
      {p.line && <path d={p.line} stroke="#eef2f8" strokeWidth="0.9" fill="none" opacity="0.85" />}
      <path d={p.rod} stroke="#2a1a10" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d={p.grip} stroke="#6b3d1e" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx={p.reel[0]} cy={p.reel[1]} r="3.6" fill="#9aa0aa" stroke="#3a3f47" strokeWidth="1" />
      {roach && <image href={roach} x="12" y="350" width="62" height="62" />}
      <Tag x={44} y={420} text={label} />
      {zhi && (
        <g transform="translate(40 334)">
          <g className="fs-pop">
            <rect x="-20" y="-14" width="40" height="22" rx="10" fill="#fff" />
            <text x="0" y="2" textAnchor="middle" className="fs-bubble-t">
              {T.fish.zhiSaid}
            </text>
          </g>
        </g>
      )}
      {phase === "wait" && shadow && <ellipse className="fs-swim" cx={B[0]} cy={B[1] + 16} rx={shadow === "l" ? 38 : shadow === "m" ? 27 : 19} ry={shadow === "l" ? 10 : 7} fill="rgba(6,10,26,0.6)" />}
      {(phase === "wait" || phase === "bite") && (
        <g transform={`translate(${B[0]} ${B[1] + 2})`}>
          <ellipse className="fs-ripple" rx="20" ry="10" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6" />
        </g>
      )}
      {phase === "bite" && (
        <>
          <circle className="fs-ring" cx={B[0]} cy={B[1]} r="15.5" fill="none" stroke="#ffd23f" strokeWidth="3" style={{ animationDelay: `${ringDelay}ms` }} />
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
          <image href={catchPic} x={-24} y={-24} width={48} height={48} className={p.fish.under ? "fs-thrash fs-dark" : undefined} />
        </g>
      )}
      {phase === "caught" && catchPic && <image className="fs-float" href={catchPic} x="16" y="282" width="54" height="54" />}
    </svg>
  );
}
