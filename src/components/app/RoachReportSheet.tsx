"use client";

import { useState } from "react";
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
    <Sheet title={clone ? "举报这只克隆体" : "举报这只蟑螂"} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        只有站长能看到。不会拉黑对方，你们之间的消息照常。
      </p>
      <div className="chips" role="radiogroup" aria-label="举报理由" style={{ marginBottom: 10 }}>
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
        placeholder="想补充的话（选填）"
        aria-label="补充说明"
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="primary wide" style={{ marginTop: 10 }} disabled={!reason || busy} onClick={send}>
        {reason ? "举报" : "先选一个理由"}
      </button>
    </Sheet>
  );
}
