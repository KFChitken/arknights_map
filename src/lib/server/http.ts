import { NextResponse, type NextRequest } from "next/server";
import { type Lang, T } from "@/i18n";
import { LANG_HEADER, langOfMark } from "@/i18n/lang";
import { englishOn, withLang } from "@/i18n/server";
import { WorldError } from "../world/types";
import { errorCode, logError, note } from "./signals";

/**
 * An error whose message is safe to show to the player. A page that must tell one refusal from
 * another goes by its code, never by its words, which are in the player's language; extra (e.g.
 * until when) goes along beside them, as the 管理台's door sends it (src/lib/adminConsole.ts GATE_CODES).
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Wrap a route handler: answers in the request's language (src/i18n: everything the
 * handler says through T, its errors included), rejects cross-site writes, turns
 * HttpError and WorldError into { error } (with the HttpError's code and extra) and hides
 * anything unexpected behind a generic message. headers go on every response, the errors too.
 */
export function route<C>(fn: (req: NextRequest, ctx: C) => Promise<Response>, opts: { headers?: Record<string, string> } = {}) {
  const withHeaders = (res: Response) => {
    for (const [k, v] of Object.entries(opts.headers ?? {})) res.headers.set(k, v);
    return res;
  };
  return (req: NextRequest, ctx: C) =>
    withLang(requestLang(req), async () => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD") checkOrigin(req);
        return withHeaders(await fn(req, ctx));
      } catch (e) {
        if (e instanceof HttpError) {
          const body = { ...e.extra, error: e.message, ...(e.code ? { code: e.code } : {}) };
          return withHeaders(NextResponse.json(body, { status: e.status }));
        }
        if (e instanceof WorldError) return withHeaders(NextResponse.json({ error: e.message }, { status: 400 }));
        logError(`${req.method} ${req.nextUrl.pathname}`, e);
        note("error", `${req.nextUrl.pathname} ${errorCode(e)}`);
        return withHeaders(NextResponse.json({ error: T.server.common.serverTrouble }, { status: 500 }));
      }
    });
}

/** A handler that does not go through route(), answering in the request's language all the same */
export function inLang<A extends unknown[]>(fn: (req: NextRequest, ...rest: A) => Promise<Response>) {
  return (req: NextRequest, ...rest: A) => withLang(requestLang(req), () => fn(req, ...rest));
}

/**
 * The language an API request is answered in (src/i18n/lang.ts): English when the English
 * site's page asking says so, else Chinese. The 管理台 never says so.
 */
export function requestLang(req: Request): Lang {
  return englishOn() ? langOfMark(req.headers.get(LANG_HEADER)) : "zh";
}

// Cookies are SameSite=Lax, and this blocks the rest: a write must come from our own page
function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = Boolean(origin && host && new URL(origin).host === host);
  } catch {}
  if (!ok) throw new HttpError(403, T.server.http.wrongOrigin);
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, T.server.common.badRequest);
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
