"use client";

import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  cellOf,
  holds,
  lit,
  MATCH,
  type Matches,
  matchPuzzle,
  moved,
  type Part,
  sameSpot,
  type Spot,
  spotsOf,
  writtenOf,
} from "@/lib/study/match325";
import { mulberry32 } from "@/lib/prng";
import { calmNow } from "./arena";
import type { GameProps, Round } from "./games";

/**
 * 火柴棒 325 (src/lib/study/match325.ts): a round's equation laid in matches on a board, each digit's seven places and
 * the minus's upright drawn faintly where no match is. A match tapped is picked up, raised over its place; an empty
 * place tapped then takes it; the match picked up tapped again goes back (another one tapped is picked up instead). A
 * move that makes the equation hold passes, in the seconds it took with the page in sight; one that does not shakes the
 * board (when motion is not turned down) and says 还不对, and MATCH.backMs later its match goes back. The equals and
 * the signs' bar stay put, and say so when tapped. No clock: after MATCH.hintMs 提示 is offered, which marks the digit
 * or the sign the match is taken from, and after MATCH.answerMs 看答案, which moves it there and ends the round
 * unsolved. A tap is taken by the match or the place nearest it, so a finger need not land on a thin match; the board
 * is laid in one row, or in two (X ± Y, then = Z) where the matches come out bigger so. Nothing flashes.
 */

/** A match's span (the side of a digit it lies along), drawn GAP shorter at each end, THICK wide (board units) */
const L = 10;
const GAP = 0.8;
const LONG = L - 2 * GAP;
const THICK = 1.6;
/** Room between two digits of a number, either side of a sign or the equals, round the board, between its rows */
const DIGIT_GAP = 4.2;
const SIGN_GAP = 4.8;
const PAD = 3.6;
const ROW_GAP = 6.5;
/** How far from a match or a place a tap may be and be on it (board units) */
const REACH = 5.5;
/** How long a match tapped longest is drawn (CSS px), on a big screen */
const MOST_PX = 46;
/** How far a match picked up is raised, and how long one takes to go back after a wrong move, or to move for 看答案 */
const RAISE = 1.5;
const BACK_MS = 260;
const SHOW_MS = 900;

/** A digit, the sign or the equals, and its top left corner on the board */
type Cell = ({ kind: "digit"; of: Part; i: number } | { kind: "sign" } | { kind: "equals" }) & { x: number; y: number };
type Board = { cells: Cell[]; w: number; h: number };
/** The line a match lies along, from one end to the other */
type Line = { x0: number; y0: number; x1: number; y1: number };

/** A digit's places as lines from its top left corner, in match325.ts's order: top, top right, … middle */
const PLACE_LINES: readonly Line[] = [
  { x0: 0, y0: 0, x1: L, y1: 0 },
  { x0: L, y0: 0, x1: L, y1: L },
  { x0: L, y0: L, x1: L, y1: 2 * L },
  { x0: 0, y0: 2 * L, x1: L, y1: 2 * L },
  { x0: 0, y0: L, x1: 0, y1: 2 * L },
  { x0: 0, y0: 0, x1: 0, y1: L },
  { x0: 0, y0: L, x1: L, y1: L },
];
const UPRIGHT: Line = { x0: L / 2, y0: L / 2, x1: L / 2, y1: 1.5 * L };
const BAR: Line = { x0: 0, y0: L, x1: L, y1: L };
const EQUALS: readonly Line[] = [
  { x0: 0, y0: L - 1.9, x1: L, y1: L - 1.9 },
  { x0: 0, y0: L + 1.9, x1: L, y1: L + 1.9 },
];
const shift = (l: Line, c: Cell): Line => ({ x0: l.x0 + c.x, y0: l.y0 + c.y, x1: l.x1 + c.x, y1: l.y1 + c.y });

