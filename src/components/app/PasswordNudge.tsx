"use client";

/**
 * The map's ask to set a password, for a signed-in player whose codes may not arrive just now (Me.passwordNudge):
 * without a password, a new phone or computer could not sign in. 下次再说 puts it off on this device for
 * LATER_MS; otherwise it comes once a visit until a password is set.
 */

import { T } from "@/i18n";
const LATER_MS = 30 * 86_400_000;
const laterKey = (userId: string) => `zhoup.passwordNudgeLater.${userId}`;

/** Whether 下次再说 was tapped here lately; where nothing can be remembered, it never pesters */
export function nudgePutOff(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(laterKey(userId)));
    return at > 0 && Date.now() - at < LATER_MS;
  } catch {
    return true;
  }
}

export function putOffNudge(userId: string) {
  try {
    localStorage.setItem(laterKey(userId), String(Date.now()));
  } catch {}
}

export default function PasswordNudge({ onSet, onLater }: { onSet: () => void; onLater: () => void }) {
  return (
    <div className="pw-nudge" role="status">
      <p>{T.password.nudge.gmail}</p>
      <div className="row">
        <button className="go" onClick={onSet}>
          {T.password.nudge.go}
        </button>
        <button className="no" onClick={onLater}>
          {T.password.notNow}
        </button>
      </div>
    </div>
  );
}
