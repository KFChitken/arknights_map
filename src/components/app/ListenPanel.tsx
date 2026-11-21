"use client";
/* eslint-disable @next/next/no-img-element -- the albums' covers, small JPEGs of our own, which next/image would only copy */

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fmt, fmtParts, localPath, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { useDiscoChosen } from "@/lib/disco";
import {
  ALONE_MS,
  barSecond,
  clock,
  coverLink,
  dragLetGo,
  HEARD_S,
  HOT_DAYS,
  HOT_READ_MS,
  keySecond,
  LISTEN_FULL,
  RANDOM_ADD,
  RX_ROOM_FROM,
  RX_ROWS,
  seekBarKey,
  songMatches,
  UPNEXT_SHOWN,
  type InviteSent,
  type ListenAlbum,
  type ListenCatalog,
  type ListenFriend,
  type ListenFrom,
  type ListenRoom,
  type ListenTrack,
  type ListenView,
  type QueueRemove,
  type RoomMember,
  type RoomRequest,
} from "@/lib/listen";
import { DECLARATION_RADIUS_KM, DECLARATIONS_PER_DAY } from "@/lib/rules";
import { INK_FROM } from "@/lib/si";
import { siteDay } from "@/lib/siteDay";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import type { OwnRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { ChatIcon, DiscoBallIcon, DiscoModeSwitch, MegaphoneIcon, useDiscoSwitch, useWide } from "./chrome/parts";
import type { ListenCallItem, ListenInvite } from "./ListenOverlay";
import {
  answerSongAsk,
  askSong,
  callLine,
  hostQueue,
  inviteMore,
  inviteSquadToListen,
  kickMember,
  leaveListen,
  listenFriendsList,
  loadFavs,
  loadHot,
  loadSongs,
  markIntro,
  openRoomWith,
  playFromUpNext,
  playNext,
  playTrack,
  roomPlace,
  seekTo,
  sendRx,
  serverNow,
  setFav,
  setLite,
  setListenRxOpen,
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
  useListenRxOpen,
  useListenSaid,
  useListenSecond,
  useListenShuffle,
  useListenSongs,
  useListenTouched,
  useListenUpNext,
  withdrawAsk,
  type ListenFavs,
  type ListenHot,
  type ListenPlayer,
  type ListenSongs,
  type ListenUpNext,
} from "./listening";
import Sheet from "./Sheet";
import StreamDown from "./StreamDown";
import { squadSentWords } from "./squad/SquadListen";
import { loadSquadRoom, useSquadRoom } from "./squad/squading";
import "./listen.css";

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
 * 听歌's player, as a record: what plays on a black record (the room's roaches riding it, in one), white under it with
 * a little of its cover's colour at the top; its one bar, ▶ ⏭ 随机 省流量, and a line on what holds it up; the round
 * buttons (蹦迪, 一起听 and in a room 短评); the room you are in (这场); 待播; and the songs to pick from, in three lists:
 * 全部 (新歌, then album by album in the order of the Monster Siren Records site, a ♥ by each in your 收藏), your 收藏,
 * and 热播榜, with a search over the songs' and albums' names in the list shown and the list's 随机播放; alone, while a
 * song plays, the first two rows of 短评 too (only counted: 大家都在说 under each song). On a phone a sheet from the
 * bottom, shut with ⌄ (into the layout's bottom bar); on a computer a panel at the left, over the map but clear of its
 * middle, which can be looked round meanwhile, closed with ×. Songs go on playing with it shut (listening.ts).
 */
export default function ListenPanel({
  paused,
  roomMax,
  mode,
  disco,
  acts,
  onClose,
}: {
  /** The 站长 paused 听歌 for now */
  paused: boolean;
  /** How many a room may hold, and whom you may invite (admins: the 站长 and admins alone) */
  roomMax: number;
  mode: "admins" | "on";
  /** 听歌's disco is open to them (DISCO): its switch among the round buttons */
  disco: boolean;
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
  const v = useListenPlayer();
  const tint = useCoverTint(v.track?.album.cover);
  const style = tint ? ({ "--lp-tint": tint } as CSSProperties) : undefined;
  const body = <ListenBody paused={paused} roomMax={roomMax} mode={mode} disco={disco} acts={acts} />;
  if (!wide) {
    return (
      <Sheet title={T.listen.title} className="listen-sheet" style={style} shut={{ icon: <DownIcon />, label: T.listen.shut }} onClose={onClose} footer={foot}>
        {body}
      </Sheet>
    );
  }
  return (
    <FloatPanel style={style} onClose={onClose}>
      <div className="lp-scroll">{body}</div>
      {foot}
    </FloatPanel>
  );
}

/** On a computer: not modal, so the map stays to be used; Escape closes it, unless a sheet is open over it */
function FloatPanel({ style, onClose, children }: { style: CSSProperties | undefined; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".sheet-backdrop, .lr-pcard")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section className="listen-float" role="dialog" aria-label={T.listen.title} style={style}>
      <header className="lp-head">
        <h2>{T.listen.title}</h2>
        <button className="close" onClick={onClose} aria-label={T.listen.close}>
          ×
        </button>
      </header>
      {children}
    </section>
  );
}

/** How much of a cover's colour the player's top takes, on white, and how small the cover is looked at for it */
const TINT = 0.15;
const TINT_PX = 12;
/** Each cover's colour on white, once worked out */
const tints = new Map<string, string>();

/** The colour of the song's cover on white (TINT of it), for the player's top; null without one, or until it is in */
function useCoverTint(file: string | undefined): string | null {
  const [got, setGot] = useState<{ file: string; tint: string } | null>(null);
  useEffect(() => {
    if (!file || tints.has(file)) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      const tint = tintOf(img);
      if (!tint) return;
      tints.set(file, tint);
      if (live) setGot({ file, tint });
    };
    img.src = coverLink(file);
    return () => {
      live = false;
    };
  }, [file]);
  if (!file) return null;
  return tints.get(file) ?? (got?.file === file ? got.tint : null);
}

