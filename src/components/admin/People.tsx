"use client";

import { DEVICES, type AppCountDay, type Device, type PageCount } from "@/lib/appCounts";
import type { RetentionStats } from "@/lib/safety";
import { PanelHead } from "./ui";

/**
 * 这周的人: who came in the last 7 days, last week's newcomers who came back, new 触须之交; and 存到桌面's last 14
 * days as bars (opened from the desktop icon), the whole table under them. Totals only, never who. On 数据看板
 * (Dashboard.tsx), from what its answer brings; it was on 网站和工具 before, and looks as it did there.
 */

const DEVICE_NAMES: Record<Device, string> = { iphone: "iPhone", android: "安卓", harmony: "鸿蒙", desktop: "电脑" };
const BAR_PX = 56;
const percent = (x: number) => `${Math.round(x * 100)}%`;

/** One of 存到桌面's counts on a day: the total, and by kind of device when there are any */
const countOf = (day: AppCountDay, kind: PageCount) => DEVICES.reduce((sum, d) => sum + (day.counts[`${kind}:${d}`] ?? 0), 0);

function DeskCell({ day, kind }: { day: AppCountDay; kind: PageCount }) {
  const by = DEVICES.map((d) => [d, day.counts[`${kind}:${d}`] ?? 0] as const).filter(([, n]) => n > 0);
  return (
    <td>
      <strong>{countOf(day, kind)}</strong>
      {by.length > 0 && <small>{by.map(([d, n]) => `${DEVICE_NAMES[d]} ${n}`).join(" · ")}</small>}
    </td>
  );
}

export default function People({ s, days, id }: { s: RetentionStats | null; days: AppCountDay[] | null; id?: string }) {
  // oldest first, left to right
  const shown = [...(days ?? [])].sort((a, b) => a.day.localeCompare(b.day));
  const top = Math.max(1, ...shown.map((d) => countOf(d, "standalone")));
  return (
    <section className="ac-panel ac-tool db-panel" id={id} aria-label="这周的人">
      <PanelHead title="这周的人" aside="只有站长" />
      {s ? (
        <div className="ac-people">
          <div>
            <div className="ac-muted small">最近 7 天来过</div>
            <div className="ac-big-n">{s.activeWeek}</div>
            <div className="ac-muted small">{s.activeWeekBefore === null ? "还没有更早一周的数" : `再往前 7 天 ${s.activeWeekBefore}`}</div>
          </div>
          <div>
            <div className="ac-muted small">上周注册、这周回来</div>
            <div className="ac-big-n">{s.lastWeekSignups ? percent(s.lastWeekSignupsBack / s.lastWeekSignups) : "—"}</div>
            <div className="ac-muted small">
              {s.lastWeekSignupsBack} / {s.lastWeekSignups}
            </div>
          </div>
          <div>
            <div className="ac-muted small">这周新的触须之交</div>
            <div className="ac-big-n">{s.friendshipsWeek}</div>
            <div className="ac-muted small">只有总数，不看具体是谁</div>
          </div>
        </div>
      ) : (
        <p className="ac-sub">正在读取…</p>
      )}
      <div>
        <div className="ac-muted small">存到桌面，最近 14 天每天从桌面图标打开的设备</div>
        {days && days.length === 0 ? (
          <p className="ac-muted small">最近 14 天还没有数。</p>
        ) : (
          <div className="ac-bars-chart" style={{ height: BAR_PX }}>
            {shown.map((d) => {
              const n = countOf(d, "standalone");
              return <span key={d.day} title={`${d.day.slice(5)}：${n}`} style={{ height: Math.max(2, Math.round((n / top) * BAR_PX)) }} />;
            })}
          </div>
        )}
      </div>
      {days && days.length > 0 && (
        <details className="ac-details">
          <summary>每天的数</summary>
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>从桌面图标打开</th>
                  <th>在浏览器里打开</th>
                  <th>点了「存到桌面」</th>
                  <th>装好了</th>
                  <th>登录码 拿/用</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day.slice(5)}</td>
                    <DeskCell day={d} kind="standalone" />
                    <DeskCell day={d} kind="browser" />
                    <DeskCell day={d} kind="tap" />
                    <DeskCell day={d} kind="installed" />
                    <td>
                      {d.counts["code-issued"] ?? 0} / {d.counts["code-redeemed"] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ac-muted small">打开的次数每台设备每天只算一次；「装好了」只有 Chrome 和 Edge 会告诉我们。只有总数，看不出是谁，也不记设备。</p>
        </details>
      )}
      <p className="ac-hint">来访只记日期，按北京时间算。</p>
    </section>
  );
}
