"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { hundredths, judgeStop, STOP_HIDE_AFTER_MS, STOP_LIMIT_MS, watchText } from "@/lib/study/stopwatch";
import type { GameProps, Round } from "./games";

/**
 * 3.25 秒停表 (src/lib/study/stopwatch.ts): 开始 sets a watch running up from 0.00, and a tap anywhere on the screen
 * (Space on a keyboard) stops it; it stops by itself at 10.00. The time is the stopping press's own time stamp less
 * the starting one's, so neither how often the screen is drawn nor a slow phone moves it. mode hidden (藏数字再来): the
 * numbers hide after a second, leaving the dial, and show again once it stops.
 */
export default function Stopwatch({ mode, onRound }: GameProps) {
  const hidden = mode === "hidden";
  const [phase, setPhase] = useState<"ready" | "running" | "stopped">("ready");
  const [cs, setCs] = useState(0);
  const [veiled, setVeiled] = useState(false);
  const [verdict, setVerdict] = useState<"exact" | "pass" | "miss" | null>(null);
  const startRef = useRef(0);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  // a keyboard to press Space on, as far as the device tells: the hint says so
  const [keys, setKeys] = useState(false);
  useEffect(() => setKeys(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false), []);

  useEffect(() => {
    if (phase !== "running") return;
    let frame = 0;
    let over = false;
    const stop = (shown: number, limit: boolean) => {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame);
      const v = judgeStop(shown);
      setCs(shown);
      setVeiled(false);
      setVerdict(v);
      setPhase("stopped");
      roundRef.current(roundOf(shown, v, hidden, limit));
    };
    const tick = () => {
      const ms = performance.now() - startRef.current;
      if (ms >= STOP_LIMIT_MS) return stop(hundredths(STOP_LIMIT_MS), true);
      setCs(hundredths(ms));
      if (hidden && ms >= STOP_HIDE_AFTER_MS) setVeiled(true);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const at = (e: Event) => Math.min(hundredths(onClock(e.timeStamp) - startRef.current), hundredths(STOP_LIMIT_MS));
    // anywhere on the screen, all but 不玩了 (which leaves without a round)
    const onPointer = (e: PointerEvent) => {
      if (e.button > 0 || (e.target instanceof Element && e.target.closest("[data-quit]"))) return;
      e.preventDefault();
      stop(at(e), false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      e.preventDefault();
      if (!e.repeat) stop(at(e), false);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      over = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [phase, hidden]);

  const passed = verdict === "exact" || verdict === "pass";
  return (
    <div className={`sw-watch${phase === "stopped" ? (passed ? " won" : " lost") : ""}`}>
      <div className="sw-dial">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="92" className="sw-ring" />
          {TICKS.map((a) => (
            <line key={a} x1="100" y1="14" x2="100" y2={a % 90 === 0 ? 26 : 21} transform={`rotate(${a} 100 100)`} className="sw-tick" />
          ))}
        </svg>
        <span className={`sw-time${veiled ? " veiled" : ""}`} aria-hidden={phase === "running" || undefined}>
          {watchText(cs)}
        </span>
      </div>
      {/* the same height whatever is in it, so the dial stays where it is */}
      <div className="sw-under">
        {phase === "ready" && (
          <button
            className="sw-start"
            onClick={(e) => {
              startRef.current = onClock(e.timeStamp);
              setCs(0);
              setPhase("running");
            }}
          >
            {T.study.stopwatch.start}
          </button>
        )}
        {phase !== "stopped" && (
          <p className="sw-hint">
            {phase === "running" ? (keys ? T.study.stopwatch.tapKeys : T.study.stopwatch.tap) : hidden ? T.study.stopwatch.hideNote : T.study.courses.stopwatch.rule}
          </p>
        )}
      </div>
    </div>
  );
}

/** The dial's marks, every 30° */
const TICKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

/**
 * An event's time on performance.now()'s clock, which event.timeStamp is in browsers today; one that is not, or
 * says nothing, is read as now
 */
function onClock(stamp: number): number {
  const now = performance.now();
  return Number.isFinite(stamp) && stamp > 0 && stamp <= now + 50 && now - stamp < 5_000 ? stamp : now;
}

function roundOf(cs: number, v: "exact" | "pass" | "miss", hidden: boolean, limit: boolean): Round {
  const t = watchText(cs);
  const won = v !== "miss";
  const words = T.study.stopwatch;
  return {
    won,
    result: fmt(words.result, { t }) + (hidden ? words.hidden : ""),
    verdict: limit ? words.limit : v === "exact" ? words.exact : v === "pass" ? words.pass : fmt(words.miss, { t }),
    again: won ? { label: words.hide, mode: "hidden" } : undefined,
  };
}
