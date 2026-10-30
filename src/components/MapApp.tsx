"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteAccount, reconsent, signOut } from "@/lib/authClient";
import type { EarnedBadge } from "@/lib/badges";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/coords";
import type { Declaration, Reaction, Template } from "@/lib/declarations";
import type { Place } from "@/lib/geocode";
import { loadLook, saveLook } from "@/lib/look";
import { displayName, type Profile, type PublicProfile } from "@/lib/profile";
import { MOVES_PER_DAY, SITE_NAME } from "@/lib/rules";
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
  type PlaceTarget,
  type PublicRoach,
  type Radar,
  type World,
} from "@/lib/world/types";
import { BadgeWall, NewBadge } from "./app/Badges";
import ConsentSheet, { PlaceConfirm } from "./app/ConsentSheet";
import DeclareSheet from "./app/DeclareSheet";
import { GuestRadarSheet, markWelcomed, PreviewCard, roachesAround, WelcomeSheet, welcomed } from "./app/GuestPreview";
import { HomecomingSheet } from "./app/Homecoming";
import HotSheet from "./app/HotSheet";
import { keepInstallPrompt } from "./app/HomeScreen";
import IdentitySheet from "./app/IdentitySheet";
import InboxSheet, { firstTab, FriendView, noticeTitle, ProfileView, tabOf, type InboxTab } from "./app/InboxSheet";
import LoginSheet, { pendingLogin } from "./app/LoginSheet";
import MineSheet from "./app/MineSheet";
import PlaceBar from "./app/PlaceBar";
import ProfileSheet from "./app/ProfileSheet";
import RadarSheet from "./app/RadarSheet";
import SafetySheet from "./app/SafetySheet";
import RoachActor from "./app/RoachActor";
import { MyRoachCard, OtherRoachCard } from "./app/RoachCards";
import {
  guideRoach,
  guideTouchBack,
  isGuideItem,
  loadProgress,
  nearestReal,
  saveProgress,
  TutorialCoach,
  tutorialStep,
  type Progress,
} from "./app/Tutorial";
import RoachIcon from "./RoachIcon";

const MaplibreView = dynamic(() => import("./map/MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./map/AmapView"), { ssr: false });

const CHINA_VIEW: MapView = { lng: 108, lat: 34, zoom: 2.6 };
const WORLD_VIEW: MapView = { lng: 100, lat: 25, zoom: 1.2 };

