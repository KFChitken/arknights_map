"use client";
/* eslint-disable @next/next/no-img-element -- the albums' covers, small JPEGs of our own, which next/image would only copy */

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmt, fmtParts, localPath, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import {
  clock,
  coverLink,
  HEARD_S,
  HOT_DAYS,
  HOT_READ_MS,
  INVITES_PER_DAY,
  LISTEN_FULL,
  RANDOM_ADD,
  RX_ROOM_FROM,
  RX_ROWS,
  songMatches,
  type InviteSent,
  type ListenAlbum,
  type ListenCatalog,
  type ListenFriend,
  type ListenFrom,
  type ListenRoom,
  type ListenTrack,
  type ListenView,
  type RoomMember,
} from "@/lib/listen";
import { DECLARATION_RADIUS_KM, DECLARATIONS_PER_DAY } from "@/lib/rules";
import { INK_FROM } from "@/lib/si";
import { siteDay } from "@/lib/siteDay";
import type { OwnRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { MegaphoneIcon, useWide } from "./chrome/parts";
import type { ListenCallItem, ListenInvite } from "./ListenOverlay";
import {
  callLine,
  hostQueue,
  inviteMore,
  kickMember,
  leaveListen,
  listenFriendsList,
  loadFavs,
  loadHot,
  loadSongs,
  markIntro,
  openRoomWith,
  playNext,
  playTrack,
  roomPlace,
  sendRx,
  setFav,
  setLite,
  setShuffle,
  shufflePlay,
  toggle,
  useListenFavs,
  useListenHasNext,
  useListenHot,
  useListenIntro,
  useListenLite,
  useListenPlayer,
  useListenRoom,
  useListenRoomEnd,
  useListenRx,
  useListenSaid,
  useListenSecond,
  useListenShuffle,
  useListenSongs,
  useListenTouched,
  type ListenFavs,
  type ListenHot,
  type ListenPlayer,
  type ListenSongs,
} from "./listening";
import Sheet from "./Sheet";
import "./listen.css";

/** The panel's two tabs: 一起听, and the songs (方舟) */
export type ListenTab = "together" | "ark";

/** What 一起听 does beyond the songs, and what it needs for it, from the map page (MapApp.tsx) */
export type ListenActs = {
  /** An invitation to you still to answer, and the newest 宣言一起听 you got still open (their cards on the map have them too) */
  invite: ListenInvite | null;
  call: ListenCallItem | null;
  /** Within the tap (it may start a song) */
  onJoin: (invite: ListenInvite) => void;
  onLater: (invite: ListenInvite) => void;
  onJoinCall: (call: ListenCallItem) => void;
  /** Your roaches, and whether 墨小强 is out at 缘缘庄: what a 宣言一起听 may go out from */
  roaches: OwnRoach[];
  ink: boolean;
  /** 发宣言招附近的人 from these (null: your main roach), within the tap: whether it went */
  onDeclare: (from: string[] | null) => Promise<boolean>;
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there */
  onTouch: (h: number, bold: boolean) => Promise<void>;
  /** 拉黑 or 举报 someone in the room (lr:<room>:<number>), by name when their card is open */
  onSafety: (target: string, who: string | null) => void;
};

/**
 * 听歌's panel: its two tabs, the player along its top (♡ to 收藏, ⏭, 随机播放, 省流量), and under it either 一起听
 * (inviting 触须之交, calling those nearby, the room you are in, its 短评, and the card of anyone in it) or the songs, in
 * three lists: 全部 (新歌, then album by album in the order of the Monster Siren Records site, a ♥ by each in your
 * 收藏), your 收藏, and 热播榜; with a search over the songs' and albums' names in the list shown, the list's 随机播放,
 * and above them, while a song plays alone, the first two rows of 短评 (only counted: 大家都在说 under each song, in
 * the player). On a phone a sheet from the bottom; on a computer a panel at the left, over the map but clear of its
 * middle, which can be looked round meanwhile. Songs go on playing with it closed (src/components/app/listening.ts).
 */
export default function ListenPanel({
  paused,
  roomMax,
  mode,
  tab,
  onTab,
  acts,
  onClose,
}: {
  /** The 站长 paused 听歌 for now */
  paused: boolean;
  /** How many a room may hold, and whom you may invite (admins: the 站长 and admins alone) */
  roomMax: number;
  mode: "admins" | "on";
  tab: ListenTab;
  onTab: (tab: ListenTab) => void;
  acts: ListenActs;
  onClose: () => void;
}) {
  const wide = useWide();
  useEffect(() => {
    loadSongs();
    // for the ♡ and the ♥ by the songs
    loadFavs();
    markIntro("opened");
  }, []);
  // the covers' too, once there are some
  const list = useListenSongs();
  const covers = list.state === "ok" && list.catalog.albums.some((a) => a.cover);
  const foot = <p className="lp-foot">{covers ? T.listen.copyrightCovers : T.listen.copyright}</p>;
  const body = <ListenBody paused={paused} roomMax={roomMax} mode={mode} tab={tab} onTab={onTab} acts={acts} />;
  if (!wide) {
    return (
      <Sheet title={T.listen.title} className="listen-sheet" onClose={onClose} footer={foot}>
        {body}
      </Sheet>
    );
  }
  return (
    <FloatPanel onClose={onClose}>
      <div className="lp-scroll">{body}</div>
      {foot}
    </FloatPanel>
  );
}

/** On a computer: not modal, so the map stays to be used; Escape closes it, unless a sheet is open over it */
function FloatPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".sheet-backdrop, .lr-pcard")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section className="listen-float" role="dialog" aria-label={T.listen.title}>
      <header className="lp-head">
        <h2>{T.listen.title}</h2>
        <button className="close" onClick={onClose} aria-label={T.common.close}>
          ×
        </button>
      </header>
      {children}
    </section>
  );
}

