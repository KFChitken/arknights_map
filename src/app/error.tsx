"use client";

import { useEffect } from "react";
import { fmt, T } from "@/i18n";

/**
 * What a page shows when its code breaks as it draws, in place of Next.js's own line, which is dark grey on the
 * site's dark ground (globals.css) and so read as a black screen (2026-11-15): what to do, and what the browser
 * said, for a screenshot. Nothing is sent anywhere.
 */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const detail = [error.name, error.message].filter(Boolean).join(": ").slice(0, 300);
  return (
    <main className="page-error" role="alert">
      <div className="trouble-box">
        <strong>{T.common.crash.title}</strong>
        <p>{T.common.crash.text}</p>
        {/* a fresh start, not React's reset: whatever broke it is still there in this page */}
        <button className="pill dark" onClick={() => window.location.reload()}>
          {T.common.crash.reload}
        </button>
        {detail && <p className="trouble-detail">{fmt(T.common.crash.detail, { detail })}</p>}
      </div>
    </main>
  );
}
