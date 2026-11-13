"use client";
/* eslint-disable @next/next/no-img-element -- the site's own small pictures, shown as they are */

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { passwordStatus } from "@/lib/authClient";
import { badgeById } from "@/lib/badges";
import { CHANGELOG } from "@/lib/changelog";
import { HELP_HOURS, helpText } from "@/lib/help";
import { INBOX_TABS, tabLabel } from "@/lib/inboxTabs";
import { MAP_STYLE_NAMES, type MapStyle } from "@/lib/mapStyle";
import {
  coverCount,
  markedParts,
  newestLines,
  pageButton,
  pageNo,
  pageText,
  pamphletPages,
  type PamphletAction,
  type PamphletPage,
  type Reader,
  type UpdatePage,
} from "@/lib/pamphlet";
import { siteName } from "@/lib/rules";
import { UI_NAMES, type UiName } from "@/lib/uiChoice";
import { UiIcon } from "./chrome/parts";
import { SiPicture } from "./Si";
import "./pamphlet.css";

/**
 * 最近更新 (src/lib/pamphlet.ts): a cover and a page for each change, turned by a drag to either side, the buttons
 * under them or the cover's list. On a phone, or any window under 1000 × 680, a paper card over the map; on a
 * computer, an open book: a picture on the left page, the words on the right, arrows outside it and a dot for each
 * page under it. Over everything on the map, in each of the three layouts. ×, 知道了, a tap beside it and Escape
 * close it (onClose); a page's button closes it too, and takes the player there (onAction).
 */
