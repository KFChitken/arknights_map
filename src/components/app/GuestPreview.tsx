"use client";

import { roughText } from "@/lib/counts";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM, SITE_NAME } from "@/lib/rules";
import Sheet from "./Sheet";

/**
 * What a visitor who has not signed in can try: tap the map to see where their roach would go and
 * about how many are around. They get nobody's roaches (their map is 全员隐匿), so the server counts,
 * from the spot to about a kilometre (src/app/api/around), and keeps nothing of it.
 */

/** Counts rounded down by the server (counts.ts rough), in words */
function aroundText({ near, far }: { near: number; far: number }) {
  if (far === 0) return "这附近还没有舟P，来当第一只吧！";
  const close = near ? `${DECLARATION_RADIUS_KM} 公里内有 ${roughText(near)}舟P` : `${DECLARATION_RADIUS_KM} 公里内还没有舟P`;
  return `${close}，${RADAR_RADIUS_KM} 公里内有 ${roughText(far)}。`;
}

export function PreviewCard({
  around,
  onPlace,
  onClose,
}: {
  /** null while the server counts; failed: it could not */
  around: { near: number; far: number } | "failed" | null;
  onPlace: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card stack" role="dialog" aria-label="放在这里">
      <div className="card-head">
        <div>
          <strong>如果你把蟑螂放在这里</strong>
          <p className="muted">{around === "failed" ? "现在数不了，等一下再点点看。" : around ? aroundText(around) : "数一下……"}</p>
        </div>
      </div>
      <button className="primary wide" onClick={onPlace}>
        就放这里
      </button>
      <p className="hint" style={{ margin: 0 }}>
        点地图别处，可以换个地方看看。
      </p>
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

export function GuestRadarSheet({ onSignIn, onClose }: { onSignIn: () => void; onClose: () => void }) {
  return (
    <Sheet title="方舟雷达" onClose={onClose}>
      <p style={{ marginTop: 0 }}>点地图任意一处，看看那附近有多少舟P。</p>
      <p className="hint">登录后能看完整雷达：最近 24 小时谁爬进爬出、新面孔、附近的触须和宣言。</p>
      <button className="primary wide" style={{ marginTop: 14 }} onClick={onSignIn}>
        登录
      </button>
    </Sheet>
  );
}

export function WelcomeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title={`Welcome to ${SITE_NAME}。`}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          去地图上看看
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>都说舟P像蟑螂一样多，但事实如此吗？</p>
      <p>地图上的每只蟑螂都有着厚厚的伪装，而伪装下面是了解其他蟑螂的渴望。</p>
      <p>点地图任意一处，看看那附近大约有多少舟P；登录后就能看到大家在哪。想放下自己的蟑螂，用邮箱收个验证码就能登录，不用密码。</p>
    </Sheet>
  );
}

const WELCOMED = "zhoup.welcomed";

/** Whether this browser has seen the welcome card; unreadable storage counts as not seen. */
export function welcomed() {
  try {
    return localStorage.getItem(WELCOMED) === "1";
  } catch {
    return false;
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(WELCOMED, "1");
  } catch {}
}