/** The board an equation's matches lie on: in one row, or X ± Y over = Z, each row in the middle */
function boardOf(m: Matches, rows: 1 | 2): Board {
  type Kind = Omit<Cell, "x" | "y">;
  const digits = (of: Part): Kind[] => m[of].map((_, i) => ({ kind: "digit", of, i }));
  const first: Kind[] = [...digits("x"), { kind: "sign" }, ...digits("y")];
  const second: Kind[] = [{ kind: "equals" }, ...digits("z")];
  const lines = rows === 1 ? [[...first, ...second]] : [first, second];
  const gap = (a: Kind, b: Kind) => (a.kind === "digit" && b.kind === "digit" ? DIGIT_GAP : SIGN_GAP);
  const width = (line: Kind[]) => line.reduce((w, c, k) => w + L + (k ? gap(line[k - 1], c) : 0), 0);
  const w = Math.max(...lines.map(width));
  const cells: Cell[] = [];
  lines.forEach((line, r) => {
    let x = (w - width(line)) / 2;
    line.forEach((c, k) => {
      if (k) x += gap(line[k - 1], c);
      cells.push({ ...c, x, y: r * (2 * L + ROW_GAP) } as Cell);
      x += L;
    });
  });
  return { cells, w, h: lines.length * 2 * L + (lines.length - 1) * ROW_GAP };
}

const cellAt = (b: Board, s: Spot | { of: Part; i: number }): Cell =>
  b.cells.find((c) => (s.of === "sign" ? c.kind === "sign" : c.kind === "digit" && c.of === s.of && c.i === s.i))!;
