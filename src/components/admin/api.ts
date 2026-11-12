import { isGateCode, type GateCode } from "@/lib/adminConsole";

/**
 * Calls to the 管理台's endpoints (src/app/api/admin/[op]), from the 管理台 and from the map's 站长 tools. A
 * refusal comes back as an AdminError with the server's words, and its code when the door is shut
 * (ADMIN_LOCKED, ADMIN_SETUP, ADMIN_PAUSED) or wants a code again (ADMIN_FRESH), or the code was wrong.
 */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** The door is shut on this device: the 管理台 shows its door again, the map says to go there first */
  get gate(): GateCode | null {
    return isGateCode(this.code) && this.code !== "ADMIN_FRESH" ? this.code : null;
  }
}

/** What an error says, for a line on the page */
export const errorWords = (e: unknown) => (e instanceof Error && e.message ? e.message : "出了点问题，稍后再试试。");

export type CallOptions = {
  /** A code from the authenticator for the heaviest steps (requireFresh) */
  fresh?: string;
  /** Sent as the page goes away: the browser finishes it even after the page is gone */
  keepalive?: boolean;
};

export async function adminCall<T>(op: string, args: unknown[] = [], opts: CallOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args, ...(opts.fresh ? { fresh: opts.fresh } : {}) }),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new AdminError("连不上服务器，看看网络再试一次。", 0);
  }
  const body = (await res.json().catch(() => null)) as ({ result?: T; error?: string; code?: string } & Record<string, unknown>) | null;
  if (!res.ok) {
    const { error, code, ...extra } = body ?? {};
    throw new AdminError(error || "服务器出了点问题，稍后再试试。", res.status, typeof code === "string" ? code : null, extra);
  }
  return body?.result as T;
}
