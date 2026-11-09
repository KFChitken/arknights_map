"use client";

import { useEffect, useRef } from "react";
import { BEAT_S, onDrum, PARTY_MS, partyColor, phantomPose, type PhantomPose } from "@/lib/party";
import { GLOW, LINE } from "@/lib/roachSvg";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import { stopPartyMusic, type PartyMusic } from "./partyMusic";

/**
 * ⚡舟友的酒⚡ (src/lib/party.ts), drawn on the map round your drunk main roach: a disco ball
 * drops in, the map round the dance floor goes dark, coloured beams sweep over it, and four
 * phantoms of your roach (above, below, left, right) spin and bounce to the music for a
 * minute, then it all goes and the roach lies there drunk as before. This element sits on
 * the map at the roach's spot (MapViewProps.overlays) and never takes a tap. Everything is
 * moved from one clock: the music's own, or this page's while there is no music.
 */

/** Phantoms' centres round the roach, px, and which of them dance mirrored */
const SPOTS: { x: number; y: number; mirror: boolean }[] = [
  { x: 0, y: -74, mirror: false },
  { x: 74, y: 0, mirror: false },
  { x: 0, y: 74, mirror: true },
  { x: -74, y: 0, mirror: true },
];
const PHANTOM_PX = 54;
/** Waiting this long for the music, the dance starts without it */
const MUSIC_WAIT_MS = 8000;
const INTRO_MS = 700;
const OUTRO_MS = 1200;
/** Glitter on the floor: [ring radius, starting angle] */
const DOTS = Array.from({ length: 16 }, (_, i) => [[115, 175, 240][i % 3], (i * 137.5) % 360] as const);

/** The two beams: how wide each is at the floor, and how far off straight down it leans, px */
const BEAMS = [
  [124, 0],
  [78, 12],
] as const;

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
/** Overshooting ease for things popping in */
const pop = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
};

