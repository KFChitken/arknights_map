"use client";

import { useState } from "react";
import { FRESH_MINUTES } from "@/lib/adminConsole";
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
