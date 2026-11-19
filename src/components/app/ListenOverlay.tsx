"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { useDiscoChosen } from "@/lib/disco";
import { RX_ROWS, type ListenCall } from "@/lib/listen";
import { DECLARATION_RADIUS_KM } from "@/lib/rules";
import type { InboxItem } from "@/lib/world/types";
import { AsksDot, ChatIcon, DiscoModeSwitch, listenLabel, MegaphoneIcon, NoteIcon, useListenEntry } from "./chrome/parts";
import { callLine, listenRoomNow, sendRx, setListenRxOpen, useListenBubbles, useListenRoom, useListenRx, useListenRxOpen, type ListenBubble } from "./listening";
import "./listenMap.css";

/** An invitation to 一起听, as 消息 has it */
export type ListenInvite = Extract<InboxItem, { kind: "listenInvite" }>;
/** A 宣言一起听 you got, as 消息 has it: the declaration, with its room as it is now */
export type ListenCallItem = Extract<InboxItem, { kind: "declaration" }> & { listen: ListenCall };
/** The card over the map: an invitation that came, or a 宣言一起听; ask: it asks at once whether to switch rooms */
export type ListenCard = { kind: "invite"; invite: ListenInvite; ask: boolean } | { kind: "call"; call: ListenCallItem; ask: boolean };

/**
 * 一起听 over the map (MapApp.tsx): the card of an invitation or a 宣言一起听 that came while the page is open, the 短评
 * floating by 听歌's entry (over its panel while that is open; alone, only there), and the small bubble beside the entry that pops the row of 短评 up
 * over the layout's bottom bar, and after it 舞台 | 拉远 while the disco is on. Placed by what each layout marks (data-listen-anchor on 听歌's entry, data-chrome-bottom
 * on its bottom bar), so the same in all three; where the entry is out of sight (抽屉's tabs make room for the
 * tutorial, a side is folded away), the bubble stands in for it under the top and opens 一起听 instead. None of it
 * shows while a roach's card is open, and a 短评 that came meanwhile is not shown after.
 */