const lineOf = (b: Board, s: Spot): Line => shift(s.of === "sign" ? UPRIGHT : PLACE_LINES[s.place], cellAt(b, s));
/** The matches that stay put: the sign's bar and the equals' two */
function fixedOf(b: Board): Line[] {
  const sign = b.cells.find((c) => c.kind === "sign")!;
  const equals = b.cells.find((c) => c.kind === "equals")!;
  return [shift(BAR, sign), ...EQUALS.map((l) => shift(l, equals))];
}
/** A line's middle, and its turn: lengthways, or upright */
const poseOf = (l: Line) => ({ x: (l.x0 + l.x1) / 2, y: (l.y0 + l.y1) / 2, deg: l.y0 === l.y1 ? 0 : 90 });
/** How far a point is from a line */
function reach(l: Line, x: number, y: number): number {
  const dx = l.x1 - l.x0;
  const dy = l.y1 - l.y0;
  const t = Math.max(0, Math.min(1, ((x - l.x0) * dx + (y - l.y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (l.x0 + t * dx), y - (l.y0 + t * dy));
}

/** A match, its head at its left end (at the top, upright), at a pose; or the faint place of one */
function Stick({ x, y, deg, kind = "match" }: { x: number; y: number; deg: number; kind?: "match" | "slot" | "shadow" | "held" | "won" | "shown" }) {
  const halo = kind === "held" || kind === "won" || kind === "shown";
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`}>
      {kind === "slot" ? (
        <rect className="mc-slot" x={-LONG / 2} y={-THICK / 2} width={LONG} height={THICK} rx={THICK / 2} />
      ) : kind === "shadow" ? (
        <rect className="mc-shadow" x={-LONG / 2} y={-THICK / 2} width={LONG} height={THICK} rx={THICK / 2} />
      ) : (
        <>
          {halo && <rect className={`mc-halo mc-${kind}`} x={-LONG / 2 - 1} y={-THICK / 2 - 1} width={LONG + 2} height={THICK + 2} rx={THICK / 2 + 1} />}
          <rect className="mc-wood" x={-LONG / 2} y={-THICK / 2} width={LONG} height={THICK} rx={THICK / 2} />
          <ellipse className="mc-head" cx={-LONG / 2 + 1.1} cy={0} rx={1.35} ry={1.05} />
        </>
      )}
    </g>
  );
}

/** What the line over the board says */
type Said = "rule" | "held" | "wrong" | "fixed" | "hinted" | "done" | "answer";
/** A match on its way, drawn by itself: from one place to another, the two drawn as empty meanwhile */
type Fly = { from: Spot; to: Spot; ms: number; then?: () => void };

export default function Match325({ seed, onRound }: GameProps) {
  const puzzle = useMemo(() => matchPuzzle(mulberry32(seed)), [seed]);
  const boards = useMemo(() => [boardOf(puzzle.shown, 1), boardOf(puzzle.shown, 2)] as const, [puzzle]);
  const spots = useMemo(() => spotsOf(puzzle.shown), [puzzle]);
  const [m, setM] = useState<Matches>(puzzle.shown);
  /** The match picked up, by its place */
  const [held, setHeld] = useState<Spot | null>(null);
  const [said, setSaid] = useState<Said>("rule");
  /** A wrong move on show, or the answer: no taps meanwhile */
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  /** 提示 offered (1), and 看答案 too (2); and 提示 taken */
  const [offer, setOffer] = useState(0);
  const [hinted, setHinted] = useState(false);
  /** The match a move that held put down, or 看答案's */
  const [mark, setMark] = useState<{ at: Spot; kind: "won" | "shown" } | null>(null);
  const [fly, setFly] = useState<Fly | null>(null);
  /** Wrong moves so far: the board shakes under the other of two names each time, which starts the shake again */
  const [wrongs, setWrongs] = useState(0);
  /** The room the board has (CSS px) */
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const roomRef = useRef<HTMLDivElement>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  /** When the round began, and the time the page was put away since, which the seconds it took leave out */
  const clock = useRef({ start: 0, since: 0, away: 0 });
  const backAt = useRef(0);
  const ended = useRef(false);

  const inSight = () => {
    const c = clock.current;
    const now = performance.now();
    return now - c.start - c.away - (c.since ? now - c.since : 0);
  };

  useEffect(() => {
    clock.current = { start: performance.now(), since: 0, away: 0 };
    const onVisibility = () => {
      const c = clock.current;
      if (document.hidden) c.since = performance.now();
      else if (c.since) {
        c.away += performance.now() - c.since;
        c.since = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const tick = window.setInterval(() => {
      const t = inSight();
      setOffer(t >= MATCH.answerMs ? 2 : t >= MATCH.hintMs ? 1 : 0);
    }, 500);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(tick);
      window.clearTimeout(backAt.current);
    };
  }, []);

  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const fit = () => {
      const box = el.getBoundingClientRect();
      const w = Math.floor(box.width);
      const h = Math.floor(box.height);
      setRoom((r) => (r.w === w && r.h === h ? r : { w, h }));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // one row or two, whichever draws the matches bigger
  const fits = boards.map((b) => Math.min(room.w / (b.w + 2 * PAD), room.h / (b.h + 2 * PAD)));
  const board = fits[1] > fits[0] ? boards[1] : boards[0];
  const scale = Math.max(0, Math.min(fits[1] > fits[0] ? fits[1] : fits[0], MOST_PX / LONG));

  // a match on its way: moved a frame at a time, rising a little and coming down, turning if it must; drawn where it
  // is by the frames alone, so that the page drawn again meanwhile does not put it back where it began
  const flyRef = useRef<SVGGElement | null>(null);
  const poseAt = (f: Fly, k: number) => {
    const a = poseOf(lineOf(board, f.from));
    const b = poseOf(lineOf(board, f.to));
    const e = k < 0.5 ? 2 * k * k : 1 - (2 - 2 * k) ** 2 / 2;
    const up = RAISE * Math.sin(Math.PI * k);
    return `translate(${a.x + (b.x - a.x) * e} ${a.y + (b.y - a.y) * e - up}) rotate(${a.deg + (b.deg - a.deg) * e})`;
  };
  const poseRef = useRef(poseAt);
  poseRef.current = poseAt;
  useEffect(() => {
    if (!fly) return;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / fly.ms);
      flyRef.current?.setAttribute("transform", poseRef.current(fly, k));
      if (k < 1) frame = requestAnimationFrame(step);
      else {
        setFly(null);
        fly.then?.();
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [fly]);

  const finish = (r: Round) => {
    if (ended.current) return;
    ended.current = true;
    window.clearTimeout(backAt.current);
    setOver(true);
    setHeld(null);
    roundRef.current(r);
  };

  /** A match, a place or a match that stays put tapped (by a finger near it, or a key on it) */
  const act = (s: Spot | "fixed") => {
    if (over || busy) return;
    if (s === "fixed") {
      setSaid("fixed");
      return;
    }
    if (held && sameSpot(s, held)) {
      setHeld(null);
      setSaid("rule");
    } else if (lit(m, s)) {
      setHeld(s);
      setSaid("held");
    } else if (!held) {
      setSaid("rule");
    } else {
      const before = m;
      const after = moved(m, { from: held, to: s });
      setM(after);
      setHeld(null);
      if (holds(after)) {
        setMark({ at: s, kind: "won" });
        setSaid("done");
        const secs = Math.max(1, Math.round(inSight() / 1000));
        const w = T.study.match325;
        finish({ won: true, result: fmt(w.result, { s: secs }), verdict: fmt(w.pass, { s: secs }) });
        return;
      }
      setBusy(true);
      setSaid("wrong");
      setWrongs((k) => k + 1);
      const from = held;
      backAt.current = window.setTimeout(() => {
        const back = () => {
          setM(before);
          setBusy(false);
        };
        if (calmNow()) back();
        else setFly({ from: s, to: from, ms: BACK_MS, then: back });
      }, MATCH.backMs);
    }
  };

  const showAnswer = () => {
    if (over || busy) return;
    setBusy(true);
    setHeld(null);
    setSaid("answer");
    const w = T.study.match325;
    finish({ won: false, result: w.resultSeen, verdict: w.seen });
    const done = () => {
      setM(puzzle.right);
      setMark({ at: puzzle.answer.to, kind: "shown" });
    };
    if (calmNow()) done();
    else setFly({ from: puzzle.answer.from, to: puzzle.answer.to, ms: SHOW_MS, then: done });
  };

  /** A tap on the board: on the match or the place nearest it, or on a match that stays put, if near enough */
  const onTap = (e: MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const x = ((e.clientX - box.left) / box.width) * (board.w + 2 * PAD) - PAD;
    const y = ((e.clientY - box.top) / box.height) * (board.h + 2 * PAD) - PAD;
    let best: Spot | "fixed" | null = null;
    let near = REACH;
    for (const s of spots) {
      const d = reach(lineOf(board, s), x, y);
      if (d < near) {
        best = s;
        near = d;
      }
    }
    for (const l of fixedOf(board)) {
      const d = reach(l, x, y);
      if (d < near) {
        best = "fixed";
        near = d;
      }
    }
    if (best) act(best);
  };
  const onKey = (e: KeyboardEvent, s: Spot) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    act(s);
  };

  const w = T.study.match325;
  const line = said === "answer" ? fmt(w.shown, { eq: writtenOf(puzzle.right) }) : w[said];
  const marked = hinted && !over ? cellOf(puzzle.answer.from) : null;
  const hidden = (s: Spot) => !!fly && (sameSpot(s, fly.from) || sameSpot(s, fly.to));
  const canPick = !over && !busy;
  let digitNo = 0;
  return (
    <div className="mc-game" data-over={over || undefined}>
      <p className={`mc-said${said === "wrong" ? " mc-bad" : said === "done" ? " mc-good" : said === "answer" ? " mc-answer" : ""}`} role="status">
        {line}
      </p>
      <div ref={roomRef} className="mc-room">
        {scale > 0 && (
          <svg
            className={`mc-board${held ? " mc-holding" : ""}${wrongs ? ` mc-shake${wrongs % 2}` : ""}`}
            viewBox={`${-PAD} ${-PAD} ${board.w + 2 * PAD} ${board.h + 2 * PAD}`}
            width={(board.w + 2 * PAD) * scale}
            height={(board.h + 2 * PAD) * scale}
            role="group"
            aria-label={fmt(w.boardSr, { eq: writtenOf(m) })}
            onClick={onTap}
          >
            <rect className="mc-panel" x={-PAD} y={-PAD} width={board.w + 2 * PAD} height={board.h + 2 * PAD} rx={3} />
            {marked &&
              ((c) =>
                marked.of === "sign" ? (
                  <rect className="mc-cell" x={c.x - 2.4} y={c.y + L / 2 - 2.4} width={L + 4.8} height={L + 4.8} rx={2} />
                ) : (
                  <rect className="mc-cell" x={c.x - 2.4} y={c.y - 2.4} width={L + 4.8} height={2 * L + 4.8} rx={2} />
                ))(cellAt(board, marked))}
            {fixedOf(board).map((l, k) => (
              <Stick key={`f${k}`} {...poseOf(l)} />
            ))}
            {spots.map((s) => {
              const p = poseOf(lineOf(board, s));
              const on = lit(m, s) && !hidden(s);
              const isHeld = !!held && sameSpot(s, held);
              const isMark = !!mark && sameSpot(s, mark.at) && on;
              if (s.of !== "sign" && s.place === 0) digitNo++;
              const where = s.of === "sign" ? w.signSr : fmt(w.digitSr, { n: digitNo, place: w.places[s.place] });
              // a key reaches the matches while none is picked up, then the empty places and the one picked up
              const reachable = canPick && (held ? !on || isHeld : on);
              return (
                <g
                  key={s.of === "sign" ? "sign" : `${s.of}${s.i}-${s.place}`}
                  className="mc-spot"
                  role="button"
                  tabIndex={reachable ? 0 : -1}
                  aria-label={fmt(w.spotSr, { where, state: on ? w.litSr : w.emptySr })}
                  aria-pressed={isHeld || undefined}
                  aria-disabled={!reachable || undefined}
                  onKeyDown={(e) => onKey(e, s)}
                >
                  <rect className="mc-ring" x={p.x - LONG / 2 - 1.4} y={p.y - THICK / 2 - 1.4} width={LONG + 2.8} height={THICK + 2.8} rx={2} transform={p.deg ? `rotate(90 ${p.x} ${p.y})` : undefined} />
                  {on && !isHeld ? <Stick {...p} kind={isMark ? mark.kind : "match"} /> : <Stick {...p} kind={isHeld ? "shadow" : "slot"} />}
                </g>
              );
            })}
            {held && ((p) => <Stick x={p.x - 0.4} y={p.y - RAISE} deg={p.deg} kind="held" />)(poseOf(lineOf(board, held)))}
            {fly && (
              <g
                ref={(el) => {
                  flyRef.current = el;
                  if (el && !el.getAttribute("transform")) el.setAttribute("transform", poseAt(fly, 0));
                }}
              >
                <Stick x={0} y={0} deg={0} kind={said === "answer" ? "shown" : "match"} />
              </g>
            )}
          </svg>
        )}
      </div>
      <div className="mc-tools">
        {offer >= 1 && !hinted && (
          <button
            className="st-ghost mc-help"
            disabled={over || busy}
            onClick={() => {
              setHinted(true);
              setSaid("hinted");
            }}
          >
            {w.hint}
          </button>
        )}
        {offer >= 2 && (
          <button className="st-ghost mc-help" disabled={over || busy} onClick={showAnswer}>
            {w.answer}
          </button>
        )}
      </div>
    </div>
  );
}