type BodyProps = {
  paused: boolean;
  roomMax: number;
  mode: "admins" | "on";
  tab: ListenTab;
  onTab: (tab: ListenTab) => void;
  acts: ListenActs;
};

/** The list of songs shown last (全部, 收藏, 热播榜), for the panel opened again on this page */
let lastView: ListenView = "all";

/**
 * The songs a list shows, in its order (only those found while searching; 收藏's and 热播榜's songs gone from the
 * list left out), how many, and the list a song tapped in it goes on as (全部 unsearched: every song)
 */
function viewSongs(view: ListenView, tracks: Map<string, ListenTrack> | null, favs: ListenFavs, hot: ListenHot, q: string) {
  if (!tracks) return { songs: [] as ListenTrack[], n: 0, from: { view, ids: [] } as ListenFrom };
  if (view === "all" && !q) return { songs: [] as ListenTrack[], n: tracks.size, from: { view, ids: [] } as ListenFrom };
  const ids = view === "all" ? [...tracks.keys()] : view === "fav" ? (favs.state === "ok" ? favs.ids : []) : hot.state === "ok" ? hot.list.map((h) => h.song) : [];
  const songs = ids.map((id) => tracks.get(id)).filter((t): t is ListenTrack => Boolean(t) && songMatches(t!, q));
  return { songs, n: songs.length, from: { view, ids: songs.map((t) => t.id) } as ListenFrom };
}

