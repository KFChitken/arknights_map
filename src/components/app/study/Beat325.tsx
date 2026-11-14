"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  BEAT_COUNT,
  BEAT_FAILS,
  BEAT_PASS,
  BEAT_READY_MS,
  BEAT_SLOTS,
  type BarTaps,
  barRight,
  barShut,
  beatPlan,
  noTaps,
  placeTap,
  SCORE_START,
  type Score,
  scored,
  slotAt,
  tapped,
  windowMs,
} from "@/lib/study/beat325";
import type { GameProps, Round } from "./games";
import { listenTaps, onClock, useKeys } from "./taps";

/** How long 对了 or 差一拍 stays after a bar (ms) */
const SAID_MS = 1200;

/** What the row shows: the bar playing (its taps), where the ring is in it, and how many of its slots' time is up */
type View = { taps: BarTaps; slot: number; up: number };

/**
 * 325 节拍 (src/lib/study/beat325.ts): 开始, 预备, a count of 3、2、5 at the first bar's speed, then a ring steps along
 * the row of dots, a slot at a time, and the player taps anywhere on the screen (Space on a keyboard, taps.ts) as it lands
 * on each dot. A dot tapped in time fills; one let go by keeps a red ring; after each bar, 对了 or 差一拍. Every slot's
 * time is set when the count starts and each tap is judged by when it was made, so the screen being drawn late moves
 * nothing. A page put away stops the round; back, it counts 3、2、5 again and goes on from the next bar, the one left
 * halfway counting for nothing. Only the ring, the dots and the words change: nothing flashes, and nothing needs sound.
 */
