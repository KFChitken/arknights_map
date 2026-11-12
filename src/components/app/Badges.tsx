"use client";
/* eslint-disable @next/next/no-img-element -- the badges are small SVGs, which next/image leaves as they are anyway */

import { useState } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import {
  badgeById,
  daysLeft,
  lockedText,
  quoteOf,
  serialText,
  SERIES,
  wallBadges,
  type EarnedBadge,
  type ShownBadge,
} from "@/lib/badges";
import type { Me } from "@/lib/world/types";
import Sheet from "./Sheet";

/**
 * 称号 on screen. The art is always an <img>: the full and mini versions of a
 * badge share ids inside their SVGs, so inlining both on one page would mix
 * them up. 40px and up uses the full one, 32px and below the mini one.
 */

const art = (id: string, size: number) => `/badges/${id}${size <= 32 ? "-mini" : ""}.svg`;

/**
 * A badge's art. The 向导 ones are drawn with the guide's own picture too, which the server gives
 * only while that guide's picture is switched on; otherwise (404) the drawn one stands in.
 */
function BadgeImg({ id, size, alt }: { id: string; size: number; alt: string }) {
  const picture = badgeById(id)?.pictureArt;
  const drawn = art(id, size);
  const [src, setSrc] = useState(picture ? `/guide-art/${picture}${size <= 32 ? "-mini" : ""}.svg` : drawn);
  return <img src={src} alt={alt} width={size} height={size} onError={() => setSrc(drawn)} />;
}

/** The pill under a name on profile cards. */
export function BadgePill({ badge }: { badge: ShownBadge }) {
  const b = badgeById(badge.id);
  if (!b) return null;
  return (
    <span className="badge-pill" style={b.pill}>
      <BadgeImg id={b.id} size={22} alt="" />
      {b.name}
      {badge.serial && <span className="serial">{serialText(badge.serial)}</span>}
    </span>
  );
}

