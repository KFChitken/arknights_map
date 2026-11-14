"use client";

import type { CSSProperties, ReactNode } from "react";
import { T } from "@/i18n";
import {
  alarm,
  coin,
  contract,
  crate,
  deployCrystal,
  deployTile,
  devilBits,
  doctorDozing,
  duckApart,
  duckFigure,
  dust,
  flaps,
  heartSeal,
  hoodEyes,
  hoodLamps,
  loot,
  loudspeaker,
  paperPlane,
  speedLines,
  standingApart,
  terminal,
  wavingHood,
  type Whose,
} from "@/lib/lookArt";
import { GLOW } from "@/lib/roachSvg";
import { boop, burst } from "@/lib/touchArt";
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
  // 肚皮滑行: the picture alone slides in on its belly; its ground waits for it (boldGround)
  if (look === "gugu") return <div className="ta-lay" {...html(standingApart(look).figure)} />;
  if (look === "duck") {
    // 递金名片: he tips his hat, his silver case lights up and a coin pops out of it; the card that flies is gold
    return (
      <>
        {facingThem(look)}
        <div className="dk-glow" />
        <div className="dk-pop" style={{ "--dx": "-6px", "--dy": "-30px" } as CSSProperties} {...html(coin(14))} />
      </>
    );
  }
  return null;
}

/**
 * Your look on the left of a stage, turned to face them when it is a picture that faces the other way (鸭爵, drawn
 * facing left), in its parts so they can move; null for the roach as it is
 */
export function facingThem(look: RoachAvatar): ReactNode {
  if (look === "duck") return <div className="ta-lay" {...html(duckFigure({ mine: true }, { flip: true }))} />;
  return null;
}

/**
 * The roach touched in its parts, where they move on their own (鸭爵's hat flies off when he is touched on the sly), in
 * place of the roach as it is; null for that. whose: as the map draws it (a 触须之交's, a clone)
 */
export function theirParts(look: DrawnAvatar, whose: Whose): ReactNode {
  if (look === "duck") return <div className="ta-lay" {...html(duckFigure(whose))} />;
  return null;
}

/**
 * The roach touched boldly, when it does not stay where it is: 鸭爵 turns and runs off, leaving his ground and his
 * black case behind, a treasure popping out of it, and comes back for it. stays: what stays, under the roach; runs:
 * what runs, in place of the roach as it is; after: what goes up over them. null for the roach as it is.
 */
export function boldThem(look: DrawnAvatar, whose: Whose): { stays: ReactNode; runs: ReactNode; after: ReactNode } | null {
  if (look !== "duck") return null;
  const { stays, bcase, figure } = duckApart(whose);
  return {
    stays: (
      <>
        <div className="ta-lay" {...html(stays)} />
        <div className="ta-lay dk-case" {...html(bcase)} />
      </>
    ),
    runs: <div className="ta-lay" {...html(figure)} />,
    after: (
      <>
        <div className="dk-loot" {...html(loot())} />
        <div className="dk-dust" {...html(dust())} />
        <div className="dk-zoom">{T.fx.whoosh}</div>
      </>
    ),
  };
}

/** What either look adds as you become 触须之交: with 鸭爵 a contract drops between the feelers, and 啪！ a heart seal on it */
export function friendsAround(you: RoachAvatar, them: DrawnAvatar): ReactNode {
  if (you !== "duck" && them !== "duck") return null;
  return (
    <>
      <div className="dk-contract" {...html(contract(T.fx.contract))} />
      <div className="dk-stamp" {...html(heartSeal())} />
      <div className="dk-pa">{T.fx.stamp}</div>
    </>
  );
}

