"use client";

import { fmt, T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";
import type { FishCatch } from "@/lib/fish/rules";
import { TICKETS_CAP } from "@/lib/passes";
import FishCard, { cmText, nameOf, wordsOf } from "./FishCard";

/**
 * A catch worth a page of its own (the first of one, a record size, purple or better), as the game's 获得物资 when a
 * task's reward comes, over the small window's scene (the design's FishWin): the scene dark under a fine dot grid, a
 * soft light (gold for purple and better), 钓上来了, the disc popping in with the size where the game writes how many
 * and NEW at its corner the first time, the name in a black box, a grey line of its number, rarity and how many (新纪录
 * before it for a record), and under it the site's biggest for a record, or what a 寻访券 or a 漂流瓶 does; a round ✓ in
 * the corner, and a tap anywhere closes it.
 */
export default function CatchPage({ caught, onClose }: { caught: FishCatch; onClose: () => void }) {
  const item = itemOf(caught.no);
  if (!item) return null;
  const name = nameOf(caught.no, caught.variant);
  const no = String(caught.no).padStart(3, "0");
  const line = caught.first
    ? caught.variant
      ? fmt(T.fish.banner.lineFirstVariant, { no, tier: item.tier, v: T.fish.variants[caught.variant] })
      : fmt(T.fish.banner.lineFirst, { no, tier: item.tier })
    : fmt(T.fish.banner.lineNth, { no, tier: item.tier, n: caught.n });
  const extra =
    caught.wallet !== undefined
      ? fmt(T.fish.ticketIn, { n: caught.wallet, cap: TICKETS_CAP })
      : caught.bottle !== undefined
        ? T.fish.bottle.next
        : caught.record && caught.top !== null
          ? fmt(T.fish.banner.recordLine, { name: wordsOf(item.key)?.name ?? name, cm: cmText(caught.top) })
          : null;
  return (
    <button type="button" className="fish-got" onClick={onClose} aria-label={`${T.fish.banner.title} ${name}`}>
      <span className={`halo${item.tier >= 4 ? " gold" : ""}`} aria-hidden="true" />
      <span className="ttl">{T.fish.banner.title}</span>
      <span className="item">
        <FishCard no={caught.no} variant={caught.variant} size={88} cm={caught.cm} />
        {caught.first && <em className="fish-new">{T.fish.banner.fresh}</em>}
      </span>
      <span className="nm">{name}</span>
      <span className="ln">
        {caught.record && <b className="rec">{T.fish.banner.record}</b>}
        {line}
      </span>
      {extra && <span className="ln ln-in">{extra}</span>}
      <span className="ok" aria-hidden="true">
        <svg width="16" height="12" viewBox="0 0 26 20">
          <path d="M2 10 L10 17 L24 3" fill="none" stroke="#d6d6d6" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
