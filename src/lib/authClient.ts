/** Browser side of email sign-in (src/app/api/auth). Errors carry a message to show as is. */

import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? T.requests.serverTrouble);
  return json as T;
}

/** devMailboxPort is set when codes go to a local test inbox (development). */
export const requestCode = (email: string) =>
  // again: the code already sent, still working, sent once more; expiresAt: when it stops working;
  // waitS: seconds before another may be asked for; slow: the address's mail service is slow to take our mail just now
  post<{ ok: true; again: boolean; expiresAt: number; waitS: number; slow: boolean; devMailboxPort: string | null }>("/api/auth/request-code", {
    email,
  });

/** 退出其他设备: the other phones' and computers' sign-ins end; ended: how many */
export const logoutOthers = () => post<{ ok: true; ended: number }>("/api/auth/logout-others", {});

/** "signup" means the email is new and still needs its ticks (src/lib/consent.ts); hasPassword: a known player has one */
export const verifyCode = (email: string, code: string) =>
  post<{ status: "ok" | "signup"; hasPassword?: boolean }>("/api/auth/verify", { email, code });

/** password: one to sign in with from now on, if given (src/lib/passwordRules.ts) */
export const finishSignup = (ticks: { adult: boolean; acceptPolicy: boolean; acceptCrossBorder: boolean; password?: string }) =>
  post<{ status: "ok" }>("/api/auth/signup", ticks);

/** 密码登录 (src/lib/server/passwords.ts) */
export const passwordLogin = (email: string, password: string) => post<{ status: "ok" }>("/api/auth/password-login", { email, password });

/**
 * When the signed-in player set their password (null: none), their email, until when (on this device's
 * clock) this sign-in counts as one by code moments ago, when no current password is asked for (0: not),
 * and whether the first password goes without that code (noCodeNeeded: codes to their mail service may not
 * arrive just now)
 */
export async function passwordStatus(): Promise<{ setAt: number | null; email: string | null; freshUntil: number; noCodeNeeded: boolean }> {
  let res: Response;
  try {
    res = await apiFetch("/api/auth/password", { cache: "no-store" });
  } catch {
    throw new Error(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as {
    setAt: number | null;
    email: string | null;
    freshForMs: number;
    noCodeNeeded?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !json) throw new Error(json?.error ?? T.requests.serverTrouble);
  return {
    setAt: json.setAt,
    email: json.email,
    freshUntil: json.freshForMs > 0 ? Date.now() + json.freshForMs : 0,
    noCodeNeeded: json.noCodeNeeded === true,
  };
}

/**
 * Set the password, or change it (current: the one now). needsCode: the server wants a sign-in by code
 * moments ago first, to be sure it is the player themself.
 */
export async function savePassword(password: string, current?: string): Promise<{ changed: boolean } | { needsCode: true }> {
  let res: Response;
  try {
    res = await apiFetch("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, current }),
    });
  } catch {
    throw new Error(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { changed?: boolean; needsCode?: boolean; error?: string } | null;
  if (res.status === 403 && json?.needsCode) return { needsCode: true };
  if (!res.ok) throw new Error(json?.error ?? T.requests.serverTrouble);
  return { changed: Boolean(json?.changed) };
}

/** 取消密码: with the current one, or none after a sign-in by code moments ago */
export const removePassword = (current: string) => post<{ ok: true }>("/api/auth/password/remove", { current });

/** 隐私说明更新了: an older account agrees again. */
export const reconsent = (ticks: { adult: boolean; acceptCrossBorder: boolean; acceptPublicPlace: boolean }) =>
  post<{ ok: true }>("/api/auth/reconsent", ticks);

/** 拿登录码 (src/lib/deskCode.ts): ABCD-EFGH, and when it stops working */
export const takeDeskCode = () => post<{ code: string; expiresAt: number }>("/api/auth/desk-code");

/** Sign in with a 登录码 taken on a device already signed in */
export const redeemDeskCode = (code: string) => post<{ status: "ok" }>("/api/auth/desk-code/redeem", { code });

export const signOut = () => post<{ ok: true }>("/api/auth/logout");

export const deleteAccount = () => post<{ ok: true }>("/api/auth/delete");
