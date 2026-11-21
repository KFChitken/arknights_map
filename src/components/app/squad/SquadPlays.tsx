"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import type { SquadRoom } from "@/lib/squad";
import { fireLevel, WOOD_MAX, woodNow } from "@/lib/squadFire";
import { isMatchKind, MODE_KINDS, type SquadModeKind } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { openFishWin, useFishWin } from "../fish/winStore";
import { openSquadFire, openSquadModeCard, squadModeIn, squadOpenMode, squadServerNow } from "./squading";
import "./squadModes.css";

/**
 * 「玩」 in a room of 一起卫戍 (the room's sheet on a phone, the bar's panel on a computer): every game there is, each
 * a tile with its icon and its name, nothing more. 钓鳞's icon shows how its line stands (none in the water, in it, a
 * bite); 添柴's shows the fire (out, small, big, roaring) with its level, and the sticks in your hand. The modes of
 * 玩点什么 (one at a time) open, join or show the one playing as their tile is tapped; one that cannot be opened now
 * says why under the tiles. A match (凯尔希随堂测, W 的礼物, 企鹅物流急件赛) waits for people first: its tile says
 * how many are ready (等人 n/4) and readies you; while a round plays, one not in it asks for the next (下一局).
 */

/**
 * What a mode's tile does for the player now (on the server's clock): open it (a match: 发起), join it, ready for it
 * (a match waiting), ask for its next round (a round playing), open its card, or nothing yet; and its tag
 */
export type ModeRow = { kind: SquadModeKind; label: string; does: "open" | "join" | "look" | "ready" | "next" | null; tag?: string };

export function modeRow(room: SquadRoom, kind: SquadModeKind, now: number): ModeRow {
  const t = T.squad.modes;
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  if (mode?.kind === kind) {
    const mine = mode.in.some((m) => m.h === room.you);
    if (mode.wait) {
      const tag = fmt(t.waitTag, { n: mode.in.length });
      return mine || mode.by === room.you ? { kind, label: tag, does: "look", tag } : { kind, label: tag, does: "ready", tag };
    }
    if (isMatchKind(kind) && !mine) {
      return "next" in mode && mode.next.includes(room.you) ? { kind, label: t.in, does: "look", tag: T.squad.plays.in } : { kind, label: t.nextTag, does: "next", tag: t.nextTag };
    }
    return mine ? { kind, label: t.in, does: "look", tag: T.squad.plays.in } : { kind, label: t.join, does: "join", tag: T.squad.plays.join };
  }
  if (mode) return { kind, label: fmt(t.wait, { mode: t.names[mode.kind] }), does: null };
  return { kind, label: isMatchKind(kind) ? t.pick : t.open, does: "open" };
}

/** How 钓鳞's line stands: none in the water, in it, or bitten */
export type FishLook = "rest" | "line" | "bite";
/** How the fire looks: out, small (Lv.1–9), big (Lv.10–49), roaring (Lv.50 and up) */
export type FireLook = "out" | "small" | "big" | "roar";
export const fireLook = (level: number): FireLook => (level <= 0 ? "out" : level < 10 ? "small" : level < 50 ? "big" : "roar");

/** 钓鳞: a float on the water, its line going up; out of it, on it with ripples, or pulled under with a splash */
export function FishPlayIcon({ look }: { look: FishLook }) {
  const dy = look === "rest" ? -7 : look === "bite" ? 4 : 0;
  return (
    <svg className={`pg-ico fish ${look}`} viewBox="0 0 40 40" aria-hidden="true">
      {/* moved by its state, bobbing or tugged inside (an animation's transform would replace the attribute's) */}
      <g transform={`translate(0 ${dy})`}>
        <g className="float">
          <path d="M20 2v10" stroke="#1b1d22" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M11.5 22a8.5 8.2 0 0 1 17 0Z" fill="#ff4a2e" />
          <path d="M11.5 22a8.5 8.2 0 0 0 17 0Z" fill="#fff" />
          <path d="M11.5 22a8.5 8.2 0 0 1 17 0a8.5 8.2 0 0 1-17 0Z" fill="none" stroke="#1b1d22" strokeWidth="1.5" />
        </g>
      </g>
      <path d="M2.5 31.5q4.3-2.4 8.6 0t8.6 0t8.6 0t8.6 0" fill="none" stroke="#3ea6ee" strokeWidth="2" strokeLinecap="round" />
      {look !== "rest" && <path d="M7 36q3.2-1.6 6.4 0M26.6 36q3.2-1.6 6.4 0" fill="none" stroke="#9fd3f7" strokeWidth="1.6" strokeLinecap="round" />}
      {look === "bite" && (
        <>
          <path d="M8 23l-3-4M32 23l3-4M10.5 19.5l-1.5-4.5M29.5 19.5l1.5-4.5" stroke="#3ea6ee" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="33" cy="8" r="6" fill="#ff8a1f" />
          <path d="M33 4.6v4.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <circle cx="33" cy="11.4" r="1.1" fill="#fff" />
        </>
      )}
    </svg>
  );
}

