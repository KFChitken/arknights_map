"use client";

import { T } from "@/i18n";
import { useStreamDown } from "../stream";
import { retrySquadRoom, useSquadStale } from "./squading";

/**
 * At the top of the room (its sheet, its bar): the page's live connection down a few seconds (StreamDown.tsx's
 * words), else the room not read again after trying twice more (squading.ts SquadStale), a tap reading it again
 */
export default function SquadStale({ className }: { className?: string }) {
  const down = useStreamDown();
  const stale = useSquadStale();
  const cls = className ? ` ${className}` : "";
  if (down)
    return (
      <p className={`stream-down${cls}`} role="status">
        {T.common.streamDown}
      </p>
    );
  if (!stale?.gaveUp) return null;
  return (
    <button type="button" className={`sq-stale${cls}`} onClick={() => void retrySquadRoom()}>
      {T.squad.room.stale}
    </button>
  );
}
