"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import type { SquadRoom } from "@/lib/squad";
import { MODE_KINDS, type SquadModeKind } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { closeSquadModes, openSquadModeCard, squadModeIn, squadOpenMode, squadServerNow, useSquadModesOpen, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 玩点什么 (卫戍碎片时间玩法 ⑥; src/lib/squadMode.ts): 「玩」 → 玩点什么 opens this card over the map (at the foot on a
 * phone, in the middle on a computer). The modes there are, one row each: 开 while none plays (or, for one who opened
 * the last, 「n 秒后能再开」 till its minute is up), 「正在玩 · 加入」 for the one playing, 「在玩 · 打开」 once in it,
 * 「等这局完」 for the others while one plays. While the room waits for its round, each says how one joins it late.
 */

/** What a mode's row does for the player now (on the server's clock): open it, join it, open its card, or nothing yet */
export type ModeRow = { kind: SquadModeKind; label: string; does: "open" | "join" | "look" | null };

export function modeRow(room: SquadRoom, kind: SquadModeKind, now: number): ModeRow {
  const t = T.squad.modes;
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  if (mode?.kind === kind) return mode.in.some((m) => m.h === room.you) ? { kind, label: t.in, does: "look" } : { kind, label: t.join, does: "join" };
  if (mode) return { kind, label: t.wait, does: null };
  const again = room.modeAgain && room.modeAgain > now ? Math.ceil((room.modeAgain - now) / 1000) : 0;
  return again ? { kind, label: fmt(t.again, { s: again }), does: null } : { kind, label: t.open, does: "open" };
}

/** The card as it shows, for the room as it is now */
export function ModesCard({
  room,
  now,
  busy,
  msg,
  onAct,
  onClose,
}: {
  room: SquadRoom;
  now: number;
  busy: boolean;
  /** Why the last 开 or 加入 did not go */
  msg: string | null;
  onAct: (row: ModeRow) => void;
  onClose: () => void;
}) {
  const t = T.squad.modes;
  const waiting = room.state !== "go";
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  const mine = Boolean(mode?.in.some((m) => m.h === room.you));
  const by = mode ? room.members.find((m) => m.h === mode.by) : undefined;
  return (
    <div className="sq-modes" role="dialog" aria-label={t.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box">
        <header>
          <b>{t.title}</b>
          <span>{waiting ? t.subWait : t.sub}</span>
          <button type="button" className="x" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </header>
        {mode && (
          <p className={`now k-${mode.kind}`}>
            <i aria-hidden="true" />
            <span>
              {by
                ? fmt(t.playing, { mode: t.names[mode.kind], name: by.you ? T.squad.room.you : by.name, n: mode.in.length })
                : fmt(t.playingNoBy, { mode: t.names[mode.kind], n: mode.in.length })}
            </span>
            {!mine && <small>{t.joinAny}</small>}
          </p>
        )}
        <div className="rows">
          {MODE_KINDS.map((kind) => {
            const row = modeRow(room, kind, now);
            return (
              <button
                key={kind}
                type="button"
                className={`row k-${kind}`}
                disabled={busy || !row.does}
                aria-label={`${t.names[kind]}${T.squad.dot}${row.label}`}
                onClick={() => onAct(row)}
              >
                <span className="gl" aria-hidden="true">
                  {t.glyphs[kind]}
                </span>
                <span className="tx">
                  <span className="nm">
                    <b>{t.names[kind]}</b>
                    {waiting && <em>{t.tags[kind]}</em>}
                  </span>
                  <small>{waiting ? t.waitLines[kind] : t.lines[kind]}</small>
                </span>
                <span className="go">
                  {!waiting && <small>{t.ends[kind]}</small>}
                  <span className={`btn${!row.does ? "" : row.does === "join" ? " join" : " on"}`}>{row.label}</span>
                </span>
              </button>
            );
          })}
        </div>
        {msg && (
          <p className="mmsg" role="status">
            {msg}
          </p>
        )}
        <p className="note">{waiting ? t.noteWait : t.note}</p>
      </div>
    </div>
  );
}

export default function SquadModes() {
  const open = useSquadModesOpen();
  const room = useSquadRoom();
  const [now, setNow] = useState(() => squadServerNow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setNow(squadServerNow());
    const t = window.setInterval(() => setNow(squadServerNow()), 1_000);
    return () => window.clearInterval(t);
  }, [open]);
  if (!open || !room) return null;
  const act = async (row: ModeRow) => {
    if (busy || !row.does) return;
    if (row.does === "look") {
      closeSquadModes();
      return openSquadModeCard();
    }
    setBusy(true);
    setMsg(null);
    try {
      if (row.does === "join") await squadModeIn(true);
      else await squadOpenMode(row.kind);
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  return <ModesCard room={room} now={now} busy={busy} msg={msg} onAct={(row) => void act(row)} onClose={closeSquadModes} />;
}
