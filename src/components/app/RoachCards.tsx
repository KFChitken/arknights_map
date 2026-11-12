"use client";

import { fmt, fmtParts, T } from "@/i18n";
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
      <div className="card stack" role="dialog" aria-label={T.cards.demo.title}>
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
      ? PERLICA_NAME
      : talulah
        ? TALULAH_NAME
        : ride
          ? MINGHE_NAME
          : AMIYA_NAME
    : friendName
      ? fmt(T.cards.friendTitle, { name: friendName, clone: roach.clone ? T.cards.friendClone : "" })
      : roach.clone
        ? T.cards.someClone
        : asleep
          ? T.cards.anonymousAsleep
          : T.common.anonymousOne;
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
        : touched === "sneaky"
          ? T.cards.touched.sneaky
          : touched === "bold"
            ? T.cards.touched.bold
            : friendName
              ? T.cards.touched.friends
              : roach.clone
                ? T.cards.touchClone
                : T.cards.touch;
  return (
    <div className="card stack" role="dialog" aria-label={T.cards.label}>
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
        <div className="touch-buttons">
          <button disabled={touching || Boolean(touched)} onClick={() => onTouch(false)}>
            {T.common.reachSneaky}
            <small>{touched ? T.cards.touchedToday : T.cards.sneakyNote}</small>
          </button>
          <button disabled={touching || touched === "bold"} className="bold" onClick={() => onTouch(true)}>
            {T.common.reachBold}
            <small>{touched === "bold" ? T.cards.touchedToday : sharesUid ? T.cards.boldUid : T.cards.bold}</small>
          </button>
        </div>
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
    <div className="card stack" role="dialog" aria-label={T.common.myRoach}>
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
