"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmt, localPath, T } from "@/i18n";
import {
  clock,
  INVITES_PER_DAY,
  LISTEN_FULL,
  RX_ROWS,
  songMatches,
  type InviteSent,
  type ListenAlbum,
  type ListenCatalog,
  type ListenFriend,
  type ListenRoom,
  type ListenTrack,
} from "@/lib/listen";
import RoachIcon from "../RoachIcon";
import { useWide } from "./chrome/parts";
import type { ListenInvite } from "./ListenOverlay";
import {
  hostQueue,
  inviteMore,
  leaveListen,
  listenFriendsList,
  loadSongs,
  markIntro,
  openRoomWith,
  playTrack,
  roomPlace,
  sendRx,
  toggle,
  useListenIntro,
  useListenPlayer,
  useListenRoom,
  useListenRoomEnd,
  useListenRx,
  useListenSecond,
  useListenSongs,
  type ListenPlayer,
  type ListenSongs,
} from "./listening";
import Sheet from "./Sheet";
import "./listen.css";

/** The panel's two tabs: 一起听, and the songs (方舟) */
export type ListenTab = "together" | "ark";

/**
 * 听歌's panel: its two tabs, the player along its top, and under it either 一起听 (inviting 触须之交, the room you are
 * in, its 短评) or the songs: 新歌, then album by album in the order of the Monster Siren Records site, with a search
 * over the songs' and albums' names. On a phone a sheet from the bottom; on a computer a panel at the left, over the
 * map but clear of its middle, which can be looked round meanwhile. Songs go on playing with it closed
 * (src/components/app/listening.ts).
 */
export default function ListenPanel({
  paused,
  roomMax,
  mode,
  tab,
  onTab,
  invite,
  onJoin,
  onLater,
  onClose,
}: {
  /** The 站长 paused 听歌 for now */
  paused: boolean;
  /** How many a room may hold, and whom you may invite (admins: the 站长 and admins alone) */
  roomMax: number;
  mode: "admins" | "on";
  tab: ListenTab;
  onTab: (tab: ListenTab) => void;
  /** An invitation to you still to answer (the card on the map has it too) */
  invite: ListenInvite | null;
  /** Within the tap (it may start a song) */
  onJoin: (invite: ListenInvite) => void;
  onLater: (invite: ListenInvite) => void;
  onClose: () => void;
}) {
  const wide = useWide();
  useEffect(() => {
    loadSongs();
    markIntro("opened");
  }, []);
  const foot = <p className="lp-foot">{T.listen.copyright}</p>;
  const body = (
    <ListenBody paused={paused} roomMax={roomMax} mode={mode} tab={tab} onTab={onTab} invite={invite} onJoin={onJoin} onLater={onLater} />
  );
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
      if (e.key === "Escape" && !document.querySelector(".sheet-backdrop")) onClose();
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
  invite: ListenInvite | null;
  onJoin: (invite: ListenInvite) => void;
  onLater: (invite: ListenInvite) => void;
};

