"use client";
/* eslint-disable @next/next/no-img-element -- small pictures (the looks, the guides, the badges), which next/image would leave as they are */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { daysBetween } from "@/lib/beijing";
import { CITY_KM, guideName, OPEN_DAY, type BestDay, type DashboardData, type DashDay } from "@/lib/dashboard";
import { GUIDES, type GuideId } from "@/lib/guides";
import { AVATAR_PICTURES } from "@/lib/roachImages";
import { roachDataUrl } from "@/lib/roachSvg";
import { MAX_CLONES } from "@/lib/rules";
import type { DrawnAvatar, RoachColor } from "@/lib/types";
import { BadgeImg } from "../app/Badges";
import { errorWords } from "./api";
import { useConsole } from "./context";
import { Chart, COLORS, TipLayer, useHideTip, type Series, type TipRow } from "./DashChart";
import { badgeLists, daysIn, leadingNulls, milestones, weekActs, weekReplies, weekTemplates, type BadgeRow, type Range, type Row } from "./dashView";
import { avatarName, cityName, clock, colorName, dayLong, dayShort, dayWords, GAME_PARTS, hourOf, momentWords, num, pct, wan } from "./dashWords";
import People from "./People";

/**
 * 数据看板, the owner's: the site's numbers, counts only, never who. Today's every minute while the page is open
 * and seen; how players and their roaches are spread, every morning at 05:00 (Beijing time). From one endpoint
 * (src/lib/server/dashboard.ts), which reads only small rows already counted. The charts are DashChart.tsx's,
 * the words dashWords.ts's.
 */

const REFRESH_MS = 60_000;

export default function Dashboard() {
  const { call } = useConsole();
  const [data, setData] = useState<DashboardData | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const asked = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      asked.current = Date.now();
      call<DashboardData>("dashboard")
        .then((d) => {
          if (!alive) return;
          setData(d);
          setNote(null);
        })
        .catch((e) => {
          if (alive) setNote(errorWords(e));
        });
    };
    load();
    const seen = () => document.visibilityState === "visible";
    // every minute while it is in sight; on coming back to it after a while, at once
    const tick = window.setInterval(() => {
      if (seen()) load();
    }, REFRESH_MS);
    const back = () => {
      if (seen() && Date.now() - asked.current > REFRESH_MS / 2) load();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      alive = false;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  }, [call]);
  if (!data) return note ? <p className="ac-error">读不出来：{note}</p> : <p className="ac-sub">正在读取…</p>;
  return <Board data={data} stale={note} />;
}

const JUMPS: [string, string][] = [
  ["db-sum", "一共"],
  ["db-today", "今天"],
  ["db-daily", "每天的变化"],
  ["db-friends", "触须之交"],
  ["db-touch", "触须和宣言"],
  ["db-look", "小强长什么样"],
  ["db-fav", "厨力和助战"],
  ["db-guides", "向导们"],
  ["db-badges", "徽章"],
  ["db-map", "地图"],
  ["db-records", "纪录"],
  ["db-week", "这周的人"],
];

/** The board itself, from one answer (stale: why the last refresh failed, the numbers being the one before) */
export function Board({ data: d, stale = null }: { data: DashboardData; stale?: string | null }) {
  return (
    <TipLayer>
      <div className="db">
        {stale && <p className="ac-error">刚才没更新上（{stale}），下面是上一次的数，一分钟后再试。</p>}
        {!d.backfilled && (
          <div className="ac-notice">
            开张以来每天的触须、宣言、回应、放下的蟑螂和碰向导的次数，会在下一个早上 5 点（北京时间）从记录里补上。补上以前，这些数只从看板上线时算起。
          </div>
        )}
        <nav className="db-jump" aria-label="跳到">
          {JUMPS.map(([id, words]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ block: "start" });
              }}
            >
              {words}
            </a>
          ))}
        </nav>
        <Sum d={d} />
        <Today d={d} />
        <Daily d={d} />
        <Friends d={d} />
        <Touch d={d} />
        <Look d={d} />
        <Favourites d={d} />
        <Guides d={d} />
        <Badges d={d} />
        <div className="db-row">
          <Where d={d} />
          <Records d={d} />
        </div>
        <People s={d.people.retention} days={d.people.desk} id="db-week" />
      </div>
    </TipLayer>
  );
}

