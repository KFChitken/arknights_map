"use client";

import { fmt, fmtParts, T } from "@/i18n";
import {
  favouriteLine,
  mingheHereLine,
  PAINTING_LINES,
  paintingTier,
  placeLine,
  RECALL_REST_MS,
  SI,
  SI_LINES,
  STAMPS,
  stampAt,
  stayLine,
} from "@/lib/si";
import { siteName } from "@/lib/rules";
import { inkNow, innNumbers, queueTailLine } from "@/lib/siInn";
import type { SiMe, SiState } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";
import { SiScrollArt } from "./SiArt";
import { stampName } from "@/i18n/names";

/** 祀掌柜 (src/lib/si.ts) on the page: her picture, her card, and the card that tells older players she is here. */

export const SiPicture = ({ size, friend = false }: { size: number; friend?: boolean }) => (
  <RoachIcon color={SI.color} size={size} avatar={SI.avatar} friend={friend} />
);

/** Where your ink roach is now (siInn.ts inkNow), as she puts it: its place in the queue, its room, or the fields */
export const inkLine = (mine: ReturnType<typeof inkNow>, now: number) =>
  mine.state === 0
    ? placeLine(mine.place, Math.max(0, mine.until - now))
    : mine.state === 1
      ? stayLine(mine.room, Math.max(0, mine.until - now))
      : SI_LINES.out;

/**
 * Her card: who she is (and what she makes of your 厨力 list), today's painting, 缘缘庄 and your ink roach
 * there, your 集章本, and the two touches. Visitors see it all and are asked to sign in as they touch her.
 */
export function SiCard({
  me,
  userId,
  friend,
  state,
  now,
  signedIn,
  waiting,
  touching,
  sharesUid,
  favourites,
  mingheHere,
  onTouch,
  onSignIn,
  onNickname,
  onFind,
  onOpenBook,
  onOpenFriend,
  onClose,
}: {
  me: SiMe | null;
  userId: string | null;
  friend: boolean;
  state: SiState | null;
  /** Her clock, as the page keeps it */
  now: number;
  signedIn: boolean;
  waiting: boolean;
  touching: boolean;
  sharesUid: boolean;
  favourites: { arknights: string[]; endfield: string[] } | null;
  /** 明河都尉 is at 黄山 today */
  mingheHere: boolean;
  onTouch: (bold: boolean) => void;
  onSignIn: () => void;
  onNickname: () => void;
  onFind: () => void;
  onOpenBook: () => void;
  onOpenFriend?: () => void;
  onClose: () => void;
}) {
  const fav = favourites ? favouriteLine(favourites) : null;
  const tier = paintingTier(state?.today ?? 0);
  const inn = state ? innNumbers(state) : null;
  // how far the queue reaches, the places of those recalled included, against a day ago
  const tail = state && inn ? queueTailLine(inn.places, state.queueDayAgo) : null;
  const today = me && me.stampedToday && userId && me.stamps > 0 ? STAMPS[stampAt(userId, me.stamps - 1)] : null;
  // your ink roach as of the newest numbers and her clock now (me() may be older than them); or held off the map:
  // recalled (back in the queue for a touch of hers once RECALL_REST_MS are over), or drawn while your clones were full
  const mine = me?.inn && me.inn.state !== "held" ? inkNow(me.inn, state?.checkedIn ?? null, now) : null;
  const held = me?.inn?.state === "held" ? me.inn : null;
  const restLeft = held?.recalledAt ? held.recalledAt + RECALL_REST_MS - now : 0;
  return (
    <div className="card stack si-card" role="dialog" aria-label={SI.name}>
      <div className="card-head">
        <SiPicture size={44} friend={friend} />
        <div>
          <strong>{SI.name}</strong>
          <p className="muted">{SI_LINES.intro}</p>
          {fav && <p className="muted si-aside">{fav}</p>}
          {mingheHere && <p className="muted si-aside">{mingheHereLine()}</p>}
          <button className="link si-nickname" onClick={onNickname}>
            {T.guides.si.nickname}
          </button>
        </div>
      </div>

      <section className="si-block si-painting">
        <SiScrollArt tier={tier} size={64} />
        <div>
          <strong>{T.guides.si.todaysPainting}</strong>
          <p className="muted">{fmtParts(T.guides.si.visitors, { n: (state?.today ?? 0).toLocaleString() })}</p>
          <p className="muted">{PAINTING_LINES[tier]}</p>
        </div>
      </section>

      <section className="si-block">
        <strong>{T.guides.si.inn}</strong>
        {inn && (inn.free > 0 ? (
          <p className="muted">{fmtParts(T.guides.si.freeRooms, { n: inn.free.toLocaleString() })}</p>
        ) : (
          <>
            <p className="muted">
              {fmtParts(T.guides.si.full, { queue: inn.queue.toLocaleString(), outside: inn.outside.toLocaleString() })}
            </p>
            {tail && <p className="muted">{tail}</p>}
          </>
        ))}
        {mine && (
          <div className="si-mine">
            <p>{inkLine(mine, now)}</p>
            <button className="pill" onClick={onFind}>
              {T.guides.si.whereAmI}
            </button>
          </div>
        )}
        {held && (
          <div className="si-mine si-held">
            <p>{held.recalledAt ? SI_LINES.held : SI_LINES.full}</p>
            {restLeft > 0 && (
              <p className="muted">{fmt(T.guides.si.resting, { hours: RECALL_REST_MS / 3_600_000, left: Math.ceil(restLeft / 3_600_000) })}</p>
            )}
          </div>
        )}
      </section>

      {signedIn && me && (
        <section className="si-block si-book-row">
          <div>
            <strong>{T.guides.si.book}</strong>
            <p className="muted">
              {fmtParts(T.guides.si.stamps, { n: me.stamps.toLocaleString(), today: today ? fmt(T.guides.si.todayStamp, { stamp: stampName(today) }) : T.guides.si.noStampToday })}
            </p>
          </div>
          <button className="pill" onClick={onOpenBook}>
            {T.guides.si.openBook}
          </button>
        </section>
      )}

      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            {T.common.seeThem}
          </button>
        </div>
      )}
      <div className="touch-buttons">
        <button disabled={touching || waiting} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
          {T.common.reachSneaky}
          <small>{T.guides.si.sneakyNote}</small>
        </button>
        <button disabled={touching || waiting} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
          {T.common.reachBold}
          <small>{sharesUid ? T.guides.si.boldUid : T.guides.si.bold}</small>
        </button>
      </div>
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

