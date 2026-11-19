"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  PHRASE_ROWS,
  POSES,
  ROUND_EXTRAS_MAX,
  SAY_EVERY_MS,
  strategyOf,
  type PhraseRow,
  type SquadMove,
  type SquadRoom,
  type SquadRound,
  type SquadStrategy,
} from "@/lib/squad";
import { useOperatorArt } from "../OperatorNames";
import { CoreChips, ExtrasChips, extraNames, StrategyFace, strategyWords, StrategyGrid } from "./SquadPicks";
import { SquadRoach } from "./SquadRoach";
import { markSquadRound, moveInSquad, recentLines, sayInSquad, seeSquadRound, setSquadPose, useSquadRoundUnseen } from "./squading";
import { squadSoundReady } from "./squadSound";
import "./squadFight.css";

/**
 * 说话 / 动作 / 这局, opened from one's own roach (the bar of a round, 说点什么 in the room's sheet). 说话: the set lines
 * by row (组队 first while it waits, 局内 while it plays; 听歌 only while you are in 卫戍的一起听), two to a row, with
 * 常用, the three this device said last, above; one sent, the panel closes. 动作: what the roach keeps doing (站着,
 * 蹦迪, 醉倒睡觉), and moves done at once (挥手; 击掌 and 贴贴 with a teammate, picked next). 这局, while a round plays:
 * the strategy, locked as the round started (one whose card says 无偏好 fills a free one once: 补位, asked first, those
 * teammates play grey), the core alliance and the 附加盟约 of this round alone, shown at once and sent as the taps
 * stop; the panel stays open for them. One who marked no strategy for a round that started meets 这局 first, with a
 * dot, once. The lines said to one alone (对 TA 说) are on a teammate's card, not here.
 */

type Tab = "say" | "act" | "round";

export default function SquadTalk({
  room,
  start,
  onClose,
  onError,
}: {
  room: SquadRoom;
  /** Opened on 这局 (one's own strategy tapped while a round plays) */
  start?: "round";
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const playing = room.state === "go";
  const unseen = useSquadRoundUnseen();
  const [tab, setTab] = useState<Tab>(playing && (unseen || start === "round") ? "round" : "say");
  const me = room.members.find((m) => m.you)!;
  useEffect(() => {
    // opening the panel is a press: sounds may play from now on
    squadSoundReady();
  }, []);
  useEffect(() => {
    if (tab === "round") seeSquadRound();
  }, [tab]);
  // the round over while open: 这局 goes
  useEffect(() => {
    if (!playing && tab === "round") setTab("say");
  }, [playing, tab]);
  const tabs: Tab[] = playing ? ["say", "act", "round"] : ["say", "act"];
  return (
    <div className="sq-talk-bg" onClick={onClose}>
      <div className="sq-talk" role="dialog" aria-modal="true" aria-label={T.squad.talk.title} onClick={(e) => e.stopPropagation()}>
        <div className="ph">
          <SquadRoach m={me} size={36} />
          <b>{T.squad.talk.title}</b>
          <button type="button" className="x" aria-label={T.squad.talk.close} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sq-tabs3" role="tablist">
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {T.squad.talk.tabs[k]}
              {k === "round" && unseen && <span className="dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        {tab === "say" ? (
          <SayTab room={room} onDone={onClose} />
        ) : tab === "act" ? (
          <ActTab room={room} onDone={onClose} onError={onError} />
        ) : (
          <RoundTab room={room} onError={onError} />
        )}
      </div>
    </div>
  );
}

/**
 * The set lines, a row at a time (the row of the room's state first, again as it changes), 常用 above, read as it
 * opens; a moment's rest after each. docked: in the bar of a round on a computer, where it stays open after a line,
 * saying so while the lines rest
 */
