"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { RADAR_REUSE_MIN, RADAR_SCANS_PER_DAY } from "@/lib/rules";
import type { Radar } from "@/lib/world/types";
import { ago } from "./InboxSheet";
import Sheet from "./Sheet";

function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}

/** When this scan was made, and how many are left today. */
function scanNote(r: Radar, now = Date.now()) {
  const when = ago(r.scannedAt, now);
  const at = fmt(T.radar.scan.made, { space: /^\d/.test(when) ? " " : "", when });
  if (r.nextScanAt) {
    const hours = Math.ceil((r.nextScanAt - now) / 3_600_000);
    return fmt(T.radar.scan.usedUp, { at, n: RADAR_SCANS_PER_DAY, when: hours <= 1 ? T.radar.scan.withinHour : fmt(T.radar.scan.inHours, { n: hours }) });
  }
  if (r.scansLeft > 0) return fmt(T.radar.scan.left, { at, n: r.scansLeft, min: RADAR_REUSE_MIN });
  return fmt(T.radar.scan.usedUpSame, { at, n: RADAR_SCANS_PER_DAY });
}

function mood(r: Radar) {
  const net = r.day.arrived - r.day.left;
  if (r.day.arrived + r.day.left === 0) return T.radar.mood.calm;
  if (net > 0) return fmt(T.radar.mood.up, { n: net });
  if (net < 0) return fmt(T.radar.mood.down, { n: -net });
  return T.radar.mood.even;
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
      <Sheet title={T.map.radar} onClose={onClose}>
        <p className="hint" style={{ marginTop: 0 }}>
          {T.radar.placeFirst}
        </p>
        <button className="primary wide" style={{ marginTop: 12 }} onClick={onPlaceMain}>
          {T.map.bar.placeMine}
        </button>
      </Sheet>
    );
  }

  const peak = Math.max(1, ...radar.daily.flatMap((d) => [d.arrived, d.left]));
  return (
    <Sheet title={T.map.radar} onClose={onClose}>
      <div className="radar">
        <div className="radar-scope" aria-hidden="true">
          <span className="radar-sweep" />
        </div>
        <div className="radar-count">
          <span className="muted">{fmtParts(T.radar.within, { km: radar.radiusKm })}</span>
          <strong>{radar.roaches.toLocaleString()}</strong>
          <span className="muted">
            {fmtParts(T.radar.from, { players: radar.players.toLocaleString() })}
            {radar.clones > 0 && fmt(T.radar.clones, { n: radar.clones })}
          </span>
        </div>
      </div>
      <p className="radar-mood">{mood(radar)}</p>
      <p className="hint">{scanNote(radar)}</p>

      <h3>{T.radar.day.title}</h3>
      <div className="stat-grid">
        <Stat label={T.radar.in} value={radar.day.arrived} />
        <Stat label={T.radar.out} value={radar.day.left} />
        <Stat label={T.radar.net} value={signed(radar.day.arrived - radar.day.left)} />
        <Stat label={T.radar.newFaces} value={radar.day.newcomers} />
      </div>

      <h3>{T.radar.week.title}</h3>
      <div className="stat-grid">
        <Stat label={T.radar.in} value={radar.week.arrived} />
        <Stat label={T.radar.out} value={radar.week.left} />
        <Stat label={T.radar.newFaces} value={radar.week.newcomers} />
        <Stat label={T.radar.clonesLabel} value={radar.week.clones} />
      </div>
      <div className="week-chart" role="img" aria-label={T.radar.week.chart}>
        {radar.daily.map((d, i) => (
          <div className="day" key={d.start}>
            <span className="n">{d.arrived}</span>
            <div className="bars">
              <span className="in" style={{ height: `${(d.arrived / peak) * 100}%` }} />
              <span className="out" style={{ height: `${(d.left / peak) * 100}%` }} />
            </div>
            <span className="n out-n">{d.left}</span>
            <span className="label">{i === 6 ? T.common.today : fmt(T.radar.weekday, { day: T.radar.weekdays[new Date(d.start).getDay()] })}</span>
          </div>
        ))}
      </div>
      <p className="hint legend">
        <i className="in" />{T.radar.legend.in}<i className="out" />{T.radar.legend.out}
      </p>

      <h3>{T.radar.activity.title}</h3>
      <ul className="radar-facts">
        <li>{fmtParts(T.radar.activity.counts, { touches: radar.touches, declarations: radar.declarations })}</li>
        <li>
          {radar.friendsNearby > 0 ? fmt(T.radar.activity.friends, { n: radar.friendsNearby }) : T.radar.activity.noFriends}
        </li>
        {radar.lastArrivalAt && <li>{fmtParts(T.radar.activity.last, { ago: ago(radar.lastArrivalAt) })}</li>}
      </ul>

      <p className="hint" style={{ marginTop: 14 }}>
        {T.radar.note}
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
