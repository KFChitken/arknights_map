"use client";

import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { GUIDES } from "@/lib/guides";
import { siteName } from "@/lib/rules";
import RoachIcon from "../../RoachIcon";
import { FriendsMark } from "../FriendsSheet";
import { NoticeButton } from "../NoticeBoard";
import {
  Chev,
  countsTap,
  DeskHint,
  Envelope,
  FoldArrow,
  GuideFace,
  GUIDE_ORDER,
  HotFlame,
  MailBadge,
  mailLabel,
  MeAvatar,
  RadarScope,
  TicketIcon,
  UiIcon,
  useSwipeAway,
  VisitorButtons,
  WaitingButton,
  type ChromeProps,
  type Counts,
} from "./parts";
import "./hud.css";

/**
 * 游戏风: as in a game, your name plate top left with 消息 and 公告, the counts under it, 方舟雷达 always turning top
 * right, the guides as tabs on the right edge (they fold away), 热榜, the map's style, the base map and 界面 down the
 * left, 触须之交 bottom left, and 我的蟑螂 with one big round 我宣布个事儿 bottom right.
 */
export default function HudChrome(p: ChromeProps) {
  const { fold, onFold } = p;
  const folded = fold.hud.r;
  const setFolded = (away: boolean) => onFold({ ...fold, hud: { r: away } });
  const swipe = useSwipeAway("right", () => setFolded(true));
  const me = p.me;
  // the columns make room for the 站长's panel of reported roaches; putting a roach down, only the plate stays
  const sides = !p.placing && !p.reported;
  const ui = sides && !p.tutorial ? p.ui : null;
  const bm = p.basemap;
  return (
    <div className="chrome chrome-hud">
      <div className="topl">
        {me ? (
          <button className="plate glass" onClick={me.onProfile}>
            <span className="av">
              <MeAvatar me={me} size={32} />
            </span>
            <span className="pw">
              <b>{me.name}</b>
              <small>{T.ui.hud.profile} ›</small>
            </span>
          </button>
        ) : (
          <span className="plate glass guest">
            <span className="av">{p.brand(32)}</span>
            <span className="pw">
              <b>{siteName()}</b>
            </span>
          </span>
        )}
        {me && (
          <button ref={me.mailRef} className="ob glass mail" aria-label={mailLabel(me)} onClick={me.onInbox}>
            <Envelope size={19} />
            <MailBadge me={me} />
          </button>
        )}
        <span className="ob glass">
          <NoticeButton dot={p.noticeDot} onClick={p.onBoard} />
        </span>
        {p.look}
      </div>

      {!p.placing && (
        <div className={`hstat glass${p.onCounts ? " tappable" : ""}`} {...countsTap(p.onCounts)}>
          {me && (
            <>
              <b>{siteName()}</b>
              <span className="vr" aria-hidden="true" />
            </>
          )}
          <HudCounts counts={p.counts} tap={Boolean(p.onCounts)} />
        </div>
      )}

      {!p.placing && <div className="hud">{p.top}</div>}

      {!p.placing && (
        <button className="radarw" onClick={p.onRadar}>
          <span className="ring glass">
            <RadarScope />
          </span>
          <span className="lbl">{T.map.radar}</span>
        </button>
      )}

      {sides && (
        <div className={`lcol${p.raised ? " raised" : ""}`}>
          <span className="rb">
            <button className="ob glass" aria-label={T.map.bar.hot} onClick={p.onHot}>
              <HotFlame size={22} />
            </button>
            <span className="lbl" aria-hidden="true">
              {T.map.bar.hotShort}
            </span>
          </span>
          {p.passes && (
            <span className="rb">
              <button className="ob glass" aria-label={p.passes.dot ? T.map.bar.passesNew : T.map.bar.passes} onClick={p.passes.onOpen}>
                <TicketIcon size={24} dot={p.passes.dot} />
              </button>
              <span className="lbl" aria-hidden="true">
                {T.map.bar.passesShort}
              </span>
            </span>
          )}
          <span className="rb">
            {p.stylePicker(true)}
            <span className="lbl" aria-hidden="true">
              {T.ui.hud.style}
            </span>
          </span>
          {bm && (
            <span className="rb">
              <button
                className="ob glass"
                aria-label={`${T.map.style.basemap} ${bm.now === "amap" ? T.map.style.amap : "OSM"}`}
                disabled={bm.now !== "amap" && !bm.amapOk}
                title={bm.amapOk ? undefined : T.map.style.noAmapKey}
                onClick={() => bm.onSwitch(bm.now === "amap" ? "osm" : "amap")}
              >
                <span className="bm">{bm.now === "amap" ? T.map.style.amap : "OSM"}</span>
              </button>
              <span className="lbl" aria-hidden="true">
                {T.map.style.basemap}
              </span>
            </span>
          )}
          {ui && (
            <span className="rb ui-rb">
              <button
                className={`ob glass${ui.open ? " pressed" : ""}`}
                data-ui-btn
                aria-label={T.ui.button}
                aria-haspopup="menu"
                aria-expanded={ui.open}
                onClick={ui.onToggle}
              >
                <UiIcon size={22} />
              </button>
              <span className="lbl" aria-hidden="true">
                {T.ui.button}
              </span>
              {ui.deskHint && !ui.open && <DeskHint onTap={ui.onToggle} onDone={ui.onDeskHintDone} />}
            </span>
          )}
        </div>
      )}

      {sides && (
        <>
          <nav className={`etabs${folded ? " folded" : ""}`} aria-label={T.common.guides} aria-hidden={folded || undefined} {...swipe}>
            {GUIDE_ORDER.map((id) => (
              <button key={id} className="etab glass" aria-label={GUIDES[id].name} onClick={() => p.onGuide(id)} tabIndex={folded ? -1 : undefined}>
                <GuideFace id={id} size={32} />
                <small aria-hidden="true">{GUIDES[id].short}</small>
              </button>
            ))}
            <button className="nub" aria-label={T.ui.fold.guides} onClick={() => setFolded(true)} tabIndex={folded ? -1 : undefined}>
              <FoldArrow dir="right" />
            </button>
          </nav>
          <button
            className={`tab-r glass${folded ? " shown" : ""}`}
            aria-label={T.ui.fold.openGuides}
            aria-hidden={!folded || undefined}
            tabIndex={folded ? undefined : -1}
            onClick={() => setFolded(false)}
          >
            <Chev dir="left" />
            <span className="stack" aria-hidden="true">
              {GUIDE_ORDER.slice(0, 3).map((id) => (
                <GuideFace key={id} id={id} size={24} />
              ))}
            </span>
            <span className="cnt" aria-hidden="true">
              {fmt(T.ui.fold.guides5, { n: GUIDE_ORDER.length })}
            </span>
          </button>
        </>
      )}

      {!p.placing && me && (
        <div className="act">
          <span className="rb fr">
            <button className="ob glass" onClick={me.onFriends}>
              <FriendsMark size={30} arch="#fff" />
              {me.help && <span className="help-dot" aria-label={T.map.bar.friendsHelp} />}
            </button>
            <span className="lbl" aria-hidden="true">
              {T.map.bar.friends}
            </span>
          </span>
          {me.main && (
            <span className="rb">
              <button className="ob glass" aria-label={T.map.bar.mine} onClick={me.onMine}>
                <RoachIcon color={me.color} size={38} {...me.look} />
              </button>
              <span className="lbl" aria-hidden="true">
                {T.map.bar.mine}
              </span>
            </span>
          )}
          {me.main ? (
            <button className="bigsay" aria-label={T.map.bar.announce} onClick={me.onAnnounce}>
              <span aria-hidden="true">
                {T.map.bar.announceTop}
                <br />
                {T.map.bar.announceBottom}
              </span>
            </button>
          ) : (
            <button className="bigsay" onClick={me.onPlaceMain}>
              {T.map.bar.placeMine}
            </button>
          )}
        </div>
      )}
      {!p.placing && !me && (p.waiting || p.visitor) && (
        <div className="solo glass">{p.waiting ? <WaitingButton waiting={p.waiting} /> : p.visitor && <VisitorButtons visitor={p.visitor} />}</div>
      )}
      {p.disclaimer}
    </div>
  );
}

