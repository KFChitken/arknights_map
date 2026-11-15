"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { mulberry32 } from "@/lib/prng";
import { type Door, endOf, enter, ROGUE, ROGUE_GOAL, rogueBuilding, scoreOf, toGoal } from "@/lib/study/rogue325";
import RoachIcon from "../../RoachIcon";
import { calmNow, drawObstacle } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/**
 * 控分肉鸽 (src/lib/study/rogue325.ts): the round's school building from the front, its floors over the ground and its
 * roof over them with the sign on it, each floor's classroom doors with what they do chalked on them, every one in
 * sight from the start. The player's roach waits on the first floor's slab; a door of the floor it is on tapped (or
 * 1, 2, 3 pressed), it crawls along the wall to it, the door is ringed in chalk, the score changes, and it climbs to the
 * floor over, at the top onto the roof, which ends the round. The other doors of a floor gone through fade. Ended at
 * 325, the score floor by floor is said; off it, a way up that comes to it, as like the one taken as there is, is boxed
 * in gold. A door is tapped anywhere in its
 * share of the floor, not only on the door. With motion turned down the roach is at once where it goes and the chalk
 * ring is drawn at once. Nothing flashes, and nothing shakes.
 */

/** The building's measures, in floors: room over the roof for the roach at the top, the roof, the ground */
const HEAD = 0.24;
const ROOF = 0.62;
const GROUND = 0.3;
/** How wide the building is at most, in floors, and how tall a floor is at most (CSS px) */
const WIDE = 6.2;
const MOST_F = 76;
/** Across: the floors' names at the left and room at the right, in shares of the width; the doors in between */
const LABEL = 0.1;
const RIGHT = 0.04;
/** A door's height in floors, and its width at most to its height and to its share of the floor; the slab a floor
 * stands on and the roach, in floors */
const DOOR_H = 0.72;
const DOOR_W = 2.2;
const DOOR_SHARE = 0.8;
const SLAB = 0.1;
const ROACH = 0.4;
/** How long the roach takes to crawl from one door to the next, waits at a door, and climbs a floor (ms) */
const DOOR_MS = 200;
const AT_DOOR_MS = 260;
const CLIMB_MS = 420;
/** The roach's place before the first door, under the floor's name */
const START = -1;

/** The building's measures in the room it has (CSS px) */
type Fit = { f: number; w: number; h: number; label: number; slot: number; dw: number; dh: number; font: number; slab: number; roach: number };
function fitOf(w: number, h: number): Fit | null {
  const f = Math.min(MOST_F, h / (HEAD + ROOF + ROGUE.floors + GROUND));
  if (!(f > 0) || !(w > 0)) return null;
  const bw = Math.min(w, f * WIDE);
  const slot = (bw * (1 - LABEL - RIGHT)) / ROGUE.doors;
  const dh = f * DOOR_H;
  const dw = Math.min(slot * DOOR_SHARE, dh * DOOR_W);
  return { f, w: bw, h: f * (HEAD + ROOF + ROGUE.floors + GROUND), label: bw * LABEL, slot, dw, dh, font: Math.min(dh * 0.52, dw / 3.3), slab: f * SLAB, roach: Math.max(12, Math.round(f * ROACH)) };
}
/** Where a door is across, in doors from the left one (0); START under the floor's name */
const placeOf = (door: number) => (door === START ? -0.5 - LABEL / ((2 * (1 - LABEL - RIGHT)) / ROGUE.doors) : door);
/** And in CSS px: its middle */
const xOf = (fit: Fit, door: number) => fit.label + (placeOf(door) + 0.5) * fit.slot;
/** Up, the top of a floor (0 the first) */
const topOf = (fit: Fit, floor: number) => fit.f * (HEAD + ROOF + ROGUE.floors - 1 - floor);
/** Where the roach is up: on the slab a floor stands on (0 the first), or at the top, on the roof (ROGUE.floors) */
const yOf = (fit: Fit, floor: number) => (floor >= ROGUE.floors ? fit.f * HEAD : topOf(fit, floor) + fit.f - fit.slab / 2);

/** What is chalked on a door: the 源石虫's has the 源石虫 drawn by it */
const chalkOf = (d: Door) => (d.kind === "plus" ? `+${d.n}` : d.kind === "minus" ? `−${d.n}` : d.kind === "double" ? "×2" : `−${ROGUE.slug}`);

/** The 源石虫 on its door, drawn as the other games draw it (arena.ts), size CSS px wide */
function Slug({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.round(size));
  const h = Math.max(1, Math.round(size * 0.86));
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawObstacle(ctx, "slug", w / 2, h / 2, w * 0.5);
  }, [w, h]);
  return <canvas ref={ref} className="rg-slug" style={{ width: w, height: h }} aria-hidden="true" />;
}

