"use client";

import type { CSSProperties, ReactNode } from "react";
import { T } from "@/i18n";
import { deployCrystal, deployTile, doctorDozing, hoodEyes, hoodLamps, terminal, wavingHood } from "@/lib/lookArt";
import { GLOW } from "@/lib/roachSvg";
import type { DrawnAvatar, RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";

/**
 * Each look's own moves, for the touch scenes and the shout (TouchStage.tsx) and the dock (DockFx.tsx). The stage
 * says whose they are with you-<look>, them-<look> and me-<look>, and globals.css plays the pieces here by them.
 * Only the look your map draws reacts: a stranger's clone wears the plain hood there (roachSvg.ts), so it reacts as
 * the hood does, whoever's it is.
 */

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });
const glowing = (glow: string) => ({ "--glow": glow }) as CSSProperties;

/** Where 博士's three crystals land on the tile, from where its feeler touches them (px) */
const CRYSTALS = [
  [20, 66],
  [34, 71],
  [48, 64],
];

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

/** What your look adds to the stage around them when you touch boldly; at: where your feeler lands on theirs */
export function boldAround(look: RoachAvatar, [x, y]: [number, number]): ReactNode {
  if (look === "doctor") {
    // 部署: a tile lights up under them, your name card drops into it with three crystals, a beam of light, 部署！
    return (
      <>
        <div className="dc-tile" {...html(deployTile())} />
        <div className="dc-beam" />
        <div className="dc-ring" />
        {CRYSTALS.map(([dx, dy]) => (
          <div key={dx} className="dc-drop" style={{ left: x, top: y, "--dx": `${dx}px`, "--dy": `${dy}px` } as CSSProperties} {...html(deployCrystal())} />
        ))}
        <div className="dc-word">{T.fx.deploy}</div>
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
  // 打瞌睡被吵醒: dozing on its feet with a snot bubble, which pops as it is touched
  if (look === "doctor") return <div className="ta-lay dc-doze" {...html(doctorDozing())} />;
  return null;
}

/** What your look holds up as it shouts, in its box: 博士 its terminal */
export function shoutProp(look: RoachAvatar): ReactNode {
  if (look === "doctor") return <div className="dc-tablet" {...html(terminal())} />;
  return null;
}
