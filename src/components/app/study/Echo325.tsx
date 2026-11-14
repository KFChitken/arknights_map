"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  type Bell,
  type Echo,
  ECHO_BELLS,
  ECHO_OFF_MS,
  ECHO_ON_MS,
  ECHO_PAUSE_MS,
  ECHO_RING_MS,
  ECHO_START,
  ECHO_STEPS,
  echoBells,
  isBell,
  remembered,
  ring,
} from "@/lib/study/echo325";
import { dayRandom } from "@/lib/study/rules";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

type Phase = "ready" | "watch" | "echo" | "over";

/**
 * 复读 325 (src/lib/study/echo325.ts): three bells stand on a desk. After 开始, each turn the bells light one after
 * another (看好), then the player rings them back (该你了): a tap on a bell, or its digit on a keyboard. A turn rung
 * back plays again with one bell more; ten pass, and one wrong bell ends the round. Only the bell lit changes and the
 * dots over them fill: nothing flashes, and nothing needs sound.
 */
export default function Echo325({ day, onRound }: GameProps) {
  const bells = useMemo(() => echoBells(dayRandom("echo325", day)), [day]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [echo, setEcho] = useState<Echo>(ECHO_START);
  /** The bell lit now; n tells two lightings of the same bell apart */
  const [lit, setLit] = useState<{ bell: Bell; n: number } | null>(null);
  /** 对了！ from a turn rung back to the next turn's first bell */
  const [right, setRight] = useState(false);
  /** Once over by a wrong bell: that bell, and the one wanted */
  const [wrong, setWrong] = useState<{ bell: Bell; want: Bell } | null>(null);
  const keys = useKeys();
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  /** The round as the last ring left it, as rings can come faster than the page is drawn */
  const at = useRef<{ phase: Phase; echo: Echo }>({ phase, echo });
  const rings = useRef(0);
  const timers = useRef(new Set<number>());

  const go = (p: Phase, e: Echo) => {
    at.current = { phase: p, echo: e };
    setPhase(p);
    setEcho(e);
  };

  const press = (bell: Bell) => {
    const now = at.current;
    if (now.phase !== "echo") return;
    const r = ring(bells, now.echo, bell);
    if (r.did === "wrong") {
      setLit(null);
      setWrong({ bell, want: r.want });
      go("over", r.echo);
      roundRef.current(roundOf(r.echo, false));
      return;
    }
    const n = ++rings.current;
    setLit({ bell, n });
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      setLit((l) => (l?.n === n ? null : l));
    }, ECHO_RING_MS);
    timers.current.add(t);
    if (r.did === "pass") {
      go("over", r.echo);
      roundRef.current(roundOf(r.echo, true));
    } else if (r.did === "turn") {
      setRight(true);
      go("watch", r.echo);
    } else go("echo", r.echo);
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  // a turn's bells, one after another, then the player's to ring back
  useEffect(() => {
    if (phase !== "watch") return;
    const ids: number[] = [];
    const later = (ms: number, f: () => void) => void ids.push(window.setTimeout(f, ms));
    const step = ECHO_ON_MS + ECHO_OFF_MS;
    for (let i = 0; i < echo.turn; i++) {
      later(ECHO_PAUSE_MS + i * step, () => {
        setRight(false);
        setLit({ bell: bells[i], n: -1 - i });
      });
      later(ECHO_PAUSE_MS + i * step + ECHO_ON_MS, () => setLit(null));
    }
    later(ECHO_PAUSE_MS + echo.turn * step - ECHO_OFF_MS, () => {
      at.current = { phase: "echo", echo };
      setPhase("echo");
    });
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [phase, echo, bells]);

  // the digits on a keyboard ring the bells
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const d = Number(e.key);
      if (!isBell(d)) return;
      e.preventDefault();
      pressRef.current(d);
    };
    window.addEventListener("keydown", onKey);
    const pending = timers.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const words = T.study.echo325;
  /** Dots over the bells: one a step to ring back, those of this turn dark, those rung back filled */
  const filled = phase === "over" && !wrong ? ECHO_STEPS : echo.rung;
  return (
    <div className="ec-game" data-phase={phase}>
      <span className="ec-steps" role="img" aria-label={fmt(words.stepsSr, { n: remembered(echo), of: ECHO_STEPS })}>
        {Array.from({ length: ECHO_STEPS }, (_, i) => (
          <i
            key={i}
            className={wrong && i === echo.rung ? "ec-miss" : i < filled ? "ec-on" : i < echo.turn ? "ec-in" : undefined}
          />
        ))}
      </span>
      <div className="ec-stand">
        <div className="ec-bells">
          {ECHO_BELLS.map((b) => (
            <button
              key={b}
              type="button"
              className={`ec-bell${lit?.bell === b ? " ec-lit" : ""}${wrong?.bell === b ? " ec-wrong" : ""}${wrong?.want === b ? " ec-want" : ""}`}
              aria-label={String(b)}
              aria-disabled={phase !== "echo"}
              onClick={() => press(b)}
            >
              <svg viewBox="0 0 100 96" aria-hidden="true">
                <path className="ec-ding" d="M26 17 L18 8 M50 13 L50 2 M74 17 L82 8" />
                <g className="ec-press">
                  <rect className="ec-knob" x="38" y="20" width="24" height="8" rx="4" />
                  <rect className="ec-knob" x="46.5" y="26" width="7" height="20" />
                </g>
                <path className="ec-dome" d="M12 82 A38 38 0 0 1 88 82" />
                <rect className="ec-base" x="4" y="82" width="92" height="12" rx="6" />
                <text className="ec-num" x="50" y="76">
                  {b}
                </text>
              </svg>
            </button>
          ))}
        </div>
        <div className="ec-desk" />
      </div>
      {/* the same height whatever is in it, so the bells stay where they are */}
      <div className="ec-under">
        {phase === "ready" && (
          <button className="ec-start" onClick={() => go("watch", ECHO_START)}>
            {words.start}
          </button>
        )}
        {phase === "ready" ? (
          <p className="ec-hint">{fmt(words.rule, { steps: ECHO_STEPS })}</p>
        ) : (
          phase !== "over" && (
            <p className={`ec-said${phase === "echo" ? " ec-yours" : right ? " ec-right" : ""}`} aria-live="polite">
              {phase === "echo" ? (keys ? words.yoursKeys : words.yours) : right ? words.right : words.watch}
            </p>
          )
        )}
      </div>
    </div>
  );
}

function roundOf(e: Echo, won: boolean): Round {
  const words = T.study.echo325;
  const n = remembered(e);
  return {
    won,
    result: fmt(words.result, { n }),
    verdict: won ? fmt(words.pass, { n }) : n ? fmt(words.wrong, { n }) : words.wrongFirst,
  };
}
