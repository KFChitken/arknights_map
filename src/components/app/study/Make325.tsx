"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  askHint,
  dealtPuzzle,
  lastCard,
  MAKE_GOAL,
  MAKE_HELP_MS,
  MAKE_HINTS,
  makePuzzle,
  type Op,
  OPS,
  put,
  recentPuzzles,
  type Refusal,
  restart,
  type Step,
  type Table,
  table,
  type Told,
  undo,
} from "@/lib/study/make325";
import { mulberry32 } from "@/lib/prng";
import type { GameProps, Round } from "./games";

/**
 * What the line over the cards says: how to play, the last step, why a step was refused, what one card left makes, 提示's
 * step, or how far back 325 can be made again
 */
type Said =
  | { kind: "rule" }
  | { kind: "step"; a: number; op: Op; b: number; n: number; at: number }
  | { kind: "no"; why: Refusal; at: number; k: number }
  | { kind: "left"; n: number }
  | { kind: "hint"; a: number; op: Op; b: number }
  | { kind: "stuck"; back: number; all: boolean }
  | { kind: "done"; at: number }
  | { kind: "answer" };

/**
 * 凑 325 (src/lib/study/make325.ts): a round's four numbers on cards, two by two, with + − × ÷ under them. A card, a
 * sign, another card: the two are put together into one, in the second's place, which is marked until the next step.
 * A step that divides unevenly, or takes away down to nought or below, is refused (the card shakes, when motion is not
 * turned down), and the first card and the sign stay picked. One card left: 325 passes, in the seconds it took with the page in sight; anything else is
 * said, and 撤一步 or 重来 go on. 提示 tells a step from the cards on the table (nextStep), marking its two cards and its
 * sign until the table changes, MAKE_HINTS a round: cards it told already are told again for nothing, and where 325
 * cannot be made any more it says how far back it can, for nothing too. A round passed with it passes, saying how many it
 * told. No clock; after a minute 看答案 is offered, which shows a way and ends the round unsolved. Nothing flashes.
 */
