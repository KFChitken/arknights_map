"use client";

import { useEffect, useState } from "react";
import { T } from "@/i18n";
import { GLOW } from "@/lib/roachSvg";
import { dockFeeler, mark, miniHeart, soundArcs, tap } from "@/lib/touchArt";
import type { DrawnAvatar, RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import { dockMove, ownMark, touchedAround, touchedOn } from "./LookMoves";

/**
 * The touched side (the third step of the touch and declaration animations): only your
 * own dock avatar, bottom left, reacts as the toast or 消息 comes, and nothing on the map
 * moves or points anywhere. 偷偷: a feeler hangs straight down from the top onto it, 嗒,
 * it shivers, ?. 大胆: the toucher's name card drops into the envelope, the red dot pops,
 * it hops, !. 成为触须之交: the card is pink and two hearts rise.
 */

/**
 * Between 触须之交 (src/lib/friendly.ts) the avatar has more: 咚咚 for a clone come to visit
 * (knock), a little bottle of 理智 dropping on it (sanity), a heart as it leans for 贴贴 (hug),
 * 啪！ for 击掌 (highfive), gold stars leaving it for 吸欧气 (luck), a cake for a birthday wish
 * (cake), and two hearts on an anniversary (hearts).
 */
export type DockKind = "sneaky" | "bold" | "friend" | "knock" | "sanity" | "hug" | "highfive" | "luck" | "cake" | "hearts";

/** The class the dock avatar itself plays for each */
export const DOCK_ANIM: Record<DockKind, string> = {
  sneaky: "ta-dshiver",
  bold: "ta-dhop",
  friend: "ta-dhop",
  knock: "ta-dknock",
  sanity: "ta-dhop",
  hug: "ta-dlean",
  highfive: "ta-dhop",
  luck: "ta-dshiver",
  cake: "ta-dhop",
  hearts: "ta-dhop",
};
/** The class your dock avatar plays: your look's own move for a touch when it has one (LookMoves.tsx), or as anyone's */
export const dockAnimFor = (kind: DockKind, look: RoachAvatar) => ((kind === "sneaky" || kind === "bold") && dockMove(look, kind)) || DOCK_ANIM[kind];
/** Who touched, for the card of a bold touch or a new 触须之交 */
export type DockFrom = { name: string; avatar: DrawnAvatar; color: RoachColor };
type Box = { x: number; y: number; w: number; h: number };
/** Where the dock is on screen when the scene starts: your avatar, the picture in it, 消息, and the top of the map */
export type DockAt = { av: Box; icon: Box; mail: Box; top: number };

/** How long the dock's scene runs */
export const DOCK_MS = 1600;

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });

/** A little bottle of 理智 (催理智) */
export const vial = (size: number) =>
  `<svg viewBox="0 0 20 26" width="${size}" height="${(size * 26) / 20}" aria-hidden="true">` +
  `<path d="M7 1.5h6M8 1.5v5L3.4 15a5.6 5.6 0 0 0 4.9 8.5h3.4a5.6 5.6 0 0 0 4.9-8.5L12 6.5v-5" fill="#fff" stroke="#1b1d22" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<path d="M4.6 16h10.8a4.3 4.3 0 0 1-3.8 6.2H8.4A4.3 4.3 0 0 1 4.6 16z" fill="#3fb6e8"/>` +
  `<circle cx="8.5" cy="18.5" r="1" fill="#fff" opacity=".8"/></svg>`;

