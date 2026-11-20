"use client";

import { useState } from "react";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import type { SquadRoom } from "@/lib/squad";
import type { SquadMode } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { SquadRoach } from "./SquadRoach";
import { dismissSquadMode, squadModeIn, useSquadDanceOpen, useSquadModeAsked, useSquadModesOpen, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 「XX 开了龙门广场舞（2 人在跳），加入？」 (玩点什么, src/lib/squadMode.ts): a line at the top, over the map and the
 * room, to everyone in the room not in the mode playing, those who come in while it plays too. 加入 joins it (its card
 * opens), 不了 puts it away for that mode; not shown to its opener, nor while its card or 玩点什么 is open, nor to one
 * who was in it and went to watch.
 */

/**
 * The mode the player is asked to join now, or null: one playing they are not in and did not open, not put away
 * (asked: the start of the one put away, or joined or left), its card (danceAt) and 玩点什么 not open
 */
export function inviteOf(room: SquadRoom | null, asked: number | null, danceAt: number | null, modesOpen: boolean): SquadMode | null {
  const mode = room?.mode;
  if (!room || !mode || modesOpen || danceAt === mode.at || asked === mode.at) return null;
  if (mode.by === room.you || mode.in.some((m) => m.h === room.you)) return null;
  return mode;
}

/** The line as it shows: by whom (when TA is still in the room), the mode, how many are in it */
export function InviteLine({
  room,
  mode,
  busy,
  note,
  onJoin,
  onNo,
}: {
  room: SquadRoom;
  mode: SquadMode;
  busy: boolean;
  /** Why 加入 did not go */
  note: string | null;
  onJoin: () => void;
  onNo: () => void;
}) {
  const t = T.squad.modes;
  const by = room.members.find((m) => m.h === mode.by);
  const name = <b className="md">{t.names[mode.kind]}</b>;
  return (
    <div className="sq-minv" role="alert">
      {by && (
        <span className="ri" aria-hidden="true">
          <SquadRoach m={{ ...by, pose: 0 }} size={34} />
        </span>
      )}
      <span className="tx">
        {by
          ? fmtNodes(t.invites[mode.kind], { name: <b>{by.name}</b>, mode: name, n: mode.in.length })
          : fmtNodes(t.invitesNoBy[mode.kind], { mode: name, n: mode.in.length })}
        {note && <small>{note}</small>}
      </span>
      <button type="button" className="acc" disabled={busy} onClick={onJoin}>
        {t.inviteJoin}
      </button>
      <button type="button" className="no" onClick={onNo} aria-label={fmt(t.inviteNoLabel, { mode: t.names[mode.kind] })}>
        {t.inviteNo}
      </button>
    </div>
  );
}

export default function SquadModeInvite() {
  const room = useSquadRoom();
  const asked = useSquadModeAsked();
  const danceAt = useSquadDanceOpen();
  const modesOpen = useSquadModesOpen();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ at: number; text: string } | null>(null);
  const mode = inviteOf(room, asked, danceAt, modesOpen);
  if (!room || !mode) return null;
  const join = async () => {
    setBusy(true);
    try {
      await squadModeIn(true);
    } catch (e) {
      setMsg({ at: mode.at, text: e instanceof WorldError ? e.message : T.map.common.tryAgain });
    } finally {
      setBusy(false);
    }
  };
  return (
    <InviteLine
      room={room}
      mode={mode}
      busy={busy}
      note={msg?.at === mode.at ? msg.text : null}
      onJoin={() => void join()}
      onNo={() => dismissSquadMode(mode.at)}
    />
  );
}
