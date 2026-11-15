"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { BADGES, quoteOf } from "@/lib/badges";
import { GLOW, LINE } from "@/lib/roachSvg";
import type { RoachColor } from "@/lib/types";
import "./sponsorFx.css";

/**
 * 支持舟P地图's card made livelier (SponsorSheet.tsx): above it the player's roach jumps and throws three hearts into
 * a smiling server, the thanks show as their two badges, and hearts come out of 去爱发电赞助 when it is tapped. Each
 * plays once, never over and over; for those who asked their device for less motion it is a still picture
 * (sponsorFx.css), and while the site is gray (calm) there is no roach and nothing moves.
 */

/** Once el is half in view, for what plays only when it can be seen (the card is longer than a phone's screen) */
function useSeen<E extends Element>(enabled: boolean) {
  const ref = useRef<E>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || seen || !el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) setSeen(true);
      },
      { threshold: [0.5, 1] },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [enabled, seen]);
  return [ref, enabled && seen] as const;
}

function Heart() {
  return (
    <svg viewBox="0 0 24 22" aria-hidden="true">
      <path
        d="M12 20.5C6.2 16.3 1.8 12.6 2.3 7.9 2.8 3.2 9.2 1.9 12 6.6 14.8 1.9 21.2 3.2 21.7 7.9 22.2 12.6 17.8 16.3 12 20.5Z"
        fill="#ff6b8a"
        stroke="#1b1d22"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M6.4 8.6a2.6 2.6 0 0 1 2.2-2.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function Star() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 1.5Q11.6 8.4 18.5 10Q11.6 11.6 10 18.5Q8.4 11.6 1.5 10Q8.4 8.4 10 1.5Z"
        fill="#ffd23f"
        stroke="#1b1d22"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The hood roach, happy (^^ under its visor), its sleeves each in a group to raise; glow: the lights of the player's colour */
function Roach({ glow }: { glow: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke={LINE} strokeWidth="1.8" strokeLinecap="round">
        <path d="M27 14 C24 7 17 3 8 4" />
        <path d="M36 13 C38 6 43 2 51 2" />
      </g>
      <g className="sf-arm-l">
        <rect x="9" y="33" width="15" height="25" rx="5" fill="#33363d" stroke={LINE} strokeWidth="2" />
      </g>
      <g className="sf-arm-r">
        <rect x="40" y="33" width="15" height="25" rx="5" fill="#33363d" stroke={LINE} strokeWidth="2" />
      </g>
      <path d="M22 40 L42 40 L43.5 57.5 L20.5 57.5 Z" fill="#fff" stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M23.5 42.5 L40.5 50 M40.5 42.5 L23.5 50" stroke={LINE} strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M10 40 C10 22 20 12 32 12 C44 12 54 22 54 40 C54 43 51 44 48 42 L16 42 C13 44 10 43 10 40 Z"
        fill="#1d1f24"
        stroke={LINE}
        strokeWidth="2"
      />
      <path d="M14.5 37 C14.5 25 22 17.5 32 17.5 C42 17.5 49.5 25 49.5 37" fill="none" stroke="#3a3e46" strokeWidth="1.6" />
      <rect x="17" y="21" width="30" height="15" rx="6" fill="#08080a" />
      <rect x="20.5" y="22.6" width="23" height="2.4" rx="1.2" fill="#50555e" />
      <g fill="none" stroke="#ffd23f" strokeWidth="2" strokeLinecap="round">
        <path d="M22.6 31 Q25.4 26.6 28.2 31" />
        <path d="M35.8 31 Q38.6 26.6 41.4 31" />
      </g>
      <ellipse cx="22.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85" />
      <ellipse cx="41.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85" />
      <rect x="11" y="35" width="6" height="4" rx="2" fill={glow} />
      <rect x="47" y="35" width="6" height="4" rx="2" fill={glow} />
    </svg>
  );
}

/** The server of the thanks badges' pictures, smiling (sf-calm), or overjoyed (sf-joy) as the hearts reach it */
function Server() {
  const slot = (y: number) => (
    <>
      <rect x="6" y={y} width="36" height="8" rx="2" fill="#c9d3e0" stroke={LINE} strokeWidth="1.5" />
      <circle cx="11" cy={y + 4} r="1.7" fill="#5bd16b" stroke={LINE} strokeWidth="0.9" />
      <path
        d={`M20 ${y + 2.6} V${y + 5.4} M24 ${y + 2.6} V${y + 5.4} M28 ${y + 2.6} V${y + 5.4} M32 ${y + 2.6} V${y + 5.4} M36 ${y + 2.6} V${y + 5.4}`}
        stroke="#8f9bb0"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </>
  );
  return (
    <svg viewBox="0 0 48 61" aria-hidden="true">
      <rect x="7" y="54" width="9" height="6" rx="2" fill="#33363d" stroke={LINE} strokeWidth="1.8" />
      <rect x="32" y="54" width="9" height="6" rx="2" fill="#33363d" stroke={LINE} strokeWidth="1.8" />
      <rect x="1" y="1" width="46" height="55" rx="7" fill="#e9eef5" stroke={LINE} strokeWidth="2.4" />
      <path d="M6 4.6 H42" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <rect x="6" y="7" width="36" height="22" rx="5" fill="#20242c" stroke={LINE} strokeWidth="1.8" />
      <rect x="9" y="9.2" width="30" height="2.2" rx="1.1" fill="#4a505b" />
      <g className="sf-calm" fill="none" stroke="#7ff0e4" strokeWidth="2" strokeLinecap="round">
        <path d="M12.6 17 Q15.4 20.6 18.2 17" />
        <path d="M29.8 17 Q32.6 20.6 35.4 17" />
        <path d="M20.6 22.6 Q24 25.6 27.4 22.6" strokeWidth="1.6" />
      </g>
      <g className="sf-joy">
        <g fill="none" stroke="#7ff0e4" strokeWidth="2" strokeLinecap="round">
          <path d="M11.4 16 Q14.2 12 17 16" />
          <path d="M31 16 Q33.8 12 36.6 16" />
        </g>
        <path d="M18.4 18.6 H29.6 Q29.6 27 24 27 Q18.4 27 18.4 18.6 Z" fill="#ff8fa3" stroke="#7ff0e4" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M20.8 24.6 Q24 22.6 27.2 24.6 Q26.6 26.2 24 26.2 Q21.4 26.2 20.8 24.6 Z" fill="#e0566f" />
      </g>
      <ellipse cx="11.4" cy="21.6" rx="2" ry="1" fill="#ff8fa3" opacity="0.9" />
      <ellipse cx="36.6" cy="21.6" rx="2" ry="1" fill="#ff8fa3" opacity="0.9" />
      {slot(33)}
      {slot(43)}
    </svg>
  );
}

/**
 * Above the card: the player's roach (in the lights of their colour) beside a server; it jumps with its arms up and
 * throws three hearts that fly into the server, which beams. full: a month paid for, the server beaming all along
 * and stars coming up round it. Tapping the roach plays it again.
 */
export function SponsorStage({ color, full }: { color: RoachColor; full: boolean }) {
  const [hop, setHop] = useState(0);
  return (
    <div className={`sf-stage${full ? " full" : ""}`}>
      {/* drawn again to play again */}
      <div key={hop} className={`sf-play${hop ? "" : " first"}`} aria-hidden="true">
        <span className="sf-floor" />
        <span className="sf-shadow r" />
        <span className="sf-shadow s" />
        <span className="sf-server">
          <Server />
        </span>
        <span className="sf-roach">
          <Roach glow={GLOW[color] ?? GLOW.cyan} />
        </span>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`sf-fly f${i}`}>
            <span className="sf-ht">
              <Heart />
            </span>
          </span>
        ))}
        {[1, 2, 3].map((i) => (
          <span key={i} className={`sf-star s${i}`}>
            <Star />
          </span>
        ))}
      </div>
      <button type="button" className="sf-hop" aria-label={T.sponsor.hop} onClick={() => setHop((n) => n + 1)} />
    </div>
  );
}

