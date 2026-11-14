"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  judgeTap,
  REACT_COUNT_MS,
  REACT_COUNTDOWN,
  REACT_HITS,
  REACT_SLIPS,
  reactStream,
  reactTimes,
} from "@/lib/study/react325";
import { dayRandom } from "@/lib/study/rules";
import type { GameProps, Round } from "./games";
import { listenTaps, onClock, useKeys } from "./taps";

/**
 * 3、2、5 反应 (src/lib/study/react325.ts): 开始 counts down 3, 2, 5 (not 3, 2, 1; taps in it count for nothing), then the
 * day's digits come up in the box one at a time. A tap anywhere on the screen (Space on a keyboard, taps.ts) while the 5
 * of a 3、2、5 shows is a hit, at any other digit a slip, each judged by the press's own time against when each digit
 * came up on the screen. Only the digit in the box and the tallies under it change: nothing flashes.
 */
export default function React325({ day, onRound }: GameProps) {
  const stream = useMemo(() => reactStream(dayRandom("react325", day)), [day]);
  const times = useMemo(() => reactTimes(stream.length), [stream]);
  const [phase, setPhase] = useState<"ready" | "count" | "run" | "over">("ready");
  /** What the box shows: a digit of the countdown or of the day's */
  const [digit, setDigit] = useState<number | null>(null);
  const [hits, setHits] = useState(0);
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
    /** When each of the day's digits came up on the screen, as far as they have */
    const shown: number[] = [];
    const hit = new Set<number>();
    let slipped = 0;
    let counting = -1;
    let frame = 0;
    let over = false;
    const end = (why: "hits" | "slips" | "out") => {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame);
      setPhase("over");
      roundRef.current(roundOf(hit.size, slipped, why));
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
        if (t >= times[stream.length]) return end("out");
        let i = Math.max(0, shown.length - 1);
        while (i + 1 < stream.length && times[i + 1] <= t) i++;
        if (i >= shown.length) {
          // a digit a slow frame skipped never showed: it counts as coming up with this one
          while (shown.length <= i) shown.push(now);
          setPhase("run");
          setDigit(stream[i]);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const unlisten = listenTaps((at) => {
      if (over || at < runAt) return;
      const r = judgeTap(stream, shown, hit, at);
      if (r === null) return;
      if (r === "slip") {
        slipped++;
        setSlips(slipped);
        setSaid({ hit: false, n: hit.size + slipped });
        if (slipped >= REACT_SLIPS) end("slips");
      } else {
        hit.add(r.hit);
        setHits(hit.size);
        setSaid({ hit: true, n: hit.size + slipped });
        if (hit.size >= REACT_HITS) end("hits");
      }
    });
    return () => {
      over = true;
      cancelAnimationFrame(frame);
      unlisten();
    };
  }, [startAt, stream, times]);

  // 拍中！ and 拍错了 go after a moment
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), 700);
    return () => window.clearTimeout(t);
  }, [said]);

  const words = T.study.react325;
  return (
    <div className="rx-game" data-phase={phase}>
      <div className="rx-box" aria-hidden="true">
        {phase === "count" && <small className="rx-ready">{words.ready}</small>}
        <span className={`rx-digit${digit === null ? " rx-idle" : ""}`}>{digit ?? "3·2·5"}</span>
      </div>
      <div className="rx-score">
        <Tally label={words.hits} of={REACT_HITS} n={hits} said={fmt(words.hitsSr, { n: hits, of: REACT_HITS })} />
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
          phase !== "over" && (
            <p className="rx-hint">{phase === "ready" ? fmt(words.rule, { hits: REACT_HITS, slips: REACT_SLIPS }) : keys ? words.tapKeys : words.tap}</p>
          )
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

function roundOf(hits: number, slips: number, why: "hits" | "slips" | "out"): Round {
  const words = T.study.react325;
  const won = why === "hits";
  return {
    won,
    result: fmt(words.result, { hits, slips }),
    verdict: won ? (slips ? words.pass : words.clean) : why === "slips" ? fmt(words.slipOut, { n: slips }) : fmt(words.ranOut, { n: hits }),
  };
}
