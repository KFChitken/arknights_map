"use client";

import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";

/** Tapped someone else's roach: offer the two ways to touch it. */
export function OtherRoachCard({
  roach,
  look,
  signedIn,
  sharesUid,
  friendName,
  onOpenFriend,
  onSignIn,
  onTouch,
  onClose,
}: {
  roach: PublicRoach;
  look: RoachStyle;
  /** Visitors who have not signed in are asked to, instead of being offered the two touches */
  signedIn: boolean;
  sharesUid: boolean;
  /** Set when the roach belongs to one of your 触须之交 */
  friendName?: string;
  onOpenFriend?: () => void;
  onSignIn: () => void;
  onTouch: (bold: boolean) => void;
  onClose: () => void;
}) {
  if (roach.bot) {
    return (
      <div className="card stack" role="dialog" aria-label="演示蟑螂">
        <div className="card-head">
          <RoachIcon color={roach.color} size={44} avatar={roach.avatar} look={look} />
          <div>
            <strong>一只路过的演示蟑螂</strong>
            <p className="muted">这是网站放的演示蟑螂，不是真人，碰不到 TA。</p>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
    );
  }
  const title = roach.guide
    ? "粥P地图向导（不是真人）"
    : friendName
      ? `触须之交 · ${friendName}${roach.clone ? " 的克隆体" : ""}`
      : roach.clone
        ? "某舟p的克隆体"
        : "一只匿名舟p";
  const hint = roach.guide
    ? "跟它练练伸出触须，它会马上碰回你。只有你看得到它。"
    : !signedIn
      ? "登录后就能伸出触须碰 TA。"
      : friendName
        ? "你们是触须之交，随时可以再碰碰 TA。"
        : roach.clone
          ? "碰它，触须会传给它的主人。"
          : "伸出触须碰一下 TA：";
  return (
    <div className="card stack" role="dialog" aria-label="伸出触须">
      <div className="card-head">
        <RoachIcon color={roach.color} size={44} avatar={roach.avatar} clone={roach.clone} friend={roach.friend} look={look} />
        <div>
          <strong>{title}</strong>
          <p className="muted">{hint}</p>
        </div>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            看看 TA
          </button>
        </div>
      )}
      {!signedIn ? (
        <button className="primary wide" onClick={onSignIn}>
          登录
        </button>
      ) : (
        <div className="touch-buttons">
          <button onClick={() => onTouch(false)}>
            偷偷伸出触须
            <small>TA 只知道被碰了一下</small>
          </button>
          <button className="bold" onClick={() => onTouch(true)}>
            大胆伸出触须
            <small>{sharesUid ? "TA 能看到你的资料和 UID" : "TA 能看到你的资料"}</small>
          </button>
        </div>
      )}
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

/** Tapped one of your own roaches. */
export function MyRoachCard({
  roach,
  index,
  avatar,
  color,
  look,
  onMove,
  onRemove,
  onClose,
}: {
  roach: OwnRoach;
  /** 1-based clone number; ignored for the main roach */
  index: number;
  avatar: RoachAvatar;
  color: RoachColor;
  look: RoachStyle;
  onMove: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const clone = roach.slot > 0;
  return (
    <div className="card stack" role="dialog" aria-label="我的蟑螂">
      <div className="card-head">
        <RoachIcon color={color} size={44} avatar={avatar} mine clone={clone} look={look} />
        <div>
          <strong>{clone ? `你的克隆体 ${index}` : "你的蟑螂本体"}</strong>
          <p className="muted">
            {clone ? "别人看到的是“某舟p的克隆体”，看不出是你的。" : "别人能看到它在哪，但看不出是你。"}
          </p>
        </div>
      </div>
      <div className="row-actions">
        <button className="pill" onClick={onMove}>
          挪个窝
        </button>
        <button className="pill" onClick={onRemove}>
          {clone ? "收回" : "收回（连同克隆体）"}
        </button>
      </div>
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}