// ---- pieces ----

function Head({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="ac-panel-head">
      <h2>{title}</h2>
      {aside && <span className="ac-muted">{aside}</span>}
    </div>
  );
}

/** The 05:00 counts' note: when they are from, if not this morning */
function morning(d: DashboardData, more = "") {
  const old = d.snapshot && d.snapshot.day !== d.today.day ? `（这是 ${dayWords(d.snapshot.day)}的）` : "";
  return `每天早上 5 点更新${old}${more}`;
}

const NotYet = () => <p className="db-note">这块每天早上 5 点数一次，还没数过。</p>;

type Part = { name: string; n: number; color: string };

/** One bar cut into its parts, with what each is under it */
function SegBar({ what, parts }: { what: string; parts: Part[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <div>
      <div className="db-segbar" role="img" aria-label={`${what}：${parts.map((p) => `${p.name} ${num(p.n)}`).join("，")}`}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <i key={p.name} style={{ flex: String(p.n), background: p.color }} />
          ))}
      </div>
      <ul className="db-legend">
        {parts.map((p) => (
          <li key={p.name}>
            <span className="sw" style={{ background: p.color }} />
            {p.name} <b>{num(p.n)}</b>
            {total > 0 ? ` · ${pct(p.n / total)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <ul className="db-legend">
      {items.map(([name, color]) => (
        <li key={name}>
          <span className="sw" style={{ background: color }} />
          {name}
        </li>
      ))}
    </ul>
  );
}

type RankRow = Row & { img?: string };

/** A ranking with bars: pics, a picture before each; stack, the bar under the words (long sentences) */
function Rank({ rows, total, kind, empty = "还没有数。" }: { rows: RankRow[]; total?: number; kind?: "pics" | "stack"; empty?: string }) {
  if (!rows.some((r) => r.n > 0)) return <p className="db-note">{empty}</p>;
  const top = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ol className={`db-rank${kind ? ` ${kind}` : ""}`}>
      {rows.map((r) => {
        const name = (
          <span className="db-rank-name" title={r.name}>
            {r.name}
          </span>
        );
        const bar = (
          <span className="db-rank-bar" aria-hidden="true">
            <i style={{ width: `${((r.n / top) * 100).toFixed(1)}%` }} />
          </span>
        );
        const n = (
          <span className="db-rank-n">
            {num(r.n)}
            {total ? <small>{pct(r.n / total)}</small> : null}
          </span>
        );
        return (
          <li key={r.key}>
            {kind === "pics" && <img className="db-rank-img" src={r.img} alt="" width={30} height={30} />}
            {name}
            {kind === "stack" ? (
              <>
                {n}
                {bar}
              </>
            ) : (
              <>
                {bar}
                {n}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Facts in a column: what, and how many (with its unit, smaller) */
function Facts({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="db-facts">
      {rows.map(([k, v, unit]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            {v}
            {unit && <small>{unit}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const S1 = COLORS.s1;
const S2 = COLORS.s2;

// ---- 一共 ----

function Sum({ d }: { d: DashboardData }) {
  const last = d.days[d.days.length - 1];
  const r = d.totals.roaches;
  const { sneaky, bold } = d.totals.touches;
  const touches = sneaky + bold;
  const miles = milestones(d.totals.players, d.snapshot?.milestones ?? []);
  return (
    <section className="ac-panel db-panel" id="db-sum" aria-label="一共">
      <Head title="一共" aside={`开张第 ${daysBetween(OPEN_DAY, d.today.day) + 1} 天（${dayWords(OPEN_DAY)}开张）`} />
      <div className="db-hero">
        <div className="db-hero-main">
          <div className="db-label">舟P</div>
          <div className="db-hero-n num">
            {num(d.totals.players)}
            <small>位</small>
          </div>
          <div className="db-delta">
            今天新来 <b>+{num(last.signups)}</b>
          </div>
          <ol className="db-miles" aria-label="里程碑">
            {miles.map((m, i) => (
              <li key={m.n} className={m.left !== null ? "next" : undefined}>
                <span>{i === 0 ? `第 ${wan(m.n)}位舟P${m.left === null ? "来的时候" : ""}` : `第 ${wan(m.n)}位`}</span>
                <b>{m.left !== null ? `还差 ${num(m.left)} 位` : m.at !== null ? momentWords(m.at) : "已经到了"}</b>
              </li>
            ))}
          </ol>
        </div>
        <div className="db-hero-side">
          <div>
            <div className="db-label">地图上的蟑螂</div>
            <div className="db-mid-n num">
              {num(r.mains + r.clones + r.inks)}
              <small>只</small>
            </div>
            <SegBar
              what="地图上的蟑螂"
              parts={[
                { name: "本体", n: r.mains, color: S1 },
                { name: "克隆体", n: r.clones, color: S2 },
                { name: "墨小强", n: r.inks, color: COLORS.s3 },
              ]}
            />
          </div>
          <dl className="db-alltime">
            <div>
              <dt>触须之交</dt>
              <dd>
                <b className="num">
                  {num(d.totals.friendships)}
                  <small>次</small>
                </b>
                <span>一共结成过（解除了的也算）</span>
                {d.snapshot && <span>现在还是 {num(d.snapshot.friendships.pairs)} 对</span>}
              </dd>
            </div>
            <div>
              <dt>触须</dt>
              <dd>
                <b className="num">
                  {num(touches)}
                  <small>次</small>
                </b>
                <span>一共伸出过</span>
                {touches > 0 && (
                  <span>
                    偷偷 {pct(sneaky / touches)} · 大胆 {pct(bold / touches)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>宣言</dt>
              <dd>
                <b className="num">
                  {num(d.totals.decl)}
                  <small>句</small>
                </b>
                <span>一共发过</span>
                <span>收到回应 {num(d.totals.replies)} 次</span>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

// ---- 今天 ----

function Tile({ label, n, unit, notes, live = false }: { label: string; n: number | null; unit: string; notes: (string | null | false)[]; live?: boolean }) {
  return (
    <div className="db-tile">
      <span className={`db-label${live ? " db-live" : ""}`}>{label}</span>
      <span className="db-tile-n num">
        {n === null ? (
          "—"
        ) : (
          <>
            {num(n)}
            <small>{unit}</small>
          </>
        )}
      </span>
      {notes.map((t, i) =>
        t ? (
          <span key={i} className="db-note">
            {t}
          </span>
        ) : null,
      )}
    </div>
  );
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h % 6 === 0 || h === 23 ? `${h}点` : ""));

function Today({ d }: { d: DashboardData }) {
  const last = d.days[d.days.length - 1];
  const prev = d.days.length > 1 ? d.days[d.days.length - 2] : null;
  const t = d.today;
  const hour = hourOf(d.asOf);
  // yesterday's counters are whole once the days before the board are filled in
  const whole = (words: string) => (d.backfilled ? words : "昨天的还没补上");
  const { today, yesterday } = d.hours;
  return (
    <section className="ac-panel db-panel" id="db-today" aria-label="今天">
      <Head title="今天" aside={`北京时间 ${dayLong(t.day)} ${clock(d.asOf)} · 每分钟更新`} />
      <div className="db-tiles">
        <Tile label="新来的舟P" n={last.signups} unit="位" notes={[prev && `昨天全天 ${num(prev.signups)}`]} />
        <Tile label="新结成的触须之交" n={last.friendships} unit="对" notes={[prev && `昨天全天 ${num(prev.friendships)}`]} />
        <Tile
          label="伸出的触须"
          n={last.sneaky + last.bold}
          unit="次"
          notes={[`偷偷 ${num(last.sneaky)} · 大胆 ${num(last.bold)}`, prev && whole(`昨天全天 ${num(prev.sneaky + prev.bold)}`)]}
        />
        <Tile label="发出的宣言" n={last.decl} unit="句" notes={[`收到回应 ${num(last.replies)} 次`, prev && whole(`昨天全天 ${num(prev.decl)} 句`)]} />
        <Tile
          label="今天来过的舟P"
          n={last.visitors}
          unit="位"
          notes={[prev && (prev.visitors === null ? "昨天看板还没上线" : `昨天全天 ${num(prev.visitors)}`)]}
        />
        <Tile
          live
          label="此刻在线"
          n={t.online}
          unit="位"
          notes={["登录着、开着网页的舟P", t.peak && `今天最多 ${num(t.peak.n)}（${clock(t.peak.at)}）`]}
        />
      </div>
      <div className="db-chart">
        <div className="db-chart-head">
          <h3>今天几点最热闹</h3>
          <Legend
            items={[
              ["今天", S1],
              ["昨天", COLORS.quiet],
            ]}
          />
        </div>
        <p className="db-note">每个小时里最多同时在线多少位舟P</p>
        <Chart
          label="今天和昨天每个小时最多同时在线"
          kind="line"
          series={[
            { name: "今天", color: S1, values: today },
            { name: "昨天", color: COLORS.quiet, values: yesterday },
          ]}
          xLabels={HOUR_LABELS}
          title={(h) => `${h}:00 到 ${h}:59${h === hour ? "（到现在）" : ""}`}
          rows={(h) => [
            { name: "今天", value: today[h] == null ? (h > hour ? "还没到" : "没有记") : `${num(today[h]!)} 位`, color: S1 },
            { name: "昨天", value: yesterday[h] == null ? "没有记" : `${num(yesterday[h]!)} 位`, color: COLORS.quiet },
          ]}
        />
      </div>
    </section>
  );
}

// ---- 每天的变化 ----

const RANGES: [Range, string][] = [
  [7, "最近 7 天"],
  [30, "最近 30 天"],
  ["all", "开张以来"],
];

function Seg<T extends string | number>({
  label,
  options,
  value,
  onChange,
  small = false,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className={`ac-seg${small ? " small" : ""}`} role="group" aria-label={label}>
      {options.map(([v, words]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {words}
        </button>
      ))}
    </div>
  );
}

const TABLE_HEAD = ["日子", "新来的舟P", "放下的蟑螂", "新的触须之交", "偷偷碰", "大胆碰", "宣言", "回应", "来过的舟P", "最多同时在线"];

function Daily({ d }: { d: DashboardData }) {
  const [range, setRange] = useState<Range>(30);
  const [mode, setMode] = useState<"day" | "total">("day");
  const hide = useHideTip();
  const shown = daysIn(d.days, range);
  // past about three months, columns get too thin to read: lines instead
  const many = shown.length > 90;
  const col = many ? "line" : "col";
  const today = d.today.day;
  const title = (k: number) => `${dayLong(shown[k].day)}${shown[k].day === today ? `（今天，到 ${clock(d.asOf)}）` : ""}`;
  const xLabel = (k: number) => dayShort(shown[k].day);
  const of = (f: (x: DashDay) => number | null) => shown.map(f);
  const counted = (v: number | null, unit: string) => (v == null ? "没有记" : `${num(v)} ${unit}`);
  const one =
    (name: string, values: (number | null)[], unit: string) =>
    (k: number): TipRow[] => [{ name, value: counted(values[k], unit), color: S1 }];

  const signups = of((x) => x.signups);
  const players = of((x) => x.players);
  const placed = of((x) => x.placed);
  const friends = of((x) => x.friendships);
  const sneaky = of((x) => x.sneaky);
  const bold = of((x) => x.bold);
  const decl = of((x) => x.decl);
  const replies = of((x) => x.replies);
  const visitors = of((x) => x.visitors);
  const peaks = of((x) => x.peakOnline);
  const signupTitle = mode === "day" ? "每天新来的舟P" : "一共多少舟P";
  const signupSeries: Series[] =
    mode === "day" ? [{ name: "新来的舟P", color: S1, values: signups }] : [{ name: "一共", color: S1, values: players, area: true }];

  return (
    <section className="ac-panel db-panel" id="db-daily" aria-label="每天的变化">
      <div className="db-controls">
        <Head title="每天的变化" />
        <Seg
          label="看多少天"
          options={RANGES}
          value={range}
          onChange={(r) => {
            hide();
            setRange(r);
          }}
        />
      </div>
      <div className="db-charts">
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>{signupTitle}</h3>
            <Seg
              small
              label="每天还是一共"
              options={[
                ["day", "每天"],
                ["total", "一共"],
              ]}
              value={mode}
              onChange={(m) => {
                hide();
                setMode(m);
              }}
            />
          </div>
          <Chart
            label={signupTitle}
            kind={mode === "day" ? col : "line"}
            series={signupSeries}
            xLabel={xLabel}
            title={title}
            rows={(k) => [
              { name: "新来", value: counted(signups[k], "位"), color: S1 },
              { name: "到这天一共", value: counted(players[k], "位"), sub: true },
            ]}
          />
        </div>
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>每天新放下的蟑螂</h3>
          </div>
          <p className="db-note">本体、克隆体、墨小强都算，挪动不算</p>
          <Chart
            label="每天新放下的蟑螂"
            kind={col}
            series={[{ name: "新放下的蟑螂", color: S1, values: placed }]}
            xLabel={xLabel}
            title={title}
            rows={one("放下", placed, "只")}
          />
        </div>
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>每天新结成的触须之交</h3>
          </div>
          <p className="db-note">按对算</p>
          <Chart
            label="每天新结成的触须之交"
            kind={col}
            series={[{ name: "触须之交", color: S1, values: friends }]}
            xLabel={xLabel}
            title={title}
            rows={one("新结成", friends, "对")}
          />
        </div>
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>每天伸出的触须</h3>
            <Legend
              items={[
                ["偷偷", S1],
                ["大胆", S2],
              ]}
            />
          </div>
          <Chart
            label="每天伸出的触须，偷偷和大胆"
            kind={many ? "line" : "stack"}
            series={[
              { name: "偷偷", color: S1, values: sneaky },
              { name: "大胆", color: S2, values: bold },
            ]}
            xLabel={xLabel}
            title={title}
            rows={(k) => [
              { name: "偷偷", value: num(sneaky[k] ?? 0), color: S1 },
              { name: "大胆", value: num(bold[k] ?? 0), color: S2 },
              { name: "一共", value: `${num((sneaky[k] ?? 0) + (bold[k] ?? 0))} 次`, sub: true },
            ]}
          />
        </div>
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>每天的宣言和回应</h3>
            <Legend
              items={[
                ["宣言", S1],
                ["回应", S2],
              ]}
            />
          </div>
          <Chart
            label="每天的宣言和回应"
            kind="line"
            series={[
              { name: "宣言", color: S1, values: decl },
              { name: "回应", color: S2, values: replies },
            ]}
            xLabel={xLabel}
            title={title}
            rows={(k) => [
              { name: "宣言", value: counted(decl[k], "句"), color: S1 },
              { name: "回应", value: counted(replies[k], "次"), color: S2 },
            ]}
          />
        </div>
        <div className="db-chart">
          <div className="db-chart-head">
            <h3>每天来过的舟P</h3>
          </div>
          <p className="db-note">放上去还能看到那天最多同时在线多少位</p>
          <Chart
            label="每天来过的舟P"
            kind={col}
            series={[{ name: "来过的舟P", color: S1, values: visitors }]}
            blank={leadingNulls(visitors)}
            xLabel={xLabel}
            title={title}
            rows={(k) =>
              visitors[k] == null
                ? [{ name: "看板上线前没有记", value: "" }]
                : [
                    { name: "来过", value: counted(visitors[k], "位"), color: S1 },
                    { name: "最多同时在线", value: counted(peaks[k], "位"), sub: true },
                  ]
            }
          />
        </div>
      </div>
      <details className="ac-details">
        <summary>看表格</summary>
        <div className="ac-table-wrap">
          <table className="db-table">
            <thead>
              <tr>
                {TABLE_HEAD.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((x) => (
                <tr key={x.day}>
                  <td>{x.day === today ? `${dayShort(x.day)} 今天` : dayShort(x.day)}</td>
                  {[x.signups, x.placed, x.friendships, x.sneaky, x.bold, x.decl, x.replies, x.visitors, x.peakOnline].map((v, j) =>
                    v === null ? (
                      <td key={j} className="none">
                        —
                      </td>
                    ) : (
                      <td key={j}>{num(v)}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// ---- 触须之交 ----

function Friends({ d }: { d: DashboardData }) {
  const s = d.snapshot;
  const f = s?.friendships;
  return (
    <section className="ac-panel db-panel" id="db-friends" aria-label="触须之交">
      <Head title="触须之交" aside={morning(d)} />
      <div className="db-cols">
        <div className="db-col">
          {s && f ? (
            <Facts
              rows={[
                ["现在还是触须之交的", num(f.pairs), "对"],
                ["一共结成过", num(d.totals.friendships), "次"],
                ["平均每位舟P有", s.players ? ((2 * f.pairs) / s.players).toFixed(1) : "—", "位触须之交"],
                ["一位触须之交都还没有的舟P", s.players ? pct((s.players - f.withSome) / s.players) : "—"],
                ["触须之交最多的一位有", num(f.most), "位（不显示是谁）"],
                ["最老的一对", f.oldestDays === null ? "还没有" : `已经处了 ${num(f.oldestDays)}`, f.oldestDays === null ? undefined : "天"],
              ]}
            />
          ) : (
            <NotYet />
          )}
        </div>
        <div className="db-col">
          <h3 className="db-h3">最近 7 天，触须之交之间做了什么</h3>
          <Rank rows={weekActs(d.week.counts)} />
        </div>
      </div>
    </section>
  );
}

// ---- 触须和宣言 ----

function Touch({ d }: { d: DashboardData }) {
  const w = d.week.counts;
  const c = (name: string) => w[name] ?? 0;
  const sneaky = c("touch.sneaky");
  const bold = c("touch.bold");
  const touches = sneaky + bold;
  const decl = c("decl");
  return (
    <section className="ac-panel db-panel" id="db-touch" aria-label="触须和宣言">
      <Head title="触须和宣言" aside={`最近 7 天（${dayShort(d.week.from)}–${dayShort(d.week.to)}）`} />
      <div className="db-cols">
        <div className="db-col">
          <h3 className="db-h3">伸出的触须</h3>
          <SegBar
            what="最近 7 天伸出的触须"
            parts={[
              { name: "偷偷", n: sneaky, color: S1 },
              { name: "大胆", n: bold, color: S2 },
            ]}
          />
          <Facts
            rows={[
              ["被碰的人又碰了回去", touches ? pct(c("touch.back") / touches) : "—"],
              ["被碰的人默默爬走", touches ? pct(c("touch.ignored") / touches) : "—"],
              ["把触须用完的人", num(c("touch.capped")), "人次"],
              ["对某位触须之交碰满", num(c("touch.friendCapped")), "次"],
              ["一句宣言平均送到", decl ? num(c("decl.reach") / decl) : "—", "位舟P"],
              ["一句宣言平均收到", decl ? (c("reply") / decl).toFixed(1) : "—", "个回应"],
            ]}
          />
        </div>
        <div className="db-col">
          <h3 className="db-h3">最常发的宣言</h3>
          <Rank kind="stack" rows={weekTemplates(w)} />
        </div>
        <div className="db-col">
          <h3 className="db-h3">最常收到的回应</h3>
          <Rank kind="stack" rows={weekReplies(w)} />
        </div>
      </div>
    </section>
  );
}

// ---- 小强长什么样 ----

/** The hood every player starts with, its side lights in a colour */
const hood = (color: RoachColor) => roachDataUrl(color, { avatar: "hood", size: 30 });
const lookPicture = (avatar: string) => (avatar === "hood" ? hood("cyan") : (AVATAR_PICTURES[avatar as DrawnAvatar] ?? hood("cyan")));
const GAME_COLORS: Record<(typeof GAME_PARTS)[number]["key"], string> = { arknights: S1, both: S2, endfield: COLORS.s3, none: COLORS.quiet };

function Look({ d }: { d: DashboardData }) {
  const s = d.snapshot;
  return (
    <section className="ac-panel db-panel" id="db-look" aria-label="小强长什么样">
      <Head title="小强长什么样" aside={morning(d, " · 按舟P算")} />
      {s ? (
        <div className="db-cols">
          <div className="db-col">
            <h3 className="db-h3">头像</h3>
            <Rank kind="pics" total={s.players} rows={s.avatars.map((a) => ({ key: a.key, name: avatarName(a.key), n: a.n, img: lookPicture(a.key) }))} />
          </div>
          <div className="db-col">
            <h3 className="db-h3">颜色（用初始头像的舟P）</h3>
            <Rank kind="pics" total={s.hood} rows={s.colors.map((c) => ({ key: c.key, name: colorName(c.key), n: c.n, img: hood(c.key as RoachColor) }))} />
          </div>
          <div className="db-col">
            <h3 className="db-h3">玩哪个游戏</h3>
            <SegBar what="玩哪个游戏" parts={GAME_PARTS.map((g) => ({ name: g.name, n: s.games[g.key], color: GAME_COLORS[g.key] }))} />
            <h3 className="db-h3 db-gap">克隆体</h3>
            <Facts
              rows={[
                ["放了克隆体的舟P", num(s.clones.players), s.players ? `位 · ${pct(s.clones.players / s.players)}` : "位"],
                ["一共放了", num(s.clones.all), "只"],
                [`放满 ${MAX_CLONES} 只的`, num(s.clones.full), "位"],
                ["正在跟着明河走的", num(d.totals.roaches.riders), "只"],
              ]}
            />
          </div>
        </div>
      ) : (
        <NotYet />
      )}
    </section>
  );
}

// ---- 厨力和助战 ----

function Favourites({ d }: { d: DashboardData }) {
  const s = d.snapshot;
  const rows = (list: { key: string; n: number }[]) => list.map((c) => ({ key: c.key, name: c.key, n: c.n }));
  return (
    <section className="ac-panel db-panel" id="db-fav" aria-label="厨力和助战">
      <Head title="厨力和助战" aside={morning(d, " · 前 10 名")} />
      {s ? (
        <div className="db-cols">
          <div className="db-col">
            <h3 className="db-h3">明日方舟厨力</h3>
            <Rank rows={rows(s.favourites.arknights)} />
          </div>
          <div className="db-col">
            <h3 className="db-h3">终末地厨力</h3>
            <Rank rows={rows(s.favourites.endfield)} />
          </div>
          <div className="db-col">
            <h3 className="db-h3">我的助战</h3>
            <Rank rows={rows(s.favourites.support)} />
          </div>
        </div>
      ) : (
        <NotYet />
      )}
    </section>
  );
}

// ---- 向导们 ----

const times = (n: number) => `${num(n)} 次`;
const amount = (n: number | undefined, unit: string) => (n === undefined ? "—" : `${num(n)} ${unit}`);

const GUIDE_CARDS: { id: GuideId; name: string; place?: string; rows: (d: DashboardData) => [string, string][] }[] = [
  {
    id: "amiya",
    name: "阿米娅",
    place: "罗德岛",
    rows: (d) => [
      ["一共被碰过", times(d.totals.guides.amiya)],
      ["成了触须之交", amount(d.snapshot?.guides.friends.amiya, "位")],
      ["今天被碰", times(d.today.counts[guideName("amiya")] ?? 0)],
    ],
  },
  {
    id: "perlica",
    name: "佩丽卡",
    rows: (d) => [
      ["一共被碰过", times(d.totals.guides.perlica)],
      ["成了触须之交", amount(d.snapshot?.guides.friends.perlica, "位")],
      ["今天被碰", times(d.today.counts[guideName("perlica")] ?? 0)],
    ],
  },
  {
    id: "talulah",
    name: "塔露拉",
    place: "篝火边",
    rows: (d) => [
      ["一共被碰过", times(d.totals.guides.talulah)],
      ["和她握过手", amount(d.snapshot?.guides.friends.talulah, "位")],
      ["火边坐着", amount(d.totals.roaches.fire, "只")],
    ],
  },
  {
    id: "minghe",
    name: "明河",
    rows: (d) => [
      ["一共被碰过", times(d.totals.guides.minghe)],
      ["成了触须之交", amount(d.snapshot?.guides.friends.minghe, "位")],
      ["跟着他走的", amount(d.totals.roaches.riders, "只")],
    ],
  },
  {
    id: "si",
    name: "祀",
    place: "缘缘庄",
    rows: (d) => [
      ["一共被碰过", times(d.totals.guides.si)],
      ["住过的墨小强", amount(d.snapshot?.guides.inksStayed, "只")],
      ["正在排队", amount(d.snapshot?.guides.inksQueued, "只")],
    ],
  },
];

/** A guide's picture, or the hood in her colour while it is switched off */
function GuidePicture({ id }: { id: GuideId }) {
  const drawn = hood(GUIDES[id].color);
  const [src, setSrc] = useState(AVATAR_PICTURES[id] ?? drawn);
  return <img src={src} alt="" width={44} height={44} onError={() => setSrc(drawn)} />;
}

function Guides({ d }: { d: DashboardData }) {
  return (
    <section className="ac-panel db-panel" id="db-guides" aria-label="向导们">
      <Head title="向导们" aside="被碰的次数每分钟更新，其他每天早上 5 点" />
      <div className="db-guides">
        {GUIDE_CARDS.map((g) => (
          <div key={g.id} className="db-guide">
            <div className="db-guide-top">
              <GuidePicture id={g.id} />
              <div>
                <strong>{g.name}</strong>
                {g.place && <span>{g.place}</span>}
              </div>
            </div>
            <dl>
              {g.rows(d).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- 徽章 ----

function BadgeList({ rows, players }: { rows: BadgeRow[]; players: number }) {
  return (
    <ol className="db-badges">
      {rows.map((b) => {
        const share = players ? b.n / players : 0;
        return (
          <li key={b.id} className={b.n ? undefined : "none"}>
            <BadgeImg id={b.id} size={40} alt="" />
            <div className="who">
              <strong>{b.name}</strong>
              <span>{b.how}</span>
            </div>
            <div className="n">
              {b.n ? (
                <>
                  {num(b.n)} 位<small>{share >= 0.01 ? `${pct(share)} 的舟P` : "不到 1%"}</small>
                </>
              ) : (
                "还没人拿到"
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Badges({ d }: { d: DashboardData }) {
  const s = d.snapshot;
  const lists = s ? badgeLists(s, d.asOf) : null;
  return (
    <section className="ac-panel db-panel" id="db-badges" aria-label="徽章">
      <Head title="徽章" aside={morning(d)} />
      {s && lists ? (
        <>
          <p className="db-label">
            一共发出 <b className="num db-ink">{num(s.badges.total)}</b> 枚，平均每位舟P{" "}
            <b className="num db-ink">{s.players ? (s.badges.total / s.players).toFixed(1) : "—"}</b> 枚
          </p>
          <div className="db-cols">
            <div className="db-col">
              <h3 className="db-h3">最多人有的</h3>
              <BadgeList rows={lists.most} players={s.players} />
            </div>
            <div className="db-col">
              <h3 className="db-h3">最少人有的</h3>
              <BadgeList rows={lists.least} players={s.players} />
            </div>
          </div>
        </>
      ) : (
        <NotYet />
      )}
    </section>
  );
}

// ---- 地图上哪里最多, 纪录 ----

function Where({ d }: { d: DashboardData }) {
  const s = d.snapshot;
  return (
    <section className="ac-panel db-panel" id="db-map" aria-label="地图上哪里最多">
      <Head title="地图上哪里最多" aside={morning(d, " · 按本体算")} />
      {s ? (
        <>
          <SegBar
            what="本体在哪"
            parts={[
              { name: "国内", n: s.where.china, color: S1 },
              { name: "海外", n: s.where.abroad, color: S2 },
            ]}
          />
          <h3 className="db-h3">城市（市中心 {CITY_KM} 公里以内）</h3>
          <Rank rows={s.where.cities.map((c) => ({ key: c.key, name: cityName(c.key), n: c.n }))} />
        </>
      ) : (
        <NotYet />
      )}
    </section>
  );
}

const DAY_RECORDS: [string, "signups" | "friendships" | "touches" | "reach" | "placed", string][] = [
  ["一天新来最多", "signups", "位"],
  ["一天结成触须之交最多", "friendships", "对"],
  ["一天伸出触须最多", "touches", "次"],
  ["一句宣言送到最多", "reach", "位"],
  ["一天放下蟑螂最多", "placed", "只"],
];

function RecordOf({ label, n, unit, when }: { label: string; n: number | null; unit: string; when: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {n === null ? (
          <span>还没有</span>
        ) : (
          <>
            <b className="num">
              {num(n)}
              <small>{unit}</small>
            </b>
            <span>{when}</span>
          </>
        )}
      </dd>
    </div>
  );
}

function Records({ d }: { d: DashboardData }) {
  const r = d.records;
  const day = (b: BestDay | null) => (b ? dayWords(b.day) : "");
  return (
    <section className="ac-panel db-panel" id="db-records" aria-label="纪录">
      <Head title="纪录" aside="只记数和日子，不记是谁" />
      <dl className="db-records">
        <RecordOf label="最多同时在线" n={r.online?.n ?? null} unit="位" when={r.online ? momentWords(r.online.at) : ""} />
        {DAY_RECORDS.map(([label, key, unit]) => (
          <RecordOf key={key} label={label} n={r[key]?.n ?? null} unit={unit} when={day(r[key])} />
        ))}
      </dl>
    </section>
  );
}