/** 添柴: two logs; on them nothing but smoke (out), or a flame as big as the fire is */
export function FirePlayIcon({ look }: { look: FireLook }) {
  const s = look === "small" ? 0.62 : look === "big" ? 0.85 : 1;
  return (
    <svg className={`pg-ico fire ${look}`} viewBox="0 0 40 40" aria-hidden="true">
      {look === "roar" && <circle cx="20" cy="22" r="17" fill="#ffb341" opacity="0.22" />}
      {look === "out" ? (
        <path d="M18 24c-3-3 3-5 0-8s2-6 0-9M23 24c-2-2.4 2.4-4 0-6.4" fill="none" stroke="#9aa0aa" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <g transform={`translate(20 31) scale(${s}) translate(-20 -31)`}>
          <path d="M20 5c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 2 3 3 4 5 4-1-4-1-7 0-10Z" fill="#ff6a1f" />
          <path d="M20 15c1.4 3.6 5 5 5 9.4a5 5 0 0 1-10 0c0-3 1.6-4.4 2.4-6.8 1 1.6 2 2.2 3.2 2.2-.8-1.6-.9-3.2-.6-4.8Z" fill="#ffd23f" />
        </g>
      )}
      {look === "roar" && <path d="M7 12l1.5 2M33 11l-1.5 2.2M10 6.5l.8 1.6M30 5.5l-.8 1.7" stroke="#ff8a1f" strokeWidth="1.6" strokeLinecap="round" />}
      <path d="M6 35.5l25-7.5" stroke="#7a4a22" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M34 35.5l-25-7.5" stroke="#94592a" strokeWidth="4.2" strokeLinecap="round" />
    </svg>
  );
}

