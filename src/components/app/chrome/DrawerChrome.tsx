"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { GUIDES } from "@/lib/guides";
import { HOT_BOARDS, type HotList } from "@/lib/hotList";
import { RADAR_RADIUS_KM, siteName } from "@/lib/rules";
import { FriendsMark } from "../FriendsSheet";
import { NoticeButton } from "../NoticeBoard";
import {
  ActButtons,
  BasemapSwitch,
  countsTap,
  DeskHint,
  Envelope,
  GuideFace,
  GUIDE_ORDER,
  HotFlame,
  MailBadge,
  mailLabel,
  MeAvatar,
  MeSlots,
  RadarScope,
  TicketIcon,
  UiIcon,
  useWide,
  VisitorButtons,
  WaitingButton,
  type ChromeProps,
  type Counts,
} from "./parts";
import "./drawer.css";
import { apiFetch } from "@/lib/apiFetch";
import { characterName } from "@/i18n/names";

/**
 * 抽屉: on a phone, a capsule along the top (the site's name, 公告, 界面, the map's style and base map), 方舟雷达, 热榜
 * and the guides as a row of small tabs, and a drawer along the bottom with the counts and your buttons, pulled up
 * for the radar's last scan, the week's hot list and the guides. On a computer, all of it in a panel down the left.
 * The map keeps clear of the drawer and the panel (chrome.css), so Amap's mark always shows.
 */
export default function DrawerChrome(p: ChromeProps) {
  const wide = useWide();
  return wide ? <Panel {...p} /> : <Phone {...p} />;
}

