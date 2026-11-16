"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt, T } from "@/i18n";
import { clock, roomAt, RANDOM_ADD, type HotSong, type ListenTrack } from "@/lib/listen";
import { listenApi } from "@/lib/listenClient";
import type { SquadRoom, SquadSongChange } from "@/lib/squad";
import { dropSquadRequest, requestSquadSong, squadSongsChange, takeSquadRequest } from "./squading";
import { followSquad, loadSquadTracks, setSquadLite, unfollowSquad, useSquadLite, useSquadMusic, useSquadTracks } from "./squadMusic";

/**
 * The host's songs in a room of 一起卫戍 (src/components/app/squad/squadMusic.ts): to everyone, what plays (or that
 * nothing does) and 跟着听 / 不听 for themselves, and on a phone that the game stops the page's sound; to the others,
 * 点歌 and their own songs still waiting; to the host, 放歌, ⏭, 随机加, 停 and the seek bar, how many listen, and the
 * songs asked for, to take or drop. Only where the server lets this player hear them (dj).
 */
export default function DjBar({
  room,
  busy,
  run,
}: {
  room: SquadRoom;
  busy: boolean;
  run: <R>(fn: () => Promise<R>) => Promise<R | undefined>;
}) {
  const tracks = useSquadTracks();
  const music = useSquadMusic();
  const lite = useSquadLite();
  const [picking, setPicking] = useState<"start" | "add" | "ask" | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    void loadSquadTracks();
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  // the room's clock: the server's when the room came, gone on since here
  const offset = useMemo(() => room.now - Date.now(), [room.now]);
  if (!room.dj) return null;
  const seconds = (id: string) => tracks?.get(id)?.seconds ?? Number.NaN;
  const at = tracks ? roomAt(room, seconds, Date.now() + offset) : null;
  const playing = at?.phase === "playing" ? at : null;
  const id = playing ? room.queue[playing.i] : at?.phase === "done" ? room.queue[room.queue.length - 1] : (room.queue[room.idx] ?? null);
  const track = id ? (tracks?.get(id) ?? null) : null;
  const later = playing ? room.queue.length - playing.i - 1 : 0;
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const change = (c: SquadSongChange) => run(() => squadSongsChange(c));

  const title = playing && track ? track.name : room.queue.length === 0 ? (room.host ? T.squad.dj.hostNone : T.squad.dj.none) : at?.phase === "done" ? T.squad.dj.done : T.squad.dj.stopped;
  const sub = room.host
    ? room.queue.length === 0
      ? T.squad.dj.hostNoneSub
      : [room.listening !== null ? fmt(T.squad.dj.listening, { n: room.listening, m: room.members.length }) : "", later > 0 ? fmt(T.squad.dj.more, { n: later }) : ""].filter(Boolean).join(T.squad.dot)
    : room.queue.length === 0
      ? T.squad.dj.noneSub
      : music.following
        ? T.squad.dj.on
        : T.squad.dj.off;
  const asked = room.requests.filter(() => !room.host);
  return (
    <div className="sq-dj">
      <div className="top">
        <span className={`cover${playing ? "" : " off"}`} aria-hidden="true">
          ♪
        </span>
        <span className="t">
          <b>{title}</b>
          <small>{music.problem ?? (playing && playing.offset < 0 ? T.squad.dj.between : sub)}</small>
        </span>
        <span className="acts">
          {room.queue.length > 0 &&
            (music.following ? (
              <button className="small ghost" onClick={unfollowSquad}>
                {T.squad.dj.unfollow}
              </button>
            ) : (
              <button className="small dark" onClick={followSquad}>
                {T.squad.dj.follow}
              </button>
            ))}
          {!room.host && (
            <button className="small ghost" disabled={busy} onClick={() => setPicking("ask")}>
              {T.squad.dj.ask}
            </button>
          )}
        </span>
      </div>
      {playing && track && <Progress track={track} at={Math.max(0, playing.offset)} host={room.host} busy={busy} onSeek={(s) => void change({ seek: s })} />}
      {touch && room.queue.length > 0 && <p className="phone">{T.squad.dj.phone}</p>}
      {music.following && (
        <label className="lite">
          <input type="checkbox" checked={lite} onChange={(e) => setSquadLite(e.target.checked)} />
          {T.squad.dj.lite}
        </label>
      )}
      {room.host && (
        <div className="host">
          {room.queue.length === 0 || (at && at.phase !== "playing") ? (
            <>
              <button className="small dark" disabled={busy} onClick={() => setPicking("start")}>
                {T.squad.dj.play}
              </button>
              {room.queue.length > 0 && at?.phase === "ready" && (
                <button className="small" disabled={busy} onClick={() => void change("start")}>
                  {T.squad.dj.resume}
                </button>
              )}
            </>
          ) : (
            <>
              <button className="small" disabled={busy || later < 1} onClick={() => void change("next")}>
                {T.squad.dj.next}
              </button>
              <button className="small ghost" disabled={busy} onClick={() => setPicking("add")}>
                {T.squad.dj.add}
              </button>
              <button className="small ghost" disabled={busy} onClick={() => void change("random")}>
                {fmt(T.squad.dj.random, { n: RANDOM_ADD })}
              </button>
              <button className="small ghost" disabled={busy} onClick={() => void change("stop")}>
                {T.squad.dj.stop}
              </button>
            </>
          )}
        </div>
      )}
      {room.host && room.requests.length > 0 && (
        <div className="reqs">
          <div className="lab">{T.squad.dj.requests}</div>
          {room.requests.map((r) => (
            <div key={r.id} className="req">
              <span>
                {tracks?.get(r.song)?.name ?? r.song}
                <small>{fmt(T.squad.dj.askedBy, { name: r.name ?? "" })}</small>
              </span>
              <button className="small dark" disabled={busy} onClick={() => void run(() => takeSquadRequest(r.id))}>
                {T.squad.dj.take}
              </button>
              <button className="small ghost" disabled={busy} onClick={() => void run(() => dropSquadRequest(r.id))}>
                {T.squad.dj.drop}
              </button>
            </div>
          ))}
        </div>
      )}
      {asked.length > 0 && (
        <p className="asked">{fmt(T.squad.dj.asked, { songs: asked.map((r) => fmt(T.squad.dj.songName, { name: tracks?.get(r.song)?.name ?? r.song })).join(" ") })}</p>
      )}
      {picking && (
        <SongPicker
          mode={picking}
          tracks={tracks}
          busy={busy}
          onPick={async (song) => {
            if (picking === "ask") {
              if (await run(() => requestSquadSong(song))) setPicking(null);
              return;
            }
            const r = await run(() => squadSongsChange({ add: song }));
            if (!r) return;
            // added with nothing playing yet (or stopped): it starts now
            if (picking === "start" && r.startedAt === null) await run(() => squadSongsChange("start"));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** How far the song is, and to the host a bar to move everyone to another second of it */
function Progress({ track, at, host, busy, onSeek }: { track: ListenTrack; at: number; host: boolean; busy: boolean; onSeek: (s: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? at;
  return (
    <div className="prog">
      <span>{clock(Math.floor(shown))}</span>
      {host ? (
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(track.seconds))}
          value={Math.min(Math.floor(shown), Math.floor(track.seconds))}
          disabled={busy}
          aria-label={T.squad.dj.seek}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => {
            if (drag !== null) onSeek(drag);
            setDrag(null);
          }}
          onKeyUp={() => {
            if (drag !== null) onSeek(drag);
            setDrag(null);
          }}
        />
      ) : (
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, (shown / Math.max(1, track.seconds)) * 100).toFixed(1)}%` }} />
        </span>
      )}
      <span>{clock(Math.floor(track.seconds))}</span>
    </div>
  );
}

type View = "all" | "fav" | "hot";

/** The songs of 听歌's library to pick one from: all of them, your 收藏, 热播榜, or by name */
function SongPicker({
  mode,
  tracks,
  busy,
  onPick,
  onClose,
}: {
  mode: "start" | "add" | "ask";
  tracks: Map<string, ListenTrack> | null;
  busy: boolean;
  onPick: (song: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [favs, setFavs] = useState<string[] | null>(null);
  const [hot, setHot] = useState<HotSong[] | null>(null);
  useEffect(() => {
    if (view === "fav" && !favs) listenApi.favs().then((r) => setFavs(r.favs), () => setFavs([]));
    if (view === "hot" && !hot) listenApi.hot().then((r) => setHot(r.hot), () => setHot([]));
  }, [view, favs, hot]);
  const ids: string[] | null = !tracks ? null : view === "all" ? [...tracks.keys()] : view === "fav" ? favs : hot ? hot.map((h) => h.song) : null;
  const needle = q.trim().toLowerCase();
  const shown = (ids ?? []).map((id) => tracks?.get(id)).filter((t): t is ListenTrack => Boolean(t) && (!needle || t!.name.toLowerCase().includes(needle)));
  const verb = mode === "ask" ? T.squad.dj.pick.askThis : mode === "add" ? T.squad.dj.pick.addThis : T.squad.dj.pick.playThis;
  const title = mode === "ask" ? T.squad.dj.pick.ask : mode === "add" ? T.squad.dj.pick.add : T.squad.dj.pick.start;
  return (
    <div className="sq-ask-bg" onClick={onClose}>
      <div className="sq-ask sq-pick" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="hint">{mode === "ask" ? T.squad.dj.pick.askNote : T.squad.dj.pick.note}</p>
        <div className="chips">
          {(["all", "fav", "hot"] as const).map((v) => (
            <button key={v} type="button" className={`chip${view === v ? " on" : ""}`} aria-pressed={view === v} onClick={() => setView(v)}>
              {T.squad.dj.pick[v]}
            </button>
          ))}
        </div>
        <input className="search" type="search" placeholder={T.squad.dj.pick.search} aria-label={T.squad.dj.pick.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="songs">
          {!ids ? (
            <p className="hint">{T.squad.dj.pick.loading}</p>
          ) : !shown.length ? (
            <p className="hint">{T.squad.dj.pick.empty}</p>
          ) : (
            shown.slice(0, 200).map((t) => (
              <div key={t.id} className="song">
                <span>
                  {t.name}
                  <small>{clock(Math.floor(t.seconds))}</small>
                </span>
                <button className="small dark" disabled={busy} onClick={() => onPick(t.id)}>
                  {verb}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="row">
          <button className="ghost grow" onClick={onClose}>
            {T.squad.dj.pick.close}
          </button>
        </div>
      </div>
    </div>
  );
}
