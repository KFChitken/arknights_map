"use client";

import type { ReactNode, Ref } from "react";
import { fmt, T } from "@/i18n";
import { stackRows } from "@/lib/stackPick";

/** One of those lying on top of each other, as the list shows it: its icon, what its card calls it, and where it is */
export type StackRow = { key: string; icon: ReactNode; title: string; sub?: string; onPick: () => void };

/**
 * Roaches lying on top of each other where the map was tapped close up (src/lib/stackPick.ts): one row each, nearest
 * the finger first, each called as its own card calls it and no more (nobody's are put together, nor counted), at most
 * STACK_ROWS of them and the rest counted. A row opens that one's card; 放大看看 zooms in on the spot, while the map
 * can go closer.
 */
export default function StackPicker({
  ref,
  rows,
  onZoomIn,
  onClose,
}: {
  ref?: Ref<HTMLDivElement>;
  rows: StackRow[];
  onZoomIn?: () => void;
  onClose: () => void;
}) {
  const { rows: shown, more } = stackRows(rows.length);
  const title = fmt(T.cards.stack.title, { n: rows.length });
  return (
    <div ref={ref} className="card stack stack-pick" role="dialog" aria-label={title}>
      <div className="stack-head">
        <strong>{title}</strong>
        <p className="muted">{T.cards.stack.hint}</p>
      </div>
      <ul className="stack-rows">
        {rows.slice(0, shown).map((r) => (
          <li key={r.key}>
            <button className="stack-row" onClick={r.onPick}>
              <span className="stack-icon">{r.icon}</span>
              <span className="stack-name">
                {r.title}
                {r.sub && <small>{r.sub}</small>}
              </span>
              <span className="stack-go" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="muted stack-more">{fmt(T.cards.stack.more, { n: more })}</p>}
      <div className="stack-foot">
        <span className="muted">{T.cards.stack.order}</span>
        {onZoomIn && (
          <button className="pill" onClick={onZoomIn}>
            {T.cards.stack.zoomIn}
          </button>
        )}
      </div>
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

/** Above the card of one picked from the list: back to the list, n being how many others it has */
export function StackBack({ n, onBack }: { n: number; onBack: () => void }) {
  return (
    <button className="link stack-back" onClick={onBack}>
      {fmt(T.cards.stack.back, { n })}
    </button>
  );
}

/** At the foot of a guide's card: the n roaches under her picture, to pick from; them: 她 or 他 */
export function StackUnderGuide({ them, n, onOpen }: { them: string; n: number; onOpen: () => void }) {
  return (
    <button className="link stack-under" onClick={onOpen}>
      {fmt(T.cards.stack.underGuide, { them, n })}
    </button>
  );
}

/** An ink roach of 缘缘庄 in the list: its ink picture, small */
export function InkIcon({ look }: { look: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- one small WebP of our own, which next/image would only copy
  return <img className="stack-ink" src={`/avatars/ink-${look}.webp`} alt="" width={36} height={36} />;
}