export default function ListenOverlay({
  panelOpen,
  cardOpen,
  disco,
  card,
  onOpen,
  onJoin,
  onLater,
  onJoinCall,
  onSkipCall,
  onDismiss,
}: {
  panelOpen: boolean;
  /** A roach's card is open: nothing floats over it */
  cardOpen: boolean;
  /** 听歌's disco is there for the player (src/lib/disco.ts discoOpenTo) */
  disco: boolean;
  /** The card of an invitation or a 宣言一起听 (asking at once whether to switch rooms, when tapped in 消息 while in one) */
  card: ListenCard | null;
  /** 听歌's panel at 一起听, from the bubble where the entry is out of sight */
  onOpen: () => void;
  /** Within the tap (it may start a song) */
  onJoin: (invite: ListenInvite) => void;
  onLater: (invite: ListenInvite) => void;
  onJoinCall: (call: ListenCallItem) => void;
  /** 不了 */
  onSkipCall: (call: ListenCallItem) => void;
  /** 先不换, or the card gone otherwise */
  onDismiss: () => void;
}) {
  const room = useListenRoom();
  const dancing = useDiscoChosen() && disco;
  const showCard = Boolean(card) && !cardOpen;
  // 一个人听, the panel open: the 短评 said there float over it as yours
  const alone = !room && panelOpen;
  const spot = useSpot(Boolean(room) || showCard || alone);
  // the row of 短评, out or not as the player's 短评 left it too (in the player while it is open, which has its own)
  const strip = useListenRxOpen();
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripH, setStripH] = useState(0);
  const inRoom = Boolean(room);
  // over the map by the entry it opens from, and not while that is out of sight
  const stripOn = strip && inRoom && !panelOpen && Boolean(spot?.anchor);
  useEffect(() => {
    if (!stripOn) return setStripH(0);
    const el = stripRef.current;
    if (el) setStripH(el.offsetHeight);
  }, [stripOn, spot]);
  if (!spot || cardOpen) return null;
  const up = spot.anchor?.side === "up";
  // over the layout's bottom bar; on 抽屉, the row of 短评 sits under the bubble and the 短评 above it
  const above = spot.vh - spot.bottom + 8;
  // the cards of an invitation or a 宣言一起听: above the bar of a round of 一起卫戍 too, where it stands
  const cardsAbove = spot.vh - spot.cards + 8;
  const chat: CSSProperties | null = spot.anchor
    ? up
      ? { left: spot.anchor.x + spot.anchor.w / 2 - 17, bottom: stripOn ? above + stripH + 6 : spot.vh - spot.anchor.y + 8 }
      : { left: spot.anchor.x + spot.anchor.w + 8, top: spot.anchor.y + spot.anchor.h / 2 - 17 }
    : { left: 12, top: spot.top + 10 };
  return (
    <>
      {room && !panelOpen && chat && spot.anchor && (
        <button
          className={`lm-chat glass${stripOn ? " open" : ""}`}
          style={chat}
          aria-label={T.map.bar.listenChat}
          aria-expanded={stripOn}
          onClick={() => setListenRxOpen(!strip)}
        >
          <ChatIcon />
        </button>
      )}
      {room && !panelOpen && chat && spot.anchor && dancing && <DiscoModeSwitch style={afterChat(chat)} />}
      {room && !panelOpen && chat && !spot.anchor && <BackToRoom style={chat} onOpen={onOpen} />}
      {(room || alone) && <Bubbles style={bubblesAt(spot, panelOpen, chat, up)} over={panelOpen} centered={panelOpen && !spot.wide} />}
      {stripOn && (
        <div ref={stripRef} className="lm-strip glass" style={{ bottom: above }}>
          <Strip />
        </div>
      )}
      {showCard && card?.kind === "invite" && !stripOn && (
        <InviteCard
          key={`${card.invite.id}${card.ask ? ":ask" : ""}`}
          invite={card.invite}
          ask={card.ask}
          bottom={cardsAbove}
          onJoin={onJoin}
          onLater={onLater}
          onDismiss={onDismiss}
        />
      )}
      {showCard && card?.kind === "call" && !stripOn && (
        <CallCard
          key={`${card.call.id}${card.ask ? ":ask" : ""}`}
          call={card.call}
          ask={card.ask}
          bottom={cardsAbove}
          onJoin={onJoinCall}
          onSkip={onSkipCall}
          onDismiss={onDismiss}
        />
      )}
    </>
  );
}

/** 💬's size, 舞台 | 拉远's height (listenMap.css, chrome.css) and the room between them */
const CHAT = 34;
const MODE_H = 30;
const MODE_GAP = 6;

/** 舞台 | 拉远 right after 💬, its middle level with 💬's */
function afterChat(chat: CSSProperties): CSSProperties {
  const left = Number(chat.left) + CHAT + MODE_GAP;
  const lift = (CHAT - MODE_H) / 2;
  return chat.top !== undefined ? { left, top: Number(chat.top) + lift } : { left, bottom: Number(chat.bottom) + lift };
}

/** In for 听歌's entry while it is out of sight: the note, lit, opening 一起听 (whose panel has the 短评 too) */
function BackToRoom({ style, onOpen }: { style: CSSProperties; onOpen: () => void }) {
  const e = useListenEntry();
  return (
    <button className="lm-chat lm-back glass" style={style} aria-label={listenLabel(e)} aria-haspopup="dialog" onClick={onOpen}>
      <NoteIcon size={18} />
      <AsksDot n={e.asks} />
    </button>
  );
}

/** Where the 短评 float: by the entry's bubble (under it, or above it on 抽屉), over the panel while it is open */
function bubblesAt(spot: Spot, panelOpen: boolean, chat: CSSProperties | null, up: boolean): CSSProperties {
  if (panelOpen && spot.panel) {
    const p = spot.panel;
    // on a computer beside the panel, at its top; on a phone above the sheet, or over its top where there is no room
    if (spot.wide) return { left: p.x + p.w + 12, top: p.y + 12 };
    return p.y > 70 ? { left: 0, right: 0, bottom: spot.vh - p.y + 8 } : { left: 0, right: 0, top: p.y + 52 };
  }
  if (up && chat && typeof chat.bottom === "number") return { left: Math.max(8, (chat.left as number) - 4), bottom: chat.bottom + 42 };
  if (chat && typeof chat.top === "number") return { left: chat.left, top: chat.top + 40 };
  return { left: 12, top: spot.top + 10 };
}

