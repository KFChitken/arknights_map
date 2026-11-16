"use client";

import { T } from "@/i18n";
import type { FriendEvent } from "@/lib/world/types";
import { eventText } from "../InboxSheet";
import Sheet from "../Sheet";
import { clockOf, dateOf } from "./parts";

/** 「触须之交看到的你」: the history 触须之交 see on the player's page, as one who was in none of it sees it */
export default function Seen({ events, offset, onBack }: { events: FriendEvent[]; offset: number; onBack: () => void }) {
  return (
    <Sheet title={T.records.overview.seen} className="records" onBack={onBack} onClose={onBack}>
      <p className="hint">{T.records.overview.seenHint}</p>
      {events.length === 0 && <p className="hint">{T.inbox.history.empty}</p>}
      {events.map((e, i) => (
        <div className="event" key={i}>
          <span>{eventText(e)}</span>
          <span className="muted">
            {dateOf(e.at, offset)} {clockOf(e.at, offset)}
          </span>
        </div>
      ))}
    </Sheet>
  );
}
