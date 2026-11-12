"use client";

import { useState } from "react";
import { fmtParts, T } from "@/i18n";
import { REPORT_NOTE_MAX } from "@/lib/rules";
import { noteMissing, REPORT_REASONS, type ReportReason } from "@/lib/safety";
import Sheet from "./Sheet";

/** What the note box asks for, by reason: 「其他」 must say what happened */
const NOTE_ASKS: Partial<Record<ReportReason, string>> = {
  get other() {
    return T.safety.noteAsk.otherReason;
  },
  get contact() {
    return T.safety.noteAsk.contact;
  },
};

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
  const them = who ?? T.safety.thisAnonymous;
  const missing = reason !== null && noteMissing(reason, note);

  return (
    <Sheet title={T.safety.title} onBack={onBack} onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>{fmtParts(T.safety.blockThem, { them: them })}</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        {T.safety.blockNote}
      </p>
      <button className="danger wide" disabled={busy} onClick={() => run(onBlock)}>
        {T.safety.block}
      </button>

      <h3 style={{ marginTop: 22 }}>{fmtParts(T.safety.reportThem, { them: them })}</h3>
      <p className="hint" style={{ marginBottom: 10 }}>
        {T.safety.reportBlockNote}
      </p>
      <div className="chips" role="radiogroup" aria-label={T.safety.reason} style={{ marginBottom: 10 }}>
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
        placeholder={(reason && NOTE_ASKS[reason]) || T.safety.notePlaceholder}
        aria-label={T.safety.noteLabel}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        className="primary wide"
        style={{ marginTop: 10 }}
        disabled={!reason || missing || busy}
        onClick={() => reason && !missing && run(() => onReport(reason, note))}
      >
        {!reason ? T.safety.pickReason : missing ? T.safety.writeFirst : T.safety.reportAndBlock}
      </button>
    </Sheet>
  );
}
