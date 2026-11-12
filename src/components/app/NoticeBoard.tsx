"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { isNew, noticeDay, type NoticeMemory, type PublicNotice } from "@/lib/notices";
import NoticeBody from "./NoticeBody";
import Sheet from "./Sheet";

/**
 * 公告 (src/lib/notices.ts): the button beside the site's name, the strip under the counts when something is
 * new, and the board, which is the list or one notice. The same for the admin's preview.
 */

/** Where the board is: the list, or one notice; counted: its way back says how many there are (popped up, or from the strip) */
export type BoardView = { kind: "list" } | { kind: "notice"; notice: PublicNotice; counted: boolean };

function Megaphone({ size = 16, width = 1.9 }: { size?: number; width?: number }) {
  return (
    <svg
      className="mega"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 10.2v3.6c0 .8.6 1.4 1.4 1.4H7l8.5 4.3V4.5L7 8.8H4.9c-.8 0-1.4.6-1.4 1.4z" />
      <path d="M8.2 15.3l1.2 4.2h2.3l-.9-3.3" />
      <path d="M18.6 9.3a3.6 3.6 0 0 1 0 5.4" />
    </svg>
  );
}

/** In the top bar: the megaphone, with 「公告」 where there is room, and the red dot when something is new */
export function NoticeButton({ dot, onClick }: { dot: boolean; onClick: () => void }) {
  return (
    <button className="notice-btn" onClick={onClick} aria-label={dot ? T.notices.buttonNew : T.notices.title}>
      <Megaphone />
      <span className="label">{T.notices.title}</span>
      {dot && <span className="dot" aria-hidden="true" />}
    </button>
  );
}

/** Under the counts: the newest new notice; its title opens it, × puts it away */
export function NoticeStrip({ notice, onOpen, onClose }: { notice: PublicNotice; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="notice-strip">
      <button className="go" onClick={onOpen}>
        <Megaphone size={15} width={2} />
        <strong>{T.notices.newOne}</strong>
        <span className="t">{notice.title}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff99" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <span className="sep" aria-hidden="true" />
      <button className="x" onClick={onClose} aria-label={T.notices.dismiss}>
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * The board. The list: pinned first, then the newest, each with 「置顶」 or 「新」 (new: in the last 7 days and
 * not read here). One notice: the way back to the list, the day it went out, and its words. A new view
 * starts a new sheet, so a long notice opens at its top.
 */
export default function NoticeBoard({
  notices,
  view,
  memory,
  onOpen,
  onList,
  onClose,
}: {
  notices: PublicNotice[];
  view: BoardView;
  memory: NoticeMemory;
  onOpen: (n: PublicNotice) => void;
  onList: () => void;
  onClose: () => void;
}) {
  if (view.kind === "list") {
    const now = Date.now();
    return (
      <Sheet key="list" title={T.notices.title} onClose={onClose}>
        {notices.length ? (
          <div className="notice-list">
            {notices.map((n) => (
              <button key={n.id} className="notice-row" onClick={() => onOpen(n)}>
                <span className="notice-row-main">
                  <span className="notice-row-top">
                    {n.pinned && <span className="notice-tag pin">{T.notices.pinned}</span>}
                    {isNew(n, memory, now) && <span className="notice-tag new">{T.common.new}</span>}
                    <strong>{n.title}</strong>
                  </span>
                  <span className="notice-row-sub">
                    {noticeDay(n.publishedAt)} · {n.excerpt}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="notice-none">{T.notices.empty}</p>
        )}
      </Sheet>
    );
  }
  // its latest words if it was edited while open; as it was, if it was taken down meanwhile
  const n = notices.find((x) => x.id === view.notice.id) ?? view.notice;
  return (
    <Sheet
      key={n.id}
      title={n.title}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          {T.common.gotIt}
        </button>
      }
    >
      <div className="notice-meta">
        <button className="notice-back" onClick={onList}>
          {fmtParts(T.notices.back, { count: view.counted ? fmt(T.common.inParens, { text: notices.length }) : "" })}
        </button>
        <span>{fmtParts(T.notices.byAdmin, { day: noticeDay(n.publishedAt) })}</span>
      </div>
      <NoticeBody body={n.body} />
    </Sheet>
  );
}
