"use client";

import { useState } from "react";
import { ADULT_TICK, CROSS_BORDER_TICK, PUBLIC_PLACE_NOTE, PUBLIC_PLACE_TICK } from "@/lib/consent";
import { MIN_SIGNUP_AGE, SITE_NAME } from "@/lib/rules";
import Sheet from "./Sheet";

/** What changed in the privacy policy this time (POLICY_UPDATED_AT); the next change replaces it. */
const CHANGES = [
  `现在只对满 ${MIN_SIGNUP_AGE} 岁的玩家开放；`,
  "你的信息存在腾讯云香港服务器，验证码由 Resend USA 发送，需要你单独同意；",
  "放下的蟑螂所有人（包括游客）都能看到确切位置，需要你单独同意。",
];

/**
 * 隐私说明更新了: an account that agreed to an older policy ticks what new players
 * tick at sign-up, or signs out. Closing it is allowed; whatever needs agreeing
 * brings it back.
 */
export default function ConsentSheet({
  onAgree,
  onSignOut,
  onDelete,
  onClose,
}: {
  onAgree: (ticks: { adult: boolean; acceptCrossBorder: boolean; acceptPublicPlace: boolean }) => Promise<void>;
  onSignOut: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [adult, setAdult] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [place, setPlace] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [busy, setBusy] = useState(false);

  if (underage) {
    return (
      <Sheet title="隐私说明更新了" onClose={onClose}>
        <p className="consent-sorry">
          很抱歉，{SITE_NAME}现在只对满 {MIN_SIGNUP_AGE} 岁的玩家开放。
        </p>
        <div className="consent-actions">
          <button className="danger wide" onClick={onDelete}>
            删除我的账号
          </button>
          <button className="pill" onClick={() => setUnderage(false)}>
            返回
          </button>
        </div>
      </Sheet>
    );
  }

  const agree = async () => {
    setBusy(true);
    try {
      await onAgree({ adult, acceptCrossBorder: abroad, acceptPublicPlace: place });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="隐私说明更新了" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        主要有三处变化：
      </p>
      <ol className="consent-changes">
        {CHANGES.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <a className="consent-full" href="/privacy" target="_blank" rel="noreferrer">
        看完整说明
      </a>
      <div className="ticks">
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{ADULT_TICK}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} />
          <span>
            {CROSS_BORDER_TICK}{" "}
            <a href="/privacy#abroad" target="_blank" rel="noreferrer">
              详情
            </a>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
          <span>{PUBLIC_PLACE_TICK}</span>
        </label>
      </div>
      <p className="hint">{PUBLIC_PLACE_NOTE}</p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy || !adult || !abroad || !place} onClick={agree}>
          {busy ? "保存中…" : "同意并继续"}
        </button>
        <button className="pill" onClick={onSignOut}>
          先不同意，退出登录
        </button>
        <button className="link" onClick={() => setUnderage(true)}>
          我还不满 {MIN_SIGNUP_AGE} 岁
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Asked before a roach goes down: before the first one, whether the player agrees
 * its spot is public; after signing in from a spot picked as a visitor, whether to put it there.
 */
export function PlaceConfirm({ consent, onConfirm, onRethink }: { consent: boolean; onConfirm: () => void; onRethink: () => void }) {
  return (
    <Sheet title={consent ? "放下之前" : "放下蟑螂"} onClose={onRethink}>
      <p className="consent-place">{consent ? PUBLIC_PLACE_NOTE : "把蟑螂放在刚才选的地方吗？"}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onConfirm}>
          确认
        </button>
        <button className="pill" onClick={onRethink}>
          再想想
        </button>
      </div>
    </Sheet>
  );
}
