/**
 * Tell the server a map could not load on this page (POST /api/health/map), so the site's own
 * checks notice when a map service fails for many visitors, such as 高德 running out of its
 * daily quota. Only which map, what went wrong and the service's own short code; once per kind
 * per page. tencent is 腾讯's map (TencentView), but tencent:search 腾讯位置服务 turning away the place
 * suggestions' key.
 */
export type MapKind = "amap" | "osm" | "overseas" | "tencent";
export type MapTrouble = "load" | "key" | "slow" | "style" | "tiles" | "search";

const told = new Set<string>();

export function reportMapTrouble(map: MapKind, what: MapTrouble, detail = "") {
  const key = `${map}:${what}`;
  if (told.has(key)) return;
  told.add(key);
  try {
    void fetch("/api/health/map", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ map, what, detail: detail.slice(0, 40) }),
    }).catch(() => {});
  } catch {
    // reporting is best effort
  }
}

/**
 * 高德 says a key is wrong or used up only in the console (「<AMap JSAPI> KEY异常，错误信息：
 * USER_DAILY_QUERY_OVER_LIMIT」): pass that on while its map is shown, and to onKeyTrouble with
 * 高德's code. Returns the undo.
 */
/** 高德's codes for a key it will not serve, as they appear in its console messages */
const AMAP_KEY_CODES =
  /\b(USER_DAILY_QUERY_OVER_LIMIT|DAILY_QUERY_OVER_LIMIT|QUOTA_PLAN_RUN_OUT|CUQPS_HAS_EXCEEDED_THE_LIMIT|ACCESS_TOO_FREQUENT|INVALID_USER_KEY|INVALID_USER_SCODE|INVALID_USER_DOMAIN|USERKEY_PLAT_NOMATCH|INSUFFICIENT_PRIVILEGES|USER_KEY_RECYCLED|SERVICE_NOT_AVAILABLE)\b/;

export function listenToAmapConsole(onKeyTrouble?: (code: string) => void): () => void {
  const c = console as unknown as Record<"error" | "warn", (...args: unknown[]) => void>;
  const before = { error: c.error, warn: c.warn };
  for (const level of ["error", "warn"] as const) {
    const original = before[level];
    c[level] = (...args: unknown[]) => {
      try {
        const text = args.map(String).join(" ");
        // used up (…LIMIT, QUOTA_PLAN_RUN_OUT), too many a second (ACCESS_TOO_FREQUENT, CUQPS_…LIMIT), a wrong or stopped key
        // (INVALID…, INSUFFICIENT_PRIVILEGES, USER_KEY_RECYCLED), or the service down (SERVICE_NOT_AVAILABLE);
        // 「KEY异常，错误信息：…」 from the loader, 「FlyDataAuthTask error: …」 from the map itself
        const known = text.match(AMAP_KEY_CODES)?.[0];
        const refused = Boolean(known) || text.includes("KEY异常");
        if (refused || /AMap[\s\S]*(LIMIT|INVALID|NOMATCH|TOO_FREQUENT|PRIVILEGES|RECYCLED|NOT_AVAILABLE)/.test(text)) {
          const code = known ?? text.match(/[A-Z][A-Z_]{5,}/)?.[0] ?? "";
          reportMapTrouble("amap", "key", code);
          // only a plain refusal of the key, and not inside 高德's own call
          if (refused && onKeyTrouble) window.setTimeout(() => onKeyTrouble(code), 0);
        }
      } catch {
        // never in the way of the message itself
      }
      original.apply(console, args);
    };
  }
  return () => {
    c.error = before.error;
    c.warn = before.warn;
  };
}