export default function PartyScene({
  avatar,
  color,
  music,
  onDone,
}: {
  avatar: RoachAvatar;
  color: RoachColor;
  /** The music, once it plays (null: none) */
  music: Promise<PartyMusic | null>;
  onDone: () => void;
}) {
  const hood = avatar === "hood";
  const glow = GLOW[color];
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
    const qa = <T extends Element>(s: string) => [...el.querySelectorAll<T>(s)];
    const dark = q<HTMLDivElement>(".party-dark");
    const ball = q<HTMLDivElement>(".party-ball");
    const facets = q<SVGRectElement>(".party-facets-shift");
    const shines = qa<SVGRectElement>(".party-shine");
    const beams = qa<SVGGElement>(".party-beam");
    const beamStops = qa<SVGStopElement>(".party-beam-stop");
    const pool = q<SVGEllipseElement>(".party-pool");
    const poolStops = qa<SVGStopElement>(".party-pool-stop");
    const dots = qa<SVGCircleElement>(".party-dot");
    const phantoms = qa<HTMLDivElement>(".party-ph");
    const grounds = qa<SVGEllipseElement>(".party-ground");
    const turns = qa<HTMLDivElement>(".party-turn");
    const art = hood ? hoodParts(el) : null;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const born = performance.now();
    let clock: PartyMusic | null = null;
    let ownStart: number | null = null;
    let live = true;
    music.then((m) => {
      if (!live) return;
      // too late: the dance has gone on without it
      if (ownStart !== null) {
        if (m) stopPartyMusic();
        return;
      }
      if (m) clock = m;
      else ownStart = Math.max(performance.now(), born + INTRO_MS);
    });

    let frame = 0;
    let ending: number | null = null;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const since = now - born;
      if (!clock && ownStart === null && since > MUSIC_WAIT_MS) ownStart = now;
      // seconds into the dance; negative while it waits for the music
      const t = clock ? clock.time() : ownStart !== null ? (now - ownStart) / 1000 : -1;
      if (ending === null && t * 1000 >= PARTY_MS) ending = now;
      const out = ending === null ? 0 : Math.min(1, (now - ending) / OUTRO_MS);
      if (out >= 1) {
        cancelAnimationFrame(frame);
        done.current();
        return;
      }
      const beats = t > 0 && !still ? t / BEAT_S : 0;
      const into = ease(since / INTRO_MS);
      const shown = into * (1 - ease(out));

      // the floor goes dark round the light
      dark.style.opacity = String(shown);
      // the ball drops in, and goes up at the end
      const drop = (1 - pop(since / INTRO_MS)) * -150 - ease(out) * 220;
      ball.style.transform = `translateY(${drop.toFixed(1)}px)`;
      facets.setAttribute("x", String(-((now / 1000) * 9) % 5));
      shines.forEach((s, i) => s.setAttribute("fill", t > 0 ? partyColor(beats + i * 2) : "#fff"));

      // two beams swinging from the ball, each a colour of the beat
      const sway = still ? 0 : 11 * Math.sin((2 * Math.PI * beats) / 8);
      const colors = [partyColor(beats), partyColor(beats + 3)];
      beams.forEach((b, i) => {
        b.setAttribute("transform", `rotate(${(i ? -sway : sway).toFixed(2)} 0 -192)`);
        b.style.opacity = String(shown);
      });
      beamStops.forEach((s, i) => s.setAttribute("stop-color", colors[Math.floor(i / 2)]));
      pool.setAttribute("cx", String((sway * 2.6).toFixed(1)));
      pool.style.opacity = String(shown);
      poolStops.forEach((s) => s.setAttribute("stop-color", colors[0]));
      // glitter going round the floor, flashing on the beat
      const flash = t > 0 && !still ? 1 - (beats % 1) : 0.4;
      dots.forEach((d, i) => {
        const [r, a0] = DOTS[i];
        const a = ((a0 + (still ? 0 : (now / 1000) * 24 * (i % 2 ? 1 : -1))) * Math.PI) / 180;
        d.setAttribute("cx", (r * Math.cos(a)).toFixed(1));
        d.setAttribute("cy", (r * 0.5 * Math.sin(a) + 24).toFixed(1));
        d.setAttribute("fill", partyColor(i + Math.floor(beats)));
        d.style.opacity = String(shown * (0.35 + 0.6 * flash));
      });

      // the phantoms: popping in one by one, then dancing as one (two of them mirrored)
      const pose: PhantomPose = still || t <= 0 ? { ...phantomPose(0), sx: 1, sy: 1, dy: 0, tilt: 0, feeler: 0, glitch: false } : phantomPose(beats);
      if (art) art.set(pose);
      phantoms.forEach((p, i) => {
        const inK = pop((since - i * 70) / 450);
        const scale = Math.max(0, inK) * (1 - ease(out * 1.2));
        const mirror = SPOTS[i].mirror ? -1 : 1;
        const s = PHANTOM_PX / 64;
        p.style.transform = `translateY(${(pose.dy * s).toFixed(2)}px) rotate(${(pose.tilt * mirror).toFixed(2)}deg) scale(${(pose.sx * scale * mirror).toFixed(3)}, ${(pose.sy * scale).toFixed(3)})`;
        // see-through a little: they are phantoms
        p.style.opacity = String(0.9 * Math.min(1, Math.max(0, inK)) * (1 - ease(out)));
        p.style.filter = pose.glitch
          ? "drop-shadow(2.5px 0 0 rgba(255, 40, 130, 0.85)) drop-shadow(-2.5px 0 0 rgba(40, 220, 255, 0.85))"
          : `drop-shadow(0 0 1.5px #fff) drop-shadow(0 0 7px ${t > 0 ? colors[0] : glow})`;
      });
      grounds.forEach((g) => g.setAttribute("fill", t > 0 ? colors[0] : glow));
      // a picture cannot turn: it narrows, flips, and shows a dark back
      if (!art) {
        const c = Math.cos((pose.turn * Math.PI) / 180);
        const w = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
        turns.forEach((x) => {
          x.style.transform = `scaleX(${w.toFixed(3)})`;
          x.style.filter = c < 0 ? "brightness(0.3)" : "none";
        });
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
    };
  }, [music, hood, glow]);

  return (
    <div className="party" ref={root} aria-hidden="true">
      <div className="party-dark" />
      <svg className="party-floor" width="600" height="340" viewBox="-300 -170 600 340">
        <defs>
          <radialGradient id="party-pool-light">
            <stop className="party-pool-stop" offset="0" stopColor="#fff" stopOpacity="0.3" />
            <stop className="party-pool-stop" offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="party-pool" cx="0" cy="36" rx="150" ry="62" fill="url(#party-pool-light)" />
        {DOTS.map((_, i) => (
          <circle key={i} className="party-dot" r={i % 3 === 0 ? 4 : 3} />
        ))}
      </svg>
      <svg className="party-beams" width="480" height="420" viewBox="-240 -300 480 420">
        <defs>
          {[0, 1].map((i) => (
            <linearGradient key={i} id={`party-beam-${i}`} gradientUnits="userSpaceOnUse" x1="0" y1="-192" x2="0" y2="96">
              <stop className="party-beam-stop" offset="0" stopColor="#fff" stopOpacity="0.2" />
              <stop className="party-beam-stop" offset="1" stopColor="#fff" stopOpacity="0.015" />
            </linearGradient>
          ))}
        </defs>
        {BEAMS.map(([spread, tilt], i) => (
          <g key={i} className="party-beam">
            {[1, 0.66, 0.36].map((k) => (
              <path
                key={k}
                d={`M${(tilt - 5 * k).toFixed(1)} -190 L${(tilt + 5 * k).toFixed(1)} -190 L${(tilt * 4 + spread * k).toFixed(1)} 96 L${(tilt * 4 - spread * k).toFixed(1)} 96 Z`}
                fill={`url(#party-beam-${i})`}
              />
            ))}
          </g>
        ))}
      </svg>
      {SPOTS.map((p, i) => (
        <div key={i} className="party-ph" style={{ left: p.x - PHANTOM_PX / 2, top: p.y - PHANTOM_PX / 2, width: PHANTOM_PX, height: PHANTOM_PX }}>
          {hood ? (
            <svg width={PHANTOM_PX} height={PHANTOM_PX} viewBox="0 0 64 64">
              <ellipse className="party-ground" cx="32" cy="59.5" rx="19" ry="3.6" fill={glow} opacity="0.55" />
              <use href="#party-hood" />
            </svg>
          ) : (
            <div className="party-turn">
              <RoachIcon color={color} size={PHANTOM_PX} avatar={avatar} />
            </div>
          )}
        </div>
      ))}
      <div className="party-ball">
        <svg width="44" height="170" viewBox="-22 -148 44 170">
          <line x1="0" y1="-148" x2="0" y2="-17" stroke="#9aa1ad" strokeWidth="1.5" />
          <defs>
            <clipPath id="party-ball-clip">
              <circle r="17" />
            </clipPath>
            <pattern id="party-facets" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect className="party-facets-shift" width="4.2" height="4.2" rx="0.6" fill="#dfe4ec" />
            </pattern>
          </defs>
          <circle r="17.5" fill="#6d7482" />
          <g clipPath="url(#party-ball-clip)">
            <rect x="-18" y="-18" width="36" height="36" fill="url(#party-facets)" />
            {[
              [-9, -6],
              [3, -11],
              [6, 4],
              [-4, 8],
            ].map(([x, y], i) => (
              <rect key={i} className="party-shine" x={x} y={y} width="4.2" height="4.2" rx="0.6" fill="#fff" />
            ))}
            <ellipse cx="-6" cy="-7" rx="6" ry="4" fill="#fff" opacity="0.55" />
          </g>
          <circle r="17.5" fill="none" stroke={LINE} strokeWidth="1.6" />
        </svg>
      </div>
      {hood && <HoodPhantomArt glow={glow} />}
    </div>
  );
}

