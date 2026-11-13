"use client";

import dynamic from "next/dynamic";
import type { StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmt, fmtParts, T } from "@/i18n";
import { AMIYA_AMAP_ZOOM, AMIYA_AT, AMIYA_ID, amiyaLine, amiyaRoach, localDay } from "@/lib/amiya";
import { deleteAccount, reconsent, signOut } from "@/lib/authClient";
import { loadAMap } from "@/lib/amap";
import { loadTMap, tencentConfigured } from "@/lib/tencentMap";
import type { EarnedBadge } from "@/lib/badges";
import { alonePopping, markBadgesPopped, poppedBadges, poppedKey, poppedStorageKey } from "@/lib/badgesPopped";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/shapes";
import { countPlayers, drawnWith } from "@/lib/world/onlyMains";
import { GUIDES, guideById, type GuideId } from "@/lib/guides";
import { declarationText, type Declaration, type Template } from "@/lib/declarations";
import { EVENTS } from "@/lib/events";
import type { Place } from "@/lib/geocode";
import { loadLook, REAL_LOOK_OFFERED, saveLook } from "@/lib/look";
import { loadHome, saveHome } from "@/lib/lastHome";
import {
  anniversaryLine,
  awaySentence,
  awayWithWeight,
  friendDay,
  isAnniversary,
  PERLICA_ID,
  PERLICA_LINES,
  PERLICA_MORE,
  perlicaRoach,
  perlicaUnfriend,
  sleptSentence,
  touchBackLine,
  weekLine,
  weightSentence,
} from "@/lib/perlica";
import { answerLine, firstSentence, INK_FROM, inLine, MINGHE_NEAR, paintingTier, SI_AT, SI_ID, SI_LINES, SI_ZOOM, siRoach } from "@/lib/si";
import { brushOf, INN_CENTER, inkNow, innNumbers, toXY } from "@/lib/siInn";
import { INK_LOOKS, variantOf } from "./map/inkArt";
import type { InkTapped } from "./map/inkTap";
import { FIND_ZOOM } from "./map/siLook";
import type { SiMapData, SiMine } from "./map/types";
import {
  FIRE_AT,
  FIRE_ZOOM,
  fireCount,
  fireLevel,
  isNearFire,
  TALULAH_ID,
  TALULAH_LINES,
  talulahRoach,
  talulahTouchLine,
} from "@/lib/talulah";
import {
  dismountLine,
  MINGHE_ID,
  MINGHE_LINES,
  MINGHE_ZOOM,
  mingheDay,
  mingheRoach,
  mingheTouchLine,
  nextStationAt,
  queueBearing,
  queueSpots,
  rideLine,
  stationLine,
  stationOf,
  stopOf,
  trailOf,
} from "@/lib/minghe";
import { isOffLimits, offLimitsMessage } from "@/lib/offLimits";
import { displayName, type Profile, type PublicProfile } from "@/lib/profile";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import type { RoachOpts } from "@/lib/roachSvg";
import { iconPx } from "@/lib/swarm";
import { BUBBLE_FADE_MS, BUBBLE_MS, screenDelta, shoutPlace, shoutZoom, stagePlace, type TouchKind } from "@/lib/touchArt";
import { INBOX_DECLARATIONS, MAX_CLONES, MOVES_PER_DAY, TOUCH_SAME_ROACH_HOURS } from "@/lib/rules";
import type { ReportReason, RoachReportReason } from "@/lib/safety";
import type { Basemap, LngLat, MainlandMap, MapFocus, MapView, RoachStyle } from "@/lib/types";
import { areaFor, boxHolds, boxText, weightOf, type Area } from "@/lib/world/area";
import { RoachAreaCopy, RoachFeedCopy, totalsOf, type AreaTotals } from "@/lib/world/feed";
import { HOUR, reachText } from "@/lib/world/logic";
import { feedIdsOf, sameRoach } from "@/lib/world/packed";
import {
  DEFAULT_MAP_STYLE,
  HEARTS_READY,
  loadMapStyle,
  MAP_STYLE_NAMES,
  MAP_STYLES,
  mapStyleSeen,
  markMapStyleSeen,
  saveMapStyle,
  signInForStyles,
  liteHintSeen,
  markLiteHintSeen,
  storedMapStyle,
  type MapStyle,
} from "@/lib/mapStyle";
import { lagWatch, type LagWatch } from "@/lib/lag";
import { countText } from "@/lib/counts";
import MapStylePicker from "./app/MapStylePicker";
import { ServerWorld } from "@/lib/world/server";
import {
  AgeCheckNeeded,
  ConsentNeeded,
  SignInNeeded,
  TooBusy,
  WorldError,
  type BlockedPlayer,
  type Friend,
  type HelpBoard,
  type Homecoming,
  type Identity,
  type InboxItem,
  type InkTap,
  type MapRoach,
  type Me,
  type OwnRoach,
  type PerlicaItem,
  type PlaceTarget,
  type PretendWhat,
  type PublicRoach,
  type Radar,
  type RideTarget,
  type SiState,
  type TouchResult,
  type VisitorFeed,
  type World,
} from "@/lib/world/types";
import { AmiyaGreetingSheet, AmiyaIntroSheet, introShown, markIntroShown } from "./app/Amiya";
import { musicOn, playMusic, preloadMusic, setMusicOn, stopMusic } from "./app/amiyaMusic";
import { BadgeWall, NewBadge } from "./app/Badges";
import CloneMoveSheet from "./app/CloneMoveSheet";
import { GuideSheet } from "./app/GuideDock";
import ConsentSheet, { PlaceConfirm } from "./app/ConsentSheet";
import DeclareSheet from "./app/DeclareSheet";
import { GuestRadarSheet, markWelcomed, PreviewCard, WelcomeSheet, welcomed } from "./app/GuestPreview";
import { HomecomingSheet } from "./app/Homecoming";
import NoticeBoard, { NoticeStrip, type BoardView } from "./app/NoticeBoard";
import HotSheet from "./app/HotSheet";
import {
  countOpen,
  deskHintSeen,
  deskOffered,
  HomeScreenSheet,
  installOrGuide,
  keepInstallPrompt,
  markDeskHintSeen,
  watchHomeScreen,
} from "./app/HomeScreen";
import IdentitySheet from "./app/IdentitySheet";
import InboxSheet, { amiyaUnfriend, FriendView, pokedBy, ProfileView, type InboxFriendly } from "./app/InboxSheet";
import { dockCounts, firstTab, noticeTitle, tabOf, type InboxTab } from "@/lib/inboxTabs";
import { batchSent, gestureSent, isAwakeGesture, isGesture, type BatchAct, type Gesture } from "@/lib/friendly";
import type { HelpAsk } from "@/lib/help";
import type { Game } from "@/lib/games";
import LoginSheet, { pendingLogin } from "./app/LoginSheet";
import MineSheet from "./app/MineSheet";
import {
  forgetAnniversary,
  forgetDrank,
  lookedAt,
  markAnniversary,
  PerlicaBanner,
  PerlicaIntroSheet,
  perlicaSpot,
  readDrank,
  rememberDrank,
  rewindDrank,
  rewindSpot,
} from "./app/Perlica";
import { forgetMingheHere, markMingheIntroShown, MingheIntroSheet, mingheIntroShown } from "./app/Minghe";
import { forgetSiHere, markSiIntroShown, peekedToday, rememberPeek, SiCard, SiIntroSheet, siIntroShown } from "./app/Si";
import { SiBookSheet } from "./app/SiBook";
import { useSiInks, type SiView } from "./useSiInks";
import type { InkPoint } from "@/lib/siTiles";
import {
  forgetTalulahHere,
  hoodSaid,
  markHoodSaid,
  markTalulahIntroShown,
  TalulahIntroSheet,
  talulahIntroShown,
} from "./app/Talulah";
import PlaceBar from "./app/PlaceBar";
import { CONFIRM_REASON, type PasswordForm } from "./app/PasswordBox";
import PasswordNudge, { nudgePutOff, putOffNudge } from "./app/PasswordNudge";
import OnlyMainsSheet from "./app/OnlyMainsSheet";
import ProfileSheet from "./app/ProfileSheet";
import RadarSheet from "./app/RadarSheet";
import RoachReportSheet from "./app/RoachReportSheet";
import SafetySheet from "./app/SafetySheet";
import AgeCheckSheet from "./app/AgeCheckSheet";
import RoachActor, { POKE_LANDS_MS, PokeActor } from "./app/RoachActor";
import TouchStage, { ShoutStage, type ShoutPlace, type StagePlace, type TouchCast } from "./app/TouchStage";
import { DOCK_ANIM, DockArcs, DockFx, HeardBubbles, type DockAt, type DockFrom, type DockKind, type Heard } from "./app/DockFx";
import FriendActions, { type FriendAct } from "./app/FriendActions";
import GestureStage, { SanityFly } from "./app/GestureStage";
import BatchStage from "./app/BatchStage";
import HelpAskSheet from "./app/HelpAskSheet";
import { TheirHelp } from "./app/HelpRows";
import VisitSheet from "./app/VisitSheet";
import FriendsSheet from "./app/FriendsSheet";
import PartyScene from "./app/PartyScene";
import { playPartyMusic, preloadPartyMusic, stopPartyMusic, type PartyMusic } from "./app/partyMusic";
import {
  boardOpened,
  changeNoticeMemory,
  EMPTY_MEMORY,
  fetchNotices,
  markPopped,
  noticeDot,
  noticeMemory,
  noticeMemoryKept,
  noticeRead,
  noticeToPop,
  onNoticeStamp,
  poppedThisVisit,
  stripClosed,
  stripNotice,
  type NoticeList,
  type NoticeMemory,
  type PublicNotice,
} from "@/lib/notices";
import { PARTY_ZOOM } from "@/lib/party";
import { MyInkCard, MyRoachCard, OtherInkCard, OtherRoachCard } from "./app/RoachCards";
import {
  loadProgress,
  nearestReal,
  saveProgress,
  TutorialCoach,
  tutorialStep,
  type Progress,
} from "./app/Tutorial";
import { belowGuide, besideMain, besideRight, BIKE_MS, guideBox, guideShift, MINE_PX, preloadDance } from "./map/guideMarker";
import type { GuideMark, MapLine, MapOverlay, ShoutMark } from "./map/types";
import { adminCall, AdminError } from "./admin/api";
import MapReported from "./admin/MapReported";
import ZoneDraw from "./admin/ZoneDraw";
import ZoneView from "./admin/ZoneView";
import { MapPulse, type ZoneTool } from "./admin/zoneAim";
import { useGrayNow } from "./GrayMode";
import { isGray } from "@/lib/grayMode";
import {
  actionMayRun,
  hintsMayCome,
  isPamphlet,
  mayPopAmong,
  pamphletMayPop,
  pamphletNotice,
  withPamphlet,
  type PamphletAction,
} from "@/lib/pamphlet";
import RoachIcon from "./RoachIcon";
import FloatChrome from "./app/chrome/FloatChrome";
import "./app/chrome/chrome.css";
import UiMenu from "./app/chrome/UiMenu";
import type { ChromeProps, Counts } from "./app/chrome/parts";
import { DEFAULT_UI, EARLY_UI_MARKS, loadFold, markUiAsked, saveFold, saveUi, shouldAskUi, storedUi, UNFOLDED, type UiFold, type UiName } from "@/lib/uiChoice";

const MaplibreView = dynamic(() => import("./map/MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./map/AmapView"), { ssr: false });
const TencentView = dynamic(() => import("./map/TencentView"), { ssr: false });
// the layouts other than 浮岛, and the question which one, come only to those who use them (src/lib/uiChoice.ts)
const DrawerChrome = dynamic(() => import("./app/chrome/DrawerChrome"), { ssr: false });
const HudChrome = dynamic(() => import("./app/chrome/HudChrome"), { ssr: false });
const UiPicker = dynamic(() => import("./app/chrome/UiPicker"), { ssr: false });
// 最近更新 (src/lib/pamphlet.ts), only once it opens
const Pamphlet = dynamic(() => import("./app/Pamphlet"), { ssr: false });

/**
 * Which scene your dock avatar plays for what just came, one at a time: a new 触须之交,
 * else a bold touch (with the toucher's card), else a sneaky one. Touching back your touch,
 * declaration or reaction counts the same; null when no touch came.
 */
function dockSceneFor(fresh: InboxItem[]): { kind: DockKind; from: DockFrom | null } | null {
  const card = (p: PublicProfile) => ({ name: p.displayName, avatar: p.avatar, color: p.color });
  const friend = fresh.find((i) => i.kind === "friend");
  if (friend?.kind === "friend") return { kind: "friend", from: card(friend.from) };
  // what 触须之交 do for each other (src/lib/friendly.ts)
  if (fresh.some((i) => i.kind === "visit" && i.event === "came")) return { kind: "knock", from: null };
  if (fresh.some((i) => i.kind === "sanity")) return { kind: "sanity", from: null };
  const gesture = fresh.find((i) => i.kind === "gesture" && isAwakeGesture(i.gesture));
  if (gesture?.kind === "gesture" && isAwakeGesture(gesture.gesture)) return { kind: gesture.gesture, from: null };
  if (fresh.some((i) => i.kind === "anniversary")) return { kind: "hearts", from: null };
  if (fresh.some((i) => i.kind === "reaction" && i.from && i.reaction.id === "birthday")) return { kind: "cake", from: null };
  const bold = fresh.find((i) => i.kind === "touch" && i.bold);
  if (bold?.kind === "touch") return { kind: "bold", from: bold.from ? card(bold.from) : null };
  if (fresh.some((i) => i.kind === "touch")) return { kind: "sneaky", from: null };
  return null;
}

/** A heard line that is one of the limited ones gets the 限定 tag */
const isLimitedLine = (text: string) => EVENTS.some((e) => e.lines.some((l) => l.text === text));

const CHINA_VIEW: MapView = { lng: 108, lat: 34, zoom: 2.6 };
/** How long the map waits for the account's data before it starts anyway, when this browser has no home to start at */
const MAP_WAIT_MS = 1500;
/** The map's view settles this long before a new area of roaches is asked for (world/area.ts) */
const AREA_SETTLE_MS = 250;
/** The overview is asked for again, while the map shows it, once this old */
const OVERVIEW_AGAIN_MS = 5 * 60_000;
/** Whether a view has moved away from another (more than about 100 m, or half a zoom level) */
const movedFrom = (a: MapView, b: MapView) => Math.abs(a.lng - b.lng) > 1e-3 || Math.abs(a.lat - b.lat) > 1e-3 || Math.abs(a.zoom - b.zoom) > 0.5;
/** How long one of 佩丽卡监督's notes stays along the top: a line, or two */
const NOTE_MS = [6000, 8000];
/** The ask to set a password waits this long on a quiet map, so whatever opens by itself then comes first */
const PW_NUDGE_AFTER_MS = 3000;
/** One of her notes along the top (src/components/app/Perlica.tsx) */
type PerlicaNote = { lines: string[] };
/** Her report of a time away, with its weight */
const awayNote = (item: PerlicaItem): PerlicaNote => ({
  lines: [awaySentence(item.seconds ?? 0, item.line ?? 0), weightSentence(item.seconds ?? 0)],
});
const pickOf = (n: number) => Math.floor(Math.random() * n);

/** 看被举报的蟑螂's marks on the map, none while it is closed */
const NO_MARKS: { overlays: MapOverlay[]; lines: MapLine[] } = { overlays: [], lines: [] };
/** 阿米娅向导 dances two rounds of her 6.9-second dance when tapped */
const DANCE_MS = 2 * 6900;

/**
 * Her notes on opening the page, after her report of the time away: how long they slept
 * (6.2), the day they became 触须之交 again (6.4) and her weekly report (6.5).
 */
function openingNotes(m: Me | null, list: Friend[]): PerlicaNote[] {
  if (!m) return [];
  const out: PerlicaNote[] = [];
  const drank = readDrank(m.id);
  if (drank && m.perlica.timer !== "on") forgetDrank(m.id);
  else if (drank && !m.drunkUntil) {
    forgetDrank(m.id);
    // woke up by the morning; woken earlier means on another device, where she was not watching
    if (Date.now() >= drank.until) queueSleep(out, (drank.until - drank.at) / 1000);
  }
  const since = list.find((f) => f.id === PERLICA_ID)?.since;
  if (m.perlica.friend && since) {
    const day = friendDay(since, new Date().getTimezoneOffset());
    if (isAnniversary(day) && markAnniversary(m.id, since, day)) out.push({ lines: [anniversaryLine(day)] });
  }
  const week = m.perlica.week;
  if (week) out.push({ lines: [weekLine(week.others ?? 0, week.times ?? 0, week.line ?? 0)] });
  return out;
}
function queueSleep(out: PerlicaNote[], seconds: number) {
  if (seconds > 0) out.push({ lines: [sleptSentence(seconds, pickOf(PERLICA_MORE.slept.length))] });
}
const WORLD_VIEW: MapView = { lng: 100, lat: 25, zoom: 1.2 };

/**
 * Whether to ask a signed-in player on this device which 界面 they want (UiPicker.tsx): once, before anything else on
 * the map but the admin's age question and an updated privacy policy, which a visit with either of them keeps to
 */
const asksUi = (m: Me | null, uiChoice: boolean) => Boolean(m && uiChoice && !m.ageCheck && !m.mustReconsent && shouldAskUi());

type Panel =
  /** draft: unsaved changes kept while 我的称号 was open */
  | { kind: "profile"; draft?: Profile; password?: PasswordForm }
  /** 地图上看哪些蟑螂 (只看本体), from the counts at the top, or from 资料 (back: to it, with its unsaved changes) */
  | { kind: "onlyMains"; back?: Panel }
  | { kind: "badges"; draft: Profile }
  /** greeting: 阿米娅向导's of the day, and away: 佩丽卡监督's report of the time away, which this card then carries */
  | { kind: "homecoming"; homecoming: Homecoming; items: InboxItem[]; greeting: AmiyaItem | null; away: PerlicaItem | null }
  /** 阿米娅向导's greeting of the day, on a day without 欢迎回家 */
  | { kind: "amiyaGreeting"; item: AmiyaItem }
  /** 阿米娅向导 introduces herself, once */
  | { kind: "amiyaIntro" }
  /** 佩丽卡监督 shows up and asks whether she may keep the time, once */
  | { kind: "perlicaIntro" }
  /** 塔露拉干员 lit a fire on Sun Island, said once */
  | { kind: "talulahIntro" }
  /** Every clone is out: which one goes to sit by 塔露拉干员's fire */
  | { kind: "fireMove" }
  /** 明河都尉 rides around the country, said once */
  | { kind: "mingheIntro" }
  /** Every clone is out: which one rides with 明河都尉 */
  | { kind: "mingheMove" }
  /** 祀掌柜 opened 缘缘庄 on the map, said once */
  | { kind: "siIntro" }
  /** Your 集章本 from 祀掌柜: her portrait of you first, then this round's seals */
  | { kind: "siBook" }
  | { kind: "mine" }
  /** from: the roaches picked to begin with (墨小强's card picks it, INK_FROM) */
  | { kind: "declare"; initial?: Template; from?: string[] }
  | { kind: "identity" }
  /** items is a snapshot taken on open, so new ones stay highlighted after they are marked seen */
  | { kind: "inbox"; notice: boolean; items: InboxItem[]; tab: InboxTab; viewed: InboxTab[] }
  /** target: the message the profile came with, for blocking or reporting */
  | { kind: "viewProfile"; profile: PublicProfile; target: string; back: Panel }
  | { kind: "friend"; friendId: string; back: Panel | null }
  /** Everyone you are 触须之交 with, as a grid (from the dock) */
  | { kind: "friends" }
  /** 发求助, from the 触须之交 page */
  | { kind: "helpAsk"; back: Panel | null }
  /** 做客 at one of a 触须之交's roaches: asked first, then (every clone out) which clone goes */
  | { kind: "visitConfirm"; friendId: string; roach: PublicRoach }
  | { kind: "visitMove"; friendId: string; roach: PublicRoach }
  | { kind: "radar"; radar: Radar | null }
  | { kind: "safety"; target: string; who: string | null; back: Panel | null }
  /** 举报这只蟑螂, from its card on the map */
  | { kind: "roachReport"; roach: PublicRoach }
  /** confirm: a signed-in player confirming it is them by code, for their password, then back to 我的资料 */
  | { kind: "login"; reason?: string; confirm?: { email: string; form: PasswordForm; draft: Profile } }
  /** 隐私说明更新了; then: what was going to open first */
  | { kind: "consent"; then?: Panel | null }
  /** Which 界面 this device wants, asked once (UiPicker.tsx); then: what comes after it */
  | { kind: "uiPicker"; then: (() => void) | null }
  | { kind: "ageCheck" }
  /** consent: the player's first roach, so the card asks them to agree its spot is public */
  | { kind: "placeConfirm"; target: PlaceTarget; spot: LngLat; fly: boolean; consent: boolean }
  // open to everyone
  | { kind: "hot" }
  /** 存到桌面, where the browser offers no install prompt of its own: how to do it here */
  | { kind: "homeScreen" }
  /** One of the guides, from the column under 方舟雷达 */
  | { kind: "guide"; id: GuideId }
  // for visitors who have not signed in
  | { kind: "welcome" }
  | { kind: "guestRadar" }
  // the newcomer tutorial's first step
  | { kind: "tutorialCard" };

type Selection =
  | { kind: "other"; roach: PublicRoach }
  | { kind: "mine"; roach: OwnRoach }
  /** Someone else's ink roach at 缘缘庄, as its tile drew it; tap: what the server says of it, null till then (and for visitors) */
  | { kind: "ink"; ink: InkPoint; tap: InkTap | null }
  /** Your own ink roach at 缘缘庄 */
  | { kind: "myInk" };

/** Where an ink roach is, by its tile (src/lib/siTiles.ts InkState) */
const INK_STATES = ["queue", "stay", "out"] as const;

type AmiyaItem = Extract<InboxItem, { kind: "amiya" }>;

type Placing = { target: PlaceTarget; label: string };

const PLACING_LABEL: Record<PlaceTarget["kind"], string> = {
  get main() {
    return T.map.place.main;
  },
  get clone() {
    return T.map.place.clone;
  },
  get move() {
    return T.map.place.move;
  },
};

/**
 * cn: the visitor is in mainland China, so the map is Amap only (OSM just when Amap cannot load).
 * home: for them, the map to start with (src/lib/server/mainlandMap.ts): 高德's, 腾讯's once 高德's map loads ran
 * out this month, or our own.
 * mailPaused: mail domains no sign-in code goes to just now, which the sign-in sheet says.
 * notices: 公告 everyone sees (src/lib/server/notices.ts), as they were when the page was made.
 * uiChoice: players may pick one of the three layouts (src/lib/uiChoice.ts); off (UI_CHOICE=off), everyone has 浮岛.
 */
/** 全员隐匿 is all a visitor who has not signed in can have: every other style says to sign in */
const guestStyles = (): Partial<Record<MapStyle, string>> =>
  Object.fromEntries(MAP_STYLES.filter((s) => s !== "hidden").map((s) => [s, signInForStyles()]));

