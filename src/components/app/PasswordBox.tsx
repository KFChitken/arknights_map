"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fmt, T } from "@/i18n";
import { passwordStatus, removePassword, savePassword } from "@/lib/authClient";
import { passwordProblem } from "@/lib/passwordRules";
import { keepLoginWith, serviceName } from "./LoginSheet";
import PasswordField, { HiddenUsername } from "./PasswordField";

/** What the player set out to do with their password */
export type PasswordForm = "set" | "change" | "remove";

/** Said on the sign-in by code that confirms it is the player, for each */
export const CONFIRM_REASON: Record<PasswordForm, string> = {
  get set() {
    return T.password.confirmReason.set;
  },
  get change() {
    return T.password.confirmReason.change;
  },
  get remove() {
    return T.password.confirmReason.remove;
  },
};

/** noCodeNeeded: the first password goes without a sign-in by code, as codes to the player's mail service may not arrive just now */
type Status = { setAt: number | null; email: string | null; freshUntil: number; noCodeNeeded: boolean };

/** A minute short of the server's own reckoning, so a form opened just before it runs out still goes through */
const MARGIN_MS = 60_000;
const fresh = (s: Status) => s.freshUntil > Date.now() + MARGIN_MS;
/** The first password, set now without a sign-in by code first */
const withoutCode = (s: Status) => !s.setAt && s.noCodeNeeded && !fresh(s);

function dateText(at: number) {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("zh-CN", sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

/**
 * 登录密码 in 我的资料: whether there is one and since when, and setting, changing or taking it away. The first
 * one, or one forgotten, takes a sign-in by code moments before: onConfirmByCode asks for one, and the sheet
 * comes back with startOpen set to what the player was doing. Where the first goes without a code
 * (noCodeNeeded), 设密码 opens its form at once, and so does startOpen "set" (from the map's 去设密码).
 */
export default function PasswordBox({
  startOpen,
  onConfirmByCode,
  onSet,
}: {
  startOpen?: PasswordForm;
  onConfirmByCode: (email: string, form: PasswordForm) => void;
  /** The player has a password now, set or changed here */
  onSet?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState<PasswordForm | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // brought into view once the form opened for startOpen is drawn, its buttons with it
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    if (reveal) box.current?.scrollIntoView({ block: "center" });
  }, [reveal]);

  useEffect(() => {
    let live = true;
    passwordStatus().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        if (startOpen === "set" && !s.setAt && s.noCodeNeeded) {
          // 去设密码 on the map (such a player is never sent for a code to set the first one): its form, at once
          setForm("set");
          setReveal(true);
        } else if (startOpen && fresh(s)) {
          // back from confirming by code: straight on with what the player was doing
          setForm(startOpen === "set" && s.setAt ? "change" : startOpen !== "set" && !s.setAt ? null : startOpen);
          setSaid(T.password.confirmed);
          setReveal(true);
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
    if (!status.email) return setError(T.password.noEmail);
    // the first one takes a sign-in by code moments ago, unless codes may not reach the player just now;
    // a change or taking it away takes the current one instead
    if (f === "set" && !fresh(status) && !withoutCode(status)) return onConfirmByCode(status.email, "set");
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
        setSaid(T.password.removed);
      } else {
        const r = await savePassword(next, byCode ? undefined : current);
        // the sign-in by code grew too old meanwhile
        if ("needsCode" in r) return onConfirmByCode(status.email!, form);
        keepLoginWith("password");
        onSet?.();
        setSaid(
          r.changed
            ? T.password.changed
            : T.password.wasSet,
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
          <strong>{status === null ? "…" : status.setAt ? fmt(T.password.setOn, { date: dateText(status.setAt) }) : T.password.notSet}</strong>
          <p className="muted">{T.password.about}</p>
        </div>
        {status && !form && (
          <div className="row-actions">
            {status.setAt ? (
              <>
                <button className="pill" onClick={() => open("change")}>
                  {T.password.change}
                </button>
                <button className="pill" onClick={() => open("remove")}>
                  {T.password.remove}
                </button>
              </>
            ) : (
              <button className="pill" onClick={() => open("set")}>
                {T.password.set}
              </button>
            )}
          </div>
        )}
      </div>
      {form && status?.email && (
        <form className="login pw-form" onSubmit={submit}>
          {form === "set" && withoutCode(status) && (
            <p className="hint" style={{ marginTop: 0 }}>
              {fmt(T.password.noCodeNeeded, { service: serviceName(status.email.slice(status.email.lastIndexOf("@") + 1).toLowerCase()) })}
            </p>
          )}
          <HiddenUsername email={status.email} />
          {form !== "set" && !byCode && (
            <PasswordField label={T.password.current} autoComplete="current-password" value={current} onChange={setCurrent} />
          )}
          {form !== "remove" && (
            <div>
              <PasswordField
                label={form === "set" ? T.password.label : T.password.new}
                autoComplete="new-password"
                placeholder={T.password.minLength}
                value={next}
                onChange={setNext}
              />
              <p className="hint" style={problem ? { color: "#b42318" } : undefined}>
                {problem ??
                  (form === "change"
                    ? T.password.changeNote
                    : T.password.rules)}
              </p>
            </div>
          )}
          {form === "remove" && <p className="hint" style={{ marginTop: 0 }}>{T.password.removeNote}</p>}
          {form !== "set" && byCode && <p className="hint" style={{ marginTop: 0 }}>{T.password.noCurrentNeeded}</p>}
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button className={form === "remove" ? "pill danger-pill" : "pill dark"} disabled={busy || !ready}>
              {busy ? T.common.wait : form === "set" ? T.password.done : form === "change" ? T.password.changeDone : T.password.remove}
            </button>
            <button type="button" className="pill" disabled={busy} onClick={() => setForm(null)}>
              {T.common.neverMind}
            </button>
            {form !== "set" && !byCode && (
              <button type="button" className="link" disabled={busy} onClick={confirmByCode}>
                {T.password.forgot}
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