/** A cover's colour, its coloured parts weighing most (grey and black hardly at all), as TINT of it on white */
function tintOf(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = TINT_PX;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, TINT_PX, TINT_PX);
    const d = g.getImageData(0, 0, TINT_PX, TINT_PX).data;
    let r = 0;
    let gr = 0;
    let b = 0;
    let w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const k = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255 + 0.05;
      r += d[i] * k;
      gr += d[i + 1] * k;
      b += d[i + 2] * k;
      w += k;
    }
    const on = (x: number) => Math.round(255 - TINT * (255 - x / w));
    return `rgb(${on(r)}, ${on(gr)}, ${on(b)})`;
  } catch {
    // a cover the canvas may not read: white
    return null;
  }
}

type BodyProps = {
  paused: boolean;
  roomMax: number;
  mode: "admins" | "on";
  disco: boolean;
  acts: ListenActs;
};

/** What asked 结束这场一起听？ (离开…): the lit 一起听 among the round buttons, or 这场's 〔结束〕 */
type AskBy = "round" | "room";

function ListenBody({ paused, roomMax, mode, disco, acts }: BodyProps) {
  const intro = useListenIntro();
  const room = useListenRoom();
  const rxOpen = useListenRxOpen();
  // asked by the one tapped, under it; gone with the room
  const [asked, setAsked] = useState<{ by: AskBy; room: string } | null>(null);
  const ask = room && asked?.room === room.id ? asked.by : null;
  const flipAsk = (by: AskBy) => setAsked(room && ask !== by ? { by, room: room.id } : null);
  const doneAsk = () => setAsked(null);
  return (
    <div className={`lp${room ? " in-room" : ""}`}>
      {room && <StreamDown className="lp-down" />}
      <Player paused={paused} />
      <Rounds paused={paused} disco={disco} asking={ask === "round"} onAsk={() => flipAsk("round")} />
      {room && ask === "round" && <EndAsk room={room} onDone={doneAsk} />}
      {room && rxOpen && <RxChips />}
      {room ? (
        <RoomBlock room={room} roomMax={roomMax} mode={mode} acts={acts} asking={ask === "room"} onAsk={() => flipAsk("room")} onAskDone={doneAsk} />
      ) : (
        <Waiting acts={acts} />
      )}
      {!room && <AloneRx />}
      <UpNext />
      <Library />
      {intro !== "ok" && <PrivacyLine />}
    </div>
  );
}

/**
 * The song playing (or the last one, or the one to go on with) on its record, ♡ (收藏), its bar, a line on what holds
 * it up (缓冲中, ▶ to go on, why it stopped, what the room waits for: one line, always there, so nothing under it moves),
 * and ▶ or ⏸, ⏭, 随机 and 省流量. Before any song, ▶ plays from all of them at random. In a room the songs are the
 * host's: their ⏭ goes to the room's next, nobody else has one, nor 随机.
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
  const [busy, setBusy] = useState(false);
  const on = v.status === "playing" || v.status === "starting";
  // the bar goes where it is tapped alone, and in a room for the host while a song plays (not between two)
  const place = room ? roomPlace(room) : null;
  const canSeek = !room || (room.host && place?.phase === "playing" && place.offset >= 0);
  // a guest's tap on the bar: why it goes nowhere, for a moment in the line under it (a title shows on no phone)
  const guest = Boolean(room && !room.host);
  const [hostOnly, setHostOnly] = useState(false);
  const hostOnlyFor = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hostOnlyFor.current), []);
  const tellHostOnly = () => {
    clearTimeout(hostOnlyFor.current);
    setHostOnly(true);
    hostOnlyFor.current = setTimeout(() => setHostOnly(false), 3_000);
  };
  const note = guest && hostOnly ? { text: T.listen.seekHost } : hintOf(v, paused, room, place?.phase ?? null);
  const fav = Boolean(t) && favs.state === "ok" && favs.ids.includes(t!.id);
  const next = async () => {
    setBusy(true);
    await hostQueue("next");
    setBusy(false);
  };
  return (
    <div className="lp-player">
      <div className="lp-now">
        <Vinyl track={t} spinning={on} room={room} />
        <span className="lp-what">
          {room && <span className="lp-roomtag">{T.listen.togetherOn}</span>}
          {t ? (
            <>
              <b>{t.name}</b>
              <small>
                {t.album.name} · {t.artists.join(" / ")}
              </small>
            </>
          ) : (
            <b className="none">{T.listen.noSong}</b>
          )}
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
        {t && (
          <button
            type="button"
            className={`lp-ic fav${fav ? " on" : ""}`}
            aria-pressed={fav}
            aria-label={fmt(fav ? T.listen.unfav : T.listen.fav, { name: t.name })}
            onClick={() => setFav(t.id, !fav)}
          >
            {fav ? <HeartIcon /> : <HeartLineIcon />}
          </button>
        )}
      </div>
      <span className="lp-bar">
        {t ? (
          <SeekTrack
            key={seekBarKey(t.id, canSeek)}
            at={at}
            seconds={t.seconds}
            can={canSeek}
            room={Boolean(room)}
            title={guest ? T.listen.seekHost : undefined}
            onRefused={guest ? tellHostOnly : undefined}
            before={(s) => <span>{clock(s)}</span>}
            after={() => <span>{clock(t.seconds)}</span>}
          />
        ) : (
          <>
            <span>{clock(0)}</span>
            <span className="track">
              <span className="lp-rail" />
            </span>
            <span>{clock(0)}</span>
          </>
        )}
      </span>
      <p className={`lp-hint${note?.bad ? " bad" : ""}${note ? "" : " quiet"}`} role="status" title={note?.text}>
        {note?.text ?? "\u00a0"}
      </p>
      <div className="lp-ctl">
        <span className="lp-side">
          {!room && (
            <button type="button" className={`lp-chip${shuffle ? " on" : ""}`} aria-pressed={shuffle} title={T.listen.shuffleTip} onClick={() => setShuffle(!shuffle)}>
              <ShuffleIcon />
              {T.listen.shuffle}
            </button>
          )}
        </span>
        <span className="lp-mid">
          <button type="button" className="lp-big" aria-label={on ? T.listen.pause : T.listen.play} disabled={!t && paused} onClick={() => toggle()}>
            {on ? <PauseIcon /> : <PlayIcon />}
          </button>
          {!room ? (
            <button type="button" className="lp-ic next" aria-label={T.listen.next} title={T.listen.next} disabled={!hasNext} onClick={() => playNext()}>
              <NextIcon />
            </button>
          ) : (
            room.host && (
              <button
                type="button"
                className="lp-ic next"
                aria-label={T.listen.next}
                title={T.listen.next}
                disabled={busy || place?.phase !== "playing"}
                onClick={() => void next()}
              >
                <NextIcon />
              </button>
            )
          )}
        </span>
        <span className="lp-side end">
          {offerLite && (
            <button type="button" className={`lp-chip${lite ? " on" : ""}`} aria-pressed={lite} title={T.listen.liteTip} onClick={() => setLite(!lite)}>
              {T.listen.lite}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** The player's line on what holds it up, if anything does: why it stopped, 缓冲中, ▶ to go on, what the room waits for */
