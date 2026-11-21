"use client";

import { useState } from "react";
import { fmt, T } from "@/i18n";
import { SHOUT, type SquadMember, type SquadRoom } from "@/lib/squad";
import { GIFT_SEATS, type LobbyMode } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { ModePlayIcon } from "./SquadPlays";
import { SquadRoach } from "./SquadRoach";
import { StackBehind } from "./SquadStack";
import { closeSquadModeCard, sayInSquad, squadModeIn, squadStartMatch, useSquadModeCard, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * A match's card while it waits for people (等人: 凯尔希随堂测, W 的礼物, 企鹅物流急件赛; src/lib/squadMode.ts), at the
 * map's foot as the modes' cards: 「{mode} · 等人」 and ×; four seats, those ready (its initiator first, 发起人, then
 * 准备好了), the room's 人机 in the empty ones where the match has 人机 (人机来跑, 人机来传), the rest empty (where
 * 人机 come at the start); its buttons as you stand: its initiator 开始 (how many, with how many 人机; 自己练 alone;
 * 再来一局 after a round), 喊一声 and 不玩了; one ready waiting for the initiator, 喊一声 and 不玩了; one not ready
 * 准备 and 喊一声; and its note. It follows the canvas 「房主开局」 (Lobby).
 */

/** A seat on the card: one ready (initiator or not), one of the room's 人机 who will play, or an empty one */
export type LobbySeat = { kind: "ready"; m: SquadMember; first: boolean } | { kind: "bot"; m: SquadMember } | { kind: "empty" };

/** The four seats as they stand: those ready in order, then the room's 人机 (W 的礼物, 急件赛), then empty */
export function lobbySeats(room: SquadRoom, mode: LobbyMode): LobbySeat[] {
  const seats: LobbySeat[] = [];
  for (const r of mode.in) {
    const m = room.members.find((x) => x.h === r.h);
    if (m) seats.push({ kind: "ready", m, first: r.h === mode.by });
  }
  if (mode.kind !== "quiz") for (const m of room.members.filter((x) => x.bot)) if (seats.length < GIFT_SEATS) seats.push({ kind: "bot", m });
  while (seats.length < GIFT_SEATS) seats.push({ kind: "empty" });
  return seats.slice(0, GIFT_SEATS);
}

/** What one may do on the card, as they stand: the main button's words and what it does (null: none, greyed), and the two others */
export type LobbyButtons = { main: { text: string; does: "start" | "ready" | null }; shout: boolean; out: boolean; solo: boolean };

export function lobbyButtons(room: SquadRoom, mode: LobbyMode): LobbyButtons {
  const t = T.squad.lobby;
  const n = mode.in.length;
  const ready = mode.in.some((x) => x.h === room.you);
  const again = mode.played > 0;
  if (mode.by === room.you) {
    const m = GIFT_SEATS - n;
    const solo = n <= 1;
    const text = again
      ? fmt(t.again, { n })
      : mode.kind === "quiz"
        ? solo
          ? t.soloQuiz
          : fmt(t.startPeople, { n })
        : solo
          ? fmt(t.solo, { m })
          : m > 0
            ? fmt(t.start, { n, m })
            : fmt(t.startPeople, { n });
    return { main: { text, does: "start" }, shout: true, out: true, solo: solo && !again && mode.kind !== "quiz" };
  }
  if (ready) return { main: { text: again ? t.waitingAgain : t.waiting, does: null }, shout: !again, out: true, solo: false };
  return { main: { text: t.readyUp, does: "ready" }, shout: true, out: false, solo: false };
}