/** What stays where you land as your look comes in on its own (boldYou): 咕咕嘎嘎's ground, waiting as it slides in */
export function boldGround(look: RoachAvatar): ReactNode {
  if (look === "gugu") return <div className="ta-lay gg-gnd" {...html(standingApart(look).ground)} />;
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
  if (look === "imp") {
    // 纸飞机: 略～ at them first, then a paper plane flies over along your feeler, 啵! as it lands, and turns into your
    // name card there
    return (
      <>
        <div className="im-plane" style={{ offsetPath: `path('${f.bold}')` }} {...html(paperPlane())} />
        <div className="im-tease">{T.fx.tease}</div>
        <div className="ta-fx im-pa" style={{ left: x + 3, top: y - 15 }} {...html(boop())} />
      </>
    );
  }
  if (look === "gugu") {
    // 肚皮滑行: speed lines behind it as it slides in, and 嘎! in place of 啵! where its feeler lands
    return (
      <>
        <div className="gg-speed" {...html(speedLines())} />
        <div className="ta-fx gg-ga" style={{ left: x + 3, top: y - 15 }} {...html(burst(T.fx.quack))} />
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
  // 扑腾: flap lines either side as it flaps its wings
  if (look === "gugu") return <div className="ta-lay gg-flap" {...html(flaps())} />;
  return null;
}

/**
 * What the roach touched sets off around itself, staying where it is as the roach jumps: over the stage in a box
 * where the roach's is (.ta-around), and over your own avatar on the dock.
 */
export function touchedAround(look: DrawnAvatar): ReactNode {
  // 黄黑警报: a warning sign over its head (not when touched on the sly: then ? as anyone), a yellow ring at its feet
  if (look === "endmin") return <div className="ta-lay em-alarm" {...html(alarm())} />;
  // 做鬼脸: 略略略～ as it twirls round (not on the sly either)
  if (look === "imp") return <div className="im-lue">{T.fx.lue}</div>;
  // 扑腾: 嘎！ as it flaps (not on the sly either)
  if (look === "gugu") return <div className="gg-quack">{T.fx.quackBack}</div>;
  return null;
}

/**
 * The looks that say ! of themselves when touched boldly (管理员's warning sign, 绝对主角's 略略略～, 咕咕嘎嘎's 嘎！),
 * so no ! goes up
 */
const OWN_MARK: ReadonlySet<DrawnAvatar> = new Set(["endmin", "imp", "gugu"]);
export const ownMark = (look: DrawnAvatar) => OWN_MARK.has(look);

/**
 * How your dock avatar itself moves when you are touched and your look has a move of its own: 绝对主角 twirls round,
 * 咕咕嘎嘎 flaps; 鸭爵 hides while his parts play over it (dockParts), which shiver as anyone's on the sly
 */
export function dockMove(look: RoachAvatar, kind: "sneaky" | "bold"): string | null {
  if (look === "imp") return kind === "bold" ? "im-dspin" : "im-dspin-q";
  if (look === "gugu") return kind === "bold" ? "gg-dflap" : "gg-dflap-q";
  if (look === "duck") return kind === "bold" ? "dk-dhide" : "dk-dhide ta-dshiver";
  return null;
}

/**
 * Your look in its parts over your dock avatar, as the stage has them in its 88 px box scaled to the avatar's (scale),
 * when they move apart as you are touched: 鸭爵's hat flies off on the sly; touched boldly he dashes aside and back, his
 * black case staying with a treasure popping out. Your avatar hides meanwhile (dockMove).
 */
export function dockParts(look: RoachAvatar, kind: "sneaky" | "bold", scale: number): ReactNode {
  if (look !== "duck") return null;
  const box = { transform: `scale(${scale})` };
  // the dock draws your look as anyone's, on a shadow
  if (kind === "sneaky") {
    return (
      <div className="dk-mini" style={box}>
        <div className="ta-lay" {...html(duckFigure({}))} />
      </div>
    );
  }
  const { stays, bcase, figure } = duckApart({});
  return (
    <div className="dk-mini" style={box}>
      <div className="ta-lay" {...html(stays)} />
      <div className="ta-lay dk-case" {...html(bcase)} />
      <div className="ta-lay dk-dash" {...html(figure)} />
      <div className="dk-loot" {...html(loot())} />
      <div className="dk-dust" {...html(dust())} />
    </div>
  );
}

/** What your look holds up as it shouts, in its box: 博士 its terminal */
export function shoutProp(look: RoachAvatar): ReactNode {
  if (look === "doctor") return <div className="dc-tablet" {...html(terminal())} />;
  return null;
}

/** The looks whose picture moves on its own as they shout, over a ground that stays, and its class */
const SHOUT_FIGURE: Partial<Record<RoachAvatar, string>> = { imp: "im-fig", gugu: "gg-fig" };

/**
 * Your look as it shouts, when the picture moves on its own over a ground that stays (绝对主角 twirls round, 咕咕嘎嘎
 * waddles) or moves in its parts (鸭爵 lifts his hat); null for the roach as it is
 */
export function shoutFigure(look: RoachAvatar): ReactNode {
  if (look === "duck") return <div className="ta-lay" {...html(duckFigure({ mine: true }))} />;
  const move = SHOUT_FIGURE[look];
  if (!move) return null;
  const { ground, figure } = standingApart(look);
  return (
    <>
      <div className="ta-lay" {...html(ground)} />
      <div className={`ta-lay ${move}`} {...html(figure)} />
    </>
  );
}

/** What your look adds to the bubble it shouts: 绝对主角 little devil horns and a tail */
export function shoutBubble(look: RoachAvatar): ReactNode {
  if (look === "imp") return <span className="im-devil" {...html(devilBits())} />;
  return null;
}

/** Where 鸭爵's coins fly out of his silver case to as he shouts (px), each its own way */
const SHOUT_COINS = [
  [-52, -24],
  [-36, -36],
  [-18, -44],
  [20, -42],
  [38, -34],
  [54, -22],
  [4, -48],
];

/**
 * What comes up on the stage beside your look as it shouts: 管理员 a loudspeaker on a pole, 咕咕嘎嘎 咕咕嘎嘎～, 鸭爵 gold
 * coins and a flash out of his silver case
 */
export function shoutAround(look: RoachAvatar): ReactNode {
  if (look === "endmin") return <div className="em-pole" {...html(loudspeaker())} />;
  if (look === "gugu") return <div className="gg-sound">{T.fx.guguGaga}</div>;
  if (look === "duck") {
    return (
      <>
        {SHOUT_COINS.map(([dx, dy], i) => (
          <div key={i} className="dk-coin" style={{ "--dx": `${dx}px`, "--dy": `${dy}px`, "--k": (i % 4) * 0.025 } as CSSProperties} {...html(coin(i % 3 ? 12 : 14))} />
        ))}
        <div className="dk-shine" />
      </>
    );
  }
  return null;
}

/** What your look has in its box for 吸欧气: 鸭爵's silver case lights up as the coins drop in */
export function luckIn(look: RoachAvatar): ReactNode {
  if (look === "duck") return <div className="dk-glow" />;
  return null;
}

/**
 * One of the lucky stars that float over to you (size px, drawn by star), when your look has its own: for 鸭爵 they turn
 * into coins on the way; null for the star as it is
 */
export function luckStar(look: RoachAvatar, size: number, star: (size: number) => string): ReactNode {
  if (look !== "duck") return null;
  return (
    <>
      <span className="st" {...html(star(size))} />
      <span className="co" {...html(coin(size))} />
    </>
  );
}
