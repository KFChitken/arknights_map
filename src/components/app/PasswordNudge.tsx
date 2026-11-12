"use client";

/**
 * The map's ask to set a password, for a signed-in player whose codes may not arrive just now (Me.passwordNudge):
 * without a password, a new phone or computer could not sign in. 下次再说 puts it off on this device for
 * LATER_MS; otherwise it comes once a visit until a password is set.
 */

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
      <p>Gmail 现在收不到我们的验证码。先设个密码，下次换手机或电脑，用邮箱和密码就能登录。</p>
      <div className="row">
        <button className="go" onClick={onSet}>
          去设密码
        </button>
        <button className="no" onClick={onLater}>
          下次再说
        </button>
      </div>
    </div>
  );
}
