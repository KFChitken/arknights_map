"use client";

import type { CSSProperties, ReactNode } from "react";
import { hoodEyes, hoodLamps, wavingHood } from "@/lib/lookArt";
import { GLOW } from "@/lib/roachSvg";
import type { DrawnAvatar, RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";

/**
 * Each look's own moves, for the touch scenes (TouchStage.tsx) and the dock (DockFx.tsx). The stage says whose they
 * are with you-<look> and them-<look>, and globals.css plays the pieces here by them. Only the look your map draws
 * reacts: a stranger's clone wears the plain hood there (roachSvg.ts), so it reacts as the hood does, whoever's it is.
 */

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });
const glowing = (glow: string) => ({ "--glow": glow }) as CSSProperties;

/** Your roach hopping in for 大胆碰 with its own move, in place of the roach as it is; null for the roach as it is */
export function boldYou(look: RoachAvatar, color: RoachColor): ReactNode {
  if (look === "hood") {
    // 挥袖子: one sleeve up, waved twice, both lamps blinking in your colour
    const glow = GLOW[color];
    return (
      <>
        <div className="ta-lay hd-calm">
          <RoachIcon color={color} size={88} avatar="hood" mine />
        </div>
        <div className="ta-lay hd-wave" {...html(wavingHood(glow))} />
        <div className="ta-lay hd-glow" style={glowing(glow)} {...html(hoodLamps(glow))} />
      </>
    );
  }
  return null;
}

/**
 * What the roach touched does over itself, in its own box: on the stage over the roach as your map draws it (its
 * lamps' colour glow), and on the dock over your own avatar. The stage and the dock time it (被大胆碰, 被偷偷碰).
 */
export function touchedOn(look: DrawnAvatar, glow: string): ReactNode {
  if (look === "hood") {
    // 灯一闪，睁圆眼: the lamps flash and two round eyes pop up on the visor and blink
    return (
      <>
        <div className="ta-lay hd-flash" style={glowing(glow)} {...html(hoodLamps(glow))} />
        <div className="ta-lay hd-eyes" {...html(hoodEyes())} />
      </>
    );
  }
  return null;
}
