"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { haimaoApi } from "@/lib/haimaoClient";
import { HAIMAO_WHEEL_TICKETS, sliceText, WHEEL_SLICES, type HaimaoSpin } from "@/lib/haimaoWheel";
import { HaimaoFigure } from "./Haimao";
import type { HaimaoRun } from "./HaimaoStory";
import { playSound, primeSound } from "./haimaoSound";
import Sheet from "./Sheet";

/**
 * 转 ALL (src/lib/haimaoWheel.ts): her wheel of seven, one spin a player, for good, as the design plays it. The server
 * decides where the pointer stops and gives everything before the wheel moves (src/lib/server/haimao.ts spinWheel);
 * this only shows it: the wheel turning 3.4 s, easing out, to that slice, clicking past each; her asking after it; her
 * hand coming in, 神之一手, the wheel pushed on to ALL; every slice turning gold, ALL！ and what it gave, one after
 * another. Where motion is turned down, straight to ALL. Spun before, it opens on ALL with what it gave.
 */

const N = WHEEL_SLICES.length;
/** One slice, in degrees */
const A = 360 / N;
const GOLD = "#f2c230";

/** A point on the wheel: a degrees clockwise from the top, r from the middle (the wheel's own 400 square) */
const pt = (a: number, r: number) => {
  const rad = (a * Math.PI) / 180;
  return `${(200 + r * Math.sin(rad)).toFixed(2)} ${(200 - r * Math.cos(rad)).toFixed(2)}`;
};
const wedge = (i: number) => `M200 200 L${pt(i * A - A / 2, 176)} A176 176 0 0 1 ${pt(i * A + A / 2, 176)} Z`;
/** The slices' own colours, before they turn gold: ALL's gold, the rest white and blue in turn */
const baseFill = (i: number) => (i === 0 ? GOLD : i % 2 ? "#ffffff" : "#dbe6f4");

const easeOut = (k: number) => 1 - Math.pow(1 - k, 4);
const easeBack = (k: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};

const reduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

type IconKind = "ticket" | "title" | "say" | "all";
const iconOf = (i: number): IconKind => {
  const s = WHEEL_SLICES[i];
  return s === "say1" || s === "say2" ? "say" : s === "all" ? "all" : s;
};