/** Under the plate: how many are here (on a wide screen, in the world too); a 「›」 where they open 地图上看哪些蟑螂 */
function HudCounts({ counts: c, tap }: { counts: Counts; tap: boolean }) {
  if (c.kind === "loading") return <span>{T.map.loading}</span>;
  if (c.kind === "arriving") return <span>{T.map.count.arriving}</span>;
  if (c.kind === "guest") {
    return (
      <span>
        {fmt(T.map.count.world, { count: c.total })}
        <span className="wide">{T.map.count.signInToSee}</span>
      </span>
    );
  }
  if (c.kind === "hidden") {
    return (
      <span>
        {T.map.count.hidden}
        <span className="wide">{fmt(T.map.count.andWorld, { count: c.total })}</span>
        {tap && " ›"}
      </span>
    );
  }
  if (c.mainsOnly && c.players !== undefined) {
    const mark = <b className="mains">{T.map.count.onlyMainsMark}</b>;
    return (
      <span>
        {fmtNodes(T.ui.hud.herePlayers, { n: <span className="num">{c.here}</span> }, { n: c.here })}
        <span className="wide"> · {fmtNodes(T.map.count.worldOnlyMains, { players: c.players, mark })}</span>
        <span className="narrow"> · {mark}</span>
        {tap && " ›"}
      </span>
    );
  }
  return (
    <span>
      {fmtNodes(T.ui.hud.here, { n: <span className="num">{c.here}</span> }, { n: c.here })}
      <span className="wide">
        {c.players !== undefined
          ? ` · ${fmt(T.map.count.worldAndPlayers, { total: c.total, players: c.players })}`
          : fmt(T.map.count.andWorldTotal, { total: c.total })}
      </span>
      {tap && " ›"}
    </span>
  );
}
