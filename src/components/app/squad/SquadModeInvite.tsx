"use client";

import { useState } from "react";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import type { SquadRoom } from "@/lib/squad";
import { isMatchKind, type SquadMode } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { SquadRoach } from "./SquadRoach";
import { useMiniPage } from "./miniState";
import { dismissSquadMode, squadModeIn, useSquadModeCard, useSquadModeAsked, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 「XX 开了龙门广场舞（2 人在跳），加入？」 (玩点什么, src/lib/squadMode.ts): a line at the top, over the map and the
 * room, to everyone in the room not in the mode playing, those who come in while it plays too. 加入 joins it (its card
 * opens), 不了 puts it away for that mode; not shown to its opener, nor while its card is open, nor to one
 * who was in it and went to watch. A match waiting asks those not ready (「XX 想玩…，来吗？」 准备); a round of it
 * playing, those neither in it nor in the next (「…下一局来吗？」 下一局算我).
 */

/**
 * The mode the player is asked to join now, or null: one playing they are not in and did not open, not put away
 * (asked: the start of the one put away, or joined or left), its card (cardAt) not open. A match waiting: they are not
 * ready; a round playing: they are not in it nor in the next.
 */
export function inviteOf(room: SquadRoom | null, asked: number | null, cardAt: number | null): SquadMode | null {
  const mode = room?.mode;
  if (!room || !mode || cardAt === mode.at || asked === mode.at) return null;
  if (mode.by === room.you || mode.in.some((m) => m.h === room.you)) return null;
  if (!mode.wait && "next" in mode && mode.next.includes(room.you)) return null;
  return mode;
}

/**
 * 来一起玩？ may be said to the one numbered h (对 TA 说): a match waits or plays (on the server's clock now), and TA,
 * a player, is neither in it, ready for it, nor asking for its next round
 */
export function mayCall(room: SquadRoom, h: number, now: number): boolean {
  const mode = room.mode;
  if (!mode || mode.endsAt <= now || !isMatchKind(mode.kind)) return false;
  const m = room.members.find((x) => x.h === h);
  if (!m || m.bot || m.you || mode.by === h || mode.in.some((x) => x.h === h)) return false;
  return !("next" in mode && mode.next.includes(h));
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
  const who = by ? <b>{by.name}</b> : null;
  const n = mode.in.length;
  const text = mode.wait
    ? who
      ? fmtNodes(t.waitInvites, { name: who, mode: name, n })
      : fmtNodes(t.waitInvitesNoBy, { mode: name, n })
    : mode.kind === "dance"
      ? who
        ? fmtNodes(t.invites[mode.kind], { name: who, mode: name, n })
        : fmtNodes(t.invitesNoBy[mode.kind], { mode: name, n })
      : who
        ? fmtNodes(t.nextInvites[mode.kind], { name: who, mode: name, n })
        : fmtNodes(t.nextInvitesNoBy[mode.kind], { mode: name, n });
  return (
    <div className="sq-minv" role="alert">
      {by && (
        <span className="ri" aria-hidden="true">
          <SquadRoach m={{ ...by, pose: 0 }} size={34} />
        </span>
      )}
      <span className="tx">
        {text}
        {note && <small>{note}</small>}
      </span>
      <button type="button" className="acc" disabled={busy} onClick={onJoin}>
        {mode.wait ? t.inviteReady : mode.kind === "dance" ? t.inviteJoin : t.inviteNext}
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
  const danceAt = useSquadModeCard();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ at: number; text: string } | null>(null);
  // the room small as the whole page has 加入 on its strip
  const small = useMiniPage();
  const mode = inviteOf(room, asked?.at ?? null, danceAt);
  if (!room || !mode || small) return null;
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
