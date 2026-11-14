"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  answered,
  MENTAL_STREAK,
  MENTAL_WRONGS,
  mentalMs,
  mentalSums,
  type Tally,
  TALLY_START,
  valueOf,
} from "@/lib/study/mental325";
import { dayRandom } from "@/lib/study/rules";
import type { GameProps, Round } from "./games";
import { onClock, useKeys } from "./taps";

/** How long a sum answered right shows its tick before the next comes (ms) */
const RIGHT_MS = 450;
/** How long a sum answered wrong shows what it makes (ms) */
const WRONG_MS = 1000;
/** How long after a sum's time is up a press may still come in, judged by when it was made (ms) */
const LATE_MS = 80;

type Phase = "ready" | "ask" | "right" | "wrong";

/**
 * 心算快打 (src/lib/study/mental325.ts): 开始, then the day's sums one at a time on a card that comes in from the right
 * (just appears when less motion is asked for), a bar along its foot running down its time; 「= 325」 and 「≠ 325」
 * under it, ← and → on a keyboard. Right: a tick, and the next. Wrong, or the bar run out: the card shakes and says
 * what the sum makes for a second. A page hidden halfway holds the round, and puts the sum that showed up again with all
 * its time when it is back. Only the card and the dots change: nothing flashes.
 */
export default function Mental325({ day, onRound }: GameProps) {
  const sums = useMemo(() => mentalSums(dayRandom("mental325", day)), [day]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [over, setOver] = useState(false);
  /** The sum showing (which of the day's), its time, and how many times a sum was put up (its bar starts again) */
  const [shown, setShown] = useState({ i: 0, ms: mentalMs(1), put: 0 });
  const [tally, setTally] = useState<Tally>(TALLY_START);
  /** A sum answered wrong: what it makes, and whether its time ran out */
  const [miss, setMiss] = useState<{ value: number; late: boolean } | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const keys = useKeys();
  /** The round as it is, for the clock and keys, faster than the page is drawn */
  const at = useRef({ phase: "ready" as Phase, over: false, i: 0, put: 0, deadline: 0, tally: TALLY_START, timer: 0, held: false });

  /** The round passed or out: said once */
  const finish = (end: "pass" | "out") => {
    at.current.over = true;
    setOver(true);
    roundRef.current(roundOf(at.current.tally, end));
  };
  /** Puts up the day's ith sum with all its time */
  const ask = (i: number) => {
    const a = at.current;
    if (a.over) return;
    window.clearTimeout(a.timer);
    // never: a round asks at most 30
    if (i >= sums.length) return finish("out");
    const ms = mentalMs(i + 1);
    a.phase = "ask";
    a.i = i;
    a.put++;
    a.deadline = performance.now() + ms;
    setShown({ i, ms, put: a.put });
    setMiss(null);
    setPhase("ask");
    a.timer = window.setTimeout(() => play.current.answer(null, performance.now()), ms + LATE_MS);
  };
  /** The sum showing answered 「= 325」 (true) or 「≠ 325」 (false) at a time on performance.now()'s clock, or let run out (null) */
  const answer = (said: boolean | null, stamp: number) => {
    const a = at.current;
    if (a.over || a.phase !== "ask") return;
    window.clearTimeout(a.timer);
    const value = valueOf(sums[a.i].text);
    const late = said === null || stamp > a.deadline;
    const right = !late && said === (value === 325);
    const { tally, end } = answered(a.tally, right);
    a.tally = tally;
    a.phase = right ? "right" : "wrong";
    setTally(tally);
    setMiss(right ? null : { value, late });
    setPhase(a.phase);
    if (end) return finish(end);
    a.timer = window.setTimeout(() => play.current.ask(a.i + 1), right ? RIGHT_MS : WRONG_MS);
  };
  const play = useRef({ ask, answer });
  play.current = { ask, answer };

  // ← is 「= 325」, → is 「≠ 325」
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const a = at.current;
      if (a.phase === "ready" || a.over) return;
      e.preventDefault();
      if (!e.repeat) play.current.answer(e.key === "ArrowLeft", onClock(e.timeStamp));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // a page put away holds the round: the sum showing comes again with all its time, or the next after a tick or a miss
  useEffect(() => {
    const a = at.current;
    const onShow = () => {
      if (a.over || a.phase === "ready") return;
      if (document.hidden) {
        window.clearTimeout(a.timer);
        a.held = true;
      } else if (a.held) {
        a.held = false;
        play.current.ask(a.phase === "ask" ? a.i : a.i + 1);
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearTimeout(a.timer);
    };
  }, []);

  const w = T.study.mental325;
  const sum = sums[shown.i];
  const truth = miss && (miss.value === 325 ? w.is : fmt(w.not, { v: miss.value }));
  return (
    <div className="mt-game" data-phase={phase}>
      <div className="mt-score">
        <Dots label={w.streak} of={MENTAL_STREAK} n={tally.streak} said={fmt(w.streakSr, { n: tally.streak, of: MENTAL_STREAK })} />
        <Dots label={w.wrongs} of={MENTAL_WRONGS} n={tally.wrongs} said={fmt(w.wrongsSr, { n: tally.wrongs, of: MENTAL_WRONGS })} wrong />
      </div>
      {phase === "ready" ? (
        <div className="mt-card mt-idle">
          <p>{fmt(w.rule, { streak: MENTAL_STREAK, wrongs: MENTAL_WRONGS })}</p>
        </div>
      ) : (
        <div key={shown.i} className={`mt-card${phase === "right" ? " mt-right" : phase === "wrong" ? " mt-wrong" : ""}`}>
          {miss?.late && <small className="mt-late">{w.late}</small>}
          <span className="mt-sum">{sum.text}</span>
          {phase === "right" && (
            <svg className="mt-tick" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
          {truth && <span className="mt-truth">{truth}</span>}
          <span className="mt-bar" aria-hidden="true">
            <i key={shown.put} style={{ animationDuration: `${shown.ms}ms` }} />
          </span>
        </div>
      )}
      <p className="st-sr" aria-live="polite">
        {phase === "ask" ? sum.text : truth && (miss?.late ? `${w.late} ${truth}` : truth)}
      </p>
      <div className="mt-answers">
        {phase === "ready" ? (
          <button className="mt-start" onClick={() => ask(0)}>
            {w.start}
          </button>
        ) : (
          <>
            <button className="mt-say" disabled={over} onClick={(e) => answer(true, onClock(e.timeStamp))}>
              {keys && <kbd aria-hidden="true">←</kbd>}
              {w.yes}
            </button>
            <button className="mt-say" disabled={over} onClick={(e) => answer(false, onClock(e.timeStamp))}>
              {w.no}
              {keys && <kbd aria-hidden="true">→</kbd>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Right in a row, or wrong: a dot for each of those that pass or end the round */
function Dots({ label, of, n, said, wrong }: { label: string; of: number; n: number; said: string; wrong?: boolean }) {
  return (
    <span className={`mt-tally${wrong ? " mt-wrongs" : ""}`} role="img" aria-label={said}>
      <small>{label}</small>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? "mt-on" : undefined} />
      ))}
    </span>
  );
}

function roundOf(t: Tally, end: "pass" | "out"): Round {
  const w = T.study.mental325;
  return {
    won: end === "pass",
    result: fmt(w.result, { n: t.best }),
    verdict: end === "pass" ? fmt(w.pass, { n: MENTAL_STREAK }) : fmt(w.out, { wrongs: MENTAL_WRONGS, n: t.best }),
  };
}
