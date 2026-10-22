"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAccount, signOut } from "@/lib/authClient";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/coords";
import type { Declaration, Reaction } from "@/lib/declarations";
import type { Place } from "@/lib/geocode";
import { loadLook, saveLook } from "@/lib/look";
import type { Profile, PublicProfile } from "@/lib/profile";
import { SITE_NAME } from "@/lib/rules";
import type { Basemap, LngLat, MapFocus, MapView, RoachStyle } from "@/lib/types";
import { ServerWorld } from "@/lib/world/server";
import {
  SignInNeeded,
  WorldError,
  type Friend,
  type Identity,
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type PublicRoach,
  type Radar,
  type World,
} from "@/lib/world/types";
import DeclareSheet from "./app/DeclareSheet";
import IdentitySheet from "./app/IdentitySheet";
import InboxSheet, { firstTab, FriendView, noticeTitle, ProfileView, type InboxTab } from "./app/InboxSheet";
import LoginSheet from "./app/LoginSheet";
import MineSheet from "./app/MineSheet";
import PlaceBar from "./app/PlaceBar";
import ProfileSheet from "./app/ProfileSheet";
import RadarSheet from "./app/RadarSheet";
import { MyRoachCard, OtherRoachCard } from "./app/RoachCards";
import RoachIcon from "./RoachIcon";

const MaplibreView = dynamic(() => import("./map/MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./map/AmapView"), { ssr: false });

const CHINA_VIEW: MapView = { lng: 108, lat: 34, zoom: 2.6 };
const WORLD_VIEW: MapView = { lng: 100, lat: 25, zoom: 1.2 };

type Panel =
  | { kind: "profile" }
  | { kind: "mine" }
  | { kind: "declare" }
  | { kind: "identity" }
  /** items is a snapshot taken on open, so new ones stay highlighted after they are marked seen */
  | { kind: "inbox"; notice: boolean; items: InboxItem[]; tab: InboxTab }
  | { kind: "viewProfile"; profile: PublicProfile; back: Panel }
  | { kind: "friend"; friendId: string; back: Panel | null }
  | { kind: "radar"; radar: Radar | null }
  | { kind: "login"; reason?: string };

type Selection = { kind: "other"; roach: PublicRoach } | { kind: "mine"; roach: OwnRoach };

type Placing = { target: PlaceTarget; label: string };

const PLACING_LABEL: Record<PlaceTarget["kind"], string> = {
  main: "点地图放下你的蟑螂本体",
  clone: "点地图放一只克隆体",
  move: "点地图给它挪个窝",
};