export default function MapApp({
  cn,
  home = "amap",
  mailPaused = [],
  notices: firstNotices = { stamp: "", notices: [] },
  uiChoice = true,
}: {
  cn: boolean;
  home?: MainlandMap;
  mailPaused?: string[];
  notices?: NoticeList;
  uiChoice?: boolean;
}) {
  const worldRef = useRef<World | null>(null);
  // the development hooks' made-up crowd (zhoupFakeFeed below); the server's roaches come by area (areaRef)
  const feedRef = useRef(new RoachFeedCopy());
  /** 只发看得到的 (world/area.ts): the roaches of the area the map shows, a box or the overview */
  const areaRef = useRef(new RoachAreaCopy());
  // the made-up crowd is on: no area from the server takes its place
  const fakeFeedRef = useRef(false);
  // the whole list as before, not areas: ?whole=1 in the address (to compare), or the server says so (AREA_FEED=off)
  const wholeRef = useRef<boolean | null>(null);
  // 全员隐匿 is drawn: nobody's roaches are, so only how many there are is asked for (and have come)
  const hiddenRef = useRef(false);
  const countsInRef = useRef(false);
  const [fakeFeed, setFakeFeed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  // Visitors from mainland China: the home map wherever China is in view, our own map abroad (src/lib/chinaView.ts).
  // Both maps stay made once made, and only the one on show is used; the home map is made when first needed.
  // The home map is 高德's; 腾讯's when 高德's cannot load; our own, the whole way, when neither can. The server can
  // say to start further down (home): 腾讯's needs its key in the build, or it is our own.
  const chinaRef = useRef<typeof import("@/lib/chinaView") | null>(null);
  const [overseas, setOverseas] = useState<{ style: StyleSpecification; cover: GeoJSON.FeatureCollection } | null>(null);
  const [abroad, setAbroad] = useState(false);
  const firstHome: MainlandMap = !cn ? "amap" : home === "tencent" && !tencentConfigured ? "own" : home;
  const [homeMap, setHomeMap] = useState<MainlandMap>(firstHome);
  const [homeMade, setHomeMade] = useState(true);
  const [overseasMade, setOverseasMade] = useState(false);
  const [homeJump, setHomeJump] = useState<MapFocus | null>(null);
  const [overseasJump, setOverseasJump] = useState<MapFocus | null>(null);
  const homeReady = useRef(false);
  const overseasReady = useRef(false);
  // a change waiting for the other map to finish drawing itself
  const wanted = useRef<"abroad" | "home" | null>(null);
  const [look, setLook] = useState<RoachStyle>("cartoon");
  // 地图画风 (src/lib/mapStyle.ts): this device's pick; 默认 until it is read in the browser
  const [mapStyle, setMapStyle] = useState<MapStyle>(DEFAULT_MAP_STYLE);
  // a map here cannot draw 舟u本色's hearts (no GPU layer)
  const [heartsOff, setHeartsOff] = useState(false);
  // 高德's GPU roach layer cannot run here; whether this device ever picked a style (read in the browser)
  const [noGpu, setNoGpu] = useState(false);
  const [styleStored, setStyleStored] = useState(true);
  // 卡了提醒一次: the hint to try 轻量 is up, and whether this device has had it (read in the browser)
  const [liteHint, setLiteHint] = useState(false);
  const [liteHintDone, setLiteHintDone] = useState(true);
  // 卡了自动换轻量: the style this device had before, for the notice's way back
  const [liteFrom, setLiteFrom] = useState<MapStyle | null>(null);
  // once per device: say the style can be changed
  const [styleHint, setStyleHint] = useState(false);
  // 设个密码 (PasswordNudge.tsx): the ask is up, for a player whose codes may not arrive just now
  const [pwNudge, setPwNudge] = useState(false);
  // 存到桌面: offered unless opened from the desktop icon or installed here; its bubble, once per device
  const [deskOffer, setDeskOffer] = useState(false);
  const [deskHint, setDeskHint] = useState(false);
  const [topRaised, setTopRaised] = useState(false);
  // 界面 (src/lib/uiChoice.ts): this device's layout and folds, 浮岛 unfolded until they are read in the browser; its menu
  const [ui, setUi] = useState<UiName>(DEFAULT_UI);
  const [fold, setFold] = useState<UiFold>(UNFOLDED);
  const [uiRead, setUiRead] = useState(false);
  const [uiMenu, setUiMenu] = useState(false);
  // 抽屉's drawer, pulled up
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 方舟雷达's last scan on this page, which 抽屉 shows on its card (a scan is never made for it: they are few a day)
  const [lastRadar, setLastRadar] = useState<Radar | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // Who is signed in comes a moment after the map on a slow line. A browser that was signed in last time
  // (it remembers the main roach, lib/lastHome) is not shown 「登录」 meanwhile: on every refresh that
  // looked like being signed out, and players asked for a new login code each time.
  const [meKnown, setMeKnown] = useState(false);
  const [wasIn, setWasIn] = useState<boolean | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  const visitorShown = !me && (meKnown || wasIn === false);
  const waitingMe = !me && !meKnown && wasIn === true;
  const [feedRoaches, setFeedRoaches] = useState<MapRoach[]>([]);
  // the shared roach list has come at least once: till then the counts would say 0
  const [feedIn, setFeedIn] = useState(false);
  // not signed in, as the server sees it: how many roaches there are, instead of them (VisitorFeed)
  const [visitorCounts, setVisitorCounts] = useState<Omit<VisitorFeed, "v" | "hidden"> | null>(null);
  // signed in: how many there are in all, by the fire, riding with 明河都尉, and how many players they belong to, as
  // the server says with each area, as the page no longer holds every roach to count them (world/area.ts)
  const [areaTotals, setAreaTotals] = useState<AreaTotals | null>(null);
  // the map shows the overview: one roach for each small square, standing for all of them there
  const [overview, setOverview] = useState(false);
  // Every public id our roaches had on this page: after a move the old one stays in the feed for a moment
  const [ownIds, setOwnIds] = useState<ReadonlySet<string>>(new Set());
  const meIdRef = useRef<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  /** 公告 (src/lib/notices.ts): those everyone sees, as the server last said, and what this device remembers of them */
  const [notices, setNotices] = useState<NoticeList>(firstNotices);
  const noticesRef = useRef(notices);
  noticesRef.current = notices;
  const [noticeMem, setNoticeMem] = useState<NoticeMemory>(EMPTY_MEMORY);
  const noticeMemRef = useRef(noticeMem);
  noticeMemRef.current = noticeMem;
  /** The board, while open; for a notice that popped up, whose visit it was and what opens once it is closed */
  const [board, setBoard] = useState<{ view: BoardView; popped: { userId: string; then: () => void } | null } | null>(null);
  /**
   * 最近更新 (src/lib/pamphlet.ts), the booklet the page adds to the notices, while open: popped up (whose visit it
   * was, and what opens once it is closed), or opened from the board's list (closed, the list is there under it) or
   * from the strip
   */
  const [pamphlet, setPamphlet] = useState<{ from: "popped"; userId: string; then: () => void } | { from: "board" | "strip" } | null>(null);
  /** It popped up by itself on this visit, which has said enough: the hints wait for the next */
  const [pamphletPopped, setPamphletPopped] = useState(false);
  /** Where a button pressed in it takes the player, once what waited for it has had its turn; a press, to look again */
  const pamphletGo = useRef<PamphletAction | null>(null);
  const [pamphletPress, setPamphletPress] = useState(0);
  /** 换个画风: the style card opens (MapStylePicker openSignal) */
  const [styleAsk, setStyleAsk] = useState(0);
  /** The notices as the board, the red dot and the strip have them: the server's, with the booklet among them */
  const boardNotices = useMemo(() => withPamphlet(notices.notices, pamphletNotice(uiChoice)), [notices, uiChoice]);
  const shownNotices = () => withPamphlet(noticesRef.current.notices, pamphletNotice(uiChoice));
  // what this device remembers of them, once the page is in the browser
  useEffect(() => setNoticeMem(noticeMemory()), []);
  /** A change to what this device remembers of the notices, stored as well */
  const rememberNotices = useCallback((change: (m: NoticeMemory) => NoticeMemory) => {
    const next = changeNoticeMemory(change, noticeMemRef.current);
    noticeMemRef.current = next;
    setNoticeMem(next);
  }, []);
  /**
   * Opening the map or signing in: the notice due (noticeToPop) pops up first, and what comes next waits
   * for it to be closed; with none due, what comes next comes now. 最近更新 is among them for a player who may
   * have it now (src/lib/pamphlet.ts): popped up, it is the only thing that pops up by itself on this visit, as
   * the guides' introductions wait for another
   */
  const popNotice = useCallback(
    (m: Me, then: () => void) => {
      const now = Date.now();
      const mayPop = pamphletMayPop(m.joinedAt, now, { tutorial: Boolean(tutorialStep(m, loadProgress(m.id))), gray: isGray() });
      const n = noticeToPop(mayPopAmong(noticesRef.current.notices, mayPop, uiChoice), noticeMemRef.current, now);
      if (!n) return then();
      rememberNotices((mem) => noticeRead(mem, n.id));
      if (!isPamphlet(n)) return setBoard({ view: { kind: "notice", notice: n, counted: true }, popped: { userId: m.id, then } });
      introduced.current = true;
      setPamphletPopped(true);
      setPamphlet({ from: "popped", userId: m.id, then });
    },
    [rememberNotices, uiChoice],
  );
  // The server says with the roaches which notices there are (x-notices): when they are not the ones held, they
  // are asked for again. So an open page sees a new one within the two minutes, with the red dot and the strip;
  // nothing pops up over what the player is doing.
  useEffect(() => {
    let asking = false;
    return onNoticeStamp((stamp) => {
      if (asking || stamp === noticesRef.current.stamp) return;
      asking = true;
      void fetchNotices()
        .then((list) => list && setNotices(list))
        .finally(() => (asking = false));
    });
  }, []);
  /** The button: the list, and the red dot goes out */
  const openBoard = () => {
    rememberNotices((m) => boardOpened(m, shownNotices(), Date.now()));
    setBoard({ view: { kind: "list" }, popped: null });
  };
  /** The strip: its notice (or the booklet), as if the board was opened, too */
  const openStripped = (n: PublicNotice) => {
    rememberNotices((m) => noticeRead(boardOpened(m, shownNotices(), Date.now()), n.id));
    if (isPamphlet(n)) return setPamphlet({ from: "strip" });
    setBoard({ view: { kind: "notice", notice: n, counted: true }, popped: null });
  };
  const closeStrip = (n: PublicNotice) => rememberNotices((m) => stripClosed(m, n.id, shownNotices(), Date.now()));
  /** One notice from the list: read; the booklet opens over the list */
  const boardOpen = (n: PublicNotice) => {
    rememberNotices((m) => noticeRead(m, n.id));
    if (isPamphlet(n)) return setPamphlet({ from: "board" });
    setBoard((b) => b && { ...b, view: { kind: "notice", notice: n, counted: false } });
  };
  /** Back to the list, which is the board opened too */
  const boardList = () => {
    rememberNotices((m) => boardOpened(m, shownNotices(), Date.now()));
    setBoard((b) => b && { ...b, view: { kind: "list" } });
  };
  /** 更新记录, the board's other tab: the notices are not read by it, so a red dot stays */
  const boardLog = () => setBoard((b) => b && { ...b, view: { kind: "log" } });
  /** Closed however, on whichever page: one that popped up counts for this visit, and what waited for it opens */
  const closeBoard = () => {
    const popped = board?.popped;
    setBoard(null);
    if (!popped) return;
    markPopped(popped.userId);
    popped.then();
  };
  /**
   * 最近更新 closed however (read since it opened): one that popped up counts for this visit, says where it is
   * kept, and what waited for it opens. A button pressed in it closes the board it was opened from as well, and
   * takes the player there once all that has had its turn, with no introduction meanwhile
   */
  const closePamphlet = (go?: PamphletAction) => {
    const was = pamphlet;
    setPamphlet(null);
    if (go) {
      pamphletGo.current = go;
      setPamphletPress((n) => n + 1);
      introduced.current = true;
      // 去宏村看看 is her introduction
      if (go === "si" && me) markSiIntroShown(me.id);
    }
    if (was?.from === "popped") {
      markPopped(was.userId);
      was.then();
      setToast(T.pamphlet.putAway);
    } else if (go && was?.from === "board") closeBoard();
  };
  const [selected, setSelected] = useState<Selection | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 站长清理 under way (takeBack below)
  const [cleaning, setCleaning] = useState(false);
  // 看被举报的蟑螂 on the admin's map (components/admin/MapReported.tsx): open (with the case a link named), its
  // marks, and its panel's place under the counts at the top
  const [reported, setReported] = useState<{ start: string | null } | null>(null);
  const [reportedMarks, setReportedMarks] = useState(NO_MARKS);
  const [reportedSlot, setReportedSlot] = useState<HTMLDivElement | null>(null);
  // the 管理台 is locked on this device: its tools on the map wait for a code typed there
  const [adminShut, setAdminShut] = useState(false);

  const [focus, setFocus] = useState<MapFocus | null>(null);
  const viewRef = useRef<MapView>(WORLD_VIEW);
  const boundsRef = useRef<[LngLat, LngLat] | null>(null);
  // 圈禁放区 on the owner's map (components/admin/ZoneDraw.tsx), or one place drawn seen there (ZoneView): which is open,
  // the circle the map draws for it, and where the map rests and whether it moves, for the drawing to follow
  const [zoneTool, setZoneTool] = useState<ZoneTool | null>(null);
  const [zoneLines, setZoneLines] = useState<MapLine[]>([]);
  const [pulse] = useState(() => new MapPulse(viewRef.current));
  const lastMessagesRef = useRef(0);
  // Test identities exist only in development; the live site never asks for them again
  const demoRef = useRef(false);
  // Where a visitor tried putting their roach; kept in this page only, never sent or stored
  const [preview, setPreview] = useState<LngLat | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [greeting, setGreeting] = useState(false);
  // what each guide is saying over her head, for a few seconds
  const [says, setSays] = useState<Partial<Record<GuideId, string>>>({});
  const sayTimers = useRef<Partial<Record<GuideId, number>>>({});
  // where 佩丽卡监督 stands on this page: near the main roach, for this player only, never sent anywhere
  const [perlicaAt, setPerlicaAt] = useState<LngLat | null>(null);
  // her notes along the top, one at a time: the one showing, and those waiting their turn while the player is busy
  const [note, setNote] = useState<PerlicaNote | null>(null);
  const [notes, setNotes] = useState<PerlicaNote[]>([]);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const queueNote = (n: PerlicaNote) => setNotes((q) => [...q, n]);
  // what opens once her notes have had their turn (the inbox, on opening the page)
  const afterReport = useRef<(() => void) | null>(null);
  // where she rode her 鬼火 from, as the main roach moved on this page, until she is there
  const bikeFrom = useRef<LngLat | null | undefined>(undefined);
  const [perlicaArrive, setPerlicaArrive] = useState<{ from: LngLat | null; nonce: number } | null>(null);
  // 假装离开 reloads the page, whose 「走了」 would undo what was just pretended
  const skipLeave = useRef(false);
  // an introduction card showed on this visit already, so the next one waits for another
  const introduced = useRef(false);
  // a touch, or a roach being put down, on its way to the server: a second tap meanwhile is not sent (it would be the same one twice)
  const [touching, setTouching] = useState(false);
  const inFlight = useRef({ touch: false, put: false });
  // other players' roaches touched from this page, by account and the feed's id, and when: within the day
  // their card says what still goes, as a sneaky touch may be followed by a bold one (OtherRoachCard touched)
  const [touchedHere, setTouchedHere] = useState<Record<string, { bold: boolean; at: number }>>({});
  // 塔露拉干员's fire: a clone on its way there, the count pretended in development, and her line to 初始 hoods while her card shows it
  const [sendingToFire, setSendingToFire] = useState(false);
  const [fakeFire, setFakeFire] = useState<number | null>(null);
  const [hoodLine, setHoodLine] = useState<string | null>(null);
  // 明河都尉: the time his day is worked out from (again as he moves on at 04:00), a clone getting on or off, riders pretended in development
  const [mingheClock, setMingheClock] = useState(() => Date.now());
  const [riding, setRiding] = useState(false);
  const [fakeRiders, setFakeRiders] = useState<number | null>(null);
  // 祀掌柜: 缘缘庄's numbers as last fetched, and whether her card was touched since it opened (else 「点开又走了」)
  const [siState, setSiState] = useState<SiState | null>(null);
  const siTouched = useRef(false);
  // the map's view while it shows 宏村 (within a few km of the inn), for drawing 缘缘庄; null elsewhere
  const [siView, setSiView] = useState<SiView | null>(null);
  // she drew your ink roach just now, since then: her brush draws it in on the map
  const [siBrushFrom, setSiBrushFrom] = useState<number | null>(null);
  // 收回 your ink roach under way
  const [recalling, setRecalling] = useState(false);
  // a nudge when your ink roach gets its room or leaves it, so the map and her card catch up
  const [siTick, setSiTick] = useState(0);
  // she answered a touch on the map and has yet to say so over her head (the scene still playing)
  const [siAboutToSay, setSiAboutToSay] = useState(false);
  // 阿米娅向导 dancing since then, after a tap on her: as long as her music, or two rounds of her dance without it
  const [amiyaDance, setAmiyaDance] = useState<number | null>(null);
  const danceTimer = useRef<number | undefined>(undefined);
  const [music, setMusic] = useState(true);
  // the day of his journey, and today's station, where he is
  const day = mingheDay(mingheClock, me?.minghe.dayShift ?? 0);
  const mingheAt = stationOf(day).at;
  // one of her notes is showing or waiting its turn, for what runs after them
  const perlicaBusy = Boolean(note || notes.length);
  const reportDue = useRef(false);
  reportDue.current = perlicaBusy;
  // the first panels of the visit have had their turn, so her introduction can wait behind them
  const [settled, setSettled] = useState(false);
  // 摄入酒精 / 醒酒 played out by your main roach, big, in the middle of the map
  const [acting, setActing] = useState<"drink" | "wake" | null>(null);
  /** ⚡舟友的酒⚡: the dance round your drunk main roach (PartyScene), on the map at its spot, and its music */
  const [party, setParty] = useState<{ key: number; el: HTMLDivElement; at: LngLat; music: Promise<PartyMusic | null> } | null>(null);
  // what opens once the scene is over, so nothing pops up over it
  const afterActing = useRef<(() => void) | null>(null);
  // 戳一戳 under way: the 触须之交's roach it plays over, left off the map meanwhile
  const [poking, setPoking] = useState<PublicRoach | null>(null);
  /** A touch acted out over the map (TouchStage), and what to do once it is over */
  /** gesture: one of 触须之交's own (GestureStage) instead of a touch */
  const [touchScene, setTouchScene] = useState<{
    kind: TouchKind;
    gesture?: Gesture;
    cast: TouchCast;
    place: StagePlace;
    target: string;
    done: () => void;
  } | null>(null);
  /** A sleeping roach touched: it only jolts in its sleep */
  const [jolting, setJolting] = useState<{ roach: PublicRoach; done: () => void } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** A declaration shouted over the map (ShoutStage) from one of your roaches */
  const [shouting, setShouting] = useState<{ roach: string; text: string; limited: boolean; place: ShoutPlace; toast: () => void; done: () => void } | null>(null);
  /** The lines just shouted, each over a roach it went out from, for a few seconds */
  const [shouts, setShouts] = useState<ShoutMark[]>([]);
  /** The touched side: your dock avatar's scene as a touch comes in, and sound coming in with a declaration */
  const [dockScene, setDockScene] = useState<{ kind: DockKind; from: DockFrom | null; at: DockAt; done: () => void } | null>(null);
  const [dockAnim, setDockAnim] = useState<string | null>(null);
  const [badgePop, setBadgePop] = useState(false);
  const [arcs, setArcs] = useState<{ at: DockAt; nonce: number } | null>(null);
  /** Declarations heard nearby, floating over the dock, newest last */
  const [heard, setHeard] = useState<Heard[]>([]);
  const dockAvRef = useRef<HTMLSpanElement>(null);
  const dockMailRef = useRef<HTMLButtonElement>(null);
  /** What the inbox held at the last look, and what came since */
  const inboxIdsRef = useRef<Set<string> | null>(null);
  const freshRef = useRef<InboxItem[]>([]);
  const [pokeSent, setPokeSent] = useState(false);
  /** Something between 触须之交 is under way; and 催理智's bottle flying off its button */
  const [friendBusy, setFriendBusy] = useState(false);
  // 求助 (src/lib/help.ts), loaded when the 触须之交 page opens
  const [helpBoard, setHelpBoard] = useState<HelpBoard | null>(null);
  // 一键, acted out once over the map
  const [batchScene, setBatchScene] = useState<{ act: BatchAct; them: Friend[]; done: () => void } | null>(null);
  const [vialAt, setVialAt] = useState<{ x: number; y: number } | null>(null);
  const [drinking, setDrinking] = useState(false);
  const retryRef = useRef<{ timer?: number; delay: number }>({ delay: 0 });

  // The feed is the same for everyone: leave out our own roaches (drawn from me) and mark friends'
  // (its short ids, world/packed.ts, matched through feedIdsOf)
  const friendKey = friends
    .flatMap((f) => f.roaches.flatMap((r) => feedIdsOf(r.id)))
    .sort()
    .join(",");
  // 只看本体 (OnlyMainsSheet): others' clones are left out of what is drawn and counted; the overview asked for is of
  // main roaches only. Not while the 站长 looks at reported roaches, which may be clones
  const hideClones = Boolean(me?.onlyMains) && !reported;
  const hideClonesRef = useRef(hideClones);
  hideClonesRef.current = hideClones;
  // Each roach stays the same object while the feed's own stays and its friend mark is unchanged, so the
  // maps can tell at once which ones changed: an update of the list changes a few hundred of tens of thousands
  // (the feed keeps its own object for each roach that did not change, and those gone are let go with it)
  const keptRef = useRef(new WeakMap<MapRoach, PublicRoach>());
  const roaches = useMemo<PublicRoach[]>(() => {
    const friendIds = new Set(friendKey.split(","));
    const kept = keptRef.current;
    const out: PublicRoach[] = [];
    for (const r of feedRoaches) {
      if (ownIds.has(r.id)) continue;
      const friend = friendIds.has(r.id);
      // 只看本体: others' clones are not drawn; 触须之交's are, and our own come from me anyway
      if (!drawnWith(r, friend, hideClones)) continue;
      let o = kept.get(r);
      if (!o || o.friend !== friend) {
        o = { ...r, friend };
        kept.set(r, o);
      }
      out.push(o);
    }
    // The overview has one roach for each small square (world/area.ts): a 触须之交's roaches are drawn
    // all the same, standing for nobody more (n 0: their square's roach counts them already)
    if (overview) {
      const shown = new Set(out.map((r) => r.id));
      for (const f of friends) {
        for (const r of f.roaches) if (!feedIdsOf(r.id).some((id) => shown.has(id))) out.push({ ...r, friend: true, n: 0 });
      }
    }
    return out;
  }, [feedRoaches, ownIds, friendKey, overview, friends, hideClones]);

  const applyMe = useCallback((m: Me | null) => {
    const sameOwner = m?.id === meIdRef.current;
    meIdRef.current = m?.id ?? null;
    setMe(m);
    setOwnIds((prev) => {
      const base = sameOwner ? prev : new Set<string>();
      const fresh = (m?.roaches ?? []).filter((r) => !base.has(r.publicId));
      if (!fresh.length) return base;
      const next = new Set(base);
      for (const r of fresh) for (const id of feedIdsOf(r.publicId)) next.add(id);
      return next;
    });
  }, []);

  // Each part of the page is refreshed on its own, only when it may have changed
  const loadMe = useCallback(async () => {
    const m = await worldRef.current!.me();
    applyMe(m);
    setMeKnown(true);
    return m;
  }, [applyMe]);
  /** The ask for an area on its way, by what it asks, so the same one is never asked twice at once */
  const askingRef = useRef<{ key: string; done: Promise<void> } | null>(null);
  /** Signed in or out: the roaches held are dropped, and the next ask is for all of them, with the new cookie */
  const forgetRoaches = useCallback(() => {
    feedRef.current = new RoachFeedCopy();
    areaRef.current = new RoachAreaCopy();
    askingRef.current = null;
    countsInRef.current = false;
    setFeedRoaches([]);
    setAreaTotals(null);
    setOverview(false);
  }, []);
  /** The whole list, as pages asked for it before areas: kept for ?whole=1 and AREA_FEED=off */
  const wholeFeed = useRef<Promise<void> | null>(null);
  const loadWhole = useCallback(async (): Promise<void> => {
    const feed = feedRef.current;
    const ask = async () => {
      try {
        const u = await worldRef.current!.roachFeed(feed.version);
        if (feedRef.current !== feed) return;
        if ("hidden" in u) {
          setVisitorCounts({ total: u.total, fire: u.fire, riders: u.riders, players: u.players });
          if (feed.version) feedRef.current = new RoachFeedCopy();
          setFeedRoaches([]);
        } else {
          setVisitorCounts(null);
          if (feed.apply(u)) setFeedRoaches(feed.roaches);
        }
        setFeedIn(true);
      } catch (e) {
        if (!(e instanceof TooBusy)) throw e;
        if (!feed.version) setToast(e.message);
      }
    };
    if (feed.version) return ask();
    wholeFeed.current ??= ask().finally(() => (wholeFeed.current = null));
    return wholeFeed.current;
  }, []);
  /**
   * The roaches of the area the map shows (world/area.ts). "view": the map moved, so a new area only if
   * the one held no longer covers the view; "poll": also what changed in the box held, and the overview
   * again once OVERVIEW_AGAIN_MS old. Nothing before the map has said where it is: its first report asks.
   */
  const loadRoaches = useCallback(
    async (why: "poll" | "view" = "poll"): Promise<void> => {
      wholeRef.current ??= new URLSearchParams(window.location.search).has("whole");
      if (wholeRef.current) return why === "poll" && !fakeFeedRef.current && worldRef.current ? loadWhole() : undefined;
      const copy = areaRef.current;
      if (fakeFeedRef.current || !worldRef.current) return;
      if (hiddenRef.current) {
        // the counts only, wherever the map is: at first, then on the two minutes' ask; the area held waits as
        // it is for the way back
        if (why === "view" && countsInRef.current) return;
        const u = await worldRef.current.roachArea("counts", null).catch(() => null);
        if (!u || areaRef.current !== copy) return;
        if ("hidden" in u) setVisitorCounts({ total: u.total, fire: u.fire, riders: u.riders, players: u.players });
        else if (u.t) setAreaTotals(totalsOf(u.t));
        countsInRef.current = true;
        setFeedIn(true);
        return;
      }
      const v = viewRef.current;
      const bounds = boundsRef.current;
      if (!v || !bounds) return;
      const want = areaFor(v.zoom, bounds);
      const held = copy.area;
      // 只看本体: the overview of main roaches only (a box comes whole, and the page picks it over)
      const mains = hideClonesRef.current;
      let area: Area = want;
      let since: string | null = null;
      if (want !== "overview" && held && held !== "overview" && boxHolds(held, bounds)) {
        // the box held still covers the view: what changed in it, when it is time to ask
        if (why === "view") return;
        area = held;
        since = copy.version;
      } else if (
        want === "overview" &&
        held === "overview" &&
        copy.mains === mains &&
        (why === "view" || Date.now() - copy.heldAt < OVERVIEW_AGAIN_MS)
      ) {
        return;
      }
      const key = `${area === "overview" ? (mains ? "om" : "o") : boxText(area)}:${since ?? ""}`;
      if (askingRef.current?.key === key) return askingRef.current.done;
      const ask = async () => {
        try {
          const u = await worldRef.current!.roachArea(area, since, area === "overview" && mains);
          // signed in or out meanwhile, or another area asked for since: that one counts
          if (areaRef.current !== copy || askingRef.current?.key !== key) return;
          if ("whole" in u && u.whole) {
            wholeRef.current = true;
            setAreaTotals(null);
            setOverview(false);
            return void loadWhole().catch(() => {});
          }
          if ("hidden" in u) {
            // not signed in (any more): no roaches, only how many there are
            setVisitorCounts({ total: u.total, fire: u.fire, riders: u.riders, players: u.players });
            if (copy.version) forgetRoaches();
          } else {
            setVisitorCounts(null);
            if (copy.apply(u)) {
              setFeedRoaches(copy.roaches);
              setOverview(copy.area === "overview");
            }
            if (copy.totals) setAreaTotals(copy.totals);
          }
          setFeedIn(true);
          retryRef.current.delay = 0;
        } catch (e) {
          // A new area (the view left the one held) refused or failed: the map would go on showing the old one,
          // only where the page opened, say. Said, and asked for again in a few seconds, a little later each time.
          // What changed in the box held, when busy: again later, quietly.
          const fresh = since === null;
          if (!(e instanceof TooBusy) && !fresh) throw e;
          const r = retryRef.current;
          if (r.timer !== undefined) return;
          r.delay = fresh ? Math.min(30, r.delay ? r.delay * 2 : 3) : Math.min(60, r.delay ? r.delay * 2 : (e as TooBusy).retryAfterS);
          if (fresh || !copy.version) setToast(e instanceof WorldError ? e.message : T.requests.offlineRetrying);
          r.timer = window.setTimeout(
            () => {
              r.timer = undefined;
              loadRoaches().catch(() => {});
            },
            r.delay * (750 + Math.random() * 500),
          );
        }
      };
      const done = ask().finally(() => {
        if (askingRef.current?.key === key) askingRef.current = null;
      });
      askingRef.current = { key, done };
      return done;
    },
    [forgetRoaches, loadWhole],
  );
  // the map moved: a new area once the view settles, if the one held does not cover it (a fly sets it off again on
  // landing); with where the map stood when it was set off
  const areaTimerRef = useRef<{ timer?: number; at?: MapView }>({});
  const askAreaSoon = useCallback(
    (at: MapView) => {
      window.clearTimeout(areaTimerRef.current.timer);
      areaTimerRef.current = { timer: window.setTimeout(() => void loadRoaches("view").catch(() => {}), AREA_SETTLE_MS), at };
    },
    [loadRoaches],
  );
  // A fly somewhere starts: the area is asked for where it lands, not where it set off from. With motion turned down
  // MapLibre's fly is a jump, made in the map's own effect, which runs before this one: the ask set off where it
  // landed stays.
  useEffect(() => {
    const { timer, at } = areaTimerRef.current;
    if (focus && at && !movedFrom(at, focus)) return;
    window.clearTimeout(timer);
  }, [focus]);
  const loadInbox = useCallback(async () => {
    const items = await worldRef.current!.inbox();
    lastMessagesRef.current = Date.now();
    const before = inboxIdsRef.current;
    freshRef.current = before ? items.filter((i) => !before.has(i.id)) : [];
    inboxIdsRef.current = new Set(items.map((i) => i.id));
    setInbox(items);
    return items;
  }, []);
  // When only declarations came, only they are asked for (the whole inbox, a hundred declarations with all
  // their replies, went out again for each one, to a whole neighbourhood) and put in with the rest
  const inboxNowRef = useRef<InboxItem[]>([]);
  useEffect(() => {
    inboxNowRef.current = inbox;
  }, [inbox]);
  const loadNewDeclarations = useCallback(async () => {
    const known = inboxIdsRef.current;
    const after = inboxNowRef.current.reduce((t, i) => (i.kind === "declaration" && i.at > t ? i.at : t), 0);
    if (!known || !after) return loadInbox();
    const got = await worldRef.current!.newDeclarations(after);
    lastMessagesRef.current = Date.now();
    const added = got.filter((i) => !known.has(i.id));
    freshRef.current = added;
    for (const i of added) known.add(i.id);
    const merge = (all: InboxItem[]) => {
      let n = 0;
      return [...added, ...all].sort((x, y) => y.at - x.at).filter((i) => i.kind !== "declaration" || ++n <= INBOX_DECLARATIONS);
    };
    if (added.length) setInbox(merge);
    return merge(inboxNowRef.current);
  }, [loadInbox]);
  const loadFriends = useCallback(async () => {
    const list = await worldRef.current!.friends();
    setFriends(list);
    return list;
  }, []);
  const loadIdentities = useCallback(async () => {
    const ids = await worldRef.current!.identities();
    demoRef.current = ids.length > 0;
    setIdentities(ids);
  }, []);

  /** Everything, for opening the page and switching who is signed in; away: 佩丽卡监督's report of the time away, if she has one. */
  const load = useCallback(async () => {
    // the roaches have their own retries and come when they come: on a slow line the whole list can
    // take a minute, and nothing else waits for it
    loadRoaches().catch(() => {});
    const [m, items, list, , away] = await Promise.all([
      loadMe(),
      loadInbox(),
      loadFriends(),
      loadIdentities(),
      // 「还在」, sent along before anyone knows who is signed in; nobody's answer is null
      worldRef.current!.here().catch(() => null),
    ]);
    return { me: m, items, away, friends: list };
  }, [loadMe, loadInbox, loadRoaches, loadFriends, loadIdentities]);

  // Opening a tab is enough to count its messages as read; the red counts go with it
  const markTabSeen = useCallback(
    async (items: InboxItem[], tab: InboxTab) => {
      const unseen = items.filter((i) => !i.seen && tabOf(i) === tab).map((i) => i.id);
      if (!unseen.length) return;
      await worldRef.current!.markSeen(unseen);
      setInbox((all) => all.map((i) => (unseen.includes(i.id) ? { ...i, seen: true } : i)));
      if (demoRef.current) await loadIdentities();
    },
    [loadIdentities],
  );

  const openInbox = useCallback(
    async (notice: boolean, tab?: InboxTab, fresh?: InboxItem[]) => {
      const items = fresh ?? (await loadInbox());
      const t = tab ?? firstTab(items);
      setPanel({ kind: "inbox", notice, items, tab: t, viewed: [t] });
      await markTabSeen(items, t);
    },
    [loadInbox, markTabSeen],
  );

  // The world, basemap and look are read in the browser only, to keep SSR output stable
  useEffect(() => {
    worldRef.current = new ServerWorld();
    setWasIn(loadHome() !== null);
    const b = guessBasemap(cn);
    // The map's code downloads while the first API calls are in flight; the map itself waits for where to start.
    // A failed Amap load is forgotten, so AmapView tries again and falls back to OSM as before; so is Tencent's.
    if (b === "amap" && firstHome === "amap") {
      void import("./map/AmapView");
      loadAMap().catch(() => {});
    } else if (b === "amap" && firstHome === "tencent") {
      void import("./map/TencentView");
      loadTMap().catch(() => {});
    } else void import("./map/MaplibreView");
    // visitors from mainland China: the outline of where Amap must show, and our own map's style for abroad.
    // Our own map's code (MapLibre, the biggest download of the page) comes only once it is made, when the
    // view goes abroad: Amap waited for it before, and most never leave China (2026-11-11, a slow line)
    const abroadKit = cn ? Promise.all([import("@/lib/overseas"), import("@/lib/chinaView")]).catch(() => null) : Promise.resolve(null);
    // The map does not wait for the account's data, which a slow line can hold up for many seconds: it
    // starts at once where this browser last saw the main roach, or after a moment at the usual view,
    // and flies to the main roach when the data comes, unless the player has moved the map meanwhile.
    let started: MapView | null = null;
    const startMap = async (m: Me | null) => {
      if (started) return;
      const main = m?.roaches.find((r) => r.slot === 0);
      const home = main ?? loadHome();
      viewRef.current = home ? { lng: home.lng, lat: home.lat, zoom: 11 } : b === "amap" ? CHINA_VIEW : WORLD_VIEW;
      started = viewRef.current;
      const kit = await abroadKit;
      if (kit) {
        const [{ overseasStyle }, china] = kit;
        chinaRef.current = china;
        setOverseas({ style: overseasStyle(window.location.origin), cover: china.chinaCover() });
        // a visit that starts abroad opens our own map at once; the home map waits until China comes into view
        const v = viewRef.current;
        if (b === "amap" && china.clearOfChina(china.viewAround(v, v.zoom, window.innerWidth, window.innerHeight))) {
          setAbroad(true);
          setOverseasMade(true);
          setHomeMade(false);
        }
      }
      setLook(loadLook());
      setMapStyle(loadMapStyle());
      setStyleStored(storedMapStyle() !== null);
      setLiteHintDone(liteHintSeen());
      setStyleHint(!mapStyleSeen());
      // our own map from the start is the one for abroad, which could not come: OSM in its place
      setBasemap(b === "amap" && firstHome === "own" && !kit ? "osm" : b);
    };
    const waiting = window.setTimeout(() => void startMap(null), loadHome() ? 0 : MAP_WAIT_MS);
    let failed = false;
    load()
      .catch((e) => {
        console.error(e);
        failed = true;
        setMeFailed(true);
        setToast(T.map.common.serverDown);
        return { me: null, items: [] as InboxItem[], away: null, friends: [] as Friend[] };
      })
      .then(async ({ me: m, items, away, friends: list }) => {
        window.clearTimeout(waiting);
        const early = started;
        await startMap(m);
        const main = m?.roaches.find((r) => r.slot === 0);
        if (!failed) saveHome(main ?? null);
        // started before the data came: on to the main roach, if the map is still where it started
        const there: MapView | null = main ? { lng: main.lng, lat: main.lat, zoom: 11 } : null;
        if (early && there && !movedFrom(early, viewRef.current) && movedFrom(early, there)) {
          viewRef.current = there;
          setFocus({ ...there, nonce: Date.now() });
        }
        // Back after a day or more: a summary first, which says what is unread (not during the tutorial);
        // 阿米娅向导's greeting and 佩丽卡监督's report of the time away ride on it.
        // Otherwise her greeting comes on its own card, and the report along the top once it is closed.
        const greeting = m?.amiya.greeting ?? null;
        const home: Panel | null =
          m?.homecoming && !tutorialStep(m, loadProgress(m.id))
            ? {
                kind: "homecoming",
                homecoming: m.homecoming,
                items: items.map((i) => (i.id === greeting?.id ? { ...i, seen: true } : i)),
                greeting,
                away,
              }
            : null;
        const opening = home ?? (greeting ? ({ kind: "amiyaGreeting", item: greeting } as const) : null);
        const first = () => {
          setSettled(true);
          // her notes: the time away (unless 欢迎回家 carries it), then the rest of what she has to say on opening
          const pending = [...(away && !home ? [awayNote(away)] : []), ...openingNotes(m, list)];
          if (pending.length) {
            setNotes(pending);
            // what arrived since the last visit opens once her notes have had their turn
            if (!opening && !m?.mustReconsent && items.some((i) => !i.seen)) {
              afterReport.current = () => openInbox(true, undefined, items);
            }
          }
          // the admin's age question, then an updated privacy policy, before anything else
          if (m?.ageCheck) setPanel({ kind: "ageCheck" });
          // agreed again, a player this device never asked which 界面 they want is asked next
          else if (m?.mustReconsent)
            setPanel({
              kind: "consent",
              then: uiChoice && shouldAskUi() ? { kind: "uiPicker", then: opening ? () => setPanel(opening) : null } : opening,
            });
          else if (opening) setPanel(opening);
          else if (pending.length) return;
          // What arrived since the last visit
          else if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
          // the page reloaded while the player went to read their login code
          else if (!m && pendingLogin()) setPanel({ kind: "login" });
          else if (!m && !welcomed()) setPanel({ kind: "welcome" });
        };
        // back after its roach flipped over for their staying away: it stands up (鲤鱼打挺) before anything opens
        const go = () => {
          if (m?.wokeFromAway && main && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            afterActing.current = first;
            setActing("wake");
          } else first();
        };
        const noticeThenGo = () => {
          // the notice due comes before all of that (src/lib/notices.ts), once a visit
          if (m && !poppedThisVisit(m.id)) return popNotice(m, go);
          // A tab that showed the one notice there was before the board: it was the one that pops up on every
          // visit, so that one is not new here either
          const every = noticesRef.current.notices.find((n) => n.pop === "every");
          if (m && every && !noticeMemoryKept()) rememberNotices((mem) => noticeRead(mem, every.id));
          go();
        };
        // which 界面 this device wants, asked once, before the notice and everything else
        if (asksUi(m, uiChoice)) setPanel({ kind: "uiPicker", then: noticeThenGo });
        else noticeThenGo();
      });
    return () => window.clearTimeout(waiting);
  }, [load, openInbox, cn, firstHome, popNotice, rememberNotices, uiChoice]);

  // Chrome and Edge offer installing the site once, early; 存到桌面 keeps it for when the player taps it.
  // Opens from the desktop icon and in the browser are counted once a device a day, nothing else about them.
  useEffect(() => {
    const stop = keepInstallPrompt();
    countOpen();
    const offer = () => setDeskOffer(deskOffered());
    offer();
    const unwatch = watchHomeScreen(offer);
    return () => {
      stop();
      unwatch();
    };
  }, []);

  // 界面: the layout this device picked (浮岛 for everyone while the server keeps it so) and how its sides are folded
  useEffect(() => {
    setUi(uiChoice ? (storedUi() ?? DEFAULT_UI) : DEFAULT_UI);
    setFold(loadFold());
    setUiRead(true);
  }, [uiChoice]);
  // drawn as picked: what stood in for it before the app started (page.tsx) comes off
  useEffect(() => {
    if (uiRead) for (const mark of EARLY_UI_MARKS) document.documentElement.removeAttribute(mark);
  }, [uiRead]);
  /** Another layout, at once and kept on this device: the map, its view and a roach's open card stay as they are */
  const pickUi = useCallback((next: UiName) => {
    saveUi(next);
    setUi(next);
    setUiMenu(false);
    setDrawerOpen(false);
  }, []);
  const changeFold = useCallback((next: UiFold) => {
    saveFold(next);
    setFold(next);
  }, []);
  const closeUiMenu = useCallback(() => setUiMenu(false), []);
  // The map's box changes size with the layout (抽屉's drawer pulled up, the layout changed): Amap's and Tencent's
  // maps are told as when the window changes size, which they watch (MapLibre watches its box itself)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    let first = true;
    let frame = 0;
    const seen = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
    seen.observe(wrap);
    return () => {
      seen.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Development only: zhoupFly(lng, lat, zoom) in the console flies the map anywhere, to try out the map changes
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as { zhoupFly?: unknown }).zhoupFly = (lng: number, lat: number, zoom = 11) =>
      setFocus({ lng, lat, zoom, nonce: Date.now() });
  }, []);

  // Development only, to measure the map with a crowd the size of the live site's: zhoupFakeFeed(n) puts n made-up
  // roaches in the feed as a whole list (as on opening), zhoupFeedTick(k) moves k of them as an update does (every
  // two minutes), and zhoupOffStage(id) takes one off the map as a touch scene does (null puts it back). The next
  // update from the server replaces them.
  const [devOffStage, setDevOffStage] = useState<string | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    let fake: MapRoach[] = [];
    let v = 0;
    const w = window as { zhoupFakeFeed?: unknown; zhoupFeedTick?: unknown; zhoupOffStage?: unknown };
    w.zhoupFakeFeed = async (n: number) => {
      fakeFeedRef.current = true;
      setFakeFeed(true);
      const { generateFakeRoaches } = await import("@/lib/fakeRoaches");
      const looks = ["hood", "doctor", "endmin", "imp"] as const;
      fake = generateFakeRoaches(n, 20261111).map((r, i) => ({
        id: `fake${String(i).padStart(6, "0")}`,
        clone: i % 5 === 0,
        avatar: looks[i % looks.length],
        color: r.color,
        lng: r.lng,
        lat: r.lat,
        ...(i % 97 === 0 ? { asleep: true as const } : {}),
      }));
      feedRef.current.apply({ v: `fake-${++v}`, roaches: fake });
      setFeedRoaches(feedRef.current.roaches);
    };
    w.zhoupFeedTick = (k = 150) => {
      const changed = Array.from({ length: k }, () => {
        const i = Math.floor(Math.random() * fake.length);
        fake[i] = { ...fake[i], lng: fake[i].lng + 0.002, lat: fake[i].lat + 0.002 };
        return fake[i];
      });
      if (feedRef.current.apply({ v: `fake-${++v}`, changed })) setFeedRoaches(feedRef.current.roaches);
    };
    w.zhoupOffStage = (id: string | null) => setDevOffStage(id);
  }, []);

  // Roaches others placed or moved: every two minutes (once a minute from some 20,000 pages was more than the
  // server could keep up with), and when the page comes back into view, ask only what changed
  useEffect(() => {
    let last = Date.now();
    const poll = () => {
      if (document.visibilityState !== "visible" || !worldRef.current || Date.now() - last < 10_000) return;
      last = Date.now();
      loadRoaches().catch(() => {});
    };
    document.addEventListener("visibilitychange", poll);
    const t = window.setInterval(poll, 120_000);
    return () => {
      document.removeEventListener("visibilitychange", poll);
      window.clearInterval(t);
    };
  }, [loadRoaches]);

  // While the page is open, the server says when something new arrives: show it unless the player is busy
  const busyRef = useRef<{ panel: Panel | null; placing: boolean }>({ panel: null, placing: false });
  useEffect(() => {
    busyRef.current = { panel, placing: Boolean(placing) };
  }, [panel, placing]);

  const showNew = useCallback(async (onlyDeclarations = false) => {
    const items = onlyDeclarations ? await loadNewDeclarations() : await loadInbox();
    const fresh = freshRef.current.filter((i) => !i.seen);
    // A declaration nudges a whole neighbourhood, and then nothing but the inbox has changed; for anything
    // else friends and me too (a new 触须之交, a badge someone else's move just earned us). Asking for all
    // three on every declaration was much of what kept the server busy (2026-11-10, some 25,000 roaches).
    if (!fresh.length || fresh.some((i) => i.kind !== "declaration")) await Promise.all([loadFriends(), loadMe()]);
    if (demoRef.current) await loadIdentities();
    if (!items.some((i) => !i.seen)) return;
    const { panel: open, placing: busy } = busyRef.current;
    // only declarations came: they float down over the dock, and 消息 stays shut
    if (fresh.length && fresh.every((i) => i.kind === "declaration") && open?.kind !== "inbox") {
      hearRef.current(fresh);
      return;
    }
    // a touch: your dock avatar reacts first (never pointing anywhere, never saying which roach)
    const scene = dockSceneFor(fresh);
    if (scene && !busy) await playDockRef.current(scene.kind, scene.from);
    if (open?.kind === "inbox") await openInbox(false, open.tab, items);
    else if (open || busy) setToast(fmt(T.map.inbox.lookAtNew, { title: noticeTitle(items) }));
    else await openInbox(true, undefined, items);
  }, [loadInbox, loadNewDeclarations, loadFriends, loadMe, loadIdentities, openInbox]);

  /** Where your dock is on screen now; null while it is hidden (moving a roach, a card open) */
  const dockAt = (): DockAt | null => {
    const av = dockAvRef.current?.getBoundingClientRect();
    const mail = dockMailRef.current?.getBoundingClientRect();
    if (!av?.width || !mail) return null;
    // under what the layout has along the top (the site's name), where a feeler comes down from
    const top = document.querySelector("[data-chrome-top]")?.getBoundingClientRect().bottom ?? 0;
    return { av: { x: av.left, y: av.top, w: av.width, h: av.height }, mail: { x: mail.left, y: mail.top, w: mail.width, h: mail.height }, top };
  };
  const motionOff = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Your dock avatar's scene for a touch that came; resolves when it is over (at once without it) */
  const playDock = (kind: DockKind, from: DockFrom | null) =>
    new Promise<void>((resolve) => {
      const at = dockAt();
      if (!at || motionOff() || look === "real") return resolve();
      setDockAnim(DOCK_ANIM[kind]);
      setBadgePop(kind !== "sneaky");
      setDockScene({
        kind,
        from,
        at,
        done: () => {
          setDockScene(null);
          setDockAnim(null);
          setBadgePop(false);
          resolve();
        },
      });
    });
  const playDockRef = useRef(playDock);
  playDockRef.current = playDock;

  /** Declarations heard: each floats down over the dock (three at most), sound comes into the avatar */
  const hear = (items: InboxItem[]) => {
    const lines = items.flatMap((i) => (i.kind === "declaration" ? [{ id: i.id, text: i.text, limited: isLimitedLine(i.text) }] : []));
    if (!lines.length) return;
    setHeard((all) => [...all, ...lines].slice(-3));
    // left alone, each goes after 15 s and stays unread in 消息
    for (const l of lines) window.setTimeout(() => setHeard((all) => all.filter((h) => h.id !== l.id)), 15_000);
    const at = dockAt();
    if (!at || motionOff()) return;
    setArcs({ at, nonce: Date.now() });
    setDockAnim("ta-dlisten");
    window.setTimeout(() => {
      setArcs(null);
      setDockAnim((a) => (a === "ta-dlisten" ? null : a));
    }, 1650);
  };
  const hearRef = useRef(hear);
  hearRef.current = hear;
  // 回应 opens 消息 on the tab the declaration is in: 宣言, or 触须之交 for a 触须之交's birthday
  const heardReply = async (id: string) => {
    setHeard((all) => all.filter((h) => h.id !== id));
    const items = await loadInbox();
    const item = items.find((i) => i.id === id);
    await openInbox(false, item ? tabOf(item) : "declarations", items);
  };
  const heardOk = async (id: string) => {
    setHeard((all) => all.filter((h) => h.id !== id));
    await worldRef.current!.markSeen([id]).catch(() => {});
    await loadInbox();
  };

  // 求助 changed: the dot on the 触须之交 card, and the page if it is open; nothing pops up
  const helpNudgeRef = useRef(() => {});
  helpNudgeRef.current = () => {
    if (document.hidden) return;
    loadMe().catch(() => {});
    const open = busyRef.current.panel?.kind;
    if (open === "friends" || open === "friend") loadHelp().catch(() => {});
  };
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    const events = new EventSource("/api/events");
    let timer: number | undefined;
    let due = Infinity;
    let pending = false;
    let dropped = false;
    // nothing but declarations since the last look: only they are asked for
    let onlyDeclarations = true;
    const run = () => {
      window.clearTimeout(timer);
      timer = undefined;
      due = Infinity;
      const only = onlyDeclarations;
      onlyDeclarations = true;
      showNew(only).catch(() => {});
    };
    // Each page waits a random moment, so a crowd nudged together does not ask all at once, and nudges
    // arriving meanwhile are taken in by the same look: within 10 s for what is the player's own, within
    // a minute for declarations, which reach a whole neighbourhood (2026-11-10: some 400,000 an hour)
    const later = (within = 10_000, declarations = false) => {
      if (!declarations) onlyDeclarations = false;
      if (document.hidden) {
        pending = true;
        return;
      }
      const at = Date.now() + Math.random() * within;
      if (at >= due) return;
      window.clearTimeout(timer);
      due = at;
      timer = window.setTimeout(run, at - Date.now());
    };
    events.addEventListener("inbox", () => later());
    events.addEventListener("declare", () => later(60_000, true));
    events.addEventListener("help", () => helpNudgeRef.current());
    // nudges sent while the connection was down are lost, so look once it is back: spread over a minute, as
    // after a restart every page comes back at once
    events.addEventListener("error", () => (dropped = true));
    events.addEventListener("open", () => {
      if (dropped) later(60_000);
      dropped = false;
    });
    // a page in the background only notes that something came, and looks when it is in view again
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (pending || Date.now() - lastMessagesRef.current > 5 * 60_000) {
        pending = false;
        // back after a while: everything
        onlyDeclarations = false;
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      events.close();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [meId, showNew]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // The newcomer tutorial: what is left of it comes from the server and from this browser
  useEffect(() => {
    setProgress(meId ? loadProgress(meId) : {});
  }, [meId]);
  const step = tutorialStep(me, progress);
  const updateProgress = (patch: Progress) => {
    if (!me) return;
    const next = { ...progress, ...patch };
    setProgress(next);
    saveProgress(me.id, next);
  };
  const tutorialMain = me?.roaches.find((r) => r.slot === 0);
  /** Back from 阿米娅向导 on Rhode Island to your own roach */
  const flyHome = () => {
    if (tutorialMain) setFocus({ lng: tutorialMain.lng, lat: tutorialMain.lat, zoom: 11, nonce: Date.now() });
  };
  // whoever acts out a scene over the map is left out of it meanwhile
  const offStage = poking?.id ?? jolting?.roach.id ?? touchScene?.target ?? devOffStage ?? undefined;

  /** The exact count asked for, by the view it was asked for: a newer ask makes an older answer moot */
  const exactRef = useRef<{ timer?: number; asked: string }>({ asked: "" });
  const countVisible = useCallback(
    (bounds: [LngLat, LngLat]) => {
      // each roach of the overview counts as all those in its square, yours among them; with 只看本体, players: the
      // main roaches in view, ours too (触须之交's clones are drawn but not counted)
      let n = hideClones
        ? countPlayers(roaches, bounds, overview, me?.roaches ?? [])
        : roaches.reduce((s, r) => s + (inBounds(r, bounds) ? weightOf(r) : 0), 0);
      if (!overview && !hideClones) for (const r of me?.roaches ?? []) if (inBounds(r, bounds)) n += 1;
      setVisible(n);
      // The overview's roaches stand at the middle of their squares, each for all in it, so counted by them the
      // view's edges cut squares in two: once the view settles, the server counts it exactly (every roach, yours too)
      const e = exactRef.current;
      window.clearTimeout(e.timer);
      if (!overview || !worldRef.current) return;
      const view: [number, number, number, number] = [bounds[0].lng, bounds[0].lat, bounds[1].lng, bounds[1].lat];
      const asked = view.join(",");
      e.asked = asked;
      e.timer = window.setTimeout(async () => {
        const u = await worldRef.current?.roachesInView(view, hideClones).catch(() => null);
        if (u && "n" in u && exactRef.current.asked === asked) setVisible(u.n);
      }, AREA_SETTLE_MS + 150);
    },
    [roaches, me, overview, hideClones],
  );

  // 只看本体 switched: the overview of the other kind at once (boxes are picked over as they are)
  useEffect(() => {
    void loadRoaches("view").catch(() => {});
  }, [hideClones, loadRoaches]);

  useEffect(() => {
    if (boundsRef.current) countVisible(boundsRef.current);
  }, [countVisible]);

  // The block list is only shown on the profile sheet, so it is fetched when that opens
  const profileOpen = panel?.kind === "profile";
  useEffect(() => {
    if (!profileOpen || !me) return;
    worldRef.current!.blocks().then(setBlocked, () => setBlocked([]));
  }, [profileOpen, me]);

  /** Run a world call; refusals become a toast. Resolves to undefined on failure. */
  async function act<T>(fn: (w: World) => Promise<T>, ok?: string): Promise<T | undefined> {
    try {
      const result = await fn(worldRef.current!);
      if (ok) setToast(ok);
      return result;
    } catch (e) {
      if (e instanceof SignInNeeded) setPanel({ kind: "login", reason: T.map.common.signInFirst });
      else if (e instanceof AgeCheckNeeded) setPanel({ kind: "ageCheck" });
      else if (e instanceof ConsentNeeded) setPanel({ kind: "consent" });
      else if (e instanceof WorldError) setToast(e.message);
      else {
        console.error(e);
        setToast(T.map.common.tryAgain);
      }
      return undefined;
    }
  }

  const switchBasemap = (b: Basemap) => {
    if (b === basemap) return;
    saveBasemap(b);
    setBasemap(b);
  };

  const switchLook = (l: RoachStyle) => {
    saveLook(l);
    setLook(l);
  };

  const switchMapStyle = (s: MapStyle) => {
    if (s === shownStyle) return;
    saveMapStyle(s);
    setMapStyle(s);
    setStyleStored(true);
    setToast(fmt(T.map.style.switched, { style: MAP_STYLE_NAMES[s] }));
  };
  const styleHintDone = useCallback(() => {
    setStyleHint(false);
    markMapStyleSeen();
  }, []);
  const deskHintDone = useCallback(() => {
    setDeskHint(false);
    markDeskHintSeen();
  }, []);

  /** 存到桌面: the browser's own install prompt where it offered one, else how to do it here */
  const tapDesk = async () => {
    setUiMenu(false);
    deskHintDone();
    const r = await installOrGuide();
    if (r === "guide") {
      setSelected(null);
      setPanel({ kind: "homeScreen" });
    } else if (r === "installed") setToast(T.map.account.installed);
  };
  // A visitor who has not signed in has 全员隐匿 only (the server sends them nobody's roaches); this device's
  // pick waits for the sign-in. 舟u本色 where its hearts cannot be drawn (yet, or on this device) is drawn as
  // 默认, the pick kept.
  const guest = meKnown && !me;
  // where 高德's GPU layer cannot run, a device that never picked a style has 轻量, not saved
  const autoLite = noGpu && !styleStored;
  const shownStyle: MapStyle = guest ? "hidden" : autoLite ? "lite" : mapStyle;
  const drawnStyle: MapStyle = guest ? "hidden" : autoLite ? "lite" : mapStyle === "hearts" && (!HEARTS_READY || heartsOff) ? "plain" : mapStyle;
  // 全员隐匿 asks for the counts only; on the way out of it, the roaches of the area shown come again
  const hidden = drawnStyle === "hidden";
  useEffect(() => {
    hiddenRef.current = hidden;
    void loadRoaches(hidden ? "view" : "poll").catch(() => {});
  }, [hidden, loadRoaches]);

  const startPlacing = (target: PlaceTarget) => {
    // say so before they pick a spot, not after
    if (me?.mustReconsent) return setPanel({ kind: "consent" });
    if (target.kind === "move" && me && me.movesLeft <= 0) {
      setToast(fmt(T.map.place.movesUsedUp, { n: MOVES_PER_DAY }));
      return;
    }
    setPanel(null);
    setSelected(null);
    setPlacing({ target, label: PLACING_LABEL[target.kind] });
  };

  const placeAt = async (p: LngLat, fly: boolean) => {
    if (!placing) return;
    // said at once, before any card; the server refuses it too
    if (isOffLimits(p)) return setToast(offLimitsMessage());
    // the first new roach waits for the player to agree that its spot is public
    if (placing.target.kind !== "move" && !me?.agreedPublicPlace) {
      return setPanel({ kind: "placeConfirm", target: placing.target, spot: p, fly, consent: true });
    }
    await put(placing.target, p, fly);
  };

  /** One touch, or one roach put down, at a time: a second tap while the first is on its way is dropped. */
  const once = async <T,>(kind: "touch" | "put", go: () => Promise<T | undefined>): Promise<T | undefined> => {
    if (inFlight.current[kind]) return undefined;
    inFlight.current[kind] = true;
    if (kind === "touch") setTouching(true);
    try {
      return await go();
    } finally {
      inFlight.current[kind] = false;
      if (kind === "touch") setTouching(false);
    }
  };

  /** Put a roach down (agreeing first, from the card) and say so; the first main roach opens the tutorial. */
  const put = async (target: PlaceTarget, p: LngLat, fly: boolean, agree = false) => {
    const before = me?.talulah.visited;
    // the main roach moving: 佩丽卡监督 rides over from where she stands now
    const mainMoves = Boolean(main && (target.kind === "main" || (target.kind === "move" && target.roachId === main.id)));
    const from = perlicaShown;
    // a second tap on the map, or on the card, while this one is on its way is dropped
    const done = await once("put", async () => {
      if (agree && !(await act((w) => w.acceptPublicPlace().then(() => true)))) return undefined;
      return act((w) => w.placeRoach(target, p));
    });
    if (!done) return;
    if (mainMoves && perlicaAt) bikeFrom.current = from;
    setPlacing(null);
    const m = await loadMe();
    // declarations show by where the roaches are: a move can bring old ones in and take others away
    void loadInbox().catch(() => {});
    welcomeAtFire(before, m, false);
    // the tutorial's clone step is done for good once one is down, even if it is taken back later
    if (target.kind === "clone" && step === "clone") updateProgress({ clone: true });
    if (fly) setFocus({ lng: p.lng, lat: p.lat, zoom: 13, nonce: Date.now() });
    setToast(
      target.kind === "move"
        ? fmt(T.map.place.moved, { n: m?.movesLeft ?? 0 })
        : target.kind === "clone"
          ? T.map.place.clonePlaced
          : T.map.place.placed,
    );
  };

  const onMapClick = (p: LngLat) => {
    if (placing) return placeAt(p, false);
    setSelected(null);
    // a visitor sees where their roach would go and about how many are around, counted by the server
    if (visitorShown) {
      if (isOffLimits(p)) {
        setPreview(null);
        return setToast(offLimitsMessage());
      }
      setPreview(p);
    }
  };

  const onRoachClick = (id: string) => {
    if (id === AMIYA_ID) {
      danceAmiya();
      return setSelected({ kind: "other", roach: amiyaRoach(Boolean(me?.amiya.friend)) });
    }
    if (id === PERLICA_ID) {
      if (perlicaShown) setSelected({ kind: "other", roach: perlicaRoach(perlicaShown, Boolean(me?.perlica.friend)) });
      return;
    }
    if (id === TALULAH_ID) return openTalulah();
    if (id === MINGHE_ID) return setSelected({ kind: "other", roach: mingheRoach(day, Boolean(me?.minghe.friend)) });
    if (id === SI_ID) return openSi();
    const roach = roaches.find((r) => r.id === id);
    if (roach) setSelected({ kind: "other", roach });
  };

  const onMineClick = (id: string) => {
    const roach = me?.roaches.find((r) => r.id === id);
    if (roach) setSelected({ kind: "mine", roach });
  };

  const onViewChange = (v: MapView, bounds: [LngLat, LngLat]) => {
    viewRef.current = v;
    boundsRef.current = bounds;
    pulse.rest(v);
    countVisible(bounds);
    // the roaches of the area the map shows now, if the ones held do not cover it
    askAreaSoon(v);
    // 缘缘庄 in view (or nearly), close enough to be more than a blot: its numbers and, close up, its ink roaches
    const [sw, ne] = bounds;
    const nearInn =
      v.zoom >= 10 &&
      sw.lng < INN_CENTER.lng + 0.05 &&
      ne.lng > INN_CENTER.lng - 0.05 &&
      sw.lat < INN_CENTER.lat + 0.045 &&
      ne.lat > INN_CENTER.lat - 0.045;
    setSiView((old) =>
      !nearInn
        ? null
        : old && old.zoom === v.zoom && old.sw.lng === sw.lng && old.sw.lat === sw.lat && old.ne.lng === ne.lng && old.ne.lat === ne.lat
          ? old
          : { sw, ne, zoom: v.zoom },
    );
    // 阿米娅向导 close enough on screen to be tapped: her dance and music on their way, so a tap starts them at once
    if (!amiyaNear.current && v.zoom >= 6 && inBounds(AMIYA_AT, bounds) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      amiyaNear.current = true;
      preloadDance();
      preloadMusic();
    }
  };
  const amiyaNear = useRef(false);

  // ---- visitors from mainland China: changing between the home map (高德's or 腾讯's) and our own map ----

  // a map of China's own (高德's or 腾讯's), with its logo and 审图号 bottom left
  const homeOn = basemap === "amap" && homeMap !== "own";
  const twoMaps = cn && homeOn && Boolean(overseas);
  const ignoreView = () => {};
  // the other map jumps to where this one is, without flying, and takes over
  const showAbroad = () => {
    wanted.current = null;
    setOverseasJump({ ...viewRef.current, nonce: Date.now() });
    setAbroad(true);
  };
  const showHome = () => {
    wanted.current = null;
    setHomeJump({ ...viewRef.current, nonce: Date.now() });
    setAbroad(false);
  };
  /** The home map came to rest: once even a wider view would not show China, our own map takes over */
  const onHomeView = (v: MapView, bounds: [LngLat, LngLat]) => {
    onViewChange(v, bounds);
    if (!chinaRef.current?.clearOfChina(bounds)) {
      wanted.current = null;
      return;
    }
    if (overseasReady.current) return showAbroad();
    // made out of sight first and shown once drawn, so the screen never goes blank
    wanted.current = "abroad";
    setOverseasMade(true);
  };
  /** Our own map came to rest: as soon as China is in view, back to the home map */
  const onOverseasView = (v: MapView, bounds: [LngLat, LngLat]) => {
    onViewChange(v, bounds);
    if (!chinaRef.current?.seesChina(bounds)) {
      wanted.current = null;
      return;
    }
    if (homeReady.current) return showHome();
    wanted.current = "home";
    setHomeMade(true);
  };
  const onHomeReady = () => {
    homeReady.current = true;
    if (wanted.current === "home") showHome();
  };
  const onOverseasReady = () => {
    overseasReady.current = true;
    if (wanted.current === "abroad") showAbroad();
  };
  /** Mainland China: our own map instead, without the cover, if it is there to fall back on */
  const ownMap = () => {
    if (overseas) {
      setToast(T.map.style.amapFailedOwn);
      setHomeMap("own");
    } else {
      setToast(T.map.style.amapFailedOsm);
      setBasemap("osm");
    }
  };
  /** 高德's map could not load: 腾讯's in its place, made where the view is now, as the home map (the visitor need not hear of it) */
  const amapFailed = () => {
    if (!tencentConfigured) return ownMap();
    homeReady.current = false;
    setHomeMap("tencent");
  };

  const find = (r: OwnRoach) => {
    setPanel(null);
    setFocus({ lng: r.lng, lat: r.lat, zoom: 12, nonce: Date.now() });
  };

  /** Act out a scene over the main roach, unless motion is turned down. */
  const play = (scene: "drink" | "wake") => {
    const main = me?.roaches.find((r) => r.slot === 0);
    if (!main || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setFocus({ lng: main.lng, lat: main.lat, zoom: viewRef.current.zoom, nonce: Date.now() });
    setActing(scene);
  };

  const drinkUp = async () => {
    setDrinking(true);
    const done = await act((w) => w.drink());
    setDrinking(false);
    if (!done) return;
    // for 佩丽卡监督 to say how long they slept, in this browser only
    if (me?.perlica.timer === "on") rememberDrank(me.id, { at: Date.now(), until: done.until });
    play("drink");
    const m = await loadMe();
    // the first and the fiftieth pop up as new badges; the rest are counted here
    const drinks = m?.counts.drinks ?? 0;
    if (drinks !== 1 && drinks !== 50) setToast(fmt(T.map.sleep.drunkAgain, { n: drinks }));
  };

  // up again: whoever poked it while it slept shows now
  const pokedToast = (items: InboxItem[]) => {
    const who = pokedBy(items);
    return who ? fmt(T.map.sleep.pokedAsleep, { who }) : "";
  };

  const soberUp = async () => {
    endParty();
    setDrinking(true);
    const done = await act((w) => w.sober().then(() => true));
    setDrinking(false);
    if (!done) return;
    play("wake");
    const [, items] = await Promise.all([loadMe(), loadInbox()]);
    setToast(fmt(T.map.sleep.sobered, { poked: pokedToast(items) }));
  };

  /** ⚡舟友的酒⚡ on, within the tap (so its music may play): the map goes to the drunk main roach */
  const startParty = () => {
    const main = me?.roaches.find((r) => r.slot === 0);
    if (!main || !me?.drunkUntil) return;
    const music = playPartyMusic();
    setSelected(null);
    setFocus({ lng: main.lng, lat: main.lat, zoom: Math.max(viewRef.current.zoom, PARTY_ZOOM), nonce: Date.now() });
    setParty({ key: Date.now(), el: document.createElement("div"), at: { lng: main.lng, lat: main.lat }, music });
    // 将进酒 (the server checks they are drunk); nothing is said if it does not go
    void worldRef.current?.partied().catch(() => {});
  };
  const endParty = useCallback(() => {
    stopPartyMusic();
    setParty(null);
  }, []);

  // A drunk roach wakes at 8:00 where it lies; an open page sees it stand up then
  const drunkUntil = me?.drunkUntil;
  useEffect(() => {
    if (!drunkUntil) return;
    const woke = async () => {
      const [, items] = await Promise.all([loadMe(), loadInbox()]);
      const poked = pokedToast(items);
      if (poked) setToast(fmt(T.map.sleep.woke, { poked }));
    };
    const t = window.setTimeout(() => woke().catch(() => {}), Math.max(0, drunkUntil - Date.now()) + 1000);
    return () => window.clearTimeout(t);
  }, [drunkUntil, loadMe, loadInbox]);

  const remove = async (r: OwnRoach) => {
    if (!window.confirm(r.slot === 0 ? T.map.place.removeMain : T.map.place.removeClone)) return;
    const done = await act((w) => w.removeRoach(r.id), r.slot === 0 ? T.map.place.removedMain : T.map.place.removedClone);
    if (!done) return;
    setSelected(null);
    await loadMe();
    void loadInbox().catch(() => {});
  };

  const befriendedToast = (name: string) => {
    const guide = Object.values(GUIDES).find((g) => g.name === name);
    setToast(
      name === GUIDES.talulah.name
        ? T.map.touch.talulahFriends
        : guide
          ? fmt(T.map.touch.guideFriends, { name, them: guide.pronoun })
          : fmt(T.map.touch.friends, { name }),
    );
  };

  const touchedToast = (bold: boolean) =>
    setToast(bold ? T.map.touch.bold : T.map.touch.sneaky);
  /** A guide touches back once a day (src/lib/server/guides.ts); this touch got nothing back */
  const quietGuideToast = (id: GuideId) =>
    setToast(fmt(T.map.touch.guideQuiet, { name: GUIDES[id].name, them: GUIDES[id].pronoun }));

  /**
   * Act out a touch over the map, on this screen only (TouchStage), and resolve once it is
   * over, to whether it played: not when motion is turned down or roaches look 写实. The
   * map goes to the roach touched and leaves it out meanwhile; a sleeping one only jolts
   * in its sleep, and stays asleep.
   */
  const playTouch = (roach: PublicRoach, kind: TouchKind, gesture?: Gesture) =>
    new Promise<boolean>((resolve) => {
      if (!me || look === "real" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return resolve(false);
      const zoom = viewRef.current.zoom;
      setFocus({ lng: roach.lng, lat: roach.lat, zoom, nonce: Date.now() });
      if (roach.asleep && !roach.guide && !gesture) {
        setJolting({ roach, done: () => (setJolting(null), resolve(true)) });
        return;
      }
      const wrap = wrapRef.current;
      // a guide is as big as her marker, and stands where the map draws her: 塔露拉干员 by her fire, the
      // others stepped aside from your main roach when it is close (as the maps work it out)
      const guide = roach.guide ? guides.find((g) => g.id === roach.id) : undefined;
      const box = guide ? guideBox(guide, zoom) : iconPx(zoom);
      const [sx, sy] = guide ? guideShift(guide, box) : [0, 0];
      const main = me.roaches.find((r) => r.slot === 0);
      const [bx, by] = !guide || guide.fire
        ? [0, 0]
        : guide.beside
          ? besideRight(box)
          : besideMain({ x: sx, y: sy }, main ? screenDelta(guide.at, main, zoom) : null, box, belowGuide(zoom));
      const place = stagePlace(wrap?.clientWidth ?? window.innerWidth, wrap?.clientHeight ?? window.innerHeight, box, [sx + bx, sy + by]);
      const cast: TouchCast = {
        you: { avatar: myAvatar, color: myColor, name: me.profile.anonymous || !me.profile.name.trim() ? T.map.common.anonymous : displayName(me.profile) },
        them: { avatar: roach.avatar, color: roach.color, clone: roach.clone, friend: roach.friend },
      };
      // looks that are pictures are drawn on a canvas first: have them ready as the scene starts (as RoachIcon asks for them)
      const warm = (color: TouchCast["you"]["color"], opts: RoachOpts, size: number) =>
        usesPicture(opts) ? roachIconUrl(color, opts, size * 2).catch(() => "") : Promise.resolve("");
      const { you, them } = cast;
      const ready = Promise.all([
        warm(you.color, { avatar: you.avatar, mine: true }, 88),
        warm(you.color, { avatar: you.avatar }, 20),
        warm(them.color, { avatar: them.avatar, clone: them.clone, friend: them.friend }, 88),
        warm(them.color, { avatar: them.avatar, clone: them.clone, friend: true }, 88),
      ]);
      Promise.race([ready, new Promise((r) => window.setTimeout(r, 600))]).then(() =>
        setTouchScene({ kind, gesture, cast, place, target: roach.id, done: () => (setTouchScene(null), resolve(true)) }),
      );
    });

  const touch = async (roach: PublicRoach, bold: boolean) => {
    if (roach.guide) return touchGuide(roach, bold);
    const res = await once("touch", () => act((w) => w.touch(roach.id, bold)));
    if (!res) return;
    setTouchedHere((t) => ({ ...t, [`${me?.id}:${roach.id}`]: { bold, at: Date.now() } }));
    setSelected(null);
    // the scene plays first, then today's toast
    const loading = res.newFriend ? Promise.all([loadFriends(), loadInbox()]) : null;
    await playTouch(roach, res.newFriend ? "friend" : bold ? "bold" : "sneaky");
    if (res.newFriend) befriendedToast(res.newFriend);
    else touchedToast(bold);
    await loading;
    if (me?.isNew) await loadMe();
    if (demoRef.current) await loadIdentities();
  };

  /** How you touched this roach from this page within the day, if you did (the server's once a day, touch()) */
  const touchedOn = (roach: PublicRoach) => (roach.guide ? undefined : touchedById(roach.id));
  /** The same by the id it was touched by, an ink roach's too */
  const touchedById = (id: string) => {
    const t = touchedHere[`${me?.id}:${id}`];
    if (!t || Date.now() - t.at >= TOUCH_SAME_ROACH_HOURS * HOUR) return undefined;
    return t.bold ? "bold" : "sneaky";
  };

  /** 戳一戳 a 触须之交's sleeping roach: the card stays open, and its button turns to 「戳过了」. */
  const poke = async (roach: PublicRoach) => {
    setPokeSent(true);
    const done = await act((w) => w.poke(roach.id));
    setPokeSent(false);
    if (!done) return;
    const landed = () => setToast(T.map.touch.poked);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) landed();
    else {
      setFocus({ lng: roach.lng, lat: roach.lat, zoom: viewRef.current.zoom, nonce: Date.now() });
      setPoking(roach);
      window.setTimeout(landed, POKE_LANDS_MS);
    }
    await loadFriends();
  };

  // ---- between 触须之交 (src/lib/friendly.ts) ----

  /** Run one, with the row's buttons off meanwhile; true once it went through */
  const friendly = async (go: (w: World) => Promise<unknown>) => {
    setFriendBusy(true);
    const ok = await act(async (w) => {
      await go(w);
      return true;
    });
    setFriendBusy(false);
    return Boolean(ok);
  };
  /** Their main roach, where things done from their page (not a card on the map) are acted out */
  const mainRoachOf = (friend: Friend) => friend.roaches.find((r) => !r.clone) ?? null;
  const refreshInbox = async () => keepSnapshot(await loadInbox());

  /** 催理智: a bottle flies off the button, 叮！ */
  const remindSanity = async (friend: Friend, at: { x: number; y: number } | null) => {
    if (!(await friendly((w) => w.remindSanity(friend.id)))) return;
    if (at && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setVialAt(at);
    setToast(fmt(T.map.friends.sanityNudged, { name: friend.profile.displayName }));
    await loadFriends();
  };

  /** 贴贴 and the others: acted out over their roach on your screen, then the toast; replyTo returns one of theirs */
  const doGesture = async (friend: Friend, gesture: Gesture, roach: PublicRoach | null, replyTo?: string) => {
    if (!(await friendly((w) => w.gesture(friend.id, gesture, replyTo)))) return;
    setPanel(null);
    setSelected(null);
    const loading = Promise.all([loadFriends(), replyTo ? refreshInbox() : null]);
    if (roach) await playTouch(roach, "bold", gesture);
    setToast(gestureSent(gesture, friend.profile.displayName));
    await loading;
  };

  /** 一键: one act for many at once, acted out once over the map, then the toast */
  const batch = async (act: BatchAct, friendIds: string[]) => {
    setFriendBusy(true);
    const res = await (async () => {
      try {
        return await worldRef.current!.friendsAct(act, friendIds);
      } catch (e) {
        setToast(e instanceof WorldError ? e.message : T.map.common.tryAgain);
        return null;
      }
    })();
    setFriendBusy(false);
    if (!res) return;
    const went = res.filter((r) => r.ok).map((r) => shownFriends.find((f) => f.id === r.id)).filter((f): f is Friend => Boolean(f));
    const missed = res.filter((r) => !r.ok);
    const loading = loadFriends();
    if (!went.length) {
      setToast(missed[0]?.why ?? T.map.friends.notSent);
      return loading;
    }
    setPanel(null);
    setSelected(null);
    if (!motionOff()) await new Promise<void>((resolve) => setBatchScene({ act, them: went, done: () => (setBatchScene(null), resolve()) }));
    setToast(missed.length ? fmt(T.map.friends.someMissed, { sent: batchSent(act, went.length), n: missed.length, why: missed[0].why }) : batchSent(act, went.length));
    await loading;
  };

  /** 特别关注 TA, or not: only you know */
  const toggleStar = async (friend: Friend) => {
    const on = friend.star === null;
    if (!(await friendly((w) => w.starFriend(friend.id, on)))) return;
    setToast(on ? fmt(T.map.friends.starred, { name: friend.profile.displayName }) : T.map.friends.unstarred);
    await loadFriends();
  };

  // ---- 求助 (src/lib/help.ts) ----

  const loadHelp = useCallback(async () => {
    const board = await worldRef.current!.helpBoard().catch(() => null);
    if (board) setHelpBoard(board);
    return board;
  }, []);
  /** The 触须之交 page: the list and 求助, which then count as seen (the dot goes) */
  const openFriends = async () => {
    setSelected(null);
    setPanel({ kind: "friends" });
    loadFriends().catch(() => {});
    const board = await loadHelp();
    if (board && (board.theirs.some((r) => r.fresh) || board.mine.some((r) => r.fresh) || (me && me.help.asks + me.help.answers > 0))) {
      await worldRef.current!.seeHelp().catch(() => {});
      await loadMe().catch(() => {});
    }
  };
  const askHelp = async (ask: HelpAsk) => {
    if (!(await friendly((w) => w.askHelp(ask)))) return;
    setPanel({ kind: "friends" });
    setToast(T.map.friends.helpAsked);
    await loadHelp();
  };
  const answerHelp = async (requestId: string, clues?: number[]) => {
    if (!(await friendly((w) => w.answerHelp(requestId, clues)))) return;
    setToast(T.map.common.toldThem);
    await loadHelp();
  };
  const closeHelp = async (requestId: string) => {
    if (!(await friendly((w) => w.closeHelp(requestId)))) return;
    await loadHelp();
  };

  /** 来串门啦！ over your clone as it sits down */
  const sayOver = (at: LngLat, text: string) => {
    const mark = { id: `visit:${Date.now()}`, at, text, limited: false };
    setShouts((all) => [...all, mark]);
    window.setTimeout(() => setShouts((all) => all.filter((s) => s !== mark)), BUBBLE_MS + BUBBLE_FADE_MS);
  };

  /** 做客: asked first; your clone already there is only looked at */
  const askVisit = (friend: Friend, roach: PublicRoach) => {
    const visiting = friend.between?.visiting;
    if (visiting) {
      const mine = me?.roaches.find((r) => r.id === visiting.cloneId);
      setPanel(null);
      setSelected(null);
      if (mine) setFocus({ lng: mine.lng, lat: mine.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
      return;
    }
    if (!me?.roaches.some((r) => r.slot === 0)) return setToast(T.map.visit.placeMainFirst);
    setSelected(null);
    setPanel({ kind: "visitConfirm", friendId: friend.id, roach });
  };

  const visitFriend = async (friendId: string, roach: PublicRoach, cloneId?: string) => {
    const friend = shownFriends.find((f) => f.id === friendId);
    if (!friend) return;
    setFriendBusy(true);
    const res = await act((w) => w.visit(friendId, roach.id, cloneId));
    setFriendBusy(false);
    if (!res) return;
    setPanel(null);
    setSelected(null);
    setFocus({ lng: res.seat.lng, lat: res.seat.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
    await Promise.all([loadMe(), loadRoaches(), loadFriends(), loadInbox()]);
    sayOver(res.seat, T.map.visit.visiting);
    setToast(fmt(T.map.visit.sat, { name: friend.profile.displayName }));
  };

  /** 去看看: a guest sitting by your roach */
  const lookAt = (spot: LngLat) => {
    setPanel(null);
    setSelected(null);
    setFocus({ lng: spot.lng, lat: spot.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
  };

  const afterVisitChange = () => Promise.all([loadMe(), loadRoaches(), loadFriends(), refreshInbox()]);

  /** 请 TA 回家 */
  const sendHome = async (friendId: string) => {
    if (!(await friendly((w) => w.sendHome(friendId)))) return;
    setSelected(null);
    setToast(T.map.visit.sentHome);
    await afterVisitChange();
  };

  /** 回家: your visiting clone goes back */
  const goHome = async (cloneId: string) => {
    if (!(await friendly((w) => w.goHome(cloneId)))) return;
    setSelected(null);
    setToast(T.map.visit.cameHome);
    await afterVisitChange();
  };

  /** 跟过去: your clone left behind sits down by its host's roach again */
  const followHost = async (cloneId: string) => {
    setFriendBusy(true);
    const res = await act((w) => w.followHost(cloneId));
    setFriendBusy(false);
    if (!res) return;
    setPanel(null);
    setSelected(null);
    setFocus({ lng: res.seat.lng, lat: res.seat.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
    await afterVisitChange();
    sayOver(res.seat, T.map.visit.visiting);
    setToast(T.map.visit.followed);
  };

  /** 复制 a UID they share; where the browser will not write the clipboard (QQ, WeChat), long-press it instead */
  const copyUid = (uid: string) =>
    navigator.clipboard
      ?.writeText(uid)
      .then(() => setToast(T.map.game.copied))
      .catch(() => setToast(T.map.game.holdToCopy)) ?? setToast(T.map.game.holdToCopy);

  const gameAsk = async (friend: Friend, game: Game) => {
    if (!(await friendly((w) => w.gameAsk(friend.id, game)))) return;
    setToast(fmt(T.map.game.asked, { name: friend.profile.displayName }));
    await loadFriends();
  };
  const gameWant = async (friend: Friend, game: Game) => {
    if (!(await friendly((w) => w.gameWant(friend.id, game)))) return;
    setToast(fmt(T.map.game.wanted, { name: friend.profile.displayName }));
    await loadFriends();
  };

  /** One of the row's buttons (FriendActions), on their roach's card (roach) or their page */
  const friendAct = (friend: Friend, act: FriendAct, at: { x: number; y: number }, roach: PublicRoach | null) => {
    const on = roach ?? mainRoachOf(friend);
    if (act === "sanity") return remindSanity(friend, at);
    if (act === "visit") return on ? askVisit(friend, on) : setToast(T.map.visit.noRoach);
    if (act === "poke") {
      const main = friend.between?.mainId ? friend.roaches.find((r) => r.id === friend.between!.mainId) : null;
      if (!main) return setToast(T.map.visit.noRoach);
      setPanel(null);
      return poke({ ...main, asleep: true });
    }
    if (isGesture(act)) return doGesture(friend, act, on);
  };

  /** What the inbox's 触须之交 messages can do */
  const inboxFriendly: InboxFriendly = {
    answerSanity: async (itemId, answer) => {
      if (!(await friendly((w) => w.answerSanity(itemId, answer)))) return;
      if (answer === "done") setToast(T.map.common.toldThem);
      await refreshInbox();
    },
    gestureBack: async (friendId, gesture, itemId) => {
      const friend = shownFriends.find((f) => f.id === friendId);
      if (friend) await doGesture(friend, gesture, mainRoachOf(friend), itemId);
    },
    look: lookAt,
    sendHome,
    follow: followHost,
    goHome,
    gameAdded: async (itemId) => {
      if (!(await friendly((w) => w.gameAdded(itemId)))) return;
      setToast(T.map.game.friendsToo);
      await Promise.all([refreshInbox(), loadFriends()]);
    },
  };

  /** Their games on their page: 复制, 我在游戏里申请了, 想在游戏里加 TA, 游戏里也是好友 */
  const gameExtra = (friend: Friend) =>
    function gameRow(game: Game) {
      const b = friend.between;
      if (!b || !me) return null;
      const uid = friend.profile.uid?.[game];
      const state = b.games[game];
      const theirs = friend.profile.uidServer?.[game];
      const mine = me.profile.uidServer[game];
      const apart = Boolean(uid && theirs && mine && theirs !== mine);
      return (
        <dd className="game-extra">
          {state?.added && <span className="game-tag">{T.map.game.inGameToo}</span>}
          {uid && (
            <button className="pill" onClick={() => copyUid(uid)}>
              {T.map.game.copy}
            </button>
          )}
          {uid && !state?.added && apart && <span className="muted">{T.map.game.otherServer}</span>}
          {uid && !state?.added && !apart && (
            <button className="pill dark" disabled={friendBusy || Boolean(state?.askAgainAt)} onClick={() => gameAsk(friend, game)}>
              {state?.askAgainAt ? T.map.common.toldThem : T.map.game.askedInGame}
            </button>
          )}
          {!uid && (
            <button className="pill" disabled={friendBusy || Boolean(b.wantAgainAt)} onClick={() => gameWant(friend, game)}>
              {b.wantAgainAt ? T.map.common.toldThem : T.map.game.wantInGame}
            </button>
          )}
        </dd>
      );
    };

  /** Tapping 阿米娅向导 sets her dancing to her music (not while motion is turned down); a tap meanwhile starts her over */
  const danceAmiya = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = Date.now();
    const until = (ms: number) => {
      window.clearTimeout(danceTimer.current);
      danceTimer.current = window.setTimeout(stopDance, ms);
    };
    setAmiyaDance(started);
    until(DANCE_MS);
    // with the music on, she dances as long as it plays
    playMusic().then((ms) => {
      if (ms !== null && danceStarted.current === started) until(ms);
    });
    danceStarted.current = started;
  };
  const danceStarted = useRef(0);
  const stopDance = () => {
    window.clearTimeout(danceTimer.current);
    setAmiyaDance(null);
    stopMusic();
  };
  /** Her music on or off, from her card; off stops it at once */
  const switchMusic = () => {
    const on = !musicOn();
    setMusicOn(on);
    setMusic(on);
  };
  // the music stops as the page goes out of sight
  useEffect(() => {
    setMusic(musicOn());
    const hide = () => {
      if (document.visibilityState !== "visible") stopDance();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  /** What a guide says pops up over her head for a few seconds (null: she stops). */
  const say = (id: GuideId, line: string | null, ms = 4000) => {
    window.clearTimeout(sayTimers.current[id]);
    setSays((all) => ({ ...all, [id]: line ?? undefined }));
    if (line) sayTimers.current[id] = window.setTimeout(() => setSays((all) => ({ ...all, [id]: undefined })), ms);
  };

  /**
   * What a guide says as she touches back, as far as a speech bubble has room: 塔露拉干员's handshake only begins
   * there, and 祀掌柜's first sentence (si: the rest of what came of touching her).
   */
  const guideLine = (g: NonNullable<TouchResult["guide"]>, si?: TouchResult["si"]) => {
    const games = me?.profile.games ?? [];
    if (g.id === PERLICA_ID) return touchBackLine(g.kind, g.bold, g.times, g.others, g.line);
    if (g.id === TALULAH_ID) return g.kind === "friend" ? TALULAH_LINES.hello : talulahTouchLine("touch", g.bold, games);
    if (g.id === MINGHE_ID) return mingheTouchLine(g.kind === "friend" ? "friend" : "touch", g.bold);
    if (g.id === SI_ID) return firstSentence(answerLine(si?.answer ?? (g.kind === "friend" ? "friend" : "touch"), g.bold, g.line));
    return amiyaLine(g.bold ? "bold" : "sneaky", games);
  };

  /** Whatever waited for 佩丽卡监督's notes to have their turn, once the last of them has. */
  const runAfterReport = () => {
    if (notesRef.current.length) return;
    const then = afterReport.current;
    afterReport.current = null;
    then?.();
  };

  /** Touch a guide on the map: she touches back at once, and says so over her head once the scene is over. */
  const touchGuide = async (roach: PublicRoach, bold: boolean) => {
    const id = roach.id as GuideId;
    const res = await once("touch", () => act((w) => w.touch(id, bold)));
    if (!res?.guide) return;
    if (id === SI_ID) {
      siTouched.current = true;
      // what she is about to say on screen is heard there: marked at once, before the badge her inn may bring
      // makes the page look for news (which would open 消息 over the scene)
      const heard = [res.guide.itemId, res.si?.innItemId].filter((i): i is string => Boolean(i));
      const b = boundsRef.current;
      if (heard.length && b && inBounds(SI_AT, b)) await worldRef.current!.markSeen(heard).catch(() => {});
    }
    setSelected(null);
    // what she has to say comes before the badge her inn brought, which the page learns of during the scene
    const innLine = res.si ? siInnLine(res.si) : null;
    const siSays = id === SI_ID && Boolean(res.guide.itemId || innLine);
    if (siSays) setSiAboutToSay(true);
    const loading = res.newFriend || res.si ? Promise.all([loadFriends(), loadMe()]) : null;
    // should the page not catch up, she says nothing more, and the badge need not wait
    if (siSays) loading?.catch(() => setSiAboutToSay(false));
    const played = await playTouch(roach, res.newFriend ? "friend" : bold ? "bold" : "sneaky");
    const { itemId } = res.guide;
    if (res.newFriend) befriendedToast(res.newFriend);
    else if (itemId) touchedToast(bold);
    else if (!res.si || res.si.inn.event === "none" || res.si.inn.event === "resting") quietGuideToast(id);
    else touchedToast(bold);
    if (id === AMIYA_ID && step === "touch") updateProgress({ practiced: true });
    await loading;
    // 缘缘庄's news, hers to say over her head after her answer (or alone, on a touch she did not answer); her line
    // about the room it went straight into is heard there too, so 消息 does not open for it
    if (res.si) void loadSiState();
    // your ink roach, drawn in by her brush where it goes, now the page has it (not one she holds for you)
    if (res.si?.inn.drawn && res.si.you?.state !== "held") setSiBrushFrom(Date.now());

    if (!itemId && innLine) {
      window.setTimeout(() => {
        say(SI_ID, innLine);
        setSiAboutToSay(false);
      }, played ? 0 : 1500);
    }
    // she touched back once already today: nothing more from her
    if (!itemId) return;
    const line = guideLine(res.guide, res.si);
    const at =
      id === PERLICA_ID ? perlicaShown : id === TALULAH_ID ? FIRE_AT : id === MINGHE_ID ? mingheAt : id === SI_ID ? SI_AT : AMIYA_AT;
    window.setTimeout(async () => {
      say(id, line);
      if (siSays) setSiAboutToSay(false);
      if (innLine) window.setTimeout(() => say(SI_ID, innLine), 3800);
      // she gave you a portrait as you became 触须之交 (perhaps her own, by mistake): the book opens on it
      if (id === SI_ID && res.si?.portrait) window.setTimeout(() => setPanel({ kind: "siBook" }), innLine ? 6500 : 2600);
      // touching 阿米娅向导 got 佩丽卡监督 to speak up too, along the top
      if (res.aside) queueNote({ lines: [PERLICA_MORE.aside] });
      // heard on the spot while she is on screen; otherwise it waits in 消息
      const bounds = boundsRef.current;
      if (bounds && at && inBounds(at, bounds) && !busyRef.current.panel) {
        await worldRef.current!.markSeen([itemId]).catch(() => {});
      } else {
        const g = GUIDES[id];
        await playDockRef.current("bold", { name: g.name, avatar: g.avatar, color: g.color });
        setToast(fmt(T.map.inbox.guideTouchedBack, { name: g.name }));
      }
      await loadInbox();
      runAfterReport();
    }, played ? 0 : 1500);
  };

  /**
   * Touch back one of 阿米娅向导's touches from a card, where her answer shows at once and so counts as
   * seen. Resolves to her line, "" when she touched back once already today, null when it did not go.
   */
  const touchBackAmiya = async (item: AmiyaItem, bold: boolean) => {
    const res = await act((w) => w.reply(item.id, bold));
    if (!res?.guide) return null;
    const answer = res.guide.itemId;
    await worldRef.current!.markSeen(answer ? [item.id, answer] : [item.id]).catch(() => {});
    if (res.newFriend) befriendedToast(res.newFriend);
    // she touched back once already today: the card says so
    if (!answer) {
      await Promise.all([loadInbox(), loadMe()]);
      return "";
    }
    const line = guideLine(res.guide);
    say(AMIYA_ID, line);
    if (res.aside) queueNote({ lines: [PERLICA_MORE.aside] });
    await Promise.all([loadInbox(), loadFriends(), loadMe()]);
    return line;
  };

  /** Done with her greeting: seen; then 佩丽卡监督's report, if one waits, and whatever else is unread opens, as on any visit. */
  const closeGreeting = async (item: AmiyaItem) => {
    setPanel(null);
    await worldRef.current!.markSeen([item.id]).catch(() => {});
    const [items] = await Promise.all([loadInbox(), loadMe()]);
    const unread = () => {
      if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
    };
    if (reportDue.current) afterReport.current = unread;
    else unread();
  };

  const keepSnapshot = (items: InboxItem[]) =>
    setPanel((p) =>
      p?.kind === "inbox"
        ? { ...p, items: items.map((i) => ({ ...i, seen: p.items.find((x) => x.id === i.id)?.seen ?? i.seen })) }
        : p,
    );

  const ignore = async (itemId: string) => {
    const done = await act((w) => w.ignore(itemId).then(() => true));
    if (!done) return;
    setToast(T.map.inbox.crawledAway);
    keepSnapshot(await loadInbox());
  };

  const react = async (itemId: string, reaction: string) => {
    const done = await act((w) => w.react(itemId, reaction).then(() => true));
    if (!done) return;
    setToast(T.map.inbox.reacted);
    keepSnapshot(await loadInbox());
  };

  const repliedToast = (bold: boolean) => setToast(bold ? T.map.inbox.repliedBold : T.map.inbox.repliedSneaky);

  const reply = async (itemId: string, bold: boolean) => {
    const res = await act((w) => w.reply(itemId, bold));
    if (!res) return;
    if (res.newFriend) befriendedToast(res.newFriend);
    // a guide answers at once: her touch is now at the top of 收到的触碰 (once a day)
    else if (res.guide?.itemId) setToast(fmt(T.map.inbox.guideReplied, { name: GUIDES[res.guide.id].name }));
    else if (res.guide) quietGuideToast(res.guide.id);
    else repliedToast(bold);
    if (res.guide?.itemId) say(res.guide.id, guideLine(res.guide, res.si));
    if (res.si) {
      const innLine = siInnLine(res.si);
      if (innLine) window.setTimeout(() => say(SI_ID, innLine), res.guide?.itemId ? 3800 : 0);
      void loadSiState();
    }
    if (res.aside) queueNote({ lines: [PERLICA_MORE.aside] });
    const [items] = await Promise.all([loadInbox(), loadFriends()]);
    keepSnapshot(items);
    if (me?.isNew || res.newFriend || res.si) await loadMe();
    if (demoRef.current) await loadIdentities();
  };

  const openRadar = async () => {
    setSelected(null);
    const radar = await act((w) => w.radar());
    if (radar !== undefined) setPanel({ kind: "radar", radar });
    if (radar) setLastRadar(radar);
  };

  /** How close to fly to a roach: Amap draws nothing abroad close in, so 阿米娅向导 is shown from further out there. */
  const zoomFor = (roach: PublicRoach, zoom: number) =>
    roach.id === TALULAH_ID
      ? FIRE_ZOOM
      : roach.id === SI_ID
        ? SI_ZOOM
        : roach.id === MINGHE_ID
        ? MINGHE_ZOOM
        : // abroad, visitors from mainland China see our own map, which draws Rhode Island close up
        roach.id === AMIYA_ID && basemap === "amap" && !cn
        ? Math.min(zoom, AMIYA_AMAP_ZOOM)
        : zoom;

  const findFriendRoach = (roach: PublicRoach) => {
    setPanel(null);
    setFocus({ lng: roach.lng, lat: roach.lat, zoom: zoomFor(roach, 13), nonce: Date.now() });
    setSelected({ kind: "other", roach });
  };

  const unfriend = async (friend: Friend) => {
    const guide = guideById(friend.id);
    const question = guide
      ? guide.id === AMIYA_ID
        ? amiyaUnfriend()
        : guide.id === PERLICA_ID
          ? perlicaUnfriend()
          : guide.id === MINGHE_ID
            ? MINGHE_LINES.unfriendAsk
            : guide.id === SI_ID
              ? SI_LINES.unfriendAsk
              : TALULAH_LINES.unfriendAsk
      : fmt(T.map.safety.unfriendAsk, { name: friend.profile.displayName });
    if (!window.confirm(question)) return;
    const done = await act(
      (w) => w.unfriend(friend.id).then(() => true),
      guide?.id === PERLICA_ID
        ? fmt(T.map.guides.saysQuoted, { name: GUIDES.perlica.name, line: PERLICA_LINES.unfriend })
        : guide?.id === TALULAH_ID
          ? fmt(T.map.guides.says, { name: GUIDES.talulah.name, line: TALULAH_LINES.unfriend })
          : guide?.id === MINGHE_ID
            ? fmt(T.map.guides.says, { name: GUIDES.minghe.name, line: MINGHE_LINES.unfriend })
            : guide?.id === SI_ID
              ? fmt(T.map.guides.says, { name: GUIDES.si.name, line: SI_LINES.unfriend })
              : T.map.safety.unfriended,
    );
    if (!done) return;
    await Promise.all([loadFriends(), guide ? loadMe() : null]);
    await openInbox(false, "friends");
  };

  // After blocking, land back in the inbox, where their messages are now gone
  const afterBlock = async (p: Extract<Panel, { kind: "safety" }>) => {
    await loadFriends();
    await openInbox(false, p.back?.kind === "inbox" ? p.back.tab : "friends");
  };

  const blockSender = async (p: Extract<Panel, { kind: "safety" }>) => {
    const done = await act((w) => w.block(p.target).then(() => true), T.map.safety.blocked);
    if (done) await afterBlock(p);
  };

  const reportSender = async (p: Extract<Panel, { kind: "safety" }>, reason: ReportReason, note: string) => {
    const done = await act(
      (w) => w.report(p.target, reason, note).then(() => true),
      T.map.safety.reported,
    );
    if (done) await afterBlock(p);
  };

  /** 我觉得处理错了: once sent, the note says so, in the open inbox and the list it was opened from */
  const appeal = async (itemId: string, actionId: string, text: string) => {
    const sent = await act((w) => w.appeal(actionId, text).then(() => true), T.map.safety.appealed);
    if (!sent) return false;
    const mark = (i: InboxItem): InboxItem => (i.kind === "staff" && i.id === itemId && i.appeal ? { ...i, appeal: { ...i.appeal, state: "sent" } } : i);
    setInbox((all) => all.map(mark));
    setPanel((p) => (p?.kind === "inbox" ? { ...p, items: p.items.map(mark) } : p));
    return true;
  };

  /**
   * 站长清理, on an admin's map (src/lib/server/admin.ts): take back a roach, or every other player's roach
   * near it, at once; what would go is counted and shown first. Its owners get a yellow card and a 站长通知.
   */
  const takeBack = async (roach: PublicRoach, near: boolean) => {
    setCleaning(true);
    try {
      let ids = [roach.id];
      if (near) {
        const said = window.prompt(T.map.admin.takeBackAsk, "300");
        if (!said) return;
        const meters = Math.min(3000, Math.max(1, Math.round(Number(said) || 0)));
        const list = await adminCall<{ id: string; ownerId: string }[]>("roachesNear", [roach.lng, roach.lat, meters]);
        if (!list.length) return setToast(T.map.admin.noneNear);
        const players = new Set(list.map((r) => r.ownerId)).size;
        const sure = window.confirm(
          fmt(T.map.admin.takeBackMany, { meters, n: list.length, players }),
        );
        if (!sure) return;
        ids = list.map((r) => r.id);
      } else if (!window.confirm(T.map.admin.takeBackOne)) {
        return;
      }
      const done = await adminCall<{ roaches: number; players: number }>("takeBackRoaches", [ids, "roach"]);
      setSelected(null);
      setAdminShut(false);
      setToast(done.roaches ? fmt(T.map.admin.tookBack, { roaches: done.roaches, players: done.players }) : T.map.admin.tookNone);
    } catch (e) {
      // the 管理台 locked on this device (its hours passed, or it was never opened here): a code there first
      if (e instanceof AdminError && e.gate) {
        setAdminShut(true);
        setToast(T.map.admin.unlockFirst);
      } else setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setCleaning(false);
    }
  };

  const onReportedMarks = useCallback((overlays: MapOverlay[], lines: MapLine[]) => setReportedMarks({ overlays, lines }), []);
  // a reported roach, lift pixels above the middle of the map: the middle that far below it (Web Mercator, 512-pixel tiles)
  const focusReported = useCallback((at: LngLat, lift: number, zoom = Math.max(viewRef.current.zoom, 15)) => {
    const lat = at.lat - (lift * 360 * Math.cos((at.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    setFocus({ lng: at.lng, lat, zoom, nonce: Date.now() });
  }, []);
  const closeReported = useCallback(() => setReported(null), []);
  const unselect = useCallback(() => setSelected(null), []);
  // /?case=… from the 管理台: the owner's or a moderator's map opens 看被举报的蟑螂 at that case, and the address
  // forgets it; for anyone else it is nothing
  const reviewer = Boolean(me?.admin || me?.mod);
  useEffect(() => {
    if (!reviewer) return;
    const q = new URLSearchParams(window.location.search);
    const caseId = q.get("case");
    if (!caseId) return;
    q.delete("case");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
    setSelected(null);
    setReported({ start: caseId });
  }, [reviewer]);

  // 圈禁放区, the owner's: round a roach (its card, 看被举报的蟑螂) or where the map is; the roach's card and 看被举报的蟑螂
  // make way, and a tap on the map or a roach does nothing meanwhile
  const isOwner = Boolean(me?.admin);
  const drawZoneAt = useCallback((at: LngLat | null) => {
    setSelected(null);
    setReported(null);
    setPanel(null);
    setZoneTool({ kind: "draw", at, key: Date.now() });
  }, []);
  const closeZoneTool = useCallback(() => {
    setZoneTool(null);
    setZoneLines([]);
  }, []);
  // /?draw=1 and /?zone=… from the 管理台's 禁放区: the owner's map opens 圈禁放区 or goes to that place, and the address
  // forgets them; for anyone else they are nothing
  useEffect(() => {
    if (!isOwner) return;
    const q = new URLSearchParams(window.location.search);
    const zone = q.get("zone");
    if (!zone && !q.has("draw")) return;
    q.delete("zone");
    q.delete("draw");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}${window.location.hash}`);
    if (zone) {
      setSelected(null);
      setReported(null);
      setZoneTool({ kind: "view", id: zone, key: Date.now() });
    } else drawZoneAt(null);
  }, [isOwner, drawZoneAt]);

  /** 举报这只蟑螂: nobody is blocked, so nothing else changes on the page */
  const reportRoach = async (roach: PublicRoach, reason: RoachReportReason, note: string) => {
    const done = await act((w) => w.reportRoach(roach.id, reason, note).then(() => true), T.map.safety.roachReported);
    if (done) setPanel(null);
  };

  const unblock = async (blockId: string) => {
    const done = await act((w) => w.unblock(blockId).then(() => true), T.map.safety.unblocked);
    if (!done) return;
    setBlocked(await worldRef.current!.blocks());
    await loadInbox();
  };

  const saveProfile = async (p: Profile) => {
    const saved = await act((w) => w.saveProfile(p), T.map.account.saved);
    if (saved) await loadMe();
    return Boolean(saved);
  };

  /**
   * Shout a declaration over the map, on this screen only (ShoutStage): the map goes to the
   * first roach it went out from (the main one when it is among them), close enough for its
   * 10 km to show, and leaves that roach out meanwhile; toast comes as the rings reach 10 km.
   * Then the line stays over each of those roaches for a few seconds, off screen too, so
   * pulling the map out shows it in every place it went out from. Without the scene (motion
   * turned down, roaches 写实) only the toast.
   */
  const playShout = (d: Declaration, from: string[], toast: () => void) => {
    const sent = (me?.roaches ?? []).filter((r) => from.includes(r.id));
    const first = sent.find((r) => r.slot === 0) ?? sent[0];
    if (!first || look === "real" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return toast();
    const wrap = wrapRef.current;
    const w = wrap?.clientWidth ?? window.innerWidth;
    const h = wrap?.clientHeight ?? window.innerHeight;
    const zoom = shoutZoom(first.lat, w, h, viewRef.current.zoom);
    setFocus({ lng: first.lng, lat: first.lat, zoom, nonce: Date.now() });
    const text = declarationText(d);
    const limited = d.template === "event";
    const bubbles = () => {
      const at = Date.now();
      const marks = sent.map((r) => ({ id: `${r.id}:${at}`, at: { lng: r.lng, lat: r.lat }, text, limited }));
      setShouts((all) => [...all, ...marks]);
      window.setTimeout(() => setShouts((all) => all.filter((s) => !marks.includes(s))), BUBBLE_MS + BUBBLE_FADE_MS);
    };
    setShouting({
      roach: first.id,
      text,
      limited,
      place: shoutPlace(w, h, first.lat, zoom, MINE_PX),
      toast,
      done: () => {
        setShouting(null);
        bubbles();
      },
    });
  };

  const declare = async (d: Declaration, from: string[]) => {
    const res = await act((w) => w.declare(d, from));
    if (!res) return false;
    // the card goes first, then the shout plays over the map
    setPanel(null);
    playShout(d, from, () => setToast(fmt(T.map.declare.sent, { reach: res.reach })));
    if (demoRef.current) await loadIdentities();
    // the tutorial's greeting step is done however it was sent, and a limited line earns a badge
    await loadMe();
    return true;
  };

  const become = async (id: string) => {
    const done = await act((w) => w.become(id).then(() => true));
    if (!done) return;
    setPanel(null);
    setSelected(null);
    setPlacing(null);
    const { me: m, items, away, friends: list } = await load();
    setNotes([...(away ? [awayNote(away)] : []), ...openingNotes(m, list)]);
    const main = m?.roaches.find((r) => r.slot === 0);
    if (main) setFocus({ lng: main.lng, lat: main.lat, zoom: 11, nonce: Date.now() });
    if (m?.ageCheck) setPanel({ kind: "ageCheck" });
    else if (m?.mustReconsent) setPanel({ kind: "consent" });
    else if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
    else setToast(T.map.demo.switched);
  };

  const signedIn = async () => {
    setPanel(null);
    const spot = preview;
    setPreview(null);
    // the whole list at once, now that the server gives it
    forgetRoaches();
    const { me: m, items, away, friends: list } = await load();
    const mainRoach = m?.roaches.find((r) => r.slot === 0);
    if (mainRoach) setFocus({ lng: mainRoach.lng, lat: mainRoach.lat, zoom: 11, nonce: Date.now() });
    const next = () => {
      setNotes([...(away ? [awayNote(away)] : []), ...openingNotes(m, list)]);
      if (m?.ageCheck) return setPanel({ kind: "ageCheck" });
      if (m?.mustReconsent) return setPanel({ kind: "consent" });
      // a newcomer who picked a spot before signing in puts their roach there, once they confirm
      if (m && !mainRoach && spot) {
        return setPanel({ kind: "placeConfirm", target: { kind: "main" }, spot, fly: true, consent: !m.agreedPublicPlace });
      }
      if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
      else setToast(m && !mainRoach ? T.map.account.signedInPlace : T.map.account.signedIn);
    };
    // the notice due comes first on every sign-in, even after one popped up earlier in this visit: for a
    // newcomer, the first thing after signing up but which 界面 they want, so the tutorial points at its buttons
    const noticeThenNext = () => (m ? popNotice(m, next) : next());
    if (asksUi(m, uiChoice)) setPanel({ kind: "uiPicker", then: noticeThenNext });
    else noticeThenNext();
  };

  // ---- the tutorial's steps ----

  const greet = async (d: Declaration) => {
    if (!tutorialMain) return;
    setGreeting(true);
    const res = await act((w) => w.declare(d, [tutorialMain.id]));
    setGreeting(false);
    if (!res) return;
    // nobody heard it yet, so say so plainly
    setToast(fmt(T.map.declare.greeted, { reach: res.reach, more: res.reach === reachText(0) ? T.map.declare.quiet : "" }));
    await loadMe();
  };

  const showRoach = (roach: PublicRoach) => {
    setPanel(null);
    setFocus({ lng: roach.lng, lat: roach.lat, zoom: zoomFor(roach, 14), nonce: Date.now() });
    setSelected({ kind: "other", roach });
  };

  const leave = async (kind: "signOut" | "delete") => {
    if (kind === "delete" && !window.confirm(T.map.account.deleteAsk)) return;
    try {
      await (kind === "delete" ? deleteAccount() : signOut());
    } catch (e) {
      setToast(e instanceof Error ? e.message : T.map.common.tryAgain);
      return;
    }
    setPanel(null);
    setSelected(null);
    saveHome(null);
    // signed out, the map is 全员隐匿 again and the roaches held go (a visitor gets none)
    forgetRoaches();
    await load();
    setToast(kind === "delete" ? T.map.account.deleted : T.map.account.signedOut);
  };

  /** 「我已满 18 岁」 on the card the admin asked for */
  const confirmAge = async () => {
    const done = await act((w) => w.confirmAge().then(() => true));
    if (!done) return;
    await loadMe();
    setPanel(null);
    setToast(T.map.account.thanks);
  };

  const agreeAgain = async (ticks: Parameters<typeof reconsent>[0], then: Panel | null) => {
    try {
      await reconsent(ticks);
    } catch (e) {
      setToast(e instanceof Error ? e.message : T.map.common.tryAgain);
      return;
    }
    await loadMe();
    setPanel(then);
    setToast(T.map.account.thanks);
  };

  /** 假装过了一天 / 假装离开两天, then open the page afresh as a new visit would */
  const pretend = async (what: "day" | "away") => {
    const done = await act((w) => w.pretend(what).then(() => true));
    if (done) window.location.reload();
  };

  /** 假装离开 for 佩丽卡监督: the time kept goes back, and so does this page's, then a fresh visit without its 「走了」 */
  const pretendLeft = async (seconds: number) => {
    const done = await act((w) => w.pretend("left", seconds).then(() => true));
    if (!done || !me) return;
    skipLeave.current = true;
    rewindSpot(me.id, seconds);
    window.location.reload();
  };

  /** 佩丽卡监督's second step, development only: what the identity sheet pretends */
  const perlicaMore = async (what: "drank" | "days" | "birthday" | "week") => {
    if (!me) return;
    if (what === "drank") {
      setPanel(null);
      return setToast(rewindDrank(me.id, 7) ? T.map.demo.drankRewound : T.map.demo.timerFirst);
    }
    if (what === "birthday") {
      const done = await act((w) => w.pretend("perlicaBirthday").then(() => true));
      if (done) setToast(T.map.demo.birthday);
      return;
    }
    const done = await act((w) => w.pretend(what === "days" ? "perlicaDays" : "perlicaWeek").then(() => true));
    if (!done) return;
    if (what === "days") forgetAnniversary(me.id);
    window.location.reload();
  };

  /** 让佩丽卡重新问一次 */
  const askAgain = async () => {
    const done = await act((w) => w.pretend("ask").then(() => true));
    if (done) window.location.reload();
  };

  /** Her question answered on her card: yes starts her 离开计时; no (or closing it) leaves it off, and she says so. */
  const answerPerlica = async (on: boolean) => {
    setPanel(null);
    const done = await act((w) => w.setPerlicaTimer(on).then(() => true));
    if (!done) return;
    await loadMe();
    if (on) setToast(T.map.guides.perlicaOn);
    else {
      setToast(fmt(T.map.guides.saysQuoted, { name: GUIDES.perlica.name, line: PERLICA_LINES.declined }));
      say(PERLICA_ID, PERLICA_LINES.declined);
    }
  };

  /** Her timer switched in 资料, after the rest of it saved. */
  // 只看本体 (OnlyMainsSheet): shown at once, then kept on the account; put back if the server says no
  const pickOnlyMains = async (on: boolean) => {
    if (!me || me.onlyMains === on) return;
    const flip = (to: boolean) => setMe((m) => (m ? { ...m, onlyMains: to } : m));
    flip(on);
    const done = await act((w) => w.setOnlyMains(on).then(() => true));
    // set again, in case who is signed in was read in between
    flip(done ? on : !on);
    if (done) setToast(on ? T.onlyMains.toastOn : T.onlyMains.toastOff);
    // which declarations 消息 holds changed with it (and so its counts)
    if (done) void loadInbox().catch(() => {});
  };

  const switchPerlicaTimer = async (on: boolean) => {
    const done = await act((w) => w.setPerlicaTimer(on).then(() => true));
    if (done && !on && me) forgetDrank(me.id);
    if (done) await loadMe();
    return Boolean(done);
  };

  const reset = async () => {
    if (!window.confirm(T.map.demo.resetAsk)) return;
    await act((w) => w.reset(), T.map.demo.reset);
    setPanel(null);
    setSelected(null);
    setPlacing(null);
    await load();
  };

  const myColor = me?.profile.color ?? "cyan";
  const myAvatar = me?.profile.avatar ?? "hood";
  const main = me?.roaches.find((r) => r.slot === 0);
  // your ink roach at 缘缘庄 is on the map (queuing, staying or in the fields): one of your MAX_CLONES clones
  const inkOut = Boolean(me?.si.inn && me.si.inn.state !== "held");
  // 佩丽卡监督 keeps watch beside the drunk main roach (the map sets her just to its right), then goes back to her spot
  const guarding = Boolean(me?.drunkUntil && main && perlicaAt);
  const perlicaShown = guarding && main ? { lng: main.lng, lat: main.lat } : perlicaAt;
  // the envelope's red count, of what came to you, and its yellow speaker, for declarations sent nearby
  const envelope = dockCounts(inbox);
  // what is near the spot a visitor tapped, counted by the server (a visitor has no list): only the last of
  // quick taps is asked about
  const [around, setAround] = useState<{ near: number; far: number } | "failed" | null>(null);
  useEffect(() => {
    setAround(null);
    if (!preview) return;
    const asking = new AbortController();
    const t = window.setTimeout(() => {
      worldRef.current!.around(preview, asking.signal).then(setAround, () => {
        if (!asking.signal.aborted) setAround("failed");
      });
    }, 250);
    return () => {
      window.clearTimeout(t);
      asking.abort();
    };
  }, [preview]);
  const nearest = useMemo(
    () => (step === "touch" && tutorialMain ? nearestReal(roaches, tutorialMain) : null),
    [step, tutorialMain, roaches],
  );
  const current = identities.find((i) => i.current);
  const othersUnseen = identities.filter((i) => !i.current).reduce((n, i) => n + i.unseen, 0);
  // 佩丽卡监督 stands wherever this page put her, which the server never knows
  const shownLng = perlicaShown?.lng;
  const shownLat = perlicaShown?.lat;
  const shownFriends = useMemo(
    () =>
      friends.map((f) =>
        f.id === PERLICA_ID
          ? { ...f, roaches: shownLng !== undefined && shownLat !== undefined ? [perlicaRoach({ lng: shownLng, lat: shownLat }, true)] : [] }
          : f,
      ),
    [friends, shownLng, shownLat],
  );
  const selectedFriend =
    selected?.kind === "other" && selected.roach.friend
      ? shownFriends.find((f) => f.roaches.some((r) => sameRoach(selected.roach.id, r.id)))
      : undefined;
  // the server's count until there is a list to count (a visitor never has one)
  // signed in, the server's count: the page holds only the roaches of the area it shows
  const total =
    visitorCounts && !feedRoaches.length
      ? visitorCounts.total
      : areaTotals && !fakeFeed
        ? areaTotals.total
        : roaches.length + (me?.roaches.length ?? 0);
  // How many players have roaches on the map: as many as there are main roaches, as a clone needs its player's main
  // roach there first (show roaches are nobody's). The server's count, as for total, but for the whole list held
  // (?whole=1, AREA_FEED=off, the development crowd); none from a server from before it counted them.
  const heldPlayers = useMemo(() => roaches.reduce((n, r) => n + (r.clone || r.bot ? 0 : 1), 0), [roaches]);
  const players =
    visitorCounts && !feedRoaches.length
      ? visitorCounts.players
      : areaTotals && !fakeFeed
        ? areaTotals.players
        : heldPlayers + (me?.roaches.some((r) => r.slot === 0) ? 1 : 0);


  const coachShown = Boolean(!placing && !selected && !panel && !board && !pamphlet && me && step);
  // 抽屉's drawer goes back down for a roach's card, for putting a roach down, and for the tutorial, which want the map
  useEffect(() => {
    if (selected || placing || coachShown) setDrawerOpen(false);
  }, [selected, placing, coachShown]);
  // a side folded away may hold what the tutorial speaks of (方舟雷达, the guides): out it comes while it is on. What
  // is left of it is read again here, as the step can run ahead of it for a moment when the player first comes
  const anyFolded = fold.float.l || fold.float.r || fold.hud.r;
  useEffect(() => {
    if (coachShown && anyFolded && me && tutorialStep(me, loadProgress(me.id))) changeFold(UNFOLDED);
  }, [coachShown, anyFolded, changeFold, me]);
  // 公告's red dot and strip, once the opening has had its turn (a notice due pops up before them); the strip
  // not over the tutorial, nor while a sheet covers it
  const noticeNow = Date.now();
  const noticeDotOn = settled && noticeDot(boardNotices, noticeMem, noticeNow);
  const strip = settled && !panel && !board && !pamphlet && !step ? stripNotice(boardNotices, noticeMem, noticeNow) : null;

  // 获得新称号: once nothing else is on screen and the page is looked at, up to three in a row; any more go
  // straight to the wall. Once on each device (src/lib/badgesPopped.ts): one this browser showed before, in
  // another tab too, never pops up again, though the server still having it unseen is told again
  const [newBadges, setNewBadges] = useState<EarnedBadge[]>([]);
  const meIdForBadges = me?.id;
  const [badgesPopped, setBadgesPopped] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!meIdForBadges) {
      setBadgesPopped(new Set());
      return;
    }
    const read = () => setBadgesPopped(poppedBadges(meIdForBadges));
    read();
    // another tab showed some
    const onStorage = (e: StorageEvent) => {
      if (e.key === poppedStorageKey(meIdForBadges)) read();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [meIdForBadges]);
  // while the site is gray (全站变灰) new badges wait to pop, with their confetti, until it ends; nothing waits for them
  const gray = useGrayNow();
  const unseenBadges = gray
    ? ""
    : (me?.badges ?? [])
        .filter((b) => !b.seen && !badgesPopped.has(poppedKey(b)))
        .map((b) => b.id)
        .join(",");
  // the page in a background tab: what would pop up waits until it is looked at
  const [pageShown, setPageShown] = useState(true);
  useEffect(() => {
    const look = () => setPageShown(document.visibilityState === "visible");
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, []);
  // nothing new opens over a touch scene: a title earned by the touch (见习外交官) waits for 成为触须之交 to play out
  // nothing on the map but the map (nor the owner's 禁放区 tool), the ask to set a password aside
  const mapClear = Boolean(me && !placing && !selected && !panel && !pamphlet && !step && !acting && !touchScene && !batchScene && !zoneTool);
  // 设个密码 is up: nothing else opens over it meanwhile
  const pwNudgeUp = pwNudge && Boolean(me?.passwordNudge);
  const idle = mapClear && !pwNudgeUp;
  // the hints: not over 最近更新, nor at all on a visit it popped up on (src/lib/pamphlet.ts)
  const hintsNow = hintsMayCome(Boolean(pamphlet), pamphletPopped);
  // 存到桌面's bubble, once per device: after about 20 seconds on the map with nothing else going on, the tutorial
  // and the style hint over (a new player's first roach starts the tutorial, so it comes after)
  const deskHintNow = Boolean(
    deskOffer && visible !== null && !placing && !step && !panel && !selected && !board && !styleHint && !pwNudgeUp && !uiMenu && hintsNow,
  );
  // the style hint: once the map is up (a slow line can take a while), not while placing, in the tutorial or
  // asked to set a password, nor to visitors
  const styleHintNow = Boolean(styleHint && !guest && visible !== null && !placing && !step && !pwNudgeUp && panel?.kind !== "uiPicker" && hintsNow);
  useEffect(() => {
    if (!deskHintNow || deskHint || deskHintSeen()) return;
    const t = window.setTimeout(() => {
      setDeskHint(true);
      markDeskHintSeen();
    }, 20_000);
    return () => window.clearTimeout(t);
  }, [deskHintNow, deskHint]);

  // ---- 佩丽卡监督 ----

  // Where she stands: near the main roach, once the tutorial is over; the same spot until the player
  // comes back after ten minutes away or moves the main roach (Perlica.tsx)
  const mainLng = main?.lng;
  const mainLat = main?.lat;
  const homeRef = useRef<LngLat | null>(null);
  homeRef.current = meId && mainLng !== undefined && mainLat !== undefined && !step ? { lng: mainLng, lat: mainLat } : null;
  useEffect(() => {
    setPerlicaAt(meId && homeRef.current ? perlicaSpot(meId, homeRef.current) : null);
    // the main roach moved on this page: she rides her 鬼火 over from where she stood, and says so as she stops
    const from = bikeFrom.current;
    if (from === undefined || !homeRef.current) return;
    bikeFrom.current = undefined;
    setPerlicaArrive({ from, nonce: Date.now() });
    const line = PERLICA_MORE.bike[pickOf(PERLICA_MORE.bike.length)];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => say(PERLICA_ID, line), still ? 0 : BIKE_MS);
  }, [meId, mainLng, mainLat, step]);

  // She tells the player how long they slept when they wake on this page (醒酒, moving or taking back
  // the main roach, or the morning coming), while her 离开计时 is on; opening the page tells the rest
  const drunkNow = Boolean(me?.drunkUntil);
  // ⚡舟友的酒⚡: its music fetched once the main roach lies drunk; over when it wakes, or moves
  useEffect(() => {
    if (drunkNow) preloadPartyMusic();
    else endParty();
  }, [drunkNow, endParty]);
  const mainSpot = main ? `${main.lng},${main.lat}` : "";
  const partySpot = party ? `${party.at.lng},${party.at.lat}` : "";
  useEffect(() => {
    if (partySpot && partySpot !== mainSpot) endParty();
  }, [partySpot, mainSpot, endParty]);
  const partyOverlays = useMemo<MapOverlay[]>(() => (party ? [{ id: `party-${party.key}`, at: party.at, el: party.el }] : []), [party]);
  // with the admin's marks of 看被举报的蟑螂, while it is open
  const mapOverlays = useMemo(
    () => (reportedMarks.overlays.length ? [...partyOverlays, ...reportedMarks.overlays] : partyOverlays),
    [partyOverlays, reportedMarks],
  );
  const drunkSeen = useRef<{ id: string; drunk: boolean } | null>(null);
  useEffect(() => {
    if (!me) {
      drunkSeen.current = null;
      return;
    }
    const was = drunkSeen.current?.id === me.id ? drunkSeen.current.drunk : null;
    drunkSeen.current = { id: me.id, drunk: drunkNow };
    if (!was || drunkNow) return;
    const drank = readDrank(me.id);
    if (!drank) return;
    forgetDrank(me.id);
    if (me.perlica.timer !== "on") return;
    const out: PerlicaNote[] = [];
    queueSleep(out, (Math.min(Date.now(), drank.until) - drank.at) / 1000);
    out.forEach(queueNote);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, drunkNow]);

  // Her 离开计时 while it is on: 「还在」 every minute the page is looked at and on coming back into view,
  // 「走了」 as it goes out of sight, closes or leaves the map. Her spot is kept on this page meanwhile.
  const timerOn = me?.perlica.timer === "on";
  useEffect(() => {
    if (!meId) return;
    // load() said 「还在」 a moment ago
    let last = Date.now();
    const here = () => {
      lookedAt(meId);
      last = Date.now();
      if (timerOn) worldRef.current!.here().then((item) => item && queueNote(awayNote(item)), () => {});
    };
    const tick = () => {
      if (document.visibilityState === "visible") here();
    };
    const gone = () => {
      if (skipLeave.current) return;
      lookedAt(meId);
      if (timerOn) worldRef.current!.leave();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return gone();
      if (Date.now() - last < 10_000) return;
      // back after a while: she may be standing somewhere new
      if (homeRef.current) setPerlicaAt(perlicaSpot(meId, homeRef.current));
      here();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", gone);
    const t = window.setInterval(tick, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", gone);
      window.clearInterval(t);
      gone();
    };
  }, [meId, timerOn]);

  // Her notes along the top once nothing else is on screen, one at a time, her bubble saying the first line
  useEffect(() => {
    if (!idle || note || !notes.length) return;
    setNote(notes[0]);
    setNotes((q) => q.slice(1));
  }, [idle, note, notes]);
  const endNote = () => {
    setNote(null);
    say(PERLICA_ID, null);
    runAfterReport();
  };
  useEffect(() => {
    if (!note) return;
    const ms = NOTE_MS[note.lines.length > 1 ? 1 : 0];
    say(PERLICA_ID, note.lines[0], ms);
    const t = window.setTimeout(endNote, ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);
  /** Tapped one of her notes: to her, with her card open; what waited for the notes comes once the card closes */
  const openNote = () => {
    setNote(null);
    if (!perlicaShown) return runAfterReport();
    setFocus({ lng: perlicaShown.lng, lat: perlicaShown.lat, zoom: 13, nonce: Date.now() });
    setSelected({ kind: "other", roach: perlicaRoach(perlicaShown, Boolean(me?.perlica.friend)) });
  };



  // 祀掌柜's answer and her line about 缘缘庄 come first, then the badge the inn brought
  const siTalking = Boolean(says.si) || siAboutToSay;

  /** 「看过了」 for these badges, tried again a few times, quietly, when it does not get through (a restart, the network gone) */
  const seeBadgesSurely = useCallback((userId: string, ids: string[]) => {
    const again = [2_000, 10_000, 60_000];
    const tell = (i: number) => {
      // signed out, or in as someone else, meanwhile: theirs are not these
      if (meIdRef.current !== userId || !worldRef.current) return;
      worldRef.current.seeBadges(ids).catch((e) => {
        if (i < again.length && !(e instanceof SignInNeeded)) window.setTimeout(() => tell(i + 1), again[i]);
      });
    };
    tell(0);
  }, []);

  useEffect(() => {
    if (!idle || perlicaBusy || siTalking || !unseenBadges || newBadges.length || !me || !pageShown) return;
    const userId = me.id;
    const unseen = me.badges.filter((b) => !b.seen);
    const ids = unseen.map((b) => b.id);
    let current = true;
    // read, kept as shown and shown, alone among this browser's tabs
    void alonePopping(userId, () => {
      if (!current || document.visibilityState !== "visible") return;
      // another tab may have just shown some
      const before = poppedBadges(userId);
      markBadgesPopped(userId, unseen);
      setBadgesPopped(poppedBadges(userId));
      setNewBadges(unseen.filter((b) => !before.has(poppedKey(b))).slice(0, 3));
      seeBadgesSurely(userId, ids);
      // seen on this page too, as the welcome back reads it; me as it is now, should it have been reloaded meanwhile
      const keys = new Set(unseen.map(poppedKey));
      setMe((m) => (m?.id === userId ? { ...m, badges: m.badges.map((b) => (keys.has(poppedKey(b)) ? { ...b, seen: true } : b)) } : m));
    });
    return () => {
      current = false;
    };
  }, [idle, perlicaBusy, siTalking, unseenBadges, newBadges.length, me, pageShown, seeBadgesSurely]);

  // Shown on this device (in another tab, maybe), though the server still has them unseen (its 「看过了」 never
  // got through): seen on this page as well, and the server told again, quietly, once a visit for each, so that
  // other devices do not show them again either
  const toldAgain = useRef(new Set<string>());
  useEffect(() => {
    if (!me) return;
    const userId = me.id;
    const again = new Set(me.badges.filter((b) => !b.seen && badgesPopped.has(poppedKey(b))).map(poppedKey));
    if (!again.size) return;
    const tell = me.badges.filter((b) => again.has(poppedKey(b)) && !toldAgain.current.has(`${userId}:${poppedKey(b)}`));
    for (const b of tell) toldAgain.current.add(`${userId}:${poppedKey(b)}`);
    if (tell.length) worldRef.current?.seeBadges(tell.map((b) => b.id)).catch(() => {});
    setMe((m) => (m?.id === userId ? { ...m, badges: m.badges.map((b) => (again.has(poppedKey(b)) ? { ...b, seen: true } : b)) } : m));
  }, [me, badgesPopped]);

  // The tutorial's touch step happens on Rhode Island: the map goes to 阿米娅向导 as it begins
  const touchLesson = step === "touch" && !progress.practiced && basemap !== null;
  useEffect(() => {
    if (!touchLesson) return;
    const amiya = amiyaRoach(false);
    setFocus({ lng: amiya.lng, lat: amiya.lat, zoom: zoomFor(amiya, 13), nonce: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchLesson]);

  // 祀来舟P地图啦: told once in this browser to every player with a roach, her 触须之交 too, never during the tutorial.
  // Her effect comes before the other four's, so on a visit where several are due hers is the one shown (one card a
  // visit: introduced); theirs take their turns on the visits after, as before
  const meIdForIntro = me?.id;
  const siTells = Boolean(
    settled && idle && !perlicaBusy && main && me && !me.mustReconsent && !newBadges.length && !unseenBadges,
  );
  useEffect(() => {
    if (!siTells || !meIdForIntro || introduced.current || siIntroShown(meIdForIntro)) return;
    markSiIntroShown(meIdForIntro);
    introduced.current = true;
    setPanel({ kind: "siIntro" });
  }, [siTells, meIdForIntro]);

  // 阿米娅向导 introduces herself once to players with a roach who have not met her, after everything else
  const introDue = Boolean(
    settled && idle && !perlicaBusy && main && me && !me.amiya.friend && !newBadges.length && !unseenBadges,
  );
  useEffect(() => {
    if (!introDue || !meIdForIntro || introduced.current || introShown(meIdForIntro)) return;
    markIntroShown(meIdForIntro);
    introduced.current = true;
    setPanel({ kind: "amiyaIntro" });
  }, [introDue, meIdForIntro]);

  // 设个密码 (PasswordNudge.tsx), for a player whose codes may not arrive just now: once a visit, a moment after
  // the map falls quiet with every other prompt over (an introduction, new titles, the hints), so it never
  // comes with one of them; 下次再说 puts it off on this device
  const pwNudgeDue = Boolean(
    settled &&
      idle &&
      !perlicaBusy &&
      me?.passwordNudge &&
      !me.mustReconsent &&
      !board &&
      hintsNow &&
      !styleHintNow &&
      !deskHint &&
      !liteHint &&
      !newBadges.length &&
      !unseenBadges,
  );
  const pwNudged = useRef(false);
  useEffect(() => {
    if (!pwNudgeDue || !meIdForIntro || pwNudged.current || nudgePutOff(meIdForIntro)) return;
    const t = window.setTimeout(() => {
      pwNudged.current = true;
      setPwNudge(true);
    }, PW_NUDGE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [pwNudgeDue, meIdForIntro]);

  // ---- 塔露拉干员 ----

  // Everyone's roaches, yours from me (the shared list may not have caught up with your latest move yet)
  const everyRoach = useMemo(
    () => [...feedRoaches.filter((r) => !ownIds.has(r.id)), ...(me?.roaches ?? [])],
    [feedRoaches, ownIds, me],
  );
  const byFire = useMemo(
    () =>
      fakeFire ??
      (visitorCounts && !feedRoaches.length ? visitorCounts.fire : areaTotals && !fakeFeed ? areaTotals.fire : fireCount(everyRoach)),
    [fakeFire, visitorCounts, feedRoaches, areaTotals, fakeFeed, everyRoach],
  );
  const fire = fireLevel(byFire);
  const seatedAtFire = me?.roaches.find((r) => isNearFire(r)) ?? null;

  /** Her card; to players in the 初始 hood she says her line about it once, on the card and over her head */
  const openTalulah = () => {
    setSelected({ kind: "other", roach: talulahRoach(Boolean(me?.talulah.friend)) });
    if (me && me.profile.avatar === "hood" && !hoodSaid(me.id)) {
      markHoodSaid(me.id);
      setHoodLine(TALULAH_LINES.hood);
      say(TALULAH_ID, TALULAH_LINES.hood);
    } else setHoodLine(null);
  };

  /** Her welcome as your first roach sits by her fire: over her head, and seen at once while she is on screen */
  const welcomeAtFire = async (before: boolean | undefined, m: Me | null, flewThere: boolean) => {
    if (before !== false || !m?.talulah.visited) return;
    say(TALULAH_ID, TALULAH_LINES.welcome);
    const items = await loadInbox();
    const item = items.find((i) => i.kind === "talulah" && i.line === "welcome" && !i.seen);
    const bounds = boundsRef.current;
    if (item && (flewThere || (bounds && inBounds(FIRE_AT, bounds)))) {
      await worldRef.current!.markSeen([item.id]).catch(() => {});
      await loadInbox();
    }
  };

  /** A clone to a free seat by the fire, which the server picks: a new one, or a move once all of them are out */
  const seatAtFire = async (target: PlaceTarget) => {
    const before = me?.talulah.visited;
    setSendingToFire(true);
    const done = await act((w) => w.sitByFire(target));
    setSendingToFire(false);
    if (!done) return;
    setPanel(null);
    setSelected(null);
    const m = await loadMe();
    void loadInbox().catch(() => {});
    setFocus({ lng: FIRE_AT.lng, lat: FIRE_AT.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
    setToast(T.map.fire.seated);
    await welcomeAtFire(before, m, true);
  };

  /** 派一只克隆体去烤火 */
  const sendToFire = async () => {
    if (!me) return setPanel({ kind: "login", reason: T.map.fire.signIn });
    if (me.roaches.filter((r) => r.slot > 0).length + (inkOut ? 1 : 0) < MAX_CLONES) return seatAtFire({ kind: "clone" });
    if (me.movesLeft <= 0) return setToast(fmt(T.map.place.movesUsedUp, { n: MOVES_PER_DAY }));
    setSelected(null);
    setPanel({ kind: "fireMove" });
  };

  /** 过去看看: to your roach that already sits by the fire */
  const visitSeated = () => {
    if (!seatedAtFire) return;
    setSelected(null);
    setFocus({ lng: seatedAtFire.lng, lat: seatedAtFire.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
  };

  /** 清掉我和塔露拉的记录 (development only), then a fresh visit */
  const forgetTalulah = async () => {
    const done = await act((w) => w.pretend("talulah").then(() => true));
    if (!done || !me) return;
    forgetTalulahHere(me.id);
    window.location.reload();
  };

  // 佩丽卡监督 shows up and asks her question once (the server keeps the answer), never on a visit
  // another introduction already had, and never before the updated privacy policy is agreed to
  const perlicaAsks = Boolean(
    settled &&
      idle &&
      !perlicaBusy &&
      main &&
      me?.perlica.timer === null &&
      !me.mustReconsent &&
      !newBadges.length &&
      !unseenBadges,
  );
  useEffect(() => {
    if (!perlicaAsks || introduced.current) return;
    introduced.current = true;
    setPanel({ kind: "perlicaIntro" });
  }, [perlicaAsks]);

  // 塔露拉干员's fire, told once in this browser to players with a roach who never sat by it, after the others
  const talulahTells = Boolean(
    settled &&
      idle &&
      !perlicaBusy &&
      main &&
      me &&
      !me.talulah.visited &&
      !me.mustReconsent &&
      !newBadges.length &&
      !unseenBadges,
  );
  useEffect(() => {
    if (!talulahTells || !meIdForIntro || introduced.current || talulahIntroShown(meIdForIntro)) return;
    markTalulahIntroShown(meIdForIntro);
    introduced.current = true;
    setPanel({ kind: "talulahIntro" });
  }, [talulahTells, meIdForIntro]);

  // ---- 明河都尉 ----

  // He moves on at 04:00 Beijing time, which an open page sees then, or on coming back to it
  useEffect(() => {
    const t = window.setTimeout(() => setMingheClock(Date.now()), Math.max(1000, nextStationAt(mingheClock) - Date.now() + 2000));
    const onVisible = () => {
      if (document.visibilityState === "visible" && mingheDay(Date.now()) !== mingheDay(mingheClock)) setMingheClock(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mingheClock]);
  const trail = useMemo(() => trailOf(day), [day]);
  const myRider = me?.minghe.riding ?? null;
  // riders others sent (the shared list says which, never whose), yours, and those pretended in development
  const fakeQueue = useMemo<PublicRoach[]>(
    () =>
      (fakeRiders ? queueSpots(day, fakeRiders, everyRoach) : []).map((at, i) => ({
        id: `fake-rider-${i}`,
        clone: true,
        avatar: "hood",
        color: "white",
        friend: false,
        ride: true,
        ...at,
      })),
    [fakeRiders, day, everyRoach],
  );
  // of everyone's, drawn or not (只看本体 leaves others' out of the map, not out of his count)
  const othersRiding = useMemo(
    () => feedRoaches.reduce((n, r) => n + (r.ride && !ownIds.has(r.id) ? 1 : 0), 0),
    [feedRoaches, ownIds],
  );
  const riders =
    (visitorCounts && !feedRoaches.length
      ? visitorCounts.riders
      : areaTotals && !fakeFeed
        ? areaTotals.riders
        : othersRiding + (myRider ? 1 : 0)) + fakeQueue.length;
  const mapRoaches = useMemo(() => (fakeQueue.length ? [...roaches, ...fakeQueue] : roaches), [roaches, fakeQueue]);

  /** A clone into his queue (a new one, or a move once all of them are out), then to him, where he says so */
  const rideWith = async (target: RideTarget) => {
    setRiding(true);
    const res = await act((w) => w.rideMinghe(target));
    setRiding(false);
    if (!res) return;
    setPanel(null);
    setSelected(null);
    // heard on the spot, as the map flies to him
    await worldRef.current!.markSeen([res.item.id]).catch(() => {});
    await Promise.all([loadMe(), loadInbox()]);
    setFocus({ lng: mingheAt.lng, lat: mingheAt.lat, zoom: MINGHE_ZOOM, nonce: Date.now() });
    say(MINGHE_ID, rideLine(res.item.stop ?? stopOf(day)));
    setToast(T.map.minghe.riding);
  };

  /** 派一只克隆体跟他走 */
  const sendRider = () => {
    if (!me) return setPanel({ kind: "login", reason: T.map.minghe.signIn });
    if (me.roaches.filter((r) => r.slot > 0).length + (inkOut ? 1 : 0) < MAX_CLONES) return rideWith({ kind: "clone" });
    if (me.movesLeft <= 0) return setToast(fmt(T.map.place.movesUsedUp, { n: MOVES_PER_DAY }));
    setSelected(null);
    setPanel({ kind: "mingheMove" });
  };

  /** 在这一站下马: the clone stays where it is, and he says so */
  const dismount = async () => {
    setRiding(true);
    const res = await act((w) => w.dismountMinghe());
    setRiding(false);
    if (!res) return;
    setSelected(null);
    await worldRef.current!.markSeen([res.item.id]).catch(() => {});
    await Promise.all([loadMe(), loadInbox()]);
    const stop = res.item.stop ?? stopOf(day);
    say(MINGHE_ID, dismountLine(stop));
    setToast(fmt(T.map.minghe.off, { station: stationOf(stop).name }));
  };

  /** From the column of guides: to one of them, with their card open */
  const findGuide = (id: GuideId) => {
    setPanel(null);
    if (id === AMIYA_ID) return showRoach(amiyaRoach(Boolean(me?.amiya.friend)));
    if (id === TALULAH_ID) {
      setFocus({ lng: FIRE_AT.lng, lat: FIRE_AT.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
      return openTalulah();
    }
    if (id === MINGHE_ID) return showMinghe();
    if (id === SI_ID) return showSi();
    if (!perlicaShown) return;
    setFocus({ lng: perlicaShown.lng, lat: perlicaShown.lat, zoom: 13, nonce: Date.now() });
    setSelected({ kind: "other", roach: perlicaRoach(perlicaShown, Boolean(me?.perlica.friend)) });
  };
  /** Why the map cannot show one of them now: only 佩丽卡监督, who lives by your main roach once the tutorial is over */
  const guideAway = (id: GuideId) =>
    id !== PERLICA_ID || perlicaShown
      ? null
      : !me
        ? T.map.guides.awaySignIn
        : !main
          ? T.map.guides.awayPlace
          : T.map.guides.awayTutorial;

  /** To him, with his card open */
  const showMinghe = () => {
    setPanel(null);
    setFocus({ lng: mingheAt.lng, lat: mingheAt.lat, zoom: MINGHE_ZOOM, nonce: Date.now() });
    setSelected({ kind: "other", roach: mingheRoach(day, Boolean(me?.minghe.friend)) });
  };

  /** 明河快进一天 / 清掉我和明河的记录 (development only), then a fresh visit */
  const mingheDayOn = async () => {
    const done = await act((w) => w.pretend("mingheDay").then(() => true));
    if (done) window.location.reload();
  };
  const forgetMinghe = async () => {
    const done = await act((w) => w.pretend("minghe").then(() => true));
    if (!done || !me) return;
    forgetMingheHere(me.id);
    window.location.reload();
  };

  // He rides out, told once in this browser to players with a roach who are not his 触须之交 and have no clone with
  // him, on a visit after 阿米娅向导, 佩丽卡监督 and 塔露拉干员 each had their turn (and never during the tutorial)
  const othersIntroduced = Boolean(
    me &&
      (me.amiya.friend || introShown(me.id)) &&
      me.perlica.timer !== null &&
      (me.talulah.visited || talulahIntroShown(me.id)),
  );
  const mingheTells = Boolean(
    settled &&
      idle &&
      !perlicaBusy &&
      main &&
      me &&
      !me.minghe.friend &&
      !myRider &&
      !me.mustReconsent &&
      !newBadges.length &&
      !unseenBadges &&
      othersIntroduced,
  );
  useEffect(() => {
    if (!mingheTells || !meIdForIntro || introduced.current || mingheIntroShown(meIdForIntro)) return;
    markMingheIntroShown(meIdForIntro);
    introduced.current = true;
    setPanel({ kind: "mingheIntro" });
  }, [mingheTells, meIdForIntro]);

  // ---- 祀掌柜 (src/lib/si.ts) ----

  /** Her clock on this page: 祀快进 moves it on in development, the server's and the page's alike */
  const siShift = me?.si.shift ?? siState?.shift ?? 0;
  const siNow = () => Date.now() + siShift;

  /** 缘缘庄's numbers and today's visitors, the same for everyone */
  const loadSiState = useCallback(async () => {
    try {
      const r = await fetch("/api/si", { cache: "no-store" });
      if (r.ok) setSiState((await r.json()) as SiState);
    } catch {}
  }, []);
  // asked again once a minute while her card is open, or the map shows 缘缘庄
  const siWanted = (selected?.kind === "other" && selected.roach.id === SI_ID) || siView !== null;
  useEffect(() => {
    if (!siWanted) return;
    void loadSiState();
    const t = window.setInterval(() => void loadSiState(), 60_000);
    return () => window.clearInterval(t);
  }, [siWanted, loadSiState]);

  /**
   * Where to centre the map, at a zoom, so she stands in the open space above her card, which is taller
   * than the others' (MapLibre levels; 512 px tiles)
   */
  const aboveSiCard = (zoom: number) => {
    const h = wrapRef.current?.clientHeight ?? window.innerHeight;
    const card = Math.min(h * 0.68, 560) + 96;
    const dy = Math.max(0, h / 2 - Math.max(90, (h - card) / 2 + 30));
    const metresPerPx = (78271.517 * Math.cos((SI_AT.lat * Math.PI) / 180)) / 2 ** zoom;
    return { lng: SI_AT.lng, lat: SI_AT.lat - (dy * metresPerPx) / 111_320, zoom, nonce: Date.now() };
  };
  /** Her card, and what she says as it opens: put out at being remembered so late, or at being looked at and left today */
  const openSi = (zoom = viewRef.current.zoom) => {
    setFocus(aboveSiCard(zoom));
    setSelected({ kind: "other", roach: siRoach(Boolean(me?.si.friend)) });
    say(SI_ID, peekedToday(me?.id ?? null, localDay()) ? SI_LINES.reopen : SI_LINES.open);
    siTouched.current = false;
  };
  /** Closed without touching her: she noticed, for the rest of the day */
  const closeSi = () => {
    rememberPeek(me?.id ?? null, siTouched.current ? null : localDay());
    setSelected(null);
    runAfterReport();
  };
  /** To her, with her card open */
  const showSi = () => {
    setPanel(null);
    openSi(SI_ZOOM);
  };

  // 最近更新's buttons: there once what waited for the booklet has had its turn (src/lib/pamphlet.ts actionMayRun),
  // 消息 waiting for 佩丽卡监督's notes too
  const pamphletMayGo = actionMayRun({
    open: Boolean(pamphlet),
    board: Boolean(board),
    panel: Boolean(panel),
    scene: Boolean(acting),
    notes: perlicaBusy && afterReport.current !== null,
    settled,
  });
  useEffect(() => {
    const go = pamphletGo.current;
    if (!pamphletMayGo || !go) return;
    pamphletGo.current = null;
    if (go === "ui") setUiMenu(true);
    else if (go === "styles") setStyleAsk((n) => n + 1);
    else if (go === "si") showSi();
    else if (!me) return;
    else if (go === "mains") setPanel({ kind: "onlyMains" });
    else if (go === "inbox") void openInbox(false);
    else if (go === "badges") setPanel({ kind: "badges", draft: me.profile });
    else if (go === "friends") void openFriends();
    else setPanel({ kind: "profile", password: "set" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pamphletMayGo, pamphletPress]);
  /** What she says about 缘缘庄 after a touch: straight into a room, to the door, or back from the fields */
  const siInnLine = (si: NonNullable<TouchResult["si"]>) =>
    si.inn.event === "in"
      ? inLine(si.inn.room ?? 0)
      : si.inn.event === "queued"
        ? SI_LINES.queued
        : si.inn.event === "again"
          ? SI_LINES.again
          : si.inn.event === "full"
            ? SI_LINES.full
            : null;
  /** Her self-portrait, given by mistake: back to her, or kept; she says what she makes of it, over her head too */
  const answerSiPortrait = async (choice: "return" | "keep") => {
    const res = await act((w) => w.siPortrait(choice));
    if (!res) return null;
    say(SI_ID, res.line);
    await loadMe();
    return res.line;
  };
  /** A visitor reaches for her: she says so, then the sign-in */
  const siSignIn = () => {
    if (waitingMe) return setToast(T.map.common.readingAccount);
    say(SI_ID, SI_LINES.visitor);
    window.setTimeout(() => setPanel({ kind: "login", reason: T.map.si.signIn }), 1200);
  };
  /**
   * 看看我在哪: her card makes way and the map flies to your ink roach, close enough to tell it from the others,
   * wherever it is (queuing, in its room, in the fields); she says she knew it at once, over her head and, should
   * she be off the screen there, along the bottom too
   */
  const findMyInk = () => {
    const ink = myInkNow();
    if (!ink) return;
    const { at } = ink;
    setSelected(null);
    setFocus({ lng: at.lng, lat: at.lat, zoom: FIND_ZOOM, nonce: Date.now() });
    say(SI_ID, SI_LINES.find);
    const [x, y] = toXY(at);
    const [sx, sy] = toXY(SI_AT);
    if (Math.abs(x - sx) > 25 || Math.abs(y - sy) > 50) setToast(fmt(T.map.guides.says, { name: GUIDES.si.name, line: SI_LINES.find }));
  };

  /** Your ink roach where it is by her clock, null while she holds it (off the map) */
  const myInkNow = () => {
    const ink = me?.si.inn;
    return ink && ink.state !== "held" ? inkNow(ink, siState?.checkedIn ?? null, siNow()) : null;
  };
  /**
   * An ink roach of 缘缘庄 tapped on the map: your own opens its card at once; another's opens as its tile drew it,
   * its touches waiting till the server says what it is now (below)
   */
  const onInkClick = (hit: InkTapped) =>
    setSelected(hit.kind === "mine" ? { kind: "myInk" } : { kind: "ink", ink: hit.ink, tap: null });
  // what someone else's ink roach tapped is now, asked once you are signed in (visitors do without): yours, should
  // the queue have moved it under your tap, a 触须之交's, or nobody's; gone from the map, its card closes
  const inkToAsk = selected?.kind === "ink" && !selected.tap ? selected.ink : null;
  const askerId = me?.id ?? null;
  useEffect(() => {
    if (!inkToAsk || !askerId) return;
    void act((w) => w.tapInk(inkToAsk)).then(async (tap) => {
      // yours after all, though this page has it held, or none: as it is now
      if (tap?.mine && !myInkNow()) await loadMe().catch(() => {});
      // closed meanwhile, or another opened
      setSelected((s) => (s?.kind !== "ink" || s.ink !== inkToAsk ? s : !tap ? null : tap.mine ? { kind: "myInk" } : { ...s, tap }));
    });
    // a new ink roach, or signing in, asks again; nothing else
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inkToAsk, askerId]);
  /** Touch someone else's ink roach: as a clone, with no scene (she drew it, in her ink); its card closes */
  const touchInk = async (tap: InkTap, bold: boolean) => {
    const id = tap.id;
    if (!id) return;
    const res = await once("touch", () => act((w) => w.touch(id, bold)));
    if (!res) return;
    setTouchedHere((t) => ({ ...t, [`${me?.id}:${id}`]: { bold, at: Date.now() } }));
    setSelected(null);
    if (res.newFriend) {
      befriendedToast(res.newFriend);
      await Promise.all([loadFriends(), loadInbox()]);
    } else touchedToast(bold);
    if (me?.isNew) await loadMe();
  };
  /** 收回 your ink roach: off the map at once, held till you touch her again */
  const recallInk = async () => {
    setRecalling(true);
    const done = await act((w) => w.recallInk().then(() => true));
    setRecalling(false);
    if (!done) return;
    setSelected(null);
    setToast(T.map.si.inkRecalled);
    await Promise.all([loadMe(), loadSiState()]);
  };

  /** 祀掌柜's tools in development: her clock on, pretend crowds and visitors, clear the inn or yourself; then a fresh visit */
  const siPretend = async (what: PretendWhat, n?: number) => {
    const done = await act((w) => w.pretend(what, n).then(() => true));
    if (!done || !me) return;
    if (what === "si") forgetSiHere(me.id);
    window.location.reload();
  };

  // Back to the page on a new day (from 04:00 on this device): 阿米娅向导 may be greeting
  const dayRef = useRef(localDay());
  useEffect(() => {
    if (!meId) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || localDay() === dayRef.current) return;
      dayRef.current = localDay();
      const m = await loadMe();
      const item = m?.amiya.greeting;
      if (!item) return;
      const { panel: open, placing: busy } = busyRef.current;
      if (open || busy) setToast(T.map.inbox.amiyaHello);
      else setPanel({ kind: "amiyaGreeting", item });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [meId, loadMe]);

  // quiet from the popup, where the toast would show through
  const wearBadge = async (badge: string | null, quiet = false) => {
    const done = await act((w) => w.wearBadge(badge).then(() => true));
    if (!done) return;
    await loadMe();
    if (!quiet) setToast(badge ? T.map.badge.worn : T.map.badge.off);
  };

  const guides: GuideMark[] = [
    {
      id: AMIYA_ID,
      at: AMIYA_AT,
      friend: Boolean(me?.amiya.friend),
      bubble: says.amiya ?? null,
      ...(amiyaDance ? { dance: amiyaDance } : {}),
      ...(offStage === AMIYA_ID ? { acting: true } : {}),
    },
    {
      id: TALULAH_ID,
      at: FIRE_AT,
      friend: Boolean(me?.talulah.friend),
      bubble: says.talulah ?? null,
      fire,
      ...(offStage === TALULAH_ID ? { acting: true } : {}),
    },
    {
      id: MINGHE_ID,
      at: mingheAt,
      friend: Boolean(me?.minghe.friend),
      bubble: says.minghe ?? null,
      ride: { ahead: (queueBearing(day) + 180) % 360 },
      ...(offStage === MINGHE_ID ? { acting: true } : {}),
    },
    {
      id: SI_ID,
      at: SI_AT,
      friend: Boolean(me?.si.friend),
      bubble: says.si ?? null,
      ...(offStage === SI_ID ? { acting: true } : {}),
    },
    ...(perlicaShown && me
      ? [
          {
            id: PERLICA_ID,
            at: perlicaShown,
            friend: me.perlica.friend,
            bubble: says.perlica ?? null,
            ...(guarding ? { beside: true } : {}),
            ...(perlicaArrive ? { arrive: perlicaArrive } : {}),
            // she steps off while ⚡舟友的酒⚡'s phantoms dance where she stands
            ...(offStage === PERLICA_ID || party ? { acting: true } : {}),
          },
        ]
      : []),
  ];
  // 卡了自动换轻量 (src/lib/lag.ts): whether the map feels slow, measured where 轻量 would help, once on this
  // device; not while the player is busy (a card, placing, the tutorial, a touch scene). Slow: 轻量 at once, as
  // this device's pick, and a notice that says so with the way back. Gone back, it is never switched again.
  const quietRef = useRef(false);
  const styleRef = useRef(mapStyle);
  useEffect(() => {
    // and while the owner draws or looks at a 禁放区 (admin/ZoneDraw.tsx, ZoneView.tsx)
    quietRef.current = Boolean(panel || placing || step || selected || offStage || pwNudgeUp || zoneTool);
    styleRef.current = mapStyle;
  });
  const lagRef = useRef<LagWatch | null>(null);
  const watchLag = Boolean(me) && !liteHintDone && drawnStyle !== "lite" && drawnStyle !== "hidden";
  const toLite = useCallback(() => {
    markLiteHintSeen();
    setLiteHintDone(true);
    setLiteFrom(styleRef.current);
    saveMapStyle("lite");
    setMapStyle("lite");
    setStyleStored(true);
    setLiteHint(true);
  }, []);
  // Development only: zhoupLag() in the console, as if the map were slow
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as { zhoupLag?: unknown }).zhoupLag = toLite;
  }, [toLite]);
  useEffect(() => {
    if (!watchLag) return;
    const w = lagWatch(toLite, () => quietRef.current);
    lagRef.current = w;
    return () => {
      w.stop();
      lagRef.current = null;
    };
  }, [watchLag, toLite]);
  // and the map's moves to the owner's tool for drawing a 禁放区 (admin/ZoneDraw.tsx)
  const onMoving = useCallback(
    (moving: boolean) => {
      lagRef.current?.moving(moving);
      pulse.moving(moving);
    },
    [pulse],
  );
  // the notice goes by itself after 12 seconds (轻量 stays; the style picker goes back any time)
  useEffect(() => {
    if (!liteHint) return;
    const t = window.setTimeout(() => setLiteHint(false), 12_000);
    return () => window.clearTimeout(t);
  }, [liteHint]);

  // 只看本体: of the others' ink roaches, those of your 触须之交 only (each is one of its owner's clones)
  const friendInks = useMemo(() => (hideClones ? friends.flatMap((f) => (f.inkTap === undefined ? [] : [f.inkTap])) : null), [friends, hideClones]);
  const siInks = useSiInks(siView, me?.si.inn?.tap ?? null, friendInks);
  const siNumbers = siState ? innNumbers(siState) : null;
  // the queue's line reaches its last place, empty or not (a recalled ticket leaves its place empty)
  const siInnKey = siState ? `${siNumbers!.places}/${siState.drawn}/${siNumbers!.free === 0}/${siState.homesReach}` : "";
  // your own ink roach where it is by her clock and the newest numbers, ringed in your colour (3.8); none while held
  const siInk = me?.si.inn && me.si.inn.state !== "held" ? me.si.inn : null;
  const siCheckedIn = siState?.checkedIn ?? null;
  const siMine = useMemo<SiMine | null>(() => {
    if (!siInk) return null;
    const w = inkNow(siInk, siCheckedIn, Date.now() + siShift);
    const b = brushOf(siInk.inkNo);
    return {
      at: w.at,
      look: siInk.look,
      variant: variantOf(w.state, w.left),
      color: myColor,
      // none from a server from before her seal, while the site is being updated
      sealed: siInk.sealed === true,
      size: b.size,
      tilt: b.tilt,
      ink: b.ink,
      brushFrom: siBrushFrom,
    };
    // siTick: its check-in or check-out came
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siInk, siCheckedIn, siShift, myColor, siBrushFrom, siTick]);
  // when that changes next, by the clock of this page
  const siNext = siInk ? inkNow(siInk, siCheckedIn, Date.now() + siShift).until : null;
  useEffect(() => {
    if (siNext === null) return;
    const t = window.setTimeout(() => setSiTick((n) => n + 1), Math.max(0, siNext - (Date.now() + siShift)) + 500);
    return () => window.clearTimeout(t);
  }, [siNext, siShift]);
  const siMineKey = siMine ? `${siMine.at.lng},${siMine.at.lat},${siMine.look},${siMine.variant},${siMine.color},${siMine.sealed},${siMine.brushFrom}` : "";
  const siTier = paintingTier(siState?.today ?? 0);
  const siMap = useMemo<SiMapData>(
    () => ({
      inn: siState && siNumbers ? { queue: siNumbers.places, drawn: siState.drawn, full: siNumbers.free === 0, homesReach: siState.homesReach } : null,
      inks: siInks.inks,
      mine: siMine,
      tier: siTier,
      innKey: siInnKey,
      inksKey: siInks.key,
      mineKey: siMineKey,
    }),
    // the keys say when anything changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siInnKey, siInks.key, siMineKey, siTier],
  );

  // your ink roach's card, where it is now; it goes once the ink roach is off the map (recalled on another screen)
  const myInk = selected?.kind === "myInk" ? myInkNow() : null;
  const myInkGone = selected?.kind === "myInk" && !myInk;
  useEffect(() => {
    if (myInkGone) setSelected(null);
  }, [myInkGone]);

  // while the owner draws a 禁放区, a tap on the map or a roach opens nothing over the drawing
  const ignoreTap = () => {};
  const mapProps = {
    roaches: mapRoaches,
    si: siMap,
    // whoever acts out a scene over the map is left out of it meanwhile, the list itself kept as it is
    hiddenId: offStage ?? null,
    guides,
    trail,
    shouts,
    overlays: mapOverlays,
    lines: zoneLines.length ? [...reportedMarks.lines, ...zoneLines] : reportedMarks.lines,
    // while one of your roaches acts out a scene over the map (摄入酒精, a shout), the map leaves it out
    mine: (me?.roaches ?? []).filter((r) => (!acting || r.slot > 0) && r.id !== shouting?.roach),
    mineAsleep: Boolean(me?.drunkUntil),
    // where the roach would go: a visitor's pick, or the spot a card is asking about
    ghost: me ? (panel?.kind === "placeConfirm" ? panel.spot : null) : preview,
    myAvatar,
    myColor,
    look,
    mapStyle: drawnStyle,
    onHeartsUnavailable: () => setHeartsOff(true),
    onNoGpuLayer: () => setNoGpu(true),
    onMoving,
    initialView: viewRef.current,
    placing: Boolean(placing),
    focus,
    onMapClick: zoneTool?.kind === "draw" ? ignoreTap : onMapClick,
    onRoachClick: zoneTool?.kind === "draw" ? ignoreTap : onRoachClick,
    onMineClick: zoneTool?.kind === "draw" ? ignoreTap : onMineClick,
    onInkClick: zoneTool?.kind === "draw" ? ignoreTap : onInkClick,
    onViewChange,
    onError: setToast,
    // mainland China: 腾讯's map instead, without a word (TencentView's own onFailed is ownMap)
    onFailed: cn ? amapFailed : undefined,
  };

  const renderPanel = (p: Panel) => {
    if (p.kind === "login" && p.confirm) {
      const { email, form, draft } = p.confirm;
      return (
        <LoginSheet
          reason={p.reason}
          paused={mailPaused}
          fixedEmail={email}
          onDone={() => setPanel({ kind: "profile", draft, password: form })}
          onClose={() => setPanel({ kind: "profile", draft })}
        />
      );
    }
    if (p.kind === "login") return <LoginSheet reason={p.reason} paused={mailPaused} onDone={signedIn} onClose={() => setPanel(null)} />;
    if (p.kind === "hot") return <HotSheet onClose={() => setPanel(null)} />;
    if (p.kind === "uiPicker") {
      // either way this device has answered, and is not asked again; what was to come next comes now
      const answer = (picked: UiName | null) => {
        markUiAsked();
        if (picked) pickUi(picked);
        setPanel(null);
        p.then?.();
      };
      return <UiPicker onPick={answer} onSkip={() => answer(null)} />;
    }
    if (p.kind === "homeScreen") {
      return (
        <HomeScreenSheet
          signedIn={Boolean(me)}
          onSignIn={() => setPanel({ kind: "login", reason: T.map.account.signInDeskCode })}
          onClose={() => setPanel(null)}
        />
      );
    }
    if (p.kind === "guide") {
      return <GuideSheet id={p.id} away={guideAway(p.id)} onFind={() => findGuide(p.id)} onClose={() => setPanel(null)} />;
    }
    if (p.kind === "welcome") {
      const close = () => {
        markWelcomed();
        setPanel(null);
      };
      return <WelcomeSheet onClose={close} />;
    }
    if (p.kind === "guestRadar") {
      return (
        <GuestRadarSheet
          onSignIn={() => setPanel({ kind: "login", reason: T.map.account.signInRadar })}
          onClose={() => setPanel(null)}
        />
      );
    }
    if (!me) return null;
    switch (p.kind) {
      case "tutorialCard": {
        const later = () => {
          updateProgress({ card: true });
          setPanel(null);
        };
        const save = async (profile: Profile) => {
          const ok = await saveProfile(profile);
          if (ok) updateProgress({ card: true });
          return ok;
        };
        return (
          <ProfileSheet
            profile={me.profile}
            badges={me.badges}
            wornBadge={me.wornBadge}
            blocked={[]}
            held={me.profileHeld}
            tutorial={{ onLater: later }}
            onUnblock={() => {}}
            onSave={save}
            onSignOut={() => {}}
            onDelete={() => {}}
            onClose={() => setPanel(null)}
          />
        );
      }
      case "profile":
        return (
          <ProfileSheet
            profile={me.profile}
            draft={p.draft}
            badges={me.badges}
            wornBadge={me.wornBadge}
            onOpenBadges={(draft) => setPanel({ kind: "badges", draft })}
            blocked={blocked}
            held={me.profileHeld}
            // not while the tutorial runs, as she does not show up before it is over
            perlicaTimer={step ? undefined : me.perlica.timer}
            onPerlicaTimer={switchPerlicaTimer}
            onlyMains={me.onlyMains}
            onOpenOnlyMains={(draft) => setPanel({ kind: "onlyMains", back: { kind: "profile", draft } })}
            passwordForm={p.password}
            onConfirmByCode={(email, form, draft) => setPanel({ kind: "login", reason: CONFIRM_REASON[form], confirm: { email, form, draft } })}
            // set before the map got round to asking: it asks no more
            onPasswordSet={() => me.passwordNudge && applyMe({ ...me, passwordNudge: false })}
            onUnblock={unblock}
            onSave={saveProfile}
            onSignOut={() => leave("signOut")}
            onDelete={() => leave("delete")}
            onClose={() => setPanel(null)}
          />
        );
      case "mine":
        return (
          <MineSheet
            roaches={me.roaches}
            ink={inkOut}
            movesLeft={me.movesLeft}
            avatar={myAvatar}
            color={myColor}
            look={look}
            onFind={find}
            onMove={(r) => startPlacing({ kind: "move", roachId: r.id })}
            onRemove={remove}
            onPlaceMain={() => startPlacing({ kind: "main" })}
            onAddClone={() => startPlacing({ kind: "clone" })}
            onClose={() => setPanel(null)}
          />
        );
      case "onlyMains": {
        const back = p.back;
        return (
          <OnlyMainsSheet
            onlyMains={me.onlyMains}
            look={{ color: myColor, avatar: myAvatar }}
            onPick={pickOnlyMains}
            // back to 消息 as it is now: the switch may have changed which declarations it holds
            onBack={back ? () => (back.kind === "inbox" ? void openInbox(false, back.tab) : setPanel(back)) : undefined}
            onClose={() => setPanel(null)}
          />
        );
      }
      case "badges":
        return (
          <BadgeWall
            me={me}
            onWear={wearBadge}
            onBack={() => setPanel({ kind: "profile", draft: p.draft })}
            onClose={() => setPanel(null)}
          />
        );
      case "homecoming": {
        // her greeting counts as seen however this card is left
        const seen = () => (p.greeting ? worldRef.current!.markSeen([p.greeting.id]).catch(() => {}) : Promise.resolve());
        return (
          <HomecomingSheet
            me={me}
            homecoming={p.homecoming}
            items={p.items}
            amiya={p.greeting ? { onTouchBack: (bold) => touchBackAmiya(p.greeting!, bold) } : undefined}
            perlica={p.away ? awayWithWeight(p.away.seconds ?? 0, p.away.line ?? 0) : undefined}
            onInbox={() => seen().then(() => openInbox(false))}
            onWelcome={() => {
              seen();
              setPanel({ kind: "declare", initial: "welcome" });
            }}
            onClose={() => {
              seen().then(() => loadInbox());
              setPanel(null);
            }}
            onLog={() => {
              seen().then(() => loadInbox());
              setPanel(null);
              setBoard({ view: { kind: "log" }, popped: null });
            }}
          />
        );
      }
      case "amiyaGreeting":
        return (
          <AmiyaGreetingSheet
            games={me.profile.games}
            onTouchBack={(bold) => touchBackAmiya(p.item, bold)}
            onClose={() => closeGreeting(p.item)}
          />
        );
      case "amiyaIntro":
        return <AmiyaIntroSheet onFind={() => showRoach(amiyaRoach(me.amiya.friend))} onLater={() => setPanel(null)} />;
      case "perlicaIntro":
        return <PerlicaIntroSheet onYes={() => answerPerlica(true)} onNo={() => answerPerlica(false)} />;
      case "talulahIntro":
        return (
          <TalulahIntroSheet
            onGo={() => {
              setPanel(null);
              setFocus({ lng: FIRE_AT.lng, lat: FIRE_AT.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
              openTalulah();
            }}
            onLater={() => setPanel(null)}
          />
        );
      case "fireMove":
        return (
          <CloneMoveSheet
            clones={me.roaches.filter((r) => r.slot > 0)}
            movesLeft={me.movesLeft}
            to={FIRE_AT}
            from={T.map.fire.from}
            onPick={(r) => seatAtFire({ kind: "move", roachId: r.id })}
            onClose={() => setPanel(null)}
          />
        );
      case "mingheIntro":
        return <MingheIntroSheet station={stationOf(day).name} onGo={showMinghe} onLater={() => setPanel(null)} />;
      case "siIntro":
        return <SiIntroSheet onGo={showSi} onLater={() => setPanel(null)} />;
      case "siBook":
        if (!me) return null;
        return (
          <SiBookSheet
            si={me.si}
            userId={me.id}
            name={me.profile.anonymous || !me.profile.name.trim() ? null : displayName(me.profile)}
            look={myAvatar}
            onAnswer={answerSiPortrait}
            onClose={() => setPanel(null)}
          />
        );
      case "mingheMove":
        return (
          <CloneMoveSheet
            clones={me.roaches.filter((r) => r.slot > 0)}
            movesLeft={me.movesLeft}
            to={mingheAt}
            from={T.map.minghe.from}
            onPick={(r) => rideWith({ kind: "move", roachId: r.id })}
            onClose={() => setPanel(null)}
          />
        );
      case "declare":
        return (
          <DeclareSheet
            profile={me.profile}
            roaches={me.roaches}
            initial={p.initial}
            initialFrom={p.from}
            drunk={Boolean(me.drunkUntil)}
            stayed={me.si.stayed}
            ink={inkOut}
            onSend={declare}
            onEditProfile={() => setPanel({ kind: "profile" })}
            onClose={() => setPanel(null)}
          />
        );
      case "inbox":
        return (
          <InboxSheet
            items={p.items}
            friends={shownFriends}
            games={me.profile.games}
            tab={p.tab}
            notice={p.notice}
            viewed={p.viewed}
            onTab={(tab) => {
              setPanel({ ...p, tab, notice: false, viewed: [...p.viewed, tab] });
              markTabSeen(p.items, tab);
            }}
            onReply={reply}
            onReact={react}
            onIgnore={ignore}
            onViewProfile={(profile, target) => setPanel({ kind: "viewProfile", profile, target, back: p })}
            onOpenFriend={(friendId) => setPanel({ kind: "friend", friendId, back: { ...p, tab: "friends" } })}
            onSafety={(target, who) => setPanel({ kind: "safety", target, who, back: p })}
            onAppeal={appeal}
            friendly={inboxFriendly}
            suspendedUntil={me.suspendedUntil}
            onlyMains={me.onlyMains}
            onOpenOnlyMains={() => setPanel({ kind: "onlyMains", back: { ...p, notice: false } })}
            onClose={() => setPanel(null)}
          />
        );
      case "roachReport":
        return (
          <RoachReportSheet
            clone={p.roach.clone}
            onReport={(reason, note) => reportRoach(p.roach, reason, note)}
            onClose={() => setPanel(null)}
          />
        );
      case "safety":
        return (
          <SafetySheet
            who={p.who}
            onBlock={() => blockSender(p)}
            onReport={(reason, note) => reportSender(p, reason, note)}
            onBack={p.back ? () => setPanel(p.back) : undefined}
            onClose={() => setPanel(null)}
          />
        );
      case "friends":
        return (
          <FriendsSheet
            friends={shownFriends}
            help={helpBoard}
            busy={friendBusy}
            onOpen={(friendId) => setPanel({ kind: "friend", friendId, back: p })}
            onBatch={batch}
            onAskHelp={() => setPanel({ kind: "helpAsk", back: p })}
            onAnswerHelp={answerHelp}
            onCloseHelp={closeHelp}
            onCopyUid={copyUid}
            onClose={() => setPanel(null)}
          />
        );
      case "helpAsk":
        return (
          <HelpAskSheet
            games={me?.profile.games ?? []}
            busy={friendBusy}
            onSend={askHelp}
            onBack={() => setPanel(p.back ?? { kind: "friends" })}
            onClose={() => setPanel(null)}
          />
        );
      case "friend": {
        const friend = shownFriends.find((f) => f.id === p.friendId);
        if (!friend) return null;
        return (
          <FriendView
            friend={friend}
            onStar={() => toggleStar(friend)}
            help={(() => {
              const asks = (helpBoard?.theirs ?? []).filter((r) => r.friendId === friend.id);
              return asks.length ? (
                <section className="help-box">
                  <div className="help-head static">
                    <span>{T.map.friends.asking}</span>
                  </div>
                  {asks.map((r) => (
                    <TheirHelp key={r.id} item={r} who={false} busy={friendBusy} onAnswer={answerHelp} onCopyUid={copyUid} />
                  ))}
                </section>
              ) : null;
            })()}
            actions={
              friend.between && (
                <FriendActions
                  between={friend.between}
                  pokeAgainAt={friend.pokeAgainAt}
                  busy={friendBusy || pokeSent}
                  onAct={(a, at) => friendAct(friend, a, at, null)}
                />
              )
            }
            gameExtra={gameExtra(friend)}
            onFind={(i) => findFriendRoach(friend.roaches[i])}
            onUnfriend={() => unfriend(friend)}
            onSafety={() => setPanel({ kind: "safety", target: `friend:${friend.id}`, who: friend.profile.displayName, back: p })}
            onBack={p.back ? () => setPanel(p.back) : undefined}
            onClose={() => setPanel(null)}
          />
        );
      }
      case "visitConfirm":
      case "visitMove": {
        const friend = shownFriends.find((f) => f.id === p.friendId);
        if (!friend || !me) return null;
        const clones = me.roaches.filter((r) => r.slot > 0);
        return p.kind === "visitConfirm" ? (
          <VisitSheet
            name={friend.profile.displayName}
            clones={clones.length}
            ink={inkOut}
            busy={friendBusy}
            onNew={() => visitFriend(friend.id, p.roach)}
            onPick={() => setPanel({ kind: "visitMove", friendId: friend.id, roach: p.roach })}
            onClose={() => setPanel(null)}
          />
        ) : (
          <CloneMoveSheet
            clones={clones}
            movesLeft={me.movesLeft}
            to={p.roach}
            from={T.map.visit.fromThem}
            onPick={(r) => visitFriend(friend.id, p.roach, r.id)}
            onClose={() => setPanel(null)}
          />
        );
      }
      case "viewProfile":
        return (
          <ProfileView
            profile={p.profile}
            onSafety={() => setPanel({ kind: "safety", target: p.target, who: p.profile.displayName, back: p })}
            onBack={() => setPanel(p.back)}
            onClose={() => setPanel(null)}
          />
        );
      case "ageCheck":
        return <AgeCheckSheet onConfirm={confirmAge} onDelete={() => leave("delete")} onClose={() => setPanel(null)} />;
      case "consent":
        return (
          <ConsentSheet
            onAgree={(ticks) => agreeAgain(ticks, p.then ?? null)}
            onSignOut={() => leave("signOut")}
            onDelete={() => leave("delete")}
            onClose={() => setPanel(null)}
          />
        );
      case "placeConfirm":
        return (
          <PlaceConfirm
            consent={p.consent}
            onConfirm={() => {
              setPanel(null);
              put(p.target, p.spot, p.fly, p.consent);
            }}
            // still placing: back to picking a spot; a visitor's spot from before signing in: start picking
            onRethink={() => (placing ? setPanel(null) : startPlacing({ kind: "main" }))}
          />
        );
      case "radar":
        return (
          <RadarSheet radar={p.radar} onPlaceMain={() => startPlacing({ kind: "main" })} onClose={() => setPanel(null)} />
        );
      case "identity":
        return (
          <IdentitySheet
            identities={identities}
            onBecome={become}
            onReset={reset}
            onPretend={pretend}
            onPretendLeft={pretendLeft}
            onAskAgain={askAgain}
            onFakeFire={(n) => {
              setFakeFire(n);
              setPanel(null);
              setFocus({ lng: FIRE_AT.lng, lat: FIRE_AT.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
            }}
            onForgetTalulah={forgetTalulah}
            onMingheDay={mingheDayOn}
            onFakeRiders={(n) => {
              setFakeRiders(n);
              setPanel(null);
              setFocus({ lng: mingheAt.lng, lat: mingheAt.lat, zoom: MINGHE_ZOOM, nonce: Date.now() });
            }}
            onForgetMinghe={forgetMinghe}
            onSi={siPretend}
            onPerlicaMore={perlicaMore}
            onClose={() => setPanel(null)}
          />
        );
    }
  };

  // only the owner's me() carries the counts; 看被举报的蟑螂 (a moderator's too) opens its panel under them (MapReported)
  const adminPills = reviewer && (
    <>
      {me?.admin && (me.admin.open > 0 || me.admin.appeals > 0) && (
        <a className={`admin-pill ${me.admin.urgent > 0 ? "urgent" : ""}`} href="/admin">
          {[me.admin.open > 0 && fmt(T.map.admin.reports, { n: me.admin.open }), me.admin.appeals > 0 && fmt(T.map.admin.appeals, { n: me.admin.appeals })].filter(Boolean).join(T.map.admin.and)}{T.map.admin.toHandle}
          {me.admin.urgent > 0 && fmt(T.map.admin.urgent, { n: me.admin.urgent })}
        </a>
      )}
      {!reported && (
        <button
          className="admin-pill"
          onClick={() => {
            setSelected(null);
            setReported({ start: null });
          }}
        >
          {T.map.admin.showReported}
        </button>
      )}
      {adminShut && (
        <a className="admin-pill urgent" href="/admin">
          {T.map.admin.unlock}
        </a>
      )}
    </>
  );

  // ---- 界面 (src/lib/uiChoice.ts): the buttons around the map, laid out as this device picked ----

  // the counts, as each layout words them
  const counts: Counts =
    visible === null
      ? { kind: "loading" }
      : !feedIn
        ? { kind: "arriving" }
        : guest
          ? { kind: "guest", total: countText(total), players: players === undefined ? undefined : countText(players, "位") }
          : drawnStyle === "hidden"
            ? { kind: "hidden", total: countText(total), players: players === undefined ? undefined : countText(players, "位") }
            : { kind: "here", here: visible.toLocaleString(), total: total.toLocaleString(), players: players?.toLocaleString(), mainsOnly: hideClones };
  // 界面 has a menu to open: the layouts to pick from, or 存到桌面
  const uiButton = uiChoice || deskOffer;
  // an owner's 圈禁放区 and 看一处 measure the map as the whole screen, which 浮岛 leaves it
  const layout: UiName = zoneTool ? "float" : ui;
  const chrome: ChromeProps = {
    placing: Boolean(placing),
    reported: Boolean(reported),
    tutorial: Boolean(step),
    card: Boolean(selected),
    brand: (size) => <RoachIcon color={myColor} size={size} avatar={myAvatar} look={look} />,
    noticeDot: noticeDotOn,
    onBoard: openBoard,
    stylePicker: (round) => (
      <MapStylePicker
        round={round}
        style={shownStyle}
        onPick={switchMapStyle}
        unavailable={guest ? guestStyles() : !HEARTS_READY ? { hearts: T.map.style.heartsSoon } : heartsOff ? { hearts: T.map.style.noHearts } : {}}
        hint={styleHintNow}
        onHintDone={styleHintDone}
        onRaise={setTopRaised}
        openSignal={styleAsk}
      />
    ),
    // mainland China has Amap only
    basemap: cn ? null : { now: basemap, amapOk: amapConfigured, onSwitch: switchBasemap },
    // 写实 is off for now (src/lib/look.ts)
    look: REAL_LOOK_OFFERED && (
      <div className="basemap-switch" role="group" aria-label={T.map.style.look}>
        <button className={look === "cartoon" ? "on" : ""} onClick={() => switchLook("cartoon")}>
          {T.map.style.cartoon}
        </button>
        <button className={look === "real" ? "on" : ""} onClick={() => switchLook("real")}>
          {T.map.style.real}
        </button>
      </div>
    ),
    raised: topRaised,
    counts,
    // signed in, the counts open 地图上看哪些蟑螂 (只看本体)
    onCounts: me ? () => setPanel({ kind: "onlyMains" }) : undefined,
    top: (
      <>
        {identities.length > 0 && (
          <button className="who" onClick={() => setPanel({ kind: "identity" })} title={T.map.demo.identity}>
            👤 {current?.label ?? T.map.demo.me}
            {othersUnseen > 0 && <span className="badge">{othersUnseen}</span>}
          </button>
        )}
        {/* a line of its own under the counts (globals.css .notice-strip-row), before the admin's own */}
        {strip && (
          <div className="notice-strip-row">
            <NoticeStrip notice={strip} onOpen={() => openStripped(strip)} onClose={() => closeStrip(strip)} />
          </div>
        )}
        {/* under the strip they come down beside 方舟雷达, so they keep to a line of their own in the middle (.admin-row) */}
        {strip && adminPills ? <div className="admin-row">{adminPills}</div> : adminPills}
        {/* 看被举报的蟑螂's panel goes here, under the counts */}
        {reviewer && reported && <div className="rep-slot" ref={setReportedSlot} />}
      </>
    ),
    onRadar: me ? openRadar : () => setPanel({ kind: "guestRadar" }),
    onHot: () => setPanel({ kind: "hot" }),
    onGuide: (id) => {
      setSelected(null);
      setPanel({ kind: "guide", id });
    },
    ui: uiButton
      ? {
          open: uiMenu,
          onToggle: () => {
            deskHintDone();
            setUiMenu((o) => !o);
          },
          deskHint: deskHint && deskHintNow,
          onDeskHintDone: deskHintDone,
        }
      : null,
    fold,
    onFold: changeFold,
    me: me
      ? {
          name: me.profile.anonymous || !me.profile.name.trim() ? T.map.common.anonymous : displayName(me.profile),
          color: me.profile.color,
          look: { avatar: me.profile.avatar },
          avRef: dockAvRef,
          anim: dockAnim,
          mailRef: dockMailRef,
          envelope,
          badgePop,
          help: me.help.asks + me.help.answers > 0,
          main: Boolean(main),
          onProfile: () => setPanel({ kind: "profile" }),
          onInbox: () => openInbox(false),
          onFriends: () => void openFriends(),
          onMine: () => setPanel({ kind: "mine" }),
          onAnnounce: () => setPanel({ kind: "declare" }),
          onPlaceMain: () => startPlacing({ kind: "main" }),
        }
      : null,
    visitor: visitorShown
      ? { onPlace: () => setPanel({ kind: "login", reason: T.map.place.signInToPlace }), onSignIn: () => setPanel({ kind: "login" }) }
      : null,
    waiting: waitingMe ? { failed: meFailed, onRetry: () => window.location.reload() } : null,
    disclaimer: (
      <p className="disclaimer">
        {T.map.disclaimer}{" "}
        <a href="/privacy#contact" target="_blank" rel="noreferrer">
          {T.map.contact}
        </a>
      </p>
    ),
    radar: lastRadar,
    drawerOpen,
    onDrawer: setDrawerOpen,
  };

  return (
    <main
      className={`app ui-${layout}${homeOn && !(twoMaps && abroad) ? " on-amap" : ""}${zoneTool ? " zone-tool" : ""}${
        drawnStyle === "lite" ? " no-blur" : ""
      }${layout === "drawer" && drawerOpen ? " drawer-open" : ""}${placing ? " placing" : ""}`}
    >
      {layout === "float" && <FloatChrome {...chrome} />}
      {layout === "drawer" && <DrawerChrome {...chrome} />}
      {layout === "hud" && <HudChrome {...chrome} />}
      {uiMenu && uiButton && !placing && !zoneTool && !pamphlet && (
        <UiMenu ui={ui} choices={uiChoice} desk={deskOffer} onPick={pickUi} onDesk={() => void tapDesk()} onClose={closeUiMenu} />
      )}

      <div className="map-wrap" ref={wrapRef}>
        {basemap === "amap" && homeMap === "amap" && homeMade && (
          <div className={`map-slot ${twoMaps && abroad ? "map-hidden" : ""}`}>
            <AmapView
              key="amap"
              {...mapProps}
              active={!(twoMaps && abroad)}
              jump={homeJump}
              onViewChange={twoMaps ? (abroad ? ignoreView : onHomeView) : onViewChange}
              onReady={onHomeReady}
            />
          </div>
        )}
        {basemap === "amap" && homeMap === "tencent" && homeMade && (
          <div className={`map-slot ${twoMaps && abroad ? "map-hidden" : ""}`}>
            <TencentView
              key="tencent"
              {...mapProps}
              onFailed={ownMap}
              active={!(twoMaps && abroad)}
              jump={homeJump}
              onViewChange={twoMaps ? (abroad ? ignoreView : onHomeView) : onViewChange}
              onReady={onHomeReady}
            />
          </div>
        )}
        {twoMaps && overseas && overseasMade && (
          <div className={`map-slot ${abroad ? "" : "map-hidden"}`}>
            <MaplibreView
              key="overseas"
              {...mapProps}
              style={overseas.style}
              cover={overseas.cover}
              slowNote={T.map.style.slow}
              active={abroad}
              jump={overseasJump}
              onViewChange={abroad ? onOverseasView : ignoreView}
              onReady={onOverseasReady}
            />
          </div>
        )}
        {basemap === "amap" && homeMap === "own" && overseas && (
          <MaplibreView key="fallback" {...mapProps} style={overseas.style} slowNote={T.map.style.slow} />
        )}
        {basemap === "osm" && <MaplibreView key="osm" {...mapProps} />}
        {poking && (
          <div className="actor-stage">
            <PokeActor avatar={poking.avatar} color={poking.color} look={look} onDone={() => setPoking(null)} />
          </div>
        )}
        {jolting && (
          <div className="actor-stage">
            <PokeActor
              avatar={jolting.roach.avatar}
              color={jolting.roach.color}
              look={look}
              friend={jolting.roach.friend}
              finger={false}
              onDone={jolting.done}
            />
          </div>
        )}
        {touchScene &&
          (touchScene.gesture ? (
            <GestureStage gesture={touchScene.gesture} cast={touchScene.cast} place={touchScene.place} onDone={touchScene.done} />
          ) : (
            <TouchStage kind={touchScene.kind} cast={touchScene.cast} place={touchScene.place} onDone={touchScene.done} />
          ))}
        {shouting && (
          <ShoutStage
            me={{ avatar: myAvatar, color: myColor }}
            text={shouting.text}
            limited={shouting.limited}
            place={shouting.place}
            onToast={shouting.toast}
            onDone={shouting.done}
          />
        )}
        {note && (
          <PerlicaBanner lines={note.lines} onOpen={openNote} onClose={endNote} />
        )}
        {acting && me && (
          <div className="actor-stage">
            <RoachActor
              scene={acting}
              avatar={myAvatar}
              color={myColor}
              look={look}
              onDone={() => {
                setActing(null);
                afterActing.current?.();
                afterActing.current = null;
              }}
            />
          </div>
        )}
      </div>

      {placing && basemap && (
        <PlaceBar
          label={placing.label}
          view={viewRef.current}
          cn={cn}
          onPick={(p: Place) => placeAt(p, true)}
          onCancel={() => setPlacing(null)}
        />
      )}

      {reviewer && reported && (
        <MapReported
          owner={Boolean(me?.admin)}
          start={reported.start}
          hidden={Boolean(placing || selected)}
          panelSlot={reportedSlot}
          onMarks={onReportedMarks}
          onFocus={focusReported}
          onPick={unselect}
          onSay={setToast}
          onDraw={isOwner ? drawZoneAt : undefined}
          onClose={closeReported}
        />
      )}
      {isOwner && zoneTool?.kind === "draw" && (
        <ZoneDraw key={zoneTool.key} start={zoneTool.at} pulse={pulse} onFocus={focusReported} onLines={setZoneLines} onClose={closeZoneTool} />
      )}
      {isOwner && zoneTool?.kind === "view" && (
        <ZoneView key={zoneTool.key} id={zoneTool.id} onFocus={focusReported} onLines={setZoneLines} onClose={closeZoneTool} />
      )}
      {!placing && selected?.kind === "other" && selected.roach.id === SI_ID && (
        <SiCard
          me={me?.si ?? null}
          userId={me?.id ?? null}
          friend={Boolean(me?.si.friend)}
          state={siState}
          now={siNow()}
          signedIn={Boolean(me)}
          waiting={waitingMe}
          touching={touching}
          sharesUid={Boolean(me?.profile.shareUid && me.profile.games.some((g) => me.profile.uid[g]))}
          favourites={me?.profile.favourites ?? null}
          mingheHere={stopOf(day) === MINGHE_NEAR}
          onTouch={(bold) => touch(selected.roach, bold)}
          onSignIn={siSignIn}
          onNickname={() => say(SI_ID, SI_LINES.nickname)}
          onFind={findMyInk}
          onOpenBook={() => setPanel({ kind: "siBook" })}
          onOpenFriend={me?.si.friend ? () => setPanel({ kind: "friend", friendId: SI_ID, back: null }) : undefined}
          onClose={closeSi}
        />
      )}
      {!placing && selected?.kind === "other" && selected.roach.id !== SI_ID && (
        <OtherRoachCard
          roach={selected.roach}
          look={look}
          signedIn={Boolean(me)}
          waiting={waitingMe}
          onSignIn={() =>
            waitingMe
              ? setToast(T.map.common.readingAccount)
              : setPanel({
                  kind: "login",
                  reason: selected.roach.guide
                    ? fmt(T.map.touch.signInGuide, { them: guideById(selected.roach.id)?.pronoun ?? T.map.touch.her })
                    : T.map.touch.signIn,
                })
          }
          sharesUid={Boolean(me?.profile.shareUid && me.profile.games.some((g) => me.profile.uid[g]))}
          friendName={selectedFriend?.profile.displayName}
          pokeAgainAt={selectedFriend?.pokeAgainAt ?? null}
          touched={touchedOn(selected.roach)}
          perlicaTimer={me?.perlica.timer === "on"}
          amiyaMusic={selected.roach.id === AMIYA_ID ? { on: music, onToggle: switchMusic } : undefined}
          perlicaGuarding={guarding}
          fire={
            selected.roach.id === TALULAH_ID
              ? {
                  count: byFire,
                  level: fire,
                  seated: Boolean(seatedAtFire),
                  hood: hoodLine,
                  sending: sendingToFire,
                  onSend: sendToFire,
                  onVisit: visitSeated,
                }
              : undefined
          }
          minghe={
            selected.roach.id === MINGHE_ID
              ? {
                  day,
                  today: stationOf(day).name,
                  tomorrow: stationOf(day + 1).name,
                  line: stationLine(day),
                  riders,
                  riding: Boolean(myRider),
                  sending: riding,
                  onRide: sendRider,
                  onDismount: dismount,
                }
              : undefined
          }
          clonesHidden={hideClones}
          busy={pokeSent || Boolean(poking)}
          touching={touching}
          friendRow={
            selectedFriend?.between && (
              <FriendActions
                between={selectedFriend.between}
                pokeAgainAt={selectedFriend.pokeAgainAt}
                riding={Boolean(selected.roach.ride)}
                busy={friendBusy || pokeSent || Boolean(poking)}
                onAct={(a, at) => friendAct(selectedFriend, a, at, selected.roach)}
              />
            )
          }
          onOpenFriend={
            selectedFriend ? () => setPanel({ kind: "friend", friendId: selectedFriend.id, back: null }) : undefined
          }
          onTouch={(bold) => touch(selected.roach, bold)}
          onPoke={() => poke(selected.roach)}
          onReport={
            selected.roach.guide
              ? undefined
              : () => {
                  setPanel({ kind: "roachReport", roach: selected.roach });
                  setSelected(null);
                  runAfterReport();
                }
          }
          admin={
            me?.admin && !selected.roach.guide
              ? {
                  busy: cleaning,
                  onTakeBack: () => takeBack(selected.roach, false),
                  onTakeBackNear: () => takeBack(selected.roach, true),
                  onDraw: () => drawZoneAt({ lng: selected.roach.lng, lat: selected.roach.lat }),
                }
              : undefined
          }
          onClose={() => {
            setSelected(null);
            runAfterReport();
          }}
        />
      )}
      {!placing && selected?.kind === "ink" && (
        <OtherInkCard
          look={INK_LOOKS[selected.ink.look] ?? "hood"}
          state={selected.tap?.state ?? INK_STATES[selected.ink.state]}
          friendName={selected.tap?.friend?.name}
          gone={Boolean(selected.tap?.gone)}
          asking={Boolean(me) && !selected.tap}
          signedIn={Boolean(me)}
          waiting={waitingMe}
          sharesUid={Boolean(me?.profile.shareUid && me.profile.games.some((g) => me.profile.uid[g]))}
          touched={selected.tap?.id ? touchedById(selected.tap.id) : undefined}
          touching={touching}
          onOpenFriend={(() => {
            const friend = selected.tap?.friend;
            return friend ? () => setPanel({ kind: "friend", friendId: friend.id, back: null }) : undefined;
          })()}
          onSignIn={() => (waitingMe ? setToast(T.map.common.readingAccount) : setPanel({ kind: "login", reason: T.map.touch.signIn }))}
          onTouch={(bold) => {
            if (selected.tap) void touchInk(selected.tap, bold);
          }}
          onClose={() => setSelected(null)}
        />
      )}
      {!placing && selected?.kind === "myInk" && me?.si.inn && myInk && (
        <MyInkCard
          look={me.si.inn.look}
          where={myInk}
          now={siNow()}
          busy={recalling}
          onDeclare={() => {
            setSelected(null);
            setPanel({ kind: "declare", from: [INK_FROM] });
          }}
          onToSi={showSi}
          onRecall={recallInk}
          onClose={() => setSelected(null)}
        />
      )}
      {!placing && selected?.kind === "mine" && (
        <MyRoachCard
          roach={selected.roach}
          index={(me?.roaches.filter((r) => r.slot > 0).findIndex((r) => r.id === selected.roach.id) ?? -1) + 1}
          avatar={myAvatar}
          color={myColor}
          look={look}
          drunk={Boolean(me?.drunkUntil)}
          drinks={me?.counts.drinks ?? 0}
          busy={drinking || Boolean(acting) || riding}
          riding={myRider?.roachId === selected.roach.id ? { stops: myRider.stops, onDismount: dismount } : undefined}
          party={selected.roach.slot === 0 && me?.drunkUntil ? { on: Boolean(party), onToggle: party ? endParty : startParty } : undefined}
          visits={{
            onSendHome: sendHome,
            onGoHome: () => goHome(selected.roach.id),
            onFollow: () => followHost(selected.roach.id),
          }}
          onMove={() => startPlacing({ kind: "move", roachId: selected.roach.id })}
          onRemove={() => remove(selected.roach)}
          onDrink={drinkUp}
          onSober={soberUp}
          onClose={() => setSelected(null)}
        />
      )}

      {!placing && !selected && !panel && !me && preview && (
        <PreviewCard
          around={around}
          onPlace={() => setPanel({ kind: "login", reason: T.map.place.signInHere })}
          onClose={() => setPreview(null)}
        />
      )}
      {coachShown && me && step && (
        <TutorialCoach
          ui={ui}
          step={step}
          me={me}
          progress={progress}
          nearest={nearest}
          sending={greeting}
          onPlaceMain={() => startPlacing({ kind: "main" })}
          onPlaceClone={() => startPlacing({ kind: "clone" })}
          onOpenCard={() => setPanel({ kind: "tutorialCard" })}
          onCardLater={() => updateProgress({ card: true })}
          onGreet={greet}
          onFindGuide={() => showRoach(amiyaRoach(me.amiya.friend))}
          onFindNearest={() => nearest && showRoach(nearest)}
          onBackHome={() => {
            updateProgress({ touch: true });
            flyHome();
          }}
          onSkipStep={(s) => {
            updateProgress({ [s]: true });
            if (s === "touch") flyHome();
          }}
          onFinish={() => updateProgress({ done: true })}
          onSkipAll={() => updateProgress({ skipped: true })}
        />
      )}

      {dockScene && <DockFx kind={dockScene.kind} from={dockScene.from} at={dockScene.at} onDone={dockScene.done} />}
      {vialAt && <SanityFly from={vialAt} onDone={() => setVialAt(null)} />}
      {batchScene && (
        <BatchStage
          act={batchScene.act}
          you={{ color: myColor, avatar: myAvatar }}
          them={batchScene.them.map((f) => ({ color: f.profile.color, avatar: f.profile.avatar }))}
          onDone={batchScene.done}
        />
      )}
      {arcs && <DockArcs key={arcs.nonce} at={arcs.at} />}
      {party && createPortal(<PartyScene key={party.key} avatar={myAvatar} color={myColor} music={party.music} onDone={endParty} />, party.el)}
      {!placing && !selected && <HeardBubbles list={heard} onReply={heardReply} onOk={heardOk} />}

      {panel && renderPanel(panel)}
      {/* one that came as the page opened, just before 最近更新 popped up, waits for it to be closed */}
      {newBadges[0] && !gray && !pamphlet && (
        <NewBadge
          key={newBadges[0].id}
          earned={newBadges[0]}
          onWear={async () => {
            const id = newBadges[0].id;
            setNewBadges((q) => q.slice(1));
            await wearBadge(id, true);
          }}
          onLater={() => setNewBadges((q) => q.slice(1))}
        />
      )}
      {/* above the tutorial card or a roach card while one is showing, so the two never cover each other */}
      {board && (
        <NoticeBoard
          notices={boardNotices}
          view={board.view}
          memory={noticeMem}
          onOpen={boardOpen}
          onList={boardList}
          onLog={boardLog}
          onClose={closeBoard}
        />
      )}
      {/* over everything of each layout, the board it was opened from too */}
      {pamphlet && (
        <Pamphlet
          uiChoice={uiChoice}
          signedIn={Boolean(me)}
          asking={Boolean(me?.ageCheck || me?.mustReconsent)}
          ui={ui}
          mapStyle={shownStyle}
          onAction={closePamphlet}
          onClose={() => closePamphlet()}
        />
      )}
      {pwNudgeUp && mapClear && me && (
        <PasswordNudge
          onSet={() => {
            setPwNudge(false);
            setPanel({ kind: "profile", password: "set" });
          }}
          onLater={() => {
            putOffNudge(me.id);
            setPwNudge(false);
          }}
        />
      )}
      {liteHint && (
        <div className="lite-hint" role="status">
          <p>{T.map.style.switchedToLite}</p>
          <div className="row">
            <button className="go" onClick={() => setLiteHint(false)}>
              {T.map.style.liteOk}
            </button>
            {liteFrom && liteFrom !== "lite" && (
              <button
                className="no"
                onClick={() => {
                  setLiteHint(false);
                  switchMapStyle(liteFrom);
                }}
              >
                {fmtParts(T.map.style.backTo, { style: MAP_STYLE_NAMES[liteFrom] })}
              </button>
            )}
          </div>
        </div>
      )}
      {toast && <div className={`toast ${coachShown || selected || heard.length ? "high" : ""}`}>{toast}</div>}
    </main>
  );
}