/**
 * The thanks as their badges, as the badge wall shows them, a little tilted: each turns over when tapped, to the
 * line it has there. They bob and catch the light once, when first seen.
 */
export function GiftBadges({ calm }: { calm: boolean }) {
  const [box, seen] = useSeen<HTMLDivElement>(!calm);
  const [turned, setTurned] = useState<string[]>([]);
  return (
    <div ref={box} className={`sf-badges${seen ? " seen" : ""}`}>
      {BADGES.filter((b) => b.sponsor).map((b) => {
        const back = turned.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            className={`sf-badge${back ? " turned" : ""}`}
            style={{ "--bgc": b.pill.background, "--fgc": b.pill.color, "--bd": b.pill.border } as CSSProperties}
            aria-label={back ? fmt(T.sponsor.badgeBack, { name: b.name, quote: quoteOf(b) }) : fmt(T.sponsor.badgeTurn, { name: b.name })}
            onClick={() => setTurned((t) => (back ? t.filter((id) => id !== b.id) : [...t, b.id]))}
          >
            <span className="sf-in" aria-hidden="true">
              <span className="sf-face sf-front">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/badges/${b.id}.svg`} alt="" width={112} height={112} />
              </span>
              <span className="sf-face sf-back">
                <b>{b.name}</b>
                <span>{quoteOf(b)}</span>
              </span>
            </span>
            <span className="sf-turn" aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path d="M12.6 8.4a4.6 4.6 0 1 1-1.4-3.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M12 2.2v3.2H8.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Where each heart flies out of 去爱发电赞助: fanned up and out, a little apart in time */
const BURST = [58, 66, 50, 70, 54, 64, 48].map((r, i) => {
  const a = ((-160 + (140 / 6) * i) * Math.PI) / 180;
  return { x: Math.round(Math.cos(a) * r * 1.6), y: Math.round(Math.sin(a) * r), turn: [-20, 15, -8, 25, -15, 10, -25][i], delay: i * 30 };
});

/**
 * 去爱发电赞助, with a small heart before it that beats once when first seen; tapped, hearts come out of it as the
 * page opens (as ever, in a new tab).
 */
export function AfdianLink({ href, calm }: { href: string; calm: boolean }) {
  const [box, seen] = useSeen<HTMLAnchorElement>(!calm);
  const [burst, setBurst] = useState(0);
  return (
    <a
      ref={box}
      className={`sponsor-button sf-afdian${seen ? " seen" : ""}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => {
        if (!calm) setBurst((n) => n + 1);
      }}
    >
      <span className="sf-beat" aria-hidden="true">
        <Heart />
      </span>
      {T.sponsor.afdian}
      {burst > 0 && (
        <span key={burst} className="sf-burst" aria-hidden="true">
          {BURST.map((h, i) => (
            <span key={i} style={{ "--bx": `${h.x}px`, "--by": `${h.y}px`, "--br": `${h.turn}deg`, animationDelay: `${h.delay}ms` } as CSSProperties}>
              <Heart />
            </span>
          ))}
        </span>
      )}
    </a>
  );
}