/** 「TA 的称号」 on someone's profile card: four at first, the worn one first and framed. */
export function TheirBadges({ badges, worn }: { badges: ShownBadge[]; worn?: string | null }) {
  const [all, setAll] = useState(false);
  const known = badges.filter((b) => badgeById(b.id));
  if (!known.length) return null;
  return (
    <section className="their-badges">
      <div className="their-badges-head">
        <h3>{fmtParts(T.badges.theirs, { n: known.length })}</h3>
        {known.length > 4 && (
          <button className="link" onClick={() => setAll((a) => !a)}>
            {all ? T.common.collapse : T.badges.all}
          </button>
        )}
      </div>
      <div className="badge-grid four">
        {(all ? known : known.slice(0, 4)).map((s) => {
          const b = badgeById(s.id)!;
          return (
            <div key={s.id} className={`badge-cell ${s.id === worn ? "worn" : ""}`}>
              <BadgeImg id={b.id} size={58} alt={fmt(T.badges.alt, { name: b.name })} />
              <span className="badge-name">{b.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 「我的称号 4/9 ›」 at the top of 我的资料; a timed badge is not counted. */
export function MyBadgesRow({ badges, worn, onOpen }: { badges: EarnedBadge[]; worn: string | null; onOpen: () => void }) {
  const list = wallBadges(new Set(badges.map((b) => b.id))).filter((b) => !b.days);
  const got = list.filter((b) => badges.some((e) => e.id === b.id)).length;
  const wearing = badges.find((b) => b.id === worn);
  return (
    <button className="link-row" onClick={onOpen}>
      <span>
        {T.badges.mine}{" "}
        <span className="muted">
          {got}/{list.length}
        </span>
      </span>
      <span className="link-row-end">
        {wearing && <BadgePill badge={wearing} />}
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  );
}

const day = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
};

const LOCK = (
  <svg className="lock" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9aa1ab" strokeWidth="2.4">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

/**
 * 我的称号: every badge there is to get, by series. Tap an earned one to wear it, or tap the worn one
 * to take it off. A timed badge shows only while held, and is left out of the counts.
 */
export function BadgeWall({
  me,
  onWear,
  onBack,
  onClose,
}: {
  me: Me;
  onWear: (badge: string | null) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const earned = new Map(me.badges.map((b) => [b.id, b]));
  const list = wallBadges(new Set(earned.keys()));
  const tally = list.filter((b) => !b.days);
  const got = tally.filter((b) => earned.has(b.id)).length;
  const worn = me.wornBadge ? earned.get(me.wornBadge) : undefined;
  return (
    <Sheet title={T.badges.mine} onBack={onBack} onClose={onClose}>
      <div className="wall-top">
        <div className="wall-tally">
          <span className="wall-label">COLLECTED</span>
          <span>
            <b className="wall-count">{got}</b> / {tally.length}{T.badges.collected}
          </span>
          <div className="wall-bar" aria-hidden="true">
            <div style={{ width: `${Math.round((100 * got) / tally.length)}%` }} />
          </div>
        </div>
        <div className="wall-worn">
          <span>{T.badges.wearing}</span>
          {worn ? <BadgePill badge={worn} /> : <span className="wall-none">{T.badges.notWearing}</span>}
          <span>{earned.size ? T.badges.pickOne : T.badges.earnFirst}</span>
        </div>
      </div>

      {SERIES.map((series) => {
        const mine = list.filter((b) => b.series === series.id);
        const kept = mine.filter((b) => !b.days);
        if (!mine.length) return null;
        return (
          <section key={series.id}>
            <div className={`series-head series-${series.id}`}>
              <span className="diamond" aria-hidden="true" />
              <h3>{series.name}</h3>
              <span className="series-count">
                {kept.filter((b) => earned.has(b.id)).length}/{kept.length}
              </span>
            </div>
            <div className="badge-grid three">
              {mine.map((b) => {
                const e = earned.get(b.id);
                if (e) {
                  const on = me.wornBadge === b.id;
                  return (
                    <button
                      key={b.id}
                      className={`badge-cell ${on ? "worn" : ""}`}
                      aria-label={on ? fmt(T.badges.takeOff, { name: b.name }) : fmt(T.badges.putOn, { name: b.name })}
                      onClick={() => onWear(on ? null : b.id)}
                    >
                      {on ? <span className="cell-tag">{T.badges.worn}</span> : e.until && <span className="cell-tag timed">{T.badges.timed}</span>}
                      <BadgeImg id={b.id} size={54} alt="" />
                      <span className="badge-name">{b.name}</span>
                      <span className={e.serial ? "cell-note serial" : "cell-note"}>
                        {e.until ? daysLeft(e.until) : e.serial ? serialText(e.serial) : fmt(T.badges.gotOn, { day: day(e.at) })}
                      </span>
                    </button>
                  );
                }
                // the only event badges listed unearned are the ones on offer now
                if (b.series === "event") {
                  return (
                    <div key={b.id} className="badge-cell running">
                      <span className="cell-tag">{T.badges.ongoing}</span>
                      <BadgeImg id={b.id} size={54} alt={fmt(T.badges.notGot, { name: b.name })} />
                      <span className="badge-name">{b.name}</span>
                      <span className="cell-note">{b.lockedHint}</span>
                    </div>
                  );
                }
                const share = b.goal ? Math.min(1, me.counts[b.goal.count] / b.goal.n) : null;
                return (
                  <div key={b.id} className="badge-cell locked">
                    {LOCK}
                    <BadgeImg id={b.id} size={54} alt={fmt(T.badges.notGot, { name: b.name })} />
                    <span className="badge-name">{b.name}</span>
                    <span className="cell-note">{lockedText(b, me.counts)}</span>
                    {share !== null && (
                      <div className="cell-bar" aria-hidden="true">
                        <div style={{ width: `${Math.round(share * 100)}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="hint" style={{ marginTop: 14 }}>
        {T.badges.onlyOnCard}
      </p>
    </Sheet>
  );
}

// where the bits of confetti sit around the badge, as fractions of the screen
const CONFETTI: { x: number; y: number; w: number; h: number; c: string; r: number }[] = [
  { x: 0.11, y: 0.21, w: 11, h: 5, c: "#ff7eb6", r: 24 },
  { x: 0.85, y: 0.2, w: 8, h: 8, c: "#3fd0d4", r: 0 },
  { x: 0.78, y: 0.31, w: 12, h: 5, c: "#ffd23f", r: -32 },
  { x: 0.15, y: 0.38, w: 7, h: 7, c: "#5be37d", r: 0 },
  { x: 0.9, y: 0.42, w: 10, h: 4, c: "#b48cff", r: 40 },
  { x: 0.06, y: 0.28, w: 9, h: 4, c: "#ffd23f", r: -14 },
  { x: 0.25, y: 0.17, w: 6, h: 6, c: "#ffffff", r: 0 },
  { x: 0.71, y: 0.15, w: 10, h: 4, c: "#ff7eb6", r: 62 },
];

/** 获得新称号: shown once per badge, over everything else. */
export function NewBadge({ earned, onWear, onLater }: { earned: EarnedBadge; onWear: () => void; onLater: () => void }) {
  const b = badgeById(earned.id);
  if (!b) return null;
  const series = SERIES.find((s) => s.id === b.series);
  return (
    <div className="new-badge" role="dialog" aria-modal="true" aria-label={fmt(T.badges.newAria, { name: b.name })}>
      {CONFETTI.map((p, i) => (
        <span
          key={i}
          className="confetti"
          aria-hidden="true"
          style={{
            left: `${p.x * 100}%`,
            top: `${p.y * 100}%`,
            width: p.w,
            height: p.h,
            background: p.c,
            borderRadius: p.w === p.h ? "50%" : 1,
            transform: `rotate(${p.r}deg)`,
          }}
        />
      ))}
      <div className="new-badge-body">
        <span className="new-badge-kicker">NEW TITLE</span>
        <span className="new-badge-sub">{T.badges.newTitle}</span>
        <div className="new-badge-art">
          <div className="rays" aria-hidden="true" />
          <div className="glow" aria-hidden="true" />
          <BadgeImg id={b.id} size={212} alt={fmt(T.badges.alt, { name: b.name })} />
        </div>
        <div className="new-badge-banner">
          <strong>{b.name}</strong>
          <span>
            {earned.serial ? serialText(earned.serial) : b.code} · {series?.code}
          </span>
        </div>
        <p className="new-badge-quote">{fmtParts(T.common.quoted, { text: quoteOf(b, earned.serial) })}</p>
        <p className="new-badge-condition">{b.condition}</p>
        <div className="new-badge-actions">
          <button className="wear" onClick={onWear}>
            {T.badges.wearIt}
          </button>
          <button className="later" onClick={onLater}>
            {T.badges.keepIt}
          </button>
        </div>
      </div>
    </div>
  );
}
