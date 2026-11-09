"use client";

import { useEffect, useState } from "react";
import { dockFeeler, mark, miniHeart, soundArcs, tap } from "@/lib/touchArt";
import type { DrawnAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";

/**
 * The touched side (the third step of the touch and declaration animations): only your
 * own dock avatar, bottom left, reacts as the toast or 消息 comes, and nothing on the map
 * moves or points anywhere. 偷偷: a feeler hangs straight down from the top onto it, 嗒,
 * it shivers, ?. 大胆: the toucher's name card drops into the envelope, the red dot pops,
 * it hops, !. 成为触须之交: the card is pink and two hearts rise.
 */

export type DockKind = "sneaky" | "bold" | "friend";
/** Who touched, for the card of a bold touch or a new 触须之交 */
export type DockFrom = { name: string; avatar: DrawnAvatar; color: RoachColor };
/** Where the dock is on screen when the scene starts */
export type DockAt = { av: { x: number; y: number; w: number; h: number }; mail: { x: number; y: number; w: number; h: number }; top: number };

/** How long the dock's scene runs */
export const DOCK_MS = 1600;

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });

export function DockFx({ kind, from, at, onDone }: { kind: DockKind; from: DockFrom | null; at: DockAt; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, DOCK_MS + 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { av, mail, top } = at;
  const cx = av.x + av.w / 2;
  if (kind === "sneaky") {
    const h = Math.max(20, Math.round(av.y - top + 3));
    return (
      <>
        <div className="dock-fx" style={{ left: cx - 7, top }} {...html(dockFeeler(h))} />
        <div className="dock-fx ta-dtap" style={{ left: cx - 20, top: av.y + 2 }} {...html(tap())} />
        <div className="dock-fx ta-dmark" style={{ left: av.x - 14, top: av.y - 30 }} {...html(mark("?"))} />
      </>
    );
  }
  const friend = kind === "friend";
  return (
    <>
      <div className="dock-fx ta-dcard" style={{ left: mail.x + mail.w / 2, top: mail.y + mail.h / 2 }}>
        <span className={`ta-card${friend ? " pink" : ""}`}>
          {from && (
            <span className="ta-card-pic">
              <RoachIcon color={from.color} size={20} avatar={from.avatar} />
            </span>
          )}
          <b>{from?.name ?? "匿名"}</b>
        </span>
      </div>
      {friend ? (
        <div className="dock-fx ta-dhearts dock-hearts" style={{ left: cx, top: av.y - 8 }} {...html(miniHeart(14) + miniHeart(11))} />
      ) : (
        <div className="dock-fx ta-dmark" style={{ left: av.x - 14, top: av.y - 30 }} {...html(mark("!"))} />
      )}
    </>
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
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M3 9 h3 l4 -4 v14 l-4 -4 h-3 z" fill="currentColor" />
          <path d="M13.5 8 a4 4 0 0 1 0 8 M15.5 5 a8 8 0 0 1 0 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        附近 10 公里有舟P喊
      </span>
      <p className="ta-heard-line">
        {h.limited && <span className="ta-tag">限定</span>}
        {h.text}
      </p>
      <span className="ta-heard-acts">
        <button type="button" className="ta-reply" onClick={() => onReply(h.id)}>
          回应
        </button>
        <button type="button" className="ta-ok" onClick={() => onOk(h.id)}>
          知道了
        </button>
      </span>
    </div>
  );
}
