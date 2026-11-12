"use client";

import { AMIYA_ID, AMIYA_NAME } from "@/lib/amiya";
import { MINGHE_ID, MINGHE_LINES, MINGHE_NAME, RIDE_STOPS } from "@/lib/minghe";
import { PERLICA_ID, PERLICA_MORE, PERLICA_NAME } from "@/lib/perlica";
import { FIRE_LINES, TALULAH_ID, TALULAH_NAME, type FireLevel } from "@/lib/talulah";
import { bottleIcon } from "@/lib/flipArt";
import { POKE_EVERY_DAYS } from "@/lib/rules";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { ReactNode } from "react";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { DRAW_HERE } from "../admin/ZoneDraw";
import { MingheRoute } from "./Minghe";

/** Tapped someone else's roach: offer the two ways to touch it, or 戳一戳 a 触须之交's sleeping one. */
export function OtherRoachCard({
  roach,
  look,
  signedIn,
  waiting = false,
  sharesUid,
  friendName,
  pokeAgainAt,
  touched,
  perlicaTimer = false,
  perlicaGuarding = false,
  amiyaMusic,
  fire,
  minghe,
  friendRow,
  busy,
  touching = false,
  onOpenFriend,
  onSignIn,
  onTouch,
  onPoke,
  onReport,
  admin,
  onClose,
}: {
  roach: PublicRoach;
  look: RoachStyle;
  /** Visitors who have not signed in are asked to, instead of being offered the two touches */
  signedIn: boolean;
  /** Signed in on this browser before, and who it is has not come yet: no 「登录」 meanwhile */
  waiting?: boolean;
  sharesUid: boolean;
  /** Set when the roach belongs to one of your 触须之交 */
  friendName?: string;
  /** You poked this 触须之交 lately: when you may again */
  pokeAgainAt: number | null;
  /**
   * You touched this roach from this page within the day: sneakily, when a bold touch still goes and
   * says who that was, or boldly, when nothing more goes till tomorrow (src/lib/server/world.ts touch())
   */
  touched?: "sneaky" | "bold";
  /** 佩丽卡监督's 离开计时 is on, which her card mentions */
  perlicaTimer?: boolean;
  /** 佩丽卡监督 is keeping watch beside your drunk main roach */
  perlicaGuarding?: boolean;
  /** 阿米娅向导's dance music: on or off in this browser, and switching it */
  amiyaMusic?: { on: boolean; onToggle: () => void };
  /**
   * 塔露拉干员's fire, on her card: how many roaches sit by it and how big it burns,
   * whether one of yours is there, her line to 初始 hoods (once), and sending a clone over
   */
  fire?: {
    count: number;
    level: FireLevel;
    seated: boolean;
    hood: string | null;
    sending: boolean;
    onSend: () => void;
    onVisit: () => void;
  };
  /**
   * 明河都尉, on his card: today's day of his journey, where he is and goes next, his line
   * about the place, how many roaches ride with him, and your clone riding along or getting on
   */
  minghe?: {
    day: number;
    today: string;
    tomorrow: string;
    line: string;
    riders: number;
    riding: boolean;
    sending: boolean;
    onRide: () => void;
    onDismount: () => void;
  };
  /** 触须之交专属 (FriendActions), on a roach of a 触须之交: 戳一戳 is in it while they sleep */
  friendRow?: ReactNode;
  /** A poke is under way */
  busy: boolean;
  /** A touch is on its way: the touch buttons wait, so a second tap is not the same touch twice */
  touching?: boolean;
  onOpenFriend?: () => void;
  onSignIn: () => void;
  onTouch: (bold: boolean) => void;
  onPoke: () => void;
  /** 举报这只蟑螂: where a player put it; never offered on the guides */
  onReport?: () => void;
  /** 站长清理, only on an admin's map: take this roach back, or every roach near it, at once; or draw a 禁放区 round it */
  admin?: { busy: boolean; onTakeBack: () => void; onTakeBackNear: () => void; onDraw?: () => void };
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
  // 触须之交 poke a sleeping roach instead of touching it
  const pokeable = asleep && Boolean(friendName);
  const daysToWait = pokeAgainAt ? Math.ceil((pokeAgainAt - Date.now()) / 86_400_000) : 0;
  const perlica = roach.guide && roach.id === PERLICA_ID;
  const talulah = roach.guide && roach.id === TALULAH_ID && fire;
  const ride = roach.guide && roach.id === MINGHE_ID && minghe;
  const title = roach.guide
    ? perlica
      ? PERLICA_NAME
      : talulah
        ? TALULAH_NAME
        : ride
          ? MINGHE_NAME
          : AMIYA_NAME
    : friendName
      ? `触须之交 · ${friendName}${roach.clone ? " 的克隆体" : ""}`
      : roach.clone
        ? "某舟P的克隆体"
        : asleep
          ? "一只翻肚皮的匿名舟P"
          : "一只匿名舟P";
  // who she is, above what she does
  const about = perlica
    ? perlicaTimer
      ? "终末地工业监督。负责协议源石技术、帝江号，还有记住管理员离开了多久。"
      : "终末地工业监督。负责协议源石技术和帝江号。"
    : talulah
      ? (talulah.hood ?? "整合运动的创始人，刚上岛的罗德岛干员。现在在太阳岛守着一堆火。")
      : ride
        ? MINGHE_LINES.intro
        : null;
  const hint = talulah
    ? `现在火边坐着 ${talulah.count.toLocaleString()} 只蟑螂`
    : ride
    ? `今天在：${ride.today}。明天去：${ride.tomorrow}。`
    : perlica
    ? friendName
      ? perlicaTimer
        ? "你们是触须之交。你每次离开多久，她都记着。"
        : "你们是触须之交。"
      : perlicaTimer
        ? "她每天会用一样的方式碰回你一次，也会记着你每次离开多久。"
        : "她每天会用一样的方式碰回你一次。"
    : roach.guide
    ? !signedIn
      ? waiting
        ? "正在读取你的账号…"
        : "登录后就能碰她。"
      : friendName
        ? "你们是触须之交，她每天会跟你打招呼。"
        : "她每天会用一样的方式碰回你一次。"
    : asleep
      ? friendName
        ? "TA 四脚朝天睡着了。戳一戳，TA 醒来就知道你来过。"
        : "它四脚朝天睡着了。是喝多了还是好久没来，谁也说不准。"
      : !signedIn
        ? waiting
          ? "正在读取你的账号…"
          : "登录后就能伸出触须碰 TA。"
        : touched === "sneaky"
          ? "今天偷偷碰过 TA 了。想让 TA 知道是你，就大胆碰一下："
          : touched === "bold"
            ? "今天大胆碰过 TA 了，明天再来吧。"
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
            {asleep && <span className="zz">{friendName ? "睡着了" : "理智恢复中"}</span>}
          </strong>
          {about && <p className="muted">{about}</p>}
          {perlica && perlicaGuarding && <p className="muted">{PERLICA_MORE.guarding}</p>}
          <p className="muted">{hint}</p>
          {talulah && (
            <>
              <p className="muted">{FIRE_LINES[talulah.level]}</p>
              <p className="hint fire-note">派的是克隆体，不用真去哈尔滨。</p>
            </>
          )}
          {roach.guide && roach.id === AMIYA_ID && (
            <p className="hint fire-note">
              舞蹈和音乐：疚刃（bilibili）的视频
              {amiyaMusic && (
                <button className="link amiya-music" onClick={amiyaMusic.onToggle}>
                  {amiyaMusic.on ? "🔊 跳舞时放音乐" : "🔇 跳舞时不放音乐"}
                </button>
              )}
            </p>
          )}
          {ride && (
            <>
              <p className="muted">「{ride.line}」</p>
              <p className="muted">现在有 {ride.riders.toLocaleString()} 只蟑螂跟着他</p>
              <MingheRoute day={ride.day} />
              <p className="hint fire-note">跟他走的是克隆体，不用真去。</p>
            </>
          )}
        </div>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            看看 TA
          </button>
        </div>
      )}
      {ride ? (
        <>
          <div className="touch-buttons">
            <button disabled={touching} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
              偷偷伸出触须
              <small>他只知道被碰了一下</small>
            </button>
            <button disabled={touching} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
              大胆伸出触须
              <small>{sharesUid ? "他能看到你的资料和 UID" : "他能看到你的资料"}</small>
            </button>
          </div>
          {signedIn && ride.riding ? (
            <button className="primary wide fire-send" disabled={ride.sending} onClick={ride.onDismount}>
              在这一站下马
            </button>
          ) : (
            <button className="primary wide fire-send" disabled={ride.sending} onClick={ride.onRide}>
              {signedIn ? "派一只克隆体跟他走" : "登录后就能跟他走"}
            </button>
          )}
        </>
      ) : talulah ? (
        <>
          <div className="touch-buttons">
            <button disabled={touching} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
              偷偷伸出触须
              <small>TA 只知道被碰了一下</small>
            </button>
            <button disabled={touching} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
              大胆伸出触须
              <small>{sharesUid ? "TA 能看到你的资料和 UID" : "TA 能看到你的资料"}</small>
            </button>
          </div>
          {signedIn && talulah.seated ? (
            <div className="fire-row">
              <span>你的蟑螂已经在火边了</span>
              <button className="pill dark" onClick={talulah.onVisit}>
                过去看看
              </button>
            </div>
          ) : (
            <button className="primary wide fire-send" disabled={talulah.sending} onClick={talulah.onSend}>
              {signedIn ? "派一只克隆体去烤火" : "登录后就能过来烤火"}
            </button>
          )}
        </>
      ) : !signedIn ? (
        <button className="primary wide" disabled={waiting} onClick={onSignIn}>
          {waiting ? "稍等…" : "登录"}
        </button>
      ) : pokeable && friendRow ? null : pokeable ? (
        <button className="poke-btn" disabled={busy || daysToWait > 0} onClick={onPoke}>
          {daysToWait > 0 ? "戳过了" : "戳一戳"}
          <small>{daysToWait > 0 ? `${daysToWait} 天后可以再戳` : `每 ${POKE_EVERY_DAYS} 天能戳一次`}</small>
        </button>
      ) : (
        <div className="touch-buttons">
          <button disabled={touching || Boolean(touched)} onClick={() => onTouch(false)}>
            偷偷伸出触须
            <small>{touched ? "今天碰过了" : "TA 只知道被碰了一下"}</small>
          </button>
          <button disabled={touching || touched === "bold"} className="bold" onClick={() => onTouch(true)}>
            大胆伸出触须
            <small>{touched === "bold" ? "今天碰过了" : sharesUid ? "TA 能看到你的资料和 UID" : "TA 能看到你的资料"}</small>
          </button>
        </div>
      )}
      {signedIn && friendRow}
      {signedIn && !roach.guide && onReport && (
        <button className="link report-roach" onClick={onReport}>
          举报这只蟑螂
        </button>
      )}
      {admin && !roach.guide && (
        <div className="row-actions">
          <button className="danger" disabled={admin.busy} onClick={admin.onTakeBack}>
            站长：收回这只
          </button>
          <button className="danger" disabled={admin.busy} onClick={admin.onTakeBackNear}>
            站长：收回附近一片
          </button>
          {admin.onDraw && (
            <button className="danger" disabled={admin.busy} onClick={admin.onDraw}>
              {DRAW_HERE}
            </button>
          )}
        </div>
      )}
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

