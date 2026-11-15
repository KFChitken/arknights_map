"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmt, localPath, T } from "@/i18n";
import { clock, LISTEN_FULL, songMatches, type ListenAlbum, type ListenCatalog, type ListenTrack } from "@/lib/listen";
import { useWide } from "./chrome/parts";
import { loadSongs, markIntro, playTrack, toggle, useListenIntro, useListenPlayer, useListenSecond, useListenSongs } from "./listening";
import Sheet from "./Sheet";
import "./listen.css";

/**
 * 听歌's panel: the player along its top, and the songs under it: 新歌, then album by album in the order of the Monster
 * Siren Records site, with a search over the songs' and albums' names. On a phone a sheet from the bottom; on a
 * computer a panel at the left, over the map but clear of its middle, which can be looked round meanwhile. Songs go
 * on playing with it closed (src/components/app/listening.ts).
 */
export default function ListenPanel({ paused, onClose }: { paused: boolean; onClose: () => void }) {
  const wide = useWide();
  useEffect(() => {
    loadSongs();
    markIntro("opened");
  }, []);
  const foot = <p className="lp-foot">{T.listen.copyright}</p>;
  if (!wide) {
    return (
      <Sheet title={T.listen.title} className="listen-sheet" onClose={onClose} footer={foot}>
        <ListenBody paused={paused} />
      </Sheet>
    );
  }
  return (
    <FloatPanel onClose={onClose}>
      <div className="lp-scroll">
        <ListenBody paused={paused} />
      </div>
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

function ListenBody({ paused }: { paused: boolean }) {
  const list = useListenSongs();
  const intro = useListenIntro();
  const [query, setQuery] = useState("");
  // the list follows the typing a moment behind, so the box itself never waits on a long list
  const q = useDeferredValue(query.trim());
  return (
    <div className="lp">
      <div className="lp-top">
        <Player paused={paused} />
        {intro !== "ok" && <PrivacyLine />}
        {list.state === "ok" && list.tracks.size > 0 && (
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
      {list.state === "ok" ? (
        list.tracks.size > 0 ? (
          <SongList key={q} catalog={list.catalog} tracks={list.tracks} query={q} />
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

/** Albums drawn at first, and as many more each time the list is scrolled near its end */
const ALBUMS_AT_ONCE = 24;

/** 新歌, then each album; while searching, the albums with a song found (all of an album found by its own name) */
function SongList({ catalog, tracks, query }: { catalog: ListenCatalog; tracks: Map<string, ListenTrack>; query: string }) {
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
  const row = (t: ListenTrack, key: string) => (
    <Row key={key} track={t} usual={catalog.artists} now={t.id === nowId} playing={playing && t.id === nowId} />
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

/** A song: its name (and its artists where they are not the list's usual ones), how long, ▶; the one playing in red */
function Row({ track, usual, now, playing }: { track: ListenTrack; usual: string[]; now: boolean; playing: boolean }) {
  const own = track.artists.join() !== usual.join();
  return (
    <button
      className={`lp-row${now ? " now" : ""}`}
      aria-label={fmt(now ? T.listen.nowSong : T.listen.playSong, { name: track.name })}
      // the one playing pauses, as its ⏸ says; paused, it goes on from where it got to
      onClick={() => (now ? toggle() : playTrack(track))}
    >
      <span className="nm">
        {track.name}
        {own && <small>{track.artists.join(" / ")}</small>}
      </span>
      <span className="dur">{clock(track.seconds)}</span>
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
