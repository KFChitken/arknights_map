"use client";

import { fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { GUIDES } from "@/lib/guides";
import { siteName } from "@/lib/rules";
import { NoticeButton } from "../NoticeBoard";
import {
  ActButtons,
  BasemapSwitch,
  Chev,
  countsTap,
  DeskHint,
  FoldArrow,
  GuideFace,
  GUIDE_ORDER,
  HotFlame,
  MeSlots,
  RadarScope,
  StudyIcon,
  TicketIcon,
  UiIcon,
  useSwipeAway,
  VisitorButtons,
  WaitingButton,
  type ChromeProps,
  type Counts,
} from "./parts";

/**
 * 浮岛, the default layout: two islands of glass along the top (the site's name with 公告, the map's style and base
 * map), the counts under them, 方舟雷达 with 热榜 and the guides in one column on the right, 界面 on the left, and one
 * bar along the bottom. Each side folds away to a handle at the edge of the screen; the bottom bar and the top stay.
 */
export default function FloatChrome(p: ChromeProps) {
  const { fold, onFold } = p;
  const folded = fold.float;
  const setSide = (side: "l" | "r", away: boolean) => onFold({ ...fold, float: { ...fold.float, [side]: away } });
  const swipeRight = useSwipeAway("right", () => setSide("r", true));
  const swipeLeft = useSwipeAway("left", () => setSide("l", true));
  // the right-hand column makes room for the 站长's panel of reported roaches, and neither side shows while placing
  const sides = !p.placing && !p.reported;
  const ui = sides && !p.tutorial ? p.ui : null;
  return (
    <div className="chrome chrome-float">
      <header className="isle isle-l glass" data-chrome-top>
        {p.brand(26)}
        <span className="isle-name">{siteName()}</span>
        <NoticeButton dot={p.noticeDot} onClick={p.onBoard} />
      </header>
      <div className={`isle isle-r glass switches${p.basemap ? " with-basemap" : ""}${p.raised ? " raised" : ""}`}>
        {p.stylePicker(false)}
        {p.look}
        {p.basemap && <BasemapSwitch {...p.basemap} />}
      </div>

      {!p.placing && (
        <div className="hud">
          <div className={`stats glass${twoLines(p.counts) ? " two" : ""}${p.onCounts ? " tappable" : ""}`} {...countsTap(p.onCounts)}>
            <CountsLine counts={p.counts} />
          </div>
          {p.top}
        </div>
      )}

      {sides && (
        <>
          <nav className={`rail glass${folded.r ? " folded" : ""}`} aria-label={T.common.guides} aria-hidden={folded.r || undefined} {...swipeRight}>
            <div className="rail-in">
              <button className="it scan" onClick={p.onRadar} tabIndex={folded.r ? -1 : undefined}>
                <RadarScope still={folded.r} />
                <small>{T.map.radar}</small>
              </button>
              <button className="it hot" aria-label={T.map.bar.hot} onClick={p.onHot} tabIndex={folded.r ? -1 : undefined}>
                <HotFlame size={22} />
                <small>{T.map.bar.hotShort}</small>
              </button>
              {p.passes && (
                // not .passes, which is 寻访's own page (passes.css) and would cover the whole rail once that is loaded
                <button
                  className="it pass-entry"
                  aria-label={p.passes.dot ? T.map.bar.passesNew : T.map.bar.passes}
                  onClick={p.passes.onOpen}
                  tabIndex={folded.r ? -1 : undefined}
                >
                  <TicketIcon size={24} dot={p.passes.dot} />
                  <small>{T.map.bar.passesShort}</small>
                </button>
              )}
              {p.study && (
                <button
                  className="it study-entry"
                  aria-label={p.study.dot ? T.map.bar.studyNew : T.map.bar.study}
                  onClick={p.study.onOpen}
                  tabIndex={folded.r ? -1 : undefined}
                >
                  <StudyIcon size={24} dot={p.study.dot} />
                  <small>{T.map.bar.studyShort}</small>
                </button>
              )}
              <span className="sep" aria-hidden="true" />
              {GUIDE_ORDER.map((id) => (
                <button key={id} className="it guide" aria-label={GUIDES[id].name} onClick={() => p.onGuide(id)} tabIndex={folded.r ? -1 : undefined}>
                  <GuideFace id={id} size={30} />
                  <small>{GUIDES[id].short}</small>
                </button>
              ))}
            </div>
            <button className="nub" aria-label={T.ui.fold.right} onClick={() => setSide("r", true)} tabIndex={folded.r ? -1 : undefined}>
              <FoldArrow dir="right" />
            </button>
          </nav>
          <button
            className={`tab-r glass${folded.r ? " shown" : ""}`}
            aria-label={T.ui.fold.openRight}
            aria-hidden={!folded.r || undefined}
            tabIndex={folded.r ? undefined : -1}
            onClick={() => setSide("r", false)}
          >
            <Chev dir="left" />
            <RadarScope still />
          </button>
        </>
      )}

      {ui && (
        <>
          <div className={`ui-tile-box${folded.l ? " folded" : ""}`} aria-hidden={folded.l || undefined} {...swipeLeft}>
            <button
              className={`ui-tile glass${ui.open ? " pressed" : ""}`}
              data-ui-btn
              aria-haspopup="menu"
              aria-expanded={ui.open}
              tabIndex={folded.l ? -1 : undefined}
              onClick={ui.onToggle}
            >
              <UiIcon size={26} />
              <small>{T.ui.button}</small>
            </button>
            <button className="nub" aria-label={T.ui.fold.left} onClick={() => setSide("l", true)} tabIndex={folded.l ? -1 : undefined}>
              <FoldArrow dir="left" />
            </button>
            {ui.deskHint && !folded.l && !ui.open && <DeskHint onTap={ui.onToggle} onDone={ui.onDeskHintDone} />}
          </div>
          <button
            className={`tab-l glass${folded.l ? " shown" : ""}`}
            aria-label={T.ui.fold.openLeft}
            aria-hidden={!folded.l || undefined}
            tabIndex={folded.l ? undefined : -1}
            onClick={() => setSide("l", false)}
          >
            <Chev dir="right" />
            <UiIcon size={16} />
          </button>
        </>
      )}

      {!p.placing && <BottomBar {...p} />}
      {p.disclaimer}
    </div>
  );
}

/** The counts' second line in small print, once the server says how many players there are */
const twoLines = (c: Counts) => c.kind !== "loading" && c.kind !== "arriving" && c.players !== undefined;

/** The counts, on one line or two (.stats.two); a 「›」 at their end where they open 地图上看哪些蟑螂 */
export function CountsLine({ counts: c }: { counts: Counts }) {
  if (c.kind === "loading") return <>{T.map.loading}</>;
  if (c.kind === "arriving") return <>{T.map.count.arriving}</>;
  if (c.kind === "guest") {
    return (
      <>
        {fmtParts(T.map.count.world, { count: c.total })}
        <span className="muted">{T.map.count.signInToSee}</span>
        {c.players !== undefined && <span className="l2">{fmtParts(T.map.count.withoutClones, { players: c.players })}</span>}
      </>
    );
  }
  if (c.kind === "hidden") {
    return c.players !== undefined ? (
      <>
        {fmtParts(T.map.count.hiddenWorld, { count: c.total })}
        <span className="l2">{fmtParts(T.map.count.withoutClones, { players: c.players })}</span>
      </>
    ) : (
      <>
        {T.map.count.hidden}
        <span className="muted">{fmtParts(T.map.count.andWorld, { count: c.total })}</span>
      </>
    );
  }
  if (c.mainsOnly && c.players !== undefined) {
    return (
      <>
        {fmtParts(T.map.count.herePlayers, { n: c.here })}
        <span className="l2">
          {fmtNodes(T.map.count.worldOnlyMains, { players: c.players, mark: <b className="mains">{T.map.count.onlyMainsMark}</b> })} ›
        </span>
      </>
    );
  }
  return c.players !== undefined ? (
    <>
      {fmtParts(T.map.count.here, { n: c.here })}
      <span className="l2">{fmtParts(T.map.count.worldAndPlayers, { total: c.total, players: c.players })} ›</span>
    </>
  ) : (
    <>
      {fmtParts(T.map.count.here, { n: c.here })}
      <span className="muted">{fmtParts(T.map.count.andWorldTotal, { total: c.total })}</span>
    </>
  );
}

/** Along the bottom: your look and name, 消息 and 触须之交, then 我的蟑螂 and 我宣布个事儿; before signing in, the way in */
function BottomBar(p: ChromeProps) {
  if (p.me) {
    return (
      <div className="bar glass">
        <MeSlots me={p.me} />
        <ActButtons me={p.me} />
      </div>
    );
  }
  if (p.waiting) {
    return (
      <div className="bar glass solo">
        <WaitingButton waiting={p.waiting} />
      </div>
    );
  }
  if (p.visitor) {
    return (
      <div className="bar glass solo">
        <VisitorButtons visitor={p.visitor} />
      </div>
    );
  }
  return null;
}
