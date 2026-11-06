"use client";

import { useRef } from "react";
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
      <p className="consent-place">佩丽卡监督住到了你的本体附近。</p>
      <p className="amiya-line perlica-ask">{PERLICA_LINES.ask}</p>
      <p className="hint">
        点「好」以后，{SITE_NAME}会记下你最后一次在看网站的时间（精确到秒，每次覆盖旧的），只用来让她告诉你离开了多久，别人看不到。随时可以在「资料」里关掉，关掉就删掉。
        <a href="/privacy" target="_blank" rel="noreferrer">
          隐私说明
        </a>
      </p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onYes}>
          好
        </button>
        <button className="pill" onClick={onNo}>
          先不用
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Her report of how long the player was away, along the top of the map. It never
 * stops the map being used, goes by itself after a few seconds (the page times
 * it), and can be closed or swiped away; tapping it goes to her.
 */
export function PerlicaBanner({ text, onOpen, onClose }: { text: string; onOpen: () => void; onClose: () => void }) {
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
          {PERLICA_NAME}：「{text}」
        </span>
      </button>
      <button className="close" aria-label="关闭" onClick={onClose}>
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
