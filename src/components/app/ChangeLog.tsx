"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { fmt, T } from "@/i18n";
import type { ChangeRow } from "@/lib/changelog";
import {
  dateParts,
  DAYS_AT_A_TIME,
  KINDS,
  keySlide,
  kindCounts,
  type KindPick,
  type LogDay,
  logDays,
  logSquares,
  logToday,
  logTotals,
  openingDay,
  type Square,
  type StripAt,
  stripEnds,
  wheelAside,
} from "@/lib/changelogView";

/**
 * 更新记录, the notice board's second tab: how many changes there have been, a square for each day since the
 * site opened (in one row, which slides), and the changes day by day, newest first, with a filter by kind. A
 * phone reads it top to bottom; a wide screen has the count and the filter on the left and the days on the
 * right, each scrolling on its own (globals.css). The rows (src/lib/changelog.ts) are a file of their own,
 * downloaded the first time the tab is opened.
 */

const PICKS: readonly KindPick[] = ["all", ...KINDS];
const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
/** How far below what can be seen the next days are drawn already */
const AHEAD_PX = 600;

/** The rows once downloaded, for as long as the page is open */
let downloaded: readonly ChangeRow[] | null = null;

/** The tab: 「正在打开…」 until the rows are here; if they cannot be had, a way to try again, and then to reload the page */
export default function ChangeLogTab() {
  const [rows, setRows] = useState(downloaded);
  const [failures, setFailures] = useState(0);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (rows) return;
    let gone = false;
    import("@/lib/changelog").then(
      (m) => {
        downloaded = m.CHANGELOG;
        if (!gone) setRows(downloaded);
      },
      () => !gone && setFailures((n) => n + 1),
    );
    return () => {
      gone = true;
    };
  }, [rows, tries]);
  if (rows) return <ChangeLog rows={rows} today={logToday(rows)} />;
  if (failures > tries)
    return (
      <p className="cl-wait">
        {/* a second time, it is most likely a newer version of the site, which only a reload brings */}
        <button className="cl-retry" onClick={() => (tries ? window.location.reload() : setTries(1))}>
          {T.map.bar.retry}
        </button>
      </p>
    );
  return <p className="cl-wait">{T.notices.log.loading}</p>;
}

const dayWords = (date: string) => {
  const { m, d } = dateParts(date);
  return fmt(T.lib.beijing.dayWords, { m, d });
};

/** The nearest box around el that scrolls: the board's body on a phone, the list's own side on a wide screen */
function scrollerOf(el: Element) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * The log itself, for these rows and this day in Beijing: the newest DAYS_AT_A_TIME days with changes,
 * and as many again each time the list nears its end. The filter and how many days are drawn first may be
 * given, for the tests.
 */