/** Once in each browser, for every signed-in player with a main roach (her 触须之交 too), before the other guides' cards. */
export function SiIntroSheet({ onGo, onLater }: { onGo: () => void; onLater: () => void }) {
  return (
    <Sheet title={fmt(T.guides.si.introTitle, { site: siteName() })} onClose={onLater}>
      <div className="amiya-greet">
        <SiPicture size={96} />
      </div>
      <p className="consent-place">{fmtParts(T.common.quoted, { text: SI_LINES.introCard })}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          {T.guides.si.goSee}
        </button>
        <button className="pill" onClick={onLater}>
          {T.common.later}
        </button>
      </div>
    </Sheet>
  );
}

// ---- what this browser remembers about her, per player ----

const introKey = (userId: string) => `zhoup.siIntro.${userId}`;
const peekKey = (userId: string) => `zhoup.siPeek.${userId}`;

export function siIntroShown(userId: string) {
  try {
    return localStorage.getItem(introKey(userId)) === "1";
  } catch {
    // without storage, rather say it happened than repeat it on every visit
    return true;
  }
}
export function markSiIntroShown(userId: string) {
  try {
    localStorage.setItem(introKey(userId), "1");
  } catch {}
}

/** The day (by this device, from 04:00) the card was last opened and closed without a touch, if today */
export function peekedToday(userId: string | null, day: string) {
  try {
    return localStorage.getItem(peekKey(userId ?? "visitor")) === day;
  } catch {
    return false;
  }
}
export function rememberPeek(userId: string | null, day: string | null) {
  try {
    if (day) localStorage.setItem(peekKey(userId ?? "visitor"), day);
    else localStorage.removeItem(peekKey(userId ?? "visitor"));
  } catch {}
}

/** 清掉我和祀的记录 (local testing only) */
export function forgetSiHere(userId: string) {
  try {
    localStorage.removeItem(introKey(userId));
    localStorage.removeItem(peekKey(userId));
  } catch {}
}
