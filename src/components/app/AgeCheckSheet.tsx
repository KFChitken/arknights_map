"use client";

import { useState } from "react";
import { MIN_SIGNUP_AGE, SITE_NAME } from "@/lib/rules";
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
    <Sheet title="确认一下年龄" onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        站长想再确认一下：你满 {MIN_SIGNUP_AGE} 岁了吗？{SITE_NAME}只对满 {MIN_SIGNUP_AGE} 岁的人开放。
      </p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy} onClick={confirm}>
          我已满 {MIN_SIGNUP_AGE} 岁
        </button>
        <button className="pill" disabled={busy} onClick={onDelete}>
          删除我的账号
        </button>
      </div>
    </Sheet>
  );
}
