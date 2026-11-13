"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import type { ChangeRow } from "@/lib/changelog";
import {
  dateParts,
  DAYS_AT_A_TIME,
  KINDS,
  kindCounts,
  type KindPick,
  type LogDay,
  logDays,
  logSquares,
  logToday,
  logTotals,
  openingDay,
} from "@/lib/changelogView";

/**
 * 更新记录, the notice board's second tab: how many changes there have been, a square for each day since the
 * site opened, and the changes day by day, newest first, with a filter by kind. A phone reads it top to
 * bottom; a wide screen has the count and the filter on the left and the days on the right, each scrolling
 * on its own (globals.css). The rows (src/lib/changelog.ts) are a file of their own, downloaded the first
 * time the tab is opened.
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
        {/* the sentence above says the numbers */}
        <div className="cl-squares" aria-hidden="true">
          {squares.map((s) => (
            <span key={s.date} className={`l${s.level}`} title={fmt(T.notices.log.square, { day: dayWords(s.date), n: s.n })} />
          ))}
        </div>
        <div className="cl-legend" aria-hidden="true">
          <span>{fmt(T.notices.log.from, { m: first.m, d: first.d })}</span>
          <span className="cl-legend-mid">{T.notices.log.squares}</span>
          <span>{T.notices.log.today}</span>
        </div>
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
