"use client";

import { RADAR_REUSE_MIN, RADAR_SCANS_PER_DAY } from "@/lib/rules";
import type { Radar } from "@/lib/world/types";
import { ago } from "./InboxSheet";
import Sheet from "./Sheet";

const WEEKDAYS = "日一二三四五六";

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

/** When this scan was made, and how many are left today. */
function scanNote(r: Radar, now = Date.now()) {
  const when = ago(r.scannedAt, now);
  const at = `这是${/^\d/.test(when) ? " " : ""}${when}的扫描结果。`;
  if (r.nextScanAt) {
    const hours = Math.ceil((r.nextScanAt - now) / 3_600_000);
    return `${at}今天的 ${RADAR_SCANS_PER_DAY} 次扫描用完了，${hours <= 1 ? "1 小时内" : `${hours} 小时后`}可以再扫。`;
  }
  if (r.scansLeft > 0) return `${at}今天还能扫描 ${r.scansLeft} 次，${RADAR_REUSE_MIN} 分钟内再打开不算次数。`;
  return `${at}今天的 ${RADAR_SCANS_PER_DAY} 次扫描用完了，再打开会看到这一次的结果。`;
}

function mood(r: Radar) {
  const net = r.day.arrived - r.day.left;
  if (r.day.arrived + r.day.left === 0) return "今天附近风平浪静，一只蟑螂都没挪窝。";
  if (net > 0) return `今天附近的蟑螂变多了，净增 ${net} 只，越来越热闹啦！`;
  if (net < 0) return `今天有点冷清，附近少了 ${-net} 只蟑螂。`;
  return "今天来来去去，蟑螂数量刚好打平。";
}

export default function RadarSheet({
  radar,
  onPlaceMain,
  onClose,
}: {
  radar: Radar | null;
  onPlaceMain: () => void;
  onClose: () => void;
}) {
  if (!radar) {
    return (
      <Sheet title="方舟雷达" onClose={onClose}>
        <p className="hint" style={{ marginTop: 0 }}>
          雷达以你的蟑螂本体为中心扫描，先放下本体吧。
        </p>
        <button className="primary wide" style={{ marginTop: 12 }} onClick={onPlaceMain}>
          放下我的蟑螂
        </button>
      </Sheet>
    );
  }

  const peak = Math.max(1, ...radar.daily.flatMap((d) => [d.arrived, d.left]));
  return (
    <Sheet title="方舟雷达" onClose={onClose}>
      <div className="radar">
        <div className="radar-scope" aria-hidden="true">
          <span className="radar-sweep" />
        </div>
        <div className="radar-count">
          <span className="muted">{radar.radiusKm} 公里内现在有</span>
          <strong>{radar.roaches.toLocaleString()}</strong>
          <span className="muted">
            只蟑螂，来自 {radar.players.toLocaleString()} 位舟p
            {radar.clones > 0 && `（${radar.clones} 只是克隆体）`}
          </span>
        </div>
      </div>
      <p className="radar-mood">{mood(radar)}</p>
      <p className="hint">{scanNote(radar)}</p>

      <h3>最近 24 小时</h3>
      <div className="stat-grid">
        <Stat label="爬进来" value={radar.day.arrived} />
        <Stat label="爬走了" value={radar.day.left} />
        <Stat label="净变化" value={signed(radar.day.arrived - radar.day.left)} />
        <Stat label="新面孔" value={radar.day.newcomers} />
      </div>

      <h3>最近 7 天</h3>
      <div className="stat-grid">
        <Stat label="爬进来" value={radar.week.arrived} />
        <Stat label="爬走了" value={radar.week.left} />
        <Stat label="新面孔" value={radar.week.newcomers} />
        <Stat label="克隆体" value={radar.week.clones} />
      </div>
      <div className="week-chart" role="img" aria-label="最近 7 天每天爬进来和爬走的蟑螂数量">
        {radar.daily.map((d, i) => (
          <div className="day" key={d.start}>
            <span className="n">{d.arrived}</span>
            <div className="bars">
              <span className="in" style={{ height: `${(d.arrived / peak) * 100}%` }} />
              <span className="out" style={{ height: `${(d.left / peak) * 100}%` }} />
            </div>
            <span className="n out-n">{d.left}</span>
            <span className="label">{i === 6 ? "今天" : `周${WEEKDAYS[new Date(d.start).getDay()]}`}</span>
          </div>
        ))}
      </div>
      <p className="hint legend">
        <i className="in" /> 爬进来 <i className="out" /> 爬走了
      </p>

      <h3>附近的动静</h3>
      <ul className="radar-facts">
        <li>24 小时内附近的舟p被触须碰了 {radar.touches} 次，发了 {radar.declarations} 条独立宣言</li>
        <li>
          {radar.friendsNearby > 0 ? `你的触须之交里有 ${radar.friendsNearby} 位就在附近` : "附近还没有你的触须之交"}
        </li>
        {radar.lastArrivalAt && <li>最近一次：{ago(radar.lastArrivalAt)}有蟑螂爬进了雷达范围</li>}
      </ul>

      <p className="hint" style={{ marginTop: 14 }}>
        雷达只报数量，不报距离和方向。路人蟑螂的来去是演示数据。
      </p>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
      <span>{label}</span>
    </div>
  );
}