function hintOf(v: ListenPlayer, paused: boolean, room: ListenRoom | null, phase: "ready" | "playing" | "done" | null): { text: string; bad?: true } | null {
  const on = v.status === "playing" || v.status === "starting";
  if (v.problem) return { text: v.problem.code === LISTEN_FULL ? `${v.problem.message} ${T.listen.fullNote}` : v.problem.message, bad: true };
  if (!v.track && paused) return { text: T.listen.pausedNow };
  if (on && v.buffering) return { text: T.listen.buffering };
  if (v.tap) return { text: T.listen.tapToGo };
  if (!room) return null;
  if (phase === "ready") return { text: room.host ? T.listen.startTap : fmt(T.listen.waitHost, { name: room.hostName }) };
  if (phase === "done") return { text: room.host ? T.listen.doneHost : T.listen.doneOther };
  if (phase === "playing" && v.status === "paused") return { text: T.listen.youPaused };
  return null;
}

/** Roaches riding the record in a room: its host first, then as they came in */
const RIDERS = 4;

/**
 * The record: the song's cover its label, turning while it plays (or loads), the arm down on it; still, the arm up.
 * In a room the roaches of those in it ride it (RIDERS at most). Less motion asked for: still, the arm where it is (listen.css).
 */
function Vinyl({ track, spinning, room }: { track: ListenTrack | null; spinning: boolean; room: ListenRoom | null }) {
  const riders = room
    ? room.members
        .filter((m) => m.state === "in")
        .sort((a, b) => Number(b.host) - Number(a.host) || a.h - b.h)
        .slice(0, RIDERS)
    : [];
  return (
    <span className={`lp-vinyl${spinning ? " go" : ""}`} aria-hidden="true">
      <span className="spin">
        <span className="lab">{track ? <PlayerCover key={track.album.cover ?? ""} file={track.album.cover} /> : <span className="lp-cover" />}</span>
        <span className="hole" />
        {riders.map((m, i) => (
          <span key={m.h} className={`rider r${i}`}>
            <RoachIcon color={m.card.color} size={22} avatar={m.card.avatar} />
          </span>
        ))}
      </span>
      <span className="shine" />
      <svg className="arm" viewBox="0 0 46 46">
        <circle cx="38" cy="8" r="5" fill="#9aa0aa" />
        <path d="M38 8 L22 33" stroke="#c3c9d4" strokeWidth="3" strokeLinecap="round" />
        <rect x="16" y="30" width="9" height="6" rx="1.5" fill="#c3c9d4" transform="rotate(-32 20 33)" />
      </svg>
    </span>
  );
}

/**
 * The round buttons, as the ball beside 听歌's entry: 蹦迪 (where the disco is open to them); 一起听, off: a room of your
 * own at once, you its host (the song playing goes on as its own), lit while you are in one: 结束 (离开) asked under
 * it; and in a room 短评, its row out or back in, and with the disco on 舞台 | 拉远 last
 */
function Rounds({ paused, disco, asking, onAsk }: { paused: boolean; disco: boolean; asking: boolean; onAsk: () => void }) {
  const room = useListenRoom();
  const v = useListenPlayer();
  const list = useListenSongs();
  const rxOpen = useListenRxOpen();
  const dancing = useDiscoChosen();
  const [opening, setOpening] = useState(false);
  const first = room ? null : firstSong(v, list);
  const open = async () => {
    if (opening || !first) return;
    setOpening(true);
    // within the tap: the song may go on, or start, as the room's
    await openRoomWith(first.id, []);
    setOpening(false);
  };
  return (
    <div className="lp-tgs">
      {disco && <DiscoRound />}
      <span className="lp-tgl">
        <button
          type="button"
          className={`lp-tg room${room ? " on" : ""}`}
          aria-pressed={Boolean(room)}
          aria-expanded={room ? asking : undefined}
          aria-label={room ? T.listen.togetherOn : T.listen.openRoom}
          disabled={!room && (paused || opening || !first)}
          onClick={() => (room ? onAsk() : void open())}
        >
          <TogetherIcon />
        </button>
        <small aria-hidden="true">{room ? T.listen.togetherOn : T.listen.together}</small>
      </span>
      {room && (
        <span className="lp-tgl">
          <button type="button" className={`lp-tg chat${rxOpen ? " on" : ""}`} aria-pressed={rxOpen} aria-label={T.map.bar.listenChat} onClick={() => setListenRxOpen(!rxOpen)}>
            <ChatIcon />
          </button>
          <small aria-hidden="true">{T.listen.rxButton}</small>
        </span>
      )}
      {room && disco && dancing && <DiscoModeSwitch inPanel />}
    </div>
  );
}

