"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { T } from "@/i18n";
import { coin, loudspeaker, terminal } from "@/lib/lookArt";
import { BUBBLE_MS, type SquadMember } from "@/lib/squad";
import { burst, miniHeart } from "@/lib/touchArt";
import { ROACH_AVATARS, type RoachAvatar, type RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";
import { MOVE_SHOW_MS, type SquadLine, type SquadMoveDone } from "./squading";
import "./squadFight.css";

/**
 * One's roach in a room's tile (the room's sheet, the bar of a round): as their pose has it (蹦迪 hops, the hood's
 * sleeves going up and down; 醉倒睡觉 lies asleep), and what it does a moment: as a line of theirs comes, the look's
 * own shout (初始 both sleeves up, 博士 its terminal, 管理员 the loudspeaker, 绝对主角 twirls, 咕咕嘎嘎 waddles, 鸭爵's
 * coins), which 挥手 plays too; 击掌 啪！ and 贴贴 a heart, on both of the two. And the line's bubble (Bubble), black
 * with yellow words as a 宣言's.
 */

const html = (markup: string) => ({ dangerouslySetInnerHTML: { __html: markup } });
/** A shout or a wave plays this long */
const SHOUT_MS = 900;

/** Whether something that happened at `at` still shows `ms` after, re-rendered once it no longer does */
function useStill(at: number | null, ms: number) {
  const [, tick] = useState(0);
  const left = at === null ? 0 : at + ms - Date.now();
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), left + 30);
    return () => window.clearTimeout(t);
  }, [at, left]);
  return left > 0;
}

const lookOf = (m: SquadMember): RoachAvatar => (ROACH_AVATARS.includes(m.avatar as RoachAvatar) ? (m.avatar as RoachAvatar) : "hood");

/** What a look holds up or brings round as it shouts, in a box of the roach's size */
function ShoutParts({ look, size }: { look: RoachAvatar; size: number }) {
  if (look === "doctor") return <span className="sqr-prop sqr-term" style={{ width: size * 0.5 }} {...html(terminal())} />;
  if (look === "endmin") return <span className="sqr-prop sqr-pole" style={{ height: size * 0.95 }} {...html(loudspeaker())} />;
  if (look === "gugu") return <span className="sqr-prop sqr-gugu">{T.fx.guguGaga}</span>;
  if (look === "duck") {
    return (
      <>
        {[-1, 0, 1].map((k) => (
          <span key={k} className="sqr-prop sqr-coin" style={{ "--dx": `${k * size * 0.32}px` } as CSSProperties} {...html(coin(Math.round(size * 0.22)))} />
        ))}
      </>
    );
  }
  return null;
}

/** The roach of one in the room, size px, doing what their pose and the last moment's line or move say */
export function SquadRoach({ m, size, line, move, toMe }: { m: SquadMember; size: number; line?: SquadLine | null; move?: SquadMoveDone | null; toMe?: SquadMoveDone | null }) {
  const look = lookOf(m);
  const color = m.color as RoachColor;
  const shouting = useStill(line?.at ?? null, SHOUT_MS);
  const own = useStill(move?.at ?? null, MOVE_SHOW_MS);
  const theirs = useStill(toMe?.at ?? null, MOVE_SHOW_MS);
  const waving = own && move?.move === "wave";
  const loud = (shouting || waving) && m.pose !== 2;
  // the hood raises both sleeves as it shouts or waves, and as it dances, half the time
  const hands = look === "hood" && m.pose !== 2 && loud;
  const five = (own && move?.move === "five") || (theirs && toMe?.move === "five");
  const hug = (own && move?.move === "hug") || (theirs && toMe?.move === "hug");
  const key = `${line?.key ?? 0}-${move?.key ?? 0}`;
  return (
    <span className={`sq-roach${m.pose === 1 ? " dance" : m.pose === 2 ? " sleep" : ""}${loud ? ` yell yell-${look}` : ""}${hug ? " lean" : ""}`} style={{ width: size, height: size }} key={key}>
      {m.pose === 2 ? (
        <RoachIcon color={color} avatar={look} size={size} asleep zzz anim />
      ) : m.pose === 1 && look === "hood" ? (
        <span className="sqr-dance">
          <span className="a">
            <RoachIcon color={color} avatar={look} size={size} />
          </span>
          <span className="b">
            <RoachIcon color={color} avatar={look} size={size} hands />
          </span>
        </span>
      ) : (
        <RoachIcon color={color} avatar={look} size={size} hands={hands} />
      )}
      {loud && <ShoutParts look={look} size={size} />}
      {five && <span className="sqr-fx sqr-pa" {...html(burst(T.fx.pa))} />}
      {hug && <span className="sqr-fx sqr-heart" {...html(miniHeart(Math.round(size * 0.34)))} />}
    </span>
  );
}

/** A line said, over the tile of the one who said it, BUBBLE_MS; up by `lift` px when another's shows beside it */
export function Bubble({ line, lift = 0, side = "up" }: { line: SquadLine | null | undefined; lift?: number; side?: "up" | "left" }) {
  const still = useStill(line?.at ?? null, BUBBLE_MS);
  if (!line || !still) return null;
  const text = T.squad.say.lines[line.p - 1];
  if (!text) return null;
  return (
    <span key={line.key} className={`sq-bub ${side}`} style={side === "up" ? ({ "--lift": `${lift}px` } as CSSProperties) : undefined} aria-hidden="true">
      {text}
    </span>
  );
}

/** Lines still over their tiles, by member, and how far up each goes so none covers another beside it (a later one higher) */
export function liftsOf(lines: readonly SquadLine[], order: readonly number[], step: number, now = Date.now()) {
  const shown = lines.filter((l) => now - l.at < BUBBLE_MS && order.includes(l.h)).sort((a, b) => a.at - b.at);
  const lift = new Map<number, number>();
  shown.forEach((l, i) => {
    const at = order.indexOf(l.h);
    const below = shown.slice(0, i).filter((o) => Math.abs(order.indexOf(o.h) - at) <= 1);
    lift.set(l.h, below.length ? Math.max(...below.map((o) => lift.get(o.h) ?? 0)) + step : 0);
  });
  return lift;
}