export function SayTab({ room, onDone, docked = false }: { room: SquadRoom; onDone: () => void; docked?: boolean }) {
  // 听歌's row, while you are in 卫戍的一起听
  const music = room.listen?.you === "in";
  // 对 TA 说 is said from a teammate's card
  const rows = PHRASE_ROWS.filter(([r]) => r !== "to" && (r !== "music" || music));
  const first: PhraseRow = room.state === "go" ? "fight" : "team";
  const [row, setRow] = useState<PhraseRow>(first);
  useEffect(() => setRow(first), [first]);
  const [cool, setCool] = useState(false);
  const [said, setSaid] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recent] = useState(recentLines);
  const say = async (p: number) => {
    if (cool) return;
    setCool(true);
    setNote(null);
    window.setTimeout(() => {
      setCool(false);
      setSaid(false);
    }, SAY_EVERY_MS);
    try {
      const res = await sayInSquad(p);
      if (res.sent) return docked ? setSaid(true) : onDone();
      setNote(res.full ? T.squad.say.enough : T.squad.say.slow);
    } catch (e) {
      setNote(e instanceof Error ? e.message : T.requests.serverTrouble);
    }
  };
  const ids = (rows.find(([r]) => r === row) ?? rows[0])[1];
  const line = (p: number) => (
    <button key={p} type="button" disabled={cool} onClick={() => void say(p)}>
      {T.squad.say.lines[p - 1]}
    </button>
  );
  return (
    <>
      {docked && said && <p className="note cool">{T.squad.talk.sentCool}</p>}
      <div className="sq-rows" role="tablist">
        {rows.map(([r]) => (
          <button key={r} type="button" role="tab" aria-selected={r === row} className={r === row ? "on" : ""} onClick={() => setRow(r)}>
            {T.squad.say.rows[r]}
          </button>
        ))}
      </div>
      <div className="sq-say2">
        {recent.length > 0 && (
          <>
            <span className="lab">{T.squad.talk.recent}</span>
            {recent.map(line)}
            <span className="lab">{T.squad.say.rows[row]}</span>
          </>
        )}
        {ids.map(line)}
      </div>
      {note && <p className="note">{note}</p>}
    </>
  );
}

/**
 * What the roach keeps doing, and moves done at once; 击掌 and 贴贴 ask which teammate next. docked: in the bar of a
 * round on a computer, where it stays open, and the teammate is picked on the bar's own tiles (onPick, picking)
 */
export function ActTab({
  room,
  onDone,
  onError,
  docked = false,
  picking = null,
  onPick,
}: {
  room: SquadRoom;
  onDone: () => void;
  onError: (e: unknown) => void;
  docked?: boolean;
  /** The move a teammate is being picked for on the bar's tiles (docked) */
  picking?: SquadMove | null;
  onPick?: (move: SquadMove | null) => void;
}) {
  const me = room.members.find((m) => m.you)!;
  const mates = room.members.filter((m) => !m.you);
  const [busy, setBusy] = useState(false);
  const [toWhom, setToWhom] = useState<SquadMove | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (!docked) onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const move = (m: SquadMove, to?: number) =>
    void run(async () => {
      const res = await moveInSquad(m, to);
      if (!res.sent) throw new Error(res.full ? T.squad.say.enough : T.squad.say.slow);
    });
  if (toWhom) {
    return (
      <div className="sq-acts">
        <span className="lab">{fmt(T.squad.talk.pickMate, { move: T.squad.talk.moves[toWhom] })}</span>
        <div className="mates">
          {mates.map((m) => (
            <button key={m.h} type="button" className="chip" disabled={busy} onClick={() => move(toWhom, m.h)}>
              {m.name}
            </button>
          ))}
        </div>
        <button type="button" className="ghost small" onClick={() => setToWhom(null)}>
          {T.squad.talk.cancel}
        </button>
      </div>
    );
  }
  return (
    <div className="sq-acts">
      <span className="lab">{T.squad.talk.keep}</span>
      <div className="three">
        {POSES.map((p) => (
          <button key={p} type="button" className={me.pose === p ? "on" : ""} aria-pressed={me.pose === p} disabled={busy} onClick={() => void run(() => setSquadPose(p))}>
            {T.squad.talk.poses[p]}
          </button>
        ))}
      </div>
      <span className="lab">{T.squad.talk.once}</span>
      {docked && picking ? (
        <div className="pick" role="status">
          <b>{fmt(T.squad.talk.pickTile, { move: T.squad.talk.moves[picking] })}</b>
          <button type="button" onClick={() => onPick?.(null)}>
            {T.squad.talk.cancel}
          </button>
        </div>
      ) : (
        <div className="three">
          {(["wave", "five", "hug"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => (m === "wave" ? move(m) : !mates.length ? setNote(T.squad.talk.noMate) : docked ? onPick?.(m) : setToWhom(m))}
            >
              {T.squad.talk.moves[m]}
            </button>
          ))}
        </div>
      )}
      {note && <p className="note">{note}</p>}
    </div>
  );
}