/** The card as it shows, for the room and its match as they are now */
export function LobbyView({
  room,
  mode,
  busy,
  msg,
  onClose,
  onMain,
  onShout,
  onOut,
}: {
  room: SquadRoom;
  mode: LobbyMode;
  busy: boolean;
  /** Why the last tap did not go (bad), or what it did (取消了准备…) */
  msg: { text: string; bad: boolean } | null;
  onClose: () => void;
  onMain: (does: "start" | "ready") => void;
  onShout: () => void;
  onOut: () => void;
}) {
  const t = T.squad.lobby;
  const name = T.squad.modes.names[mode.kind];
  const b = lobbyButtons(room, mode);
  const emptyText = mode.kind === "race" ? t.emptyRun : mode.kind === "gift" ? t.emptyStart : t.empty;
  const seat = (s: LobbySeat) => (s.kind === "ready" ? (s.first ? t.initiator : t.ready) : s.kind === "bot" ? (mode.kind === "race" ? t.botRun : t.botPass) : emptyText);
  return (
    <div className="sq-lobby" role="dialog" aria-label={fmt(t.title, { mode: name })}>
      <header>
        <b>{fmt(t.title, { mode: name })}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <StackBehind />
      <div className={`lpanel k-${mode.kind}`}>
        <div className="lhead">
          <span className="ic">
            <ModePlayIcon kind={mode.kind} />
          </span>
          <b>{name}</b>
          <em>{fmt(T.squad.modes.waitTag, { n: mode.in.length })}</em>
        </div>
        <div className="lseats">
          {lobbySeats(room, mode).map((s, i) => (
            <span key={i} className={`lseat ${s.kind}${s.kind === "ready" && s.first ? " first" : ""}${s.kind !== "empty" && s.m.you ? " you" : ""}`}>
              {s.kind === "empty" ? (
                <span className="hole" aria-hidden="true">
                  ?
                </span>
              ) : (
                <span className="rw">
                  <SquadRoach m={{ ...s.m, pose: 0 }} size={44} />
                </span>
              )}
              <b>{s.kind === "empty" ? t.empty : s.m.you ? T.squad.room.you : s.m.name}</b>
              <small>{seat(s)}</small>
            </span>
          ))}
        </div>
      </div>
      <div className="lacts">
        <button type="button" className={`main${b.main.does ? "" : " wait"}`} disabled={busy || !b.main.does} onClick={() => b.main.does && onMain(b.main.does)}>
          {b.main.text}
        </button>
        {(b.shout || b.out) && (
          <div className="two">
            {b.shout && (
              <button type="button" disabled={busy} onClick={onShout}>
                {t.shout}
              </button>
            )}
            {b.out && (
              <button type="button" className="out" disabled={busy} onClick={onOut}>
                {t.out}
              </button>
            )}
          </div>
        )}
        {b.solo && <span className="lsmall">{t.soloNote}</span>}
      </div>
      {msg && (
        <p className={msg.bad ? "lmsg" : "lmsg ok"} role="status">
          {msg.text}
        </p>
      )}
      <p className="note">{mode.kind === "quiz" ? t.noteQuiz : t.note}</p>
    </div>
  );
}

export default function SquadLobby() {
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const mode = room?.mode?.wait && room.mode.at === openAt ? room.mode : null;
  if (!mode || !room) return null;
  const run = async (p: () => Promise<unknown>, after: string | null = null) => {
    setBusy(true);
    setMsg(null);
    try {
      await p();
      setMsg(after === null ? null : { text: after, bad: false });
    } catch (e) {
      setMsg({ text: e instanceof WorldError ? e.message : T.map.common.tryAgain, bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <LobbyView
      room={room}
      mode={mode}
      busy={busy}
      msg={msg}
      onClose={closeSquadModeCard}
      onMain={(does) => void run(() => (does === "start" ? squadStartMatch() : squadModeIn(true)))}
      onShout={() =>
        void run(async () => {
          const r = await sayInSquad(SHOUT);
          if (!r.sent) throw new WorldError(r.full ? T.squad.say.enough : T.squad.say.slow);
        })
      }
      onOut={() => void run(() => squadModeIn(false), T.squad.lobby.outNote)}
    />
  );
}
