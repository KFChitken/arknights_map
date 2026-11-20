"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { FIRE_MAX, fireDropIn, fireLevel, WOOD_MAX, woodIn, woodNow } from "@/lib/squadFire";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import { WorldError } from "@/lib/world/types";
import RoachIcon from "../../RoachIcon";
import { closeSquadFire, fireTime, squadAddWood, useSquadFireOpen, useSquadRoom } from "./squading";
import "./squadFire.css";

/**
 * 篝火 (卫戍碎片时间玩法 ⑤; src/lib/squadFire.ts), the room's own and always there: 「玩」 → 添柴 opens this card over
 * the map (the whole width at the foot on a phone, in the middle on a computer). The fire as the canvas draws it, its
 * level in five bars, bigger and brighter as it goes up, out at 0; the room's roaches round it; who put the last stick
 * on, and when it goes down one if nobody does. Under it the sticks in your hand (three at most, one more each 30 s,
 * as 理智 grows) and 添一根; the room's longest 局 and the last one's. The server decides; this only draws it.
 */

/** Where the room's roaches sit round the fire (from the scene's left and bottom, in %), facing it */
const SEATS: { x: number; y: number; s: number; flip: boolean }[] = [
  { x: 7, y: 12, s: 50, flip: false },
  { x: 79, y: 12, s: 50, flip: true },
  { x: 20, y: 4, s: 44, flip: false },
  { x: 68, y: 4, s: 44, flip: true },
];

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function SquadFire() {
  const open = useSquadFireOpen();
  const room = useSquadRoom();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [plus, setPlus] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [open]);
  useEffect(() => {
    if (!plus) return;
    const t = window.setTimeout(() => setPlus(0), 900);
    return () => window.clearTimeout(t);
  }, [plus]);
  if (!open || !room) return null;
  const f = room.fire;
  const level = fireLevel(f.level, f.at, now);
  const drop = fireDropIn(f.level, f.at, now);
  const me = room.members.find((m) => m.you);
  const wood = woodNow(me?.wood ?? WOOD_MAX, me?.woodAt ?? null, now);
  const next = woodIn(me?.wood ?? WOOD_MAX, me?.woodAt ?? null, now);
  const by = f.by === null ? null : room.members.find((m) => m.h === f.by);
  const can = wood > 0 && level < FIRE_MAX && !busy;
  const add = async () => {
    if (!can) return;
    setBusy(true);
    setMsg(null);
    try {
      await squadAddWood();
      setPlus(Date.now());
      setNow(Date.now());
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  const t = T.squad.fire;
  const vars = { "--lv": level, "--glow": (0.08 + level * 0.09).toFixed(2), "--flame": (0.35 + level * 0.15).toFixed(2) } as CSSProperties;
  return (
    <div className="sq-fire" role="dialog" aria-label={t.title}>
      <div className="box">
        <header>
          <b>{t.title}</b>
          <button type="button" className="x" onClick={closeSquadFire} aria-label={t.close}>
            ×
          </button>
        </header>
        <div className="scene" style={vars}>
          <i className="glow" aria-hidden="true" />
          <span className="tag">{t.tag}</span>
          <span className="lv" aria-label={fmt(t.level, { n: level })}>
            {Array.from({ length: FIRE_MAX }, (_, i) => (
              <i key={i} className={i < level ? "on" : undefined} />
            ))}
            <b>{fmt(t.level, { n: level })}</b>
          </span>
          <span className="flame" aria-hidden="true">
            {level > 0 && (
              <span className="fl">
                <i className="a" />
                <i className="b" />
                <i className="e1" />
                <i className="e2" />
              </span>
            )}
          </span>
          {level === 0 && <span className="out">{t.out}</span>}
          <svg className="logs" width="140" height="40" viewBox="0 0 140 40" aria-hidden="true">
            <rect x="12" y="20" width="116" height="12" rx="6" fill="#6b4426" transform="rotate(-12 70 26)" />
            <rect x="12" y="20" width="116" height="12" rx="6" fill="#7d5130" transform="rotate(12 70 26)" />
            <ellipse cx="70" cy="34" rx="64" ry="6" fill="rgba(0,0,0,0.35)" />
          </svg>
          {room.members.slice(0, SEATS.length).map((m, i) => {
            const at = SEATS[i];
            return (
              <span key={m.h} className={`seat${at.flip ? " flip" : ""}`} style={{ left: `${at.x}%`, bottom: `${at.y}%`, width: at.s }}>
                <RoachIcon color={m.color as RoachColor} avatar={m.avatar as RoachAvatar} size={at.s} />
              </span>
            );
          })}
          {by && level > 0 && <span className="last">{by.you ? t.addedYou : fmt(t.added, { name: by.name })}</span>}
          {plus > 0 && (
            <span key={plus} className="plus">
              {t.plus}
            </span>
          )}
          {drop !== null && <span className="drop">{fmt(level >= FIRE_MAX ? t.dropMax : t.dropIn, { left: clock(drop) })}</span>}
        </div>
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
            {wood <= 0 ? t.noWood : level >= FIRE_MAX ? t.maxed : t.add}
          </button>
        </div>
        {msg && (
          <p className="fmsg" role="status">
            {msg}
          </p>
        )}
        {(f.last !== null || f.best > 0) && (
          <p className="rec">
            {f.last !== null && fmt(t.last, { time: fireTime(f.last) })}
            {f.last !== null && f.best > 0 && T.squad.dot}
            {f.best > 0 && fmt(t.best, { time: fireTime(f.best) })}
          </p>
        )}
        <p className="note">{t.note}</p>
      </div>
    </div>
  );
}
