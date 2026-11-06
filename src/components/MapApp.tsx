"use client";

import dynamic from "next/dynamic";
import type { StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AMIYA_AMAP_ZOOM, AMIYA_AT, AMIYA_ID, amiyaLine, amiyaRoach, localDay } from "@/lib/amiya";
import { deleteAccount, reconsent, signOut } from "@/lib/authClient";
import { loadAMap } from "@/lib/amap";
import type { EarnedBadge } from "@/lib/badges";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/shapes";
import { GUIDES, guideById, type GuideId } from "@/lib/guides";
import type { Declaration, Reaction, Template } from "@/lib/declarations";
import type { Place } from "@/lib/geocode";
import { loadLook, saveLook } from "@/lib/look";
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
import { musicOn, playMusic, setMusicOn, stopMusic } from "./app/amiyaMusic";
import { BadgeWall, NewBadge } from "./app/Badges";
import CloneMoveSheet from "./app/CloneMoveSheet";
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
  type InboxTab,
} from "./app/InboxSheet";
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
import { MyRoachCard, OtherRoachCard } from "./app/RoachCards";
import {
  loadProgress,
  nearestReal,
  saveProgress,
  TutorialCoach,
  tutorialStep,
  type Progress,
} from "./app/Tutorial";
import { BIKE_MS } from "./map/guideMarker";
import type { GuideMark } from "./map/types";
import RoachIcon from "./RoachIcon";

const MaplibreView = dynamic(() => import("./map/MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./map/AmapView"), { ssr: false });

