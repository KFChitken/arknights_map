"use client";

import { useCallback, useEffect, useState } from "react";
import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import type { RecordsSummary, TimelineKindFilter } from "@/lib/records";
import type { Me } from "@/lib/world/types";
import Sheet from "../Sheet";
import Charts, { type ChartId } from "./Charts";
import Overview from "./Overview";
import { deviceOffset } from "./parts";
import Seen from "./Seen";
import Timeline, { type TimelineStart } from "./Timeline";
import "./records.css";

/**
 * 「我的记录」 (src/lib/records.ts): the player's own records in three tabs, 总览, 时间线 and 图表, from 我的资料
 * (onBack). The summary is asked for once as it opens (GET /api/records/summary); the timeline asks for its pages.
 * Loaded only when opened (src/components/app/ProfileSheet.tsx), so the map downloads none of it.
 */
type Tab = "overview" | "timeline" | "charts";
const TABS: Tab[] = ["overview", "timeline", "charts"];

export default function RecordsSheet({
  me,
  passesOpen,
  onBack,
  onClose,
  onOpenBadges,
}: {
  me: Me;
  /** 寻访 is open to the player: its rows, its records and its links */
  passesOpen: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpenBadges: () => void;
}) {
  const [offset] = useState(deviceOffset);
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<RecordsSummary | null>(null);
  const [failed, setFailed] = useState(false);
  // where the timeline starts when another tab sends the player there, and the chart the overview points at
  const [start, setStart] = useState<TimelineStart>({ kind: null, day: null, n: 0 });
  const [chart, setChart] = useState<{ id: ChartId; n: number } | null>(null);
  // 触须之交看到的你, over the overview
  const [seen, setSeen] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiFetch(`/api/records/summary?offset=${offset}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setSummary((await res.json()) as RecordsSummary);
      })
      .catch(() => setFailed(true));
  }, [offset]);
  useEffect(load, [load]);

  const toTimeline = (kind: TimelineKindFilter | null, day: number | null = null) => {
    setStart((s) => ({ kind, day, n: s.n + 1 }));
    setTab("timeline");
  };
  const toChart = (id: ChartId) => {
    setChart((c) => ({ id, n: (c?.n ?? 0) + 1 }));
    setTab("charts");
  };

  const tabs = (
    <div className="rec-tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
          {T.records.tabs[t]}
        </button>
      ))}
    </div>
  );
  if (seen && summary) {
    return <Seen events={summary.seen} offset={offset} onBack={() => setSeen(false)} />;
  }
  return (
    <Sheet title={T.records.title} className="records" onBack={onBack} onClose={onClose} head={<><h2>{T.records.title}</h2>{tabs}</>}>
      {!summary ? (
        <div className="rec-wait">
          {failed ? (
            <>
              <p>{T.records.failed}</p>
              <button className="pill" onClick={load}>
                {T.records.retry}
              </button>
            </>
          ) : (
            T.records.loading
          )}
        </div>
      ) : tab === "overview" ? (
        <Overview
          me={me}
          summary={summary}
          offset={offset}
          passesOpen={passesOpen}
          onTile={(kind) => toTimeline(kind)}
          onChart={toChart}
          onSeen={() => setSeen(true)}
          onOpenBadges={onOpenBadges}
        />
      ) : tab === "timeline" ? (
        <Timeline summary={summary} offset={offset} passesOpen={passesOpen} start={start} joinedAt={me.joinedAt} />
      ) : (
        <Charts summary={summary} offset={offset} focus={chart} onDay={(day) => toTimeline(null, day)} />
      )}
    </Sheet>
  );
}