export function ChangeLog({
  rows,
  today,
  firstPick = "all",
  firstDays = DAYS_AT_A_TIME,
}: {
  rows: readonly ChangeRow[];
  today: string;
  firstPick?: KindPick;
  firstDays?: number;
}) {
  const [pick, setPick] = useState(firstPick);
  const [shown, setShown] = useState(firstDays);
  const totals = useMemo(() => logTotals(rows, today), [rows, today]);
  const squares = useMemo(() => logSquares(rows, today), [rows, today]);
  const counts = useMemo(() => kindCounts(rows), [rows]);
  const days = useMemo(() => logDays(rows, pick), [rows, pick]);
  const mainRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    let asked = false;
    const near = () => {
      const box = asked ? null : scrollerOf(end);
      if (!box || end.getBoundingClientRect().top > box.getBoundingClientRect().bottom + AHEAD_PX) return;
      asked = true;
      setShown((n) => n + DAYS_AT_A_TIME);
    };
    near();
    // scrolling does not bubble: the board hears it from either box as it goes down
    const sheet = end.closest(".sheet");
    sheet?.addEventListener("scroll", near, { capture: true, passive: true });
    window.addEventListener("resize", near);
    return () => {
      sheet?.removeEventListener("scroll", near, { capture: true });
      window.removeEventListener("resize", near);
    };
  }, [shown, days]);

  const choose = (k: KindPick) => {
    setPick(k);
    setShown(DAYS_AT_A_TIME);
    // on a wide screen the list scrolls on its own, beside the filter
    mainRef.current?.scrollTo?.({ top: 0 });
  };
  const first = dateParts(openingDay(rows));

  return (
    <div className="cl">
      <div className="cl-side">
        <div className="cl-sum">
          <p className="cl-total">
            <strong>{totals.total}</strong>
            <span>{T.notices.log.total}</span>
            <span className="cl-open">{fmt(T.notices.log.daysOpen, { n: totals.daysOpen })}</span>
          </p>
          <p className="cl-week">{fmt(T.notices.log.lastWeek, { n: totals.lastWeek })}</p>
          <p className="cl-week-wide">{fmt(T.notices.log.lastWeekWide, { days: totals.daysOpen, n: totals.lastWeek })}</p>
        </div>
        <div className="cl-picks">
          {PICKS.map((k) => (
            <button key={k} aria-pressed={pick === k} onClick={() => choose(k)}>
              <span className="pill">
                {k === "all" ? T.notices.log.all : T.notices.log.kinds[k]}
                <span className="n">{counts[k]}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="cl-about">{T.notices.log.about}</p>
      </div>
      <div className="cl-main" ref={mainRef}>
        <Squares squares={squares} from={fmt(T.notices.log.from, { m: first.m, d: first.d })} />
        {days.slice(0, shown).map((day) => (
          <Day key={day.date} day={day} filtered={pick !== "all"} />
        ))}
        {shown < days.length ? (
          <div className="cl-more" ref={endRef} />
        ) : (
          <p className="cl-end">
            <span>{fmt(T.notices.log.oldest, { day: dayWords(openingDay(rows)) })}</span>
            <span className="cl-end-bj">{T.notices.log.beijing}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** Sliding as the reader asks it to, without the motion when they would rather have none */
const glide = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
/** Where the row of squares stands in its box */
const stripAt = (el: HTMLElement): StripAt => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth });
/** A week of squares, as wide as they are drawn on this screen */
function weekOf(el: HTMLElement) {
  const [a, b] = el.querySelectorAll<HTMLElement>(".cl-days span");
  return 7 * (a && b ? b.offsetLeft - a.offsetLeft : 15);
}

/**
 * A square for each day, in one row however many there are: it starts at today, at the right, and slides back
 * to earlier days with a finger, a drag of the mouse, the wheel, ← → Home End once it has the focus, or
 * 「‹ 往期」 under it; 「今天 ›」 brings today back. A side with more days fades out. Under either end, the first
 * day and today while they show (as on one line before). The squares say nothing to a screen reader: the
 * sentence above has the numbers.
 */
function Squares({ squares, from }: { squares: Square[]; from: string }) {
  const strip = useRef<HTMLDivElement>(null);
  // before it is measured (and drawn by the server, for the tests) as if it all fitted
  const [ends, setEnds] = useState({ start: true, end: true });
  const [dragging, setDragging] = useState(false);
  /** Today is kept in view, as the window or the board changes size, until the reader slides away from it */
  const atToday = useRef(true);
  const drag = useRef<{ id: number; x: number; left: number } | null>(null);

  const look = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const now = stripEnds(stripAt(el));
    atToday.current = now.end;
    setEnds((was) => (was.start === now.start && was.end === now.end ? was : now));
  }, []);

  // at today first, before it is drawn, and again when the size changes while today is in view
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const keep = () => {
      if (atToday.current) el.scrollLeft = el.scrollWidth;
      look();
    };
    keep();
    const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keep);
    sized?.observe(el);
    return () => sized?.disconnect();
  }, [squares.length, look]);

  // the wheel's own listener, as only one that is not passive can keep the page from scrolling too
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const move = wheelAside(e.deltaX * unit, e.deltaY * unit, stripAt(el));
      if (!move) return;
      e.preventDefault();
      el.scrollLeft += move;
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const slideTo = (left: number) => strip.current?.scrollTo({ left, behavior: glide() });

  // a finger or a pen slides it as the browser does; a mouse drags it
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || (ends.start && ends.end)) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (Math.abs(e.clientX - d.x) > 3) setDragging(true);
    e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
  };
  const up = () => {
    drag.current = null;
    setDragging(false);
  };

  const slides = !(ends.start && ends.end);
  return (
    <>
      <div className={`cl-strip${ends.start ? "" : " more-left"}${ends.end ? "" : " more-right"}`}>
        <div
          ref={strip}
          className={`cl-squares${slides ? " slides" : ""}${dragging ? " dragging" : ""}`}
          role="group"
          aria-label={T.notices.log.strip}
          tabIndex={0}
          onScroll={look}
          onKeyDown={(e) => {
            const to = keySlide(e.key, stripAt(e.currentTarget), weekOf(e.currentTarget));
            if (to === null) return;
            e.preventDefault();
            slideTo(to);
          }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
        >
          <div className="cl-days" aria-hidden="true">
            {squares.map((s) => (
              <span key={s.date} className={`l${s.level}`} title={fmt(T.notices.log.square, { day: dayWords(s.date), n: s.n })} />
            ))}
          </div>
        </div>
      </div>
      {/* under the ends: the first day and today while they show, else the way to earlier days and back */}
      <div className="cl-legend" aria-hidden="true">
        {ends.start ? (
          <span>{from}</span>
        ) : (
          <button
            className="cl-slide"
            tabIndex={-1}
            onClick={() => {
              const el = strip.current;
              // a boxful back, two days of it kept in view
              if (el) slideTo(Math.max(0, el.scrollLeft - Math.max(weekOf(el), el.clientWidth - (2 * weekOf(el)) / 7)));
            }}
          >
            {T.notices.log.earlier}
          </button>
        )}
        <span className="cl-legend-mid">{T.notices.log.squares}</span>
        {ends.end ? (
          <span>{T.notices.log.today}</span>
        ) : (
          <button className="cl-slide" tabIndex={-1} onClick={() => strip.current && slideTo(strip.current.scrollWidth)}>
            {T.notices.log.backToToday}
          </button>
        )}
      </div>
    </>
  );
}

/** One day: its date and day of the week, 「开张」 on the first, how many changes; then its lines */
function Day({ day, filtered }: { day: LogDay; filtered: boolean }) {
  return (
    <section className="cl-day">
      <div className="cl-day-head">
        <h3>{dayWords(day.date)}</h3>
        <span className="cl-weekday">{T.notices.log.weekday[WEEK[dateParts(day.date).weekday]]}</span>
        {day.opening && <span className="cl-opening">{T.notices.log.opening}</span>}
        <span className="cl-count">{fmt(filtered ? T.notices.log.dayRows : T.notices.log.dayTimes, { n: day.count })}</span>
      </div>
      <ul className="cl-lines">
        {day.lines.map((l) => (
          <li key={l.hi} className={l.vague ? "vague" : undefined}>
            <span className="no">{l.lo === l.hi ? `#${l.hi}` : `#${l.lo}–${l.hi}`}</span>
            <span className={`kind ${l.kind}`}>{T.notices.log.kinds[l.kind]}</span>
            <span className="t">{l.lo === l.hi ? l.text : fmt(T.notices.log.folded, { text: l.text, n: l.hi - l.lo + 1 })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