/** Two at most, the newest last; each goes on its own after RX_SHOW_MS */
function Bubbles({ style, over, centered }: { style: CSSProperties; over: boolean; centered: boolean }) {
  const all = useListenBubbles();
  const shown = all.slice(-2);
  return (
    <div className={`lm-bubbles${over ? " over" : ""}${centered ? " centered" : ""}`} style={style} aria-live="polite">
      {shown.map((b: ListenBubble) => (
        <span key={b.key} className={`lm-bub ${b.kind}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

/** The row of 短评 over the bottom bar, swiped sideways: the room's own first after the first row, as on the plan */
function Strip() {
  const rx = useListenRx();
  const off = rx.cool || rx.full;
  const rows = T.listen.rx;
  // numbers as the server knows them: the rows one after the other (src/lib/listen.ts RX_ROWS)
  const startOf = (row: number) => RX_ROWS.slice(0, row).reduce((n, x) => n + x, 0);
  return (
    <>
      <div className="lm-sh">{T.listen.rxStrip}</div>
      <div className="lm-chips">
        {[0, 2, 1].flatMap((row) =>
          rows[row].map((text, i) => (
            <button key={`${row}-${i}`} className={`lm-chip${row === 2 ? " room" : ""}`} disabled={off} onClick={() => sendRx(startOf(row) + i)}>
              {text}
            </button>
          )),
        )}
      </div>
    </>
  );
}

/**
 * The invitation that came: 一起听 goes in (asked first, when you are in a room already: 换过去 or 先不换); 下次吧
 * lets it be (the host sees 没来, as when it runs out). One to 卫戍的一起听 (squad) says so, and that not joining is fine.
 */
function InviteCard({
  invite,
  ask,
  bottom,
  onJoin,
  onLater,
  onDismiss,
}: {
  invite: ListenInvite;
  ask: boolean;
  bottom: number;
  onJoin: (invite: ListenInvite) => void;
  onLater: (invite: ListenInvite) => void;
  onDismiss: () => void;
}) {
  const [asking, setAsking] = useState(ask);
  const who = invite.from.displayName;
  return (
    <div className="lm-invite" role="alert" style={{ bottom }}>
      <div className="lm-ih">
        <NoteIcon size={18} />
        <span>{fmt(invite.squad ? T.squad.listen.invited : T.listen.invitedYou, invite.squad ? { host: who } : { name: who })}</span>
      </div>
      {invite.squad && !asking && <small className="lm-either">{T.squad.listen.either}</small>}
      {asking ? (
        <>
          <small>{T.listen.switchAsk}</small>
          <div className="lm-ib">
            <button className="acc" onClick={() => onJoin(invite)}>
              {T.listen.switchYes}
            </button>
            <button className="dec" onClick={onDismiss}>
              {T.listen.switchNo}
            </button>
          </div>
        </>
      ) : (
        <>
          <small>{fmt(T.listen.inviteLine, { song: invite.song, rest: fmt(T.listen.inviteFor, { n: invite.n }) })}</small>
          <div className="lm-ib">
            <button className="acc" onClick={() => (listenRoomNow() ? setAsking(true) : onJoin(invite))}>
              {T.listen.join}
            </button>
            <button className="dec" onClick={() => onLater(invite)}>
              {T.listen.later}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A 宣言一起听 that came: 进去听 goes in, without the host's say (asked first, when you are in a room already); 不了 lets
 * it be, read. Who sent it is not said, as of any declaration sent nearby.
 */
function CallCard({
  call,
  ask,
  bottom,
  onJoin,
  onSkip,
  onDismiss,
}: {
  call: ListenCallItem;
  ask: boolean;
  bottom: number;
  onJoin: (call: ListenCallItem) => void;
  onSkip: (call: ListenCallItem) => void;
  onDismiss: () => void;
}) {
  const [asking, setAsking] = useState(ask);
  return (
    <div className="lm-invite call" role="alert" style={{ bottom }}>
      <div className="lm-ih">
        <MegaphoneIcon size={18} />
        <span>{fmt(T.inbox.declared.near, { km: DECLARATION_RADIUS_KM })}</span>
      </div>
      <span className="lm-dq">{fmtParts(T.common.quoted, { text: call.text })}</span>
      {asking ? (
        <>
          <small>{T.listen.switchAsk}</small>
          <div className="lm-ib">
            <button className="acc" onClick={() => onJoin(call)}>
              {T.listen.switchYes}
            </button>
            <button className="dec" onClick={onDismiss}>
              {T.listen.switchNo}
            </button>
          </div>
        </>
      ) : (
        <>
          <small>{callLine(call.listen)}</small>
          <div className="lm-ib">
            <button className="acc" onClick={() => (listenRoomNow() ? setAsking(true) : onJoin(call))}>
              {T.listen.call.join}
            </button>
            <button className="dec" onClick={() => onSkip(call)}>
              {T.listen.call.skip}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- where things are on screen ----

type Box = { x: number; y: number; w: number; h: number };
type Spot = {
  /** 听歌's entry, and which way there is room beside it */
  anchor: (Box & { side: "right" | "up" }) | null;
  /** The top of the layout's bottom bar, and the bottom of what stands at the top */
  bottom: number;
  top: number;
  /** The top of what the cards keep above (the bar of a round of 一起卫戍 on a phone: data-listen-over), else bottom */
  cards: number;
  /** 听歌's panel, while it is open */
  panel: Box | null;
  vw: number;
  vh: number;
  wide: boolean;
};

const box = (r: DOMRect): Box => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });

function readSpot(): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const seen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
  let anchor: Spot["anchor"] = null;
  for (const el of document.querySelectorAll<HTMLElement>("[data-listen-anchor]")) {
    const r = el.getBoundingClientRect();
    if (!seen(r)) continue;
    anchor = { ...box(r), side: el.dataset.listenAnchor === "up" ? "up" : "right" };
    break;
  }
  // what stands right beside the entry (听歌's disco's button, chrome/parts.tsx DiscoButton): the bubble goes past it
  if (anchor?.side === "right") {
    for (const el of document.querySelectorAll<HTMLElement>("[data-listen-beside]")) {
      const r = el.getBoundingClientRect();
      if (seen(r) && r.left >= anchor.x + anchor.w - 1 && r.top < anchor.y + anchor.h && r.bottom > anchor.y) {
        anchor.w = Math.max(anchor.w, Math.round(r.right) - anchor.x);
      }
    }
  }
  const bottoms = [...document.querySelectorAll<HTMLElement>("[data-chrome-bottom]")].map((el) => el.getBoundingClientRect()).filter(seen);
  const overs = [...document.querySelectorAll<HTMLElement>("[data-listen-over]")].map((el) => el.getBoundingClientRect()).filter(seen);
  const panelEl = document.querySelector(".listen-sheet .sheet, .listen-float");
  const panel = panelEl ? box(panelEl.getBoundingClientRect()) : null;
  const bottom = bottoms.length ? Math.round(Math.min(...bottoms.map((r) => r.top))) : vh - 16;
  return {
    anchor,
    bottom,
    cards: overs.length ? Math.min(bottom, Math.round(Math.min(...overs.map((r) => r.top)))) : bottom,
    top: Math.round(document.querySelector("[data-chrome-top]")?.getBoundingClientRect().bottom ?? 0),
    panel,
    vw,
    vh,
    wide: window.matchMedia("(min-width: 900px)").matches,
  };
}

/** Where things are, looked at again each second and as the window changes (a layout folds a side away, the drawer opens) */
function useSpot(on: boolean): Spot | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  useEffect(() => {
    if (!on) return setSpot(null);
    let last = "";
    const look = () => {
      const s = readSpot();
      const k = JSON.stringify(s);
      if (k === last) return;
      last = k;
      setSpot(s);
    };
    look();
    const t = window.setInterval(look, 1_000);
    window.addEventListener("resize", look);
    window.visualViewport?.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
      window.visualViewport?.removeEventListener("resize", look);
    };
  }, [on]);
  return spot;
}
