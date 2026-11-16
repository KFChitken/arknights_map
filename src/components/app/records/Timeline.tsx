"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import {
  DAY_INDEX,
  dayStart,
  localDay,
  RECORD_CATS,
  RECORD_DAYS,
  type RecordCat,
  type RecordsSummary,
  type TimelineItem,
  type TimelineKindFilter,
  type TimelinePage,
} from "@/lib/records";
import { BadgeImg } from "../Badges";
import { CAT, CatIcon, clockOf, dayLabel, itemDetail, itemSub, itemText } from "./parts";

/** Where the timeline starts when another tab sends the player there: one of the overview's numbers, or a day; n changes each time */
export type TimelineStart = { kind: TimelineKindFilter | null; day: number | null; n: number };
type Dir = "all" | "out" | "in";

/** A cursor just after a day's last moment: the page then starts with that day */
const dayCursor = (day: number, offset: number) => `${BigInt(dayStart(day + 1, offset)) * 1000n}|bd|0`;

export default function Timeline({
  summary: s,
  offset,
  passesOpen,
  start,
}: {
  summary: RecordsSummary;
  offset: number;
  passesOpen: boolean;
  start: TimelineStart;
  joinedAt: number;
}) {
  const t = T.records.timeline;
  const [dir, setDir] = useState<Dir>("all");
  const [cat, setCat] = useState<RecordCat | "all">("all");
  const [kind, setKind] = useState<TimelineKindFilter | null>(start.kind);
  const [from, setFrom] = useState<number | null>(start.day);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const asked = useRef(0);

  // another tab sent the player here: its number or its day
  useEffect(() => {
    setKind(start.kind);
    setFrom(start.day);
    setDir("all");
    setCat("all");
  }, [start.n, start.kind, start.day]);

  const page = useCallback(
    async (before: string | null, fresh: boolean) => {
      const n = ++asked.current;
      setBusy(true);
      setFailed(false);
      const q = new URLSearchParams({ dir, cat });
      if (kind) q.set("kind", kind);
      if (before) q.set("before", before);
      try {
        const res = await apiFetch(`/api/records/timeline?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const got = (await res.json()) as TimelinePage;
        if (n !== asked.current) return;
        setItems((list) => (fresh ? got.items : [...list, ...got.items]));
        setNext(got.next);
      } catch {
        if (n === asked.current) setFailed(true);
      } finally {
        if (n === asked.current) setBusy(false);
      }
    },
    [dir, cat, kind],
  );
  useEffect(() => {
    setItems([]);
    setNext(null);
    setOpen(new Set());
    void page(from === null ? null : dayCursor(from, offset), true);
  }, [page, from, offset]);

  const daySum = (day: number) => {
    const i = s.today - day;
    if (i < 0 || i >= RECORD_DAYS) return "";
    const d = s.days[i];
    const out = d[DAY_INDEX.outBold] + d[DAY_INDEX.outSneaky];
    const inn = d[DAY_INDEX.inBold] + d[DAY_INDEX.inSneaky];
    const said = d[DAY_INDEX.declared];
    return [out && fmt(T.records.daySum.out, { n: out }), inn && fmt(T.records.daySum.in, { n: inn }), said && fmt(T.records.daySum.declared, { n: said })]
      .filter(Boolean)
      .join(" · ");
  };

  const rows: React.ReactNode[] = [];
  let lastDay: number | null = null;
  for (const i of items) {
    const day = localDay(i.at, offset);
    if (day !== lastDay) {
      rows.push(
        <div className="rec-day" key={`d${day}`}>
          {dayLabel(day, s.today, offset)}
          <span>{daySum(day)}</span>
        </div>,
      );
      lastDay = day;
    }
    const detail = itemDetail(i, offset);
    const sub = itemSub(i, offset);
    const shown = open.has(i.key);
    rows.push(
      <button
        key={i.key}
        className="rec-ev"
        aria-expanded={detail ? shown : undefined}
        onClick={
          detail
            ? () =>
                setOpen((o) => {
                  const n = new Set(o);
                  if (!n.delete(i.key)) n.add(i.key);
                  return n;
                })
            : undefined
        }
      >
        <span className="tm">{clockOf(i.at, offset)}</span>
        {i.kind === "badge" ? (
          <span className="rec-ic" style={{ background: "#fff" }}>
            <BadgeImg id={i.badge} size={22} alt="" />
          </span>
        ) : (
          <CatIcon cat={i.cat} />
        )}
        <span className="tx">
          {itemText(i)}
          {i.kind === "decl" && i.drunk && <span className="rec-hint"> {t.drunk}</span>}
          {sub && <small>{sub}</small>}
        </span>
        <span className="ch">{detail ? "›" : ""}</span>
        {detail && shown && <div className="rec-det">{detail}</div>}
      </button>,
    );
  }

  return (
    <>
      <div className="rec-sticky">
        <div className="rec-seg" role="group">
          {(["all", "out", "in"] as Dir[]).map((d) => (
            <button key={d} aria-pressed={dir === d} onClick={() => setDir(d)}>
              {t.dirs[d]}
            </button>
          ))}
        </div>
        <div className="rec-chips" role="group">
          <button className="rec-chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>
            {t.all}
          </button>
          {RECORD_CATS.map((c) => (
            <button key={c} className="rec-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
              <i style={{ background: CAT[c].bg }} />
              {T.records.cats[c]}
            </button>
          ))}
        </div>
        {(kind || from !== null) && (
          <div className="rec-chips">
            {kind && (
              <button className="rec-chip" aria-pressed onClick={() => setKind(null)}>
                {fmt(t.only, { what: t.kinds[kind] })}
              </button>
            )}
            {from !== null && (
              <button className="rec-chip" aria-pressed onClick={() => setFrom(null)}>
                {fmt(t.only, { what: dayLabel(from, s.today, offset) })}
              </button>
            )}
          </div>
        )}
      </div>
      {rows}
      {!busy && !failed && items.length === 0 && <p className="rec-end">{t.none}</p>}
      {failed && (
        <p className="rec-end">
          {T.records.failed}{" "}
          <button className="pill" onClick={() => void page(items.length ? next : from === null ? null : dayCursor(from, offset), items.length === 0)}>
            {T.records.retry}
          </button>
        </p>
      )}
      {busy && <p className="rec-end">{T.records.loading}</p>}
      {!busy && !failed && next && (
        <button className="rec-more" onClick={() => void page(next, false)}>
          {t.more}
        </button>
      )}
      {!busy && !failed && !next && items.length > 0 && <p className="rec-end">{passesOpen ? t.endPasses : t.end}</p>}
    </>
  );
}
