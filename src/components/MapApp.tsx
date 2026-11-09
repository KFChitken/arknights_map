"use client";

import dynamic from "next/dynamic";
import type { StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AMIYA_AMAP_ZOOM, AMIYA_AT, AMIYA_ID, amiyaLine, amiyaRoach, localDay } from "@/lib/amiya";
import { deleteAccount, reconsent, signOut } from "@/lib/authClient";
import { loadAMap } from "@/lib/amap";
import type { EarnedBadge } from "@/lib/badges";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/shapes";
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
  PERLICA_NAME,
  PERLICA_UNFRIEND,
  perlicaRoach,
  sleptSentence,
  touchBackLine,
  weekLine,
  weightSentence,
} from "@/lib/perlica";
import {
  FIRE_AT,
  FIRE_ZOOM,
  fireCount,
  fireLevel,
  isNearFire,
  pickSeat,
  TALULAH_ID,
  TALULAH_LINES,
  TALULAH_NAME,
  talulahRoach,
  talulahTouchLine,
} from "@/lib/talulah";
import {
  dismountLine,
  MINGHE_ID,
  MINGHE_LINES,
  MINGHE_NAME,
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
import { displayName, type Profile, type PublicProfile } from "@/lib/profile";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import type { RoachOpts } from "@/lib/roachSvg";
import { iconPx } from "@/lib/swarm";
import { BUBBLE_FADE_MS, BUBBLE_MS, screenDelta, shoutPlace, shoutZoom, stagePlace, type TouchKind } from "@/lib/touchArt";
import { MAX_CLONES, MOVES_PER_DAY, SITE_NAME } from "@/lib/rules";
import type { ReportReason } from "@/lib/safety";
import type { Basemap, LngLat, MapFocus, MapView, RoachStyle } from "@/lib/types";
import { RoachFeedCopy } from "@/lib/world/feed";
import { reachText } from "@/lib/world/logic";
import { ServerWorld } from "@/lib/world/server";
import {
  ConsentNeeded,
  SignInNeeded,
  TooBusy,
  WorldError,
  type BlockedPlayer,
  type Friend,
  type Homecoming,
  type Identity,
  type InboxItem,
  type MapRoach,
  type Me,
  type OwnRoach,
  type PerlicaItem,
  type PlaceTarget,
  type PublicRoach,
  type Radar,
  type RideTarget,
  type TouchResult,
  type World,
} from "@/lib/world/types";
import { AmiyaGreetingSheet, AmiyaIntroSheet, introShown, markIntroShown } from "./app/Amiya";
import { musicOn, playMusic, preloadMusic, setMusicOn, stopMusic } from "./app/amiyaMusic";
import { BadgeWall, NewBadge } from "./app/Badges";
import CloneMoveSheet from "./app/CloneMoveSheet";
import { GuideDock, GuideSheet } from "./app/GuideDock";
import ConsentSheet, { PlaceConfirm } from "./app/ConsentSheet";
import DeclareSheet from "./app/DeclareSheet";
import { GuestRadarSheet, markWelcomed, PreviewCard, roachesAround, WelcomeSheet, welcomed } from "./app/GuestPreview";
import { HomecomingSheet } from "./app/Homecoming";
import HotSheet from "./app/HotSheet";
import { keepInstallPrompt } from "./app/HomeScreen";
import IdentitySheet from "./app/IdentitySheet";
import InboxSheet, {
  AMIYA_UNFRIEND,
  firstTab,
  FriendView,
  noticeTitle,
  pokedBy,
  ProfileView,
  tabOf,
  type InboxFriendly,
  type InboxTab,
} from "./app/InboxSheet";
import { gestureSent, isAwakeGesture, isGesture, type Gesture } from "@/lib/friendly";
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
import {
  forgetTalulahHere,
  hoodSaid,
  markHoodSaid,
  markTalulahIntroShown,
  TalulahIntroSheet,
  talulahIntroShown,
} from "./app/Talulah";
import PlaceBar from "./app/PlaceBar";
import ProfileSheet from "./app/ProfileSheet";
import RadarSheet from "./app/RadarSheet";
import SafetySheet from "./app/SafetySheet";
import RoachActor, { POKE_LANDS_MS, PokeActor } from "./app/RoachActor";
import TouchStage, { ShoutStage, type ShoutPlace, type StagePlace, type TouchCast } from "./app/TouchStage";
import { DOCK_ANIM, DockArcs, DockFx, HeardBubbles, type DockAt, type DockFrom, type DockKind, type Heard } from "./app/DockFx";
import FriendActions, { type FriendAct } from "./app/FriendActions";
import GestureStage, { SanityFly } from "./app/GestureStage";
import VisitSheet from "./app/VisitSheet";
import FriendsSheet, { FriendsMark } from "./app/FriendsSheet";
import PartyScene from "./app/PartyScene";
import { playPartyMusic, preloadPartyMusic, stopPartyMusic, type PartyMusic } from "./app/partyMusic";
import { PARTY_ZOOM } from "@/lib/party";
import { MyRoachCard, OtherRoachCard } from "./app/RoachCards";
import {
  loadProgress,
  nearestReal,
  saveProgress,
  TutorialCoach,
  tutorialStep,
  type Progress,
} from "./app/Tutorial";
import { belowGuide, besideMain, besideRight, BIKE_MS, guideBox, guideShift, MINE_PX, preloadDance } from "./map/guideMarker";
import type { GuideMark, MapOverlay, ShoutMark } from "./map/types";
import RoachIcon from "./RoachIcon";

const MaplibreView = dynamic(() => import("./map/MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./map/AmapView"), { ssr: false });

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
/** Whether a view has moved away from another (more than about 100 m, or half a zoom level) */
const movedFrom = (a: MapView, b: MapView) => Math.abs(a.lng - b.lng) > 1e-3 || Math.abs(a.lat - b.lat) > 1e-3 || Math.abs(a.zoom - b.zoom) > 0.5;
/** How long one of 佩丽卡监督's notes stays along the top: a line, or two */
const NOTE_MS = [6000, 8000];
/** One of her notes along the top (src/components/app/Perlica.tsx) */
type PerlicaNote = { lines: string[] };
/** Her report of a time away, with its weight */
const awayNote = (item: PerlicaItem): PerlicaNote => ({
  lines: [awaySentence(item.seconds ?? 0, item.line ?? 0), weightSentence(item.seconds ?? 0)],
});
const pickOf = (n: number) => Math.floor(Math.random() * n);
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

type Panel =
  /** draft: unsaved changes kept while 我的称号 was open */
  | { kind: "profile"; draft?: Profile }
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
  | { kind: "mine" }
  | { kind: "declare"; initial?: Template }
  | { kind: "identity" }
  /** items is a snapshot taken on open, so new ones stay highlighted after they are marked seen */
  | { kind: "inbox"; notice: boolean; items: InboxItem[]; tab: InboxTab; viewed: InboxTab[] }
  /** target: the message the profile came with, for blocking or reporting */
  | { kind: "viewProfile"; profile: PublicProfile; target: string; back: Panel }
  | { kind: "friend"; friendId: string; back: Panel | null }
  /** Everyone you are 触须之交 with, as a grid (from the dock) */
  | { kind: "friends" }
  /** 做客 at one of a 触须之交's roaches: asked first, then (every clone out) which clone goes */
  | { kind: "visitConfirm"; friendId: string; roach: PublicRoach }
  | { kind: "visitMove"; friendId: string; roach: PublicRoach }
  | { kind: "radar"; radar: Radar | null }
  | { kind: "safety"; target: string; who: string | null; back: Panel | null }
  | { kind: "login"; reason?: string }
  /** 隐私说明更新了; then: what was going to open first */
  | { kind: "consent"; then?: Panel | null }
  /** consent: the player's first roach, so the card asks them to agree its spot is public */
  | { kind: "placeConfirm"; target: PlaceTarget; spot: LngLat; fly: boolean; consent: boolean }
  // open to everyone
  | { kind: "hot" }
  /** One of the guides, from the column under 方舟雷达 */
  | { kind: "guide"; id: GuideId }
  // for visitors who have not signed in
  | { kind: "welcome" }
  | { kind: "guestRadar" }
  // the newcomer tutorial's first step
  | { kind: "tutorialCard" };

type Selection = { kind: "other"; roach: PublicRoach } | { kind: "mine"; roach: OwnRoach };

type AmiyaItem = Extract<InboxItem, { kind: "amiya" }>;

type Placing = { target: PlaceTarget; label: string };

const PLACING_LABEL: Record<PlaceTarget["kind"], string> = {
  main: "点地图放下你的蟑螂本体",
  clone: "点地图放一只克隆体",
  move: "点地图给它挪个窝",
};

/** cn: the visitor is in mainland China, so the map is Amap only (OSM just when Amap cannot load). */
export default function MapApp({ cn }: { cn: boolean }) {
  const worldRef = useRef<World | null>(null);
  const feedRef = useRef(new RoachFeedCopy());
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  // Visitors from mainland China: Amap wherever China is in view, our own map abroad (src/lib/chinaView.ts).
  // Both maps stay made once made, and only the one on show is used; Amap is made when first needed.
  const chinaRef = useRef<typeof import("@/lib/chinaView") | null>(null);
  const [overseas, setOverseas] = useState<{ style: StyleSpecification; cover: GeoJSON.FeatureCollection } | null>(null);
  const [abroad, setAbroad] = useState(false);
  const [amapMade, setAmapMade] = useState(true);
  const [overseasMade, setOverseasMade] = useState(false);
  const [amapFailed, setAmapFailed] = useState(false);
  const [amapJump, setAmapJump] = useState<MapFocus | null>(null);
  const [overseasJump, setOverseasJump] = useState<MapFocus | null>(null);
  const amapReady = useRef(false);
  const overseasReady = useRef(false);
  // a change waiting for the other map to finish drawing itself
  const wanted = useRef<"abroad" | "home" | null>(null);
  const [look, setLook] = useState<RoachStyle>("cartoon");
  const [me, setMe] = useState<Me | null>(null);
  const [feedRoaches, setFeedRoaches] = useState<MapRoach[]>([]);
  // Every public id our roaches had on this page: after a move the old one stays in the feed for a moment
  const [ownIds, setOwnIds] = useState<ReadonlySet<string>>(new Set());
  const meIdRef = useRef<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [focus, setFocus] = useState<MapFocus | null>(null);
  const viewRef = useRef<MapView>(WORLD_VIEW);
  const boundsRef = useRef<[LngLat, LngLat] | null>(null);
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
  // 塔露拉干员's fire: a clone on its way there, the count pretended in development, and her line to 初始 hoods while her card shows it
  const [sendingToFire, setSendingToFire] = useState(false);
  const [fakeFire, setFakeFire] = useState<number | null>(null);
  const [hoodLine, setHoodLine] = useState<string | null>(null);
  // 明河都尉: the time his day is worked out from (again as he moves on at 04:00), a clone getting on or off, riders pretended in development
  const [mingheClock, setMingheClock] = useState(() => Date.now());
  const [riding, setRiding] = useState(false);
  const [fakeRiders, setFakeRiders] = useState<number | null>(null);
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
  const [vialAt, setVialAt] = useState<{ x: number; y: number } | null>(null);
  const [drinking, setDrinking] = useState(false);
  const retryRef = useRef<{ timer?: number; delay: number }>({ delay: 0 });

  // The feed is the same for everyone: leave out our own roaches (drawn from me) and mark friends'
  const friendKey = friends
    .flatMap((f) => f.roaches.map((r) => r.id))
    .sort()
    .join(",");
  const roaches = useMemo<PublicRoach[]>(() => {
    const friendIds = new Set(friendKey.split(","));
    return feedRoaches.filter((r) => !ownIds.has(r.id)).map((r) => ({ ...r, friend: friendIds.has(r.id) }));
  }, [feedRoaches, ownIds, friendKey]);

  const applyMe = useCallback((m: Me | null) => {
    const sameOwner = m?.id === meIdRef.current;
    meIdRef.current = m?.id ?? null;
    setMe(m);
    setOwnIds((prev) => {
      const base = sameOwner ? prev : new Set<string>();
      const fresh = (m?.roaches ?? []).filter((r) => !base.has(r.publicId));
      if (!fresh.length) return base;
      const next = new Set(base);
      for (const r of fresh) next.add(r.publicId);
      return next;
    });
  }, []);

  // Each part of the page is refreshed on its own, only when it may have changed
  const loadMe = useCallback(async () => {
    const m = await worldRef.current!.me();
    applyMe(m);
    return m;
  }, [applyMe]);
  const loadRoaches = useCallback(async () => {
    const feed = feedRef.current;
    try {
      if (feed.apply(await worldRef.current!.roachFeed(feed.version))) setFeedRoaches(feed.roaches);
      retryRef.current.delay = 0;
    } catch (e) {
      if (!(e instanceof TooBusy)) throw e;
      // Busy: try again shortly, a little later each time, at a slightly different moment for each page
      const r = retryRef.current;
      if (r.timer !== undefined) return;
      r.delay = Math.min(60, r.delay ? r.delay * 2 : e.retryAfterS);
      if (!feed.version) setToast(e.message);
      r.timer = window.setTimeout(
        () => {
          r.timer = undefined;
          loadRoaches().catch(() => {});
        },
        r.delay * (750 + Math.random() * 500),
      );
    }
  }, []);
  const loadInbox = useCallback(async () => {
    const items = await worldRef.current!.inbox();
    lastMessagesRef.current = Date.now();
    const before = inboxIdsRef.current;
    freshRef.current = before ? items.filter((i) => !before.has(i.id)) : [];
    inboxIdsRef.current = new Set(items.map((i) => i.id));
    setInbox(items);
    return items;
  }, []);
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
    // the roaches have their own retries, so a busy roach list never holds up the rest
    const [m, items, , list, , away] = await Promise.all([
      loadMe(),
      loadInbox(),
      loadRoaches().catch(() => {}),
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
    const b = guessBasemap(cn);
    // The map's code downloads while the first API calls are in flight; the map itself waits for where to start.
    // A failed Amap load is forgotten, so AmapView tries again and falls back to OSM as before.
    if (b === "amap") {
      void import("./map/AmapView");
      loadAMap().catch(() => {});
    } else void import("./map/MaplibreView");
    // visitors from mainland China: our own map for abroad, and the outline of where Amap must show
    const abroadKit = cn
      ? Promise.all([import("@/lib/overseas"), import("@/lib/chinaView"), import("./map/MaplibreView")]).catch(() => null)
      : Promise.resolve(null);
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
        // a visit that starts abroad opens our own map at once; Amap waits until China comes into view
        const v = viewRef.current;
        if (b === "amap" && china.clearOfChina(china.viewAround(v, v.zoom, window.innerWidth, window.innerHeight))) {
          setAbroad(true);
          setOverseasMade(true);
          setAmapMade(false);
        }
      }
      setLook(loadLook());
      setBasemap(b);
    };
    const waiting = window.setTimeout(() => void startMap(null), loadHome() ? 0 : MAP_WAIT_MS);
    let failed = false;
    load()
      .catch((e) => {
        console.error(e);
        failed = true;
        setToast("连不上服务器，地图先只显示底图。");
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
          // an updated privacy policy before anything else
          if (m?.mustReconsent) setPanel({ kind: "consent", then: opening });
          else if (opening) setPanel(opening);
          else if (pending.length) return;
          // What arrived since the last visit
          else if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
          // the page reloaded while the player went to read their login code
          else if (!m && pendingLogin()) setPanel({ kind: "login" });
          else if (!m && !welcomed()) setPanel({ kind: "welcome" });
        };
        // back after its roach flipped over for their staying away: it stands up (鲤鱼打挺) before anything opens
        if (m?.wokeFromAway && main && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          afterActing.current = first;
          setActing("wake");
        } else first();
      });
    return () => window.clearTimeout(waiting);
  }, [load, openInbox, cn]);

  // Android Chrome offers adding the site to the home screen once, early; 资料 keeps it for later
  useEffect(() => keepInstallPrompt(), []);

  // Development only: zhoupFly(lng, lat, zoom) in the console flies the map anywhere, to try out the map changes
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as { zhoupFly?: unknown }).zhoupFly = (lng: number, lat: number, zoom = 11) =>
      setFocus({ lng, lat, zoom, nonce: Date.now() });
  }, []);

  // Roaches others placed or moved: once a minute, and when the page comes back into view, ask only what changed
  useEffect(() => {
    let last = Date.now();
    const poll = () => {
      if (document.visibilityState !== "visible" || !worldRef.current || Date.now() - last < 10_000) return;
      last = Date.now();
      loadRoaches().catch(() => {});
    };
    document.addEventListener("visibilitychange", poll);
    const t = window.setInterval(poll, 60_000);
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

  const showNew = useCallback(async () => {
    // me too, for a badge someone else's move just earned us
    const [items] = await Promise.all([loadInbox(), loadFriends(), loadMe()]);
    if (demoRef.current) await loadIdentities();
    if (!items.some((i) => !i.seen)) return;
    const fresh = freshRef.current.filter((i) => !i.seen);
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
    else if (open || busy) setToast(`${noticeTitle(items)}点「消息」看看。`);
    else await openInbox(true, undefined, items);
  }, [loadInbox, loadFriends, loadMe, loadIdentities, openInbox]);

  /** Where your dock is on screen now; null while it is hidden (moving a roach, a card open) */
  const dockAt = (): DockAt | null => {
    const av = dockAvRef.current?.getBoundingClientRect();
    const mail = dockMailRef.current?.getBoundingClientRect();
    if (!av?.width || !mail) return null;
    const top = document.querySelector("header.topbar")?.getBoundingClientRect().bottom ?? 0;
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
  const heardReply = async (id: string) => {
    setHeard((all) => all.filter((h) => h.id !== id));
    await openInbox(false, "replies");
  };
  const heardOk = async (id: string) => {
    setHeard((all) => all.filter((h) => h.id !== id));
    await worldRef.current!.markSeen([id]).catch(() => {});
    await loadInbox();
  };

  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    const events = new EventSource("/api/events");
    let timer: number | undefined;
    let pending = false;
    let dropped = false;
    const run = () => {
      window.clearTimeout(timer);
      timer = undefined;
      showNew().catch(() => {});
    };
    // A declaration nudges a whole neighbourhood at once, so each page waits a random moment,
    // and nudges arriving meanwhile are taken in by the same refresh
    const later = () => {
      if (document.hidden) pending = true;
      else if (timer === undefined) timer = window.setTimeout(run, Math.random() * 10_000);
    };
    events.addEventListener("inbox", later);
    // nudges sent while the connection was down are lost, so look once it is back
    events.addEventListener("error", () => (dropped = true));
    events.addEventListener("open", () => {
      if (dropped) later();
      dropped = false;
    });
    // a page in the background only notes that something came, and looks when it is in view again
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (pending || Date.now() - lastMessagesRef.current > 5 * 60_000) {
        pending = false;
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
  const offStage = poking?.id ?? jolting?.roach.id ?? touchScene?.target;
  const shownRoaches = useMemo(() => (offStage ? roaches.filter((r) => r.id !== offStage) : roaches), [roaches, offStage]);

  const countVisible = useCallback(
    (bounds: [LngLat, LngLat]) => {
      let n = roaches.reduce((s, r) => s + (inBounds(r, bounds) ? 1 : 0), 0);
      for (const r of me?.roaches ?? []) if (inBounds(r, bounds)) n += 1;
      setVisible(n);
    },
    [roaches, me],
  );

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
      if (e instanceof SignInNeeded) setPanel({ kind: "login", reason: "登录后才能这样做。" });
      else if (e instanceof ConsentNeeded) setPanel({ kind: "consent" });
      else if (e instanceof WorldError) setToast(e.message);
      else {
        console.error(e);
        setToast("出了点问题，再试一次吧。");
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

  const startPlacing = (target: PlaceTarget) => {
    // say so before they pick a spot, not after
    if (me?.mustReconsent) return setPanel({ kind: "consent" });
    if (target.kind === "move" && me && me.movesLeft <= 0) {
      setToast(`每天最多挪 ${MOVES_PER_DAY} 次窝，今天的用完了，明天再挪吧。`);
      return;
    }
    setPanel(null);
    setSelected(null);
    setPlacing({ target, label: PLACING_LABEL[target.kind] });
  };

  const placeAt = async (p: LngLat, fly: boolean) => {
    if (!placing) return;
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
    welcomeAtFire(before, m, false);
    // the tutorial's clone step is done for good once one is down, even if it is taken back later
    if (target.kind === "clone" && step === "clone") updateProgress({ clone: true });
    if (fly) setFocus({ lng: p.lng, lat: p.lat, zoom: 13, nonce: Date.now() });
    setToast(
      target.kind === "move"
        ? `挪好啦！今天还能挪 ${m?.movesLeft ?? 0} 次。`
        : target.kind === "clone"
          ? "克隆体放好啦！等待其他舟P发现中 |ω・）"
          : "放好啦！等待其他舟P发现中 |ω・）",
    );
  };

  const onMapClick = (p: LngLat) => {
    if (placing) return placeAt(p, false);
    setSelected(null);
    // a visitor sees where their roach would go and who is around; nothing is sent
    if (!me) setPreview(p);
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
    countVisible(bounds);
    // 阿米娅向导 close enough on screen to be tapped: her dance and music on their way, so a tap starts them at once
    if (!amiyaNear.current && v.zoom >= 6 && inBounds(AMIYA_AT, bounds) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      amiyaNear.current = true;
      preloadDance();
      preloadMusic();
    }
  };
  const amiyaNear = useRef(false);

  // ---- visitors from mainland China: changing between Amap and our own map ----

  const twoMaps = cn && basemap === "amap" && !amapFailed && Boolean(overseas);
  const ignoreView = () => {};
  // the other map jumps to where this one is, without flying, and takes over
  const showAbroad = () => {
    wanted.current = null;
    setOverseasJump({ ...viewRef.current, nonce: Date.now() });
    setAbroad(true);
  };
  const showHome = () => {
    wanted.current = null;
    setAmapJump({ ...viewRef.current, nonce: Date.now() });
    setAbroad(false);
  };
  /** Amap came to rest: once even a wider view would not show China, our own map takes over */
  const onAmapView = (v: MapView, bounds: [LngLat, LngLat]) => {
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
  /** Our own map came to rest: as soon as China is in view, back to Amap */
  const onOverseasView = (v: MapView, bounds: [LngLat, LngLat]) => {
    onViewChange(v, bounds);
    if (!chinaRef.current?.seesChina(bounds)) {
      wanted.current = null;
      return;
    }
    if (amapReady.current) return showHome();
    wanted.current = "home";
    setAmapMade(true);
  };
  const onAmapReady = () => {
    amapReady.current = true;
    if (wanted.current === "home") showHome();
  };
  const onOverseasReady = () => {
    overseasReady.current = true;
    if (wanted.current === "abroad") showAbroad();
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
    if (drinks !== 1 && drinks !== 50) setToast(`又醉倒了，这是第 ${drinks} 次。`);
  };

  // up again: whoever poked it while it slept shows now
  const pokedToast = (items: InboxItem[]) => {
    const who = pokedBy(items);
    return who ? `${who} 趁你睡着戳了戳你，点「消息」看看。` : "";
  };

  const soberUp = async () => {
    endParty();
    setDrinking(true);
    const done = await act((w) => w.sober().then(() => true));
    setDrinking(false);
    if (!done) return;
    play("wake");
    const [, items] = await Promise.all([loadMe(), loadInbox()]);
    setToast(`醒酒了。${pokedToast(items)}`);
  };

  /** ⚡舟友的酒⚡ on, within the tap (so its music may play): the map goes to the drunk main roach */
  const startParty = () => {
    const main = me?.roaches.find((r) => r.slot === 0);
    if (!main || !me?.drunkUntil) return;
    const music = playPartyMusic();
    setSelected(null);
    setFocus({ lng: main.lng, lat: main.lat, zoom: Math.max(viewRef.current.zoom, PARTY_ZOOM), nonce: Date.now() });
    setParty({ key: Date.now(), el: document.createElement("div"), at: { lng: main.lng, lat: main.lat }, music });
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
      if (poked) setToast(`你的蟑螂睡醒了。${poked}`);
    };
    const t = window.setTimeout(() => woke().catch(() => {}), Math.max(0, drunkUntil - Date.now()) + 1000);
    return () => window.clearTimeout(t);
  }, [drunkUntil, loadMe, loadInbox]);

  const remove = async (r: OwnRoach) => {
    if (!window.confirm(r.slot === 0 ? "收回蟑螂本体？克隆体也会一起收回。" : "收回这只克隆体？")) return;
    const done = await act((w) => w.removeRoach(r.id), r.slot === 0 ? "已经收回你的蟑螂和克隆体。" : "已经收回这只克隆体。");
    if (!done) return;
    setSelected(null);
    await loadMe();
  };

  const befriendedToast = (name: string) => {
    const guide = Object.values(GUIDES).find((g) => g.name === name);
    setToast(
      name === TALULAH_NAME
        ? "你和塔露拉干员握了手，成为了触须之交！在「消息 → 触须之交」里能看到她。"
        : guide
          ? `你和${name}成为了触须之交！在「消息 → 触须之交」里能看到${guide.pronoun}。`
          : `你们互相大胆碰过了，和 ${name} 成为了触须之交！在「消息 → 触须之交」里能看到 TA。`,
    );
  };

  const touchedToast = (bold: boolean) =>
    setToast(bold ? "大胆地伸出了触须！TA 将能看到你的资料" : "偷偷碰了一下！TA 只会知道被一只蟑螂碰了。");
  /** A guide touches back once a day (src/lib/server/guides.ts); this touch got nothing back */
  const quietGuideToast = (id: GuideId) =>
    setToast(`${GUIDES[id].name}今天已经碰回过你了，明天再碰碰${GUIDES[id].pronoun}吧。`);

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
        you: { avatar: myAvatar, color: myColor, name: me.profile.anonymous || !me.profile.name.trim() ? "匿名" : displayName(me.profile) },
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

  /** 戳一戳 a 触须之交's sleeping roach: the card stays open, and its button turns to 「戳过了」. */
  const poke = async (roach: PublicRoach) => {
    setPokeSent(true);
    const done = await act((w) => w.poke(roach.id));
    setPokeSent(false);
    if (!done) return;
    const landed = () => setToast("戳到了！TA 的腿抖了一下，又睡过去了。");
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
    setToast(`已经催 ${friend.profile.displayName} 清理智啦`);
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
    if (!me?.roaches.some((r) => r.slot === 0)) return setToast("先放下蟑螂本体，才能派克隆体去做客。");
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
    await Promise.all([loadMe(), loadRoaches(), loadFriends()]);
    sayOver(res.seat, "来串门啦！");
    setToast(`你的克隆体在 ${friend.profile.displayName} 家坐下了`);
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
    setToast("已经请 TA 的克隆体回家了，3 天内 TA 不会再来。");
    await afterVisitChange();
  };

  /** 回家: your visiting clone goes back */
  const goHome = async (cloneId: string) => {
    if (!(await friendly((w) => w.goHome(cloneId)))) return;
    setSelected(null);
    setToast("你的克隆体回家了");
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
    sayOver(res.seat, "来串门啦！");
    setToast("你的克隆体跟过去了");
  };

  /** 复制 a UID they share; where the browser will not write the clipboard (QQ, WeChat), long-press it instead */
  const copyUid = (uid: string) =>
    navigator.clipboard
      ?.writeText(uid)
      .then(() => setToast("复制好了"))
      .catch(() => setToast("长按 UID 就能复制")) ?? setToast("长按 UID 就能复制");

  const gameAsk = async (friend: Friend, game: Game) => {
    if (!(await friendly((w) => w.gameAsk(friend.id, game)))) return;
    setToast(`已经告诉 ${friend.profile.displayName}，等 TA 在游戏里通过`);
    await loadFriends();
  };
  const gameWant = async (friend: Friend, game: Game) => {
    if (!(await friendly((w) => w.gameWant(friend.id, game)))) return;
    setToast(`已经告诉 ${friend.profile.displayName} 你想在游戏里加 TA`);
    await loadFriends();
  };

  /** One of the row's buttons (FriendActions), on their roach's card (roach) or their page */
  const friendAct = (friend: Friend, act: FriendAct, at: { x: number; y: number }, roach: PublicRoach | null) => {
    const on = roach ?? mainRoachOf(friend);
    if (act === "sanity") return remindSanity(friend, at);
    if (act === "visit") return on ? askVisit(friend, on) : setToast("TA 现在没有放蟑螂。");
    if (act === "poke") {
      const main = friend.between?.mainId ? friend.roaches.find((r) => r.id === friend.between!.mainId) : null;
      if (!main) return setToast("TA 现在没有放蟑螂。");
      setPanel(null);
      return poke({ ...main, asleep: true });
    }
    if (isGesture(act)) return doGesture(friend, act, on);
  };

  /** What the inbox's 触须之交 messages can do */
  const inboxFriendly: InboxFriendly = {
    answerSanity: async (itemId, answer) => {
      if (!(await friendly((w) => w.answerSanity(itemId, answer)))) return;
      if (answer === "done") setToast("已经告诉 TA 了");
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
      setToast("已经告诉 TA 了，你们在游戏里也是好友啦");
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
          {state?.added && <span className="game-tag">游戏里也是好友</span>}
          {uid && (
            <button className="pill" onClick={() => copyUid(uid)}>
              复制
            </button>
          )}
          {uid && !state?.added && apart && <span className="muted">你们不在一个服务器，游戏里加不了</span>}
          {uid && !state?.added && !apart && (
            <button className="pill dark" disabled={friendBusy || Boolean(state?.askAgainAt)} onClick={() => gameAsk(friend, game)}>
              {state?.askAgainAt ? "已经告诉 TA 了" : "我在游戏里申请了"}
            </button>
          )}
          {!uid && (
            <button className="pill" disabled={friendBusy || Boolean(b.wantAgainAt)} onClick={() => gameWant(friend, game)}>
              {b.wantAgainAt ? "已经告诉 TA 了" : "想在游戏里加 TA"}
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

  /** What a guide says as she touches back, as far as a speech bubble has room: 塔露拉干员's handshake only begins there. */
  const guideLine = (g: NonNullable<TouchResult["guide"]>) => {
    const games = me?.profile.games ?? [];
    if (g.id === PERLICA_ID) return touchBackLine(g.kind, g.bold, g.times, g.others, g.line);
    if (g.id === TALULAH_ID) return g.kind === "friend" ? TALULAH_LINES.hello : talulahTouchLine("touch", g.bold, games);
    if (g.id === MINGHE_ID) return mingheTouchLine(g.kind === "friend" ? "friend" : "touch", g.bold);
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
    setSelected(null);
    const loading = res.newFriend ? Promise.all([loadFriends(), loadMe()]) : null;
    const played = await playTouch(roach, res.newFriend ? "friend" : bold ? "bold" : "sneaky");
    const { itemId } = res.guide;
    if (res.newFriend) befriendedToast(res.newFriend);
    else if (itemId) touchedToast(bold);
    else quietGuideToast(id);
    if (id === AMIYA_ID && step === "touch") updateProgress({ practiced: true });
    await loading;
    // she touched back once already today: nothing more from her
    if (!itemId) return;
    const line = guideLine(res.guide);
    const at = id === PERLICA_ID ? perlicaShown : id === TALULAH_ID ? FIRE_AT : id === MINGHE_ID ? mingheAt : AMIYA_AT;
    window.setTimeout(async () => {
      say(id, line);
      // touching 阿米娅向导 got 佩丽卡监督 to speak up too, along the top
      if (res.aside) queueNote({ lines: [PERLICA_MORE.aside] });
      // heard on the spot while she is on screen; otherwise it waits in 消息
      const bounds = boundsRef.current;
      if (bounds && at && inBounds(at, bounds) && !busyRef.current.panel) {
        await worldRef.current!.markSeen([itemId]).catch(() => {});
      } else {
        const g = GUIDES[id];
        await playDockRef.current("bold", { name: g.name, avatar: g.avatar, color: g.color });
        setToast(`${g.name}碰回了你，点「消息」看看。`);
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
    setToast("默默爬走了，TA 不会知道。");
    keepSnapshot(await loadInbox());
  };

  const react = async (itemId: string, reaction: string) => {
    const done = await act((w) => w.react(itemId, reaction).then(() => true));
    if (!done) return;
    setToast("回应发出去了！");
    keepSnapshot(await loadInbox());
  };

  const repliedToast = (bold: boolean) => setToast(bold ? "大胆碰回去了！向 TA 表明你的身份" : "偷偷碰回去了。");

  const reply = async (itemId: string, bold: boolean) => {
    const res = await act((w) => w.reply(itemId, bold));
    if (!res) return;
    if (res.newFriend) befriendedToast(res.newFriend);
    // a guide answers at once: her touch is now at the top of 收到的触碰 (once a day)
    else if (res.guide?.itemId) setToast(`${GUIDES[res.guide.id].name}碰回了你。`);
    else if (res.guide) quietGuideToast(res.guide.id);
    else repliedToast(bold);
    if (res.guide?.itemId) say(res.guide.id, guideLine(res.guide));
    if (res.aside) queueNote({ lines: [PERLICA_MORE.aside] });
    const [items] = await Promise.all([loadInbox(), loadFriends()]);
    keepSnapshot(items);
    if (me?.isNew || res.newFriend) await loadMe();
    if (demoRef.current) await loadIdentities();
  };

  const openRadar = async () => {
    setSelected(null);
    const radar = await act((w) => w.radar());
    if (radar !== undefined) setPanel({ kind: "radar", radar });
  };

  /** How close to fly to a roach: Amap draws nothing abroad close in, so 阿米娅向导 is shown from further out there. */
  const zoomFor = (roach: PublicRoach, zoom: number) =>
    roach.id === TALULAH_ID
      ? FIRE_ZOOM
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
        ? AMIYA_UNFRIEND
        : guide.id === PERLICA_ID
          ? PERLICA_UNFRIEND
          : guide.id === MINGHE_ID
            ? MINGHE_LINES.unfriendAsk
            : TALULAH_LINES.unfriendAsk
      : `解除和 ${friend.profile.displayName} 的触须之交？`;
    if (!window.confirm(question)) return;
    const done = await act(
      (w) => w.unfriend(friend.id).then(() => true),
      guide?.id === PERLICA_ID
        ? `${PERLICA_NAME}：「${PERLICA_LINES.unfriend}」`
        : guide?.id === TALULAH_ID
          ? `${TALULAH_NAME}：${TALULAH_LINES.unfriend}`
          : guide?.id === MINGHE_ID
            ? `${MINGHE_NAME}：${MINGHE_LINES.unfriend}`
            : "已经解除触须之交。",
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
    const done = await act((w) => w.block(p.target).then(() => true), "拉黑了。TA 不会知道。");
    if (done) await afterBlock(p);
  };

  const reportSender = async (p: Extract<Panel, { kind: "safety" }>, reason: ReportReason, note: string) => {
    const done = await act(
      (w) => w.report(p.target, reason, note).then(() => true),
      "举报收到了，管理员会尽快处理。TA 也被你拉黑了。",
    );
    if (done) await afterBlock(p);
  };

  const unblock = async (blockId: string) => {
    const done = await act((w) => w.unblock(blockId).then(() => true), "解除拉黑了。");
    if (!done) return;
    setBlocked(await worldRef.current!.blocks());
    await loadInbox();
  };

  const saveProfile = async (p: Profile) => {
    const saved = await act((w) => w.saveProfile(p), "资料存好了。");
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
    playShout(d, from, () => setToast(`宣言发出去了！${res.reach}`));
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
    if (m?.mustReconsent) setPanel({ kind: "consent" });
    else if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
    else setToast("切换好了，现在用这个身份看地图。");
  };

  const signedIn = async () => {
    setPanel(null);
    const spot = preview;
    setPreview(null);
    const { me: m, items, away, friends: list } = await load();
    setNotes([...(away ? [awayNote(away)] : []), ...openingNotes(m, list)]);
    const mainRoach = m?.roaches.find((r) => r.slot === 0);
    if (mainRoach) setFocus({ lng: mainRoach.lng, lat: mainRoach.lat, zoom: 11, nonce: Date.now() });
    if (m?.mustReconsent) return setPanel({ kind: "consent" });
    // a newcomer who picked a spot before signing in puts their roach there, once they confirm
    if (m && !mainRoach && spot) {
      return setPanel({ kind: "placeConfirm", target: { kind: "main" }, spot, fly: true, consent: !m.agreedPublicPlace });
    }
    if (items.some((i) => !i.seen)) openInbox(true, undefined, items);
    else setToast(m && !mainRoach ? "登录好了！先放下你的蟑螂吧。" : "登录好了！");
  };

  // ---- the tutorial's steps ----

  const greet = async (d: Declaration) => {
    if (!tutorialMain) return;
    setGreeting(true);
    const res = await act((w) => w.declare(d, [tutorialMain.id]));
    setGreeting(false);
    if (!res) return;
    // nobody heard it yet, so say so plainly
    setToast(`宣言发出去了！${res.reach}${res.reach === reachText(0) ? "等这里热闹起来再喊一声。" : ""}`);
    await loadMe();
  };

  const showRoach = (roach: PublicRoach) => {
    setPanel(null);
    setFocus({ lng: roach.lng, lat: roach.lat, zoom: zoomFor(roach, 14), nonce: Date.now() });
    setSelected({ kind: "other", roach });
  };

  const leave = async (kind: "signOut" | "delete") => {
    if (kind === "delete" && !window.confirm("注销账号会删除你的资料、蟑螂、消息和触须之交，无法恢复。确定吗？")) return;
    try {
      await (kind === "delete" ? deleteAccount() : signOut());
    } catch (e) {
      setToast(e instanceof Error ? e.message : "出了点问题，再试一次吧。");
      return;
    }
    setPanel(null);
    setSelected(null);
    saveHome(null);
    // deleted roaches leave everyone's feed on its next rebuild; leave them off this map right away
    if (kind === "delete" && feedRef.current.forget([...ownIds])) setFeedRoaches(feedRef.current.roaches);
    await load();
    setToast(kind === "delete" ? "账号和数据都删除了。" : "已经退出登录。");
  };

  const agreeAgain = async (ticks: Parameters<typeof reconsent>[0], then: Panel | null) => {
    try {
      await reconsent(ticks);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "出了点问题，再试一次吧。");
      return;
    }
    await loadMe();
    setPanel(then);
    setToast("谢谢！可以继续玩啦。");
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
      return setToast(rewindDrank(me.id, 7) ? "喝酒时间往前挪了 7 小时，现在醒酒试试。" : "先打开离开计时，再「摄入酒精」。");
    }
    if (what === "birthday") {
      const done = await act((w) => w.pretend("perlicaBirthday").then(() => true));
      if (done) setToast("这一小时里碰她，都按她的生日算。");
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
    if (on) setToast("佩丽卡监督开始记了。下次你离开满 10 分钟再回来，她会告诉你离开了多久。");
    else {
      setToast(`${PERLICA_NAME}：「${PERLICA_LINES.declined}」`);
      say(PERLICA_ID, PERLICA_LINES.declined);
    }
  };

  /** Her timer switched in 资料, after the rest of it saved. */
  const switchPerlicaTimer = async (on: boolean) => {
    const done = await act((w) => w.setPerlicaTimer(on).then(() => true));
    if (done && !on && me) forgetDrank(me.id);
    if (done) await loadMe();
    return Boolean(done);
  };

  const reset = async () => {
    if (!window.confirm("清空所有测试数据（触须、宣言、触须之交、挪窝记录），测试玩家回到原位？真实玩家和他们的蟑螂会留着。")) return;
    await act((w) => w.reset(), "测试数据清空了。");
    setPanel(null);
    setSelected(null);
    setPlacing(null);
    await load();
  };

  const myColor = me?.profile.color ?? "cyan";
  const myAvatar = me?.profile.avatar ?? "hood";
  const main = me?.roaches.find((r) => r.slot === 0);
  // 佩丽卡监督 keeps watch beside the drunk main roach (the map sets her just to its right), then goes back to her spot
  const guarding = Boolean(me?.drunkUntil && main && perlicaAt);
  const perlicaShown = guarding && main ? { lng: main.lng, lat: main.lat } : perlicaAt;
  const unseen = inbox.filter((i) => !i.seen).length;
  const around = useMemo(() => (preview ? roachesAround(feedRoaches, preview) : null), [preview, feedRoaches]);
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
      ? shownFriends.find((f) => f.roaches.some((r) => r.id === selected.roach.id))
      : undefined;
  const total = roaches.length + (me?.roaches.length ?? 0);


  const coachShown = Boolean(!placing && !selected && !panel && me && step);

  // 获得新称号: once nothing else is on screen, up to three in a row; any more go straight to the wall
  const [newBadges, setNewBadges] = useState<EarnedBadge[]>([]);
  const unseenBadges = (me?.badges ?? [])
    .filter((b) => !b.seen)
    .map((b) => b.id)
    .join(",");
  const idle = Boolean(me && !placing && !selected && !panel && !step && !acting);

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



  useEffect(() => {
    if (!idle || perlicaBusy || !unseenBadges || newBadges.length || !me) return;
    setNewBadges(me.badges.filter((b) => !b.seen).slice(0, 3));
    worldRef.current!.seeBadges(unseenBadges.split(",")).catch(() => {});
    // shown now, so a reload of me before the server has caught up does not queue them again
    applyMe({ ...me, badges: me.badges.map((b) => ({ ...b, seen: true })) });
  }, [idle, perlicaBusy, unseenBadges, newBadges.length, me, applyMe]);

  // The tutorial's touch step happens on Rhode Island: the map goes to 阿米娅向导 as it begins
  const touchLesson = step === "touch" && !progress.practiced && basemap !== null;
  useEffect(() => {
    if (!touchLesson) return;
    const amiya = amiyaRoach(false);
    setFocus({ lng: amiya.lng, lat: amiya.lat, zoom: zoomFor(amiya, 13), nonce: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchLesson]);

  // 阿米娅向导 introduces herself once to players with a roach who have not met her, after everything else
  const introDue = Boolean(
    settled && idle && !perlicaBusy && main && me && !me.amiya.friend && !newBadges.length && !unseenBadges,
  );
  const meIdForIntro = me?.id;
  useEffect(() => {
    if (!introDue || !meIdForIntro || introduced.current || introShown(meIdForIntro)) return;
    markIntroShown(meIdForIntro);
    introduced.current = true;
    setPanel({ kind: "amiyaIntro" });
  }, [introDue, meIdForIntro]);

  // ---- 塔露拉干员 ----

  // Everyone's roaches, yours from me (the shared list may not have caught up with your latest move yet)
  const everyRoach = useMemo(
    () => [...feedRoaches.filter((r) => !ownIds.has(r.id)), ...(me?.roaches ?? [])],
    [feedRoaches, ownIds, me],
  );
  const byFire = fakeFire ?? fireCount(everyRoach);
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

  /** A clone to a free seat by the fire: a new one, or a move once all of them are out */
  const seatAtFire = async (target: PlaceTarget) => {
    const before = me?.talulah.visited;
    setSendingToFire(true);
    const done = await act((w) => w.placeRoach(target, pickSeat(everyRoach)));
    setSendingToFire(false);
    if (!done) return;
    setPanel(null);
    setSelected(null);
    const m = await loadMe();
    setFocus({ lng: FIRE_AT.lng, lat: FIRE_AT.lat, zoom: FIRE_ZOOM, nonce: Date.now() });
    setToast("你的克隆体在火边坐下了。");
    await welcomeAtFire(before, m, true);
  };

  /** 派一只克隆体去烤火 */
  const sendToFire = async () => {
    if (!me) return setPanel({ kind: "login", reason: "登录后就能过来烤火。" });
    if (me.roaches.filter((r) => r.slot > 0).length < MAX_CLONES) return seatAtFire({ kind: "clone" });
    if (me.movesLeft <= 0) return setToast(`每天最多挪 ${MOVES_PER_DAY} 次窝，今天的用完了，明天再挪吧。`);
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
  const riders = roaches.filter((r) => r.ride).length + (myRider ? 1 : 0) + fakeQueue.length;

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
    setToast("你的克隆体跟上了明河，7 站以后回来。");
  };

  /** 派一只克隆体跟他走 */
  const sendRider = () => {
    if (!me) return setPanel({ kind: "login", reason: "登录后就能跟他走。" });
    if (me.roaches.filter((r) => r.slot > 0).length < MAX_CLONES) return rideWith({ kind: "clone" });
    if (me.movesLeft <= 0) return setToast(`每天最多挪 ${MOVES_PER_DAY} 次窝，今天的用完了，明天再挪吧。`);
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
    setToast(`你的克隆体在${stationOf(stop).name}下了马。`);
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
    if (!perlicaShown) return;
    setFocus({ lng: perlicaShown.lng, lat: perlicaShown.lat, zoom: 13, nonce: Date.now() });
    setSelected({ kind: "other", roach: perlicaRoach(perlicaShown, Boolean(me?.perlica.friend)) });
  };
  /** Why the map cannot show one of them now: only 佩丽卡监督, who lives by your main roach once the tutorial is over */
  const guideAway = (id: GuideId) =>
    id !== PERLICA_ID || perlicaShown
      ? null
      : !me
        ? "登录并放下蟑螂本体以后，她会住到你附近。"
        : !main
          ? "放下蟑螂本体以后，她会住到你附近。"
          : "做完新手教程以后，她会住到你附近。";

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
      if (open || busy) setToast("阿米娅向导跟你打了个招呼，点「消息」看看。");
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
    if (!quiet) setToast(badge ? "戴上了，别人在你的资料卡上会看到它。" : "取下了。");
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
  const mapProps = {
    roaches: fakeQueue.length ? [...shownRoaches, ...fakeQueue] : shownRoaches,
    guides,
    trail,
    shouts,
    overlays: partyOverlays,
    // while one of your roaches acts out a scene over the map (摄入酒精, a shout), the map leaves it out
    mine: (me?.roaches ?? []).filter((r) => (!acting || r.slot > 0) && r.id !== shouting?.roach),
    mineAsleep: Boolean(me?.drunkUntil),
    // where the roach would go: a visitor's pick, or the spot a card is asking about
    ghost: me ? (panel?.kind === "placeConfirm" ? panel.spot : null) : preview,
    myAvatar,
    myColor,
    look,
    initialView: viewRef.current,
    placing: Boolean(placing),
    focus,
    onMapClick,
    onRoachClick,
    onMineClick,
    onViewChange,
    onError: setToast,
    // mainland China: our own map instead, without the cover, if it is there to fall back on
    onFailed: cn
      ? () => {
          if (overseas) {
            setToast("高德底图没加载出来，先换成我们自己的底图。");
            setAmapFailed(true);
          } else {
            setToast("高德底图没加载出来，先换成 OSM 底图。");
            setBasemap("osm");
          }
        }
      : undefined,
  };

  const renderPanel = (p: Panel) => {
    if (p.kind === "login") return <LoginSheet reason={p.reason} onDone={signedIn} onClose={() => setPanel(null)} />;
    if (p.kind === "hot") return <HotSheet onClose={() => setPanel(null)} />;
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
          onSignIn={() => setPanel({ kind: "login", reason: "登录后就能看完整的方舟雷达。" })}
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
            // not while the tutorial runs, as she does not show up before it is over
            perlicaTimer={step ? undefined : me.perlica.timer}
            onPerlicaTimer={switchPerlicaTimer}
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
            from="离火"
            onPick={(r) => seatAtFire({ kind: "move", roachId: r.id })}
            onClose={() => setPanel(null)}
          />
        );
      case "mingheIntro":
        return <MingheIntroSheet station={stationOf(day).name} onGo={showMinghe} onLater={() => setPanel(null)} />;
      case "mingheMove":
        return (
          <CloneMoveSheet
            clones={me.roaches.filter((r) => r.slot > 0)}
            movesLeft={me.movesLeft}
            to={mingheAt}
            from="离他"
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
            drunk={Boolean(me.drunkUntil)}
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
            friendly={inboxFriendly}
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
            onOpen={(friendId) => setPanel({ kind: "friend", friendId, back: p })}
            onClose={() => setPanel(null)}
          />
        );
      case "friend": {
        const friend = shownFriends.find((f) => f.id === p.friendId);
        if (!friend) return null;
        return (
          <FriendView
            friend={friend}
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
            from="离 TA"
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
            onPerlicaMore={perlicaMore}
            onClose={() => setPanel(null)}
          />
        );
    }
  };

  return (
    <main className={`app ${basemap === "amap" && !amapFailed && !(twoMaps && abroad) ? "on-amap" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <RoachIcon color={myColor} size={28} avatar={myAvatar} look={look} />
          <span>{SITE_NAME}</span>
          <span className="tag">内测版</span>
        </div>
        <div className="switches">
          {/* 写实 is off for now (src/lib/look.ts) */}
          {REAL_LOOK_OFFERED && (
            <div className="basemap-switch" role="group" aria-label="蟑螂外观">
              <button className={look === "cartoon" ? "on" : ""} onClick={() => switchLook("cartoon")}>
                卡通
              </button>
              <button className={look === "real" ? "on" : ""} onClick={() => switchLook("real")}>
                写实
              </button>
            </div>
          )}
          {/* mainland China has Amap only */}
          {!cn && (
            <div className="basemap-switch" role="group" aria-label="底图">
              <button
                className={basemap === "amap" ? "on" : ""}
                onClick={() => switchBasemap("amap")}
                disabled={!amapConfigured}
                title={amapConfigured ? "国内底图" : "没有配置高德 Key"}
              >
                高德
              </button>
              <button className={basemap === "osm" ? "on" : ""} onClick={() => switchBasemap("osm")}>
                OSM
              </button>
            </div>
          )}
        </div>
      </header>

      {!placing && (
        <div className="hud">
          {identities.length > 0 && (
            <button className="who" onClick={() => setPanel({ kind: "identity" })} title="切换测试身份">
              👤 {current?.label ?? "我"}
              {othersUnseen > 0 && <span className="badge">{othersUnseen}</span>}
            </button>
          )}
          <div className="stats">
            {visible === null ? "地图加载中…" : `这片地图里有 ${visible.toLocaleString()} 只舟P`}
            <span className="muted"> · 全球 {total.toLocaleString()} 只</span>
          </div>
        </div>
      )}

      {!placing && (
        <button className="radar-btn" onClick={me ? openRadar : () => setPanel({ kind: "guestRadar" })}>
          <span className="radar-scope mini" aria-hidden="true">
            <span className="radar-sweep" />
          </span>
          <small>方舟雷达</small>
        </button>
      )}
      {!placing && (
        <GuideDock
          onOpen={(id) => {
            setSelected(null);
            setPanel({ kind: "guide", id });
          }}
        />
      )}
      {!placing && (
        <button className="hot-btn" aria-label="本周舟P热榜" onClick={() => setPanel({ kind: "hot" })}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path
              d="M12 2.5c.8 3.2 4.6 5.4 4.6 10a4.6 4.6 0 0 1-9.2 0c0-2.3 1.1-3.8 2.4-5 .1 1.9.9 3 2 3.4-.7-2.9-.6-5.5.2-8.4Z"
              fill="#ffd23f"
            />
            <path d="M12 21.6a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.3-2.4 2.1-3.6.4 1.2 1.6 1.8 2.3 2.6.5.6.8 1.1.8 1.8a2.6 2.6 0 0 1-2.6 2.6Z" fill="#ff8a3d" />
          </svg>
          <small>热榜</small>
        </button>
      )}

      <div className="map-wrap" ref={wrapRef}>
        {basemap === "amap" && !amapFailed && amapMade && (
          <div className={`map-slot ${twoMaps && abroad ? "map-hidden" : ""}`}>
            <AmapView
              key="amap"
              {...mapProps}
              active={!(twoMaps && abroad)}
              jump={amapJump}
              onViewChange={twoMaps ? (abroad ? ignoreView : onAmapView) : onViewChange}
              onReady={onAmapReady}
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
              slowNote="地图加载很慢，稍等一下。"
              active={abroad}
              jump={overseasJump}
              onViewChange={abroad ? onOverseasView : ignoreView}
              onReady={onOverseasReady}
            />
          </div>
        )}
        {basemap === "amap" && amapFailed && overseas && (
          <MaplibreView key="fallback" {...mapProps} style={overseas.style} slowNote="地图加载很慢，稍等一下。" />
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

      {!placing && selected?.kind === "other" && (
        <OtherRoachCard
          roach={selected.roach}
          look={look}
          signedIn={Boolean(me)}
          onSignIn={() =>
            setPanel({
              kind: "login",
              reason: selected.roach.guide
                ? `登录后就能碰${guideById(selected.roach.id)?.pronoun ?? "她"}。`
                : "登录后就能伸出触须碰 TA。",
            })
          }
          sharesUid={Boolean(me?.profile.shareUid && me.profile.games.some((g) => me.profile.uid[g]))}
          friendName={selectedFriend?.profile.displayName}
          pokeAgainAt={selectedFriend?.pokeAgainAt ?? null}
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
          onClose={() => {
            setSelected(null);
            runAfterReport();
          }}
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

      {!placing && !selected && !panel && !me && preview && around && (
        <PreviewCard
          around={around}
          onPlace={() => setPanel({ kind: "login", reason: "登录后就能把蟑螂放在这里。" })}
          onClose={() => setPreview(null)}
        />
      )}
      {coachShown && me && step && (
        <TutorialCoach
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

      {!placing && !me && (
        <footer className="actions">
          <button className="primary" onClick={() => setPanel({ kind: "login", reason: "登录后就能放下你的蟑螂。" })}>
            放下我的蟑螂
          </button>
          <button onClick={() => setPanel({ kind: "login" })}>登录</button>
        </footer>
      )}
      {!placing && me && (
        <footer className={`actions${selected ? "" : " beside-dock"}`}>
          {main ? (
            <>
              <button onClick={() => setPanel({ kind: "mine" })}>我的蟑螂</button>
              <button className="primary" onClick={() => setPanel({ kind: "declare" })}>
                独立宣言
              </button>
            </>
          ) : (
            <button className="primary" onClick={() => startPlacing({ kind: "main" })}>
              放下我的蟑螂
            </button>
          )}
        </footer>
      )}
      {/* hidden while a roach card fills the bottom of the screen */}
      {!placing && !selected && me && (
        <div className="me-dock">
          {/* your own cartoon look as the profile picture, whichever style the map shows */}
          <button className="dock-me" onClick={() => setPanel({ kind: "profile" })}>
            <span ref={dockAvRef} className={`dock-av ${dockAnim ?? ""}`}>
              <RoachIcon color={me.profile.color} size={38} avatar={me.profile.avatar} />
            </span>
            <span className="dock-name">{me.profile.anonymous || !me.profile.name.trim() ? "匿名" : displayName(me.profile)}</span>
          </button>
          <button ref={dockMailRef} className="dock-mail" aria-label={unseen ? `消息，${unseen} 条未读` : "消息"} onClick={() => openInbox(false)}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 7.5 12 13l8-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            {unseen > 0 && <span className={`badge ${badgePop ? "ta-dbadge" : ""}`}>{unseen}</span>}
          </button>
          <button
            className="dock-friends"
            onClick={() => {
              setSelected(null);
              setPanel({ kind: "friends" });
              loadFriends().catch(() => {});
            }}
          >
            <FriendsMark size={28} />
            <span className="dock-name">触须之交</span>
          </button>
        </div>
      )}
      {dockScene && <DockFx kind={dockScene.kind} from={dockScene.from} at={dockScene.at} onDone={dockScene.done} />}
      {vialAt && <SanityFly from={vialAt} onDone={() => setVialAt(null)} />}
      {arcs && <DockArcs key={arcs.nonce} at={arcs.at} />}
      {party && createPortal(<PartyScene key={party.key} avatar={myAvatar} color={myColor} music={party.music} onDone={endParty} />, party.el)}
      {!placing && !selected && <HeardBubbles list={heard} onReply={heardReply} onOk={heardOk} />}

      {panel && renderPanel(panel)}
      {newBadges[0] && (
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
      {toast && <div className={`toast ${coachShown || selected || heard.length ? "high" : ""}`}>{toast}</div>}
      <p className="disclaimer">
        非官方同人项目 · 与鹰角网络无关 ·{" "}
        <a href="/privacy#contact" target="_blank" rel="noreferrer">
          联系与举报
        </a>
      </p>
    </main>
  );
}