export default function Pamphlet({
  uiChoice,
  signedIn,
  asking,
  ui,
  mapStyle,
  onAction,
  onClose,
}: {
  /** players may pick a 界面 (UI_CHOICE), so its page is in */
  uiChoice: boolean;
  signedIn: boolean;
  /** this visit asks first whether they are 18, or to agree to the new privacy policy: no buttons */
  asking: boolean;
  /** the 界面 and 画风 in use, ticked in their pages' pictures */
  ui: UiName;
  mapStyle: MapStyle;
  onAction: (action: PamphletAction) => void;
  onClose: () => void;
}) {
  const pages = pamphletPages(uiChoice);
  const last = pages.length - 1;
  const [page, setPage] = useState(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  // the pages whose pictures are drawn: those turned to and the ones beside them, so a slow line fetches a page's
  // pictures only as the reader comes near it
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([0, 1]));
  const go = (i: number) => {
    const to = Math.max(0, Math.min(last, i));
    setPage(to);
    setNear((s) => (s.has(to - 1) && s.has(to) && s.has(to + 1) ? s : new Set([...s, to - 1, to, to + 1])));
  };
  const goRef = useRef(go);
  goRef.current = go;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const [fit, setFit] = useState(measure);
  useEffect(() => {
    const again = () => setFit(measure());
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []);

  // 去设密码 or 已经设好了: asked of the server once the reader comes within a page of it
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const loginAt = pages.indexOf("login");
  const wantPassword = signedIn && !asking && loginAt > 0 && page >= loginAt - 1;
  const live = useRef(true);
  const askedPassword = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!wantPassword || askedPassword.current) return;
    askedPassword.current = true;
    passwordStatus()
      .then((s) => live.current && setPasswordSet(s.setAt !== null))
      // not known: 去设密码, as before
      .catch(() => {});
  }, [wantPassword]);
  const reader: Reader = { signedIn, asking, passwordSet };

  // Into it for the keyboard and screen readers, and kept in it: Tab goes round its buttons, ← → turn the pages,
  // Escape closes it; closed, back to where the focus was
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // the board it was opened from stays open under it
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        goRef.current(pageRef.current + (e.key === "ArrowRight" ? 1 : -1));
      } else if (e.key === "Tab") keepFocus(e, box.current);
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Held on the pages and dragged more than 40px to either side, let go anywhere: the next page or the one
  // before. The tap a drag ends in opens nothing.
  const from = useRef<number | null>(null);
  const dragged = useRef(false);
  const down = (e: PointerEvent) => {
    dragged.current = false;
    from.current = e.isPrimary && e.button === 0 ? e.clientX : null;
  };
  const up = (e: PointerEvent) => {
    const x = from.current;
    from.current = null;
    if (x === null || Math.abs(e.clientX - x) <= 40) return;
    dragged.current = true;
    go(page + (e.clientX < x ? 1 : -1));
  };
  const swallow = (e: MouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // a tap on the dim beside it, begun there too (a drag out of the pages is not one)
  const onDim = useRef(false);
  const now = Date.now();
  const at = { page, last, pages, go, near, reader, ui, mapStyle, now, onAction, onClose };
  const track = (
    <div className="pp-view" onPointerDown={down} onClickCapture={swallow}>
      <div className="pp-track" style={{ transform: `translateX(${-page * 100}%)` }}>
        {pages.map((p, i) => (
          <div key={p} className="pp-page" inert={i !== page || undefined}>
            {fit.wide ? <DeskPage {...at} p={p} i={i} /> : <PhonePage {...at} p={p} i={i} />}
          </div>
        ))}
      </div>
    </div>
  );
  const shut = (
    <button className="pp-x" onClick={onClose} aria-label={T.pamphlet.close}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5 5 L15 15 M15 5 L5 15" fill="none" stroke="#1b1d22" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </button>
  );
  return (
    <div
      className={`pamphlet ${fit.wide ? "pp-wide" : "pp-phone"}`}
      style={{ "--art": fit.art, "--book": fit.book } as CSSProperties}
      onPointerDown={(e) => (onDim.current = e.target === e.currentTarget)}
      onPointerUp={up}
      onPointerCancel={() => (from.current = null)}
      onClick={(e) => onDim.current && e.target === e.currentTarget && onClose()}
    >
      <div ref={box} className="pp-box" role="dialog" aria-modal="true" aria-label={T.pamphlet.label} tabIndex={-1}>
        {fit.wide ? (
          <>
            <div className="pp-book">
              {track}
              <div className="pp-spine" aria-hidden="true" />
              {shut}
            </div>
            <button className="pp-arrow prev" onClick={() => go(page - 1)} disabled={page === 0} aria-label={T.pamphlet.prev}>
              <Chev dir="left" size={20} />
            </button>
            <button className="pp-arrow next" onClick={() => go(page + 1)} disabled={page === last} aria-label={T.pamphlet.next}>
              <Chev dir="right" size={20} />
            </button>
            <div className="pp-dotrow">
              {pages.map((p, i) => (
                <button key={p} className={i === page ? "on" : undefined} onClick={() => go(i)} aria-label={fmt(T.pamphlet.dot, { n: i + 1 })} aria-current={i === page || undefined}>
                  <span />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="pp-card">
            <header className="pp-head">
              <span className="pp-brand">
                <i aria-hidden="true" />
                {T.pamphlet.brand}
              </span>
              {shut}
            </header>
            {track}
            <footer className="pp-foot">
              <button className="pp-prev" onClick={() => go(page - 1)} disabled={page === 0}>
                <Chev dir="left" size={16} />
                {T.pamphlet.prev}
              </button>
              <div className="pp-dots" aria-hidden="true">
                {pages.map((p, i) => (
                  <span key={p} className={i === page ? "on" : undefined} />
                ))}
              </div>
              {/* one button, so the focus stays on it as it turns into 知道了 */}
              <button className={`pp-next${page === last ? " done" : ""}`} onClick={page === last ? onClose : () => go(page + 1)}>
                {page === last ? (
                  T.common.gotIt
                ) : (
                  <>
                    {T.pamphlet.next}
                    <Chev dir="right" size={16} color="#ffffff" />
                  </>
                )}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The layout for the window: open as two pages from 1000 × 680 up, else a card; how much the pictures (330 × 220)
 * shrink to fit the card (and to 0.8 on a screen under 700 high), and the open book (with its arrows and dots,
 * 1112 × 628) a window too small for it
 */
function measure() {
  if (typeof window === "undefined") return { wide: false, art: 1, book: 1 };
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    wide: w >= 1000 && h >= 680,
    art: Math.min(h < 700 ? 0.8 : 1, (Math.min(362, w - 28) - 32) / 330),
    book: Math.min(1, (w - 24) / 1112, (h - 24) / 628),
  };
}

/** Tab and Shift+Tab go round the buttons that can be pressed now, those of the page showing among them */
function keepFocus(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const all = [...root.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((b) => !b.closest("[inert]"));
  if (!all.length) return;
  const at = document.activeElement;
  const out = !root.contains(at) || at === root;
  if (e.shiftKey ? out || at === all[0] : at === all[all.length - 1] || !root.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? all[all.length - 1] : all[0]).focus();
  }
}

type At = {
  page: number;
  last: number;
  pages: PamphletPage[];
  go: (i: number) => void;
  near: ReadonlySet<number>;
  reader: Reader;
  ui: UiName;
  mapStyle: MapStyle;
  now: number;
  onAction: (action: PamphletAction) => void;
  onClose: () => void;
};

/** On a phone: the picture, then the words under it, scrolling on a short screen */
function PhonePage({ p, i, pages, go, near, reader, ui, mapStyle, now, onAction }: At & { p: PamphletPage; i: number }) {
  if (p === "cover") {
    return (
      <div className="pp-in">
        <div className="pp-pic cover">
          <CoverArt />
        </div>
        <div className="pp-kicker">{T.pamphlet.issue}</div>
        <h2 className="pp-title cover">{T.pamphlet.cover.title}</h2>
        <p className="pp-sub">{T.pamphlet.cover.subPhone}</p>
        <Contents pages={pages} go={go} />
      </div>
    );
  }
  const text = pageText(p, pageNo(i), now);
  return (
    <div className="pp-in">
      <div className="pp-pic">
        <Art page={p} drawn={near.has(i)} ui={ui} mapStyle={mapStyle} />
      </div>
      <Words text={text} />
      <Button page={p} reader={reader} onAction={onAction} />
    </div>
  );
}

/** On a computer: the page's number and its picture on the left page, the words on the right */
function DeskPage({ p, i, last, pages, go, near, reader, ui, mapStyle, now, onAction, onClose }: At & { p: PamphletPage; i: number }) {
  if (p === "cover") {
    return (
      <div className="pp-spread">
        <div className="pp-left">
          <div className="pp-l-brand">{T.pamphlet.brand}</div>
          <div className="pp-l-date">{T.pamphlet.issueDate}</div>
          <div className="pp-stamp" aria-hidden="true">
            {T.common.new}
          </div>
          <div className="pp-l-pic cover">
            <CoverArt />
          </div>
          <p className="pp-l-count">{coverCount(pages)}</p>
        </div>
        <div className="pp-right">
          <div className="pp-kicker">{T.pamphlet.issue}</div>
          <h2 className="pp-title cover">{T.pamphlet.cover.title}</h2>
          <p className="pp-sub">{T.pamphlet.cover.subDesk}</p>
          <Contents pages={pages} go={go} />
        </div>
      </div>
    );
  }
  const text = pageText(p, pageNo(i), now);
  return (
    <div className="pp-spread">
      <div className="pp-left" aria-hidden="true">
        <div className="pp-no">{pageNo(i)}</div>
        <div className="pp-bar" />
        <div className="pp-l-pic">
          <Art page={p} drawn={near.has(i)} ui={ui} mapStyle={mapStyle} />
        </div>
      </div>
      <div className="pp-right">
        <Words text={text} />
        <Button page={p} reader={reader} onAction={onAction} />
        {i === last && (
          <button className="pp-done" onClick={onClose}>
            {T.common.gotIt}
          </button>
        )}
        <div className="pp-folio">
          <span>{T.pamphlet.issue}</span>
          <span>
            {pageNo(i)} / {pageNo(last)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The cover's list of the pages, each opening its page */
function Contents({ pages, go }: { pages: PamphletPage[]; go: (i: number) => void }) {
  return (
    <div className="pp-toc">
      {pages.map((p, i) =>
        p === "cover" ? null : (
          <button key={p} onClick={() => go(i)}>
            <span className="no">{pageNo(i)}</span>
            <span className="t">{T.pamphlet.pages[p].title}</span>
            <Chev dir="right" size={14} width={2} />
          </button>
        ),
      )}
    </div>
  );
}

function Words({ text }: { text: ReturnType<typeof pageText> }) {
  return (
    <>
      <div className="pp-kicker">{text.kicker}</div>
      <h2 className="pp-title">{text.title}</h2>
      {text.quote && <p className="pp-quote">{fmt(T.common.quoted, { text: text.quote })}</p>}
      <div className="pp-lines">
        {text.lines.map((line) => (
          <div key={line} className="pp-line">
            <span className="dia" aria-hidden="true" />
            <p>
              <Marked line={line} />
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

/** A line with its **…** under the marker (or in bold, b) */
function Marked({ line, b = false }: { line: string; b?: boolean }) {
  const Mark = b ? "b" : "mark";
  return <>{markedParts(line).map((part, k) => (part.marked ? <Mark key={k}>{part.text}</Mark> : part.text))}</>;
}

function Button({ page, reader, onAction }: { page: PamphletPage; reader: Reader; onAction: (action: PamphletAction) => void }) {
  const b = pageButton(page, reader);
  if (!b) return null;
  return (
    <button className="pp-act" onClick={() => onAction(b.action)} disabled={b.done}>
      {b.label}
      {!b.done && <Chev dir="right" size={15} />}
    </button>
  );
}

function Chev({ dir, size, color = "#1b1d22", width = 2.2 }: { dir: "left" | "right"; size: number; color?: string; width?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={dir === "left" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13"} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- the pictures: drawn here as the design has them, in a box of 330 × 220 (the cover's, 330 × 128) ----

function Tick({ className }: { className: string }) {
  return (
    <span className={`pa-tick ${className}`} aria-hidden="true">
      <svg viewBox="0 0 12 12" width="12" height="12">
        <path d="M2.5 6.2 L5 8.6 L9.6 3.6" fill="none" stroke="#1b1d22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** The megaphone of 公告 and of 消息's yellow dot, in the design's own small drawing */
function Horn({ size, color = "#1b1d22" }: { size: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M2.2 6 H4.8 L10.2 2.8 V13.2 L4.8 10 H2.2 Z" fill={color} stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M12.6 5.6 Q14.2 8 12.6 10.4" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A row of roaches with 祀掌柜 in the middle, before a yellow sun */
function CoverArt() {
  return (
    <div className="pa pa-cover">
      <span className="sun" />
      <span className="ground" />
      <img className="r1" src="/avatars/doctor.webp" alt="" />
      <img className="r2" src="/avatars/endmin.webp" alt="" />
      <span className="si">
        <SiPicture size={120} />
      </span>
      <img className="r3" src="/avatars/imp.webp" alt="" />
      <img className="r4" src="/avatars/gugu.webp" alt="" />
    </div>
  );
}

/** A page's picture; until the reader comes near its page, only its paper */
function Art({ page, drawn, ui, mapStyle }: { page: UpdatePage; drawn: boolean; ui: UiName; mapStyle: MapStyle }) {
  const art: Record<UpdatePage, () => ReactNode> = {
    ui: () => <ArtUi ui={ui} />,
    mains: () => <ArtMains />,
    inbox: () => <ArtInbox />,
    si: () => <ArtSi />,
    badges: () => <ArtBadges />,
    friends: () => <ArtFriends />,
    styles: () => <ArtStyles style={mapStyle} />,
    login: () => <ArtLogin />,
    notice: () => <ArtNotice />,
  };
  return <div className={`pa pa-${page}`}>{drawn && art[page]()}</div>;
}

/** The three layouts' small pictures, the one in use framed and ticked, and the 界面 button under them */
function ArtUi({ ui }: { ui: UiName }) {
  return (
    <>
      {UI_NAMES.map((u, i) => (
        <div key={u} className={`th t${i}${u === ui ? " on" : ""}`}>
          <img src={`/ui/phone-${u}.webp`} alt="" />
          <span>{u === "float" ? fmt(T.pamphlet.art.uiDefault, { name: T.ui.names.float }) : T.ui.names[u]}</span>
        </div>
      ))}
      <Tick className={`c${UI_NAMES.indexOf(ui)}`} />
      <div className="cap">
        <span className="pill">
          <UiIcon size={16} />
          {T.ui.button}
        </span>
        <span className="tap">{T.pamphlet.art.uiTap}</span>
      </div>
    </>
  );
}

/** The counts at the top as 只看本体 has them, and 地图上看哪些蟑螂 with it chosen */
function ArtMains() {
  return (
    <>
      <div className="count">
        <span className="here">{fmt(T.map.count.herePlayers, { n: 23 })}</span>
        <span className="world">{fmtNodes(T.map.count.worldOnlyMains, { players: "91,208", mark: <b>{T.map.count.onlyMainsMark} ›</b> })}</span>
      </div>
      <div className="pick">
        <strong>{T.onlyMains.title}</strong>
        <div className="opt">
          <span className="dot" />
          <span className="txt">
            <span className="n">{T.onlyMains.all}</span>
            <span className="s">{T.onlyMains.allNote}</span>
          </span>
        </div>
        <div className="opt on">
          <span className="dot" />
          <span className="txt">
            <span className="n">{T.onlyMains.mains}</span>
            <span className="s">{T.onlyMains.mainsNote}</span>
          </span>
        </div>
      </div>
    </>
  );
}

/** 消息 with its red count and the yellow megaphone, what each means, its four tabs and two messages */
function ArtInbox() {
  return (
    <>
      <div className="env">
        <svg viewBox="0 0 70 50" width="70" height="50" aria-hidden="true">
          <rect x="1.5" y="1.5" width="67" height="47" rx="8" fill="#ffffff" stroke="#1b1d22" strokeWidth="2.5" />
          <path d="M7 9 L35 29 L63 9" fill="none" stroke="#1b1d22" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="horn">
          <Horn size={13} />
        </span>
        <span className="red">3</span>
      </div>
      <div className="pa-legend">
        <span>
          <i className="red">3</i>
          <span>
            <Marked line={T.pamphlet.art.inboxRed} b />
          </span>
        </span>
        <span>
          <i className="yel">
            <Horn size={10} />
          </i>
          <span>
            <Marked line={T.pamphlet.art.inboxYellow} b />
          </span>
        </span>
      </div>
      <div className="tabs">
        {INBOX_TABS.map((tab) => (
          <span key={tab} className={tab === "touches" ? "on" : undefined}>
            {tabLabel(tab)}
            {tab === "touches" && <i className="red">3</i>}
            {tab === "declarations" && <i className="yel">5</i>}
          </span>
        ))}
      </div>
      <div className="pa-msg m1">
        <img src="/avatars/endmin.webp" alt="" />
        <span className="t">{fmt(T.pamphlet.art.inboxTouch, { name: T.pamphlet.art.inboxFrom })}</span>
        <span className="w">{fmt(T.inbox.ago.minutes, { n: 2 })}</span>
      </div>
      <div className="pa-msg m2">
        <SiPicture size={26} />
        <span className="t">{T.pamphlet.art.inboxSi}</span>
        <span className="w">{T.common.today}</span>
      </div>
    </>
  );
}

/** 祀掌柜 at 缘缘庄's sign, two ink roaches and her seal */
function ArtSi() {
  return (
    <>
      <span className="ground" />
      <span className="mark m1" />
      <span className="mark m2" />
      <div className="sign" aria-hidden="true">
        {Array.from(T.map.si.inn).map((c, k) => (
          <span key={k}>{c}</span>
        ))}
      </div>
      <span className="si">
        <SiPicture size={172} />
      </span>
      <img className="ink1" src="/avatars/ink-hood.webp" alt="" />
      <img className="ink2" src="/avatars/ink-gugu.webp" alt="" />
      <div className="seal">{T.pamphlet.art.siSeal}</div>
    </>
  );
}

const SHOWN_BADGES = ["siqueue", "siinn", "fireside", "declfriend"] as const;

function ArtBadges() {
  return (
    <div className="grid">
      {SHOWN_BADGES.map((id) => (
        <div key={id}>
          <img src={`/badges/${id}.svg`} alt="" width={80} height={80} />
          <span>{badgeById(id)?.name}</span>
        </div>
      ))}
    </div>
  );
}

/** 触须之交 picked for a gesture, one asleep, the gestures, and a 求助 */
function ArtFriends() {
  const names = T.lib.friendly.names;
  return (
    <>
      {(["doctor", "endmin", "imp", "gugu"] as const).map((a, k) => (
        <div key={a} className={`sq s${k}${k === 2 ? " asleep" : ""}`}>
          <img src={`/avatars/${a}.webp`} alt="" />
        </div>
      ))}
      <Tick className="c0" />
      <Tick className="c1" />
      <Tick className="c3" />
      <svg className="star" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <path
          d="M10 2.5 L12.3 7.3 L17.5 7.9 L13.6 11.4 L14.7 16.6 L10 14 L5.3 16.6 L6.4 11.4 L2.5 7.9 L7.7 7.3 Z"
          fill="#ffd23f"
          stroke="#1b1d22"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      <div className="pa-zz">{T.common.asleep}</div>
      <div className="pa-chips">
        {[names.hug, names.highfive, names.luck, T.friendActs.sanity].map((c, k) => (
          <span key={c} className={k === 0 ? "on" : undefined}>
            {c}
          </span>
        ))}
      </div>
      <div className="go">{fmt(T.friends.batch.gesture, { n: 3, act: names.hug })}</div>
      <div className="ask">
        <span className="tag">{T.pamphlet.art.helpTag}</span>
        <span className="t">{helpText({ kind: "clues", game: "arknights", clues: [3, 5] })}</span>
        <span className="h">{fmt(T.pamphlet.art.helpHours, { n: HELP_HOURS })}</span>
      </div>
    </>
  );
}

/** The five styles' small pictures, the one in use framed and ticked, and 轻量's tag */
const STYLE_ORDER: readonly MapStyle[] = ["plain", "nation", "hearts", "lite", "hidden"];

function ArtStyles({ style }: { style: MapStyle }) {
  return (
    <>
      {STYLE_ORDER.map((s, k) => (
        <div key={s} className={`th t${k}${s === style ? " on" : ""}`}>
          <img src={`/map-style-${s}.png`} alt="" />
          <span>{MAP_STYLE_NAMES[s]}</span>
        </div>
      ))}
      {/* 轻量 in use: its tick has the corner, so the tag moves aside */}
      <div className={style === "lite" ? "auto aside" : "auto"}>{T.pamphlet.art.autoLite}</div>
      <Tick className={`c${STYLE_ORDER.indexOf(style)}`} />
    </>
  );
}

/** A 登录码 as 我的资料 gives it, and the way in with a password */
function ArtLogin() {
  return (
    <div className="pa-card">
      <div className="row">
        <b>{T.common.loginCode}</b>
        <span>{T.pamphlet.art.codeValid}</span>
      </div>
      <div className="code">K7QM-9XPR</div>
      <div className="once">{T.pamphlet.art.codeOnce}</div>
      <div className="cut" />
      <div className="pw">{T.login.usePasswordLink}</div>
    </div>
  );
}

/** The site's name with the megaphone, and 更新记录 with its newest lines (src/lib/changelog.ts), as they are */
function ArtNotice() {
  return (
    <>
      <div className="isle">
        <span className="nm">{siteName()}</span>
        <span className="horn">
          <Horn size={18} color="#ffffff" />
          <i />
        </span>
      </div>
      <div className="tap">{T.pamphlet.art.tapMegaphone}</div>
      <div className="pa-card">
        <div className="head">
          <span className="a">{T.notices.title}</span>
          <span className="b">{T.notices.tabLog}</span>
          <span className="n">{fmt(T.pamphlet.art.logTotal, { n: CHANGELOG.length })}</span>
        </div>
        {newestLines(CHANGELOG, 3).map((l) => (
          <div key={l.hi} className={`ln${l.vague ? " vague" : ""}`}>
            <span className="no">{l.lo === l.hi ? `#${l.hi}` : `#${l.lo}–${l.hi}`}</span>
            <span className={`kind ${l.kind}`}>{T.notices.log.kinds[l.kind]}</span>
            <span className="t">{l.lo === l.hi ? l.text : fmt(T.notices.log.folded, { text: l.text, n: l.hi - l.lo + 1 })}</span>
          </div>
        ))}
      </div>
    </>
  );
}