type Panel =
  /** draft: unsaved changes kept while 我的称号 was open */
  | { kind: "profile"; draft?: Profile }
  | { kind: "badges"; draft: Profile }
  | { kind: "homecoming"; homecoming: Homecoming; items: InboxItem[] }
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
  // The guide roach's messages exist in this page only
  const [guideItems, setGuideItemsState] = useState<InboxItem[]>([]);
  const guideItemsRef = useRef<InboxItem[]>([]);
  const setGuideItems = useCallback((items: InboxItem[]) => {
    guideItemsRef.current = items;
    setGuideItemsState(items);
  }, []);
  const [greeting, setGreeting] = useState(false);
  // 摄入酒精 / 醒酒 played out by your main roach, big, in the middle of the map
  const [acting, setActing] = useState<"drink" | "wake" | null>(null);
  // what opens once the scene is over, so nothing pops up over it
  const afterActing = useRef<(() => void) | null>(null);
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
  const loadFriends = useCallback(async () => setFriends(await worldRef.current!.friends()), []);
  const loadIdentities = useCallback(async () => {
    const ids = await worldRef.current!.identities();
    demoRef.current = ids.length > 0;
    setIdentities(ids);
  }, []);

  /** Everything, for opening the page and switching who is signed in. */
  const load = useCallback(async () => {
    // the roaches have their own retries, so a busy roach list never holds up the rest
    const [m, items] = await Promise.all([
      loadMe(),
      loadInbox(),
      loadRoaches().catch(() => {}),
      loadFriends(),
      loadIdentities(),
    ]);
    return { me: m, items };
  }, [loadMe, loadInbox, loadRoaches, loadFriends, loadIdentities]);

  // Opening a tab is enough to count its messages as read; the red counts go with it
  const markTabSeen = useCallback(
    async (items: InboxItem[], tab: InboxTab) => {
      const unseen = items.filter((i) => !i.seen && tabOf(i) === tab).map((i) => i.id);
      if (!unseen.length) return;
      setGuideItems(guideItemsRef.current.map((i) => (unseen.includes(i.id) ? { ...i, seen: true } : i)));
      const real = unseen.filter((id) => !isGuideItem(id));
      if (!real.length) return;
      await worldRef.current!.markSeen(real);
      setInbox((all) => all.map((i) => (real.includes(i.id) ? { ...i, seen: true } : i)));
      if (demoRef.current) await loadIdentities();
    },
    [loadIdentities, setGuideItems],
  );

  const openInbox = useCallback(
    async (notice: boolean, tab?: InboxTab, fresh?: InboxItem[]) => {
      const items = [...guideItemsRef.current, ...(fresh ?? (await loadInbox()))].sort((a, b) => b.at - a.at);
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
    load()
      .catch((e) => {
        console.error(e);
        setToast("连不上服务器，地图先只显示底图。");
        return { me: null, items: [] as InboxItem[] };
      })
      .then(({ me: m, items }) => {
        const main = m?.roaches.find((r) => r.slot === 0);
        viewRef.current = main ? { lng: main.lng, lat: main.lat, zoom: 11 } : b === "amap" ? CHINA_VIEW : WORLD_VIEW;
        setLook(loadLook());
        setBasemap(b);
        // Back after a day or more: a summary first, which says what is unread (not during the tutorial)
        const home: Panel | null =
          m?.homecoming && !tutorialStep(m, loadProgress(m.id)) ? { kind: "homecoming", homecoming: m.homecoming, items } : null;
        const first = () => {
          // an updated privacy policy before anything else
          if (m?.mustReconsent) setPanel({ kind: "consent", then: home });
          else if (home) setPanel(home);
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
  // the practice roach lives only on this screen, and only during the touch step
  const guide = useMemo(
    () => (step === "touch" && tutorialMain ? guideRoach(tutorialMain) : null),
    [step, tutorialMain],
  );
  useEffect(() => {
    if (!guide && guideItemsRef.current.length) setGuideItems([]);
  }, [guide, setGuideItems]);
  const mapRoaches = useMemo(() => (guide ? [...roaches, guide] : roaches), [roaches, guide]);

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
    const done = await act((w) => w.placeRoach(target, p));
    if (!done) return;
    setPlacing(null);
    const m = await loadMe();
    if (fly) setFocus({ lng: p.lng, lat: p.lat, zoom: 13, nonce: Date.now() });
    setToast(
      target.kind === "move"
        ? `挪好啦！今天还能挪 ${m?.movesLeft ?? 0} 次。`
        : target.kind === "clone"
          ? "克隆体放好啦！等待其他舟P发现中 |ω・）"
          : "放好啦！等待其他舟P发现中 |ω・）",
    );
    if (target.kind === "main") startTutorial(m);
  };

  /** Right after a newcomer's first main roach is down, the tutorial opens on its first step. */
  const startTutorial = (m: Me | null) => {
    if (m && tutorialStep(m, loadProgress(m.id)) === "card") setPanel({ kind: "tutorialCard" });
  };

  const onMapClick = (p: LngLat) => {
    if (placing) return placeAt(p, false);
    setSelected(null);
    // a visitor sees where their roach would go and who is around; nothing is sent
    if (!me) setPreview(p);
  };

  const onRoachClick = (id: string) => {
    const roach = mapRoaches.find((r) => r.id === id);
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
    play("drink");
    const m = await loadMe();
    // the first and the fiftieth pop up as new badges; the rest are counted here
    const drinks = m?.counts.drinks ?? 0;
    if (drinks !== 1 && drinks !== 50) setToast(`又醉倒了，这是第 ${drinks} 次。`);
  };

  const soberUp = async () => {
    setDrinking(true);
    const done = await act((w) => w.sober().then(() => true));
    setDrinking(false);
    if (!done) return;
    play("wake");
    await loadMe();
    setToast("醒酒了。");
  };

  // A drunk roach wakes at 8:00 where it lies; an open page sees it stand up then
  const drunkUntil = me?.drunkUntil;
  useEffect(() => {
    if (!drunkUntil) return;
    const t = window.setTimeout(() => loadMe().catch(() => {}), Math.max(0, drunkUntil - Date.now()) + 1000);
    return () => window.clearTimeout(t);
  }, [drunkUntil, loadMe]);

  const remove = async (r: OwnRoach) => {
    if (!window.confirm(r.slot === 0 ? "收回蟑螂本体？克隆体也会一起收回。" : "收回这只克隆体？")) return;
    const done = await act((w) => w.removeRoach(r.id), r.slot === 0 ? "已经收回你的蟑螂和克隆体。" : "已经收回这只克隆体。");
    if (!done) return;
    setSelected(null);
    await loadMe();
  };

  const befriendedToast = (name: string) =>
    setToast(`你们互相大胆碰过了，和 ${name} 成为了触须之交！在「消息 → 触须之交」里能看到 TA。`);

  const touchedToast = (bold: boolean) =>
    setToast(bold ? "大胆地伸出了触须！TA 将能看到你的资料" : "偷偷碰了一下！TA 只会知道被一只蟑螂碰了。");

  const touch = async (roach: PublicRoach, bold: boolean) => {
    if (roach.guide) return touchGuide(bold);
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

  // Practice with the guide: nothing goes to the server; it touches back a moment later, in this page only
  const touchGuide = (bold: boolean) => {
    setSelected(null);
    touchedToast(bold);
    window.setTimeout(() => {
      setGuideItems([guideTouchBack(), ...guideItemsRef.current]);
      updateProgress({ practiced: true });
      if (busyRef.current.panel || busyRef.current.placing) setToast("向导蟑螂碰回了你，点「消息」看看。");
      else openInbox(true, "touches", inbox);
    }, 1500);
  };

  /** The inbox with the guide roach's in-page messages mixed in, newest first. */
  const withGuide = (items: InboxItem[]) => [...guideItemsRef.current, ...items].sort((a, b) => b.at - a.at);

  const keepSnapshot = (items: InboxItem[]) =>
    setPanel((p) =>
      p?.kind === "inbox"
        ? { ...p, items: items.map((i) => ({ ...i, seen: p.items.find((x) => x.id === i.id)?.seen ?? i.seen })) }
        : p,
    );

  const ignore = async (itemId: string) => {
    if (isGuideItem(itemId)) {
      setGuideItems(guideItemsRef.current.map((i) => (i.id === itemId && i.kind === "touch" ? { ...i, ignored: true } : i)));
      keepSnapshot(withGuide(inbox));
      return setToast("默默爬走了，TA 不会知道。");
    }
    const done = await act((w) => w.ignore(itemId).then(() => true));
    if (!done) return;
    setToast("默默爬走了，TA 不会知道。");
    keepSnapshot(withGuide(await loadInbox()));
  };

  const react = async (itemId: string, reaction: Reaction) => {
    const done = await act((w) => w.react(itemId, reaction).then(() => true));
    if (!done) return;
    setToast("回应发出去了！");
    keepSnapshot(withGuide(await loadInbox()));
  };

  const repliedToast = (bold: boolean) => setToast(bold ? "大胆碰回去了！向 TA 表明你的身份" : "偷偷碰回去了。");

  const reply = async (itemId: string, bold: boolean) => {
    if (isGuideItem(itemId)) {
      setGuideItems(guideItemsRef.current.map((i) => (i.id === itemId ? { ...i, replied: true } : i)));
      keepSnapshot(withGuide(inbox));
      return repliedToast(bold);
    }
    const res = await act((w) => w.reply(itemId, bold));
    if (!res) return;
    if (res.newFriend) befriendedToast(res.newFriend);
    else repliedToast(bold);
    const [items] = await Promise.all([loadInbox(), loadFriends()]);
    keepSnapshot(withGuide(items));
    if (me?.isNew) await loadMe();
    if (demoRef.current) await loadIdentities();
  };

  const openRadar = async () => {
    setSelected(null);
    const radar = await act((w) => w.radar());
    if (radar !== undefined) setPanel({ kind: "radar", radar });
  };

  const findFriendRoach = (roach: PublicRoach) => {
    setPanel(null);
    setFocus({ lng: roach.lng, lat: roach.lat, zoom: 13, nonce: Date.now() });
    setSelected({ kind: "other", roach });
  };

  const unfriend = async (friend: Friend) => {
    if (!window.confirm(`解除和 ${friend.profile.displayName} 的触须之交？`)) return;
    const done = await act((w) => w.unfriend(friend.id).then(() => true), "已经解除触须之交。");
    if (!done) return;
    await loadFriends();
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
    const { me: m, items } = await load();
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
    const { me: m, items } = await load();
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
    setFocus({ lng: roach.lng, lat: roach.lat, zoom: 14, nonce: Date.now() });
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
  const unseen = inbox.filter((i) => !i.seen).length + guideItems.filter((i) => !i.seen).length;
  const around = useMemo(() => (preview ? roachesAround(feedRoaches, preview) : null), [preview, feedRoaches]);
  const nearest = useMemo(
    () => (step === "touch" && tutorialMain ? nearestReal(roaches, tutorialMain) : null),
    [step, tutorialMain, roaches],
  );
  const current = identities.find((i) => i.current);
  const othersUnseen = identities.filter((i) => !i.current).reduce((n, i) => n + i.unseen, 0);
  const selectedFriend =
    selected?.kind === "other" && selected.roach.friend
      ? friends.find((f) => f.roaches.some((r) => r.id === selected.roach.id))
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
  useEffect(() => {
    if (!idle || !unseenBadges || newBadges.length || !me) return;
    setNewBadges(me.badges.filter((b) => !b.seen).slice(0, 3));
    worldRef.current!.seeBadges(unseenBadges.split(",")).catch(() => {});
    // shown now, so a reload of me before the server has caught up does not queue them again
    applyMe({ ...me, badges: me.badges.map((b) => ({ ...b, seen: true })) });
  }, [idle, unseenBadges, newBadges.length, me, applyMe]);

  // quiet from the popup, where the toast would show through
  const wearBadge = async (badge: string | null, quiet = false) => {
    const done = await act((w) => w.wearBadge(badge).then(() => true));
    if (!done) return;
    await loadMe();
    if (!quiet) setToast(badge ? "戴上了，别人在你的资料卡上会看到它。" : "取下了。");
  };

  const mapProps = {
    roaches: mapRoaches,
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
    onFailed: cn
      ? () => {
          setToast("高德底图没加载出来，先换成 OSM 底图。");
          setBasemap("osm");
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
      case "homecoming":
        return (
          <HomecomingSheet
            me={me}
            homecoming={p.homecoming}
            items={p.items}
            onInbox={() => openInbox(false, undefined, p.items)}
            onWelcome={() => setPanel({ kind: "declare", initial: "welcome" })}
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
            friends={friends}
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
        const friend = friends.find((f) => f.id === p.friendId);
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
          <IdentitySheet identities={identities} onBecome={become} onReset={reset} onClose={() => setPanel(null)} />
        );
    }
  };

  return (
    <main className={`app ${basemap === "amap" ? "on-amap" : ""}`}>
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
        {basemap === "amap" && <AmapView key="amap" {...mapProps} />}
        {basemap === "osm" && <MaplibreView key="osm" {...mapProps} />}
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
          onSignIn={() => setPanel({ kind: "login", reason: "登录后就能伸出触须碰 TA。" })}
          sharesUid={Boolean(me?.profile.shareUid && me.profile.games.some((g) => me.profile.uid[g]))}
          friendName={selectedFriend?.profile.displayName}
          onOpenFriend={
            selectedFriend ? () => setPanel({ kind: "friend", friendId: selectedFriend.id, back: null }) : undefined
          }
          onTouch={(bold) => touch(selected.roach, bold)}
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
          busy={drinking || Boolean(acting)}
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
          onOpenCard={() => setPanel({ kind: "tutorialCard" })}
          onCardLater={() => updateProgress({ card: true })}
          onGreet={greet}
          onFindGuide={() => guide && showRoach(guide)}
          onFindNearest={() => nearest && showRoach(nearest)}
          onSkipStep={(s) => updateProgress({ [s]: true })}
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