function ListenBody({ paused, roomMax, mode, tab, onTab, acts }: BodyProps) {
  const list = useListenSongs();
  const intro = useListenIntro();
  const room = useListenRoom();
  const favs = useListenFavs();
  const hot = useListenHot();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ListenView>(lastView);
  const show = (v: ListenView) => {
    lastView = v;
    setView(v);
  };
  // 热播榜 as it is shown (收藏 as the panel opens, for the ♥ and the ♡)
  useEffect(() => {
    if (tab === "ark" && view === "hot") loadHot();
  }, [tab, view]);
  // another tab, or list, starts at its top
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.closest(".sheet-body, .lp-scroll")?.scrollTo({ top: 0 });
  }, [tab, view]);
  // the list follows the typing a moment behind, so the box itself never waits on a long list
  const q = useDeferredValue(query.trim());
  const tracks = list.state === "ok" ? list.tracks : null;
  const shown = useMemo(() => viewSongs(view, tracks, favs, hot, q), [view, tracks, favs, hot, q]);
  const favSet = useMemo(() => new Set(favs.state === "ok" ? favs.ids : []), [favs]);
  const favN = favs.state === "ok" && tracks ? favs.ids.filter((id) => tracks.has(id)).length : null;
  return (
    <div className="lp" ref={box}>
      <div className="lp-top">
        <div className="lp-tabs" role="tablist">
          {(["together", "ark"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => onTab(k)}>
              {T.listen.tabs[k]}
              {k === "together" && room && <span className="dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <Player paused={paused} />
        {intro !== "ok" && <PrivacyLine />}
        {tab === "ark" && list.state === "ok" && list.tracks.size > 0 && (
          <>
            <input
              className="lp-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={T.listen.search}
              aria-label={T.listen.search}
              enterKeyHint="search"
            />
            <div className="lp-views">
              {(["all", "fav", "hot"] as const).map((k) => (
                <button key={k} type="button" className={`lp-view${view === k ? " on" : ""}`} aria-pressed={view === k} onClick={() => show(k)}>
                  {k === "fav" && <HeartIcon />}
                  {k === "fav" && favN !== null ? fmt(T.listen.favCount, { n: favN }) : T.listen.views[k]}
                </button>
              ))}
              {/* in a room the host picks its songs */}
              {!room && (
                <button type="button" className="lp-rnd" title={T.listen.shufflePlayTip} disabled={shown.n === 0} onClick={() => shufflePlay(shown.from)}>
                  <ShuffleIcon />
                  {T.listen.shufflePlay}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {tab === "together" ? (
        <Together paused={paused} roomMax={roomMax} mode={mode} acts={acts} onTab={onTab} />
      ) : list.state === "ok" ? (
        list.tracks.size > 0 ? (
          <>
            {room ? <p className="lp-note small">{room.host ? T.listen.addNote : T.listen.hostPicks}</p> : <AloneRx />}
            {view === "all" ? (
              <SongList key={q} catalog={list.catalog} tracks={list.tracks} query={q} room={room} from={shown.from} favs={favSet} />
            ) : (
              <ViewList view={view} songs={shown.songs} from={shown.from} usual={list.catalog.artists} room={room} favs={favs} hot={hot} favN={favN ?? 0} query={q} />
            )}
          </>
        ) : (
          <p className="lp-note">{T.listen.none}</p>
        )
      ) : list.state === "failed" ? (
        <p className="lp-note">
          {list.message}
          <button className="lp-retry" onClick={loadSongs}>
            {T.listen.retry}
          </button>
        </p>
      ) : (
        <p className="lp-note">{T.listen.loading}</p>
      )}
    </div>
  );
}

/**
 * The song playing (or the last one, or the one to go on with), ♡ (收藏), ▶ or ⏸, ⏭, how far it got, 随机播放 and
 * 省流量, and 大家都在说; before any, a line. In a room the songs are the host's: no ⏭ nor 随机播放.
 */
function Player({ paused }: { paused: boolean }) {
  const v = useListenPlayer();
  const at = useListenSecond();
  const t = v.track;
  const said = useListenSaid(t?.id ?? null);
  // 省流量, once songs have their smaller copies
  const list = useListenSongs();
  const lite = useListenLite();
  const offerLite = list.state === "ok" && list.catalog.lite === true;
  const room = useListenRoom();
  const favs = useListenFavs();
  const shuffle = useListenShuffle();
  const hasNext = useListenHasNext();
  if (!t) {
    const full = v.problem?.code === LISTEN_FULL;
    return (
      <div className={`lp-player empty${full ? " full" : ""}`} role="status">
        {v.problem ? (
          <>
            {v.problem.message}
            {full && (
              <>
                <br />
                {T.listen.fullNote}
              </>
            )}
          </>
        ) : paused ? (
          T.listen.pausedNow
        ) : (
          T.listen.empty
        )}
      </div>
    );
  }
  const on = v.status === "playing" || v.status === "starting";
  const done = t.seconds > 0 ? Math.min(100, (at / t.seconds) * 100) : 0;
  const note = v.problem ? v.problem.message : on && v.buffering ? T.listen.buffering : v.tap ? T.listen.tapToGo : null;
  const fav = favs.state === "ok" && favs.ids.includes(t.id);
  return (
    <div className={`lp-player${room ? "" : " solo"}`}>
      <PlayerCover key={t.album.cover ?? ""} file={t.album.cover} />
      <span className="lp-what">
        <b>{t.name}</b>
        <small>
          {t.album.name} · {t.artists.join(" / ")}
        </small>
        {/* each 短评 kept whole where the line wraps */}
        {said.length > 0 && (
          <small className="lp-said">
            {fmtNodes(T.listen.said, {
              list: said.map((x, i) => (
                <Fragment key={x.r}>
                  {i > 0 && " · "}
                  <span>{fmt(T.listen.saidOne, { text: rxText(x.r), n: x.n.toLocaleString("zh-CN") })}</span>
                </Fragment>
              )),
            })}
          </small>
        )}
      </span>
      <button
        type="button"
        className={`lp-ic fav${fav ? " on" : ""}`}
        aria-pressed={fav}
        aria-label={fmt(fav ? T.listen.unfav : T.listen.fav, { name: t.name })}
        onClick={() => setFav(t.id, !fav)}
      >
        {fav ? <HeartIcon /> : <HeartLineIcon />}
      </button>
      <button className="lp-btn" aria-label={on ? T.listen.pause : T.listen.play} onClick={() => toggle()}>
        {on ? <PauseIcon /> : <PlayIcon />}
      </button>
      {!room && (
        <button type="button" className="lp-ic next" aria-label={T.listen.next} title={T.listen.next} disabled={!hasNext} onClick={() => playNext()}>
          <NextIcon />
        </button>
      )}
      <span className="lp-bar">
        <span>{clock(at)}</span>
        <span className="track">
          <span className="fill" style={{ width: `${done}%` }} />
        </span>
        <span>{clock(t.seconds)}</span>
        {!room && (
          <button type="button" className={`lp-shuf${shuffle ? " on" : ""}`} aria-pressed={shuffle} title={T.listen.shuffleTip} onClick={() => setShuffle(!shuffle)}>
            <ShuffleIcon />
            {T.listen.shuffle}
          </button>
        )}
        {offerLite && (
          <button type="button" className={`lp-lite${lite ? " on" : ""}`} aria-pressed={lite} title={T.listen.liteTip} onClick={() => setLite(!lite)}>
            {T.listen.lite}
          </button>
        )}
      </span>
      {note && (
        <span className={`lp-hint${v.problem ? " bad" : ""}`} role="status">
          {note}
        </span>
      )}
    </div>
  );
}

/** The album's cover by the song playing; without one, or should it not come, a block for the game */
function PlayerCover({ file }: { file: string | undefined }) {
  const [broken, setBroken] = useState(false);
  if (!file || broken) {
    return (
      <span className="lp-cover" aria-hidden="true">
        {T.listen.cover}
      </span>
    );
  }
  return <img className="lp-cover" src={coverLink(file)} alt="" width={40} height={40} onError={() => setBroken(true)} />;
}

/** An album's cover by its name in the list, fetched as it comes near (a phone gets those it shows); none should it not come */
function AlbumCover({ file }: { file: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return <img src={coverLink(file)} alt="" width={28} height={28} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

/** The first time: what is kept of it, until 知道了 (in this browser) */
function PrivacyLine() {
  return (
    <p className="lp-privacy">
      <span>
        {T.listen.privacy}
        <a href={localPath("/privacy")} target="_blank" rel="noreferrer">
          {T.listen.privacyLink}
        </a>
      </span>
      <button onClick={() => markIntro("ok")}>{T.listen.privacyOk}</button>
    </p>
  );
}

// ---- 一起听 ----

/** The song a room opened now starts with: the one playing (or last played), else 新歌's first */
function firstSong(v: ListenPlayer, list: ListenSongs): ListenTrack | null {
  if (v.track) return v.track;
  if (list.state !== "ok") return null;
  const id = list.catalog.fresh[0] ?? list.catalog.albums[0]?.songs[0]?.id;
  return (id && list.tracks.get(id)) || null;
}

/** What the invitations came to: all sent, or how many were not and why (the first reason) */
function sentWords(sent: InviteSent[]): string {
  const bad = sent.filter((s) => !s.ok);
  if (!bad.length) return T.listen.sent;
  return fmt(T.listen.sentSome, { n: bad.length, why: bad[0].why ?? T.map.common.tryAgain });
}

/** 一起听's tab: the room you are in, or the ways to open one (and an invitation or a 宣言一起听 to you, while good) */
function Together({ paused, roomMax, mode, acts, onTab }: Omit<BodyProps, "tab">) {
  const room = useListenRoom();
  const over = useListenRoomEnd();
  const [view, setView] = useState<"main" | "invite" | "declare">("main");
  const [declaring, setDeclaring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 8_000);
    return () => window.clearTimeout(t);
  }, [note]);
  const done = (said: string | null) => {
    setView("main");
    if (said) setNote(said);
  };
  // from your main roach at once, unless there are others to pick from
  const many = acts.roaches.some((r) => r.slot > 0) || acts.ink;
  const declare = async (from: string[] | null) => {
    if (declaring) return;
    setDeclaring(true);
    const went = await acts.onDeclare(from);
    setDeclaring(false);
    if (went) setView("main");
  };
  const onDeclare = () => (many ? setView("declare") : void declare(null));
  const { invite, call } = acts;
  if (view === "invite" && (!room || room.host)) return <Picker room={room} roomMax={roomMax} mode={mode} onDone={done} />;
  if (view === "declare" && (!room || (room.host && !room.declared))) {
    return <DeclareFrom roaches={acts.roaches} ink={acts.ink} busy={declaring} onSend={(from) => void declare(from)} onCancel={() => setView("main")} />;
  }
  if (room) {
    return (
      <RoomView
        room={room}
        note={note}
        acts={acts}
        declaring={declaring}
        onInvite={() => setView("invite")}
        onPick={() => onTab("ark")}
        onDeclare={onDeclare}
      />
    );
  }
  return (
    <div className="lt">
      {invite && (
        <div className="lr-now">
          <span className="lbl">{fmt(T.listen.invitedYou, { name: invite.from.displayName })}</span>
          <b>{invite.song}</b>
          <small>{fmt(T.listen.inviteFor, { n: invite.n })}</small>
          <button className="lt-big" onClick={() => acts.onJoin(invite)}>
            {T.listen.join}
          </button>
          <button className="lt-big ghost" onClick={() => acts.onLater(invite)}>
            {T.listen.later}
          </button>
        </div>
      )}
      {!invite && call && (
        <div className="lr-now call">
          <span className="lbl">{T.listen.call.label}</span>
          <b>{fmtParts(T.common.quoted, { text: call.text })}</b>
          <small>{callLine(call.listen)}</small>
          <button className="lt-big" onClick={() => acts.onJoinCall(call)}>
            {T.listen.call.join}
          </button>
        </div>
      )}
      {note && <p className="lr-said">{note}</p>}
      <p className="lp-note left">{T.listen.togetherIntro}</p>
      <button className="lt-big" disabled={paused} onClick={() => setView("invite")}>
        {T.listen.inviteFriends}
      </button>
      <button className="lt-big alt" disabled={paused || declaring} onClick={onDeclare}>
        <MegaphoneIcon size={16} />
        {T.listen.declare}
      </button>
      <p className="lp-note left small">{fmt(T.listen.togetherNote, { max: roomMax, n: INVITES_PER_DAY, d: DECLARATIONS_PER_DAY })}</p>
      {!invite && !call && <p className="lp-note left small">{over ?? T.listen.noOne}</p>}
    </div>
  );
}

/** Which of your roaches a 宣言一起听 goes out from: your main one picked to begin with, as the map's declarations */
function DeclareFrom({
  roaches,
  ink,
  busy,
  onSend,
  onCancel,
}: {
  roaches: OwnRoach[];
  ink: boolean;
  busy: boolean;
  onSend: (from: string[]) => void;
  onCancel: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const [from, setFrom] = useState<string[]>(() => (main ? [main.id] : []));
  const toggle = (id: string) => setFrom((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const chip = (id: string, label: ReactNode) => (
    <button key={id} className={`chip ${from.includes(id) ? "on" : ""}`} aria-pressed={from.includes(id)} onClick={() => toggle(id)}>
      {label}
    </button>
  );
  return (
    <div className="lt">
      <p className="lp-note left">{fmt(T.listen.declareFrom, { km: DECLARATION_RADIUS_KM })}</p>
      <div className="chips lt-from" role="group" aria-label={T.declare.from}>
        {main && chip(main.id, T.common.main)}
        {clones.map((c, i) => chip(c.id, fmtParts(T.common.cloneN, { n: i + 1 })))}
        {ink && chip(INK_FROM, T.common.ink)}
      </div>
      <button className="lt-big" disabled={!from.length || busy} onClick={() => onSend(from)}>
        {T.listen.declareSend}
      </button>
      <button className="lt-big ghost" disabled={busy} onClick={onCancel}>
        {T.listen.declareNot}
      </button>
      <p className="lp-note left small">{fmt(T.listen.declareNote, { d: DECLARATIONS_PER_DAY })}</p>
    </div>
  );
}

/** Whom to invite: your 触须之交 who may listen, ticked, with how many times more today; a new room, or more to yours */
function Picker({
  room,
  roomMax,
  mode,
  onDone,
}: {
  room: ListenRoom | null;
  roomMax: number;
  mode: "admins" | "on";
  onDone: (said: string | null) => void;
}) {
  const [friends, setFriends] = useState<ListenFriend[] | null | "failed">(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const v = useListenPlayer();
  const list = useListenSongs();
  const first = room ? null : firstSong(v, list);
  const ask = () => {
    setFriends(null);
    void listenFriendsList().then((f) => setFriends(f ?? "failed"));
  };
  useEffect(ask, []);
  const pick = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const send = async () => {
    if (!picked.size || busy || (!room && !first)) return;
    setBusy(true);
    const ids = [...picked];
    // within the tap: a room opened may start its song by itself later
    const sent = room ? await inviteMore(ids) : await openRoomWith(first!.id, ids);
    setBusy(false);
    if (sent) onDone(sentWords(sent));
  };
  return (
    <div className="lt">
      <p className="lp-note left">{room ? fmt(T.listen.pickMore, { max: room.max }) : first ? fmt(T.listen.pickFrom, { song: first.name }) : T.listen.loading}</p>
      {friends === null ? (
        <p className="lp-note">{T.listen.pickLoading}</p>
      ) : friends === "failed" ? (
        <p className="lp-note">
          <button className="lp-retry" onClick={ask}>
            {T.listen.retry}
          </button>
        </p>
      ) : friends.length === 0 ? (
        <p className="lp-note">{mode === "admins" ? T.listen.pickNoneAdmins : T.listen.pickNone}</p>
      ) : (
        <div className="lpk" role="group" aria-label={T.listen.inviteFriends}>
          {friends.map((f) => {
            const off = f.inRoom || f.left <= 0;
            const on = picked.has(f.id) && !off;
            return (
              <button key={f.id} className={`lpk-row${on ? " on" : ""}`} role="checkbox" aria-checked={on} disabled={off || busy} onClick={() => pick(f.id)}>
                <span className="lpk-ck" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span className="lp-av" aria-hidden="true">
                  <RoachIcon color={f.card.color} size={30} avatar={f.card.avatar} friend />
                </span>
                <span className="lpk-who">
                  <b>{f.card.displayName}</b>
                  <small>
                    {f.inRoom ? T.listen.pickIn : f.left > 0 ? fmt(T.listen.pickLeft, { n: f.left }) : fmt(T.listen.pickUsed, { n: INVITES_PER_DAY })}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <button className="lt-big" disabled={!picked.size || busy || (!room && !first)} onClick={() => void send()}>
        {fmt(T.listen.send, { n: picked.size })}
      </button>
      <button className="lt-big ghost" disabled={busy} onClick={() => onDone(null)}>
        {T.listen.notNow}
      </button>
      {!room && <p className="lp-note left small">{fmt(T.listen.togetherNote, { max: roomMax, n: INVITES_PER_DAY, d: DECLARATIONS_PER_DAY })}</p>}
    </div>
  );
}

/**
 * The room you are in: who is in it (each to tap for their card), what plays, the host's buttons (宣言一起听 once), what
 * comes next, and the 短评
 */
function RoomView({
  room,
  note,
  acts,
  declaring,
  onInvite,
  onPick,
  onDeclare,
}: {
  room: ListenRoom;
  note: string | null;
  acts: ListenActs;
  declaring: boolean;
  onInvite: () => void;
  onPick: () => void;
  onDeclare: () => void;
}) {
  const list = useListenSongs();
  const v = useListenPlayer();
  const second = useListenSecond();
  const [busy, setBusy] = useState(false);
  // the card of someone in it: gone with them (one hidden from you by blocking is not in your list)
  const [who, setWho] = useState<number | null>(null);
  const person = who === null ? null : (room.members.find((m) => m.h === who && m.h !== room.you) ?? null);
  const all = list.state === "ok" ? list.tracks : null;
  const at = all ? roomPlace(room) : null;
  const n = room.members.filter((m) => m.state === "in").length;
  const pausedHere = at?.phase === "playing" && v.status === "paused";
  const nowId = !at ? room.queue[room.idx] : at.phase === "playing" ? room.queue[at.i] : at.phase === "done" ? room.queue[room.queue.length - 1] : room.queue[room.idx];
  const now = (nowId && all?.get(nowId)) || null;
  const nextIds = !at || at.phase === "done" ? [] : room.queue.slice((at.phase === "playing" ? at.i : room.idx) + 1);
  const nextNames = nextIds.map((id) => all?.get(id)?.name).filter(Boolean);
  const act = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const label = (m: ListenRoom["members"][number]) =>
    m.host ? T.listen.labels.host : m.state === "in" ? (m.h === room.you && pausedHere ? T.listen.labels.paused : T.listen.labels.in) : m.state === "kicked" ? T.listen.labels.kicked : T.listen.labels.left;
  return (
    <div className="lr">
      {note && <p className="lr-said">{note}</p>}
      <div className="lr-head">
        <b>{fmt(T.listen.roomHead, { n, max: room.max })}</b>
        {room.host && (
          <button className="lr-mini" onClick={onInvite} disabled={busy}>
            {T.listen.invite}
          </button>
        )}
        <button className="lr-mini warn" disabled={busy} onClick={() => void act(leaveListen)}>
          {room.host ? T.listen.end : T.listen.leave}
        </button>
      </div>
      <div className="lr-ppl">
        {room.members.map((m) =>
          m.h === room.you ? (
            <span key={`m${m.h}`} className={`lr-pp ${m.state}`} title={m.card.displayName}>
              <span className="lp-av">
                <RoachIcon color={m.card.color} size={30} avatar={m.card.avatar} friend={m.friend} />
              </span>
              <b>{m.card.displayName}</b>
              <small>{label(m)}</small>
            </span>
          ) : (
            <button key={`m${m.h}`} className={`lr-pp ${m.state}`} title={m.card.displayName} aria-haspopup="dialog" onClick={() => setWho(m.h)}>
              <span className="lp-av">
                <RoachIcon color={m.card.color} size={30} avatar={m.card.avatar} friend={m.friend} />
              </span>
              <b>{m.card.displayName}</b>
              <small>{label(m)}</small>
            </button>
          ),
        )}
        {room.invited.map((i, k) => (
          <span key={`i${k}`} className={`lr-pp ${i.state}`} title={i.card.displayName}>
            <span className="lp-av">
              <RoachIcon color={i.card.color} size={30} avatar={i.card.avatar} friend />
            </span>
            <b>{i.card.displayName}</b>
            <small>{i.state === "waiting" ? T.listen.labels.waiting : T.listen.labels.missed}</small>
          </span>
        ))}
      </div>
      {room.members.length > 1 && <p className="lp-note left small tight">{room.host ? T.listen.tapNoteHost : T.listen.tapNote}</p>}
      {room.host &&
        (room.declared ? (
          <p className="lr-declok">
            <MegaphoneIcon size={14} />
            <span>{fmt(T.listen.declared, { km: DECLARATION_RADIUS_KM })}</span>
          </p>
        ) : (
          <button className="lt-big alt" disabled={busy || declaring} onClick={onDeclare}>
            <MegaphoneIcon size={16} />
            {T.listen.declare}
          </button>
        ))}
      {at?.phase === "ready" || !at ? (
        <div className="lr-now">
          <span className="lbl">{T.listen.first}</span>
          <b>{now?.name ?? "…"}</b>
          {now && (
            <small>
              {now.album.name} · {now.artists.join(" / ")}
            </small>
          )}
          {room.host ? (
            <>
              <button className="lt-big" disabled={busy || !at} onClick={() => void act(() => hostQueue("start"))}>
                {T.listen.start}
              </button>
              <p className="lp-note left small">{T.listen.startNote}</p>
            </>
          ) : (
            <p className="lp-note left small">{fmt(T.listen.waitHost, { name: room.hostName })}</p>
          )}
        </div>
      ) : at.phase === "done" ? (
        <div className="lr-now">
          <span className="lbl">{T.listen.doneLabel}</span>
          <b>{now?.name}</b>
          <small>{room.host ? T.listen.doneHost : T.listen.doneOther}</small>
        </div>
      ) : (
        <div className="lr-now">
          <span className="lbl">{pausedHere ? T.listen.youPaused : T.listen.nowLabel}</span>
          <b>{now?.name}</b>
          {now && (
            <small>
              {now.album.name} · {now.artists.join(" / ")}
            </small>
          )}
          {now && (
            <span className="lr-bar">
              <span className="track">
                <span className="fill" style={{ width: `${now.seconds > 0 ? Math.min(100, (second / now.seconds) * 100) : 0}%` }} />
              </span>
              <span>{fmt(T.listen.roomAt, { at: clock(second), len: clock(now.seconds) })}</span>
            </span>
          )}
        </div>
      )}
      {room.host && at && at.phase !== "ready" && (
        <div className="lr-hostbtns">
          {at.phase === "playing" && (
            <>
              <button className="lr-mini" disabled={busy} onClick={() => void act(() => hostQueue("restart"))}>
                {T.listen.restart}
              </button>
              <button className="lr-mini" disabled={busy} onClick={() => void act(() => hostQueue("next"))}>
                {T.listen.next}
              </button>
            </>
          )}
          <button className="lr-mini" onClick={onPick}>
            {T.listen.pick}
          </button>
          <button className="lr-mini rnd" disabled={busy} onClick={() => void act(() => hostQueue("random"))}>
            <ShuffleIcon />
            {fmt(T.listen.randomAdd, { n: RANDOM_ADD })}
          </button>
        </div>
      )}
      <p className="lr-queue">{nextNames.length ? fmt(T.listen.upNext, { songs: nextNames.join(" · ") }) : T.listen.upNone}</p>
      <RxChips />
      {person && <PersonCard key={person.h} room={room} m={person} acts={acts} onClose={() => setWho(null)} />}
    </div>
  );
}

/**
 * Someone in the room, tapped: who TA is to you (触须之交, or as a stranger sees TA's card), 偷偷碰 and 大胆碰 as on the
 * map (none for a 触须之交), 拉黑 and 举报; the host may also ask TA to leave (请出去). Escape closes it, before the panel.
 */
function PersonCard({ room, m, acts, onClose }: { room: ListenRoom; m: RoomMember; acts: ListenActs; onClose: () => void }) {
  const touched = useListenTouched();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const how = touched && touched.room === room.id && touched.day === siteDay() ? touched.by[m.h] : undefined;
  const sub = (m.friend ? T.listen.person.friend : m.open ? T.listen.person.open : T.listen.person.closed) + (m.host ? T.listen.person.host : "");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const kick = () => {
    if (!window.confirm(fmt(T.listen.person.kickAsk, { name: m.card.displayName }))) return;
    void run(async () => (await kickMember(m.h)) && onClose());
  };
  // a name only where TA showed one, as the map's 拉黑 and 举报 say it
  const safety = () => acts.onSafety(`lr:${room.id}:${m.h}`, m.open || m.friend ? m.card.displayName : null);
  return (
    <>
      <button className="lr-pback" aria-label={T.common.close} onClick={onClose} />
      <div className="lr-pcard" role="dialog" aria-label={m.card.displayName}>
        <div className="lr-ph">
          <span className="lp-av">
            <RoachIcon color={m.card.color} size={34} avatar={m.card.avatar} friend={m.friend} />
          </span>
          <span className="lr-pw">
            <b>{m.card.displayName}</b>
            <small>{sub}</small>
          </span>
          <button className="close" onClick={onClose} aria-label={T.common.close}>
            ×
          </button>
        </div>
        {m.friend ? (
          <p className="lr-pnote">{T.listen.person.friends}</p>
        ) : (
          <>
            {how && <p className="lr-pnote">{how === "bold" ? T.cards.touched.bold : T.cards.touched.sneaky}</p>}
            {how !== "bold" && (
              <div className="lr-pb2">
                {!how && (
                  <button disabled={busy} onClick={() => void run(() => acts.onTouch(m.h, false))}>
                    {T.listen.person.sneaky}
                  </button>
                )}
                <button className="bold" disabled={busy} onClick={() => void run(() => acts.onTouch(m.h, true))}>
                  {T.listen.person.bold}
                </button>
              </div>
            )}
            <p className="lr-pnote">{T.listen.person.note}</p>
          </>
        )}
        <div className="lr-plinks">
          <span>
            <button onClick={safety}>{T.listen.person.block}</button>
            <button onClick={safety}>{T.listen.person.report}</button>
          </span>
          {room.host && !m.host && m.state === "in" && (
            <button className="kick" disabled={busy} onClick={kick}>
              {T.listen.person.kick}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** A 短评's words by its number (src/lib/listen.ts RX_ROWS) */
const rxText = (r: number) => T.listen.rx.flat()[r] ?? "";

/**
 * 一个人听, while a song plays: the first two rows of 短评 in one line, swiped sideways (the third is a room's); each
 * floats a moment over the panel as yours, and only how many times it was said to the song is kept
 */
function AloneRx() {
  const v = useListenPlayer();
  const rx = useListenRx();
  if (!v.track || !(v.status === "playing" || v.status === "starting")) return null;
  const off = rx.cool || rx.full;
  return (
    <div className="lp-rx">
      <div className="lp-rxh">{T.listen.rxAloneHead}</div>
      <div className="lp-rxs">
        {T.listen.rx
          .flat()
          .slice(0, RX_ROOM_FROM)
          .map((text, i) => (
            <button key={i} className="lr-chip" disabled={off} onClick={() => sendRx(i)}>
              {text}
            </button>
          ))}
      </div>
    </div>
  );
}

/** The 短评, row by row as numbered (src/lib/listen.ts RX_ROWS): grey while waiting, or this song's are used up */
function RxChips() {
  const rx = useListenRx();
  const off = rx.cool || rx.full;
  let n = 0;
  return (
    <div className="lr-rx">
      <div className="lr-rxh">{T.listen.rxHead}</div>
      {T.listen.rx.map((row, ri) => {
        const from = n;
        n += RX_ROWS[ri] ?? row.length;
        return (
          <div key={ri} className="lr-chips">
            {row.map((text, i) => (
              <button key={i} className={`lr-chip${ri === 2 ? " room" : ""}`} disabled={off} onClick={() => sendRx(from + i)}>
                {text}
              </button>
            ))}
          </div>
        );
      })}
      <p className="lp-note left small">{T.listen.rxNote}</p>
    </div>
  );
}

// ---- the songs ----

/** Albums drawn at first, and as many more each time the list is scrolled near its end */
const ALBUMS_AT_ONCE = 24;

/**
 * 全部: 新歌, then each album, a ♥ by the songs in your 收藏; while searching, the albums with a song found (all of an
 * album found by its own name). from: the list a song tapped here goes on as.
 */
function SongList({
  catalog,
  tracks,
  query,
  room,
  from,
  favs,
}: {
  catalog: ListenCatalog;
  tracks: Map<string, ListenTrack>;
  query: string;
  room: ListenRoom | null;
  from: ListenFrom;
  favs: ReadonlySet<string>;
}) {
  const v = useListenPlayer();
  const playing = v.status === "playing" || v.status === "starting";
  const nowId = v.track?.id ?? null;
  const [shown, setShown] = useState(ALBUMS_AT_ONCE);
  const groups = useMemo(() => {
    const all = catalog.albums.map((album) => ({ album, songs: songsOf(album, tracks) }));
    if (!query) return all;
    return all.map((g) => ({ album: g.album, songs: g.songs.filter((t) => songMatches(t, query)) })).filter((g) => g.songs.length > 0);
  }, [catalog, tracks, query]);
  const fresh = useMemo(
    () => (query ? [] : catalog.fresh.map((id) => tracks.get(id)).filter((t): t is ListenTrack => Boolean(t))),
    [catalog, tracks, query],
  );
  const end = useRef<HTMLDivElement>(null);
  const more = shown < groups.length;
  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && setShown((n) => n + ALBUMS_AT_ONCE), {
      root: el.closest(".sheet-body, .lp-scroll"),
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more, shown]);
  if (groups.length === 0 && fresh.length === 0) return <p className="lp-note">{T.listen.noMatch}</p>;
  // in a room: the host adds to its songs, anyone else only looks
  const use: RowUse = room ? (room.host ? "add" : "look") : "play";
  const row = (t: ListenTrack, key: string) => (
    <Row key={key} track={t} usual={catalog.artists} now={t.id === nowId} playing={playing && t.id === nowId} use={use} from={from} fav={favs.has(t.id)} />
  );
  return (
    <div className="lp-list">
      {fresh.length > 0 && (
        <section className="lp-album">
          <h3>{T.listen.fresh}</h3>
          {fresh.map((t) => row(t, `new-${t.id}`))}
        </section>
      )}
      {groups.slice(0, shown).map((g) => (
        <section key={g.album.id} className="lp-album">
          <h3>
            {g.album.cover && <AlbumCover key={g.album.cover} file={g.album.cover} />}
            {g.album.name}
          </h3>
          {g.songs.map((t) => row(t, t.id))}
        </section>
      ))}
      {more && <div ref={end} className="lp-end" aria-hidden="true" />}
    </div>
  );
}

const songsOf = (album: ListenAlbum, tracks: Map<string, ListenTrack>) =>
  album.songs.map((s) => tracks.get(s.id)).filter((t): t is ListenTrack => Boolean(t));

/**
 * 收藏 (yours, the latest first) or 热播榜 (the most heard first, how many times), a line on what it is above; only
 * the songs found while searching. from: the list a song tapped here goes on as.
 */
function ViewList({
  view,
  songs,
  from,
  usual,
  room,
  favs,
  hot,
  favN,
  query,
}: {
  view: Exclude<ListenView, "all">;
  songs: ListenTrack[];
  from: ListenFrom;
  usual: string[];
  room: ListenRoom | null;
  favs: ListenFavs;
  hot: ListenHot;
  favN: number;
  query: string;
}) {
  const v = useListenPlayer();
  const playing = v.status === "playing" || v.status === "starting";
  const nowId = v.track?.id ?? null;
  const ranks = useMemo(() => new Map(hot.state === "ok" ? hot.list.map((h, i) => [h.song, { rank: i + 1, n: h.n }]) : []), [hot]);
  const state = view === "fav" ? favs : hot;
  if (state.state === "failed") {
    return (
      <p className="lp-note">
        {state.message}
        <button className="lp-retry" onClick={view === "fav" ? loadFavs : loadHot}>
          {T.listen.retry}
        </button>
      </p>
    );
  }
  if (state.state !== "ok") return <p className="lp-note">{view === "fav" ? T.listen.favLoading : T.listen.hotLoading}</p>;
  const hotWords = { days: HOT_DAYS, s: HEARD_S, m: HOT_READ_MS / 60_000 };
  // in a room: the host adds to its songs, anyone else only looks
  const use: RowUse = room ? (room.host ? "add" : "look") : "play";
  return (
    <div className="lp-list">
      <p className="lp-cap">
        <b>{view === "fav" ? fmt(T.listen.favHead, { n: favN }) : T.listen.hotHead}</b>
        {" · "}
        {view === "fav" ? T.listen.favCap : fmt(T.listen.hotCap, hotWords)}
      </p>
      {songs.length === 0 ? (
        <p className="lp-note">{query ? T.listen.noMatch : view === "fav" ? T.listen.favNone : fmt(T.listen.hotNone, hotWords)}</p>
      ) : (
        songs.map((t) => {
          const r = view === "hot" ? ranks.get(t.id) : undefined;
          return (
            <Row
              key={t.id}
              track={t}
              usual={usual}
              now={t.id === nowId}
              playing={playing && t.id === nowId}
              use={use}
              from={from}
              fav={view === "fav"}
              album
              rank={r?.rank}
              times={r?.n}
            />
          );
        })
      )}
    </div>
  );
}

/** What a row does: plays its song, adds it to the room's (the host's ＋), or nothing (someone else's room) */
type RowUse = "play" | "add" | "look";

/**
 * A song: its place on 热播榜, its name (and its album, in 收藏 and 热播榜; its artists where they are not the list's
 * usual ones), a ♥ when it is in your 收藏 (tapped, out of it), how many times it was heard (热播榜) or how long it
 * is, ▶ or ＋; the one playing in red. The row is tapped anywhere but its ♥ (a button over all of it, the ♥ above that).
 */
function Row({
  track,
  usual,
  now,
  playing,
  use,
  from,
  fav,
  album = false,
  rank,
  times,
}: {
  track: ListenTrack;
  usual: string[];
  now: boolean;
  playing: boolean;
  use: RowUse;
  from: ListenFrom;
  fav: boolean;
  album?: boolean;
  rank?: number;
  times?: number;
}) {
  const own = track.artists.join() !== usual.join();
  const [adding, setAdding] = useState(false);
  const sub = album ? [track.album.name, ...(own ? [track.artists.join(" / ")] : [])].join(" · ") : own ? track.artists.join(" / ") : null;
  // the button over the row says what it is; what the row shows is not said twice
  const hide = use === "look" ? undefined : true;
  return (
    <div className={`lp-row${now ? " now" : ""}${use === "look" ? " look" : ""}`}>
      {use === "add" && (
        <button
          type="button"
          className="lp-hit"
          aria-label={fmt(T.listen.add, { name: track.name })}
          disabled={adding}
          onClick={() => {
            setAdding(true);
            void hostQueue({ add: track.id }).finally(() => setAdding(false));
          }}
        />
      )}
      {use === "play" && (
        <button
          type="button"
          className="lp-hit"
          aria-label={fmt(now ? T.listen.nowSong : T.listen.playSong, { name: track.name })}
          // the one playing pauses, as its ⏸ says; paused, it goes on from where it got to
          onClick={() => (now ? toggle() : playTrack(track, 0, from))}
        />
      )}
      {rank !== undefined && (
        <span className={`lp-rank${rank <= 3 ? " top" : ""}`} aria-hidden={hide}>
          {rank}
        </span>
      )}
      <span className="nm" aria-hidden={hide}>
        {track.name}
        {sub && <small>{sub}</small>}
      </span>
      {fav && (
        <button type="button" className="lp-fav" aria-label={fmt(T.listen.unfav, { name: track.name })} onClick={() => setFav(track.id, false)}>
          <HeartIcon />
        </button>
      )}
      {times !== undefined ? (
        <span className="lp-times" aria-hidden={hide}>
          {fmt(T.listen.hotTimes, { n: times.toLocaleString("zh-CN") })}
        </span>
      ) : (
        !album && (
          <span className="dur" aria-hidden={hide}>
            {clock(track.seconds)}
          </span>
        )
      )}
      {use !== "look" && (
        <span className={`go${use === "add" ? " add" : ""}`} aria-hidden="true">
          {use === "add" ? T.listen.plus : playing ? <PauseIcon /> : <PlayIcon />}
        </span>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 4.8v14.4L19 12z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

const HEART = "M12 20.3s-7.6-4.5-7.6-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.8c0 5.6-7.6 10.1-7.6 10.1z";

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={HEART} fill="currentColor" />
    </svg>
  );
}

function HeartLineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={HEART} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 5.2v13.6L15 12z" fill="currentColor" />
      <rect x="16.2" y="5.2" width="2.8" height="13.6" rx="1" fill="currentColor" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h4v4" />
      <path d="M4 20 20 4" />
      <path d="M16 20h4v-4" />
      <path d="m14 14 6 6" />
      <path d="m4 4 5 5" />
    </svg>
  );
}
