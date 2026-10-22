import { NextResponse, type NextRequest } from "next/server";
import { WorldError } from "../world/types";

/** An error whose message is safe to show to the player. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Wrap a route handler: rejects cross-site writes, turns HttpError and
 * WorldError into { error } and hides anything unexpected behind a generic message.
 */
export function route<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") checkOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof WorldError) return NextResponse.json({ error: e.message }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "服务器出了点问题，稍后再试试。" }, { status: 500 });
    }
  };
}

// Cookies are SameSite=Lax, and this blocks the rest: a write must come from our own page
function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = Boolean(origin && host && new URL(origin).host === host);
  } catch {}
  if (!ok) throw new HttpError(403, "请求来源不对，请刷新页面再试。");
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "请求格式不对。");
}

/**
 * The address that reached our own reverse proxy. The proxy appends it to
 * X-Forwarded-For, and Next.js fills in the socket address when the header is
 * missing; anything further left came from the client and can be made up.
 * In production the app must be reachable only through that one proxy.
 */
export function clientIp(req: NextRequest) {
  const hops = req.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) || "local";
}