/** A mode of 玩点什么's own icon */
export function ModePlayIcon({ kind }: { kind: SquadModeKind }) {
  if (kind === "dance")
    return (
      <svg className="pg-ico dance" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M14 8l15-4v20" fill="none" stroke="#b4235a" strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M14 8v21" stroke="#b4235a" strokeWidth="2.6" />
        <ellipse cx="10.5" cy="29.5" rx="4.6" ry="3.6" fill="#b4235a" />
        <ellipse cx="25.5" cy="24.5" rx="4.6" ry="3.6" fill="#b4235a" />
        <path d="M33 30l1.2 2.8 2.8 1.2-2.8 1.2-1.2 2.8-1.2-2.8-2.8-1.2 2.8-1.2Z" fill="#ff7ac0" />
        <path d="M6 10l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9Z" fill="#ff7ac0" />
      </svg>
    );
  if (kind === "quiz")
    return (
      <svg className="pg-ico quiz" viewBox="0 0 40 40" aria-hidden="true">
        <rect x="8" y="4" width="24" height="31" rx="3" fill="#fff" stroke="#1f4366" strokeWidth="2" />
        <path d="M13 11h14M13 16h10" stroke="#9fb6cf" strokeWidth="2" strokeLinecap="round" />
        <path d="M16.6 22.4a3.4 3.4 0 1 1 4.4 3.2c-.8.3-1 .8-1 1.8" fill="none" stroke="#1f4366" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="20" cy="30.8" r="1.4" fill="#1f4366" />
        <path d="M27 27.5l2.6 2.6 5.4-6.4" fill="none" stroke="#d2342a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "race")
    return (
      <svg className="pg-ico race" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M2.5 15h7M1 21.5h8M3 28h6.5" stroke="#b8860b" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="11" y="10" width="26" height="22" rx="2.6" fill="#d9a066" stroke="#7a4a22" strokeWidth="1.8" />
        <rect x="21" y="10" width="6" height="22" fill="#ffd23f" />
        <path d="M11 16.5h26" stroke="#7a4a22" strokeWidth="1.4" opacity="0.6" />
        <rect x="14" y="21" width="5" height="6" rx="1" fill="#fff" stroke="#7a4a22" strokeWidth="1.2" />
        <path d="M31 21.5l2.2 2.2-2.2 2.2" fill="none" stroke="#1b1d22" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "stack")
    return (
      <svg className="pg-ico stack" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M27 2.5v4.5" stroke="#5b2fa8" strokeWidth="1.2" opacity="0.5" />
        <rect x="21.5" y="7" width="11" height="6.5" rx="3.2" fill="#7a4fd0" />
        <rect x="11.5" y="15" width="13" height="6.5" rx="3.2" fill="#5b2fa8" />
        <rect x="14.5" y="21.5" width="13" height="6.5" rx="3.2" fill="#7a4fd0" />
        <rect x="12" y="28" width="13" height="6.5" rx="3.2" fill="#5b2fa8" />
        <rect x="7" y="34.5" width="26" height="3" rx="1.2" fill="#8a6b45" />
        <path d="M18.5 7l-3 1.5M35 9.5l-3-1" stroke="#7a4fd0" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      </svg>
    );
  return (
    <svg className="pg-ico gift" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 15 Q18.5 7 25 4" stroke="#3a3f47" strokeWidth="2" fill="none" />
      <circle className="spark" cx="25.5" cy="4" r="3" fill="#ffb000" />
      <rect x="6" y="16" width="28" height="20" rx="2.5" fill="#d2342a" />
      <rect x="17.5" y="16" width="5" height="20" fill="#ffd23f" />
      <rect x="6" y="22.5" width="28" height="5" fill="#ffd23f" />
      <ellipse cx="15" cy="15" rx="5" ry="3.2" fill="#ffd23f" />
      <ellipse cx="25" cy="15" rx="5" ry="3.2" fill="#ffd23f" />
    </svg>
  );
}

/** The tiles as they show, for the room as it is now (on the server's clock) and 钓鳞's line as it stands */
export function PlayGrid({
  room,
  now,
  fish,
  busy,
  msg,
  onFish,
  onFire,
  onMode,
}: {
  room: SquadRoom;
  now: number;
  fish: FishLook;
  busy: boolean;
  /** Why the last tap on a mode did not go */
  msg: string | null;
  onFish: () => void;
  onFire: () => void;
  onMode: (row: ModeRow) => void;
}) {
  const t = T.squad.plays;
  const me = room.members.find((m) => m.you);
  const level = fireLevel(room.fire.level, room.fire.at, now);
  const wood = woodNow(me?.wood ?? WOOD_MAX, me?.woodAt ?? null, now);
  const playing = room.mode && room.mode.endsAt > now ? room.mode : null;
  return (
    <div className="sq-pg">
      <div className="tiles">
        <button type="button" className={`tile k-fish${fish === "bite" ? " alert" : ""}`} aria-label={fmt(t.fishLabel, { state: t.fishStates[fish] })} onClick={onFish}>
          <span className="pic">
            <FishPlayIcon look={fish} />
          </span>
          <b>{T.fish.pond.fish}</b>
        </button>
        <button type="button" className="tile k-fire" aria-label={fmt(T.squad.fire.playSub, { level, n: wood })} onClick={onFire}>
          <span className="pic">
            <FirePlayIcon look={fireLook(level)} />
            {level > 0 && <em className="lv">{fmt(t.level, { n: level })}</em>}
            <em className="wood">
              <i aria-hidden="true" />
              {wood}
            </em>
          </span>
          <b>{T.squad.fire.play}</b>
        </button>
        {MODE_KINDS.map((kind) => {
          const row = modeRow(room, kind, now);
          const tag = row.tag ?? null;
          return (
            <button
              key={kind}
              type="button"
              className={`tile k-${kind}${row.does ? "" : " off"}`}
              aria-label={`${T.squad.modes.names[kind]}${T.squad.dot}${row.label}`}
              aria-disabled={!row.does}
              disabled={busy}
              onClick={() => onMode(row)}
            >
              <span className="pic">
                <ModePlayIcon kind={kind} />
                {tag && <em className={`tag${row.does === "join" || row.does === "ready" || row.does === "next" ? " join" : row.does === "look" ? " in" : ""}`}>{tag}</em>}
              </span>
              <b>{T.squad.modes.names[kind]}</b>
            </button>
          );
        })}
      </div>
      {playing && (
        <p className="now">
          {fmt(playing.wait ? t.waiting : t.playing, { mode: T.squad.modes.names[playing.kind], n: playing.in.length })}
        </p>
      )}
      {msg && (
        <p className="pmsg" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

/** The tiles for the room as it is, ticking each second; done: a tile was tapped and went (the phone's menu shuts) */
export default function SquadPlays({ room, onDone }: { room: SquadRoom; onDone?: () => void }) {
  const win = useFishWin();
  const [now, setNow] = useState(() => squadServerNow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(squadServerNow()), 1_000);
    return () => window.clearInterval(t);
  }, []);
  const fish: FishLook = win.bite ? "bite" : win.line ? "line" : "rest";
  const mode = async (row: ModeRow) => {
    if (busy) return;
    setMsg(null);
    if (!row.does) return setMsg(row.label);
    if (row.does === "look") {
      openSquadModeCard();
      return onDone?.();
    }
    setBusy(true);
    try {
      // 加入, 准备 and 下一局算我 alike put you in it (a match waiting: ready; a round playing: in the next)
      if (row.does === "join" || row.does === "ready" || row.does === "next") await squadModeIn(true);
      else await squadOpenMode(row.kind);
      onDone?.();
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PlayGrid
      room={room}
      now={now}
      fish={fish}
      busy={busy}
      msg={msg}
      onFish={() => {
        openFishWin();
        onDone?.();
      }}
      onFire={() => {
        openSquadFire();
        onDone?.();
      }}
      onMode={(row) => void mode(row)}
    />
  );
}