/**
 * The phantom hood once, as a symbol all four use, drawn in parts that move as it turns:
 * the face, white front and lights slide round it like marks on a drum, the sleeves swing
 * in front of or behind it, the feelers flop on the beat. Parts are found by class, below.
 */
function HoodPhantomArt({ glow }: { glow: string }) {
  const sleeve = (cls: string) => <rect className={cls} x="-7.5" y="33" width="15" height="25" rx="5" fill="#33363d" stroke={LINE} strokeWidth="2" />;
  return (
    <svg className="party-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <clipPath id="party-hood-dome">
          <path d="M10 40 C10 22 20 12 32 12 C44 12 54 22 54 40 L54 42 L10 42 Z" />
        </clipPath>
        <clipPath id="party-hood-coat">
          <path d="M21 40 L43 40 L44.5 57.5 L19.5 57.5 Z" />
        </clipPath>
        <g id="party-hood">
          <g className="ph-back-sleeves">
            {sleeve("ph-sleeve-l")}
            {sleeve("ph-sleeve-r")}
          </g>
          <path d="M21 40 L43 40 L44.5 57.5 L19.5 57.5 Z" fill="#2a2d33" stroke={LINE} strokeWidth="2" strokeLinejoin="round" />
          <g clipPath="url(#party-hood-coat)">
            <g className="ph-front">
              <path d="M22 40 L42 40 L43.5 57.5 L20.5 57.5 Z" fill="#fff" />
              <path d="M23.5 42.5 L40.5 50 M40.5 42.5 L23.5 50" stroke={LINE} strokeWidth="1.8" strokeLinecap="round" />
            </g>
          </g>
          <path d="M10 40 C10 22 20 12 32 12 C44 12 54 22 54 40 C54 43 51 44 48 42 L16 42 C13 44 10 43 10 40 Z" fill="#1d1f24" stroke={LINE} strokeWidth="2" />
          <g clipPath="url(#party-hood-dome)">
            <path className="ph-seam" d="M32 13 C29.5 21 29.5 31 32 41" fill="none" stroke="#3a3e46" strokeWidth="1.6" />
            <g className="ph-face">
              <path d="M14.5 37 C14.5 25 22 17.5 32 17.5 C42 17.5 49.5 25 49.5 37" fill="none" stroke="#3a3e46" strokeWidth="1.6" />
              <rect x="17" y="21" width="30" height="15" rx="6" fill="#08080a" />
              <rect x="19.5" y="22.8" width="25" height="3.6" rx="1.8" fill="#50555e" />
              <ellipse cx="22.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85" />
              <ellipse cx="41.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85" />
            </g>
          </g>
          <rect className="ph-light-l" x="-3" y="35" width="6" height="4" rx="2" fill={glow} />
          <rect className="ph-light-r" x="-3" y="35" width="6" height="4" rx="2" fill={glow} />
          <g className="ph-front-sleeves">
            {sleeve("ph-sleeve-l")}
            {sleeve("ph-sleeve-r")}
          </g>
          <g fill="none" stroke={LINE} strokeWidth="1.8" strokeLinecap="round">
            <path className="ph-feeler-l" d="M0 0 C-3 -7 -10 -11 -19 -10" />
            <path className="ph-feeler-r" d="M0 0 C2 -7 7 -11 15 -11" />
          </g>
        </g>
      </defs>
    </svg>
  );
}

