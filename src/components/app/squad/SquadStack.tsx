"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  STACK_BLOCK_H,
  STACK_EVERY_MS,
  STACK_GEARS,
  STACK_REBUILD_MS,
  STACK_SHOWN,
  STACK_WOBBLE_PX,
  stackGear,
  stackHeight,
  stackNow,
  stackSwing,
  stackSwingMs,
  type SquadStack as Tower,
  type StackBoard,
} from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { SquadRoach } from "./SquadRoach";
import SquadStackBoard from "./SquadStackBoard";
import {
  closeSquadStack,
  loadStackBoard,
  openSquadModeCard,
  openSquadStack,
  squadServerNow,
  squadStackDrop,
  useSquadModeCard,
  useSquadRoom,
  useSquadStackBehind,
  useSquadStackMine,
  useSquadStackOpen,
} from "./squading";
import "./squadModes.css";

/**
 * 基建加盖 (the room's own tower, always there beside the modes; src/lib/squadMode.ts), its card at the map's foot as
 * the modes' are, opened from 「玩」. A tower of roaches on a plank, each block the roach of the one who put it; yours
 * swings over its top (the server's clock, the same for everyone: stackSwing), faster each 10 layers, and 放 lets it
 * fall there, anyone in the room as they like, one a second each. A block well off makes the tower sway; one too far
 * off, and it falls (the blocks tumbling), and 3 seconds on a new plank is there by itself. Over the tower its height
 * and the room's highest, the swing's gear; under it the way to 基建周榜 and 放. A strip at its top leads back to the
 * mode you are in. The card follows the canvas 「基建加盖 常驻」.
 */

/** On the stage (px from its foot): the plank's foot, the first block's, the ground's top */
const BASE_Y = 112;
const FIRST_Y = 122;
const GROUND_Y = 123;
/** The layers the stage shows over its foot once the tower goes down as it grows */
const STAGE_LAYERS = STACK_SHOWN + 4;
/** A line over the tower shows this long after its block: it sways, it went up a gear, a teammate's */
const WOBBLE_MS = 1_200;
const GEAR_MS = 1_400;
const MATE_MS = 1_200;
/** Tapped too soon after your last: said this long */
const SLOW_MS = 900;
/** The blocks tumble this long as the tower falls; a block drops onto it this long; it sways this long */
const FALL_MS = 1_000;
const DROP_MS = 250;
const SWAY_MS = 1_500;
/** The page's clock is looked at this often while the card is open (the swing itself goes every frame) */
const TICK_MS = 250;
/** 基建周榜's way in is read again this often while the card is open (the server keeps the board half a minute) */
const BOARD_EVERY_MS = 30_000;

/** Whose roach a block is: one of the room, or (one gone since) a roach of no one's */
export function blockOf(room: SquadRoom, h: number): SquadMember {
  return (
    room.members.find((m) => m.h === h) ?? {
      h,
      name: "",
      host: false,
      you: false,
      friend: false,
      inGame: false,
      pose: 0,
      avatar: "hood",
      color: "white",
      core: 0,
      strategy: null,
      extras: [],
    }
  );
}

/** How far down the tower goes on the stage as it grows past STACK_SHOWN layers (px) */
export const towerShift = (n: number) => Math.max(0, n - STACK_SHOWN) * STACK_BLOCK_H;
/** The layers under those the stage shows */
export const towerBelow = (n: number) => Math.max(0, n - STAGE_LAYERS);

/** Its top block and the one under it (the plank's middle under the first) */
const topOf = (tower: Tower) => {
  const top = tower.top.at(-1);
  return top ? { top, under: tower.top.length > 1 ? tower.top[tower.top.length - 2].x : 0 } : null;
};

/**
 * The line over the tower now, from the tower alone (as it is at `now`, the server's clock): it fell (till its new
 * plank is there), its last block took it up a gear (each STACK_GEAR_EVERY layers, while it gets faster), or made it sway
 */
export function stackLine(tower: Tower, now: number): string | null {
  const t = T.squad.stack;
  if (tower.fell) return now < tower.fell.at + STACK_REBUILD_MS ? fmt(t.fell, { n: tower.fell.height }) : null;
  const last = topOf(tower);
  if (!last) return null;
  if (stackSwingMs(tower.n) < stackSwingMs(tower.n - 1) && now - last.top.at < GEAR_MS) return t.gearUp;
  return now - last.top.at < WOBBLE_MS && Math.abs(last.top.x - last.under) > STACK_WOBBLE_PX ? t.wobble : null;
}

/** 「{name} 也放了一块」: a teammate's block on the tower a moment ago (yours, and one gone since, not said) */
export function mateLine(room: SquadRoom, tower: Tower, now: number): { text: string; at: number } | null {
  const b = [...tower.top].reverse().find((x) => x.h !== room.you && now - x.at < MATE_MS);
  const m = b && room.members.find((x) => x.h === b.h);
  return b && m ? { text: fmt(T.squad.stack.mate, { name: m.name }), at: b.at } : null;
}

