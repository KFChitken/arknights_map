"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { AMIYA, AMIYA_ID } from "@/lib/amiya";
import { MINGHE, MINGHE_ID, MINGHE_LINES, RIDE_STOPS } from "@/lib/minghe";
import { PERLICA, PERLICA_ID, PERLICA_MORE } from "@/lib/perlica";
import { FIRE_LINES, TALULAH, TALULAH_ID, type FireLevel } from "@/lib/talulah";
import { RECALL_REST_MS, SI, SI_LINES } from "@/lib/si";
import { bottleIcon } from "@/lib/flipArt";
import { POKE_EVERY_DAYS, TOUCHES_PER_DAY } from "@/lib/rules";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import { useState, type ReactNode } from "react";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { DRAW_HERE } from "../admin/ZoneDraw";
import { MingheRoute } from "./Minghe";
import { inkLine } from "./Si";
import { touchesNow, turnsAtText, useTick, waitParts } from "./dayTurns";
import type { inkNow } from "@/lib/siInn";

/**
 * What someone else's roach is called on its card, and in the list of those lying on top of each other
 * (StackPicker): a 触须之交's by name, anyone else's only as 某舟P's, the same for all of theirs
 */
export function roachTitle(roach: Pick<PublicRoach, "clone" | "asleep" | "bot">, friendName?: string): string {
  if (roach.bot) return T.cards.demo.label;
  if (friendName) return fmt(T.cards.friendTitle, { name: friendName, clone: roach.clone ? T.cards.friendClone : "" });
  if (roach.clone) return T.cards.someClone;
  return roach.asleep ? T.cards.anonymousAsleep : T.common.anonymousOne;
}

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
  touches,
  perlicaTimer = false,
  perlicaGuarding = false,
  amiyaMusic,
  fire,
  minghe,
  clonesHidden = false,
  friendRow,
  busy,
  touching = false,
  onOpenFriend,
  onSignIn,
  onTouch,
  onPoke,
  onReport,
  admin,
  back,
  under,
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
  /**
   * Touches left today (Me.touchesLeft), when the day turns (Me.dayTurnsAt), and on this roach's owner when
   * TA is one of your 触须之交 (FriendBetween.touchesLeft): never anyone else's, which would tell whose roaches
   * these are. Not for the guides, who count their own
   */
  touches?: { left: number; at: number; friendLeft?: number };
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
  /** 只看本体 is on: others' clones by her fire and riding with him are not drawn, which their cards say (the counts are of all) */
  clonesHidden?: boolean;
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
  /** Picked from those lying on top of each other: back to them (StackBack) */
  back?: ReactNode;
  /** A guide with roaches under her picture: to pick one of them (StackUnderGuide) */
  under?: ReactNode;
  onClose: () => void;
}) {
  // today's touches as they are now (a new day's once it turned with the card open); with none left, it draws
  // again now and then, so the wait counts down and the buttons come back as the day turns
  const quota = touches && signedIn && !roach.guide && !roach.bot ? touchesNow(touches) : null;
  useTick(quota && (quota.left === 0 || quota.friendLeft === 0) ? 30_000 : null);
  if (roach.bot) {
    return (
      <div className="card stack" role="dialog" aria-label={T.cards.demo.title}>
        {back}
        <div className="card-head">
          <RoachIcon color={roach.color} size={44} avatar={roach.avatar} look={look} />
          <div>
            <strong>{T.cards.demo.label}</strong>
            <p className="muted">{T.cards.demo.note}</p>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label={T.common.close}>
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
      ? PERLICA.name
      : talulah
        ? TALULAH.name
        : ride
          ? MINGHE.name
          : AMIYA.name
    : roachTitle(roach, friendName);
  // who she is, above what she does
  const about = perlica
    ? perlicaTimer
      ? T.cards.perlica.aboutTimer
      : T.cards.perlica.about
    : talulah
      ? (talulah.hood ?? T.cards.talulah.about)
      : ride
        ? MINGHE_LINES.intro
        : null;
  const hint = talulah
    ? fmt(T.cards.talulah.count, { n: talulah.count.toLocaleString() })
    : ride
    ? fmt(T.cards.minghe.today, { today: ride.today, tomorrow: ride.tomorrow })
    : perlica
    ? friendName
      ? perlicaTimer
        ? T.cards.perlica.friendsTimer
        : T.cards.perlica.friends
      : perlicaTimer
        ? T.cards.perlica.touchTimer
        : T.cards.guide.touchBack
    : roach.guide
    ? !signedIn
      ? waiting
        ? T.cards.reading
        : T.cards.guide.signIn
      : friendName
        ? T.cards.guide.friends
        : T.cards.guide.touchBack
    : asleep
      ? friendName
        ? T.cards.asleep.friend
        : T.cards.asleep.stranger
      : !signedIn
        ? waiting
          ? T.cards.reading
          : T.cards.signIn
        : (quotaHint(quota) ??
          (touched === "sneaky"
            ? T.cards.touched.sneaky
            : touched === "bold"
              ? T.cards.touched.bold
              : quota?.friendLeft !== undefined
                ? friendsLeft(quota.friendLeft)
                : roach.clone
                  ? T.cards.touchClone
                  : T.cards.touch));
  return (
    <div className="card stack" role="dialog" aria-label={T.cards.label}>
      {back}
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
            {asleep && <span className="zz">{friendName ? T.common.asleep : T.cards.recovering}</span>}
          </strong>
          {about && <p className="muted">{about}</p>}
          {perlica && perlicaGuarding && <p className="muted">{PERLICA_MORE.guarding}</p>}
          <p className="muted">{hint}</p>
          {talulah && (
            <>
              <p className="muted">{FIRE_LINES[talulah.level]}</p>
              {clonesHidden && <p className="hint fire-note">{T.cards.clonesHidden}</p>}
              <p className="hint fire-note">{T.cards.talulah.cloneNote}</p>
            </>
          )}
          {roach.guide && roach.id === AMIYA_ID && (
            <p className="hint fire-note">
              {T.cards.amiya.credit}
              {amiyaMusic && (
                <button className="link amiya-music" onClick={amiyaMusic.onToggle}>
                  {amiyaMusic.on ? T.cards.amiya.musicOn : T.cards.amiya.musicOff}
                </button>
              )}
            </p>
          )}
          {ride && (
            <>
              <p className="muted">{fmtParts(T.common.quoted, { text: ride.line })}</p>
              <p className="muted">{fmtParts(T.cards.minghe.riders, { n: ride.riders.toLocaleString() })}</p>
              {clonesHidden && <p className="hint fire-note">{T.cards.clonesHidden}</p>}
              <MingheRoute day={ride.day} />
              <p className="hint fire-note">{T.cards.minghe.cloneNote}</p>
            </>
          )}
        </div>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            {T.common.seeThem}
          </button>
        </div>
      )}
      {ride ? (
        <>
          <div className="touch-buttons">
            <button disabled={touching} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
              {T.common.reachSneaky}
              <small>{T.cards.minghe.sneakyNote}</small>
            </button>
            <button disabled={touching} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
              {T.common.reachBold}
              <small>{sharesUid ? T.cards.minghe.boldUid : T.cards.minghe.bold}</small>
            </button>
          </div>
          {signedIn && ride.riding ? (
            <button className="primary wide fire-send" disabled={ride.sending} onClick={ride.onDismount}>
              {T.cards.minghe.dismount}
            </button>
          ) : (
            <button className="primary wide fire-send" disabled={ride.sending} onClick={ride.onRide}>
              {signedIn ? T.cards.minghe.ride : T.cards.minghe.signIn}
            </button>
          )}
        </>
      ) : talulah ? (
        <>
          <div className="touch-buttons">
            <button disabled={touching} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
              {T.common.reachSneaky}
              <small>{T.cards.sneakyNote}</small>
            </button>
            <button disabled={touching} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
              {T.common.reachBold}
              <small>{sharesUid ? T.cards.boldUid : T.cards.bold}</small>
            </button>
          </div>
          {signedIn && talulah.seated ? (
            <div className="fire-row">
              <span>{T.cards.talulah.seated}</span>
              <button className="pill dark" onClick={talulah.onVisit}>
                {T.common.goThere}
              </button>
            </div>
          ) : (
            <button className="primary wide fire-send" disabled={talulah.sending} onClick={talulah.onSend}>
              {signedIn ? T.cards.talulah.send : T.cards.talulah.signIn}
            </button>
          )}
        </>
      ) : !signedIn ? (
        <button className="primary wide" disabled={waiting} onClick={onSignIn}>
          {waiting ? T.common.wait : T.common.signIn}
        </button>
      ) : pokeable && friendRow ? null : pokeable ? (
        <button className="poke-btn" disabled={busy || daysToWait > 0} onClick={onPoke}>
          {daysToWait > 0 ? T.common.poked : T.common.poke}
          <small>{daysToWait > 0 ? fmt(T.cards.pokeWait, { days: daysToWait }) : fmt(T.cards.pokeEvery, { days: POKE_EVERY_DAYS })}</small>
        </button>
      ) : (
        <TouchButtons quota={quota} touched={touched} busy={touching} sharesUid={sharesUid} onTouch={onTouch} />
      )}
      {signedIn && friendRow}
      {signedIn && !roach.guide && onReport && (
        <button className="link report-roach" onClick={onReport}>
          {T.safety.reportRoach}
        </button>
      )}
      {admin && !roach.guide && (
        <div className="row-actions">
          <button className="danger" disabled={admin.busy} onClick={admin.onTakeBack}>
            {T.cards.admin.takeBack}
          </button>
          <button className="danger" disabled={admin.busy} onClick={admin.onTakeBackNear}>
            {T.cards.admin.takeBackNear}
          </button>
          {admin.onDraw && (
            <button className="danger" disabled={admin.busy} onClick={admin.onDraw}>
              {DRAW_HERE}
            </button>
          )}
        </div>
      )}
      {under}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
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
  back,
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
  /** Picked from those lying on top of each other: back to them (StackBack) */
  back?: ReactNode;
  onMove: () => void;
  onRemove: () => void;
  onDrink: () => void;
  onSober: () => void;
  onClose: () => void;
}) {
  const clone = roach.slot > 0;
  const asleep = drunk && !clone;
  return (
    <div className="card stack" role="dialog" aria-label={T.common.myRoach}>
      {back}
      <div className="card-head">
        <RoachIcon color={color} size={44} avatar={avatar} mine clone={clone} look={look} asleep={asleep} zzz anim />
        <div>
          <strong>
            {clone ? fmt(T.cards.own.clone, { n: index }) : T.cards.own.main}
            {asleep && <span className="zz">{T.cards.recovering}</span>}
          </strong>
          <p className="muted">
            {clone
              ? T.cards.own.cloneNote
              : asleep
                ? T.cards.own.asleepNote
                : T.cards.own.mainNote}
          </p>
        </div>
      </div>
      {visits && roach.guests && (
        <div className="visit-guests">
          <p className="muted">{fmtParts(T.cards.own.guests, { n: roach.guests.length })}</p>
          {roach.guests.map((g) => (
            <div className="visit-row" key={g.friendId}>
              <strong>{g.name}</strong>
              <button className="pill" disabled={busy} onClick={() => visits.onSendHome(g.friendId)}>
                {T.visit.sendHome}
              </button>
            </div>
          ))}
        </div>
      )}
      {visits && roach.visit && (
        <div className="fire-row">
          <span>
            {roach.visit.left === "moved"
              ? fmt(T.visit.moved, { who: roach.visit.name })
              : roach.visit.left === "removed"
                ? fmt(T.visit.removed, { who: roach.visit.name })
                : fmt(T.cards.own.visiting, { name: roach.visit.name })}
          </span>
          {roach.visit.left === "moved" && (
            <button className="pill dark" disabled={busy} onClick={visits.onFollow}>
              {T.visit.follow}
            </button>
          )}
          <button className="pill" disabled={busy} onClick={visits.onGoHome}>
            {T.visit.goHome}
          </button>
        </div>
      )}
      {riding && (
        <div className="fire-row">
          <span>
            {fmtParts(T.cards.own.riding, { stop: riding.stops, stops: RIDE_STOPS })}
          </span>
          <button className="pill dark" disabled={busy} onClick={riding.onDismount}>
            {T.cards.minghe.dismount}
          </button>
        </div>
      )}
      <div className="row-actions">
        <button className="pill" onClick={onMove}>
          {T.cards.own.move}
        </button>
        {!clone &&
          (asleep ? (
            <>
              <button className="pill" disabled={busy} onClick={onSober}>
                {T.cards.own.sober}
              </button>
              {party && (
                <button className={`pill ${party.on ? "" : "party-btn"}`} disabled={busy} onClick={party.onToggle}>
                  {party.on ? T.cards.own.partyStop : T.cards.own.party}
                </button>
              )}
            </>
          ) : (
            <button className="pill wine" disabled={busy} onClick={onDrink}>
              <span dangerouslySetInnerHTML={{ __html: bottleIcon(15) }} />
              {T.cards.own.drink}
            </button>
          ))}
        <button className="pill" onClick={onRemove}>
          {clone ? T.common.takeBack : T.cards.own.removeAll}
        </button>
      </div>
      {asleep && party && <p className="tally">{T.cards.own.partyNote}</p>}
      {!clone && (
        <p className="tally">
          {drinks >= 50 ? fmt(T.cards.own.drinksDone, { n: drinks }) : fmt(T.cards.own.drinks, { n: drinks })}
        </p>
      )}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

/** 墨小强 on a card: its ink picture, standing, or on its side while it lies outside */
function InkFigure({ look, lying }: { look: RoachAvatar; lying: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- one small WebP of our own, which next/image would only copy
    <img className={`ink-figure${lying ? " lying" : ""}`} src={`/avatars/ink-${look}.webp`} alt="" width={44} height={44} />
  );
}

/**
 * Tapped someone else's ink roach at 缘缘庄 (src/lib/si.ts): anyone's, a 触须之交's (by name), or nobody's now;
 * where it is, with 祀掌柜's word about one she put out, and the two touches as on a clone (touched like one,
 * src/lib/server/world.ts). Never a report: she drew it, nobody put it there.
 */
export function OtherInkCard({
  look,
  state,
  friendName,
  gone,
  asking,
  signedIn,
  waiting = false,
  sharesUid,
  touched,
  touches,
  touching = false,
  back,
  onOpenFriend,
  onSignIn,
  onTouch,
  onClose,
}: {
  look: RoachAvatar;
  state: "queue" | "stay" | "out";
  /** Set when it is a 触须之交's */
  friendName?: string;
  /** Its owner closed their account: nobody's now, and not to be touched */
  gone: boolean;
  /** Who it may be, asked of the server just now: the touches wait for the answer */
  asking: boolean;
  /** Visitors who have not signed in are asked to, instead of being offered the two touches */
  signedIn: boolean;
  /** Signed in on this browser before, and who it is has not come yet */
  waiting?: boolean;
  sharesUid: boolean;
  /** You touched it from this page within the day (as on OtherRoachCard) */
  touched?: "sneaky" | "bold";
  /** Today's touches, and on its owner when TA is one of your 触须之交 (as on OtherRoachCard) */
  touches?: { left: number; at: number; friendLeft?: number };
  touching?: boolean;
  /** Picked from those lying on top of each other: back to them (StackBack) */
  back?: ReactNode;
  onOpenFriend?: () => void;
  onSignIn: () => void;
  onTouch: (bold: boolean) => void;
  onClose: () => void;
}) {
  const quota = touches && signedIn && !gone ? touchesNow(touches) : null;
  useTick(quota && (quota.left === 0 || quota.friendLeft === 0) ? 30_000 : null);
  const title = friendName ? fmt(T.cards.ink.friendTitle, { name: friendName }) : T.cards.ink.title;
  const where = state === "queue" ? T.cards.ink.queue : state === "stay" ? T.cards.ink.stay : T.cards.ink.out;
  const hint = gone
    ? T.cards.ink.gone
    : !signedIn
      ? waiting
        ? T.cards.reading
        : T.cards.ink.signIn
      : (quotaHint(quota) ??
        (touched === "sneaky"
          ? T.cards.touched.sneaky
          : touched === "bold"
            ? T.cards.touched.bold
            : quota?.friendLeft !== undefined
              ? friendsLeft(quota.friendLeft)
              : T.cards.touchClone));
  return (
    <div className="card stack" role="dialog" aria-label={T.common.ink}>
      {back}
      <div className="card-head">
        <InkFigure look={look} lying={state === "out"} />
        <div>
          <strong>{title}</strong>
          <p className="muted">{where}</p>
          {state === "out" && <p className="muted">{fmt(T.map.guides.saysQuoted, { name: SI.name, line: SI_LINES.thrownOut })}</p>}
          <p className="muted">{hint}</p>
        </div>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            {T.common.seeThem}
          </button>
        </div>
      )}
      {gone ? null : !signedIn ? (
        <button className="primary wide" disabled={waiting} onClick={onSignIn}>
          {waiting ? T.common.wait : T.common.signIn}
        </button>
      ) : (
        <TouchButtons quota={quota} touched={touched} busy={asking || touching} sharesUid={sharesUid} onTouch={onTouch} />
      )}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

type Quota = { left: number; at: number; friendLeft?: number };

/** 「你们是触须之交，今天还能碰 TA n 次。」 */
const friendsLeft = (n: number) => fmtNodes(T.cards.touched.friendsLeft, { n: <b>{n}</b> });

/** What a card says of today's touches before anything else: none left at all, or none left on this 触须之交 */
function quotaHint(quota: Quota | null): ReactNode {
  if (quota?.left === 0) return fmt(T.cards.touchesUsedUp, { max: TOUCHES_PER_DAY });
  if (quota?.friendLeft === 0) return friendsLeft(0);
  return null;
}

/**
 * The two touches, and under them how many are left today and when the day turns (quota, as touchesNow() gives
 * it; none for the guides). With none left, on anyone or on this 触须之交, both wait for the day to turn
 */
function TouchButtons({
  quota,
  touched,
  busy,
  sharesUid,
  onTouch,
}: {
  quota: Quota | null;
  touched?: "sneaky" | "bold";
  busy: boolean;
  sharesUid: boolean;
  onTouch: (bold: boolean) => void;
}) {
  const out = quota?.left === 0 || quota?.friendLeft === 0;
  return (
    <>
      <div className="touch-buttons">
        <button disabled={busy || Boolean(touched) || out} onClick={() => onTouch(false)}>
          {T.common.reachSneaky}
          <small>{out ? T.cards.usedUpToday : touched ? T.cards.touchedToday : T.cards.sneakyNote}</small>
        </button>
        <button disabled={busy || touched === "bold" || out} className="bold" onClick={() => onTouch(true)}>
          {T.common.reachBold}
          <small>{out ? T.cards.usedUpToday : touched === "bold" ? T.cards.touchedToday : sharesUid ? T.cards.boldUid : T.cards.bold}</small>
        </button>
      </div>
      {quota && <TouchesLine left={quota.left} at={quota.at} />}
    </>
  );
}

/** 「今天总共还能碰 n 次 · 凌晨 4 点刷新」; with none left, 「凌晨 4 点刷新 · 还有 2 小时 40 分」 */
function TouchesLine({ left, at }: { left: number; at: number }) {
  const when = turnsAtText(at);
  if (left > 0) return <p className="touch-quota">{fmtNodes(T.cards.touchesLeft, { n: <b>{left}</b>, at: when })}</p>;
  const { h, m } = waitParts(at);
  const w = T.cards.dayTurns;
  const wait = h && m ? fmtNodes(w.hoursMinutes, { h: <b>{h}</b>, m: <b>{m}</b> }) : h ? fmtNodes(w.hours, { h: <b>{h}</b> }) : fmtNodes(w.minutes, { m: <b>{m}</b> });
  return <p className="touch-quota">{fmtNodes(T.cards.dayTurnsIn, { at: when, wait })}</p>;
}

/**
 * Tapped your own ink roach at 缘缘庄: where it is, as 祀掌柜 says it, and what can be done with it: 发表宣言 from
 * it, to her, or 收回 (off the map, after a word on what that does; src/lib/server/si.ts recallInk). No moving
 * it, visiting or riding: she put it where it is.
 */
export function MyInkCard({
  look,
  where,
  now,
  busy,
  back,
  onDeclare,
  onToSi,
  onRecall,
  onClose,
}: {
  look: RoachAvatar;
  /** Where it is now (siInn.ts inkNow) */
  where: ReturnType<typeof inkNow>;
  /** Her clock, as the page keeps it */
  now: number;
  /** 收回 under way */
  busy: boolean;
  /** Picked from those lying on top of each other: back to them (StackBack) */
  back?: ReactNode;
  onDeclare: () => void;
  onToSi: () => void;
  onRecall: () => void;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="card stack" role="dialog" aria-label={T.cards.ink.mine}>
      {back}
      <div className="card-head">
        <InkFigure look={look} lying={where.state === 2} />
        <div>
          <strong>{T.cards.ink.mine}</strong>
          <p className="muted">{inkLine(where, now)}</p>
          <p className="muted">{T.cards.ink.mineNote}</p>
        </div>
      </div>
      {asking ? (
        <div className="ink-recall">
          <p>{fmt(T.cards.ink.recallAsk, { hours: RECALL_REST_MS / 3_600_000 })}</p>
          <div className="row-actions">
            <button className="danger" disabled={busy} onClick={onRecall}>
              {T.common.takeBack}
            </button>
            <button className="pill" disabled={busy} onClick={() => setAsking(false)}>
              {T.common.neverMind}
            </button>
          </div>
        </div>
      ) : (
        <div className="row-actions">
          <button className="pill" onClick={onDeclare}>
            {T.cards.ink.declare}
          </button>
          <button className="pill" onClick={onToSi}>
            {T.cards.ink.toSi}
          </button>
          <button className="pill" onClick={() => setAsking(true)}>
            {T.common.takeBack}
          </button>
        </div>
      )}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}
