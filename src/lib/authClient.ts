/** Browser side of email sign-in (src/app/api/auth). Errors carry a message to show as is. */

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("连不上服务器，检查一下网络再试。");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? "服务器出了点问题，稍后再试试。");
  return json as T;
}

/** devMailboxPort is set when codes go to a local test inbox (development). */
export const requestCode = (email: string) =>
  post<{ ok: true; devMailboxPort: string | null }>("/api/auth/request-code", { email });

/** "signup" means the email is new and still needs the age check and consent. */
export const verifyCode = (email: string, code: string) =>
  post<{ status: "ok" | "signup" }>("/api/auth/verify", { email, code });

export const finishSignup = (birthYear: number, birthMonth: number, acceptPolicy: boolean) =>
  post<{ status: "ok" }>("/api/auth/signup", { birthYear, birthMonth, acceptPolicy });

export const signOut = () => post<{ ok: true }>("/api/auth/logout");

export const deleteAccount = () => post<{ ok: true }>("/api/auth/delete");