/** 补位, asked first: the strategy tapped, filled (and locked) at 补位, or another picked at 再想想 */
export function FillAsk({ s, onYes, onNo }: { s: SquadStrategy; onYes: () => void; onNo: () => void }) {
  const ask = fmt(T.squad.talk.fillAsk, { s: s.op });
  return (
    <div className="sq-fillask" role="alertdialog" aria-label={ask}>
      <b>{ask}</b>
      <span className="acts">
        <button type="button" className="dark" onClick={onYes}>
          {T.squad.talk.fillYes}
        </button>
        <button type="button" className="ghost" onClick={onNo}>
          {T.squad.talk.fillNo}
        </button>
      </span>
    </div>
  );
}

/**
 * 这局: the strategy, core alliance and 附加盟约 of this round alone, sent as the taps stop. The strategy is locked as
 * the round started (the server says no the same way); one who has none fills one nobody plays, once (补位), asked first.
 */
export function RoundTab({ room, onError }: { room: SquadRoom; onError: (e: unknown) => void }) {
  const art = useOperatorArt();
  const me = room.members.find((m) => m.you)!;
  const [note, setNote] = useState<string | null>(null);
  // the strategy tapped to fill, asked first
  const [filling, setFilling] = useState<SquadStrategy | null>(null);
  const round: SquadRound = { core: me.core, strategy: me.strategy, extras: me.extras };
  const holders = room.members.filter((m) => !m.you && m.strategy !== null);
  const taken = new Set(holders.map((m) => m.strategy!));
  const mark = (change: Partial<SquadRound>) => {
    setNote(null);
    markSquadRound({ ...round, ...change }, onError);
  };
  const chosen = me.strategy === null ? null : strategyOf(me.strategy);
  return (
    <div className="sq-round">
      {chosen ? <p className="now">{fmt(T.squad.talk.roundNow, { s: strategyWords(chosen) })}</p> : <p className="hey">{T.squad.talk.roundNone}</p>}
      <span className="lab">
        {T.squad.talk.strategy}
        <i className={chosen ? "lk" : "ok"}>{chosen ? T.squad.talk.lockedTag : T.squad.talk.fillTag}</i>
      </span>
      {chosen ? (
        <div className="sq-lockrow">
          <StrategyFace id={chosen.id} art={art} size={38} />
          <span>
            <b>{strategyWords(chosen)}</b>
            <small>{T.squad.talk.locked}</small>
          </span>
          <span className="lk" aria-hidden="true">
            🔒
          </span>
        </div>
      ) : filling ? (
        <FillAsk
          s={filling}
          onYes={() => {
            setFilling(null);
            mark({ strategy: filling.id });
          }}
          onNo={() => setFilling(null)}
        />
      ) : (
        <>
          <p className="fillnote">{T.squad.talk.fillHint}</p>
          <StrategyGrid
            value={null}
            core={me.core}
            art={art}
            taken={taken}
            onTaken={(s) => setNote(fmt(T.squad.room.takenBy, { s: s.op, name: holders.find((m) => m.strategy === s.id)?.name ?? "" }))}
            onPick={(id) => {
              const s = id === null ? null : strategyOf(id);
              setNote(null);
              if (s) setFilling(s);
            }}
          />
        </>
      )}
      {note && <p className="hey">{note}</p>}
      <span className="lab">
        {T.squad.talk.core}
        <i className="ok">{T.squad.talk.coreFree}</i>
      </span>
      <CoreChips value={me.core} onPick={(core) => mark({ core })} />
      <span className="lab">
        {T.squad.talk.extras}
        <small>
          {fmt(T.squad.talk.extrasN, { n: me.extras.length })}
          {T.squad.dot}
          {fmt(T.squad.talk.extrasMax, { max: ROUND_EXTRAS_MAX })}
        </small>
        <i className="ok">{T.squad.talk.extrasFree}</i>
      </span>
      <ExtrasChips value={me.extras} onToggle={(id) => mark({ extras: me.extras.includes(id) ? me.extras.filter((x) => x !== id) : [...me.extras, id] })} />
      {me.extras.length > 0 && <p className="note">{extraNames(me.extras).join(T.common.listSep)}</p>}
      <p className="foot">{T.squad.talk.foot}</p>
    </div>
  );
}