/** The gear's tag: its number, the last one's said to be the fastest */
export const gearTag = (n: number) => {
  const k = stackGear(n);
  return fmt(k >= STACK_GEARS ? T.squad.stack.gearTop : T.squad.stack.gear, { n: k });
};

/**
 * 基建周榜's way in, two lines: the tower in your room counting in last week's; you named this week (your highest; the
 * tower now higher, when you put a block on it: 新纪录); or not yet
 */
export function boardWay(board: StackBoard | null, tower: Tower, mine: { round: number } | null): [string, string] {
  const t = T.squad.stack;
  if (board?.old) return [t.boardOld, t.boardOldSub];
  const m = board?.mine;
  if (m && m.rank !== null && m.names.some((x) => x.you)) {
    const n = stackHeight(tower);
    const record = mine?.round === tower.round && n > m.peak;
    return [record ? fmt(t.boardBestNew, { n }) : fmt(t.boardBest, { n: m.peak }), fmt(t.boardRank, { r: m.rank })];
  }
  return [t.boardOff, t.boardOffSub];
}

/**
 * The strip on the tower's top back to the mode you are in (playing it, ready for it, or in its next round): what it
 * is doing, your lane in a race; none while you are not in one
 */
export function modeStrip(room: SquadRoom, now: number): string | null {
  const t = T.squad.stack;
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  if (!mode) return null;
  const name = T.squad.modes.names[mode.kind];
  const mine = mode.in.some((m) => m.h === room.you);
  if (mode.wait) return mine ? fmt(t.backWait, { mode: name, n: mode.in.length }) : null;
  if (!mine && !("next" in mode && mode.next.includes(room.you))) return null;
  const lane = mode.kind === "race" ? mode.lanes.findIndex((l) => l.h === room.you) : -1;
  return fmt(t.backModes[mode.kind], { mode: name }) + (lane >= 0 ? fmt(t.backLane, { k: lane + 1 }) : "");
}

/** On a mode's card: 基建加盖's folded behind it, a strip back to it (its height now) */
export function StackBehind() {
  const behind = useSquadStackBehind();
  const room = useSquadRoom();
  if (!behind || !room) return null;
  const tower = stackNow(room.stack, squadServerNow());
  return (
    <button type="button" className="sq-back stack" onClick={openSquadStack}>
      <span>{fmt(T.squad.stack.backStack, { n: tower.fell ? 0 : tower.n })}</span>
      <b>{T.squad.stack.back}</b>
    </button>
  );
}

