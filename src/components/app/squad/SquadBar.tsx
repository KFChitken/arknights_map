"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { SQUAD_MAX, type SquadCall } from "@/lib/squad";
import type { InboxItem } from "@/lib/world/types";
import { ShieldIcon } from "../chrome/parts";
import { useSquadBotsActing } from "./squadBots";
import { squadCallLine, useSquadRoom } from "./squading";
import "./squadBar.css";

/** An invitation to 一起卫戍, as 消息 has it */
export type SquadInviteItem = Extract<InboxItem, { kind: "squadInvite" }>;
/** A 宣言招人 you got, as 消息 has it: the declaration, with its room as it is now */
export type SquadCallItem = Extract<InboxItem, { kind: "declaration" }> & { squad: SquadCall };
/** The card over the map: an invitation that came, or one (or a 宣言招人) tapped in 消息; ask: it asks at once whether to leave your room */
export type SquadPopCard = { kind: "invite"; item: SquadInviteItem; ask: boolean } | { kind: "call"; item: SquadCallItem; ask: boolean };

/** Where to stand over the map: above the layout's bottom bar (data-chrome-bottom) by `up` more, else under the top */
export function useAbove(shown: boolean, up: number) {
  const [at, setAt] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!shown) return;
    let last = "";
    const look = () => {
      // the highest of all the layout marks along the bottom (听歌's little bar and its handle among them), as ListenOverlay
      const tops = [...document.querySelectorAll("[data-chrome-bottom]")]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => r.top);
      const next: CSSProperties = tops.length ? { bottom: Math.round(window.innerHeight - Math.min(...tops) + 10 + up) } : { top: 76 + up };
      const k = JSON.stringify(next);
      if (k === last) return;
      last = k;
      setAt(next);
    };
    look();
    const t = window.setInterval(look, 1_000);
    window.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
    };
  }, [shown, up]);
  return at;
}

/**
 * Over the map while the player is in a room of 一起卫戍 that waits and its sheet is shut: 卫戍中 n/4, back to the room
 * at a tap (while it plays, the bar of the round has its place: SquadFight.tsx). Just above the layout's bottom bar
 * (data-chrome-bottom), else under the top.
 */
export default function SquadBar({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const room = useSquadRoom();
  // the 人机 of a room the 站长 or an admin hosts, now and then (mounted while 一起卫戍 shows on the map)
  useSquadBotsActing();
  const shown = Boolean(room) && room?.state !== "go" && !hidden;
  const at = useAbove(shown, 0);
  if (!room || !shown || !at) return null;
  const n = room.members.length;
  return (
    <button className="sq-bar glass" style={at} aria-haspopup="dialog" aria-label={fmt(T.squad.inRoomLabel, { n, max: SQUAD_MAX })} onClick={onOpen}>
      <ShieldIcon size={18} />
      <span>{fmt(T.squad.inRoom, { n, max: SQUAD_MAX })}</span>
      {room.dj && room.startedAt !== null && <span aria-hidden="true">♪</span>}
    </button>
  );
}

/**
 * The card of an invitation to 一起卫戍 that came while the page is open (进去, 下次吧), or of one or a 宣言招人 tapped in
 * 消息 while in another room: going in leaves that one (its host's ends), so it asks first. Above the bar, when that
 * shows too.
 */
export function SquadPop({
  card,
  hidden,
  onGo,
  onLater,
  onDismiss,
}: {
  card: SquadPopCard | null;
  hidden: boolean;
  onGo: (card: SquadPopCard) => void;
  onLater: (item: SquadInviteItem) => void;
  /** 算了, or the card gone otherwise */
  onDismiss: () => void;
}) {
  const room = useSquadRoom();
  const shown = Boolean(card) && !hidden;
  // above the bar of a round, which is taller, or 卫戍中 n/4
  const at = useAbove(shown, room?.state === "go" ? 176 : room ? 46 : 0);
  if (!card || !shown || !at) return null;
  return <PopCard key={`${card.item.id}:${card.ask}`} card={card} at={at} inRoom={Boolean(room)} onGo={onGo} onLater={onLater} onDismiss={onDismiss} />;
}

function PopCard({
  card,
  at,
  inRoom,
  onGo,
  onLater,
  onDismiss,
}: {
  card: SquadPopCard;
  at: CSSProperties;
  inRoom: boolean;
  onGo: (card: SquadPopCard) => void;
  onLater: (item: SquadInviteItem) => void;
  onDismiss: () => void;
}) {
  const [asking, setAsking] = useState(card.ask);
  const invite = card.kind === "invite" ? card.item : null;
  const call = card.kind === "call" ? card.item : null;
  const title = invite ? fmt(T.squad.call.card, { who: invite.from.displayName }) : (call?.text ?? "");
  const line = squadCallLine(invite ? invite.call : call!.squad);
  return (
    <div className="sq-popcard" role="alert" style={at}>
      <div className="h">
        <ShieldIcon size={18} />
        <span>{title}</span>
      </div>
      <small>{asking ? T.squad.call.leaveOld : line}</small>
      <div className="b">
        <button className="acc" onClick={() => (asking || !inRoom ? onGo(card) : setAsking(true))}>
          {invite ? T.squad.call.go : T.squad.call.join}
        </button>
        {invite && !asking ? (
          <button className="dec" onClick={() => onLater(invite)}>
            {T.squad.call.later}
          </button>
        ) : (
          <button className="dec" onClick={onDismiss}>
            {T.squad.call.no}
          </button>
        )}
      </div>
    </div>
  );
}