export default function MapApp() {
  const worldRef = useRef<World | null>(null);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [look, setLook] = useState<RoachStyle>("cartoon");
  const [me, setMe] = useState<Me | null>(null);
  const [roaches, setRoaches] = useState<PublicRoach[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [visible, setVisible] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const viewRef = useRef<MapView>(WORLD_VIEW);
  const boundsRef = useRef<[LngLat, LngLat] | null>(null);

  const load = useCallback(async () => {
    const w = worldRef.current!;
    const [m, rs, items, ids, fs] = await Promise.all([w.me(), w.roaches(), w.inbox(), w.identities(), w.friends()]);
    setMe(m);
    setRoaches(rs);
    setInbox(items);
    setIdentities(ids);
    setFriends(fs);
    return { me: m, items };
  }, []);

  const openInbox = useCallback(async (notice: boolean, tab?: InboxTab) => {
    const w = worldRef.current!;
    const items = await w.inbox();
    setPanel({ kind: "inbox", notice, items, tab: tab ?? firstTab(items) });
    const unseen = items.filter((i) => !i.seen).map((i) => i.id);
    if (unseen.length) {
      await w.markSeen(unseen);
      setInbox(await w.inbox());
      setIdentities(await w.identities());
    }
  }, []);

  // The world, basemap and look are read in the browser only, to keep SSR output stable
  useEffect(() => {
    worldRef.current = new ServerWorld();
    const b = guessBasemap();
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
      // What arrived since the last visit
      if (items.some((i) => !i.seen)) openInbox(true);
    });
  }, [load, openInbox]);

  // Other players act on other devices: catch up when the page comes back into view
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && worldRef.current) load().catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    const t = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(t);
    };
  }, [load]);

  // While the page is open, the server says when something new arrives: show it unless the player is busy
  const busyRef = useRef<{ panel: Panel | null; placing: boolean }>({ panel: null, placing: false });
  useEffect(() => {
    busyRef.current = { panel, placing: Boolean(placing) };
  }, [panel, placing]);
  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    const events = new EventSource("/api/events");
    events.addEventListener("inbox", async () => {
      try {
        const { items } = await load();
        if (!items.some((i) => !i.seen)) return;
        const { panel: open, placing: busy } = busyRef.current;
        if (open?.kind === "inbox") await openInbox(false, open.tab);
        else if (open || busy) setToast(`${noticeTitle(items)}点「消息」看看。`);
        else await openInbox(true);
      } catch {}
    });
    return () => events.close();
  }, [meId, load, openInbox]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

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

  /** Run a world call; refusals become a toast. Resolves to undefined on failure. */
  async function act<T>(fn: (w: World) => Promise<T>, ok?: string): Promise<T | undefined> {
    try {
      const result = await fn(worldRef.current!);
      if (ok) setToast(ok);
      return result;
    } catch (e) {
      if (e instanceof SignInNeeded) setPanel({ kind: "login", reason: "登录后才能这样做。" });
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
    setPanel(null);
    setSelected(null);
    setPlacing({ target, label: PLACING_LABEL[target.kind] });
  };

  const placeAt = async (p: LngLat, fly: boolean) => {
    if (!placing) return;
    const done = await act((w) => w.placeRoach(placing.target, p));
    if (!done) return;
    setPlacing(null);
    await load();
    if (fly) setFocus({ lng: p.lng, lat: p.lat, zoom: 13, nonce: Date.now() });
    setToast(
      placing.target.kind === "clone"
        ? "克隆体放好啦！别人看到的是“某舟p的克隆体”，看不出它和你本体的关系。"
        : "放好啦！别人能看到它在这里，但看不出是你。",
    );
  };

  const onMapClick = (p: LngLat) => {
    if (placing) placeAt(p, false);
    else setSelected(null);
  };

  const onRoachClick = (id: string) => {
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

  const find = (r: OwnRoach) => {
    setPanel(null);
    setFocus({ lng: r.lng, lat: r.lat, zoom: 12, nonce: Date.now() });
  };

  const remove = async (r: OwnRoach) => {
    if (!window.confirm(r.slot === 0 ? "收回蟑螂本体？克隆体也会一起收回。" : "收回这只克隆体？")) return;
    const done = await act((w) => w.removeRoach(r.id), r.slot === 0 ? "已经收回你的蟑螂和克隆体。" : "已经收回这只克隆体。");
    if (!done) return;
    setSelected(null);
    await load();
  };

  const befriendedToast = (name: string) =>
    setToast(`你们互相大胆碰过了，和 ${name} 成为了触须之交！在「消息 → 触须之交」里能看到 TA。`);

  const touch = async (roach: PublicRoach, bold: boolean) => {
    const res = await act((w) => w.touch(roach.id, bold));
    if (!res) return;
    setSelected(null);
    if (res.newFriend) {
      befriendedToast(res.newFriend);
      await load();
    } else {
      setToast(bold ? "大胆地伸出了触须！TA 下次打开地图时会看到你的资料。" : "偷偷碰了一下！TA 只会知道被一只蟑螂碰了。");
      setIdentities(await worldRef.current!.identities());
    }
  };

  const keepSnapshot = (items: InboxItem[]) =>
    setPanel((p) =>
      p?.kind === "inbox"
        ? { ...p, items: items.map((i) => ({ ...i, seen: p.items.find((x) => x.id === i.id)?.seen ?? i.seen })) }
        : p,
    );

  const react = async (itemId: string, reaction: Reaction) => {
    const done = await act((w) => w.react(itemId, reaction).then(() => true));
    if (!done) return;
    setToast("回应发出去了！");
    keepSnapshot((await load()).items);
  };

  const reply = async (itemId: string, bold: boolean) => {
    const res = await act((w) => w.reply(itemId, bold));
    if (!res) return;
    if (res.newFriend) befriendedToast(res.newFriend);
    else setToast(bold ? "大胆地碰回去了！" : "偷偷碰回去了。");
    keepSnapshot((await load()).items);
  };

  const openRadar = async () => {
    setSelected(null);
    setPanel({ kind: "radar", radar: await worldRef.current!.radar() });
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
    await load();
    await openInbox(false, "friends");
  };

  const saveProfile = async (p: Profile) => {
    const saved = await act((w) => w.saveProfile(p), "资料存好了。");
    if (saved) await load();
    return Boolean(saved);
  };

  const declare = async (d: Declaration, from: string[]) => {
    const res = await act((w) => w.declare(d, from));
    if (!res) return false;
    setToast(`宣言发出去了！${res.reach}`);
    await load();
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
    if (items.some((i) => !i.seen)) openInbox(true);
    else setToast("切换好了，现在用这个身份看地图。");
  };

  const signedIn = async () => {
    setPanel(null);
    const { me: m, items } = await load();
    const mainRoach = m?.roaches.find((r) => r.slot === 0);
    if (mainRoach) setFocus({ lng: mainRoach.lng, lat: mainRoach.lat, zoom: 11, nonce: Date.now() });
    if (items.some((i) => !i.seen)) openInbox(true);
    else setToast(m && !mainRoach ? "登录好了！先放下你的蟑螂吧。" : "登录好了！");
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
    await load();
    setToast(kind === "delete" ? "账号和数据都删除了。" : "已经退出登录。");
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
  const unseen = inbox.filter((i) => !i.seen).length;
  const current = identities.find((i) => i.current);
  const othersUnseen = identities.filter((i) => !i.current).reduce((n, i) => n + i.unseen, 0);
  const selectedFriend =
    selected?.kind === "other" && selected.roach.friend
      ? friends.find((f) => f.roaches.some((r) => r.id === selected.roach.id))
      : undefined;
  const total = roaches.length + (me?.roaches.length ?? 0);
  const inboxButton = (
    <button onClick={() => openInbox(false)}>
      消息{unseen > 0 && <span className="badge">{unseen}</span>}
    </button>
  );

  const mapProps = {
    roaches,
    mine: me?.roaches ?? [],
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
  };

  const renderPanel = (p: Panel) => {
    if (p.kind === "login") return <LoginSheet reason={p.reason} onDone={signedIn} onClose={() => setPanel(null)} />;
    if (!me) return null;
    switch (p.kind) {
      case "profile":
        return (
          <ProfileSheet
            profile={me.profile}
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
      case "declare":
        return (
          <DeclareSheet
            profile={me.profile}
            roaches={me.roaches}
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
            onTab={(tab) => setPanel({ ...p, tab, notice: false })}
            onReply={reply}
            onReact={react}
            onViewProfile={(profile) => setPanel({ kind: "viewProfile", profile, back: p })}
            onOpenFriend={(friendId) => setPanel({ kind: "friend", friendId, back: { ...p, tab: "friends" } })}
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
            onBack={p.back ? () => setPanel(p.back) : undefined}
            onClose={() => setPanel(null)}
          />
        );
      }
      case "viewProfile":
        return <ProfileView profile={p.profile} onBack={() => setPanel(p.back)} onClose={() => setPanel(null)} />;
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
    <main className="app">
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
            {visible === null ? "地图加载中…" : `这片地图里有 ${visible.toLocaleString()} 只舟p`}
            <span className="muted"> · 全球 {total.toLocaleString()} 只</span>
          </div>
        </div>
      )}

      {!placing && me && (
        <button className="radar-btn" onClick={openRadar}>
          <span className="radar-scope mini" aria-hidden="true">
            <span className="radar-sweep" />
          </span>
          <small>方舟雷达</small>
        </button>
      )}

      <div className="map-wrap">
        {basemap === "amap" && <AmapView key="amap" {...mapProps} />}
        {basemap === "osm" && <MaplibreView key="osm" {...mapProps} />}
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
          onMove={() => startPlacing({ kind: "move", roachId: selected.roach.id })}
          onRemove={() => remove(selected.roach)}
          onClose={() => setSelected(null)}
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
              {inboxButton}
              <button onClick={() => setPanel({ kind: "profile" })}>资料</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => startPlacing({ kind: "main" })}>
                放下我的蟑螂
              </button>
              {inboxButton}
              <button onClick={() => setPanel({ kind: "profile" })}>资料</button>
            </>
          )}
        </footer>
      )}

      {panel && renderPanel(panel)}
      {toast && <div className="toast">{toast}</div>}
      <p className="disclaimer">非官方同人项目 · 与鹰角网络无关</p>
    </main>
  );
}
