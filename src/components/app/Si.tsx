"use client";

import { fmtParts } from "@/i18n";
import {
  favouriteLine,
  MINGHE_HERE_LINE,
  PAINTING_LINES,
  paintingTier,
  placeLine,
  SI,
  SI_LINES,
  SI_NAME,
  STAMPS,
  stampAt,
  stayLine,
} from "@/lib/si";
import { SITE_NAME } from "@/lib/rules";
import { inkNow, innNumbers, queueTailLine } from "@/lib/siInn";
import type { SiMe, SiState } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";
import { SiScrollArt } from "./SiArt";

/** 祀掌柜 (src/lib/si.ts) on the page: her picture, her card, and the card that tells older players she is here. */

export const SiPicture = ({ size, friend = false }: { size: number; friend?: boolean }) => (
  <RoachIcon color={SI.color} size={size} avatar={SI.avatar} friend={friend} />
);

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
  const tail = state && inn ? queueTailLine(inn.queue, state.queueDayAgo) : null;
  const today = me && me.stampedToday && userId && me.stamps > 0 ? STAMPS[stampAt(userId, me.stamps - 1)] : null;
  // your ink roach as of the newest numbers and her clock now (me() may be older than them)
  const mine = me?.inn ? inkNow(me.inn, state?.checkedIn ?? null, now) : null;
  return (
    <div className="card stack si-card" role="dialog" aria-label={SI_NAME}>
      <div className="card-head">
        <SiPicture size={44} friend={friend} />
        <div>
          <strong>{SI_NAME}</strong>
          <p className="muted">{SI_LINES.intro}</p>
          {fav && <p className="muted si-aside">{fav}</p>}
          {mingheHere && <p className="muted si-aside">{MINGHE_HERE_LINE}</p>}
          <button className="link si-nickname" onClick={onNickname}>
            玩家都叫她小葱
          </button>
        </div>
      </div>

      <section className="si-block si-painting">
        <SiScrollArt tier={tier} size={64} />
        <div>
          <strong>今天的画</strong>
          <p className="muted">{fmtParts("今天来过 {n} 位管理员", { n: (state?.today ?? 0).toLocaleString() })}</p>
          <p className="muted">{PAINTING_LINES[tier]}</p>
        </div>
      </section>

      <section className="si-block">
        <strong>缘缘庄</strong>
        {inn && (inn.free > 0 ? (
          <p className="muted">{fmtParts("还有 {n} 间空房。……才、才不是特意给你留的。", { n: inn.free.toLocaleString() })}</p>
        ) : (
          <>
            <p className="muted">
              {fmtParts("缘缘庄客满 · 门口排了 {queue} 位 · 村外躺了 {outside} 位", { queue: inn.queue.toLocaleString(), outside: inn.outside.toLocaleString() })}
            </p>
            {tail && <p className="muted">{tail}</p>}
          </>
        ))}
        {mine && (
          <div className="si-mine">
            <p>
              {mine.state === 0
                ? placeLine(mine.place, Math.max(0, mine.until - now))
                : mine.state === 1
                  ? stayLine(mine.room, Math.max(0, mine.until - now))
                  : SI_LINES.out}
            </p>
            <button className="pill" onClick={onFind}>
              看看我在哪
            </button>
          </div>
        )}
      </section>

      {signedIn && me && (
        <section className="si-block si-book-row">
          <div>
            <strong>你的集章本</strong>
            <p className="muted">
              {fmtParts("一共盖了 {n} 个 · {today}", { n: me.stamps.toLocaleString(), today: today ? `今天的章「${today}」` : "今天还没盖章" })}
            </p>
          </div>
          <button className="pill" onClick={onOpenBook}>
            翻开集章本
          </button>
        </section>
      )}

      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            看看 TA
          </button>
        </div>
      )}
      <div className="touch-buttons">
        <button disabled={touching || waiting} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
          偷偷伸出触须
          <small>她只知道被碰了一下</small>
        </button>
        <button disabled={touching || waiting} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
          大胆伸出触须
          <small>{sharesUid ? "她能看到你的资料和 UID" : "她能看到你的资料"}</small>
        </button>
      </div>
      <button className="close" onClick={onClose} aria-label="关闭">
        ×
      </button>
    </div>
  );
}

/** Once in each browser, for every signed-in player with a main roach (her 触须之交 too), before the other guides' cards. */
export function SiIntroSheet({ onGo, onLater }: { onGo: () => void; onLater: () => void }) {
  return (
    <Sheet title={`祀来${SITE_NAME}啦`} onClose={onLater}>
      <div className="amiya-greet">
        <SiPicture size={96} />
      </div>
      <p className="consent-place">{fmtParts("「{text}」", { text: SI_LINES.introCard })}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          去宏村看看
        </button>
        <button className="pill" onClick={onLater}>
          以后再说
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
