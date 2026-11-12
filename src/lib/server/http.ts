import { NextResponse, type NextRequest } from "next/server";
import type { Lang } from "@/i18n";
import { ENGLISH_ON, LANG_COOKIE, pickLang } from "@/i18n/lang";
import { withLang } from "@/i18n/server";
import { WorldError } from "../world/types";
import { SESSION_COOKIE } from "./auth";
import { inMainland } from "./region";
import { errorCode, note } from "./signals";

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
 * Wrap a route handler: answers in the request's language (src/i18n: everything the
 * handler says through T, its errors included), rejects cross-site writes, turns
 * HttpError and WorldError into { error } and hides anything unexpected behind a
 * generic message.
 */
export function route<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return (req: NextRequest, ctx: C) =>
    withLang(requestLang(req), async () => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD") checkOrigin(req);
        return await fn(req, ctx);
      } catch (e) {
        if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
        if (e instanceof WorldError) return NextResponse.json({ error: e.message }, { status: 400 });
        console.error(e);
        note("error", `${req.nextUrl.pathname} ${errorCode(e)}`);
        return NextResponse.json({ error: "服务器出了点问题，稍后再试试。" }, { status: 500 });
      }
    });
}

/**
 * The language an API request is answered in (src/i18n/lang.ts): Chinese while English is
 * not offered, without reading the request.
 */
export function requestLang(req: NextRequest): Lang {
  if (!ENGLISH_ON) return "zh";
  return pickLang({
    cookie: req.cookies.get(LANG_COOKIE)?.value,
    acceptLanguage: req.headers.get("accept-language"),
    signedIn: req.cookies.has(SESSION_COOKIE),
    mainland: inMainland(clientIp(req)),
  });
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
  return ipFrom(req.headers);
}

/** clientIp for a page, which has the request's headers but no request. */
export function ipFrom(headers: Headers) {
  const hops = headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) || "local";
}
