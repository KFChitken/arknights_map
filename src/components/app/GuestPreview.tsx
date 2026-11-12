"use client";

import { fmt, T } from "@/i18n";
import { roughText } from "@/lib/counts";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM, siteName } from "@/lib/rules";
import Sheet from "./Sheet";

/**
 * What a visitor who has not signed in can try: tap the map to see where their roach would go and
 * about how many are around. They get nobody's roaches (their map is 全员隐匿), so the server counts,
 * from the spot to about a kilometre (src/app/api/around), and keeps nothing of it.
 */

/** Counts rounded down by the server (counts.ts rough), in words */
function aroundText({ near, far }: { near: number; far: number }) {
  if (far === 0) return T.guest.empty;
  const close = near ? fmt(T.guest.near, { km: DECLARATION_RADIUS_KM, count: roughText(near) }) : fmt(T.guest.nearNone, { km: DECLARATION_RADIUS_KM });
  return fmt(T.guest.far, { close, km: RADAR_RADIUS_KM, count: roughText(far) });
}

export function PreviewCard({
  around,
  onPlace,
  onClose,
}: {
  /** null while the server counts; failed: it could not */
  around: { near: number; far: number } | "failed" | null;
  onPlace: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card stack" role="dialog" aria-label={T.guest.placeHere}>
      <div className="card-head">
        <div>
          <strong>{T.guest.ifHere}</strong>
          <p className="muted">{around === "failed" ? T.guest.countFailed : around ? aroundText(around) : T.guest.counting}</p>
        </div>
      </div>
      <button className="primary wide" onClick={onPlace}>
        {T.guest.place}
      </button>
      <p className="hint" style={{ margin: 0 }}>
        {T.guest.elsewhere}
      </p>
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

export function GuestRadarSheet({ onSignIn, onClose }: { onSignIn: () => void; onClose: () => void }) {
  return (
    <Sheet title={T.map.radar} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{T.guest.radarHint}</p>
      <p className="hint">{T.guest.radarSignIn}</p>
      <button className="primary wide" style={{ marginTop: 14 }} onClick={onSignIn}>
        {T.common.signIn}
      </button>
    </Sheet>
  );
}

export function WelcomeSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title={fmt(T.guest.welcome, { site: siteName() })}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          {T.guest.toMap}
        </button>
      }
    >
      <p style={{ marginTop: 0 }}>{T.guest.intro.doubt}</p>
      <p>{T.guest.intro.disguise}</p>
      <p>{T.guest.intro.how}</p>
    </Sheet>
  );
}

const WELCOMED = "zhoup.welcomed";

/** Whether this browser has seen the welcome card; unreadable storage counts as not seen. */
export function welcomed() {
  try {
    return localStorage.getItem(WELCOMED) === "1";
  } catch {
    return false;
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(WELCOMED, "1");
  } catch {}
}