/** A gold star (吸欧气) */
export const star = (size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 2.5l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.4l-5.6 3.1 1.3-6.2L3 9l6.3-.7z" fill="#ffc83d" stroke="#b07d00" stroke-width="1"/></svg>`;

/** A birthday cake (a 触须之交's 生日快乐！) */
export const cake = (size: number) =>
  `<svg viewBox="0 0 26 26" width="${size}" height="${size}" aria-hidden="true">` +
  `<path d="M13 3.5c1.2 1.4 1.2 2.6 0 3.4-1.2-.8-1.2-2 0-3.4z" fill="#ff9f1c"/><rect x="12.2" y="7" width="1.6" height="4" fill="#ff4f8b"/>` +
  `<rect x="4" y="11" width="18" height="6" rx="2" fill="#fff0f6" stroke="#1b1d22" stroke-width="1.4"/>` +
  `<rect x="2.5" y="16.5" width="21" height="7" rx="2" fill="#ffd5e6" stroke="#1b1d22" stroke-width="1.4"/>` +
  `<path d="M4 14c1.5 1.4 3 1.4 4.5 0s3-1.4 4.5 0 3 1.4 4.5 0 3-1.4 4.5 0" fill="none" stroke="#ff4f8b" stroke-width="1.4"/></svg>`;

export function DockFx({
  kind,
  from,
  at,
  me,
  onDone,
}: {
  kind: DockKind;
  from: DockFrom | null;
  at: DockAt;
  /** Your own look, which reacts on your avatar */
  me: { avatar: RoachAvatar; color: RoachColor };
  onDone: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDone, DOCK_MS + 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { av, icon, mail, top } = at;
  const cx = av.x + av.w / 2;
  // your look's own reaction, over your avatar's picture and moving with it (LookMoves.tsx)
  const touched = kind === "sneaky" || kind === "bold";
  const on = touched ? touchedOn(me.avatar, GLOW[me.color]) : null;
  const around = touched ? touchedAround(me.avatar) : null;
  const look = (on || around) && (
    <div
      className={`dock-fx dock-look dock-${kind} ${dockAnimFor(kind, me.avatar)}`}
      style={{ left: icon.x, top: icon.y, width: icon.w, height: icon.h }}
    >
      {on}
      {around}
    </div>
  );
  if (kind === "sneaky") {
    const h = Math.max(20, Math.round(av.y - top + 3));
    return (
      <>
        <div className="dock-fx" style={{ left: cx - 7, top }} {...html(dockFeeler(h))} />
        {look}
        <div className="dock-fx ta-dtap" style={{ left: cx - 20, top: av.y + 2 }} {...html(tap())} />
        <div className="dock-fx ta-dmark" style={{ left: av.x - 14, top: av.y - 30 }} {...html(mark("?"))} />
      </>
    );
  }
  const word = (text: string, cls = "") => (
    <div className={`dock-fx ta-dword ${cls}`} style={{ left: av.x + av.w + 2, top: av.y - 6 }}>
      {text}
    </div>
  );
  if (kind === "knock") {
    return (
      <>
        {word(T.fx.dong, "w1")}
        {word(T.fx.dong, "w2")}
      </>
    );
  }
  if (kind === "sanity") {
    return (
      <>
        <div className="dock-fx ta-dvial" style={{ left: cx - 9, top: av.y - 12 }} {...html(vial(18))} />
        {word(T.fx.sanity, "late")}
      </>
    );
  }
  if (kind === "hug" || kind === "hearts") {
    return <div className="dock-fx ta-dhearts dock-hearts" style={{ left: cx, top: av.y - 8 }} {...html(kind === "hug" ? miniHeart(16) : miniHeart(14) + miniHeart(11))} />;
  }
  if (kind === "highfive") return word(T.fx.pa);
  if (kind === "luck") {
    return (
      <div className="dock-fx ta-dstars" style={{ left: cx - 20, top: av.y - 4 }}>
        <span {...html(star(17))} />
        <span {...html(star(12))} />
        <span {...html(star(15))} />
      </div>
    );
  }
  if (kind === "cake") return <div className="dock-fx ta-dcake" style={{ left: cx - 13, top: av.y - 30 }} {...html(cake(26))} />;
  const friend = kind === "friend";
  return (
    <>
      {look}
      <div className="dock-fx ta-dcard" style={{ left: mail.x + mail.w / 2, top: mail.y + mail.h / 2 }}>
        <span className={`ta-card${friend ? " pink" : ""}`}>
          {from && (
            <span className="ta-card-pic">
              <RoachIcon color={from.color} size={20} avatar={from.avatar} />
            </span>
          )}
          <b>{from?.name ?? T.map.common.anonymous}</b>
        </span>
      </div>
      {friend ? (
        <div className="dock-fx ta-dhearts dock-hearts" style={{ left: cx, top: av.y - 8 }} {...html(miniHeart(14) + miniHeart(11))} />
      ) : (
        !ownMark(me.avatar) && <div className="dock-fx ta-dmark" style={{ left: av.x - 14, top: av.y - 30 }} {...html(mark("!"))} />
      )}
    </>
  );
}

/** The speaker of a declaration sent nearby: on its bubble, and on the envelope while one is unread */
export function SpeakerIcon({ size, stroke = 1.6 }: { size: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M3 9 h3 l4 -4 v14 l-4 -4 h-3 z" fill="currentColor" />
      <path d="M13.5 8 a4 4 0 0 1 0 8 M15.5 5 a8 8 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  );
}

/** Sound coming down into the dock avatar as a declaration is heard */
export function DockArcs({ at }: { at: DockAt }) {
  return <div className="dock-fx ta-arcs" style={{ left: at.av.x + at.av.w / 2 - 19, top: at.av.y - 22 }} {...html(soundArcs())} />;
}

/** A declaration heard nearby, as a bubble over the dock: no tail, no name, no place */
export type Heard = { id: string; text: string; limited: boolean };

/**
 * When only declarations came, they float down above the dock instead of 消息 opening:
 * at most three, the newest at the bottom by the dock. 回应 opens 消息 at it; 知道了 puts
 * it away as read; left alone, it goes after 15 s and stays unread in 消息.
 */
export function HeardBubbles({ list, onReply, onOk }: { list: Heard[]; onReply: (id: string) => void; onOk: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="heard-stack">
      {list.map((h, i) => (
        <HeardBubble key={h.id} heard={h} older={i < list.length - 1} onReply={onReply} onOk={onOk} />
      ))}
    </div>
  );
}

/** One heard line; once it has floated down it can shrink back as newer ones come */
function HeardBubble({ heard: h, older, onReply, onOk }: { heard: Heard; older: boolean; onReply: (id: string) => void; onOk: (id: string) => void }) {
  const [landed, setLanded] = useState(false);
  return (
    <div className={`ta-heard${landed ? " landed" : ""}${older ? " older" : ""}`} role="status" onAnimationEnd={() => setLanded(true)}>
      <span className="ta-heard-k">
        <SpeakerIcon size={14} />
        {T.fx.shoutNear}
      </span>
      <p className="ta-heard-line">
        {h.limited && <span className="ta-tag">{T.map.declare.limited}</span>}
        {h.text}
      </p>
      <span className="ta-heard-acts">
        <button type="button" className="ta-reply" onClick={() => onReply(h.id)}>
          {T.fx.react}
        </button>
        <button type="button" className="ta-ok" onClick={() => onOk(h.id)}>
          {T.common.gotIt}
        </button>
      </span>
    </div>
  );
}
