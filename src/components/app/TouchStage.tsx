"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { T } from "@/i18n";
import { usesPicture } from "@/lib/roachImages";
import { GLOW } from "@/lib/roachSvg";
import {
  bigHeart,
  boop,
  feelers,
  mark,
  miniHeart,
  shadowRoach,
  SHOUT_MS,
  SHOUT_TOAST_MS,
  shoutingHood,
  shoutLines,
  tap,
  TOUCH_MS,
  type TouchKind,
} from "@/lib/touchArt";
import type { DrawnAvatar, RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import { boldYou, touchedOn } from "./LookMoves";

/**
 * Who is in a touch scene. you: your own look and the name your dock shows. them: the
 * roach you touched, drawn as the map draws it (someone else's clone in the plain hood).
 */
export type TouchCast = {
  you: { avatar: RoachAvatar; color: RoachColor; name: string };
  them: { avatar: DrawnAvatar; color: RoachColor; clone: boolean; friend: boolean };
};

/** Where the stage goes over the map (see stagePlace in lib/touchArt.ts) */
export type StagePlace = { s: number; left: number; top: number; end: number };

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });

/**
 * Touching someone, played once on the toucher's own screen over the spot of the roach
 * touched (which the map leaves out meanwhile): 偷偷 a shadow tiptoes up and taps low,
 * 大胆 your roach hops in and its feeler lands with 啵! and your name card, 成为触须之交
 * both feelers meet under a heart. Each look adds its own moves (LookMoves.tsx). Tapping
 * or dragging the map ends it at once.
 */