const CHINA_VIEW: MapView = { lng: 108, lat: 34, zoom: 2.6 };
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
  | { kind: "radar"; radar: Radar | null }
  | { kind: "safety"; target: string; who: string | null; back: Panel | null }
  | { kind: "login"; reason?: string }
  /** 隐私说明更新了; then: what was going to open first */
  | { kind: "consent"; then?: Panel | null }
  /** consent: the player's first roach, so the card asks them to agree its spot is public */
  | { kind: "placeConfirm"; target: PlaceTarget; spot: LngLat; fly: boolean; consent: boolean }
  // open to everyone
  | { kind: "hot" }
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
  // what opens once the scene is over, so nothing pops up over it
  const afterActing = useRef<(() => void) | null>(null);
  // 戳一戳 under way: the 触须之交's roach it plays over, left off the map meanwhile
  const [poking, setPoking] = useState<PublicRoach | null>(null);
  const [pokeSent, setPokeSent] = useState(false);
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
    load()
      .catch((e) => {
        console.error(e);
        setToast("连不上服务器，地图先只显示底图。");
        return { me: null, items: [] as InboxItem[], away: null, friends: [] as Friend[] };
      })
      .then(async ({ me: m, items, away, friends: list }) => {
        const main = m?.roaches.find((r) => r.slot === 0);
        viewRef.current = main ? { lng: main.lng, lat: main.lat, zoom: 11 } : b === "amap" ? CHINA_VIEW : WORLD_VIEW;
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
    const { panel: open, placing: busy } = busyRef.current;
    if (open?.kind === "inbox") await openInbox(false, open.tab, items);
    else if (open || busy) setToast(`${noticeTitle(items)}点「消息」看看。`);
    else await openInbox(true, undefined, items);
  }, [loadInbox, loadFriends, loadMe, loadIdentities, openInbox]);

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
  const shownRoaches = useMemo(() => (poking ? roaches.filter((r) => r.id !== poking.id) : roaches), [roaches, poking]);

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

  /** Put a roach down (agreeing first, from the card) and say so; the first main roach opens the tutorial. */
  const put = async (target: PlaceTarget, p: LngLat, fly: boolean, agree = false) => {
    if (agree && !(await act((w) => w.acceptPublicPlace().then(() => true)))) return;
    const before = me?.talulah.visited;
    // the main roach moving: 佩丽卡监督 rides over from where she stands now
    const mainMoves = Boolean(main && (target.kind === "main" || (target.kind === "move" && target.roachId === main.id)));
    const from = perlicaShown;
    const done = await act((w) => w.placeRoach(target, p));
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
  };

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
    setDrinking(true);
    const done = await act((w) => w.sober().then(() => true));
    setDrinking(false);
    if (!done) return;
    play("wake");
    const [, items] = await Promise.all([loadMe(), loadInbox()]);
    setToast(`醒酒了。${pokedToast(items)}`);
  };

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

  const touch = async (roach: PublicRoach, bold: boolean) => {
    if (roach.guide) return touchGuide(roach.id as GuideId, bold);
    const res = await act((w) => w.touch(roach.id, bold));
    if (!res) return;
    setSelected(null);
    if (res.newFriend) {
      befriendedToast(res.newFriend);
      await Promise.all([loadFriends(), loadInbox()]);
    } else {
      touchedToast(bold);
    }
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

  /** Touch a guide on the map: she touches back at once, and says so over her head a moment later. */
  const touchGuide = async (id: GuideId, bold: boolean) => {
    const res = await act((w) => w.touch(id, bold));
    if (!res?.guide) return;
    setSelected(null);
    if (res.newFriend) befriendedToast(res.newFriend);
    else touchedToast(bold);
    if (id === AMIYA_ID && step === "touch") updateProgress({ practiced: true });
    if (res.newFriend) await Promise.all([loadFriends(), loadMe()]);
    const { itemId } = res.guide;
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
        setToast(`${GUIDES[id].name}碰回了你，点「消息」看看。`);
      }
      await loadInbox();
      runAfterReport();
    }, 1500);
  };

  /** Touch back one of 阿米娅向导's touches from a card, where her answer shows at once and so counts as seen. Resolves to her line. */
  const touchBackAmiya = async (item: AmiyaItem, bold: boolean) => {
    const res = await act((w) => w.reply(item.id, bold));
    if (!res?.guide) return null;
    await worldRef.current!.markSeen([item.id, res.guide.itemId]).catch(() => {});
    if (res.newFriend) befriendedToast(res.newFriend);
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

  const react = async (itemId: string, reaction: Reaction) => {
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
    // a guide answers at once: her touch is now at the top of 收到的触碰
    else if (res.guide) setToast(`${GUIDES[res.guide.id].name}碰回了你。`);
    else repliedToast(bold);
    if (res.guide) say(res.guide.id, guideLine(res.guide));
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

  const declare = async (d: Declaration, from: string[]) => {
    const res = await act((w) => w.declare(d, from));
    if (!res) return false;
    setToast(`宣言发出去了！${res.reach}`);
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
    },
    { id: TALULAH_ID, at: FIRE_AT, friend: Boolean(me?.talulah.friend), bubble: says.talulah ?? null, fire },
    {
      id: MINGHE_ID,
      at: mingheAt,
      friend: Boolean(me?.minghe.friend),
      bubble: says.minghe ?? null,
      ride: { ahead: (queueBearing(day) + 180) % 360 },
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
          },
        ]
      : []),
  ];
  const mapProps = {
    roaches: fakeQueue.length ? [...shownRoaches, ...fakeQueue] : shownRoaches,
    guides,
    trail,
    // while the main roach acts out a scene over the map, the map leaves it out
    mine: (me?.roaches ?? []).filter((r) => !acting || r.slot > 0),
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
      case "friend": {
        const friend = shownFriends.find((f) => f.id === p.friendId);
        if (!friend) return null;
        return (
          <FriendView
            friend={friend}
            onFind={(i) => findFriendRoach(friend.roaches[i])}
            onUnfriend={() => unfriend(friend)}
            onSafety={() => setPanel({ kind: "safety", target: `friend:${friend.id}`, who: friend.profile.displayName, back: p })}
            onBack={p.back ? () => setPanel(p.back) : undefined}
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
          <div className="basemap-switch" role="group" aria-label="蟑螂外观">
            <button className={look === "cartoon" ? "on" : ""} onClick={() => switchLook("cartoon")}>
              卡通
            </button>
            <button className={look === "real" ? "on" : ""} onClick={() => switchLook("real")}>
              写实
            </button>
          </div>
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

      <div className="map-wrap">
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
          basemap={basemap}
          view={viewRef.current}
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
        <footer className="actions">
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
            <RoachIcon color={me.profile.color} size={38} avatar={me.profile.avatar} />
            <span className="dock-name">{me.profile.anonymous || !me.profile.name.trim() ? "匿名" : displayName(me.profile)}</span>
          </button>
          <button className="dock-mail" aria-label={unseen ? `消息，${unseen} 条未读` : "消息"} onClick={() => openInbox(false)}>
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 7.5 12 13l8-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            {unseen > 0 && <span className="badge">{unseen}</span>}
          </button>
        </div>
      )}

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
      {toast && <div className={`toast ${coachShown || selected ? "high" : ""}`}>{toast}</div>}
      <p className="disclaimer">
        非官方同人项目 · 与鹰角网络无关 ·{" "}
        <a href="/privacy#contact" target="_blank" rel="noreferrer">
          联系与举报
        </a>
      </p>
    </main>
  );
}
