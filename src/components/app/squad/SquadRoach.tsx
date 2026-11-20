"use client";
/* eslint-disable @next/next/no-img-element -- the site's own small pictures (public/fish), shown as they are */

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { coin, loudspeaker, terminal } from "@/lib/lookArt";
import { BUBBLE_MS, type SquadMember } from "@/lib/squad";
import { shakes, throwOf } from "@/lib/squadFire";
import { burst, miniHeart } from "@/lib/touchArt";
import { ROACH_AVATARS, type RoachAvatar, type RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";
import { nameOf, picOf } from "../fish/words";
import { lineWords, MOVE_SHOW_MS, squadHitBack, squadShakeOff, THROW_SHOW_MS, useSquadRoom, useSquadThrows, type SquadLine, type SquadMoveDone } from "./squading";
import "./squadFight.css";
import "./squadFire.css";

/**
 * One's roach in a room's tile (the room's sheet, the bar of a round): as their pose has it (蹦迪 hops, the hood's
 * sleeves going up and down; 醉倒睡觉 lies asleep), and what it does a moment: as a line of theirs comes, the look's
 * own shout (初始 both sleeves up, 博士 its terminal, 管理员 the loudspeaker, 绝对主角 twirls, 咕咕嘎嘎 waddles, 鸭爵's
 * coins), which 挥手 plays too; 击掌 啪！ and 贴贴 a heart, on both of the two. And the line's bubble (Bubble), black
 * with yellow words as a 宣言's. In a room's tiles (play), 扔东西 too (Play): what lands on it, a moment, with its line
 * and who threw it; what stays on the head (光环, 漏勺, 源石虫); asleep (令的酒) or dancing (黑胶) as the poses draw
 * them; a ball by it, and on your own tile, a tap to send it back or to shake a 源石虫 off.
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

/** Whether it is before `until` (ms), re-rendered as it no longer is */
function useUntil(until: number | undefined) {
  const [, tick] = useState(0);
  const left = until === undefined ? 0 : until - Date.now();
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.min(left + 30, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [until, left]);
  return left > 0;
}

/**
 * 扔东西 on one's tile: what landed a moment ago, what stays on the head, a ball; on your own, what a tap does (taps:
 * a button of its own, where the tile is no button itself; else the tile's tap does it, SquadFight.tsx)
 */
function Play({ m, size, taps }: { m: SquadMember; size: number; taps: boolean }) {
  const r = useSquadRoom();
  const landing = useSquadThrows().find((t) => t.to === m.h);
  const still = useStill(landing?.at ?? null, THROW_SHOW_MS);
  const headOn = useUntil(m.head?.until);
  const ballOn = useUntil(m.ball?.until);
  const head = headOn && m.head ? throwOf(m.head.item) : null;
  const ball = ballOn && m.ball ? throwOf(m.ball.item) : null;
  const landed = still && landing ? throwOf(landing.item) : null;
  const words = landed ? (T.squad.throw.items as Record<string, { name: string; say: string }>)[landed.key] : null;
  const by = landing && r?.members.find((x) => x.h === landing.h);
  const shake = m.you && head && shakes(head.no);
  return (
    <>
      {head && <img className={`sqr-on head-${head.key}`} src={picOf(head.key)} alt="" style={{ width: size * 0.7 }} />}
      {ball && <img className="sqr-on ball" src={picOf(ball.key)} alt="" style={{ width: size * 0.5 }} />}
      {landed && words && landed.fx !== "head" && landed.fx !== "say" && (
        <img key={`t${landing!.key}`} className="sqr-thing" src={picOf(landed.key)} alt="" style={{ width: size * 0.6 }} />
      )}
      {landed && words && (
        <span key={landing!.key} className={`sqr-land${taps ? "" : " in-bar"}`} aria-hidden="true">
          <span className="sqr-say">
            {fmt(words.say, { n: landing!.n ?? 1, item: landing!.out ? nameOf(landing!.out) : "" })}
            {by && <small>{fmt(T.squad.throw.by, { name: by.name })}</small>}
          </span>
        </span>
      )}
      {m.you && ball && (taps ? (
        <button type="button" className="sqr-tap" onClick={() => void squadHitBack().catch(() => {})}>
          {T.squad.throw.hitBack}
        </button>
      ) : (
        <span className="sqr-tap in-bar">{T.squad.throw.hitBack}</span>
      ))}
      {shake && !ball && (taps ? (
        <button type="button" className="sqr-tap" onClick={() => void squadShakeOff().catch(() => {})}>
          {T.squad.throw.shake}
        </button>
      ) : (
        <span className="sqr-tap in-bar">{T.squad.throw.shake}</span>
      ))}
    </>
  );
}

/** The roach of one in the room, size px, doing what their pose and the last moment's line or move say (play: 扔东西 too) */
export function SquadRoach({
  m: given,
  size,
  line,
  move,
  toMe,
  play,
}: {
  m: SquadMember;
  size: number;
  line?: SquadLine | null;
  move?: SquadMoveDone | null;
  toMe?: SquadMoveDone | null;
  /** 扔东西 drawn on it too: in a tile that is no button (tile), with your own taps as buttons; in one (bar) */
  play?: "tile" | "bar";
}) {
  // 令的酒 lays it down a while, 黑胶 makes it dance, as the poses draw them
  const fxOn = useUntil(play ? given.fx?.until : undefined);
  const fx = fxOn && given.fx ? throwOf(given.fx.item)?.fx : null;
  const m = fx === "faint" ? { ...given, pose: 2 as const } : fx === "dance" ? { ...given, pose: 1 as const } : given;
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
      {fx === "faint" && (
        <span className="sqr-stars" aria-hidden="true">
          ✦ ✦
        </span>
      )}
      {play && <Play m={m} size={size} taps={play === "tile"} />}
    </span>
  );
}

/**
 * A line said, over the tile of the one who said it, BUBBLE_MS; up by `lift` px when another's shows beside it (in:
 * inside the tile, over what is under the name, as the bar of a round on a computer has it). One said to someone
 * (对 TA 说) names TA over it, 「对你」 to the viewer (to: TA, as the room has TA now).
 */
export function Bubble({ line, lift = 0, side = "up", to }: { line: SquadLine | null | undefined; lift?: number; side?: "up" | "left" | "in"; to?: SquadMember | null }) {
  const still = useStill(line?.at ?? null, BUBBLE_MS);
  if (!line || !still || !T.squad.say.lines[line.p - 1]) return null;
  const named = line.to === undefined || !to ? null : to.you ? T.squad.say.toYou : fmt(T.squad.say.toName, { name: to.name });
  return (
    <span key={line.key} className={`sq-bub ${side}`} style={side === "up" ? ({ "--lift": `${lift}px` } as CSSProperties) : undefined} aria-hidden="true">
      {named && <small className="sq-bto">{named}</small>}
      {lineWords(line.p, line.s)}
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