export default function TouchStage({
  kind,
  cast,
  place,
  onDone,
}: {
  kind: TouchKind;
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
    const t = window.setTimeout(finish, TOUCH_MS[kind]);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { you, them } = cast;
  // a stranger's clone wears the plain hood with white lamps, so its feeler and its moves are the hood's; a
  // 触须之交's wears TA's look (roachSvg.ts)
  const plain = them.clone && !them.friend;
  const theirLook = plain ? "hood" : them.avatar;
  const f = feelers(you.avatar, theirLook);
  const theirs = (friend: boolean) => <RoachIcon color={them.color} size={88} avatar={them.avatar} clone={them.clone} friend={friend} />;
  const yours = <RoachIcon color={you.color} size={88} avatar={you.avatar} mine />;
  const touched = touchedOn(theirLook, GLOW[plain ? "white" : them.color]);
  const line = (d: string, cls = "") => <path className={`ta-line ${cls}`} d={d} pathLength={1} />;
  const stage = { "--dur": `${TOUCH_MS[kind]}ms`, "--end": place.end } as CSSProperties;
  // each look's own moves play by these (LookMoves.tsx); sneaking up, you are a shadow with no look
  const looks = `${kind === "sneaky" ? "" : ` you-${you.avatar}`} them-${theirLook}`;

  let scene;
  if (kind === "sneaky") {
    scene = (
      <>
        <div className="ta-you">
          <div className="ta-body" {...html(shadowRoach())} />
        </div>
        <div className="ta-them">
          <div className="ta-jump">
            <div className="ta-look">
              <div className="ta-a">{theirs(them.friend)}</div>
              {touched}
            </div>
          </div>
        </div>
        <svg className="ta-lines" viewBox="0 0 240 160" aria-hidden="true">
          {line(f.sneaky)}
        </svg>
        <div className="ta-fx ta-tap" style={{ left: 157, top: 114 }} {...html(tap())} />
        <div className="ta-mark" style={{ left: 204, top: 38 }} {...html(mark("?"))} />
      </>
    );
  } else if (kind === "bold") {
    const [bx, by] = f.boldEnd;
    scene = (
      <>
        <div className="ta-you">
          <div className="ta-body">{boldYou(you.avatar, you.color) ?? yours}</div>
        </div>
        <div className="ta-them">
          <div className="ta-jump">
            <div className="ta-a">{theirs(them.friend)}</div>
            {touched}
          </div>
        </div>
        <svg className="ta-lines" viewBox="0 0 240 160" aria-hidden="true">
          {line(f.bold)}
        </svg>
        <div className="ta-fx ta-boop" style={{ left: bx + 3, top: by - 15 }} {...html(boop())} />
        <div className="ta-cardway" style={{ offsetPath: `path('${f.bold}')` }}>
          <span className="ta-card">
            <span className="ta-card-pic">
              <RoachIcon color={you.color} size={20} avatar={you.avatar} />
            </span>
            <b>{you.name}</b>
          </span>
        </div>
        <div className="ta-mark" style={{ left: 204, top: 38 }} {...html(mark("!"))} />
      </>
    );
  } else {
    const [mx, my] = f.meet;
    scene = (
      <>
        <div className="ta-you">
          <div className="ta-body">{yours}</div>
        </div>
        <div className="ta-them">
          <div className="ta-jump">
            <div className="ta-a">{theirs(them.friend)}</div>
            <div className="ta-b">{theirs(true)}</div>
          </div>
        </div>
        <svg className="ta-lines" viewBox="0 0 240 160" aria-hidden="true">
          {line(f.mine, "l1")}
          {line(f.theirs, "l2")}
        </svg>
        <div className="ta-fx ta-heart" style={{ left: mx, top: my }} {...html(bigHeart())} />
        <div className="ta-fx ta-mini m1" style={{ left: 46, top: 64 }} {...html(miniHeart())} />
        <div className="ta-fx ta-mini m2" style={{ left: 198, top: 60 }} {...html(miniHeart())} />
        <div className="ta-fx ta-mini m3" style={{ left: mx, top: 18 }} {...html(miniHeart(10))} />
        <div className="ta-ribbon" style={{ left: 120, top: 150 }}>
          {T.fx.friends}
        </div>
      </>
    );
  }

  return (
    <>
      {/* under the stage and over the map: a tap, a drag or a wheel anywhere ends the scene */}
      <button type="button" className="ta-skip" aria-label={T.fx.skip} onPointerDown={finish} onWheel={finish} />
      <div className="ta-place" style={{ left: place.left, top: place.top, transform: `scale(${place.s})` }} aria-hidden="true">
        <div className={`ta-stage ta-${kind}${looks}`} style={stage}>
          {scene}
        </div>
      </div>
    </>
  );
}

/** Where a shout's stage goes, and its 10 km in stage px (see shoutPlace in lib/touchArt.ts) */
export type ShoutPlace = StagePlace & { R: number };

/**
 * 独立宣言, played once on the sender's own screen over the roach it went out from (which
 * the map leaves out meanwhile): a deep breath, both sleeves up (the looks that are
 * pictures only breathe and spring), the line pops out over its head, and rings run out
 * to 10 km. onToast as the rings reach it, onDone at the end; a tap or a drag ends it at once.
 */
export function ShoutStage({
  me,
  text,
  limited,
  place,
  onToast,
  onDone,
}: {
  me: { avatar: RoachAvatar; color: RoachColor };
  text: string;
  limited: boolean;
  place: ShoutPlace;
  onToast: () => void;
  onDone: () => void;
}) {
  const toasted = useRef(false);
  const done = useRef(false);
  const toast = () => {
    if (toasted.current) return;
    toasted.current = true;
    onToast();
  };
  const finish = () => {
    if (done.current) return;
    done.current = true;
    toast();
    onDone();
  };
  useEffect(() => {
    const t = window.setTimeout(toast, SHOUT_TOAST_MS);
    const end = window.setTimeout(finish, SHOUT_MS);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picture = usesPicture({ avatar: me.avatar });
  const stage = { "--dur": `${SHOUT_MS}ms`, "--R": `${place.R}px`, "--end": place.end } as CSSProperties;
  return (
    <>
      <button type="button" className="ta-skip" aria-label={T.fx.skip} onPointerDown={finish} onWheel={finish} />
      <div className="ta-place" style={{ left: place.left, top: place.top, transform: `scale(${place.s})` }} aria-hidden="true">
        <div className={`ta-stage ta-shout${picture ? " ta-pic" : ""}`} style={stage}>
          <div className="ta-ring r1" />
          <div className="ta-ring r2" />
          <div className="ta-ring r3" />
          <div className="ta-r10">{T.fx.tenKm}</div>
          <div className="ta-me">
            <div className="ta-body">
              <div className="ta-calm">
                <RoachIcon color={me.color} size={88} avatar={me.avatar} mine />
              </div>
              {!picture && <div className="ta-up" {...html(shoutingHood(GLOW[me.color]))} />}
              <div className="ta-shoutlines" {...html(shoutLines())} />
            </div>
          </div>
          <div className="ta-bubble">
            {limited && <span className="ta-tag">{T.map.declare.limited}</span>}
            {text}
          </div>
        </div>
      </div>
    </>
  );
}
