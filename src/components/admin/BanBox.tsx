"use client";

import { useState } from "react";
import { BAN_REASON_MAX, FRESH_MINUTES } from "@/lib/adminConsole";
import { AdminError, errorWords } from "./api";
import { useConsole } from "./context";
import { CodeInput } from "./ui";

/**
 * 封号, opened beside its button: it cannot be taken back, so it says what goes and asks for a code from the
 * authenticator, unless one was typed on this device in the last FRESH_MINUTES. Never held for 撤销: done at once.
 */
export default function BanBox({ onBan, onClose }: { onBan: (fresh: string) => Promise<void>; onClose: () => void }) {
  const { needsFresh } = useConsole();
  const [need, setNeed] = useState(needsFresh);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (need && code.length < 6) return;
    setBusy(true);
    try {
      await onBan(code);
    } catch (e) {
      if (e instanceof AdminError && e.code === "ADMIN_FRESH") setNeed(true);
      setNote(errorWords(e));
      setCode("");
      setBusy(false);
    }
  };
  return (
    <div className="ac-ban" role="group" aria-label="封号">
      <strong>封号收不回</strong>
      <p>
        TA 的账号和数据都会删掉，这个邮箱（连同加「+」、Gmail 加点的写法）以后不能再登录。
        {need ? "封号要再输一次验证器里的数字。" : `${FRESH_MINUTES} 分钟内在这台设备上输过验证器里的数字，这次不用再输。`}
      </p>
      {need && (
        <label className="ac-field">
          验证器里的 6 位数字
          <CodeInput value={code} onChange={setCode} invalid={Boolean(note)} autoFocus onEnter={go} />
        </label>
      )}
      {note && (
        <p role="alert" className="ac-error">
          {note}
        </p>
      )}
      <div className="ac-row">
        <button type="button" className="ac-btn danger-solid" onClick={go} disabled={busy || (need && code.length < 6)}>
          {busy ? "正在封号…" : "确认封号"}
        </button>
        <button type="button" className="ac-btn" onClick={onClose} disabled={busy}>
          算了
        </button>
      </div>
    </div>
  );
}

/**
 * 提请封号, a moderator's in the place of 封号 (only the owner bans): why, for the owner, who confirms it with a code
 * or sends it back (adminRequests.ts). The rule is the one picked above it.
 */
export function BanRequestBox({ onAsk, onClose }: { onAsk: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await onAsk(reason.trim());
    } catch (e) {
      setNote(errorWords(e));
    }
    setBusy(false);
  };
  return (
    <div className="ac-ban" role="group" aria-label="提请封号">
      <strong>提请封号</strong>
      <p>管理员不能直接封号：写一句为什么，站长确认了才会封。等站长的时候，可以先暂停 TA 的互动。</p>
      <label className="ac-field">
        为什么要封（站长会看到）
        <textarea
          rows={3}
          value={reason}
          maxLength={BAN_REASON_MAX}
          autoFocus
          onChange={(e) => {
            setReason(e.target.value);
            setNote(null);
          }}
        />
      </label>
      {note && (
        <p role="alert" className="ac-error">
          {note}
        </p>
      )}
      <div className="ac-row">
        <button type="button" className="ac-btn primary" onClick={go} disabled={busy || !reason.trim()}>
          {busy ? "正在交给站长…" : "交给站长"}
        </button>
        <button type="button" className="ac-btn" onClick={onClose} disabled={busy}>
          算了
        </button>
      </div>
    </div>
  );
}