/** The chalk ring round a door gone through */
const Ring = () => (
  <svg className="rg-ring" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
    <path pathLength={1} d="M80 9C60 1 20 3 10 21C2 38 22 55 52 55C82 55 98 41 92 23C88 12 74 6 57 6" />
  </svg>
);

/** The roach: at which door (START before the first), on which floor's slab, facing (degrees, 0 up), and how it gets
 * there (ms, 0 at once; crawling along, or climbing) */
type Roach = { door: number; floor: number; deg: number; ms: number; climb?: boolean };

export default function Rogue325({ seed, look, onRound }: GameProps) {
  const building = useMemo(() => rogueBuilding(mulberry32(seed)), [seed]);
  const keys = useKeys();
  /** The doors gone through, from the first floor: the score is theirs */
  const [taken, setTaken] = useState<number[]>([]);
  const [roach, setRoach] = useState<Roach>({ door: START, floor: 0, deg: 90, ms: 0 });
  /** The roach on its way: no door is taken meanwhile */
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  /** What the line under the score says, once it is not how to play: what a door did, then how the round ended */
  const [said, setSaid] = useState<{ text: string; kind?: "fate" | "route" } | null>(null);
  /** Ended off 325: a way up that comes to it */
  const [route, setRoute] = useState<number[] | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const roomRef = useRef<HTMLDivElement>(null);
  const doorRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timers = useRef<number[]>([]);
  /** A door was picked by the keyboard's focus on it: the same door of the floor over takes the focus */
  const focusNext = useRef<number | null>(null);
  const calm = useRef(false);
  const ended = useRef(false);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;

  useEffect(() => {
    calm.current = calmNow();
    const all = timers.current;
    return () => all.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const w = Math.floor(box.width);
      const h = Math.floor(box.height);
      setRoom((r) => (r.w === w && r.h === h ? r : { w, h }));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const w = T.study.rogue325;
  const later = (ms: number, then: () => void) => {
    timers.current.push(window.setTimeout(then, ms));
  };

  const finish = (way: number[]) => {
    if (ended.current) return;
    ended.current = true;
    const n = scoreOf(building, way);
    const { won, fate } = endOf(n);
    setOver(true);
    const to = fate ? null : toGoal(building, way);
    setRoute(to);
    // at 325, the score floor by floor (each arrow kept on the line of the score before it); off it, what the gold
    // boxes are
    const chain = way.map((_, f) => scoreOf(building, way.slice(0, f + 1))).join("\u00a0→ ");
    setSaid(fate ? { text: chain, kind: "fate" } : to ? { text: w.route, kind: "route" } : null);
    const r: Round = { won, result: fmt(w.result, { n }), verdict: fate ? w.fate : fmt(won ? w.pass : w.fail, { n }) };
    roundRef.current(fate ? { ...r, fate: true } : r);
  };

  /** A door of the floor the roach is on, tapped or pressed */
  const pick = (i: number) => {
    const f = taken.length;
    if (over || busy || ended.current || f >= ROGUE.floors || i < 0 || i >= ROGUE.doors) return;
    const d = building[f][i];
    const before = scoreOf(building, taken);
    const after = enter(before, d);
    const way = [...taken, i];
    const by = doorRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    focusNext.current = by >= 0 ? i : null;
    const arrive = () => {
      setTaken(way);
      const zeroed = (d.kind === "minus" && before < d.n) || (d.kind === "slug" && before < ROGUE.slug);
      setSaid({ text: fmt(zeroed ? w.stepZero : w.step, { door: chalkOf(d), n: after }) });
    };
    if (calm.current) {
      arrive();
      setRoach({ door: i, floor: f + 1, deg: 0, ms: 0 });
      if (f + 1 === ROGUE.floors) finish(way);
      return;
    }
    setBusy(true);
    const walk = roach.door === i ? 0 : Math.round(Math.abs(i - placeOf(roach.door)) * DOOR_MS);
    setRoach({ door: i, floor: f, deg: i > roach.door ? 90 : i < roach.door ? -90 : roach.deg, ms: walk });
    later(walk, arrive);
    later(walk + AT_DOOR_MS, () => setRoach({ door: i, floor: f + 1, deg: 0, ms: CLIMB_MS, climb: true }));
    later(walk + AT_DOOR_MS + CLIMB_MS, () => {
      setBusy(false);
      if (f + 1 === ROGUE.floors) finish(way);
    });
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // 1, 2, 3 on a keyboard: the doors of the floor the roach is on, from the left
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || !/^[1-9]$/.test(e.key)) return;
      const i = Number(e.key) - 1;
      if (i >= ROGUE.doors) return;
      e.preventDefault();
      pickRef.current(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // the focus on a door picked goes on to the same door of the floor over, once it may be picked
  useEffect(() => {
    const i = focusNext.current;
    if (busy || over || i === null || taken.length >= ROGUE.floors) return;
    focusNext.current = null;
    doorRefs.current[taken.length * ROGUE.doors + i]?.focus({ preventScroll: true });
  }, [busy, over, taken.length]);

  const fit = fitOf(room.w, room.h);
  const score = scoreOf(building, taken);
  const end = over ? endOf(score) : null;
  const open = !over && !busy;
  const whatOf = (d: Door) =>
    d.kind === "plus" ? fmt(w.plusSr, { n: d.n }) : d.kind === "minus" ? fmt(w.minusSr, { n: d.n }) : d.kind === "double" ? w.doubleSr : fmt(w.slugSr, { n: ROGUE.slug });
  return (
    <div className="rg-game" data-over={over || undefined}>
      <div className="rg-side">
        <div className="rg-top">
          <span className={`rg-score${end ? (end.fate ? " rg-fate" : end.won ? " rg-good" : " rg-bad") : ""}`}>
            <small>{w.score}</small>
            <b>{score}</b>
          </span>
          <span className="rg-goal">{fmt(w.goal, { goal: ROGUE_GOAL, from: ROGUE.pass[0], to: ROGUE.pass[1] })}</span>
        </div>
        <p className={`rg-said${said?.kind ? ` rg-${said.kind}` : said ? " rg-step" : ""}`} role="status">
          {said?.text ?? (keys ? w.ruleKeys : w.rule)}
        </p>
      </div>
      <div ref={roomRef} className="rg-room">
        {fit && (
          <div
            className="rg-building"
            role="group"
            aria-label={fmt(w.buildingSr, { floors: ROGUE.floors, doors: ROGUE.doors })}
            style={{ width: fit.w, height: fit.h, "--rg-font": `${fit.font}px`, "--rg-small": `${Math.max(10, Math.min(13, fit.f * 0.2))}px` } as CSSProperties}
          >
            <div className="rg-roof" style={{ top: fit.f * HEAD, height: fit.f * ROOF }}>
              <span className="rg-sign" style={{ fontSize: Math.max(10, fit.f * 0.22) }}>
                {w.sign}
              </span>
            </div>
            {building.map((floor, f) => (
              <div
                key={f}
                className={`rg-floor${!over && f === roach.floor ? " rg-now" : ""}`}
                style={{ top: topOf(fit, f), height: fit.f, "--rg-slab": `${fit.slab}px` } as CSSProperties}
              >
                <span className="rg-level" style={{ width: fit.label, bottom: fit.slab + fit.dh / 2 }}>
                  {fmt(w.floor, { f: f + 1 })}
                </span>
                {floor.map((d, i) => {
                  const took = taken[f] === i;
                  const onRoute = route?.[f] === i;
                  return (
                    <button
                      key={i}
                      ref={(el) => {
                        doorRefs.current[f * ROGUE.doors + i] = el;
                      }}
                      className={`rg-slot${took ? " rg-took" : f < taken.length ? " rg-skip" : ""}${onRoute ? " rg-route" : ""}`}
                      style={{ left: fit.label + i * fit.slot, width: fit.slot, height: fit.f - fit.slab }}
                      disabled={!open || f !== taken.length}
                      aria-label={fmt(w.doorSr, { f: f + 1, i: i + 1, what: whatOf(d) }) + (took ? w.takenSr : "") + (onRoute ? w.routeSr : "")}
                      onClick={() => pick(i)}
                    >
                      <span className="rg-door" style={{ width: fit.dw, height: fit.dh }}>
                        <span className="rg-chalk">
                          {d.kind === "slug" && <Slug size={fit.font * 1.15} />}
                          {chalkOf(d)}
                        </span>
                        {took && <Ring />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="rg-ground" style={{ top: fit.f * (HEAD + ROOF + ROGUE.floors), height: fit.f * GROUND }} />
            <span
              className="rg-roach"
              style={{
                transform: `translate(${xOf(fit, roach.door) - fit.roach / 2}px, ${yOf(fit, roach.floor) - fit.roach / 2}px)`,
                transitionDuration: `${roach.ms}ms`,
                transitionTimingFunction: roach.climb ? "ease-in-out" : "linear",
              }}
            >
              <span className="rg-turn" style={{ transform: `rotate(${roach.deg}deg)` }}>
                <RoachIcon color={look.color} avatar={look.avatar} look={look.style} size={fit.roach} />
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
