"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { Gesture } from "@/lib/friendly";
import { miniHeart } from "@/lib/touchArt";
import RoachIcon from "../RoachIcon";
import { star, vial } from "./DockFx";
import type { StagePlace, TouchCast } from "./TouchStage";

/** How long a gesture plays */
export const GESTURE_MS = 2000;

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });

/** A little blanket, feet out at the end (盖被子) */
const blanket = () =>
  `<svg viewBox="0 0 84 40" width="84" height="40" aria-hidden="true">` +
  `<path d="M4 12c10-8 22-8 38 0s28 8 38 0v18c-10 8-22 8-38 0S14 22 4 30z" fill="#ffd5e6" stroke="#1b1d22" stroke-width="2" stroke-linejoin="round"/>` +
  `<path d="M18 13v14M34 15v14M50 15v14M66 13v14" stroke="#ff4f8b" stroke-width="2" stroke-linecap="round" opacity=".55"/></svg>`;

/** A glass of 白开水 (放杯白开水) */
const glass = () =>
  `<svg viewBox="0 0 24 30" width="26" height="32" aria-hidden="true">` +
  `<path d="M3 2h18l-2.2 24.5A2 2 0 0 1 16.8 28H7.2a2 2 0 0 1-2-1.5z" fill="#eef8ff" stroke="#1b1d22" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<path d="M4.6 10h14.8l-1.5 16H6.1z" fill="#b8e2fb"/></svg>`;

/**
 * What only 触须之交 do (src/lib/friendly.ts), played once on your own screen over their
 * roach (the map leaves it out meanwhile), like a touch (TouchStage): 贴贴 the two lean in
 * cheek to cheek under a heart; 击掌 both sleeves up, a hop, 啪！; 吸欧气 gold stars float
 * from them to you; 盖被子 a blanket settles over them asleep, feet out; 放杯白开水 a glass
 * slides up by their pillow. Tapping or dragging the map ends it at once.
 */
export default function GestureStage({
  gesture,
  cast,
  place,
  onDone,
}: {
  gesture: Gesture;
  cast: TouchCast;
  place: StagePlace;
  onDone: () => void;
}) {
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  useEffect(() => {
    const t = window.setTimeout(finish, GESTURE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { you, them } = cast;
  const asleep = gesture === "blanket" || gesture === "water";
  const yours = <RoachIcon color={you.color} size={88} avatar={you.avatar} mine />;
  const theirs = <RoachIcon color={them.color} size={88} avatar={them.avatar} clone={them.clone} friend asleep={asleep} zzz={asleep} />;
  const stage = { "--dur": `${GESTURE_MS}ms`, "--end": place.end } as CSSProperties;

  let fx = null;
  if (gesture === "hug") fx = <div className="ta-fx gs-heart" style={{ left: 120, top: 46 }} {...html(miniHeart(26))} />;
  else if (gesture === "highfive") fx = <div className="ta-fx gs-pa" style={{ left: 120, top: 40 }}>啪！</div>;
  else if (gesture === "luck") {
    fx = (
      <>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`gs-star s${i}`} style={{ left: 186, top: 92 }} {...html(star(14 + (i % 2) * 4))} />
        ))}
        <div className="gs-luck-label" style={{ left: 18, top: 44 }}>
          欧气 +1
        </div>
      </>
    );
  } else if (gesture === "blanket") fx = <div className="gs-blanket" style={{ left: 152, top: 104 }} {...html(blanket())} />;
  else fx = <div className="gs-glass" style={{ left: 214, top: 116 }} {...html(glass())} />;

  return (
    <>
      <button type="button" className="ta-skip" aria-label="跳过动画" onPointerDown={finish} onWheel={finish} />
      <div className="ta-place" style={{ left: place.left, top: place.top, transform: `scale(${place.s})` }} aria-hidden="true">
        <div className={`ta-stage gs-${gesture}`} style={stage}>
          {!asleep && (
            <div className="ta-you">
              <div className="ta-body">{yours}</div>
            </div>
          )}
          <div className="ta-them">
            <div className="ta-jump">{theirs}</div>
          </div>
          {fx}
        </div>
      </div>
    </>
  );
}

/** For the sender of 催理智: a little bottle flies off the button with 叮！ (from: the button) */
export function SanityFly({ from, onDone }: { from: { x: number; y: number }; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 1300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="dock-fx gs-vial" style={{ left: from.x - 10, top: from.y - 14 }} {...html(vial(20))} />
      <div className="dock-fx ta-dword gs-ding" style={{ left: from.x + 8, top: from.y - 70 }}>
        叮！
      </div>
    </>
  );
}
