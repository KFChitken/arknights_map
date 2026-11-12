"use client";

import { useState } from "react";
import { T } from "@/i18n";
import { REPORT_NOTE_MAX } from "@/lib/rules";
import { ROACH_REPORT_REASONS, type RoachReportReason } from "@/lib/safety";
import Sheet from "./Sheet";

/** 举报这只蟑螂: where someone put a roach on the map. It blocks nobody, so nothing between you changes. */
export default function RoachReportSheet({
  clone,
  onReport,
  onClose,
}: {
  clone: boolean;
  onReport: (reason: RoachReportReason, note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<RoachReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    await onReport(reason, note);
    setBusy(false);
  };
  return (
    <Sheet title={clone ? T.safety.reportClone : T.safety.reportRoach} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        {T.safety.reportNote}
      </p>
      <div className="chips" role="radiogroup" aria-label={T.safety.reason} style={{ marginBottom: 10 }}>
        {(Object.keys(ROACH_REPORT_REASONS) as RoachReportReason[]).map((r) => (
          <button key={r} role="radio" aria-checked={reason === r} className={`chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>
            {ROACH_REPORT_REASONS[r]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        maxLength={REPORT_NOTE_MAX}
        placeholder={T.safety.notePlaceholder}
        aria-label={T.safety.noteLabel}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="primary wide" style={{ marginTop: 10 }} disabled={!reason || busy} onClick={send}>
        {reason ? T.safety.report : T.safety.pickReason}
      </button>
    </Sheet>
  );
}