function ListenBody({ paused, roomMax, mode, tab, onTab, invite, onJoin, onLater }: BodyProps) {
  const list = useListenSongs();
  const intro = useListenIntro();
  const room = useListenRoom();
  const [query, setQuery] = useState("");
  // another tab starts at its top
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.closest(".sheet-body, .lp-scroll")?.scrollTo({ top: 0 });
  }, [tab]);
  // the list follows the typing a moment behind, so the box itself never waits on a long list
  const q = useDeferredValue(query.trim());
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
          <input
            className="lp-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={T.listen.search}
            aria-label={T.listen.search}
            enterKeyHint="search"
          />
        )}
      </div>
      {tab === "together" ? (
        <Together paused={paused} roomMax={roomMax} mode={mode} invite={invite} onJoin={onJoin} onLater={onLater} onTab={onTab} />
      ) : list.state === "ok" ? (
        list.tracks.size > 0 ? (
          <>
            {room && <p className="lp-note small">{room.host ? T.listen.addNote : T.listen.hostPicks}</p>}
            <SongList key={q} catalog={list.catalog} tracks={list.tracks} query={q} room={room} />
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

/** The song playing (or the last one, or the one to go on with), ▶ or ⏸, and how far it got; before any, a line */
function Player({ paused }: { paused: boolean }) {
  const v = useListenPlayer();
  const at = useListenSecond();
  const t = v.track;
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
  return (
    <div className="lp-player">
      <span className="lp-cover" aria-hidden="true">
        {T.listen.cover}
      </span>
      <span className="lp-what">
        <b>{t.name}</b>
        <small>
          {t.album.name} · {t.artists.join(" / ")}
        </small>
      </span>
      <button className="lp-btn" aria-label={on ? T.listen.pause : T.listen.play} onClick={() => toggle()}>
        {on ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="lp-bar">
        <span>{clock(at)}</span>
        <span className="track">
          <span className="fill" style={{ width: `${done}%` }} />
        </span>
        <span>{clock(t.seconds)}</span>
      </span>
      {note && (
        <span className={`lp-hint${v.problem ? " bad" : ""}`} role="status">
          {note}
        </span>
      )}
    </div>
  );
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

/** 一起听's tab: the room you are in, or the way to open one (and an invitation to you, while it is good) */
function Together({
  paused,
  roomMax,
  mode,
  invite,
  onJoin,
  onLater,
  onTab,
}: Omit<BodyProps, "tab">) {
  const room = useListenRoom();
  const over = useListenRoomEnd();
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 8_000);
    return () => window.clearTimeout(t);
  }, [note]);
  const done = (said: string | null) => {
    setPicking(false);
    if (said) setNote(said);
  };
  if (picking && (!room || room.host)) return <Picker room={room} roomMax={roomMax} mode={mode} onDone={done} />;
  if (room) return <RoomView room={room} note={note} onInvite={() => setPicking(true)} onPick={() => onTab("ark")} />;
  return (
    <div className="lt">
      {invite && (
        <div className="lr-now">
          <span className="lbl">{fmt(T.listen.invitedYou, { name: invite.from.displayName })}</span>
          <b>{invite.song}</b>
          <small>{fmt(T.listen.inviteFor, { n: invite.n })}</small>
          <button className="lt-big" onClick={() => onJoin(invite)}>
            {T.listen.join}
          </button>
          <button className="lt-big ghost" onClick={() => onLater(invite)}>
            {T.listen.later}
          </button>
        </div>
      )}
      {note && <p className="lr-said">{note}</p>}
      <p className="lp-note left">{T.listen.togetherIntro}</p>
      <button className="lt-big" disabled={paused} onClick={() => setPicking(true)}>
        {T.listen.inviteFriends}
      </button>
      <p className="lp-note left small">{fmt(T.listen.togetherNote, { max: roomMax, n: INVITES_PER_DAY })}</p>
      {!invite && <p className="lp-note left small">{over ?? T.listen.noOne}</p>}
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
      {!room && <p className="lp-note left small">{fmt(T.listen.togetherNote, { max: roomMax, n: INVITES_PER_DAY })}</p>}
    </div>
  );
}

/** The room you are in: who is in it, what plays, the host's buttons, what comes next, and the 短评 */
function RoomView({ room, note, onInvite, onPick }: { room: ListenRoom; note: string | null; onInvite: () => void; onPick: () => void }) {
  const list = useListenSongs();
  const v = useListenPlayer();
  const second = useListenSecond();
  const [busy, setBusy] = useState(false);
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
        {room.members.map((m) => (
          <span key={`m${m.h}`} className={`lr-pp ${m.state}`} title={m.card.displayName}>
            <span className="lp-av">
              <RoachIcon color={m.card.color} size={30} avatar={m.card.avatar} friend={m.friend} />
            </span>
            <b>{m.card.displayName}</b>
            <small>{label(m)}</small>
          </span>
        ))}
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
        </div>
      )}
      <p className="lr-queue">{nextNames.length ? fmt(T.listen.upNext, { songs: nextNames.join(" · ") }) : T.listen.upNone}</p>
      <RxChips />
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

/** 新歌, then each album; while searching, the albums with a song found (all of an album found by its own name) */
function SongList({
  catalog,
  tracks,
  query,
  room,
}: {
  catalog: ListenCatalog;
  tracks: Map<string, ListenTrack>;
  query: string;
  room: ListenRoom | null;
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
    <Row key={key} track={t} usual={catalog.artists} now={t.id === nowId} playing={playing && t.id === nowId} use={use} />
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
          <h3>{g.album.name}</h3>
          {g.songs.map((t) => row(t, t.id))}
        </section>
      ))}
      {more && <div ref={end} className="lp-end" aria-hidden="true" />}
    </div>
  );
}

const songsOf = (album: ListenAlbum, tracks: Map<string, ListenTrack>) =>
  album.songs.map((s) => tracks.get(s.id)).filter((t): t is ListenTrack => Boolean(t));

/** What a row does: plays its song, adds it to the room's (the host's ＋), or nothing (someone else's room) */
type RowUse = "play" | "add" | "look";

/** A song: its name (and its artists where they are not the list's usual ones), how long, ▶ or ＋; the one playing in red */
function Row({ track, usual, now, playing, use }: { track: ListenTrack; usual: string[]; now: boolean; playing: boolean; use: RowUse }) {
  const own = track.artists.join() !== usual.join();
  const [adding, setAdding] = useState(false);
  const inner = (
    <>
      <span className="nm">
        {track.name}
        {own && <small>{track.artists.join(" / ")}</small>}
      </span>
      <span className="dur">{clock(track.seconds)}</span>
    </>
  );
  if (use === "look") return <div className={`lp-row${now ? " now" : ""}`}>{inner}</div>;
  if (use === "add") {
    return (
      <button
        className={`lp-row${now ? " now" : ""}`}
        aria-label={fmt(T.listen.add, { name: track.name })}
        disabled={adding}
        onClick={() => {
          setAdding(true);
          void hostQueue({ add: track.id }).finally(() => setAdding(false));
        }}
      >
        {inner}
        <span className="go add" aria-hidden="true">
          {T.listen.plus}
        </span>
      </button>
    );
  }
  return (
    <button
      className={`lp-row${now ? " now" : ""}`}
      aria-label={fmt(now ? T.listen.nowSong : T.listen.playSong, { name: track.name })}
      // the one playing pauses, as its ⏸ says; paused, it goes on from where it got to
      onClick={() => (now ? toggle() : playTrack(track))}
    >
      {inner}
      <span className="go" aria-hidden="true">
        {playing ? <PauseIcon /> : <PlayIcon />}
      </span>
    </button>
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
