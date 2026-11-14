"use client";

import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { type Cell, dragTo, FIND_COUNT, FIND_MS, FIND_SIDE, findPuzzle, wordAt, wordEnd } from "@/lib/study/find325";
import { dayRandom } from "@/lib/study/rules";
import type { GameProps, Round } from "./games";

/**
 * 找 325 (src/lib/study/find325.ts): the day's grid, its digits hidden until 开始. Then a minute to find the five 325s
 * in it: a finger (or a mouse) dragged from a 3 to its 5 rings one, a rounded box along it that stays. All five, or the
 * minute out, end the round, and those not found are shown. Only the boxes and the count change: nothing flashes.
 */
export default function Find325({ day, onRound }: GameProps) {
  const { grid, words } = useMemo(() => findPuzzle(dayRandom("find325", day)), [day]);
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  /** The 325s found, in the order they were */
  const [found, setFound] = useState<number[]>([]);
  /** A drag on the way: the cell it began on, and where it has got to */
  const [drag, setDrag] = useState<{ from: Cell; to: Cell } | null>(null);
  /** Whole seconds left, as shown */
  const [left, setLeft] = useState(FIND_MS / 1000);
  const gridRef = useRef<HTMLDivElement>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  /** The round as the last finger left it, for events faster than the page is drawn; a drag keeps its finger's id */
  const at = useRef({ over: false, startAt: 0, found: [] as number[], drag: null as { from: Cell; to: Cell; id: number } | null });

  const end = (all: boolean) => {
    const now = at.current;
    if (now.over) return;
    now.over = true;
    now.drag = null;
    setDrag(null);
    setPhase("over");
    roundRef.current(roundOf(now.found.length, all, (performance.now() - now.startAt) / 1000));
  };
  const endRef = useRef(end);
  endRef.current = end;

  // the minute
  useEffect(() => {
    if (phase !== "run") return;
    const tick = window.setInterval(() => {
      const ms = FIND_MS - (performance.now() - at.current.startAt);
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
      if (ms <= 0) endRef.current(false);
    }, 200);
    return () => window.clearInterval(tick);
  }, [phase]);

  /** Where a finger is over the grid, in cells from its top left corner */
  const point = (e: PointerEvent) => {
    const box = gridRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * FIND_SIDE, y: ((e.clientY - box.top) / box.height) * FIND_SIDE };
  };
  // one finger at a time: a second one while the first drags is let be
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== "run" || at.current.over || at.current.drag || (e.pointerType === "mouse" && e.button !== 0)) return;
    const { x, y } = point(e);
    const from = { r: clamp(Math.floor(y)), c: clamp(Math.floor(x)) };
    at.current.drag = { from, to: from, id: e.pointerId };
    setDrag(at.current.drag);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = at.current.drag;
    if (!d || e.pointerId !== d.id) return;
    const { x, y } = point(e);
    const to = dragTo(d.from, x, y);
    if (to.r === d.to.r && to.c === d.to.c) return;
    at.current.drag = { ...d, to };
    setDrag(at.current.drag);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = at.current.drag;
    if (!d || e.pointerId !== d.id) return;
    at.current.drag = null;
    setDrag(null);
    const i = wordAt(words, d.from, d.to);
    if (i < 0 || at.current.found.includes(i) || at.current.over) return;
    at.current.found = [...at.current.found, i];
    setFound(at.current.found);
    if (at.current.found.length === FIND_COUNT) end(true);
  };
  const onCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (at.current.drag?.id !== e.pointerId) return;
    at.current.drag = null;
    setDrag(null);
  };

  const t = T.study.find325;
  return (
    <div className="fd-game" data-phase={phase}>
      <div className="fd-top">
        <span>{fmt(t.count, { n: found.length, of: FIND_COUNT })}</span>
        <span className={phase === "run" && left <= 10 ? "fd-low" : undefined}>{fmt(t.left, { s: phase === "ready" ? FIND_MS / 1000 : left })}</span>
      </div>
      <div
        ref={gridRef}
        className="fd-grid"
        role="img"
        aria-label={t.gridSr}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
      >
        {grid.flat().map((d, i) => (
          <span key={i}>{phase === "ready" ? "" : d}</span>
        ))}
        <svg className="fd-marks" viewBox={`0 0 ${FIND_SIDE} ${FIND_SIDE}`} aria-hidden="true">
          {phase === "over" &&
            words.map((w, i) => !found.includes(i) && <Mark key={`m${i}`} a={w} b={wordEnd(w)} className="fd-missed" />)}
          {found.map((i) => (
            <Mark key={i} a={words[i]} b={wordEnd(words[i])} className="fd-found" />
          ))}
          {drag && <Mark a={drag.from} b={drag.to} className="fd-drag" />}
        </svg>
        {phase === "ready" && (
          <div className="fd-ready">
            <p>{fmt(t.rule, { n: FIND_COUNT, s: FIND_MS / 1000 })}</p>
            <button
              className="fd-start"
              onClick={() => {
                at.current.startAt = performance.now();
                setPhase("run");
              }}
            >
              {t.start}
            </button>
          </div>
        )}
      </div>
      <p className="fd-tip">{phase === "run" ? t.tip : ""}</p>
    </div>
  );
}

const clamp = (n: number) => Math.max(0, Math.min(FIND_SIDE - 1, n));

/** A rounded box along a run of cells, from the middle of one end to the middle of the other */
function Mark({ a, b, className }: { a: Cell; b: Cell; className: string }) {
  const len = Math.hypot(b.c - a.c, b.r - a.r);
  const deg = (Math.atan2(b.r - a.r, b.c - a.c) * 180) / Math.PI;
  return (
    <rect
      className={className}
      x={-0.42}
      y={-0.42}
      width={len + 0.84}
      height={0.84}
      rx={0.42}
      transform={`translate(${a.c + 0.5} ${a.r + 0.5}) rotate(${deg})`}
    />
  );
}

function roundOf(n: number, all: boolean, secs: number): Round {
  const t = T.study.find325;
  return {
    won: all,
    result: fmt(t.result, { n }),
    verdict: all ? fmt(t.all, { n, s: Math.max(1, Math.round(secs)) }) : n ? fmt(t.time, { n }) : t.none,
  };
}
