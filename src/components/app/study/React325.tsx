"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  judgeTap,
  REACT_CODE,
  REACT_COUNT_MS,
  REACT_COUNTDOWN,
  REACT_MAX,
  REACT_SLIPS,
  reactDealer,
  reactTimes,
} from "@/lib/study/react325";
import { mulberry32 } from "@/lib/prng";
import type { GameProps, Round } from "./games";
import { listenTaps, onClock, useKeys } from "./taps";

/**
 * 3、2、5 反应 (src/lib/study/react325.ts): 开始 counts down 3, 2, 5 (not 3, 2, 1; taps in it count for nothing), then
 * digits come up in the box one at a time, dealt as they come from the round's seed. Six places over the box are
 * tapped out in order, 3 2 5 7 9 9: a tap anywhere on the screen (Space on a keyboard, taps.ts) while the digit wanted
 * next shows fills its place, at any other digit it is a slip, each judged by the press's own time against when each
 * digit came up on the screen, and each digit takes one tap. Only the digit in the box, the places and the slips change:
 * nothing flashes.
 */
export default function React325({ seed, onRound }: GameProps) {
  const times = useMemo(() => reactTimes(), []);
  const [phase, setPhase] = useState<"ready" | "count" | "run" | "over">("ready");
  /** What the box shows: a digit of the countdown or of the round's */
  const [digit, setDigit] = useState<number | null>(null);
  /** The places filled so far */
  const [filled, setFilled] = useState(0);
  const [slips, setSlips] = useState(0);
  /** 拍中！ or 拍错了 for a moment after a tap */
  const [said, setSaid] = useState<{ hit: boolean; n: number } | null>(null);
  /** When 开始 was pressed, on performance.now()'s clock */
  const [startAt, setStartAt] = useState<number | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const keys = useKeys();

  useEffect(() => {
    if (startAt === null) return;
    const runAt = startAt + REACT_COUNTDOWN.length * REACT_COUNT_MS;
    const deal = reactDealer(mulberry32(seed));
    /** The round's digits dealt so far, and when each came up on the screen */
    const digits: number[] = [];
    const shown: number[] = [];
    /** The digits a tap counted for already: each takes one */
    const used = new Set<number>();
    let places = 0;
    let slipped = 0;
    let counting = -1;
    let frame = 0;
    let over = false;
    const end = (why: "code" | "slips" | "out") => {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame);
      setPhase("over");
      roundRef.current(roundOf(places, slipped, why));
    };
    const tick = () => {
      const now = performance.now();
      if (now < runAt) {
        const c = Math.min(REACT_COUNTDOWN.length - 1, Math.floor((now - startAt) / REACT_COUNT_MS));
        if (c !== counting) {
          counting = c;
          setDigit(REACT_COUNTDOWN[c]);
        }
      } else {
        const t = now - runAt;
        if (t >= times[REACT_MAX]) return end("out");
        let i = Math.max(0, digits.length - 1);
        while (i + 1 < REACT_MAX && times[i + 1] <= t) i++;
        if (i >= digits.length) {
          // a digit a slow frame skipped never showed: it counts as coming up with this one
          while (digits.length <= i) {
            digits.push(deal(REACT_CODE[places]));
            shown.push(now);
          }
          setPhase("run");
          setDigit(digits[i]);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const unlisten = listenTaps((at) => {
      if (over || at < runAt) return;
      const r = judgeTap(digits, shown, used, at, REACT_CODE[places]);
      if (r === null) return;
      if ("slip" in r) {
        used.add(r.slip);
        slipped++;
        setSlips(slipped);
        setSaid({ hit: false, n: places + slipped });
        if (slipped >= REACT_SLIPS) end("slips");
      } else {
        used.add(r.fill);
        places++;
        setFilled(places);
        setSaid({ hit: true, n: places + slipped });
        if (places >= REACT_CODE.length) end("code");
      }
    });
    return () => {
      over = true;
      cancelAnimationFrame(frame);
      unlisten();
    };
  }, [startAt, seed, times]);

  // 拍中！ and 拍错了 go after a moment
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), 700);
    return () => window.clearTimeout(t);
  }, [said]);

  const words = T.study.react325;
  return (
    <div className="rx-game" data-phase={phase}>
      <span className="rx-code" role="img" aria-label={fmt(words.codeSr, { n: filled })}>
        {REACT_CODE.map((n, i) => (
          <b key={i} className={i < filled ? "rx-got" : i === filled && phase !== "ready" ? "rx-next" : undefined}>
            {n}
          </b>
        ))}
      </span>
      <div className="rx-box" aria-hidden="true">
        {phase === "count" && <small className="rx-ready">{words.ready}</small>}
        <span className={`rx-digit${digit === null ? " rx-idle" : ""}`}>{digit ?? "3·2·5"}</span>
      </div>
      <div className="rx-score">
        <Tally label={words.slips} of={REACT_SLIPS} n={slips} said={fmt(words.slipsSr, { n: slips, of: REACT_SLIPS })} slips />
      </div>
      {/* the same height whatever is in it, so the box stays where it is */}
      <div className="rx-under">
        {phase === "ready" && (
          <button
            className="rx-start"
            onClick={(e) => {
              setStartAt(onClock(e.timeStamp));
              setPhase("count");
            }}
          >
            {words.start}
          </button>
        )}
        {phase === "run" && said ? (
          <p className={`rx-said ${said.hit ? "rx-hit" : "rx-slip"}`}>{said.hit ? words.hit : words.slip}</p>
        ) : (
          phase !== "over" && <p className="rx-hint">{phase === "ready" ? fmt(words.rule, { slips: REACT_SLIPS }) : keys ? words.tapKeys : words.tap}</p>
        )}
      </div>
    </div>
  );
}

/** Hits or slips so far, a dot for each of those that end the round */
function Tally({ label, of, n, said, slips }: { label: string; of: number; n: number; said: string; slips?: boolean }) {
  return (
    <span className={`rx-tally${slips ? " rx-slips" : ""}`} role="img" aria-label={said}>
      <small>{label}</small>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? "rx-on" : undefined} />
      ))}
    </span>
  );
}

function roundOf(places: number, slips: number, why: "code" | "slips" | "out"): Round {
  const words = T.study.react325;
  const won = why === "code";
  return {
    won,
    result: fmt(words.result, { n: places, slips }),
    verdict: won ? words.pass : why === "slips" ? fmt(words.slipOut, { n: slips }) : fmt(words.ranOut, { n: places }),
  };
}
