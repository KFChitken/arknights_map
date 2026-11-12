"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { passwordStatus, removePassword, savePassword } from "@/lib/authClient";
import { passwordProblem } from "@/lib/passwordRules";
import { keepLoginWith } from "./LoginSheet";
import PasswordField, { HiddenUsername } from "./PasswordField";

/** What the player set out to do with their password */
export type PasswordForm = "set" | "change" | "remove";

/** Said on the sign-in by code that confirms it is the player, for each */
export const CONFIRM_REASON: Record<PasswordForm, string> = {
  set: "为了确认是你本人，先收一封验证码。验证好了回到「我的资料」设密码。",
  change: "为了确认是你本人，先收一封验证码。验证好了回到「我的资料」改密码，不用输现在的密码。",
  remove: "为了确认是你本人，先收一封验证码。验证好了回到「我的资料」取消密码。",
};

type Status = { setAt: number | null; email: string | null; freshUntil: number };

/** A minute short of the server's own reckoning, so a form opened just before it runs out still goes through */
const MARGIN_MS = 60_000;
const fresh = (s: Status) => s.freshUntil > Date.now() + MARGIN_MS;

function dateText(at: number) {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("zh-CN", sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

/**
 * 登录密码 in 我的资料: whether there is one and since when, and setting, changing or taking it away. The first
 * one, or one forgotten, takes a sign-in by code moments before: onConfirmByCode asks for one, and the sheet
 * comes back with startOpen set to what the player was doing.
 */
export default function PasswordBox({
  startOpen,
  onConfirmByCode,
}: {
  startOpen?: PasswordForm;
  onConfirmByCode: (email: string, form: PasswordForm) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<PasswordForm | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    passwordStatus().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        // back from confirming by code: straight on with what the player was doing
        if (startOpen && fresh(s)) {
          setForm(startOpen === "set" && s.setAt ? "change" : startOpen !== "set" && !s.setAt ? null : startOpen);
          setSaid("验证好了，确认是你本人。");
          box.current?.scrollIntoView({ block: "center" });
        }
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [startOpen]);

  const open = (f: PasswordForm) => {
    if (!status) return;
    setError(null);
    setSaid(null);
    setCurrent("");
    setNext("");
    if (!status.email) return setError("这个账号没有邮箱，设不了密码。");
    // the first one takes a sign-in by code moments ago; a change or taking it away takes the current one instead
    if (f === "set" && !fresh(status)) return onConfirmByCode(status.email, "set");
    setForm(f);
  };

  const confirmByCode = () => status?.email && form && onConfirmByCode(status.email, form);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!status || !form) return;
    const byCode = fresh(status);
    setBusy(true);
    setError(null);
    try {
      if (form === "remove") {
        await removePassword(byCode ? "" : current);
        keepLoginWith("code");
        setSaid("密码取消了。以后换设备，用验证码或登录码登录。");
      } else {
        const r = await savePassword(next, byCode ? undefined : current);
        // the sign-in by code grew too old meanwhile
        if ("needsCode" in r) return onConfirmByCode(status.email!, form);
        keepLoginWith("password");
        setSaid(
          r.changed
            ? "密码改好了。其他手机和电脑上的登录都退出了，那边要用新密码重新登录。"
            : "密码设好了。换手机或电脑时，用邮箱和这个密码就能登录。",
        );
      }
      setForm(null);
      setCurrent("");
      setNext("");
      setStatus(await passwordStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // the server may have stopped counting this a sign-in by code moments ago: ask for the current one then
      passwordStatus().then(setStatus, () => {});
    } finally {
      setBusy(false);
    }
  };

  const byCode = status ? fresh(status) : false;
  const problem = next ? passwordProblem(next, status?.email ?? "") : null;
  const ready = form === "remove" ? byCode || Boolean(current) : Boolean(next) && !problem && (byCode || form === "set" || Boolean(current));

  return (
    <div ref={box}>
      <div className="list-row">
        <div>
          <strong>{status === null ? "…" : status.setAt ? `${dateText(status.setAt)}设的` : "没设"}</strong>
          <p className="muted">设了密码，换手机或电脑时用邮箱和密码就能登录，不用等验证码邮件。</p>
        </div>
        {status && !form && (
          <div className="row-actions">
            {status.setAt ? (
              <>
                <button className="pill" onClick={() => open("change")}>
                  改密码
                </button>
                <button className="pill" onClick={() => open("remove")}>
                  取消密码
                </button>
              </>
            ) : (
              <button className="pill" onClick={() => open("set")}>
                设密码
              </button>
            )}
          </div>
        )}
      </div>
      {form && status?.email && (
        <form className="login pw-form" onSubmit={submit}>
          <HiddenUsername email={status.email} />
          {form !== "set" && !byCode && (
            <PasswordField label="现在的密码" autoComplete="current-password" value={current} onChange={setCurrent} />
          )}
          {form !== "remove" && (
            <div>
              <PasswordField
                label={form === "set" ? "密码" : "新密码"}
                autoComplete="new-password"
                placeholder="至少 8 个字符"
                value={next}
                onChange={setNext}
              />
              <p className="hint" style={problem ? { color: "#b42318" } : undefined}>
                {problem ??
                  (form === "change"
                    ? "改了以后，其他手机和电脑上的登录都会退出，要用新密码重新登录。"
                    : "8 个字符以上就行，不用非得有大小写和符号；别用生日、QQ 号这种别人猜得到的。")}
              </p>
            </div>
          )}
          {form === "remove" && <p className="hint" style={{ marginTop: 0 }}>取消以后，换设备时用验证码或登录码登录。</p>}
          {form !== "set" && byCode && <p className="hint" style={{ marginTop: 0 }}>刚用验证码确认过是你，不用输现在的密码。</p>}
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button className={form === "remove" ? "pill danger-pill" : "pill dark"} disabled={busy || !ready}>
              {busy ? "稍等…" : form === "set" ? "设好了" : form === "change" ? "改好了" : "取消密码"}
            </button>
            <button type="button" className="pill" disabled={busy} onClick={() => setForm(null)}>
              算了
            </button>
            {form !== "set" && !byCode && (
              <button type="button" className="link" disabled={busy} onClick={confirmByCode}>
                忘了现在的密码？
              </button>
            )}
          </div>
        </form>
      )}
      {said && <p className="hint">{said}</p>}
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