function Phone(p: ChromeProps) {
  const open = p.drawerOpen && !p.placing;
  const swipe = useDrawerSwipe(open, p.onDrawer);
  // the tabs make room for a roach's card, the tutorial, the 站长's panel, and what the open drawer shows itself
  const chips = !open && !p.placing && !p.card && !p.tutorial && !p.reported;
  return (
    <div className="chrome chrome-drawer">
      <header className={`tb glass${p.raised ? " raised" : ""}`} data-chrome-top>
        {p.brand(26)}
        <span className="nm">{siteName()}</span>
        <NoticeButton dot={p.noticeDot} onClick={p.onBoard} />
        <span className="grow" />
        <UiButton p={p} />
        {p.stylePicker(false)}
        {p.look}
        {p.basemap && <BasemapSwitch {...p.basemap} />}
      </header>

      {!p.placing && <div className="hud">{p.top}</div>}

      {chips && (
        <nav className="dchips" aria-label={T.common.guides}>
          <button className="dchip glass" onClick={p.onRadar}>
            <RadarScope />
            <span>{T.map.radar}</span>
          </button>
          <button className="dchip glass" aria-label={T.map.bar.hot} onClick={p.onHot}>
            <span className="ico">
              <HotFlame size={20} />
            </span>
            <span aria-hidden="true">{T.map.bar.hotShort}</span>
          </button>
          {p.passes && (
            <button className="dchip glass" aria-label={p.passes.dot ? T.map.bar.passesNew : T.map.bar.passes} onClick={p.passes.onOpen}>
              <span className="ico">
                <TicketIcon size={22} dot={p.passes.dot} />
              </span>
              <span aria-hidden="true">{T.map.bar.passesShort}</span>
            </button>
          )}
          {GUIDE_ORDER.map((id) => (
            <button key={id} className="dchip glass" aria-label={GUIDES[id].name} onClick={() => p.onGuide(id)}>
              <GuideFace id={id} size={28} />
              <span aria-hidden="true">{GUIDES[id].short}</span>
            </button>
          ))}
        </nav>
      )}

      {/* while a roach is being put down, the drawer stays (the map keeps its size) but waits */}
      <section className={`dock${open ? " open" : ""}${p.placing ? " idle" : ""}`} inert={p.placing || undefined}>
        <div className="dtop" {...swipe.area}>
          <button
            className="handle"
            aria-label={open ? T.ui.drawer.close : T.ui.drawer.open}
            aria-expanded={open}
            onClick={swipe.tap(() => p.onDrawer(!open))}
          />
          {/* a swipe that starts on them only moves the drawer */}
          <PhoneCounts counts={p.counts} onTap={p.onCounts && swipe.tap(p.onCounts)} />
        </div>
        {open && (
          <div className="more">
            <RadarCard p={p} />
            <HotCard onOpen={p.onHot} />
            <div className="dguides">
              {GUIDE_ORDER.map((id) => (
                <button key={id} aria-label={GUIDES[id].name} onClick={() => p.onGuide(id)}>
                  <GuideFace id={id} size={42} />
                  <small aria-hidden="true">{GUIDES[id].short}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {p.me ? (
          <div className="drow">
            <MeSlots me={p.me} />
            <ActButtons me={p.me} />
          </div>
        ) : p.waiting ? (
          <div className="drow solo">
            <WaitingButton waiting={p.waiting} />
          </div>
        ) : p.visitor ? (
          <div className="drow solo">
            <VisitorButtons visitor={p.visitor} />
          </div>
        ) : (
          <div className="drow" />
        )}
        {p.disclaimer}
      </section>
    </div>
  );
}

/** On a computer: one panel down the left, the map's style and base map over the map on the right */
function Panel(p: ChromeProps) {
  const me = p.me;
  return (
    <div className="chrome chrome-drawer wide">
      <aside className={`dpanel${p.placing ? " idle" : ""}`} inert={p.placing || undefined}>
        <div className="ph" data-chrome-top>
          {p.brand(30)}
          <span className="nm">{siteName()}</span>
          <span className="tag">{T.map.beta}</span>
          <span className="grow" />
          <NoticeButton dot={p.noticeDot} onClick={p.onBoard} />
          <UiButton p={p} />
        </div>
        <PanelCounts counts={p.counts} onTap={p.onCounts} />
        <div className="pa">
          {me ? (
            me.main ? (
              <>
                <button className="b say" onClick={me.onAnnounce}>
                  {T.map.bar.announce}
                </button>
                <button className="b mine" onClick={me.onMine}>
                  {T.map.bar.mine}
                </button>
              </>
            ) : (
              <button className="b say" onClick={me.onPlaceMain}>
                {T.map.bar.placeMine}
              </button>
            )
          ) : p.waiting ? (
            <WaitingButton waiting={p.waiting} />
          ) : p.visitor ? (
            <VisitorButtons visitor={p.visitor} />
          ) : null}
        </div>
        {!p.reported && (
          <>
            <RadarCard p={p} />
            <HotCard onOpen={p.onHot} />
            {p.passes && <PassesCard passes={p.passes} />}
            <h4>{T.ui.drawer.guides}</h4>
            <div className="glist">
              {GUIDE_ORDER.map((id) => (
                <button key={id} onClick={() => p.onGuide(id)}>
                  <GuideFace id={id} size={30} />
                  <span>
                    <b>{GUIDES[id].name}</b>
                    <small>{GUIDES[id].note}</small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="pm">
          {me && (
            <>
              <button className="pme" onClick={me.onProfile}>
                <MeAvatar me={me} size={34} />
                <span>{me.name}</span>
              </button>
              <button ref={me.mailRef} className="pp" aria-label={mailLabel(me)} onClick={me.onInbox}>
                <Envelope size={15} />
                <span aria-hidden="true">{T.map.bar.messages}</span>
                <MailBadge me={me} />
              </button>
              <button className="pp" onClick={me.onFriends}>
                <FriendsMark size={17} arch="#fff" />
                {T.map.bar.friends}
                {me.help && <span className="help-dot" aria-label={T.map.bar.friendsHelp} />}
              </button>
            </>
          )}
        </div>
        {p.disclaimer}
      </aside>
      <div className={`isle-r glass switches${p.raised ? " raised" : ""}`}>
        {p.stylePicker(false)}
        {p.look}
        {p.basemap && <BasemapSwitch {...p.basemap} />}
      </div>
      {!p.placing && <div className="hud">{p.top}</div>}
    </div>
  );
}

/** 界面, round, with 存到桌面's bubble under it once */
function UiButton({ p }: { p: ChromeProps }) {
  const ui = !p.placing && !p.reported && !p.tutorial ? p.ui : null;
  if (!ui) return null;
  return (
    <span className="ib-box">
      <button
        className={`ib${ui.open ? " pressed" : ""}`}
        data-ui-btn
        aria-label={T.ui.button}
        aria-haspopup="menu"
        aria-expanded={ui.open}
        onClick={ui.onToggle}
      >
        <UiIcon size={18} />
      </button>
      {ui.deskHint && !ui.open && <DeskHint onTap={ui.onToggle} onDone={ui.onDeskHintDone} />}
    </span>
  );
}

/** The drawer's first line: how many are here, and in the world */
function PhoneCounts({ counts: c, onTap }: { counts: Counts; onTap?: () => void }) {
  let main: ReactNode;
  let side: ReactNode = null;
  if (c.kind === "loading") main = T.map.loading;
  else if (c.kind === "arriving") main = T.map.count.arriving;
  else if (c.kind === "guest") {
    main = fmt(T.map.count.world, { count: c.total });
    side = T.ui.drawer.signInToSee;
  } else if (c.kind === "hidden") {
    main = T.map.count.hidden;
    side = fmt(T.map.count.world, { count: c.total });
  } else if (c.mainsOnly && c.players !== undefined) {
    main = fmtNodes(T.map.count.herePlayers, { n: <span className="num">{c.here}</span> }, { n: c.here });
    side = fmtNodes(T.map.count.worldOnlyMains, { players: c.players, mark: <b className="mains">{T.map.count.onlyMainsMark}</b> });
  } else {
    main = fmtNodes(T.map.count.here, { n: <span className="num">{c.here}</span> }, { n: c.here });
    side = fmt(T.ui.drawer.worldShort, { total: c.total });
  }
  return (
    <div className={`dstats${onTap ? " tappable" : ""}`} {...countsTap(onTap)}>
      <span className="l1">{main}</span>
      {side && (
        <span className="l2">
          {side}
          {onTap && " ›"}
        </span>
      )}
    </div>
  );
}

/** The panel's counts: the number here large, the world's under it */
function PanelCounts({ counts: c, onTap }: { counts: Counts; onTap?: () => void }) {
  const box = { className: `ps${onTap ? " tappable" : ""}`, ...countsTap(onTap) };
  const go = onTap && (
    <span className="go" aria-hidden="true">
      ›
    </span>
  );
  if (c.kind === "here") {
    const mains = c.mainsOnly && c.players !== undefined;
    return (
      <div {...box}>
        <small>{T.ui.drawer.here}</small>
        <div className="big">
          <b>{c.here}</b>
          {mains ? T.ui.drawer.hereUnitPlayers : T.ui.drawer.hereUnit}
        </div>
        <small>
          {c.mainsOnly && c.players !== undefined
            ? fmtNodes(T.map.count.worldOnlyMains, { players: c.players, mark: <b className="mains">{T.map.count.onlyMainsMark}</b> })
            : c.players !== undefined
              ? fmt(T.map.count.worldAndPlayers, { total: c.total, players: c.players })
              : fmt(T.ui.drawer.worldShort, { total: c.total })}
        </small>
        {go}
      </div>
    );
  }
  const line =
    c.kind === "loading"
      ? T.map.loading
      : c.kind === "arriving"
        ? T.map.count.arriving
        : c.kind === "guest"
          ? fmt(T.map.count.world, { count: c.total })
          : T.map.count.hidden;
  const under =
    c.kind === "guest"
      ? T.ui.drawer.signInToSee
      : c.kind === "hidden"
        ? fmt(T.map.count.world, { count: c.total })
        : null;
  const players = c.kind === "guest" || c.kind === "hidden" ? c.players : undefined;
  return (
    <div {...box}>
      <div className="big line">{line}</div>
      {under && <small>{under}</small>}
      {players !== undefined && <small>{fmt(T.map.count.withoutClones, { players })}</small>}
      {c.kind === "hidden" && go}
    </div>
  );
}

/** 通行证寻访 in the computer's panel, under 热榜: the tickets the player holds */
function PassesCard({ passes }: { passes: NonNullable<ChromeProps["passes"]> }) {
  return (
    <button className="dcard" aria-label={passes.dot ? T.map.bar.passesNew : T.map.bar.passes} onClick={passes.onOpen}>
      <TicketIcon size={40} dot={passes.dot} />
      <span className="tx" aria-hidden="true">
        <b>{T.map.bar.passes}</b>
        <small>{fmt(T.map.bar.passesTickets, { n: passes.tickets })}</small>
      </span>
      <span className="go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** 方舟雷达: its last scan on this page (a scan is never made for the card, they are few a day), or the way to one */
function RadarCard({ p }: { p: ChromeProps }) {
  const r = p.radar;
  let title: ReactNode;
  let note: string | null = null;
  if (r) {
    title = fmtNodes(T.ui.drawer.radar, { km: r.radiusKm, n: <span className="num">{r.roaches.toLocaleString()}</span> }, { n: r.roaches });
    const net = r.day.arrived - r.day.left;
    note = fmt(net < 0 ? T.ui.drawer.radarFromLess : T.ui.drawer.radarFrom, { players: r.players.toLocaleString(), net: Math.abs(net) });
  } else {
    title = p.me ? fmt(T.ui.drawer.radarAsk, { km: RADAR_RADIUS_KM }) : T.ui.drawer.radarSignIn;
  }
  return (
    <button className="dcard" onClick={p.onRadar}>
      <RadarScope />
      <span className="tx">
        <b>{title}</b>
        {note && <small>{note}</small>}
      </span>
      <span className="go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

// 本周舟P热榜, read once a few minutes (the server keeps it as long), whichever card asks
const HOT_KEEP_MS = 5 * 60_000;
let hotKept: { at: number; list: HotList } | null = null;

function useHot() {
  const [list, setList] = useState<HotList | null>(() => hotKept?.list ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (hotKept && Date.now() - hotKept.at < HOT_KEEP_MS) return;
    let live = true;
    apiFetch("/api/hot")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) throw new Error(String(res.status));
        hotKept = { at: Date.now(), list: body as HotList };
        if (live) setList(hotKept.list);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { list, failed };
}

/** The first three of 本周舟P热榜's first list; a tap opens all of it */
function HotCard({ onOpen }: { onOpen: () => void }) {
  const { list, failed } = useHot();
  const board = HOT_BOARDS[0];
  const rows = list?.boards[board.id]?.slice(0, 3) ?? [];
  return (
    <button className="dcard dhot" onClick={onOpen}>
      <span className="kick">WEEKLY HOT LIST</span>
      <span className="hh">{fmt(T.ui.drawer.hotHead, { board: board.name })}</span>
      {rows.length > 0 ? (
        <span className="rows">
          {rows.map((r) => (
            <span key={r.character} className="row">
              <i>{r.rank}</i>
              {characterName(r.character)}
              {r.games.length > 0 && <span className="g">{r.games.map((g) => T.hot.tag[g]).join(" / ")}</span>}
              <span className="n">{fmt(T.hot.players, { n: r.players })}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="none">{list ? T.ui.drawer.hotNone : failed ? T.hot.failed : T.hot.counting}</span>
      )}
    </button>
  );
}

/**
 * The drawer's top (its handle and the counts) follows a finger: up opens it, down closes it. A tap on the handle
 * does either; the tap a swipe ends with does nothing more.
 */
function useDrawerSwipe(open: boolean, onDrawer: (open: boolean) => void) {
  const start = useRef<{ y: number; id: number } | null>(null);
  const swiped = useRef(false);
  return {
    area: {
      onPointerDown: (e: React.PointerEvent) => {
        start.current = { y: e.clientY, id: e.pointerId };
        swiped.current = false;
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const dy = e.clientY - s.y;
        if (Math.abs(dy) < 24) return;
        start.current = null;
        swiped.current = true;
        if ((dy < 0) !== open) onDrawer(dy < 0);
      },
      onPointerUp: () => {
        start.current = null;
      },
      onPointerCancel: () => {
        start.current = null;
      },
    },
    tap: (then: () => void) => () => {
      if (swiped.current) {
        swiped.current = false;
        return;
      }
      then();
    },
  };
}
