"use client";

import { useState } from "react";
import { fmtParts, T } from "@/i18n";
import { MIN_SIGNUP_AGE, siteName } from "@/lib/rules";
import Sheet from "./Sheet";

/**
 * The admin asked this player to say again they are 18 or older: it stands in front of the map, as
 * 「隐私说明更新了」 does, until they say so or delete their account. Closing it is allowed; anything
 * others would see brings it back.
 */
export default function AgeCheckSheet({
  onConfirm,
  onDelete,
  onClose,
}: {
  onConfirm: () => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={T.ageCheck.title} onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        {fmtParts(T.ageCheck.ask, { age: MIN_SIGNUP_AGE, site: siteName() })}
      </p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy} onClick={confirm}>
          {fmtParts(T.consent.adultTick, { age: MIN_SIGNUP_AGE })}
        </button>
        <button className="pill" disabled={busy} onClick={onDelete}>
          {T.common.deleteAccount}
        </button>
      </div>
    </Sheet>
  );
}