/** The card as it shows, for the room and its tower as they are now (on the server's clock) */
export function StackView({
  room,
  tower,
  now,
  slow,
  msg,
  board,
  mine,
  swingRef,
  onClose,
  onDrop,
  onBoard,
  onMode,
}: {
  room: SquadRoom;
  /** The tower at `now` (a fallen one rebuilt in time: stackNow) */
  tower: Tower;
  now: number;
  /** Tapped again too soon after your last (it was not sent) */
  slow: boolean;
  msg: string | null;
  /** This week's 基建周榜, as last read (null: not yet) */
  board: StackBoard | null;
  /** The round you last put a block on */
  mine: { round: number } | null;
  swingRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDrop: () => void;
  onBoard: () => void;
  onMode: () => void;
}) {
  const t = T.squad.stack;
  const fell = Boolean(tower.fell);
  const n = tower.n;
  const height = fell ? 0 : n;
  const shift = towerShift(fell ? 0 : n);
  const below = fell ? 0 : towerBelow(n);
  // the blocks while they stand, and while they tumble as it falls (as it stood before the one that made it fall)
  const tumbling = tower.fell && now - tower.fell.at < FALL_MS ? tower.fell : null;
  const shown = fell ? (tumbling ? tower.top : []) : tower.top;
  const drawShift = tumbling ? towerShift(n - 1) : shift;
  const last = fell ? null : topOf(tower);
  const sway = last && now - last.top.at < SWAY_MS && Math.abs(last.top.x - last.under) > STACK_WOBBLE_PX ? last.top.at : null;
  const line = fell ? stackLine(tower, now) : slow ? t.slow : stackLine(tower, now);
  const mate = fell ? null : mateLine(room, tower, now);
  const you = room.members.find((m) => m.you);
  const strip = modeStrip(room, now);
  const [head, sub] = boardWay(board, tower, mine);
  const px = (v: number) => `${Math.round(v)}px`;
  return (
    <div className="sq-stack" role="dialog" aria-label={t.title}>
      <header>
        <b>{fmt(t.count, { n: tower.round })}</b>
        <span className="ppl">{fmt(t.people, { n: tower.busy.length })}</span>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      {strip && (
        <button type="button" className="sq-back" onClick={onMode}>
          <span>{strip}</span>
          <b>{t.back}</b>
        </button>
      )}
      <div className="stage">
        <i className="ground" style={{ height: px(Math.max(0, GROUND_Y - shift)) }} />
        <div className="hgt">
          <b>
            {height}
            <small>{` ${t.unit}`}</small>
          </b>
          <span>{fmt(t.best, { n: tower.best })}</span>
        </div>
        <div className="gear">
          <em>{gearTag(fell ? 0 : n)}</em>
          <small>{t.gearNote}</small>
        </div>
        <i className="base" style={{ bottom: px(BASE_Y - drawShift) }} />
        <div key={sway === null ? "t" : `s${sway}`} className={`tw${sway === null ? "" : " sway"}`}>
          {shown.map((b, i) => {
            const layer = n - shown.length + i;
            return (
              <span
                key={`${tower.round}-${layer}`}
                className={`blk${tumbling ? (i % 2 ? " fr" : " fl") : now - b.at < DROP_MS ? " drop" : ""}`}
                style={{ left: `calc(50% + ${px(b.x - 32)})`, bottom: px(FIRST_Y + layer * STACK_BLOCK_H - drawShift) }}
              >
                <SquadRoach m={{ ...blockOf(room, b.h), pose: 0 }} size={44} />
              </span>
            );
          })}
        </div>
        {you && (
          <div className={`swing${fell ? " dim" : ""}`} style={{ bottom: px(FIRST_Y + (fell ? 0 : n) * STACK_BLOCK_H - shift + 6) }}>
            <div className="sw" ref={swingRef} style={{ transform: `translateX(${px(fell ? 0 : stackSwing(tower.swingAt, n, now))})` }}>
              <SquadRoach m={{ ...you, pose: 0 }} size={44} />
              <i />
            </div>
          </div>
        )}
        {below > 0 && <span className="below">{fmt(t.below, { n: below })}</span>}
        {mate && (
          <span key={`m${mate.at}`} className="mate" role="status">
            {mate.text}
          </span>
        )}
        {line && (
          <span key={line} className="smsg" role="status">
            {line}
          </span>
        )}
      </div>
      <div className="foot">
        <button type="button" className="way" onClick={onBoard}>
          <b>{head}</b>
          <span>{sub}</span>
        </button>
        <button
          type="button"
          className="put"
          disabled={fell}
          aria-label={fell ? undefined : t.dropLabel}
          onPointerDown={(e) => e.button === 0 && !fell && onDrop()}
          onClick={(e) => e.detail === 0 && !fell && onDrop()}
        >
          {fell ? t.rebuilding : t.drop}
        </button>
      </div>
      {msg && (
        <p className="rmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{t.note}</p>
    </div>
  );
}

export default function SquadStack() {
  const open = useSquadStackOpen();
  const behind = useSquadStackBehind();
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const mine = useSquadStackMine();
  const [now, setNow] = useState(() => squadServerNow());
  const [msg, setMsg] = useState<string | null>(null);
  const [slowAt, setSlowAt] = useState(0);
  const [view, setView] = useState<"stack" | "board">("stack");
  const [board, setBoard] = useState<StackBoard | null>(null);
  const lastRef = useRef(0);
  const swingRef = useRef<HTMLDivElement>(null);
  // folded behind a mode's card that went with its mode: there again
  const modeShows = openAt !== null && room?.mode?.at === openAt && room.mode.endsAt > now;
  const shown = Boolean(room) && (open || (behind && !modeShows));
  const tower = room ? stackNow(room.stack, now) : null;
  const swingAt = tower?.swingAt ?? 0;
  const n = tower?.n ?? 0;
  const standing = Boolean(tower && !tower.fell);
  const roomId = room?.id;

  useEffect(() => {
    if (!shown) return;
    setView("stack");
    setNow(squadServerNow());
    const timer = window.setInterval(() => setNow(squadServerNow()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [shown]);

  // the swing, every frame, by the server's clock (as 放 is put)
  useEffect(() => {
    if (!shown || !standing) return;
    let raf = 0;
    const frame = () => {
      const el = swingRef.current;
      if (el) el.style.transform = `translateX(${Math.round(stackSwing(swingAt, n, squadServerNow()))}px)`;
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [shown, standing, swingAt, n]);

  // where you are on 基建周榜, as the card opens and each half minute while it is open
  useEffect(() => {
    if (!shown || !roomId || view !== "stack") return;
    let live = true;
    const read = () => {
      loadStackBoard("this")
        .then((b) => live && setBoard(b))
        .catch(() => {});
    };
    read();
    const timer = window.setInterval(read, BOARD_EVERY_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [shown, roomId, view]);

  if (!shown || !room || !tower) return null;
  if (view === "board") return <SquadStackBoard onBack={() => setView("stack")} onClose={closeSquadStack} />;
  return (
    <StackView
      room={room}
      tower={tower}
      now={now}
      slow={Date.now() - slowAt < SLOW_MS}
      msg={msg}
      board={board}
      mine={mine}
      swingRef={swingRef}
      onClose={closeSquadStack}
      onBoard={() => setView("board")}
      onMode={openSquadModeCard}
      onDrop={() => {
        const tap = Date.now();
        // the server takes one a second from each: one sooner is not sent
        if (tap - lastRef.current < STACK_EVERY_MS) {
          setSlowAt(tap);
          return;
        }
        lastRef.current = tap;
        setMsg(null);
        setNow(squadServerNow());
        squadStackDrop().catch((e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
      }}
    />
  );
}
