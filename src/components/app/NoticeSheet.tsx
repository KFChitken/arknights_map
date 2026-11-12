"use client";
/* eslint-disable @next/next/no-img-element -- one small PNG, which next/image would only copy */

import Sheet from "./Sheet";

const BILIBILI = "https://space.bilibili.com/481828661";
const QQ_GROUP = "1108446109";
/** What the group's QR code opens: QQ's page for joining the group */
const QQ_JOIN = "https://qm.qq.com/q/N2JAcrxeAC";

/** The notice (src/lib/notice.ts), in its author's words */
export default function NoticeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="欢迎来到舟P地图"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          知道了
        </button>
      }
    >
      <div className="notice">
        <p>大家好，我是 Breeze！一转眼地图上已经快 8 万只蟑螂了，真的谢谢大家 (≧▽≦) 人多起来以后，有几件事更想拜托大家：</p>

        <h3>1. 保护隐私｜保护自己｜保护网站</h3>
        <ul>
          <li>别把蟑螂放在自己的住址（家门口、宿舍楼下），放在附近的商场、地铁站就好。已经放了的，在「我的蟑螂」里点「挪窝」。</li>
          <li>UID 栏只填游戏 UID，别写 QQ、微信、手机号。</li>
        </ul>
        <p>舟P地图希望舟u们玩得开心，但最不希望的，是给有心之人搭了桥。保护好个人隐私，网站也能更耐活～</p>

        <h3>2. 不要用蟑螂摆能认出来的字或图案</h3>
        <p>明白大家想玩 325 这些梗，之后会加上的！但地图上的所有东西都要谨慎，我们不是 wplace。</p>

        <h3>3. 守护地图社区，必要时举报</h3>
        <p>为了让舟u们都有好的体验，发现任何可疑行为，请记得举报或直接反馈，交给站长处理：</p>
        <ul>
          <li>消息里每条下面、TA 的资料页最下面、地图上蟑螂的卡片里，都能举报。</li>
          <li>举报只有站长看得到，TA 不会知道是谁；处理完会在消息里告诉你结果。</li>
        </ul>

        <h3>4. 关注近期 &amp; 后续更新</h3>
        <ul>
          <li>服务器升级了（买！）</li>
          <li>验证码额度 +100%（买！）</li>
          <li>高德地图应该更丝滑了</li>
          <li>正在为 10 万舟u做准备！晚上人多时线路偶尔被限流，可能会卡一下～</li>
        </ul>
        <p>
          后续更新请关注 B站「
          <a href={BILIBILI} target="_blank" rel="noreferrer">
            Breeze青嵐
          </a>
          」；任何反馈欢迎加企鹅群 {QQ_GROUP}：
        </p>
        <a className="notice-qr" href={QQ_JOIN} target="_blank" rel="noreferrer" aria-label={`加入QQ群 ${QQ_GROUP}`}>
          <img src="/notice/qq-group.png" alt={`QQ群 ${QQ_GROUP} 的二维码`} width={160} height={160} />
          <span>扫一扫，或者点二维码加群</span>
        </a>
        <p className="notice-thanks">再次感谢大家！</p>
      </div>
    </Sheet>
  );
}
