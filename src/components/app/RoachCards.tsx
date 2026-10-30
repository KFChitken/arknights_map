"use client";

import { bottleIcon } from "@/lib/flipArt";
import { SITE_NAME } from "@/lib/rules";
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
  // asleep: drunk or away a long time; nobody can tell which
  const asleep = Boolean(roach.asleep) && !roach.clone;
  const title = roach.guide
    ? `${SITE_NAME}向导（不是真人）`
    : friendName
      ? `触须之交 · ${friendName}${roach.clone ? " 的克隆体" : ""}`
      : roach.clone
        ? "某舟P的克隆体"
        : asleep
          ? "一只翻肚皮的匿名舟P"
          : "一只匿名舟P";
  const hint = roach.guide
    ? "跟它练练伸出触须，它会马上碰回你。只有你看得到它。"
    : asleep
      ? friendName
        ? "TA 四脚朝天睡着了。"
        : "它四脚朝天睡着了。是喝多了还是好久没来，谁也说不准。"
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
        <RoachIcon
          color={roach.color}
          size={44}
          avatar={roach.avatar}
          clone={roach.clone}
          friend={roach.friend}
          look={look}
          asleep={asleep}
          zzz
          anim
        />
        <div>
          <strong>
            {title}
            {asleep && <span className="zz">{friendName ? "睡着了" : "理智回复中"}</span>}
          </strong>
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

/** Tapped one of your own roaches. The main roach can 摄入酒精, and 醒酒 while drunk. */
export function MyRoachCard({
  roach,
  index,
  avatar,
  color,
  look,
  drunk,
  drinks,
  busy,
  onMove,
  onRemove,
  onDrink,
  onSober,
  onClose,
}: {
  roach: OwnRoach;
  /** 1-based clone number; ignored for the main roach */
  index: number;
  avatar: RoachAvatar;
  color: RoachColor;
  look: RoachStyle;
  /** The main roach lies drunk */
  drunk: boolean;
  /** Times drunk so far, for 泰拉异格酒神 */
  drinks: number;
  /** A drink or 醒酒 is under way */
  busy: boolean;
  onMove: () => void;
  onRemove: () => void;
  onDrink: () => void;
  onSober: () => void;
  onClose: () => void;
}) {
  const clone = roach.slot > 0;
  const asleep = drunk && !clone;
  return (
    <div className="card stack" role="dialog" aria-label="我的蟑螂">
      <div className="card-head">
        <RoachIcon color={color} size={44} avatar={avatar} mine clone={clone} look={look} asleep={asleep} zzz anim />
        <div>
          <strong>
            {clone ? `你的克隆体 ${index}` : "你的蟑螂本体"}
            {asleep && <span className="zz">理智回复中</span>}
          </strong>
          <p className="muted">
            {clone
              ? "别人看到的是“某舟P的克隆体”，地图上不写是谁的。"
              : asleep
                ? "不点的话，早上 8 点自己醒。"
                : "别人能看到它在哪，地图上不写是谁的。"}
          </p>
        </div>
      </div>
      <div className="row-actions">
        <button className="pill" onClick={onMove}>
          挪个窝
        </button>
        {!clone &&
          (asleep ? (
            <button className="pill" disabled={busy} onClick={onSober}>
              醒酒
            </button>
          ) : (
            <button className="pill wine" disabled={busy} onClick={onDrink}>
              <span dangerouslySetInnerHTML={{ __html: bottleIcon(15) }} />
              摄入酒精
            </button>
          ))}
        <button className="pill" onClick={onRemove}>
          {clone ? "收回" : "收回（连同克隆体）"}
        </button>
      </div>
      {!clone && (
        <p className="tally">
          {drinks >= 50 ? `已醉倒 ${drinks} 次，「泰拉异格酒神」到手了` : `已醉倒 ${drinks}/50 次，满了解锁「泰拉异格酒神」`}
        </p>
      )}
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}