export default function Beat325({ onRound }: GameProps) {
  const [phase, setPhase] = useState<"ready" | "count" | "run" | "over">("ready");
  /** In the count: 预备 (null), or which of 3、2、5 */
  const [count, setCount] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [score, setScore] = useState<Score>(SCORE_START);
  /** 对了 or 差一拍, for a moment after a bar */
  const [said, setSaid] = useState<{ right: boolean; n: number } | null>(null);
  /** When 开始 was pressed, on performance.now()'s clock */
  const [startAt, setStartAt] = useState<number | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const keys = useKeys();

  useEffect(() => {
    if (startAt === null) return;
    let plan = beatPlan(0, startAt + BEAT_READY_MS);
    /** Each planned bar's taps */
    let taps: BarTaps[] = plan.bars.map(noTaps);
    /** The planned bars judged so far */
    let judged = 0;
    let points = SCORE_START;
    let saidN = 0;
    let over = false;
    let held = false;
    /** Which bar comes after a page put away is back */
    let resume = 0;
    let frame = 0;
    /** What was last put on the screen, so a frame changes it only when something did */
    let shown = "";
    const end = (why: "pass" | "out") => {
      over = true;
      cancelAnimationFrame(frame);
      setPhase("over");
      roundRef.current(roundOf(points, why));
    };
    /** Judges each bar no tap can be in any more by now; false once the round is over */
    const judge = (now: number) => {
      while (judged < plan.bars.length && barShut(plan.bars[judged]) <= now) {
        const right = barRight(taps[judged]);
        judged++;
        const r = scored(points, right);
        points = r.score;
        setScore(points);
        setSaid({ right, n: ++saidN });
        if (r.end) {
          end(r.end);
          return false;
        }
      }
      return true;
    };
    /** The bar playing at a time: the last one started */
    const playing = (now: number) => {
      let i = -1;
      while (i + 1 < plan.bars.length && plan.bars[i + 1].start <= now) i++;
      return i;
    };
    const tick = () => {
      const now = performance.now();
      if (!judge(now)) return;
      const i = playing(now);
      if (i < 0) {
        // 预备, then the count
        let c = -1;
        while (c + 1 < BEAT_COUNT.length && plan.count[c + 1] <= now) c++;
        const next = `count${c}`;
        if (next !== shown) {
          shown = next;
          setPhase("count");
          setCount(c < 0 ? null : c);
          setView(null);
        }
      } else {
        const b = plan.bars[i];
        const slot = Math.min(BEAT_SLOTS.length - 1, Math.floor((now - b.start) / b.slot));
        let up = 0;
        while (up < BEAT_SLOTS.length && slotAt(b, up) + windowMs(b.n) < now) up++;
        const next = `${b.n}:${slot}:${up}`;
        if (next !== shown) {
          shown = next;
          setPhase("run");
          setView({ taps: taps[i], slot, up });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const unlisten = listenTaps((at) => {
      if (over || held) return;
      const p = placeTap(plan.bars, at);
      // in the count, or for a bar already judged (a tap handed over late)
      if (!p || p.i < judged) return;
      taps[p.i] = tapped(taps[p.i], p.k, p.hit);
      if (p.i === playing(performance.now())) setView((v) => v && { ...v, taps: taps[p.i] });
    });
    // a page put away stops the round; back, the count again and the next bar
    const onShow = () => {
      if (over) return;
      const now = performance.now();
      if (document.hidden) {
        if (held || !judge(now)) return;
        held = true;
        cancelAnimationFrame(frame);
        const i = playing(now);
        // the bar left halfway counts for nothing; one not begun yet is the one after the count
        resume = i < 0 ? plan.bars[0].n : plan.bars[i].n + 1;
      } else if (held) {
        held = false;
        plan = beatPlan(resume, now + BEAT_READY_MS);
        taps = plan.bars.map(noTaps);
        judged = 0;
        shown = "";
        setSaid(null);
        frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      over = true;
      cancelAnimationFrame(frame);
      unlisten();
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [startAt]);

  // 对了 and 差一拍 go after a moment
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  const w = T.study.beat325;
  return (
    <div className="bt-game" data-phase={phase}>
      <div className="bt-score">
        <Dots label={w.right} of={BEAT_PASS} n={score.right} said={fmt(w.rightSr, { n: score.right, of: BEAT_PASS })} />
        <Dots label={w.wrong} of={BEAT_FAILS} n={score.wrong} said={fmt(w.wrongSr, { n: score.wrong, of: BEAT_FAILS })} wrong />
      </div>
      <div className="bt-say" aria-hidden={phase === "count" ? true : undefined}>
        {phase === "count" &&
          (count === null ? <small className="bt-ready">{w.ready}</small> : <b className="bt-count">{BEAT_COUNT[count]}</b>)}
        {phase !== "count" && said && <p className={`bt-said ${said.right ? "bt-good" : "bt-bad"}`}>{said.right ? w.good : w.bad}</p>}
      </div>
      <Row view={view} sr={w.rowSr} />
      <div className="bt-under">
        {phase === "ready" && (
          <button
            className="bt-start"
            onClick={(e) => {
              setStartAt(onClock(e.timeStamp));
              setPhase("count");
            }}
          >
            {w.start}
          </button>
        )}
        {phase !== "over" && (
          <p className="bt-hint">{phase === "ready" ? fmt(w.rule, { pass: BEAT_PASS, fails: BEAT_FAILS }) : keys ? w.tapKeys : w.tap}</p>
        )}
      </div>
    </div>
  );
}

/** The row of slots: a dot for each beat, a speck for each rest, and the ring on the slot whose time it is */
function Row({ view, sr }: { view: View | null; sr: string }) {
  return (
    <div className="bt-row" role="img" aria-label={sr}>
      {BEAT_SLOTS.map((beat, k) => {
        const hits = view?.taps.hits[k] ?? 0;
        const strays = view?.taps.strays[k] ?? 0;
        const state = beat
          ? hits > 1
            ? " bt-twice"
            : hits === 1
              ? " bt-hit"
              : view && k < view.up
                ? " bt-miss"
                : ""
          : strays
            ? " bt-stray"
            : "";
        return (
          <span key={k} className={`bt-slot${view?.slot === k ? " bt-on" : ""}`}>
            <i className={`${beat ? "bt-dot" : "bt-rest"}${state}`} />
          </span>
        );
      })}
    </div>
  );
}

/** Bars right, or wrong: a dot for each of those that pass or end the round */
function Dots({ label, of, n, said, wrong }: { label: string; of: number; n: number; said: string; wrong?: boolean }) {
  return (
    <span className={`bt-tally${wrong ? " bt-wrongs" : ""}`} role="img" aria-label={said}>
      <small>{label}</small>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? "bt-on" : undefined} />
      ))}
    </span>
  );
}

function roundOf(s: Score, why: "pass" | "out"): Round {
  const w = T.study.beat325;
  return {
    won: why === "pass",
    result: fmt(w.result, { n: s.right }),
    verdict: why === "pass" ? fmt(w.pass, { n: s.right }) : fmt(w.out, { wrong: s.wrong, n: s.right }),
  };
}
