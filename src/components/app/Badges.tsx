"use client";
/* eslint-disable @next/next/no-img-element -- the badges are small SVGs, which next/image leaves as they are anyway */

import { useState } from "react";
import {
  badgeById,
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

/** The pill under a name on profile cards. */
export function BadgePill({ badge }: { badge: ShownBadge }) {
  const b = badgeById(badge.id);
  if (!b) return null;
  return (
    <span className="badge-pill" style={b.pill}>
      <img src={art(b.id, 22)} alt="" width={22} height={22} />
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
        <h3>TA 的称号 · {known.length}</h3>
        {known.length > 4 && (
          <button className="link" onClick={() => setAll((a) => !a)}>
            {all ? "收起" : "全部 ›"}
          </button>
        )}
      </div>
      <div className="badge-grid four">
        {(all ? known : known.slice(0, 4)).map((s) => {
          const b = badgeById(s.id)!;
          return (
            <div key={s.id} className={`badge-cell ${s.id === worn ? "worn" : ""}`}>
              <img src={art(b.id, 58)} alt={`${b.name}徽章`} width={58} height={58} />
              <span className="badge-name">{b.name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 「我的称号 4/9 ›」 at the top of 我的资料. */
export function MyBadgesRow({ badges, worn, onOpen }: { badges: EarnedBadge[]; worn: string | null; onOpen: () => void }) {
  const list = wallBadges(new Set(badges.map((b) => b.id)));
  const got = list.filter((b) => badges.some((e) => e.id === b.id)).length;
  const wearing = badges.find((b) => b.id === worn);
  return (
    <button className="link-row" onClick={onOpen}>
      <span>
        我的称号{" "}
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

/** 我的称号: every badge there is to get, by series. Tap an earned one to wear it, or tap the worn one to take it off. */
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
  const got = list.filter((b) => earned.has(b.id)).length;
  const worn = me.wornBadge ? earned.get(me.wornBadge) : undefined;
  return (
    <Sheet title="我的称号" onBack={onBack} onClose={onClose}>
      <div className="wall-top">
        <div className="wall-tally">
          <span className="wall-label">COLLECTED</span>
          <span>
            <b className="wall-count">{got}</b> / {list.length} 已获得
          </span>
          <div className="wall-bar" aria-hidden="true">
            <div style={{ width: `${Math.round((100 * got) / list.length)}%` }} />
          </div>
        </div>
        <div className="wall-worn">
          <span>正在佩戴</span>
          {worn ? <BadgePill badge={worn} /> : <span className="wall-none">还没戴</span>}
          <span>{got ? "点一枚已获得的换上" : "拿到称号就能戴上"}</span>
        </div>
      </div>

      {SERIES.map((series) => {
        const mine = list.filter((b) => b.series === series.id);
        if (!mine.length) return null;
        return (
          <section key={series.id}>
            <div className={`series-head series-${series.id}`}>
              <span className="diamond" aria-hidden="true" />
              <h3>{series.name}</h3>
              <span className="series-count">
                {mine.filter((b) => earned.has(b.id)).length}/{mine.length}
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
                      aria-label={on ? `取下${b.name}` : `戴上${b.name}`}
                      onClick={() => onWear(on ? null : b.id)}
                    >
                      {on && <span className="cell-tag">佩戴中</span>}
                      <img src={art(b.id, 54)} alt="" width={54} height={54} />
                      <span className="badge-name">{b.name}</span>
                      <span className={e.serial ? "cell-note serial" : "cell-note"}>
                        {e.serial ? serialText(e.serial) : `${day(e.at)} 获得`}
                      </span>
                    </button>
                  );
                }
                // the only event badges listed unearned are the ones on offer now
                if (b.series === "event") {
                  return (
                    <div key={b.id} className="badge-cell running">
                      <span className="cell-tag">进行中</span>
                      <img src={art(b.id, 54)} alt={`${b.name}徽章，未获得`} width={54} height={54} />
                      <span className="badge-name">{b.name}</span>
                      <span className="cell-note">{b.lockedHint}</span>
                    </div>
                  );
                }
                const share = b.goal ? Math.min(1, me.counts[b.goal.count] / b.goal.n) : null;
                return (
                  <div key={b.id} className="badge-cell locked">
                    {LOCK}
                    <img src={art(b.id, 54)} alt={`${b.name}徽章，未获得`} width={54} height={54} />
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
        称号只在资料卡上给别人看，地图上看不到。
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
    <div className="new-badge" role="dialog" aria-modal="true" aria-label={`获得新称号：${b.name}`}>
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
        <span className="new-badge-sub">获得新称号</span>
        <div className="new-badge-art">
          <div className="rays" aria-hidden="true" />
          <div className="glow" aria-hidden="true" />
          <img src={art(b.id, 212)} alt={`${b.name}徽章`} width={212} height={212} />
        </div>
        <div className="new-badge-banner">
          <strong>{b.name}</strong>
          <span>
            {earned.serial ? serialText(earned.serial) : b.code} · {series?.code}
          </span>
        </div>
        <p className="new-badge-quote">「{quoteOf(b, earned.serial)}」</p>
        <p className="new-badge-condition">{b.condition}</p>
        <div className="new-badge-actions">
          <button className="wear" onClick={onWear}>
            戴上它
          </button>
          <button className="later" onClick={onLater}>
            先收着
          </button>
        </div>
      </div>
    </div>
  );
}
