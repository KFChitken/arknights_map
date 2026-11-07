"use client";

import { useEffect } from "react";
import { drinkingHood, groundOnly, bottle, POKE_BANG, POKE_FINGER } from "@/lib/flipArt";
import { sleepingZzz } from "@/lib/roachImages";
import { GLOW } from "@/lib/roachSvg";
import type { DrawnAvatar, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import RoachIcon from "../RoachIcon";

/** How long each scene runs; the steps inside are timed in globals.css (.actor). */
const LENGTH_MS = { drink: 2850, wake: 1800 };

const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`;

/**
 * Your own main roach, big, acting out 摄入酒精 (bottle up, glug, wobble, hiccup,
 * tip over) or 醒酒 (鲤鱼打挺). Only the hood holds the bottle; the realistic roach
 * and the pictures just wobble and tip over. Seen only by the one who pressed.
 */
export default function RoachActor({
  scene,
  avatar,
  color,
  look,
  onDone,
}: {
  scene: "drink" | "wake";
  avatar: RoachAvatar;
  color: RoachColor;
  look: RoachStyle;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDone, LENGTH_MS[scene]);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const hood = avatar === "hood" && look === "cartoon";
  const glow = GLOW[color];
  const lay = (cls: string, html: string) => <div className={`lay ${cls}`} dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <div className={`actor ${hood ? "" : "plain"}`} data-state={scene === "drink" ? "drinking" : "waking"} aria-hidden="true">
      {hood && lay("base", svg(groundOnly("mine")))}
      <div className="lay asleep">
        <RoachIcon color={color} size={120} avatar={avatar} look={look} mine asleep zzz anim />
      </div>
      <div className="lay awake">
        <RoachIcon color={color} size={120} avatar={avatar} look={look} mine />
      </div>
      {hood && lay("bottle", svg(bottle("rest")))}
      {hood && lay("sip", svg(drinkingHood(glow, { pour: true })))}
      {hood ? (
        lay("drunk", svg(drinkingHood(glow, { drunk: true })))
      ) : (
        <div className="lay drunk">
          <RoachIcon color={color} size={120} avatar={avatar} look={look} mine />
        </div>
      )}
      <span className="dust l" />
      <span className="dust r" />
      {scene === "wake" ? <span className="pop">嘿！</span> : null}
      {scene === "drink" && hood ? (
        <>
          <span className="glug">咕嘟咕嘟</span>
          <span className="hic">嗝！</span>
        </>
      ) : null}
    </div>
  );
}

/** How long 戳一戳 runs (.actor.poke in globals.css), and when the finger lands */
const POKE_MS = 1300;
export const POKE_LANDS_MS = 700;

/**
 * 戳一戳 on a 触须之交's sleeping roach: a finger comes down, 「戳!」, the roach
 * jolts and its Zzz scatter, then it sleeps on. Seen only by the one who poked.
 * Without the finger (finger false) it is a sleeping roach touched: it only jolts.
 */
export function PokeActor({
  avatar,
  color,
  look,
  friend = true,
  finger = true,
  onDone,
}: {
  avatar: DrawnAvatar;
  color: RoachColor;
  look: RoachStyle;
  friend?: boolean;
  finger?: boolean;
  onDone: () => void;
}) {
  useEffect(() => {
    const t = window.setTimeout(onDone, POKE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opts = { avatar, look, friend, asleep: true };
  return (
    <div className="actor poke" aria-hidden="true">
      <div className="lay body">
        <RoachIcon color={color} size={120} {...opts} anim />
      </div>
      <div className="lay zs" dangerouslySetInnerHTML={{ __html: svg(sleepingZzz(opts)) }} />
      {finger && <div className="finger" dangerouslySetInnerHTML={{ __html: POKE_FINGER }} />}
      {finger && <div className="bang" dangerouslySetInnerHTML={{ __html: POKE_BANG }} />}
    </div>
  );
}