/** 蹦迪 among the round buttons: the same switch as the ball beside 听歌's entry, 「点我蹦迪」 under it the first time */
function DiscoRound() {
  const { chosen, hint, tap, label } = useDiscoSwitch(true);
  return (
    <span className={`lp-tgl${hint ? " hint" : ""}`}>
      <button type="button" className={`lp-tg disco${chosen ? " on" : ""}`} aria-pressed={chosen} aria-label={label} title={label} onClick={tap}>
        <DiscoBallIcon size={24} />
      </button>
      <small aria-hidden="true">{hint ? T.map.bar.discoHint : T.listen.disco}</small>
    </span>
  );
}

/** 结束这场一起听？ for the host (anyone else: 离开这场一起听？), under what asked it */
function EndAsk({ room, onDone }: { room: ListenRoom; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const words = room.host ? T.listen.endAsk : T.listen.leaveAsk;
  const more = room.host ? T.listen.endAskMore : T.listen.leaveAskMore;
  const yes = async () => {
    setBusy(true);
    const out = await leaveListen();
    setBusy(false);
    if (out) onDone();
  };
  return (
    <div className="lp-ask" role="group" aria-label={words}>
      <span className="w">
        <b>{words}</b>
        <small>{more}</small>
      </span>
      <span className="acts">
        <button type="button" className="lp-mini warn" disabled={busy} onClick={() => void yes()}>
          {room.host ? T.listen.end : T.listen.leave}
        </button>
        <button type="button" className="lp-mini" disabled={busy} onClick={onDone}>
          {T.listen.askNot}
        </button>
      </span>
    </div>
  );
}

/** Out of a room: an invitation to you still to answer, or the newest 宣言一起听 you got still open; else why the last one ended */
function Waiting({ acts }: { acts: ListenActs }) {
  const over = useListenRoomEnd();
  const { invite, call } = acts;
  if (invite) {
    return (
      <div className="lr-now">
        <span className="lbl">{fmt(T.listen.invitedYou, { name: invite.from.displayName })}</span>
        <b>{invite.song}</b>
        <small>{fmt(T.listen.inviteFor, { n: invite.n })}</small>
        <span className="lr-acts">
          <button type="button" className="lp-mini go" onClick={() => acts.onJoin(invite)}>
            {T.listen.join}
          </button>
          <button type="button" className="lp-mini" onClick={() => acts.onLater(invite)}>
            {T.listen.later}
          </button>
        </span>
      </div>
    );
  }
  if (call) {
    return (
      <div className="lr-now call">
        <span className="lbl">{T.listen.call.label}</span>
        <b>{fmtParts(T.common.quoted, { text: call.text })}</b>
        <small>{callLine(call.listen)}</small>
        <span className="lr-acts">
          <button type="button" className="lp-mini go" onClick={() => acts.onJoinCall(call)}>
            {T.listen.call.join}
          </button>
        </span>
      </div>
    );
  }
  return over ? <p className="lp-note left small">{over}</p> : null;
}

/** In a room the bar's keys go there this long after the last one: one change for the room, not one a key */
const SEEK_KEYS_MS = 500;

/**
 * How far the song got (at, of seconds). Where `can` (alone; the host's, in a room) a bar to tap or drag: the knob
 * follows the finger and the song goes there as it lifts (a finger that scrolls instead goes nowhere); ← → 5 seconds,
 * PageDown PageUp 30, Home End. In a room where it went stays shown until the room answered, and its keys go a moment
 * after the last one. Otherwise it only shows (title: why). before and after: the times by it. Keyed by seekBarKey: a
 * drag goes with its song or with `can`, never with a seek answered meanwhile. Let go of where it never heard (a mouse
 * back with no button down, the pointer taken from it), it goes where the finger had it.
 */
function SeekTrack({
  at,
  seconds,
  can,
  room,
  title,
  onRefused,
  before,
  after,
}: {
  at: number;
  seconds: number;
  can: boolean;
  room: boolean;
  title?: string;
  /** A tap where it may not be dragged */
  onRefused?: () => void;
  /** How far it got, by the bar (the second the finger has it at, while it drags) */
  before?: (s: number) => ReactNode;
  after?: (s: number) => ReactNode;
}) {
  const box = useRef<HTMLSpanElement>(null);
  // where the finger or the keys have it, then where it went until the room answered; null: where the song is
  const [held, setHeld] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const finger = useRef<number | null>(null);
  // the second the finger had it at last
  const fingerAt = useRef(0);
  const tries = useRef(0);
  const keys = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(keys.current), []);
  const shown = held ?? at;
  const done = seconds > 0 ? Math.min(100, Math.max(0, (shown / seconds) * 100)) : 0;
  const rail = (
    <span className="lp-rail">
      <span className="fill" style={{ width: `${done}%` }} />
    </span>
  );
  if (!can) {
    return (
      <>
        {before?.(shown)}
        <span className="track" title={title} onClick={onRefused}>
          {rail}
        </span>
        {after?.(shown)}
      </>
    );
  }
  const under = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    return r ? barSecond(x, r.left, r.width, seconds) : shown;
  };
  const go = (s: number) => {
    const mine = ++tries.current;
    const answered = seekTo(s);
    if (!answered) return setHeld(null);
    setHeld(s);
    void answered.finally(() => {
      if (mine === tries.current) setHeld(null);
    });
  };
  const follow = (s: number) => {
    fingerAt.current = s;
    setHeld(s);
  };
  const letGo = () => {
    finger.current = null;
    setDrag(false);
  };
  return (
    <>
      {before?.(shown)}
      <span
        ref={box}
        className={`track can${drag ? " drag" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label={T.listen.seekBar}
        aria-valuemin={0}
        aria-valuemax={Math.floor(seconds)}
        aria-valuenow={Math.floor(shown)}
        aria-valuetext={`${clock(shown)} / ${clock(seconds)}`}
        onPointerDown={(e) => {
          if (finger.current !== null || e.button !== 0) return;
          finger.current = e.pointerId;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {}
          ++tries.current;
          clearTimeout(keys.current);
          setDrag(true);
          follow(under(e.clientX));
        }}
        onPointerMove={(e) => {
          if (finger.current !== e.pointerId) return;
          if (!dragLetGo(e.pointerType, e.buttons)) return follow(under(e.clientX));
          letGo();
          go(fingerAt.current);
        }}
        onPointerUp={(e) => {
          if (finger.current !== e.pointerId) return;
          letGo();
          go(under(e.clientX));
        }}
        onLostPointerCapture={(e) => {
          if (finger.current !== e.pointerId) return;
          letGo();
          go(fingerAt.current);
        }}
        onPointerCancel={(e) => {
          if (finger.current !== e.pointerId) return;
          letGo();
          ++tries.current;
          setHeld(null);
        }}
        onKeyDown={(e) => {
          const to = finger.current === null ? keySecond(e.key, shown, seconds) : null;
          if (to === null) return;
          e.preventDefault();
          clearTimeout(keys.current);
          if (!room) return go(to);
          ++tries.current;
          setHeld(to);
          keys.current = setTimeout(() => go(to), SEEK_KEYS_MS);
        }}
      >
        {rail}
        <span className="lp-knob" style={{ left: `${done}%` }} />
      </span>
      {after?.(shown)}
    </>
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

/**
 * 这场, while you are in a room: how many are in it (whose it is, when not yours), 〔邀请触须之交〕 (the host's) and a red
 * 〔结束〕 (anyone else's 〔离开〕), asked first under it; who is in it (each to tap for their card) and who was invited;
 * whom to invite, there; and the host's 宣言一起听 (once a room). When it is 卫戍的一起听 of the room of 一起卫戍 you are
 * in (src/lib/squad.ts SquadListen): those of that room not in it, grey (to its host, those never invited: the others
 * are among the invited), and to its host a line under them: all were invited, or 〔邀请卫戍队友〕 for the rest.
 */
function RoomBlock({
  room,
  roomMax,
  mode,
  acts,
  asking,
  onAsk,
  onAskDone,
}: {
  room: ListenRoom;
  roomMax: number;
  mode: "admins" | "on";
  acts: ListenActs;
  asking: boolean;
  onAsk: () => void;
  onAskDone: () => void;
}) {
  const v = useListenPlayer();
  const [view, setView] = useState<"main" | "invite" | "declare">("main");
  const [declaring, setDeclaring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 8_000);
    return () => window.clearTimeout(t);
  }, [note]);
  // the card of someone in it: gone with them (one hidden from you by blocking is not in your list)
  const [who, setWho] = useState<number | null>(null);
  const person = who === null ? null : (room.members.find((m) => m.h === who && m.h !== room.you) ?? null);
  const n = room.members.filter((m) => m.state === "in").length;
  const at = roomPlace(room);
  const pausedHere = at?.phase === "playing" && v.status === "paused";
  // from your main roach at once, unless there are others to pick from
  const many = acts.roaches.some((r) => r.slot > 0) || acts.ink;
  const declare = async (from: string[] | null) => {
    if (declaring) return;
    setDeclaring(true);
    const went = await acts.onDeclare(from);
    setDeclaring(false);
    if (went) setView("main");
  };
  const head = room.host ? fmt(T.listen.roomHead, { n, max: room.max }) : fmt(T.listen.roomHeadOf, { name: room.hostName, n, max: room.max });
  // 卫戍的一起听: those of the room of 一起卫戍 not in it
  const squad = useSquadRoom();
  const ours = squad?.hear && squad.listen?.room === room.id ? squad.listen : null;
  const uninvited = room.host ? (ours?.uninvited ?? []) : [];
  const outOfIt = (room.host ? uninvited : (ours?.out ?? [])).flatMap((h) => squad?.members.filter((m) => m.h === h) ?? []);
  const [inviting, setInviting] = useState(false);
  const inviteRest = async () => {
    if (inviting) return;
    setInviting(true);
    const res = await inviteSquadToListen(uninvited);
    setInviting(false);
    if (!res) return;
    setNote(squadSentWords(res.sent));
    void loadSquadRoom().catch(() => {});
  };
  const label = (m: RoomMember) =>
    m.host ? T.listen.labels.host : m.state === "in" ? (m.h === room.you && pausedHere ? T.listen.labels.paused : T.listen.labels.in) : m.state === "kicked" ? T.listen.labels.kicked : T.listen.labels.left;
  return (
    <section className="lp-blk lr" aria-label={head}>
      <div className="lp-blkh">
        <b>{head}</b>
        {room.host && (
          <button type="button" className={`lp-mini${view === "invite" ? " on" : ""}`} aria-expanded={view === "invite"} onClick={() => setView(view === "invite" ? "main" : "invite")}>
            {T.listen.invite}
          </button>
        )}
        <button type="button" className="lp-mini warn end" aria-expanded={asking} onClick={onAsk}>
          {room.host ? T.listen.end : T.listen.leave}
        </button>
      </div>
      {asking && <EndAsk room={room} onDone={onAskDone} />}
      {note && <p className="lr-said">{note}</p>}
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
        {outOfIt.map((m) => (
          <span key={`s${m.h}`} className="lr-pp out" title={m.name}>
            <span className="lp-av">
              <RoachIcon color={m.color as RoachColor} size={30} avatar={m.avatar as RoachAvatar} friend={m.friend} />
            </span>
            <b>{m.name}</b>
            <small>{T.squad.listen.outTag}</small>
          </span>
        ))}
      </div>
      {ours && room.host && (
        <p className="lp-note left small tight lr-squad">
          {uninvited.length ? (
            <button type="button" className="lp-mini" disabled={inviting} onClick={() => void inviteRest()}>
              {T.squad.listen.askRest}
            </button>
          ) : (
            T.squad.listen.allAsked
          )}
        </p>
      )}
      {room.host && room.aloneSince !== null && <AloneLine since={room.aloneSince} />}
      {room.members.length > 1 && <p className="lp-note left small tight">{room.host ? T.listen.tapNoteHost : T.listen.tapNote}</p>}
      {room.host && view === "invite" && (
        <Picker
          room={room}
          roomMax={roomMax}
          mode={mode}
          onDone={(said) => {
            setView("main");
            if (said) setNote(said);
          }}
        />
      )}
      {room.host &&
        (room.declared ? (
          <p className="lr-declok">
            <MegaphoneIcon size={14} />
            <span>{fmt(T.listen.declared, { km: DECLARATION_RADIUS_KM })}</span>
          </p>
        ) : view === "declare" ? (
          <DeclareFrom roaches={acts.roaches} ink={acts.ink} busy={declaring} onSend={(from) => void declare(from)} onCancel={() => setView("main")} />
        ) : (
          <span>
            <button type="button" className="lp-mini y" disabled={declaring} onClick={() => (many ? setView("declare") : void declare(null))}>
              <MegaphoneIcon size={14} />
              {T.listen.declare}
            </button>
          </span>
        ))}
      {person && <PersonCard key={person.h} room={room} m={person} acts={acts} onClose={() => setWho(null)} />}
    </section>
  );
}

/**
 * The host alone in the room since `since` (the server's clock): it ends ALONE_MS on, the song going on alone; its last
 * minute counted down. Only here, in the open player: nothing pops up, nothing is pushed
 */
function AloneLine({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1_000);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((since + ALONE_MS - serverNow()) / 1000));
  return (
    <p className="lr-alone" role="status">
      {left <= 60 ? fmt(T.listen.aloneSoon, { at: clock(left) }) : T.listen.aloneNow}
    </p>
  );
}

/** Whom to invite to your room: your 触须之交 who may listen, ticked (those in it already grey) */
function Picker({ room, roomMax, mode, onDone }: { room: ListenRoom; roomMax: number; mode: "admins" | "on"; onDone: (said: string | null) => void }) {
  const [friends, setFriends] = useState<ListenFriend[] | null | "failed">(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
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
    if (!picked.size || busy) return;
    setBusy(true);
    const sent = await inviteMore([...picked]);
    setBusy(false);
    if (sent) onDone(sentWords(sent));
  };
  return (
    <div className="lt">
      <p className="lp-note left small">{fmt(T.listen.pickMore, { max: room.max })}</p>
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
        <div className="lpk" role="group" aria-label={T.listen.invite}>
          {friends.map((f) => {
            const off = f.inRoom;
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
                  {f.inRoom && <small>{T.listen.pickIn}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <span className="lr-acts">
        <button type="button" className="lp-mini go" disabled={!picked.size || busy} onClick={() => void send()}>
          {fmt(T.listen.send, { n: picked.size })}
        </button>
        <button type="button" className="lp-mini" disabled={busy} onClick={() => onDone(null)}>
          {T.listen.notNow}
        </button>
      </span>
      <p className="lp-note left small">{fmt(T.listen.togetherNote, { max: roomMax, d: DECLARATIONS_PER_DAY })}</p>
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

// ---- 待播 ----

/** 待播 shown open (all of it), as it was left on this page; shut at first, only its line of what comes next */
let queueOpen = false;

/**
 * 待播: what comes after the song playing, and how (alone: as its list goes, a round of 随机播放's drawn ahead, or songs
 * from all of them at random; in a room, its songs), shut to a line of the next three; open, the songs in order
 * (UPNEXT_SHOWN at most, then how many more), each tapped to play alone, and what comes once they are played; the
 * host's 随机加 10 首. In a room: who put each song in, the host's × to take one out, and 点歌: to the host, the songs
 * asked for (点歌 N by its name, red), each to let in or leave out; to anyone else, their own still to be answered
 * (你点的 N, teal), each to take back
 */
function UpNext() {
  const up = useListenUpNext();
  const list = useListenSongs();
  const room = useListenRoom();
  const [open, setOpen] = useState(queueOpen);
  const [busy, setBusy] = useState(false);
  const all = list.state === "ok" ? list.tracks : null;
  // each with its place in 待播 (one gone from the list is left out, the rest keep theirs)
  const songs = useMemo(
    () => (all ? up.ids.flatMap((id, k) => (all.has(id) ? [{ t: all.get(id)!, k }] : [])) : []),
    [all, up.ids],
  );
  const { head, tail } = queueWords(up, room);
  const peek = up.how === "none" ? T.listen.noSong : songs.length ? fmt(T.listen.upNext, { songs: songs.slice(0, 3).map((s) => s.t.name).join(" · ") }) : tail;
  const asks = room ? room.requests : [];
  const flip = () => {
    queueOpen = !open;
    setOpen(!open);
  };
  const random = async () => {
    setBusy(true);
    await hostQueue("random");
    setBusy(false);
  };
  return (
    <section className="lp-blk lp-q">
      <div className="lp-qhead">
        <button type="button" className="lp-chev" aria-expanded={open} onClick={flip}>
          <b>{T.listen.queue}</b>
          <span className="peek">{peek}</span>
          <i aria-hidden="true">›</i>
        </button>
        {asks.length > 0 &&
          (room?.host ? (
            <span className="lp-reqbadge" title={fmt(T.listen.asks.badgeLabel, { n: asks.length })}>
              {fmt(T.listen.asks.badge, { n: asks.length })}
            </span>
          ) : (
            <span className="lp-reqbadge mine">{fmt(T.listen.asks.mine, { n: asks.length })}</span>
          ))}
      </div>
      {open && (
        <>
          {room && asks.length > 0 && (
            <ul className="lp-asks">
              {asks.map((q) => (
                <AskRow key={q.id} ask={q} room={room} track={all?.get(q.song) ?? null} />
              ))}
            </ul>
          )}
          {head && <p className="lp-qrule">{songs.length ? `${head} · ${fmt(T.listen.queueMore, { n: songs.length })}` : head}</p>}
          {songs.length > 0 && (
            <ol className="lp-qrows">
              {songs.slice(0, UPNEXT_SHOWN).map(({ t, k }, i) => (
                <QueueRow
                  key={`${k}-${t.id}`}
                  track={t}
                  n={i + 1}
                  play={!room}
                  by={room ? byWord(room, up.by?.[k] ?? 0) : null}
                  remove={room?.host && up.at !== undefined ? { remove: up.at + k, song: t.id } : null}
                />
              ))}
            </ol>
          )}
          {songs.length > UPNEXT_SHOWN && <p className="lp-qrule">{fmt(T.listen.queueMore, { n: songs.length - UPNEXT_SHOWN })}</p>}
          {tail && (
            <p className="lp-qrule">
              <ShuffleIcon />
              {tail}
            </p>
          )}
          {room?.host && (
            <span>
              <button type="button" className="lp-mini" disabled={busy} onClick={() => void random()}>
                <ShuffleIcon />
                {fmt(T.listen.randomAdd, { n: RANDOM_ADD })}
              </button>
            </span>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Who put a song of the room's in, as 待播 says it: nothing for the host's own, 你点的, {name} 点的 (by the name they
 * have in the room), 随机放的 (0: drawn at random, or added to keep 待播 going), or 已离开的人点的
 */
function byWord(room: ListenRoom, h: number): string | null {
  if (h === 0) return T.listen.asks.byRandom;
  const m = room.members.find((x) => x.h === h);
  if (m?.host) return null;
  if (h === room.you) return T.listen.asks.byYou;
  return m?.state === "in" ? fmt(T.listen.asks.by, { name: m.card.displayName }) : T.listen.asks.byLeft;
}

/**
 * A song asked for (点歌), at the top of 待播 open: to the host, who asked for it, 〔同意〕 and 〔不要〕; to the one who
 * asked, 等房主同意 and 〔撤回〕
 */
function AskRow({ ask, room, track }: { ask: RoomRequest; room: ListenRoom; track: ListenTrack | null }) {
  const [busy, setBusy] = useState(false);
  const who = room.members.find((m) => m.h === ask.h);
  const song = track?.name ?? ask.song;
  const send = (go: () => Promise<boolean>) => {
    setBusy(true);
    void go().finally(() => setBusy(false));
  };
  const face = who && (
    <span className="lp-av" aria-hidden="true">
      <RoachIcon color={who.card.color} size={24} avatar={who.card.avatar} friend={who.friend} />
    </span>
  );
  if (!room.host) {
    return (
      <li className="lp-ask1 mine">
        {face}
        <span className="w">{fmt(T.listen.asks.waiting, { song })}</span>
        <span className="acts">
          <button type="button" className="lp-mini" disabled={busy} aria-label={fmt(T.listen.asks.withdrawLabel, { song })} onClick={() => send(() => withdrawAsk(ask.id))}>
            {T.listen.asks.withdraw}
          </button>
        </span>
      </li>
    );
  }
  const name = who?.card.displayName ?? "";
  return (
    <li className="lp-ask1">
      {face}
      <span className="w">{fmtNodes(T.listen.asks.came, { name: <b>{name}</b>, song })}</span>
      <span className="acts">
        <button
          type="button"
          className="lp-mini go"
          disabled={busy}
          aria-label={fmt(T.listen.asks.okLabel, { name, song })}
          onClick={() => send(() => answerSongAsk(ask.id, true))}
        >
          {T.listen.asks.ok}
        </button>
        <button type="button" className="lp-mini" disabled={busy} aria-label={fmt(T.listen.asks.notOkLabel, { name, song })} onClick={() => send(() => answerSongAsk(ask.id, false))}>
          {T.listen.asks.notOk}
        </button>
      </span>
    </li>
  );
}

/**
 * A song in 待播, by its place: alone, tapped, it plays (and 待播 goes on from it); in a room it only shows, with who
 * put it in (by) where its album would be, and for the host a × to take it out (remove) where its length would be
 */
function QueueRow({
  track,
  n,
  play,
  by = null,
  remove = null,
}: {
  track: ListenTrack;
  n: number;
  play: boolean;
  by?: string | null;
  remove?: QueueRemove | null;
}) {
  const [busy, setBusy] = useState(false);
  const body = (
    <>
      <span className="n">{n}</span>
      <span className="nm">
        {track.name}
        {by ? <small className="by">{by}</small> : <small>{track.album.name}</small>}
      </span>
      {!remove && <span className="dur">{clock(track.seconds)}</span>}
    </>
  );
  return (
    <li>
      {play ? (
        <button type="button" className="lp-qrow" aria-label={fmt(T.listen.queuePlay, { name: track.name })} onClick={() => playFromUpNext(track.id)}>
          {body}
        </button>
      ) : (
        <span className="lp-qrow">
          {body}
          {remove && (
            <button
              type="button"
              className="lp-qx"
              disabled={busy}
              aria-label={fmt(T.listen.asks.remove, { name: track.name })}
              onClick={() => {
                setBusy(true);
                void hostQueue(remove).finally(() => setBusy(false));
              }}
            >
              ×
            </button>
          )}
        </span>
      )}
    </li>
  );
}

/** 待播's lines: how its songs come (head), and what comes once they are played (tail) */
function queueWords(up: ListenUpNext, room: ListenRoom | null): { head: string; tail: string } {
  if (up.how === "room") {
    return { head: room?.host ? T.listen.queueRoomMine : fmt(T.listen.queueRoomOf, { name: room?.hostName ?? "" }), tail: T.listen.queueAfterRoom };
  }
  if (up.how === "none") return { head: "", tail: "" };
  if (up.how === "any") return { head: T.listen.queueAny, tail: T.listen.queueAfterAny };
  const list = listWord(up.from, up.track, up.how === "round");
  if (up.how === "round") return { head: fmt(T.listen.queueRound, { list }), tail: T.listen.queueAfterRound };
  return { head: fmt(T.listen.queueList, { list }), tail: T.listen.queueAfterList };
}

/** The list 待播 goes by, as its line names it: 全部's goes by the song's album, its round over all of them */
function listWord(f: ListenFrom | null, track: ListenTrack | null, round: boolean): string {
  if (f?.view === "left") return T.listen.lists.left;
  if (f?.view === "fav") return T.listen.lists.fav;
  if (f?.view === "hot") return T.listen.lists.hot;
  if (f?.ids.length) return T.listen.lists.found;
  return round || !track ? T.listen.lists.all : fmt(T.listen.lists.album, { name: track.album.name });
}

// ---- 选歌 ----

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

/**
 * 选歌: the songs in three lists (全部, 收藏, 热播榜), a search over the list shown, and its 随机播放 (alone); in a room
 * the host's ＋ adds a song to its songs, and anyone else only looks
 */
function Library() {
  const list = useListenSongs();
  const room = useListenRoom();
  const favs = useListenFavs();
  const hot = useListenHot();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ListenView>(lastView);
  const box = useRef<HTMLElement>(null);
  const show = (v: ListenView) => {
    lastView = v;
    setView(v);
    // another list starts at its top: back up to 选歌's head, when it was scrolled past
    const el = box.current;
    const scroller = el?.closest(".sheet-body, .lp-scroll");
    if (!el || !scroller) return;
    const past = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (past < 0) scroller.scrollTop += past;
  };
  // 热播榜 as it is shown (收藏 as the panel opens, for the ♥ and the ♡)
  useEffect(() => {
    if (view === "hot") loadHot();
  }, [view]);
  // the list follows the typing a moment behind, so the box itself never waits on a long list
  const q = useDeferredValue(query.trim());
  const tracks = list.state === "ok" ? list.tracks : null;
  const shown = useMemo(() => viewSongs(view, tracks, favs, hot, q), [view, tracks, favs, hot, q]);
  const favSet = useMemo(() => new Set(favs.state === "ok" ? favs.ids : []), [favs]);
  const favN = favs.state === "ok" && tracks ? favs.ids.filter((id) => tracks.has(id)).length : null;
  return (
    <section className="lp-blk lp-lib" ref={box}>
      <div className="lp-blkh">
        <b>{T.listen.library}</b>
      </div>
      {room && <p className="lp-note left small tight">{room.host ? T.listen.addNote : T.listen.askNote}</p>}
      {list.state === "ok" ? (
        list.tracks.size > 0 ? (
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
    </section>
  );
}

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
  const rowDoes = useRowUse(room, nowId);
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
  const row = (t: ListenTrack, key: string) => (
    <Row key={key} track={t} usual={catalog.artists} now={t.id === nowId} playing={playing && t.id === nowId} use={rowDoes(t.id)} from={from} fav={favs.has(t.id)} />
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
  const rowDoes = useRowUse(room, nowId);
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
              use={rowDoes(t.id)}
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

/**
 * What a row does: plays its song (alone); in a room, adds it to 待播 (the host's ＋) or asks the host for it (点歌), or
 * nothing, saying why: the song playing, one in 待播 already, or one you asked for (still to be answered)
 */
type RowUse = "play" | "add" | "ask" | "playing" | "queued" | "asked";

/** What each song's row does, by its id: as RowUse says, from the room's songs and what you asked for (nowId: the song on) */
function useRowUse(room: ListenRoom | null, nowId: string | null): (id: string) => RowUse {
  const up = useListenUpNext();
  return useMemo(() => {
    if (!room) return () => "play";
    const queued = new Set(up.ids);
    // the host's are others' (the host adds a song at once); anyone else's are their own
    const asked = new Set(room.host ? [] : room.requests.map((q) => q.song));
    const free: RowUse = room.host ? "add" : "ask";
    return (id) => (id === nowId ? "playing" : queued.has(id) ? "queued" : asked.has(id) ? "asked" : free);
  }, [room, up.ids, nowId]);
}

/** What a row that does nothing says instead (read as the row is drawn: the words are the page's language) */
const rowSays = (use: RowUse): string | null =>
  use === "playing" ? T.listen.asks.playing : use === "queued" ? T.listen.asks.inQueue : use === "asked" ? T.listen.asks.asked : null;

/**
 * A song: its place on 热播榜, its name (and its album, in 收藏 and 热播榜; its artists where they are not the list's
 * usual ones), a ♥ when it is in your 收藏 (tapped, out of it), how many times it was heard (热播榜) or how long it
 * is, ▶, ＋ or 〔点歌〕 (or, in a room, why it does nothing: 正在放, 在待播, 已申请); the one playing in red. The row is
 * tapped anywhere but its ♥ (a button over all of it, the ♥ above that).
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
  const [busy, setBusy] = useState(false);
  const sub = album ? [track.album.name, ...(own ? [track.artists.join(" / ")] : [])].join(" · ") : own ? track.artists.join(" / ") : null;
  const says = rowSays(use);
  // the button over the row says what it is; what the row shows is not said twice
  const hide = says ? undefined : true;
  const send = (go: () => Promise<boolean>) => {
    setBusy(true);
    void go().finally(() => setBusy(false));
  };
  return (
    <div className={`lp-row${now ? " now" : ""}${says ? " look" : ""}`}>
      {use === "add" && (
        <button type="button" className="lp-hit" aria-label={fmt(T.listen.add, { name: track.name })} disabled={busy} onClick={() => send(() => hostQueue({ add: track.id }))} />
      )}
      {use === "ask" && (
        <button type="button" className="lp-hit" aria-label={fmt(T.listen.asks.askLabel, { name: track.name })} disabled={busy} onClick={() => send(() => askSong(track.id))} />
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
      {says ? (
        <span className="go says">{says}</span>
      ) : use === "ask" ? (
        <span className="go ask" aria-hidden="true">
          {T.listen.asks.ask}
        </span>
      ) : (
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

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 一起听: two roaches side by side */
function TogetherIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.4 11.4C5.9 9.6 4.8 8.6 3.2 8.4M8.6 11.4c.4-1.8 1.5-2.9 3-3.1" />
      <path d="M2.5 19.5c0-4.6 2.3-7.6 5-7.6s5 3 5 7.6z" fill="currentColor" fillOpacity=".22" />
      <path d="M4.4 16.6h6.2" />
      <path d="M15.4 9.6c-.5-2-1.7-3.2-3.5-3.5M17.9 9.6c.5-2 1.7-3.2 3.5-3.5" />
      <path d="M10.8 19.5c0-5.4 2.6-8.8 5.8-8.8s5.9 3.4 5.9 8.8z" fill="currentColor" fillOpacity=".22" />
      <path d="M13 16.2h7.3" />
    </svg>
  );
}
