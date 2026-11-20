"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  STACK_BLOCK_H,
  STACK_EVERY_MS,
  STACK_HAND_MAX,
  STACK_IDLE_MS,
  STACK_SHOWN,
  STACK_WOBBLE_PX,
  stackHand,
  stackHeight,
  stackSwing,
  type StackMode,
} from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { SquadRoach } from "./SquadRoach";
import { closeSquadModeCard, squadModeIn, squadServerNow, squadStackAgain, squadStackDrop, useSquadModeCard, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 基建加盖 (玩点什么, src/lib/squadMode.ts), its card at the map's foot as the other modes'. A tower of roaches on a
 * plank, each block the roach of the one who put it; your own swings over its top (the server's clock, the same for
 * everyone: stackSwing), and 放 lets it fall there. A block well off makes the tower sway; one too far off, and it
 * falls (the blocks tumbling), the round over: 再来一轮 begins the next. Over the tower its height and the room's
 * highest, and till it ends with no block put; under it your hand (three at most, one more growing each half minute)
 * and 放. One watching may join at any time. The card follows the canvas 「基建加盖」.
 */

/** On the stage (px from its foot): the plank's foot, the first block's, the ground's top */
const BASE_Y = 112;
const FIRST_Y = 122;
const GROUND_Y = 123;
/** A line over the tower shows this long: it fell, it sways, too soon after your last */
const FELL_MS = 2_600;
const WOBBLE_MS = 1_200;
const SLOW_MS = 900;
/** The blocks tumble this long as the tower falls; a block drops onto it this long; it sways this long */
const FALL_MS = 1_000;
const DROP_MS = 250;
const SWAY_MS = 1_500;
/** The page's clock is looked at this often while the card is open (the swing itself goes every frame) */
const TICK_MS = 250;

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

/** How far down the tower goes on the stage as it grows past STACK_SHOWN blocks (px) */
export const stackShift = (blocks: number) => Math.max(0, blocks - STACK_SHOWN) * STACK_BLOCK_H;

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The line over the tower now, from the tower alone (the server's clock): it fell, or its last block made it sway */
export function stackLine(mode: StackMode, now: number): string | null {
  const t = T.squad.stack;
  if (mode.fell) return now - mode.fell.at < FELL_MS ? fmt(t.fell, { n: mode.fell.height }) : null;
  const top = mode.blocks[mode.blocks.length - 1];
  const under = mode.blocks.length > 1 ? mode.blocks[mode.blocks.length - 2].x : 0;
  return top && now - top.at < WOBBLE_MS && Math.abs(top.x - under) > STACK_WOBBLE_PX ? t.wobble : null;
}

/** The card as it shows, for the room and its tower as they are now (on the server's clock) */
export function StackView({
  room,
  mode,
  now,
  busy,
  slow,
  msg,
  swingRef,
  onClose,
  onDrop,
  onAgain,
  onJoin,
  onLeave,
}: {
  room: SquadRoom;
  mode: StackMode;
  now: number;
  busy: boolean;
  /** Tapped again too soon after your last (it was not sent) */
  slow: boolean;
  msg: string | null;
  swingRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onDrop: () => void;
  onAgain: () => void;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const t = T.squad.stack;
  const me = mode.in.some((m) => m.h === room.you);
  const hand = stackHand(mode.hand, now);
  const fell = Boolean(mode.fell);
  const height = fell ? 0 : stackHeight(mode);
  const n = mode.blocks.length;
  const shift = stackShift(fell ? 0 : n);
  // the blocks while they stand, and while they tumble as it falls
  const tumbling = mode.fell && now - mode.fell.at < FALL_MS ? mode.fell : null;
  const shown = fell ? (tumbling ? mode.blocks : []) : mode.blocks;
  // as it stood before the one that made it fall
  const tumbleShift = stackShift(n - 1);
  const top = mode.blocks[n - 1];
  const under = n > 1 ? mode.blocks[n - 2].x : 0;
  const sway = !fell && top && now - top.at < SWAY_MS && Math.abs(top.x - under) > STACK_WOBBLE_PX ? top.at : null;
  const line = slow ? t.slow : stackLine(mode, now);
  const can = me && !fell && hand.n > 0;
  const swingX = stackSwing(mode.roundAt, now);
  const you = room.members.find((m) => m.you);
  const px = (v: number) => `${Math.round(v)}px`;
  return (
    <div className="sq-stack" role="dialog" aria-label={t.title}>
      <header>
        <b>{fmt(t.count, { n: mode.round })}</b>
        <span className="ppl">{fmt(t.people, { n: mode.in.length })}</span>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <div className="stage">
        <i className="ground" style={{ height: px(Math.max(0, GROUND_Y - shift)) }} />
        <div className="hgt">
          <b>
            {height}
            <small>{` ${t.unit}`}</small>
          </b>
          <span>{fmt(t.best, { n: mode.best })}</span>
        </div>
        <span className="idle">{fmt(fell ? t.idleFell : t.idle, { left: mmss(Math.min(STACK_IDLE_MS, mode.endsAt - now)) })}</span>
        <i className="base" style={{ bottom: px(BASE_Y - (tumbling ? tumbleShift : shift)) }} />
        <div key={sway === null ? "t" : `s${sway}`} className={`tw${sway === null ? "" : " sway"}`}>
          {shown.map((b, i) => (
            <span
              key={`${mode.round}-${i}`}
              className={`blk${tumbling ? (i % 2 ? " fr" : " fl") : now - b.at < DROP_MS ? " drop" : ""}`}
              style={{ left: `calc(50% + ${px(b.x - 32)})`, bottom: px(FIRST_Y + i * STACK_BLOCK_H - (tumbling ? tumbleShift : shift)) }}
            >
              <SquadRoach m={{ ...blockOf(room, b.h), pose: 0 }} size={44} />
            </span>
          ))}
        </div>
        {me && you && (
          <div className={`swing${can ? "" : " dim"}`} style={{ bottom: px(FIRST_Y + (fell ? 0 : n) * STACK_BLOCK_H - shift + 6) }}>
            <div className="sw" ref={swingRef} style={{ transform: `translateX(${px(swingX)})` }}>
              <SquadRoach m={{ ...you, pose: 0 }} size={44} />
              <i />
            </div>
          </div>
        )}
        {line && (
          <span key={line} className="smsg" role="status">
            {line}
          </span>
        )}
      </div>
      {me ? (
        <div className="hand">
          <div className="hl">
            <div className="pips" aria-label={fmt(t.handLabel, { n: hand.n, max: STACK_HAND_MAX })}>
              <b>{t.hand}</b>
              {Array.from({ length: STACK_HAND_MAX }, (_, k) => (
                <i key={k} className={k < hand.n ? "on" : ""} />
              ))}
              <span>{fmt(t.handCount, { n: hand.n, max: STACK_HAND_MAX })}</span>
            </div>
            <span className="regen">{hand.next === null ? t.full : fmt(t.next, { left: mmss(hand.next) })}</span>
          </div>
          {fell ? (
            <button type="button" className="put again" disabled={busy} onClick={onAgain}>
              {t.again}
            </button>
          ) : (
            <button
              type="button"
              className="put"
              disabled={!can}
              aria-label={can ? t.dropLabel : undefined}
              onPointerDown={(e) => e.button === 0 && can && onDrop()}
              onClick={(e) => e.detail === 0 && can && onDrop()}
            >
              {can ? t.drop : t.empty}
            </button>
          )}
        </div>
      ) : (
        <div className="watch">
          <span>{t.watching}</span>
          <button type="button" disabled={busy} onClick={onJoin}>
            {t.join}
          </button>
        </div>
      )}
      {me && (
        <button type="button" className="leave" disabled={busy} onClick={onLeave}>
          {t.leave}
        </button>
      )}
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
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const [now, setNow] = useState(() => squadServerNow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [slowAt, setSlowAt] = useState(0);
  const lastRef = useRef(0);
  const swingRef = useRef<HTMLDivElement>(null);
  const mode = room?.mode?.kind === "stack" && room.mode.at === openAt ? room.mode : null;
  const open = Boolean(mode);
  const roundAt = mode?.roundAt ?? 0;

  useEffect(() => {
    if (!open) return;
    setNow(squadServerNow());
    const timer = window.setInterval(() => setNow(squadServerNow()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  // the swing, every frame, by the server's clock (as 放 is put)
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const frame = () => {
      const el = swingRef.current;
      if (el) el.style.transform = `translateX(${Math.round(stackSwing(roundAt, squadServerNow()))}px)`;
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [open, roundAt]);

  if (!mode || !room) return null;
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await p();
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  const here = Date.now();
  return (
    <StackView
      room={room}
      mode={mode}
      now={now}
      busy={busy}
      slow={here - slowAt < SLOW_MS}
      msg={msg}
      swingRef={swingRef}
      onClose={closeSquadModeCard}
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
      onAgain={() => void run(() => squadStackAgain())}
      onJoin={() => void run(() => squadModeIn(true))}
      onLeave={() => void run(() => squadModeIn(false))}
    />
  );
}