export default function Make325({ seed, onRound }: GameProps) {
  // one of the bank's this device did not deal lately, kept as dealt once the round is on
  const puzzle = useMemo(() => makePuzzle(mulberry32(seed), recentPuzzles()), [seed]);
  useEffect(() => dealtPuzzle(puzzle.k), [puzzle.k]);
  const [t, setT] = useState<Table>(() => table(puzzle.nums));
  /** The card picked first, and the sign after it */
  const [sel, setSel] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [said, setSaid] = useState<Said>({ kind: "rule" });
  const [over, setOver] = useState(false);
  const [help, setHelp] = useState(false);
  /** The steps 提示 told; and the one marked, until the table changes */
  const [hints, setHints] = useState<Told>([]);
  const [lit, setLit] = useState<Step | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  /** When the round began, and the time the page was put away since, which the seconds it took leave out */
  const startAt = useRef(0);
  const away = useRef({ since: 0, total: 0 });
  /** 看答案's wait, stopped when the round is over first; and whether it is, so it is told once */
  const helpAt = useRef(0);
  const ended = useRef(false);

  useEffect(() => {
    startAt.current = performance.now();
    helpAt.current = window.setTimeout(() => setHelp(true), MAKE_HELP_MS);
    const onVisibility = () => {
      const a = away.current;
      if (document.hidden) a.since = performance.now();
      else if (a.since) {
        a.total += performance.now() - a.since;
        a.since = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(helpAt.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const finish = (r: Round) => {
    if (ended.current) return;
    ended.current = true;
    window.clearTimeout(helpAt.current);
    setOver(true);
    setSel(null);
    setOp(null);
    setLit(null);
    roundRef.current(r);
  };

  const pick = (i: number) => {
    if (over || t.cards[i] === null) return;
    if (sel === null || op === null || sel === i) {
      // a first card, another first card instead, or the same one again to put it down
      setSel(sel === i ? null : i);
      if (sel === i) setOp(null);
      return;
    }
    const a = t.cards[sel]!;
    const b = t.cards[i]!;
    const next = put(t, sel, op, i);
    if (typeof next === "string") {
      setSaid((s) => ({ kind: "no", why: next, at: i, k: s.kind === "no" ? s.k + 1 : 0 }));
      return;
    }
    setT(next);
    setSel(null);
    setOp(null);
    setLit(null);
    const left = lastCard(next);
    if (left === null) {
      setSaid({ kind: "step", a, op, b, n: next.cards[i]!, at: i });
    } else if (left === MAKE_GOAL) {
      setSaid({ kind: "done", at: i });
      const s = Math.max(1, Math.round((performance.now() - startAt.current - away.current.total) / 1000));
      const n = hints.length;
      const w = T.study.make325;
      finish(
        n
          ? { won: true, result: fmt(w.resultHinted, { s, n }), verdict: fmt(w.passHinted, { s, n }) }
          : { won: true, result: fmt(w.result, { s }), verdict: fmt(w.pass, { s }) },
      );
    } else {
      setSaid({ kind: "left", n: left });
    }
  };
  const back = (to: Table) => {
    if (over) return;
    setT(to);
    setSel(null);
    setOp(null);
    setLit(null);
    setSaid({ kind: "rule" });
  };
  const hint = () => {
    const r = over ? null : askHint(hints, t);
    if (!r) return;
    if ("back" in r) {
      setSaid({ kind: "stuck", back: r.back, all: r.back === t.past.length });
      return;
    }
    const { step } = r;
    setHints(r.told);
    setSel(null);
    setOp(null);
    setLit(step);
    setSaid({ kind: "hint", a: t.cards[step.from]!, op: step.op, b: t.cards[step.to]! });
  };
  const showAnswer = () => {
    if (over) return;
    setSaid({ kind: "answer" });
    const w = T.study.make325;
    finish({ won: false, result: w.resultSeen, verdict: w.seen });
  };

  const w = T.study.make325;
  const line =
    said.kind === "rule"
      ? w.rule
      : said.kind === "step"
        ? fmt(w.step, { a: said.a, op: said.op, b: said.b, n: said.n })
        : said.kind === "no"
          ? w[said.why]
          : said.kind === "left"
            ? fmt(w.notYet, { n: said.n })
            : said.kind === "hint"
              ? fmt(w.told, { a: said.a, op: said.op, b: said.b })
              : said.kind === "stuck"
                ? said.back <= 1
                  ? w.stuck
                  : said.all
                    ? w.stuckAll
                    : fmt(w.stuckBack, { k: said.back })
                : said.kind === "done"
                  ? w.done
                  : fmt(w.shown, { way: puzzle.answer });
  const bad = said.kind === "no" || said.kind === "left" || said.kind === "stuck";
  const marked = (i: number) => !!lit && (lit.from === i || lit.to === i);
  return (
    <div className="mk-game" data-over={over || undefined}>
      <p
        className={`mk-said${bad ? " mk-bad" : said.kind === "done" ? " mk-good" : said.kind === "answer" ? " mk-answer" : said.kind === "hint" ? " mk-told" : ""}`}
        role="status"
      >
        {line}
      </p>
      <div className="mk-cards" role="group" aria-label={w.cardsSr}>
        {t.cards.map((n, i) =>
          n === null ? (
            <span key={i} className="mk-gone" />
          ) : (
            <button
              key={i}
              // a refusal after a refusal shakes under the other of two names, which starts the shake again
              className={`mk-card${sel === i ? " mk-sel" : ""}${marked(i) ? " mk-lit" : ""}${said.kind === "step" && said.at === i ? " mk-new" : ""}${said.kind === "done" && said.at === i ? " mk-win" : ""}${said.kind === "no" && said.at === i ? ` mk-shake${said.k % 2}` : ""}`}
              style={{ "--mk-len": String(n).length } as CSSProperties}
              aria-pressed={sel === i}
              disabled={over}
              onClick={() => pick(i)}
            >
              {n}
            </button>
          ),
        )}
      </div>
      <div className="mk-ops" role="group" aria-label={w.opsSr}>
        {OPS.map((o) => (
          <button
            key={o}
            className={`mk-op${op === o ? " mk-sel" : ""}${lit?.op === o ? " mk-lit" : ""}`}
            aria-pressed={op === o}
            disabled={over}
            onClick={() => {
              // a sign before any card: how to play again
              if (sel === null) setSaid({ kind: "rule" });
              else setOp(op === o ? null : o);
            }}
          >
            {o}
          </button>
        ))}
      </div>
      <div className="mk-tools">
        <button className="st-ghost" disabled={over || !t.past.length} onClick={() => back(undo(t))}>
          {w.undo}
        </button>
        <button className="st-ghost" disabled={over || !t.past.length} onClick={() => back(restart(t))}>
          {w.restart}
        </button>
        {hints.length < MAKE_HINTS && (
          <button className="st-ghost mk-hint" disabled={over} aria-label={fmt(w.hintSr, { n: MAKE_HINTS - hints.length })} onClick={hint}>
            {w.hint}
            <b className="mk-left" aria-hidden="true">
              {MAKE_HINTS - hints.length}
            </b>
          </button>
        )}
        {help && (
          <button className="st-ghost mk-help" disabled={over} onClick={showAnswer}>
            {w.answer}
          </button>
        )}
      </div>
    </div>
  );
}
