/**
 * Tell the server a map could not load on this page (POST /api/health/map), so the site's own
 * checks notice when a map service fails for many visitors, such as 高德 running out of its
 * daily quota. Only which map, what went wrong and the service's own short code; once per kind
 * per page. tencent:search is 腾讯位置服务 turning away the place suggestions' key.
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
 * USER_DAILY_QUERY_OVER_LIMIT」): pass that on while its map is shown. Returns the undo.
 */
export function listenToAmapConsole(): () => void {
  const c = console as unknown as Record<"error" | "warn", (...args: unknown[]) => void>;
  const before = { error: c.error, warn: c.warn };
  for (const level of ["error", "warn"] as const) {
    const original = before[level];
    c[level] = (...args: unknown[]) => {
      try {
        const text = args.map(String).join(" ");
        if (text.includes("KEY异常") || /AMap[\s\S]*(LIMIT|INVALID|NOMATCH)/.test(text)) {
          reportMapTrouble("amap", "key", text.match(/[A-Z][A-Z_]{5,}/)?.[0] ?? "");
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
