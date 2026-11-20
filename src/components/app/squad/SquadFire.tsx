"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { fireDropIn, fireNeed, fireNow, WOOD_MAX, woodIn, woodNow, type FireMine } from "@/lib/squadFire";
import { WorldError } from "@/lib/world/types";
import FireScene, { flameColor, flameInner } from "./FireScene";
import SmallFlame from "./SmallFlame";
import SquadFireBoard from "./SquadFireBoard";
import { closeSquadFire, fireTime, loadFireBoard, squadAddWood, useSquadFireOpen, useSquadRoom } from "./squading";
import "./squadFire.css";

/**
 * 篝火 (卫戍碎片时间玩法 ⑤, with no top since 篝火不封顶; src/lib/squadFire.ts), the room's own and always there:
 * 「玩」 → 添柴 opens this card over the map (the whole width at the foot on a phone, in the middle on a computer).
 * The fire in its scene as its level has it (FireScene.tsx), who put the last on and when it goes down a level; the
 * bar towards the next level (each 10 levels a stick more a level); the sticks in your hand (three at most, one more
 * each 30 s, as 理智 grows) and 添一根; the way in to 火焰周榜 (where this room is on it); the last 局's highest and the
 * room's. The server decides; this only draws it.
 */

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** 火焰周榜's way in, under 添一根: where this room is on this week's board */
function BoardWay({ mine, onOpen }: { mine: FireMine | null; onOpen: () => void }) {
  const t = T.squad.fire;
  const [head, sub] = !mine
    ? [t.boardOff, t.boardOffSub]
    : mine.say === "old"
      ? [t.boardOld, t.boardOldSub]
      : mine.rank !== null
        ? [fmt(t.boardRank, { rank: mine.rank }), fmt(t.boardRankSub, { peak: mine.peak })]
        : [t.boardOff, t.boardOffSub];
  const color = mine?.color ?? 0;
  return (
    <button type="button" className="board-way" onClick={onOpen}>
      <SmallFlame color={flameColor(color)} inner={flameInner(color)} size={16} />
      <span>
        <b>{head}</b>
        <small>{sub}</small>
      </span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

export default function SquadFire() {
  const open = useSquadFireOpen();
  const room = useSquadRoom();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pop, setPop] = useState<{ key: number; text: string } | null>(null);
  const [view, setView] = useState<"fire" | "board">("fire");
  const [mine, setMine] = useState<FireMine | null>(null);
  useEffect(() => {
    if (!open) return;
    setView("fire");
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [open]);
  // where this room is on 火焰周榜, as the card opens (the server keeps the board half a minute)
  const roomId = room?.id;
  useEffect(() => {
    if (!open || !roomId) return;
    let live = true;
    loadFireBoard("this")
      .then((b) => live && setMine(b.mine))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, roomId]);
  useEffect(() => {
    if (!pop) return;
    const t = window.setTimeout(() => setPop(null), 900);
    return () => window.clearTimeout(t);
  }, [pop]);
  if (!open || !room) return null;
  const f = room.fire;
  const { level, prog } = fireNow(f.level, f.prog, f.at, now);
  const drop = fireDropIn(f.level, f.at, now);
  const me = room.members.find((m) => m.you);
  const wood = woodNow(me?.wood ?? WOOD_MAX, me?.woodAt ?? null, now);
  const next = woodIn(me?.wood ?? WOOD_MAX, me?.woodAt ?? null, now);
  const by = f.by === null ? null : room.members.find((m) => m.h === f.by);
  const can = wood > 0 && !busy;
  const t = T.squad.fire;
  const add = async () => {
    if (!can) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await squadAddWood();
      setPop({ key: Date.now(), text: res.up ? fmt(t.up, { n: res.fire.level }) : t.plus });
      setNow(Date.now());
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  if (view === "board") return <SquadFireBoard onBack={() => setView("fire")} onClose={closeSquadFire} />;
  const need = fireNeed(level + 1);
  const foot =
    level > 0 && by
      ? [by.you ? t.addedYou : fmt(t.added, { name: by.name }), ...(drop === null ? [] : [fmt(t.dropIn, { left: clock(drop) })])].join(T.squad.dot)
      : null;
  const seats = room.members.map((m) => ({ key: m.h, color: m.color, avatar: m.avatar }));
  const tier = Math.ceil((level + 1) / 10);
  return (
    <div className="sq-fire" role="dialog" aria-label={t.title}>
      <div className="box">
        <header>
          <b>{t.title}</b>
          <button type="button" className="x" onClick={closeSquadFire} aria-label={t.close}>
            ×
          </button>
        </header>
        <FireScene level={level} seats={seats} pop={pop} foot={foot} />
        <div className="prog">
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${level === 0 ? 0 : Math.round((prog / need) * 100)}%` } as CSSProperties} />
          </span>
          <b>{level === 0 ? t.outNext : fmt(t.toNext, { n: need - prog, next: level + 1 })}</b>
        </div>
        <p className="tier">{level === 0 ? t.outPerLevel : fmt(t.perLevel, { from: (tier - 1) * 10 + 1, to: tier * 10, need, prog })}</p>
        <div className="hand">
          <span className="sticks">
            <b>{t.hand}</b>
            {Array.from({ length: WOOD_MAX }, (_, i) => (
              <i key={i} className={i < wood ? "on" : undefined} />
            ))}
            <span>{fmt(t.handCount, { n: wood, max: WOOD_MAX })}</span>
            <small>{next === null ? t.full : fmt(t.next, { left: clock(next) })}</small>
          </span>
          <button type="button" className="add" disabled={!can} onClick={() => void add()}>
            {wood <= 0 ? t.noWood : t.add}
          </button>
        </div>
        {msg && (
          <p className="fmsg" role="status">
            {msg}
          </p>
        )}
        <BoardWay mine={mine} onOpen={() => setView("board")} />
        {(f.last !== null || f.bestTop > 0) && (
          <p className="rec">
            {f.last !== null && fmt(t.last, { top: f.lastTop, time: fireTime(f.last) })}
            {f.last !== null && f.bestTop > 0 && T.squad.dot}
            {f.bestTop > 0 && fmt(t.best, { best: f.bestTop })}
          </p>
        )}
        <p className="note">{t.note}</p>
      </div>
    </div>
  );
}
