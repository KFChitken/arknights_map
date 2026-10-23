"use client";

import { useState } from "react";
import { REPORT_NOTE_MAX } from "@/lib/rules";
import { REPORT_REASONS, type ReportReason } from "@/lib/safety";
import Sheet from "./Sheet";

/** 拉黑或举报 whoever sent an inbox item, or a 触须之交. who is null when you never saw who it was. */
export default function SafetySheet({
  who,
  onBlock,
  onReport,
  onBack,
  onClose,
}: {
  who: string | null;
  onBlock: () => Promise<void>;
  onReport: (reason: ReportReason, note: string) => Promise<void>;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const them = who ?? "这只匿名舟p";

  return (
    <Sheet title="拉黑或举报" onBack={onBack} onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>拉黑 {them}</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        拉黑后，TA 的触碰、宣言和回应都不会再送到你这里，你们也不再是触须之交。TA 不会知道被拉黑了。在「我的资料」里可以随时解除。
      </p>
      <button className="danger wide" disabled={busy} onClick={() => run(onBlock)}>
        拉黑
      </button>

      <h3 style={{ marginTop: 22 }}>举报 {them}</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        举报只有管理员能看到，TA 不会知道是谁举报的。举报的同时也会拉黑 TA。
      </p>
      <div className="chips" role="radiogroup" aria-label="举报理由" style={{ marginBottom: 10 }}>
        {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
          <button key={r} role="radio" aria-checked={reason === r} className={`chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>
            {REPORT_REASONS[r]}
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
      <button
        className="primary wide"
        style={{ marginTop: 10 }}
        disabled={!reason || busy}
        onClick={() => reason && run(() => onReport(reason, note))}
      >
        {reason ? "举报并拉黑" : "先选一个理由"}
      </button>
    </Sheet>
  );
}
