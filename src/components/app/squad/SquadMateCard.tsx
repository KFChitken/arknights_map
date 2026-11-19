"use client";

import { useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { sameStrategy, strategyOf, TO, type SquadBotDo, type SquadMember } from "@/lib/squad";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";
import { touchesNow, useTick } from "../dayTurns";
import type { Art } from "../OperatorNames";
import { RoachPassOn } from "../passes/RoachPass";
import { TouchButtons } from "../RoachCards";
import { CoreBadge, extraNames, StrategyFace, strategyWords } from "./SquadPicks";
import { lineWords } from "./squading";
import "./squadMate.css";

/** What a tap on the card's foot asks first */
type Asking = "kick" | "block" | "report";

/**
 * What may be said to TA alone (对 TA 说), by the line's number, as things stand: asked to change a strategy that
 * clashes with yours, else to give up TA's, else to pick one; to get ready (TA not the host, not ready); thanks.
 */
export function linesTo(m: Pick<SquadMember, "strategy" | "host" | "inGame">, me: Pick<SquadMember, "strategy"> | undefined) {
  const first = sameStrategy(m.strategy, me?.strategy ?? null) ? TO.change : m.strategy !== null ? TO.giveUp : TO.pick;
  return [first, ...(!m.host && !m.inGame ? [TO.ready] : []), TO.thanks];
}

/**
 * The card of someone else in the room (a tap on TA's tile, in the room's sheet or on the bar of a round), made as the
 * map's card of another's roach (RoachCards.tsx): TA's roach, name and 房主 / 触须之交 / 人机; under it 准备 while
 * the room waits, with TA's strategy and the lines that may be said to TA alone (对 TA 说, onSay), TA's round while
 * it plays (strategy, core alliance, 附加盟约); the two touches as on the map, with
 * today's touches left; and at its foot 请出去 (the host's), 拉黑 and 举报, each asked first. The pass TA wears hangs on
 * it as on the map's (passes/RoachPass.tsx), folded or not as there. A 人机's: touches played on this page alone, no
 * foot, and to the 站长 or an admin hosting the room, a row of what it does. Goes at its × or a tap on the tile again.
 */
export default function SquadMateCard({
  m,
  host,
  staff,
  playing,
  art,
  touches,
  touched,
  busy,
  className,
  style,
  me,
  onSay,
  onMove,
  onTouch,
  onKick,
  onSafety,
  onBot,
  onClose,
}: {
  m: SquadMember;
  /** The viewer is the room's host (请出去), and the 站长 or an admin besides (a 人机's row) */
  host: boolean;
  staff: boolean;
  playing: boolean;
  art: Art | null;
  /** Today's touches left and when the day turns (Me.touchesLeft, Me.dayTurnsAt) */
  touches?: { left: number; at: number };
  /** This page touched TA already */
  touched?: "sneaky" | "bold";
  busy: boolean;
  /** Where it stands: in the room's sheet, or over the bar of a round */
  className: string;
  style?: CSSProperties;
  /** The viewer as the room has them (whose strategy TA's may clash with) */
  me?: SquadMember;
  /** While the room waits: a line said to TA alone, by its number */
  onSay?: (p: number) => void;
  /** On a computer, the bar of a round's: 击掌 or 贴贴 to TA, from the card */
  onMove?: (move: "five" | "hug") => void;
  onTouch: (bold: boolean) => Promise<void> | void;
  onKick: () => void;
  /** 拉黑 and 举报: the map page's sheet for them (sq:<room>:<number>) */
  onSafety: () => void;
  onBot: (what: Exclude<SquadBotDo, "add">) => void;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [touching, setTouching] = useState(false);
  const quota = touches && !m.bot ? touchesNow(touches) : null;
  // with none left, it draws again now and then, so the buttons come back as the day turns
  useTick(quota?.left === 0 ? 30_000 : null);
  const touch = async (bold: boolean) => {
    setTouching(true);
    try {
      await onTouch(bold);
    } finally {
      setTouching(false);
    }
  };
  const s = m.strategy === null ? null : strategyOf(m.strategy);
  const extras = extraNames(m.extras);
  const tag = m.bot ? T.squad.bot.tag : m.host ? T.squad.room.host : m.friend ? T.squad.room.friend : null;
  const status = m.host ? T.squad.mate.hostNone : m.inGame ? T.squad.room.inGameTag : T.squad.mate.notReady;
  const ask =
    asking === "kick"
      ? { title: fmt(T.squad.room.kickAsk, { name: m.name }), sub: T.squad.room.kickSub, yes: T.squad.room.kick, go: onKick }
      : asking === "block"
        ? { title: fmt(T.squad.mate.blockAsk, { name: m.name }), sub: T.squad.room.blockSub, yes: T.squad.room.block, go: onSafety }
        : asking === "report"
          ? { title: fmt(T.squad.mate.reportAsk, { name: m.name }), sub: T.squad.room.reportSub, yes: T.squad.mate.reportYes, go: onSafety }
          : null;
  return (
    <div className={`card stack sq-mate ${className}${m.pass ? " with-pass" : ""}`} style={style} role="dialog" aria-label={fmt(T.squad.mate.label, { name: m.name })}>
      <div className="card-head">
        <RoachIcon color={m.color as RoachColor} avatar={m.avatar as RoachAvatar} size={44} />
        <div>
          <strong>
            {m.name}
            {tag && <span className={`sq-mtag${m.bot ? " bot" : m.friend ? " fr" : ""}`}>{tag}</span>}
          </strong>
          <p className="muted">{playing ? T.squad.mate.round : status}</p>
        </div>
      </div>
      {playing && (
        <div className="sq-mround">
          <div className="r">
            <i>{T.squad.fight.peekStrategy}</i>
            {s && <StrategyFace id={m.strategy} art={art} size={26} />}
            <span>{s ? strategyWords(s) : T.squad.fight.peekNone}</span>
          </div>
          <div className="r">
            <i>{T.squad.fight.peekCore}</i>
            <CoreBadge core={m.core} />
          </div>
          <div className="r">
            <i>{T.squad.fight.peekExtras}</i>
            {extras.length ? (
              extras.map((x) => (
                <span key={x} className="sq-core none">
                  {x}
                </span>
              ))
            ) : (
              <span>{T.squad.fight.peekExtrasNone}</span>
            )}
          </div>
        </div>
      )}
      {onMove && (
        <div className="sq-mmove">
          <button type="button" className="dark" disabled={busy} onClick={() => onMove("five")}>
            {T.squad.talk.moves.five}
          </button>
          <button type="button" className="dark" disabled={busy} onClick={() => onMove("hug")}>
            {T.squad.talk.moves.hug}
          </button>
        </div>
      )}
      {!playing && onSay && (
        <>
          <div className="sq-mround">
            <div className="r">
              <i>{T.squad.fight.peekStrategy}</i>
              {s && <StrategyFace id={m.strategy} art={art} size={26} />}
              <span>{s ? strategyWords(s) : T.squad.card.strategyNone}</span>
            </div>
          </div>
          <div className="sq-sayto" role="group" aria-label={T.squad.mate.sayTo}>
            <small>{T.squad.mate.sayTo}</small>
            <span className="chips">
              {linesTo(m, me).map((p) => (
                <button key={p} type="button" disabled={busy} onClick={() => onSay(p)}>
                  {lineWords(p, m.strategy)}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
      {m.pass && <RoachPassOn pass={m.pass} />}
      {m.bot ? (
        <div className="touch-buttons">
          <button onClick={() => void touch(false)}>
            {T.common.reachSneaky}
            <small>{T.squad.bot.touchNote}</small>
          </button>
          <button className="bold" onClick={() => void touch(true)}>
            {T.common.reachBold}
            <small>{T.squad.bot.touchNote}</small>
          </button>
        </div>
      ) : (
        <TouchButtons quota={quota} touched={touched} busy={touching} sharesUid={false} onTouch={(bold) => void touch(bold)} />
      )}
      {m.bot && host && staff && (
        <div className="sq-botrow" role="group" aria-label={T.squad.bot.row}>
          <small>{T.squad.bot.row}</small>
          <span>
            <button aria-pressed={m.inGame} disabled={busy} onClick={() => onBot("ready")}>
              {m.inGame ? T.squad.bot.readyOn : T.squad.bot.ready}
            </button>
            <button disabled={busy} onClick={() => onBot("strategy")}>
              {T.squad.bot.strategy}
            </button>
            <button disabled={busy} onClick={() => onBot("say")}>
              {T.squad.bot.say}
            </button>
            <button disabled={busy} onClick={() => onBot("pose")}>
              {T.squad.bot.pose}
            </button>
            <button className="out" disabled={busy} onClick={() => onBot("kick")}>
              {T.squad.bot.kick}
            </button>
          </span>
        </div>
      )}
      {!m.bot &&
        (ask ? (
          <div className="sq-mask" role="alertdialog" aria-label={ask.title}>
            <b>{ask.title}</b>
            <span>{ask.sub}</span>
            <span className="row">
              <button className="dark" disabled={busy} onClick={() => (setAsking(null), ask.go())}>
                {ask.yes}
              </button>
              <button className="ghost" onClick={() => setAsking(null)}>
                {T.squad.mate.cancel}
              </button>
            </span>
          </div>
        ) : (
          <div className="sq-mfoot">
            {host && !playing && (
              <button className="link out" onClick={() => setAsking("kick")}>
                {T.squad.room.kick}
              </button>
            )}
            <button className="link" onClick={() => setAsking("block")}>
              {T.squad.room.block}
            </button>
            <button className="link" onClick={() => setAsking("report")}>
              {T.squad.room.report}
            </button>
          </div>
        ))}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}
