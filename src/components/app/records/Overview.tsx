"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { BADGES, badgeTotal, nearBadges } from "@/lib/badges";
import { CATALOG_SIZE } from "@/lib/passCatalog";
import { displayName } from "@/lib/profile";
import { DAY_INDEX, localDay, RECORD_DAYS, RECORDS_FROM, type DayField, type RecordsSummary, type TimelineKindFilter } from "@/lib/records";
import type { Me } from "@/lib/world/types";
import { BadgeImg } from "../Badges";
import { NEXT } from "../Homecoming";
import RoachIcon from "../../RoachIcon";
import type { ChartId } from "./Charts";
import { CatIcon, clockOf, dateOf, slotName, type CAT } from "./parts";

/** A number over the last `days` days of the summary */
export function sumOf(s: RecordsSummary, fields: DayField[], days = RECORD_DAYS) {
  let n = 0;
  for (let i = 0; i < days && i < s.days.length; i++) for (const f of fields) n += s.days[i][DAY_INDEX[f]];
  return n;
}

type Narrative = { cat: keyof typeof CAT; head: string; says: string; then?: string; viz?: ReactNode; chart?: ChartId };

/** 数据解说: a card for each thing the player's own numbers say enough of */
function narratives(me: Me, s: RecordsSummary, offset: number, passes: RecordsSummary["passes"]): Narrative[] {
  const o = T.records.overview;
  const out: Narrative[] = [];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  const hours = s.hours[2];
  const own = hours.reduce((a, b) => a + b, 0);
  if (own >= 10) {
    const night = [22, 23, 0, 1, 2, 3].reduce((a, h) => a + hours[h], 0);
    const late = [0, 1, 2, 3].reduce((a, h) => a + hours[h], 0);
    const p = pct(night, own);
    const max = Math.max(...hours, 1);
    out.push({
      cat: "touch",
      head: o.hoursK,
      says: p >= 30 ? fmt(o.nightOwl, { p }) : fmt(o.dayPerson, { p }),
      then: late ? fmt(o.lateNights, { n: late }) : undefined,
      chart: "hours",
      viz: (
        <svg viewBox="0 0 240 34" aria-hidden="true">
          {hours.map((v, h) => (
            <rect key={h} x={h * 10 + 1} y={32 - (v / max) * 30} width="8" height={Math.max(1.5, (v / max) * 30)} rx="2" fill={h >= 22 || h < 4 ? "#1b1d22" : "#d9dce2"} />
          ))}
        </svg>
      ),
    });
  }

  const bold = sumOf(s, ["outBold"]);
  const sent = bold + sumOf(s, ["outSneaky"]);
  if (sent >= 5) {
    const p = pct(bold, sent);
    out.push({
      cat: "touch",
      head: o.boldK,
      says: p >= 50 ? fmt(o.boldFan, { p }) : fmt(o.sneakyFan, { p: 100 - p }),
      then: fmt(o.boldBacks, { n: sumOf(s, ["backBold"]) }),
      chart: "touch",
      viz: (
        <div className="rec-stack" aria-hidden="true">
          <i style={{ width: `${p}%`, background: "#ffd23f" }} />
          <i style={{ width: `${100 - p}%`, background: "#c9ccd3" }} />
        </div>
      ),
    });
  }

  const slots = (["inMain", "inClone1", "inClone2", "inClone3"] as DayField[]).map((f) => sumOf(s, [f]));
  const got = sumOf(s, ["inBold", "inSneaky"]);
  if (got >= 5) {
    const clone = [1, 2, 3].sort((a, b) => slots[b] - slots[a])[0];
    out.push({
      cat: "roach",
      head: o.popularK,
      says: fmt(o.popular, { n: got, main: slots[0] }),
      then: slots[clone] ? fmt(o.popularClone, { k: clone, n: slots[clone] }) : undefined,
      chart: "touch",
      viz: <SlotBar slots={slots} />,
    });
  }

  const top = s.lines.find((l) => l[3] > 0);
  if (top) {
    const rx = [...s.reactionsIn].sort((a, b) => b[3] - a[3]);
    const total = sumOf(s, ["reactedIn"]);
    out.push({
      cat: "declare",
      head: o.linesK,
      says: fmt(o.topLine, { line: top[0], n: top[3] }),
      then: rx[0] ? fmt(o.reactionsGot, { n: total, rx: rx[0][0], m: rx[0][3] }) : o.noReactions,
      chart: "decl",
      viz: rx.length ? (
        <div className="rec-rxs">
          {rx.slice(0, 3).map(([w, , , n]) => (
            <span key={w}>
              {w}
              <b>{n}</b>
            </span>
          ))}
        </div>
      ) : undefined,
    });
  }

  const best = s.friends
    .map((f) => ({ f, total: f.touch[2] + f.gest[2] + f.poke[2] }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)[0];
  if (best) {
    out.push({
      cat: "friend",
      head: o.friendK,
      says: fmt(o.bestFriend, { name: best.f.name, touch: best.f.touch[2], gest: best.f.gest[2] }),
      then: fmt(o.friendsSince, { day: dateOf(best.f.since, offset) }),
      chart: "friends",
    });
  }

  if (s.drinks.length) {
    // the latest in the night: from 18:00 on to 06:00
    const night = (at: number) => (localMinutes(at, offset) + 1440 - 18 * 60) % 1440;
    const latest = [...s.drinks].sort((a, b) => night(b.at) - night(a.at))[0];
    const woke = s.drinks.filter((d) => d.soberAt !== null).length;
    out.push({
      cat: "drink",
      head: o.drinkK,
      says: fmt(o.drinks, { n: me.counts.drinks, day: dateOf(latest.at, offset), time: clockOf(latest.at, offset) }),
      then: woke ? fmt(o.drinksSober, { n: woke }) : undefined,
      chart: "drink",
    });
  }

  if (me.counts.amiyaDays > 0) {
    out.push({ cat: "guide", head: o.guideK, says: fmt(o.amiyaDays, { n: me.counts.amiyaDays }), then: nextOf(me, "amiyaDays") });
  }
  if (passes) {
    out.push({
      cat: "harvest",
      head: o.passK,
      says: fmt(o.passes, { draws: passes.draws, chars: passes.chars, wish: passes.wish }),
      then: fmt(o.passesMore, { laser: passes.laser, gold: passes.gold }),
    });
  }
  if (me.counts.farMoves > 0) {
    out.push({ cat: "roach", head: o.movesK, says: fmt(o.farMoves, { n: me.counts.farMoves }), then: nextOf(me, "farMoves") });
  }
  return out;
}

const localMinutes = (at: number, offset: number) => Math.floor((((at + offset * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);

/** 「再 n 次就是…」 for the next badge of one count, if there is one still to earn */
function nextOf(me: Me, count: "amiyaDays" | "farMoves") {
  const next = BADGES.filter((b) => b.goal?.count === count && !me.badges.some((e) => e.id === b.id)).sort((a, b) => a.goal!.n - b.goal!.n)[0];
  if (!next?.goal) return undefined;
  const more = next.goal.n - me.counts[count];
  return more > 0 ? NEXT[count](more, next.name) : undefined;
}

export function SlotBar({ slots }: { slots: number[] }) {
  const total = slots.reduce((a, b) => a + b, 0) || 1;
  const colors = ["#1b1d22", "#5be37d", "#3fd0d4", "#b48cff"];
  return (
    <>
      <div className="rec-stack">
        {slots.map((v, i) => (
          <i key={i} style={{ width: `${(v / total) * 100}%`, background: colors[i] }} />
        ))}
      </div>
      <div className="rec-legend">
        {slots.map((v, i) => (
          <span key={i}>
            <i style={{ background: colors[i] }} />
            {slotName(i)} <b>{v}</b>
          </span>
        ))}
      </div>
    </>
  );
}

export default function Overview({
  me,
  summary: s,
  offset,
  passesOpen,
  onTile,
  onChart,
  onSeen,
  onOpenBadges,
}: {
  me: Me;
  summary: RecordsSummary;
  offset: number;
  passesOpen: boolean;
  onTile: (kind: TimelineKindFilter) => void;
  onChart: (id: ChartId) => void;
  onSeen: () => void;
  onOpenBadges: () => void;
}) {
  const o = T.records.overview;
  const cards = narratives(me, s, offset, passesOpen ? s.passes : undefined);
  const near = nearBadges(me.badges, me.counts, 3);
  const opened = s.today - localDay(RECORDS_FROM, offset) + 1;
  const joined = s.today - localDay(me.joinedAt, offset) + 1;
  const tiles: [TimelineKindFilter, number][] = [
    ["tout", sumOf(s, ["outBold", "outSneaky"])],
    ["tin", sumOf(s, ["inBold", "inSneaky"])],
    ["decl", sumOf(s, ["declared"])],
    ["rxout", sumOf(s, ["reactedOut"])],
  ];
  const u = o.units;
  const r = o.rows;
  const passes = passesOpen ? s.passes : undefined;
  const groups: [string, [string, string, ReactNode?][]][] = [
    [
      o.groups.social,
      [
        [r.friendsEver, fmt(u.people, { n: me.counts.friends })],
        [r.quilters, fmt(u.people, { n: me.counts.quilters })],
        [r.touchesOut, fmt(u.times, { n: s.totals.touchesOut })],
        [r.touchesIn, fmt(u.times, { n: s.totals.touchesIn })],
      ],
    ],
    [
      o.groups.declare,
      [
        [r.declareDays, fmt(u.days, { n: me.counts.declareDays })],
        [r.declareLines, fmt(u.lines, { n: me.counts.declareLines })],
        [r.declarations, fmt(u.items, { n: s.totals.declarations })],
        [r.reactDays, fmt(u.days, { n: me.counts.reactDays })],
      ],
    ],
    [o.groups.drink, [[r.drinks, fmt(u.times, { n: me.counts.drinks })]]],
    [
      o.groups.guide,
      [
        [r.amiyaDays, fmt(u.days, { n: me.counts.amiyaDays })],
        [r.perlicaDays, fmt(u.days, { n: me.counts.perlicaDays })],
        [r.siStamps, fmt(u.stamps, { n: s.totals.siStamps })],
      ],
    ],
    [
      o.groups.map,
      [
        [r.radarDays, fmt(u.days, { n: me.counts.radarDays })],
        [r.farMoves, fmt(u.times, { n: me.counts.farMoves })],
        [r.fireNights, fmt(u.days, { n: me.counts.fireNights })],
        [r.sneakDays, fmt(u.days, { n: me.counts.sneakDays })],
      ],
    ],
    ...(passes
      ? ([
          [
            o.groups.passes,
            [
              [r.draws, fmt(u.times, { n: passes.draws })],
              [r.chars, fmt(u.ofPeople, { n: passes.chars, all: CATALOG_SIZE })],
              [r.wish, fmt(u.times, { n: passes.wish })],
              [r.laser, fmt(u.people, { n: passes.laser })],
              [r.gold, fmt(u.cards, { n: passes.gold })],
            ],
          ],
        ] as [string, [string, string, ReactNode?][]][])
      : []),
    [o.groups.study, [[r.studyDays, fmt(u.days, { n: s.totals.studyDays })]]],
    [
      o.groups.badges,
      [
        [
          r.badges,
          fmt(u.of, { n: me.badges.length, all: badgeTotal(me.badges, Boolean(me.haimao), Boolean(me.study)) }),
          <button key="b" onClick={onOpenBadges}>
            {o.links.badges}
          </button>,
        ],
      ],
    ],
  ];

  // which card of 数据解说 is in view, for its dots
  const strip = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState(0);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onScroll = () => {
      const first = el.firstElementChild as HTMLElement | null;
      const step = first ? first.offsetWidth + 10 : el.clientWidth;
      setCard(Math.round(el.scrollLeft / Math.max(1, step)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <div className="rec-hero">
        <div className="rec-hero-top">
          <RoachIcon color={me.profile.color} size={44} avatar={me.profile.avatar} />
          <div>
            <strong>{displayName(me.profile)}</strong>
            <div className="sub">
              {fmt(o.joined, { n: joined })} · {fmt(o.visited, { n: s.totals.visitDays })}
            </div>
          </div>
        </div>
        <div className="rec-tiles">
          {tiles.map(([kind, n]) => (
            <button key={kind} className="rec-tile" onClick={() => onTile(kind)}>
              <b>{n.toLocaleString("en-US")}</b>
              <span>{o.tiles[kind]} ›</span>
            </button>
          ))}
        </div>
        <div className="rec-range">{opened < RECORD_DAYS ? fmt(o.rangeYoung, { n: opened }) : o.range}</div>
      </div>

      {cards.length > 0 && (
        <>
          <div className="rec-h3">
            {o.narr}
            {cards.length > 1 && <span className="more">{o.swipe}</span>}
          </div>
          <div className="rec-cards" ref={strip}>
            {cards.map((n, i) => (
              <button key={i} className="rec-nar" onClick={n.chart ? () => onChart(n.chart!) : undefined} disabled={!n.chart}>
                <span className="k">
                  <CatIcon cat={n.cat} size={18} />
                  {n.head}
                </span>
                <span className="s">{n.says}</span>
                {n.then && <span className="t">{n.then}</span>}
                {n.viz}
                {n.chart && <span className="go">{o.toCharts}</span>}
              </button>
            ))}
          </div>
          {cards.length > 1 && (
            <div className="rec-dots" aria-hidden="true">
              {cards.map((_, i) => (
                <i key={i} className={i === Math.min(card, cards.length - 1) ? "on" : ""} />
              ))}
            </div>
          )}
        </>
      )}

      {near.length > 0 && (
        <>
          <div className="rec-h3">
            {o.near}
            <button className="more" onClick={onOpenBadges}>
              {o.all}
            </button>
          </div>
          <div className="rec-next">
            {near.map((b) => (
              <div key={b.id}>
                <BadgeImg id={b.id} size={26} alt="" />
                <b>
                  {b.name}{" "}
                  <span className="rec-hint" style={{ fontWeight: 400 }}>
                    {b.have}/{b.need}
                  </span>
                </b>
                <div className="rec-bar">
                  <i style={{ width: `${Math.min(100, (b.have / b.need) * 100)}%` }} />
                </div>
                <div className="rec-hint">{NEXT[b.count](b.more, b.name)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rec-h3">
        {o.total}
        <span className="more" style={{ fontSize: 12 }}>
          {fmt(o.totalFrom, { day: dateOf(Math.max(RECORDS_FROM, me.joinedAt), offset) })}
        </span>
      </div>
      <div className="rec-life">
        {groups.map(([g, rows]) => (
          <div key={g}>
            <div className="g">{g}</div>
            {rows.map(([t, v, link]) => (
              <div className="r" key={t}>
                <span>{t}</span>
                <b>{v}</b>
                {link}
              </div>
            ))}
          </div>
        ))}
      </div>

      <button className="link-row" style={{ marginTop: 10 }} onClick={onSeen}>
        <span>
          {o.seen}
          <small className="link-row-hint">{o.seenHint}</small>
        </span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </button>
      <div className="rec-note">{passesOpen ? o.notePasses : o.note}</div>
    </>
  );
}
