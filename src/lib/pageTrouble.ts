import { troubleLine } from "./troubleLine";

/**
 * Tell the server a page broke (app/error.tsx) or could not draw its map with the graphics card (MapApp,
 * src/lib/webgl.ts), through POST /api/health/page, so the site's own checks see what never reached it before
 * (2026-11-15: pages black on every visit were known only from players). Only which of the three, and:
 * - crash: one line of what the browser said (troubleLine);
 * - nogl: start when the page found it could not draw at all, map when a map then failed to start anyway;
 * - lost: the maps the page had up, as "tencent+overseas".
 * Nothing about the visitor; once each per page.
 */
export type PageTrouble = "crash" | "nogl" | "lost";

const told = new Set<PageTrouble>();

export function reportPageTrouble(what: PageTrouble, detail = "") {
  if (told.has(what)) return;
  told.add(what);
  try {
    void fetch("/api/health/page", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ what, detail: troubleLine(detail) }),
    }).catch(() => {});
  } catch {
    // reporting is best effort
  }
}
