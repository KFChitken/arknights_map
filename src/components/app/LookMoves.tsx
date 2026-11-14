"use client";

import type { CSSProperties, ReactNode } from "react";
import { T } from "@/i18n";
import { alarm, crate, deployCrystal, deployTile, doctorDozing, hoodEyes, hoodLamps, loudspeaker, terminal, wavingHood } from "@/lib/lookArt";
import { GLOW } from "@/lib/roachSvg";
import { burst } from "@/lib/touchArt";
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

/** What your look draws in place of your feeler when you touch boldly, along the same path d: 管理员 a conveyor belt */
export function boldLines(look: RoachAvatar, d: string): ReactNode {
  if (look === "endmin") {
    return (
      <>
        <path className="em-belt" d={d} pathLength={1} />
        <path className="em-dash" d={d} pathLength={30} />
      </>
    );
  }
  return null;
}

/**
 * What your look adds to the stage around them when you touch boldly. f: your feeler, its path (bold) and where it
 * lands on theirs (boldEnd)
 */
export function boldAround(look: RoachAvatar, f: { bold: string; boldEnd: [number, number] }): ReactNode {
  const [x, y] = f.boldEnd;
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
  if (look === "endmin") {
    // 传送带: a crate rides over to them on your belt in place of your name card, and lands with 咚
    return (
      <>
        <div className="em-crateway" style={{ offsetPath: `path('${f.bold}')` }} {...html(crate())} />
        <div className="ta-fx em-dong" style={{ left: x + 3, top: y - 15 }} {...html(burst(T.fx.dong))} />
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

/**
 * What the roach touched sets off around itself, staying where it is as the roach jumps: over the stage in a box
 * where the roach's is (.ta-around), and over your own avatar on the dock.
 */
export function touchedAround(look: DrawnAvatar): ReactNode {
  // 黄黑警报: a warning sign over its head (not when touched on the sly: then ? as anyone), a yellow ring at its feet
  if (look === "endmin") return <div className="ta-lay em-alarm" {...html(alarm())} />;
  return null;
}

/** Whether a look touched boldly says ! of itself (管理员 with its warning sign), so no ! goes up over it */
export const ownMark = (look: DrawnAvatar) => look === "endmin";

/** What your look holds up as it shouts, in its box: 博士 its terminal */
export function shoutProp(look: RoachAvatar): ReactNode {
  if (look === "doctor") return <div className="dc-tablet" {...html(terminal())} />;
  return null;
}

/** What comes up on the stage beside your look as it shouts: 管理员 a loudspeaker on a pole */
export function shoutAround(look: RoachAvatar): ReactNode {
  if (look === "endmin") return <div className="em-pole" {...html(loudspeaker())} />;
  return null;
}
