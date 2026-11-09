"use client";
/* eslint-disable @next/next/no-img-element -- one small PNG, which next/image would only copy */

import Sheet from "./Sheet";

const BILIBILI = "https://space.bilibili.com/481828661";
const QQ_GROUP = "1108446109";
/** What the group's QR code opens: QQ's page for joining the group */
const QQ_JOIN = "https://qm.qq.com/q/N2JAcrxeAC";

/** The notice (src/lib/notice.ts), word for word as its author wrote it */
export default function NoticeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="‼️重要公告‼️"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          知道了
        </button>
      }
    >
      <div className="notice">
        <p>我们的B站视频被审核拿下了，说蟑螂和皱皮是网暴...</p>
        <p>希望麻烦大家做两件事：</p>
        <ol>
          <li>
            关注B站
            <a href={BILIBILI} target="_blank" rel="noreferrer">
              Breeze青嵐
            </a>
            ：新视频（在熬夜做），最新动态/更新都会在这，有限流就需要大家的支持
          </li>
          <li>
            加Q裙{QQ_GROUP}，如果有任何反馈，可以在这里说！（群主是小姐姐可撩）
            <a className="notice-qr" href={QQ_JOIN} target="_blank" rel="noreferrer" aria-label={`加入QQ群 ${QQ_GROUP}`}>
              <img src="/notice/qq-group.png" alt={`QQ群 ${QQ_GROUP} 的二维码`} width={160} height={160} />
              <span>扫一扫，或者点二维码加群</span>
            </a>
          </li>
        </ol>
        <p>由衷感谢大家的支持！没想到一晚上就能壮大成这样。虽然B站还在卡，但我不会放弃的。我这边时差原因已经通宵了，希望皱皮地图能顺利启动！</p>
      </div>
    </Sheet>
  );
}
