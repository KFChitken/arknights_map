"use client";

import { useState } from "react";
import { fmtParts, T } from "@/i18n";
import { adultTick, crossBorderTick, publicPlaceNote, publicPlaceTick } from "@/lib/consent";
import { MIN_SIGNUP_AGE, SITE_NAME } from "@/lib/rules";
import Sheet from "./Sheet";

/** What changed in the privacy policy this time (POLICY_UPDATED_AT); the next change replaces it. Read when shown. */
const changes = () => [
  T.consent.update.changeModerators,
  T.consent.update.changeAdminLog,
  T.consent.update.changeReportMap,
];

/**
 * 隐私说明更新了: an account that agreed to an older policy ticks what new players
 * tick at sign-up, or signs out. Closing it is allowed; whatever needs agreeing
 * brings it back.
 */
export default function ConsentSheet({
  onAgree,
  onSignOut,
  onDelete,
  onClose,
}: {
  onAgree: (ticks: { adult: boolean; acceptCrossBorder: boolean; acceptPublicPlace: boolean }) => Promise<void>;
  onSignOut: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [adult, setAdult] = useState(false);
  const [abroad, setAbroad] = useState(false);
  const [place, setPlace] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [busy, setBusy] = useState(false);

  if (underage) {
    return (
      <Sheet title={T.consent.update.title} onClose={onClose}>
        <p className="consent-sorry">
          {fmtParts(T.consent.update.sorry, { site: SITE_NAME, age: MIN_SIGNUP_AGE })}
        </p>
        <div className="consent-actions">
          <button className="danger wide" onClick={onDelete}>
            {T.common.deleteAccount}
          </button>
          <button className="pill" onClick={() => setUnderage(false)}>
            {T.common.back}
          </button>
        </div>
      </Sheet>
    );
  }

  const agree = async () => {
    setBusy(true);
    try {
      await onAgree({ adult, acceptCrossBorder: abroad, acceptPublicPlace: place });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={T.consent.update.title} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        {T.consent.update.changes}
      </p>
      <ol className="consent-changes">
        {changes().map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <a className="consent-full" href="/privacy" target="_blank" rel="noreferrer">
        {T.consent.update.full}
      </a>
      <div className="ticks">
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>{adultTick()}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={abroad} onChange={(e) => setAbroad(e.target.checked)} />
          <span>
            {crossBorderTick()}{" "}
            <a href="/privacy#abroad" target="_blank" rel="noreferrer">
              {T.common.details}
            </a>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} />
          <span>{publicPlaceTick()}</span>
        </label>
      </div>
      <p className="hint">{publicPlaceNote()}</p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy || !adult || !abroad || !place} onClick={agree}>
          {busy ? T.common.saving : T.consent.update.agree}
        </button>
        <button className="pill" onClick={onSignOut}>
          {T.consent.update.signOut}
        </button>
        <button className="link" onClick={() => setUnderage(true)}>
          {fmtParts(T.consent.update.underage, { age: MIN_SIGNUP_AGE })}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Asked before a roach goes down: before the first one, whether the player agrees
 * its spot is public; after signing in from a spot picked as a visitor, whether to put it there.
 */
export function PlaceConfirm({ consent, onConfirm, onRethink }: { consent: boolean; onConfirm: () => void; onRethink: () => void }) {
  return (
    <Sheet title={consent ? T.consent.place.before : T.consent.place.title} onClose={onRethink}>
      <p className="consent-place">{consent ? publicPlaceNote() : T.consent.place.ask}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onConfirm}>
          {T.common.confirm}
        </button>
        <button className="pill" onClick={onRethink}>
          {T.consent.place.rethink}
        </button>
      </div>
    </Sheet>
  );
}
