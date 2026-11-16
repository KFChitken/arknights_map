"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { DAY_INDEX, dayStart, localDay, RANGES, RECORDS_FROM, type DayField, type Range, type RecordsSummary } from "@/lib/records";
import { sumOf, SlotBar } from "./Overview";
import { CatIcon, dateOf, dayLabel } from "./parts";

/** The charts the overview's cards point at */
export type ChartId = "days" | "hours" | "touch" | "decl" | "friends" | "drink";

/** Everything done on a day, by anyone, for 每天的动静 (not the parts of what is counted already) */
const ACTIVITY: DayField[] = ["outBold", "outSneaky", "inBold", "inSneaky", "declared", "reactedOut", "reactedIn", "gestures", "pokes", "drinks", "guides", "moves", "badges", "draws", "gifts"];
const W = 320;
const GREY = "#6b7280";

export default function Charts({
  summary: s,
  offset,
  focus,
  onDay,
}: {
  summary: RecordsSummary;
  offset: number;
  focus: { id: ChartId; n: number } | null;
  onDay: (day: number) => void;
}) {
  const c = T.records.charts;
  const [range, setRange] = useState<Range>(30);
  const [heatDay, setHeatDay] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [barDay, setBarDay] = useState<number | null>(null);
  const ri = RANGES.indexOf(range);
  const from = s.today - (range - 1);
  const at = (day: number, f: DayField) => {
    const i = s.today - day;
    return i >= 0 && i < s.days.length ? s.days[i][DAY_INDEX[f]] : 0;
  };
  const opened = s.today - localDay(RECORDS_FROM, offset) + 1;

  // the card that sent the player here: its chart in view
  const refs = useRef<Partial<Record<ChartId, HTMLDivElement | null>>>({});
  useEffect(() => {
    if (focus) refs.current[focus.id]?.scrollIntoView({ block: "start" });
  }, [focus]);
  const box = (id: ChartId) => (el: HTMLDivElement | null) => void (refs.current[id] = el);

  // 每天的动静: weeks from Monday, the days before the range only outlined
  const monday = (day: number) => (day + 3) % 7;
  const first = from - monday(from);
  const weeks = Math.ceil((s.today - first + 1) / 7);
  const gap = 4;
  const cell = (W - gap * 6) / 7;
  const ch = Math.min(cell * 0.72, 30);
  const heatH = 16 + weeks * (ch + gap);
  const activity = (day: number) => ACTIVITY.reduce((a, f) => a + at(day, f), 0);
  let maxDay = 1;
  for (let d = from; d <= s.today; d++) maxDay = Math.max(maxDay, activity(d));
  const heat = (n: number) => {
    const p = n / maxDay;
    return n === 0 ? "#f1f2f4" : p <= 0.2 ? "#fff1b8" : p <= 0.4 ? "#ffe066" : p <= 0.6 ? "#ffc61a" : p <= 0.8 ? "#ff9f1a" : "#e8590c";
  };
  const dateNo = (day: number) => {
    const d = new Date(day * 86_400_000);
    return d.getUTCDate() === 1 ? `${d.getUTCMonth() + 1}/1` : String(d.getUTCDate());
  };
  const daySay = (day: number) => {
    const say = c.daySay;
    const parts = [
      [at(day, "outBold") + at(day, "outSneaky"), say.out],
      [at(day, "inBold") + at(day, "inSneaky"), say.in],
      [at(day, "declared"), say.declared],
      [at(day, "reactedOut"), say.reactedOut],
      [at(day, "gestures") + at(day, "pokes") + at(day, "gifts"), say.gestures],
      [at(day, "drinks"), say.drinks],
      [at(day, "draws"), say.draws],
    ] as [number, string][];
    return parts
      .filter(([n]) => n)
      .map(([n, w]) => fmt(w, { n }))
      .join(T.records.comma);
  };

  // 几点最活跃
  const hours = s.hours[ri];
  const hourMax = Math.max(...hours, 1);
  const hourTotal = hours.reduce((a, b) => a + b, 0);
  const peak = hours.indexOf(Math.max(...hours));
  const shownHour = hour ?? peak;
  const RH = 230;
  const cx = W / 2;
  const cy = RH / 2;
  const r0 = 26;
  const r1 = Math.min(cx, cy) - 20;
  const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;

  // 碰与被碰
  const days: number[] = [];
  for (let d = from; d <= s.today; d++) days.push(d);
  const half = 60;
  const bw = W / days.length;
  const tallest = Math.max(1, ...days.map((d) => Math.max(at(d, "outBold") + at(d, "outSneaky"), at(d, "inBold") + at(d, "inSneaky"))));
  const k = half / tallest;
  const mid = 6 + half;
  const sent = sumOf(s, ["outBold", "outSneaky"], range);
  const sentBold = sumOf(s, ["outBold"], range);
  const slots = (["inMain", "inClone1", "inClone2", "inClone3"] as DayField[]).map((f) => sumOf(s, [f], range));

  // 宣言
  const inRange = ([w, a, b, d]: [string, number, number, number]): [string, number] => [w, [a, b, d][ri]];
  const lines = s.lines.map(inRange).filter(([, n]) => n > 0);
  const lineMax = Math.max(1, ...lines.map((l) => l[1]));
  const rx = s.reactionsIn
    .map(inRange)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  // 和谁互动最多
  const friends = s.friends
    .map((f) => ({ f, touch: f.touch[ri], gest: f.gest[ri], poke: f.poke[ri] }))
    .map((x) => ({ ...x, total: x.touch + x.gest + x.poke }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);
  const friendMax = Math.max(1, ...friends.map((x) => x.total));
  const strangers = Math.max(0, sent + sumOf(s, ["inBold", "inSneaky"], range) - friends.reduce((a, x) => a + x.touch, 0));

  // 酒: what time of night, 18:00 to 04:00
  const drinks = s.drinks.filter((d) => localDay(d.at, offset) >= from);
  const DH = 120;
  const lw = 34;
  const mins = (atMs: number) => Math.floor((((atMs + offset * 60_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);
  const y = (m: number) => {
    const t = Math.max(0, Math.min(600, m >= 1080 ? m - 1080 : m + 360));
    return 8 + (t / 600) * (DH - 26);
  };

  return (
    <>
      <div className="rec-sticky">
        <div className="rec-seg" role="group">
          {RANGES.map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {c.ranges[r]}
            </button>
          ))}
        </div>
        {opened < range && <p className="rec-hint" style={{ margin: "6px 0 0" }}>{fmt(c.young, { n: opened })}</p>}
      </div>

      <div className="rec-chart" ref={box("days")}>
        <h4>
          <CatIcon cat="touch" size={18} />
          {c.days}
        </h4>
        <svg viewBox={`0 0 ${W} ${heatH}`} role="img" aria-label={c.days}>
          {T.records.weekdays
            .slice(1)
            .concat(T.records.weekdays[0])
            .split("")
            .map((w, i) => (
              <text key={i} x={i * (cell + gap) + cell / 2} y="10" textAnchor="middle" fontSize="10" fill={GREY}>
                {w}
              </text>
            ))}
          {Array.from({ length: weeks * 7 }, (_, n) => {
            const day = first + n;
            if (day > s.today) return null;
            const x = (n % 7) * (cell + gap);
            const yy = 16 + Math.floor(n / 7) * (ch + gap);
            if (day < from) {
              return (
                <g key={day}>
                  <rect x={x} y={yy} width={cell} height={ch} rx="5" fill="none" stroke="#eef0f2" strokeDasharray="3 3" />
                  <text x={x + 5} y={yy + 12} fontSize="9.5" fill="#c3c7ce">
                    {dateNo(day)}
                  </text>
                </g>
              );
            }
            const v = activity(day);
            return (
              <g key={day} className="hit" onClick={() => setHeatDay(day)}>
                <rect x={x} y={yy} width={cell} height={ch} rx="5" fill={heat(v)} stroke={heatDay === day ? "#1b1d22" : "none"} strokeWidth="2" />
                <text x={x + 5} y={yy + 12} fontSize="9.5" fill={v / maxDay > 0.6 ? "#fff" : "#6b5a1e"}>
                  {dateNo(day)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="rec-legend">
          <span>{c.few}</span>
          <span>
            {["#fff1b8", "#ffe066", "#ffc61a", "#ff9f1a", "#e8590c"].map((col) => (
              <i key={col} style={{ background: col }} />
            ))}
          </span>
          <span>{c.lots}</span>
        </div>
        <div className="cap">
          {heatDay === null ? (
            c.dayHint
          ) : (
            <>
              {fmtNodes(c.dayCap, { day: <b key="d">{dayLabel(heatDay, s.today, offset)}</b>, what: daySay(heatDay) || c.dayNone })}
              <button onClick={() => onDay(heatDay)}>{c.toTimeline}</button>
            </>
          )}
        </div>
      </div>

      <div className="rec-chart" ref={box("hours")}>
        <h4>
          <CatIcon cat="touch" size={18} />
          {c.hours}
        </h4>
        <svg viewBox={`0 0 ${W} ${RH}`} role="img" aria-label={c.hours}>
          <circle cx={cx} cy={cy} r={r1} fill="#fbfbfc" stroke="#eef0f2" />
          {hours.map((v, h) => {
            const a0 = (h / 24) * 2 * Math.PI - Math.PI / 2 + 0.02;
            const a1 = ((h + 1) / 24) * 2 * Math.PI - Math.PI / 2 - 0.02;
            const rr = r0 + (r1 - r0) * (v / hourMax);
            const tt = v / hourMax;
            const fill = h === shownHour && hourTotal ? "#1b1d22" : tt > 0.75 ? "#ffb100" : tt > 0.45 ? "#ffd23f" : tt > 0.15 ? "#ffe58a" : "#fff3c4";
            return <path key={h} className="hit" onClick={() => setHour(h)} d={`M${p(r0, a0)} L${p(rr, a0)} A${rr},${rr} 0 0 1 ${p(rr, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`} fill={fill} />;
          })}
          {[0, 6, 12, 18].map((h) => {
            const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
            return (
              <text key={h} x={cx + (r1 + 11) * Math.cos(a)} y={cy + (r1 + 11) * Math.sin(a) + 3.5} textAnchor="middle" fontSize="10" fill={GREY}>
                {fmt(c.hour, { h })}
              </text>
            );
          })}
          {hourTotal > 0 && (
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1b1d22">
              {fmt(c.hour, { h: shownHour })}
            </text>
          )}
        </svg>
        <div className="cap">
          {!hourTotal ? (
            c.hoursNone
          ) : (
            <>
              {hour === null && fmt(c.peak, { h: peak, h2: peak + 1 })}
              {fmt(c.hourSay, { h: shownHour, h2: shownHour + 1, n: hours[shownHour], p: Math.round((hours[shownHour] / hourTotal) * 100) })}
            </>
          )}
        </div>
      </div>

      <div className="rec-chart" ref={box("touch")}>
        <h4>
          <CatIcon cat="touch" size={18} />
          {c.touch}
        </h4>
        <svg viewBox={`0 0 ${W} ${6 + half * 2 + 22}`} role="img" aria-label={c.touch}>
          {days.map((day, i) => {
            const X = i * bw + Math.min(2, bw * 0.15);
            const w = Math.max(2, bw - Math.min(4, bw * 0.3));
            const ob = at(day, "outBold") * k;
            const os = at(day, "outSneaky") * k;
            const ib = at(day, "inBold") * k;
            const is = at(day, "inSneaky") * k;
            return (
              <g key={day} className="hit" onClick={() => setBarDay(day)}>
                <rect x={i * bw} y="6" width={bw} height={half * 2} fill={barDay === day ? "#f3f4f6" : "transparent"} />
                <rect x={X} y={mid - ob} width={w} height={ob} fill="#ffd23f" />
                <rect x={X} y={mid - ob - os} width={w} height={os} fill="#c9ccd3" />
                <rect x={X} y={mid} width={w} height={ib} fill="#ff7eb6" />
                <rect x={X} y={mid + ib} width={w} height={is} fill="#f6c9dd" />
              </g>
            );
          })}
          <line x1="0" x2={W} y1={mid} y2={mid} stroke="#1b1d22" strokeWidth="1" />
          <text x="2" y="15" fontSize="9.5" fill={GREY}>
            {c.up}
          </text>
          <text x="2" y={6 + half * 2 - 2} fontSize="9.5" fill={GREY}>
            {c.down}
          </text>
          <text x="0" y={6 + half * 2 + 16} fontSize="10" fill={GREY}>
            {dateOf(dayStart(from, offset), offset)}
          </text>
          <text x={W} y={6 + half * 2 + 16} textAnchor="end" fontSize="10" fill={GREY}>
            {c.today}
          </text>
        </svg>
        <div className="rec-legend">
          {(["outBold", "outSneaky", "inBold", "inSneaky"] as const).map((f, i) => (
            <span key={f}>
              <i style={{ background: ["#ffd23f", "#c9ccd3", "#ff7eb6", "#f6c9dd"][i] }} />
              {c.legend[f]}
            </span>
          ))}
        </div>
        <div className="cap">
          {barDay === null ? (
            c.barHint
          ) : (
            <>
              {fmtNodes(c.barCap, {
                day: <b key="d">{dayLabel(barDay, s.today, offset)}</b>,
                what: fmt(c.barSay, {
                  o: at(barDay, "outBold") + at(barDay, "outSneaky"),
                  ob: at(barDay, "outBold"),
                  i: at(barDay, "inBold") + at(barDay, "inSneaky"),
                  ib: at(barDay, "inBold"),
                }),
              })}
            </>
          )}
        </div>
        <div className="rec-stat3">
          <div>
            <b>{sent ? Math.round((sentBold / sent) * 100) : 0}%</b>
            <span>{c.boldShare}</span>
          </div>
          <div>
            <b>{sumOf(s, ["touchedBack"], range)}</b>
            <span>{c.touchedBack}</span>
          </div>
          <div>
            <b>{sumOf(s, ["crawled"], range)}</b>
            <span>{c.crawled}</span>
          </div>
        </div>
        <div className="rec-sub" style={{ marginTop: 12 }}>
          {c.whichRoach}
        </div>
        <SlotBar slots={slots} />
      </div>

      <div className="rec-chart" ref={box("decl")}>
        <h4>
          <CatIcon cat="declare" size={18} />
          {c.declare}
        </h4>
        {lines.length ? (
          <div style={{ marginTop: 8 }}>
            {lines.map(([w, n]) => (
              <div className="rec-hbar" key={w}>
                <span className="lb">{w}</span>
                <span className="tr">
                  <i style={{ width: `${(n / lineMax) * 100}%`, background: "#ff9f43" }} />
                </span>
                <span className="nm">{n}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cap">{c.noLines}</div>
        )}
        <div className="rec-sub" style={{ marginTop: 10 }}>
          {fmt(c.reactions, { n: sumOf(s, ["reactedIn"], range) })}
        </div>
        <div className="rec-rxs">
          {rx.slice(0, 8).map(([w, n]) => (
            <span key={w}>
              {w}
              <b>{n}</b>
            </span>
          ))}
        </div>
        <div className="cap">{fmt(c.reactedOut, { n: sumOf(s, ["reactedOut"], range) })}</div>
      </div>

      <div className="rec-chart" ref={box("friends")}>
        <h4>
          <CatIcon cat="friend" size={18} />
          {c.friends}
        </h4>
        {friends.length ? (
          <div style={{ marginTop: 8 }}>
            {friends.map((x) => (
              <div className="rec-hbar" key={x.f.id}>
                <span className="lb">{x.f.name}</span>
                <span className="tr" style={{ width: `${(x.total / friendMax) * 100}%` }}>
                  <i style={{ width: `${(x.touch / x.total) * 100}%`, background: "#ffd23f" }} />
                  <i style={{ width: `${(x.gest / x.total) * 100}%`, background: "#ff7eb6" }} />
                  <i style={{ width: `${(x.poke / x.total) * 100}%`, background: "#b48cff" }} />
                </span>
                <span className="nm">{x.total}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cap">{c.noFriends}</div>
        )}
        <div className="rec-legend">
          {(["touch", "gest", "poke"] as const).map((f, i) => (
            <span key={f}>
              <i style={{ background: ["#ffd23f", "#ff7eb6", "#b48cff"][i] }} />
              {c.friendLegend[f]}
            </span>
          ))}
        </div>
        <div className="cap">{fmt(c.strangers, { n: strangers })}</div>
      </div>

      <div className="rec-chart" ref={box("drink")}>
        <h4>
          <CatIcon cat="drink" size={18} />
          {c.drink}
        </h4>
        <svg viewBox={`0 0 ${W} ${DH}`} role="img" aria-label={c.drink}>
          {(
            [
              [1200, "20:00"],
              [1320, "22:00"],
              [0, "0:00"],
              [120, "2:00"],
              [240, "4:00"],
            ] as [number, string][]
          ).map(([m, label]) => (
            <g key={m}>
              <line x1={lw} x2={W} y1={y(m)} y2={y(m)} stroke="#eef0f2" />
              <text x="0" y={y(m) + 3.5} fontSize="9.5" fill={GREY}>
                {label}
              </text>
            </g>
          ))}
          {drinks.map((d) => {
            const m = mins(d.at);
            // a drink after midnight belongs to the night before
            const day = localDay(d.at, offset) - (m < 360 ? 1 : 0);
            const x = lw + ((Math.max(from, day) - from + 0.5) / range) * (W - lw - 4);
            return <circle key={d.at} cx={x} cy={y(m)} r="6" fill="#b48cff" stroke="#fff" strokeWidth="1.5" />;
          })}
        </svg>
        <div className="cap">{drinks.length ? fmt(c.drank, { n: drinks.length }) : c.noDrinks}</div>
      </div>
    </>
  );
}
