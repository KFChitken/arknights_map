"use client";

import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";

/** Tapped someone else's roach: offer the two ways to touch it. */
export function OtherRoachCard({
  roach,
  look,
  sharesUid,
  friendName,
  onOpenFriend,
  onTouch,
  onClose,
}: {
  roach: PublicRoach;
  look: RoachStyle;
  sharesUid: boolean;
  /** Set when the roach belongs to one of your 触须之交 */
  friendName?: string;
  onOpenFriend?: () => void;
  onTouch: (bold: boolean) => void;
  onClose: () => void;
}) {
  const title = friendName
    ? `触须之交 · ${friendName}${roach.clone ? " 的克隆体" : ""}`
    : roach.clone
      ? "某舟p的克隆体"
      : "一只匿名舟p";
  return (
    <div className="card stack" role="dialog" aria-label="伸出触须">
      <div className="card-head">
        <RoachIcon color={roach.color} size={44} avatar={roach.avatar} clone={roach.clone} friend={roach.friend} look={look} />
        <div>
          <strong>{title}</strong>
          <p className="muted">
            {friendName ? "你们是触须之交，随时可以再碰碰 TA。" : roach.clone ? "碰它，触须会传给它的主人。" : "伸出触须碰一下 TA："}
          </p>
        </div>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            看看 TA
          </button>
        </div>
      )}
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