/** The phantom hood's moving parts, and how to put them in a pose */
function hoodParts(el: HTMLElement) {
  const q = <T extends Element>(s: string) => el.querySelector<T>(s)!;
  const face = q<SVGGElement>(".ph-face");
  const front = q<SVGGElement>(".ph-front");
  const seam = q<SVGPathElement>(".ph-seam");
  const lights = [q<SVGRectElement>(".ph-light-l"), q<SVGRectElement>(".ph-light-r")];
  const back = [q<SVGRectElement>(".ph-back-sleeves .ph-sleeve-l"), q<SVGRectElement>(".ph-back-sleeves .ph-sleeve-r")];
  const fore = [q<SVGRectElement>(".ph-front-sleeves .ph-sleeve-l"), q<SVGRectElement>(".ph-front-sleeves .ph-sleeve-r")];
  const feelers = [q<SVGPathElement>(".ph-feeler-l"), q<SVGPathElement>(".ph-feeler-r")];
  const show = (e: SVGElement, on: boolean) => e.setAttribute("visibility", on ? "visible" : "hidden");
  return {
    set(pose: PhantomPose) {
      const t = pose.turn;
      // the face and white front, as marks on the front of a drum
      const f = onDrum(0, t, 15);
      const w = Math.max(0.22, f.width);
      face.setAttribute("transform", `translate(${(32 + f.x).toFixed(2)} 0) scale(${w.toFixed(3)} 1) translate(-32 0)`);
      show(face, f.facing);
      const fr = onDrum(0, t, 10);
      front.setAttribute("transform", `translate(${(32 + fr.x).toFixed(2)} 0) scale(${Math.max(0.2, fr.width).toFixed(3)} 1) translate(-32 0)`);
      show(front, fr.facing);
      // the seam down the back of the hood
      const s = onDrum(180, t, 15);
      seam.setAttribute("transform", `translate(${s.x.toFixed(2)} 0)`);
      show(seam, s.facing);
      // the lights on its sides
      [-80, 80].forEach((a, i) => {
        const l = onDrum(a, t, 18.5);
        lights[i].setAttribute("transform", `translate(${(32 + l.x).toFixed(2)} 0) scale(${(0.6 + 0.4 * Math.abs(l.width)).toFixed(3)} 1)`);
        show(lights[i], l.width > -0.2);
      });
      // the sleeves, in front of the body or behind it
      [-90, 90].forEach((a, i) => {
        const v = onDrum(a, t, 15.5);
        const at = `translate(${(32 + v.x).toFixed(2)} 0) scale(${(0.75 + 0.25 * Math.abs(v.width)).toFixed(3)} 1)`;
        back[i].setAttribute("transform", at);
        fore[i].setAttribute("transform", at);
        show(back[i], v.width <= 0.2);
        show(fore[i], v.width > 0.2);
      });
      // the feelers: their roots go round with the head, they spread less side on, and flop
      const c = Math.cos((t * Math.PI) / 180);
      const spread = Math.sign(c || 1) * Math.max(0.35, Math.abs(c));
      [
        [-25, 14, -1],
        [20, 13, 1],
      ].forEach(([a, y, dir], i) => {
        const root = onDrum(a, t, 12);
        feelers[i].setAttribute(
          "transform",
          `translate(${(32 + root.x).toFixed(2)} ${y}) scale(${spread.toFixed(3)} 1) rotate(${(dir * pose.feeler).toFixed(2)})`,
        );
      });
    },
  };
}