/** Tapped one of your own roaches. The main roach can 摄入酒精, and 醒酒 or ⚡舟友的酒⚡ while drunk. */
export function MyRoachCard({
  roach,
  index,
  avatar,
  color,
  look,
  drunk,
  drinks,
  busy,
  riding,
  party,
  visits,
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
  /** This clone rides with 明河都尉: the how-manieth station it is at (1–7), and getting it off */
  riding?: { stops: number; onDismount: () => void };
  /** ⚡舟友的酒⚡ while the main roach lies drunk (PartyScene): whether it is on, and starting or stopping it */
  party?: { on: boolean; onToggle: () => void };
  /** 串门: sending a guest home, and this clone going home or following its host who moved */
  visits?: { onSendHome: (friendId: string) => void; onGoHome: () => void; onFollow: () => void };
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
            {asleep && <span className="zz">理智恢复中</span>}
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
      {visits && roach.guests && (
        <div className="visit-guests">
          <p className="muted">家里有 {roach.guests.length} 位客人</p>
          {roach.guests.map((g) => (
            <div className="visit-row" key={g.friendId}>
              <strong>{g.name}</strong>
              <button className="pill" disabled={busy} onClick={() => visits.onSendHome(g.friendId)}>
                请 TA 回家
              </button>
            </div>
          ))}
        </div>
      )}
      {visits && roach.visit && (
        <div className="fire-row">
          <span>
            {roach.visit.left === "moved"
              ? `${roach.visit.name} 搬家了，你的克隆体还在老地方`
              : roach.visit.left === "removed"
                ? `${roach.visit.name} 收回了那只蟑螂，你的克隆体还在老地方`
                : `在 ${roach.visit.name} 家做客`}
          </span>
          {roach.visit.left === "moved" && (
            <button className="pill dark" disabled={busy} onClick={visits.onFollow}>
              跟过去
            </button>
          )}
          <button className="pill" disabled={busy} onClick={visits.onGoHome}>
            回家
          </button>
        </div>
      )}
      {riding && (
        <div className="fire-row">
          <span>
            正在跟明河走：第 {riding.stops} / {RIDE_STOPS} 站
          </span>
          <button className="pill dark" disabled={busy} onClick={riding.onDismount}>
            在这一站下马
          </button>
        </div>
      )}
      <div className="row-actions">
        <button className="pill" onClick={onMove}>
          挪个窝
        </button>
        {!clone &&
          (asleep ? (
            <>
              <button className="pill" disabled={busy} onClick={onSober}>
                醒酒
              </button>
              {party && (
                <button className={`pill ${party.on ? "" : "party-btn"}`} disabled={busy} onClick={party.onToggle}>
                  {party.on ? "停下来" : "⚡舟友的酒⚡"}
                </button>
              )}
            </>
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
      {asleep && party && <p className="tally">⚡舟友的酒⚡只在你自己的屏幕上放。音乐：活跃黑江乐（bilibili）的视频</p>}
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