/** What the slices show and what it gave (the design's own drawings, 96 × 64) */
function IconArt({ kind }: { kind: IconKind }) {
  const words = T.guides.haimao.wheel.icon;
  if (kind === "ticket") {
    return (
      <>
        <path
          d="M10 6 H86 a4 4 0 0 1 4 4 V24 a8 8 0 0 0 0 16 V54 a4 4 0 0 1 -4 4 H10 a4 4 0 0 1 -4 -4 V40 a8 8 0 0 0 0 -16 V10 a4 4 0 0 1 4 -4 Z"
          fill="#1b5e8f"
          stroke="#0d0e10"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path d="M14 12 H82 V52 H14 Z" fill="none" stroke="#8fd0f2" strokeWidth="1.2" strokeDasharray="3 3" opacity=".8" />
        <path d="M66 10 V54" stroke="#ffffff" strokeWidth="1.6" strokeDasharray="2.5 3" />
        <path
          transform="translate(0 -3)"
          d="M37 18 l3.8 7.7 8.5 1.2 -6.1 6 1.4 8.4 -7.6 -4 -7.6 4 1.4 -8.4 -6.1 -6 8.5 -1.2 Z"
          fill={GOLD}
          stroke="#0d0e10"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <text x="37" y="49" textAnchor="middle" fontSize="11" fill="#ffffff">
          {words.ticket}
        </text>
        <path d="M72 22 H80 M72 27 H80 M72 32 H78 M72 37 H80 M72 42 H76" stroke="#8fd0f2" strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  if (kind === "title") {
    return (
      <>
        <path d="M30 40 L22 60 L31 55 L36 62 L42 44 Z" fill="#cf3668" stroke="#0d0e10" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M66 40 L74 60 L65 55 L60 62 L54 44 Z" fill="#cf3668" stroke="#0d0e10" strokeWidth="1.8" strokeLinejoin="round" />
        <rect x="8" y="12" width="80" height="32" rx="16" fill="#fff4d1" stroke="#0d0e10" strokeWidth="2.2" />
        <rect x="13" y="17" width="70" height="22" rx="11" fill="none" stroke={GOLD} strokeWidth="2" />
        <text x="48" y="33.5" textAnchor="middle" fontSize="14" fill="#8a5a00">
          {words.title}
        </text>
      </>
    );
  }
  if (kind === "say") {
    return (
      <>
        <path
          d="M14 8 H82 a8 8 0 0 1 8 8 V38 a8 8 0 0 1 -8 8 H40 L26 58 L28 46 H14 a8 8 0 0 1 -8 -8 V16 a8 8 0 0 1 8 -8 Z"
          fill="#ffffff"
          stroke="#0d0e10"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path d="M20 21 H58 M20 32 H72" stroke="#9fb1c9" strokeWidth="3.4" strokeLinecap="round" />
        <circle cx="73" cy="21" r="4.5" fill="#cf3668" />
      </>
    );
  }
  return (
    <>
      <path
        d="M48 2 L55 18 L72 9 L66 26 L86 28 L70 38 L82 52 L63 49 L60 62 L48 52 L36 62 L33 49 L14 52 L26 38 L10 28 L30 26 L24 9 L41 18 Z"
        fill={GOLD}
        stroke="#0d0e10"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <text x="48" y="40" textAnchor="middle" fontSize="17" fill="#3b2a00">
        {T.guides.haimao.wheel.slice.all}
      </text>
    </>
  );
}

/** Her hand, coming in from the left to push the wheel on (the design's) */
function Hand() {
  return (
    <svg viewBox="0 0 120 60">
      <path d="M0 13 H66 a18 18 0 0 1 0 36 H0 Z" fill="#2b2531" stroke="#0d0e10" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M10 24 C24 21 40 27 54 23 M6 37 C22 34 36 40 50 36" fill="none" stroke="#4a4153" strokeWidth="2" strokeLinecap="round" />
      <path d="M28 47 L36 47 L34.5 59 L26.5 59 Z" fill="#7b3fe0" stroke="#0d0e10" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M27 54.5 H35" stroke="#ffffff" strokeWidth="2.2" />
      <rect x="24.5" y="41" width="13" height="8" rx="1.5" fill="none" stroke="#0d0e10" strokeWidth="3.4" />
      <rect x="24.5" y="41" width="13" height="8" rx="1.5" fill="none" stroke="#dfe3ea" strokeWidth="1.6" />
      <rect x="63" y="11" width="18" height="40" rx="7" fill="#3a3340" stroke="#0d0e10" strokeWidth="2.4" />
      <path d="M67 15 V47 M71 14 V48 M75 14 V48 M79 15 V47" stroke="#1f1b25" strokeWidth="1.1" />
      <path d="M80 18 C94 12 107 18 107 31 C107 44 95 50 80 45 Z" fill="#f8dccd" stroke="#0d0e10" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M95 22 C99 24 101 28 100 32 M92 30 C96 31 98 34 97 38" fill="none" stroke="#e6a99a" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="89" cy="38" rx="4" ry="2.4" fill="#f4b3b0" opacity=".6" />
      <g stroke="#a46bff" strokeWidth="3" strokeLinecap="round">
        <path d="M111 14 L118 8" />
        <path d="M112 32 H120" />
        <path d="M111 50 L118 56" />
      </g>
    </svg>
  );
}

/**
 * ready: not spun; asking: the server deciding; turning, landed, pushed: the wheel going round; gilding: its slices
 * turning gold; done: all ALL
 */
type Phase = "ready" | "asking" | "turning" | "landed" | "pushed" | "gilding" | "done";

export default function HaimaoWheelSheet({
  spun,
  run,
  onSpun,
  onClose,
}: {
  /** The slice its pointer stopped on, when they spun it before: it opens on ALL */
  spun: number | null;
  run: HaimaoRun;
  /** The server gave it all: for the page to show at once */
  onSpun: (spin: HaimaoSpin) => void;
  onClose: () => void;
}) {
  const t = T.guides.haimao.wheel;
  const before = spun !== null;
  const [phase, setPhase] = useState<Phase>(before ? "done" : "ready");
  const [landed, setLanded] = useState<number | null>(spun);
  // how many of the six slices after ALL are gold, and how many of what it gave are shown
  const [gold, setGold] = useState(before ? N - 1 : 0);
  const [shown, setShown] = useState(before ? 4 : 0);
  const [hand, setHand] = useState<"" | "in" | "push">("");
  const [plus, setPlus] = useState<{ n: number; at: number } | null>(null);
  const rot = useRef<SVGGElement>(null);
  const prizesRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  useEffect(
    () => () => {
      timers.current.forEach((x) => window.clearTimeout(x));
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  /** The wheel from a to b degrees over ms, a click each slice the pointer passes (one in 40 ms at most) */
  const turn = (a: number, b: number, ms: number, ease: (k: number) => number, done: () => void) => {
    const t0 = performance.now();
    let slice = Math.floor((a + A / 2) / A);
    let tick = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const r = a + (b - a) * ease(k);
      rot.current?.setAttribute("transform", `rotate(${r.toFixed(2)} 200 200)`);
      const s = Math.floor((r + A / 2) / A);
      if (s !== slice && now - tick > 40) {
        tick = now;
        playSound("tick");
      }
      slice = s;
      if (k < 1) frame.current = requestAnimationFrame(step);
      else done();
    };
    frame.current = requestAnimationFrame(step);
  };

  /** Every slice gold, ALL！, then what it gave one after another (all at once, still) */
  const finish = (spin: HaimaoSpin, still: boolean) => {
    setHand("");
    setPhase("gilding");
    rot.current?.setAttribute("transform", "rotate(0 200 200)");
    const done = () => {
      playSound("all", true);
      setPhase("done");
      if (spin.plus > 0) setPlus({ n: spin.plus, at: Date.now() });
      if (still) setShown(4);
      else for (let k = 1; k <= 4; k++) at(k * 220, () => setShown(k));
      // on a short phone what it gave is under the fold: brought up as it comes
      at(60, () => prizesRef.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" }));
    };
    if (still) {
      setGold(N - 1);
      return done();
    }
    for (let i = 1; i < N; i++) {
      at((i - 1) * 140, () => {
        setGold(i);
        playSound("tick");
      });
    }
    at((N - 1) * 140 + 120, done);
  };

  const spin = async () => {
    if (phase !== "ready") return;
    primeSound();
    setPhase("asking");
    const r = await run(() => haimaoApi.spin());
    // refused, or not reached: told already, and the wheel may be tapped again (a spin kept by then answers as itself)
    if (!r) return setPhase("ready");
    onSpun(r);
    setLanded(r.landed);
    if (r.again || reduced()) return at(300, () => finish(r, true));
    setPhase("turning");
    const off = (Math.random() * 2 - 1) * (A / 2 - 7);
    const r1 = 1440 + (360 - r.landed * A) + off;
    turn(0, r1, 3400, easeOut, () => {
      setPhase("landed");
      at(450, () => setHand("in"));
      at(850, () => {
        setHand("push");
        setPhase("pushed");
        playSound("boing");
        turn(r1, 1800, 700, easeBack, () => at(350, () => finish(r, false)));
      });
    });
  };

  const done = phase === "done";
  const isGold = (i: number) => i === 0 || i <= gold;
  const say = done
    ? t.sayDone
    : phase === "landed" || phase === "pushed" || phase === "gilding"
      ? fmt(t.sayLanded, { slice: sliceText(landed ?? 1).short })
      : phase === "turning" || phase === "asking"
        ? t.saySpinning
        : t.sayBefore;
  const prizes: { icon: IconKind; name: string; note: string }[] = [
    { icon: "ticket", name: fmt(t.prizes.tickets, { n: HAIMAO_WHEEL_TICKETS }), note: t.prizes.ticketsNote },
    { icon: "title", name: t.prizes.title, note: t.prizes.titleNote },
    { icon: "say", name: t.prizes.say1, note: t.prizes.say1Note },
    { icon: "say", name: t.prizes.say2, note: t.prizes.say2Note },
  ];

  return (
    <Sheet title={t.title} className="hm-wheel" onClose={onClose}>
      <div className="hm-wh">
        <div className="hm-wh-stage">
          <svg viewBox="0 0 400 400" role="img" aria-label={t.aria}>
            <circle cx="200" cy="200" r="195" fill="#22386b" stroke="#0d0e10" strokeWidth="3" />
            <g ref={rot}>
              {WHEEL_SLICES.map((_, i) => (
                <path key={i} className="hm-wh-ws" d={wedge(i)} fill={isGold(i) ? GOLD : baseFill(i)} stroke="#0d0e10" strokeWidth="2" />
              ))}
              {WHEEL_SLICES.map((_, i) => (
                <g key={i} transform={`rotate(${(i * A).toFixed(3)} 200 200)`}>
                  <text x="200" y={i === 0 ? 84 : 58} textAnchor="middle" dominantBaseline="middle" className={i === 0 ? "hm-wh-all" : isGold(i) ? "hm-wh-l gold" : "hm-wh-l"}>
                    {isGold(i) ? t.slice.all : sliceText(i).label}
                  </text>
                  {i > 0 && (
                    <svg x="170" y="86" width="60" height="40" viewBox="0 0 96 64">
                      <IconArt kind={isGold(i) ? "all" : iconOf(i)} />
                    </svg>
                  )}
                </g>
              ))}
              {Array.from({ length: 2 * N }, (_, i) => {
                const [x, y] = pt((i * A) / 2 + A / 4, 186).split(" ");
                return <circle key={i} cx={x} cy={y} r="4" fill={i % 2 ? "#ffe9a3" : GOLD} />;
              })}
            </g>
            <circle cx="200" cy="200" r="46" fill="#0d0e10" />
            <path d="M200 42 L183 6 L217 6 Z" fill="#cf3668" stroke="#0d0e10" strokeWidth="3" strokeLinejoin="round" />
            <circle cx="200" cy="13" r="5" fill={GOLD} />
          </svg>
          <div className={hand ? `hm-wh-hand ${hand}` : "hm-wh-hand"} aria-hidden="true">
            <Hand />
          </div>
          <div className={phase === "pushed" ? "hm-wh-god on" : "hm-wh-god"} aria-hidden="true">
            {t.god}
          </div>
          <button type="button" className={done ? "hm-wh-spin done" : "hm-wh-spin"} disabled={phase !== "ready"} onClick={() => void spin()}>
            {done ? t.done : t.spin}
          </button>
        </div>
        <div className="hm-wh-side">
          <div className="hm-wh-host">
            <HaimaoFigure size={84} />
            <p className="hm-wh-say">{say}</p>
            {plus && (
              <span key={plus.at} className="hm-wh-float" aria-hidden="true">
                {fmt(T.guides.haimao.plus, { n: plus.n })}
              </span>
            )}
          </div>
          <p className="hm-wh-res" aria-live="polite">
            {done ? t.result : ""}
          </p>
          {done && (
            <div className="hm-wh-prizes" ref={prizesRef}>
              {prizes.map((p, k) => (
                <div key={k} className={k < shown ? "hm-wh-prize on" : "hm-wh-prize"}>
                  <svg viewBox="0 0 96 64" aria-hidden="true">
                    <IconArt kind={p.icon} />
                  </svg>
                  <span>
                    <b>{p.name}</b>
                    {p.note}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="hm-wh-count">{done ? t.once : t.notYet}</p>
          <p className="hm-wh-note">{t.note}</p>
        </div>
      </div>
    </Sheet>
  );
}
