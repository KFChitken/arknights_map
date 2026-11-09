"use client";

import type { Friend } from "@/lib/world/types";
import { ago } from "./InboxSheet";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

/** The 触须之交 mark: two feelers that met, under a heart, as when two roaches become 触须之交 */
export function FriendsMark({ size = 19 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 22 C5 15.5 8 12.2 12 12.2 M19 22 C19 15.5 16 12.2 12 12.2" fill="none" stroke="#1b1d22" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 11.4 C8.2 8.7 6.7 6.6 6.7 4.5 C6.7 2.9 8 1.6 9.6 1.6 C10.6 1.6 11.5 2.2 12 3 C12.5 2.2 13.4 1.6 14.4 1.6 C16 1.6 17.3 2.9 17.3 4.5 C17.3 6.6 15.8 8.7 12 11.4 Z"
        fill="#ff4f8b"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Everyone you are 触须之交 with, the guides first, as a grid of how they look on the map;
 * a tap opens one (FriendView), and going back comes here again.
 */
export default function FriendsSheet({ friends, onOpen, onClose }: { friends: Friend[]; onOpen: (id: string) => void; onClose: () => void }) {
  return (
    <Sheet title="触须之交" onClose={onClose}>
      {friends.length === 0 ? (
        <p className="hint">还没有触须之交。你大胆碰了 TA，TA 也大胆碰了你，你们就会成为触须之交。</p>
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            共 {friends.length} 位，点一位看 TA 的资料。
          </p>
          <div className="friend-grid">
            {friends.map((f) => (
              <button key={f.id} className="friend-tile" onClick={() => onOpen(f.id)}>
                <RoachIcon color={f.profile.color} size={60} avatar={f.profile.avatar} friend />
                <strong>{f.profile.displayName}</strong>
                <small>{ago(f.since)}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
