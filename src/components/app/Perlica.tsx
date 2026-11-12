"use client";

import { useRef } from "react";
import { fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { PERLICA, PERLICA_LINES, PERLICA_NAME, spotNear } from "@/lib/perlica";
import { SITE_NAME } from "@/lib/rules";
import type { LngLat } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/** 佩丽卡监督 (src/lib/perlica.ts) on the page: her picture, her question, her report along the top, and where she stands. */

export const PerlicaPicture = ({ size, friend = false }: { size: number; friend?: boolean }) => (
  <RoachIcon color={PERLICA.color} size={size} avatar={PERLICA.avatar} friend={friend} />
);

/**
 * The first time she shows up: may she keep the time? Yes starts her 离开计时;
 * 先不用, or closing the card, leaves it off. Either way she never asks again.
 */
export function PerlicaIntroSheet({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <Sheet title={PERLICA_NAME} onClose={onNo}>
      <div className="amiya-greet">
        <PerlicaPicture size={96} />
      </div>
      <p className="consent-place">{T.guides.perlica.arrived}</p>
      <p className="amiya-line perlica-ask">{PERLICA_LINES.ask}</p>
      <p className="hint">
        {fmtParts(T.guides.perlica.intro, { site: SITE_NAME })}
        <a href="/privacy" target="_blank" rel="noreferrer">
          {T.common.privacy}
        </a>
      </p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onYes}>
          {T.guides.perlica.yes}
        </button>
        <button className="pill" onClick={onNo}>
          {T.guides.perlica.no}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * A note of hers along the top of the map, a line or two: how long the player was
 * away and the weight of it, how long they slept, the day they became 触须之交 again,
 * her weekly report, or 「罗德岛那位……」. It never stops the map being used, goes by
 * itself after a few seconds (the page times it), and can be closed or swiped away;
 * tapping it goes to her.
 */
export function PerlicaBanner({ lines, onOpen, onClose }: { lines: string[]; onOpen: () => void; onClose: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="perlica-banner"
      role="status"
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        // swiped up or sideways
        if (t.clientY - s.y < -24 || Math.abs(t.clientX - s.x) > 48) onClose();
      }}
    >
      <button className="perlica-banner-body" onClick={onOpen}>
        <PerlicaPicture size={36} />
        <span>
          {fmtNodes(T.guides.perlica.says, {
            name: PERLICA_NAME,
            first: lines[0],
            rest: lines.slice(1).map((l) => (
              <span key={l}>
                <br />
                {l}
              </span>
            )),
          })}
        </span>
      </button>
      <button className="close" aria-label={T.common.close} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

// ---- where she stands, kept in this browser only ----

/** Back after this long, she stands somewhere new */
const RESPOT_MS = 10 * 60_000;

/** The two numbers her spot comes from, the main roach it is around, and when the page was last looked at */
type Spot = { u: number; v: number; lng: number; lat: number; at: number };

const spotKey = (userId: string) => `zhoup.perlica.${userId}`;
// kept here too, so she stays put on this page even where the browser keeps nothing
const remembered = new Map<string, Spot>();

function readSpot(userId: string): Spot | null {
  try {
    const s = JSON.parse(localStorage.getItem(spotKey(userId)) ?? "null") as Spot | null;
    if (s && [s.u, s.v, s.lng, s.lat, s.at].every((n) => typeof n === "number" && Number.isFinite(n))) return s;
  } catch {}
  return remembered.get(userId) ?? null;
}

function writeSpot(userId: string, s: Spot) {
  remembered.set(userId, s);
  try {
    localStorage.setItem(spotKey(userId), JSON.stringify(s));
  } catch {}
}

/**
 * Where she stands for this player now: the same spot on every reload, somewhere
 * new around the main roach once the page was out of sight for RESPOT_MS or the
 * main roach moved. Counts as the page being looked at now.
 */
export function perlicaSpot(userId: string, main: LngLat, now = Date.now()): LngLat {
  const old = readSpot(userId);
  const stays = old && now - old.at < RESPOT_MS && old.lng === main.lng && old.lat === main.lat;
  const s: Spot = stays ? { ...old, at: now } : { u: Math.random(), v: Math.random(), lng: main.lng, lat: main.lat, at: now };
  writeSpot(userId, s);
  return spotNear(main, s.u, s.v);
}

/** The page is still being looked at (every minute, and as it goes out of sight). */
export function lookedAt(userId: string, now = Date.now()) {
  const s = readSpot(userId);
  if (s) writeSpot(userId, { ...s, at: now });
}

/** 假装离开: as if the page was last looked at that many seconds earlier, so she moves as she would. */
export function rewindSpot(userId: string, seconds: number) {
  const s = readSpot(userId);
  if (s) writeSpot(userId, { ...s, at: s.at - seconds * 1000 });
}

// ---- the second step's notes, kept in this browser only ----

/** When the player drank, and until when their main roach sleeps: for her 「你睡了 …」, never sent anywhere */
type Drank = { at: number; until: number };
const drankKey = (userId: string) => `zhoup.perlica.drank.${userId}`;

export function readDrank(userId: string, now = Date.now()): Drank | null {
  try {
    const d = JSON.parse(localStorage.getItem(drankKey(userId)) ?? "null") as Drank | null;
    if (d && Number.isFinite(d.at) && Number.isFinite(d.until) && d.at <= now && d.at < d.until) return d;
    if (d) forgetDrank(userId);
  } catch {}
  return null;
}
export function rememberDrank(userId: string, d: Drank) {
  try {
    localStorage.setItem(drankKey(userId), JSON.stringify(d));
  } catch {}
}
export function forgetDrank(userId: string) {
  try {
    localStorage.removeItem(drankKey(userId));
  } catch {}
}
/** 假装喝了 7 小时 (local testing only): the drink this many hours earlier */
export function rewindDrank(userId: string, hours: number) {
  const d = readDrank(userId);
  if (!d) return false;
  rememberDrank(userId, { at: d.at - hours * 3_600_000, until: d.until });
  return true;
}

/** The anniversary she last marked: of which friendship (since) and which day of it */
const annivKey = (userId: string) => `zhoup.perlica.anniv.${userId}`;

/** Whether she marked this day of this friendship already; marks it if not */
export function markAnniversary(userId: string, since: number, day: number) {
  try {
    const a = JSON.parse(localStorage.getItem(annivKey(userId)) ?? "null") as { since: number; day: number } | null;
    if (a?.since === since && a.day === day) return false;
    localStorage.setItem(annivKey(userId), JSON.stringify({ since, day }));
    return true;
  } catch {
    // without storage, rather miss it than say it on every visit
    return false;
  }
}
export function forgetAnniversary(userId: string) {
  try {
    localStorage.removeItem(annivKey(userId));
  } catch {}
}
