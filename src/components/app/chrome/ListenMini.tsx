"use client";
/* eslint-disable @next/next/no-img-element -- the albums' covers, small JPEGs of our own, which next/image would only copy */

import { useState } from "react";
import { fmt, T } from "@/i18n";
import { coverLink, type ListenRoom } from "@/lib/listen";
import RoachIcon from "../../RoachIcon";
import { AsksDot, withAsks } from "./parts";
import {
  hostQueue,
  playNext,
  roomPlace,
  setListenMiniOut,
  toggle,
  useListenHasNext,
  useListenPlayer,
  useListenRoom,
  useListenSecond,
} from "../listening";
import "./listenMini.css";

/**
 * 听歌's little bar, under the player shut (each layout's buttons along the bottom hold it; listenMini.css): the song
 * and ▶, pulled out of them or tucked back in at a handle, kept so on this device for every 界面
 */

/** A little bar pulled out this long ago or less grows into sight; one there already (the player shut, the page opened) is just there */
const GROW_MS = 700;
let pulledAt = 0;

/** The little bar pulled out of the buttons along the bottom, or tucked back in */
export function pullMini(out: boolean) {
  if (out) pulledAt = Date.now();
  setListenMiniOut(out);
}

/** What a tap goes through: 抽屉's drawer top, where a swipe moves the drawer and the tap it ends with does nothing */
type Tap = (fn: () => void) => () => void;
const asIs: Tap = (fn) => fn;

/** Those in the room, its host first, then as they came in */
const peopleOf = (room: ListenRoom) =>
  room.members.filter((m) => m.state === "in").sort((a, b) => Number(b.host) - Number(a.host) || a.h - b.h);

/** The song on and whether it plays, as the handles and the little bar show it; to the room's host, the 点歌 waiting */
function useSong() {
  const v = useListenPlayer();
  const room = useListenRoom();
  return { track: v.track, on: v.status === "playing" || v.status === "starting", room, asks: room?.host ? room.requests.length : 0 };
}

/** A small record, turning while the song plays, the song's cover its label; edged in teal in a room */
export function MiniDisc({ file, size, go, room }: { file: string | undefined; size: number; go: boolean; room: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className={`lmini-disc${go ? " go" : ""}${room ? " room" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className="spin">
        {file && broken !== file && <img src={coverLink(file)} alt="" onError={() => setBroken(file)} />}
        <span className="hole" />
      </span>
    </span>
  );
}

/**
 * The little bar, the same in every 界面: the record and the song (alone, its album under it; in a room, who is in it,
 * or to the host with 点歌 waiting, 点歌 N where their faces were), a tap on them opens the player; ▶/⏸; ⏭ alone, or
 * for the room's host (not a guest's); a thin line of how far the song is, teal in a room. tap: what each tap goes through.
 */
export function MiniStrip({ onOpen, tap = asIs }: { onOpen: () => void; tap?: Tap }) {
  const { track: t, on, room, asks } = useSong();
  const at = useListenSecond();
  const hasNext = useListenHasNext();
  const [busy, setBusy] = useState(false);
  // pulled out just now: it grows into sight (not as the player shuts, or the page opens, with it out)
  const [grow] = useState(() => Date.now() - pulledAt < GROW_MS);
  if (!t) return null;
  const people = room ? peopleOf(room) : [];
  const place = room ? roomPlace(room) : null;
  const next = async () => {
    setBusy(true);
    await hostQueue("next");
    setBusy(false);
  };
  const done = t.seconds > 0 ? Math.min(100, (Math.max(0, at) / t.seconds) * 100) : 0;
  return (
    <div className={`lmini${room ? " room-on" : ""}${grow ? " grow" : ""}`}>
      <div className="lmini-row">
        <button type="button" className="lmini-open" aria-label={withAsks(fmt(T.listen.mini.open, { name: t.name }), asks)} onClick={tap(onOpen)}>
          <MiniDisc file={t.album.cover} size={40} go={on} room={Boolean(room)} />
          <span className="lmini-tt" aria-hidden="true">
            <b>{t.name}</b>
            <small>
              {room ? (
                <>
                  {/* 点歌 waiting takes the place of their faces, so the line stays short */}
                  {asks > 0 ? (
                    <span className="badge lmini-asks">{fmt(T.listen.asks.badge, { n: asks })}</span>
                  ) : (
                    <span className="heads">
                      {people.slice(0, 4).map((m) => (
                        <RoachIcon key={m.h} color={m.card.color} size={16} avatar={m.card.avatar} />
                      ))}
                    </span>
                  )}
                  {fmt(T.listen.mini.together, { n: people.length })}
                </>
              ) : (
                t.album.name
              )}
            </small>
          </span>
        </button>
        <button type="button" className="lmini-pp" aria-label={on ? T.listen.pause : T.listen.play} onClick={tap(() => toggle())}>
          {on ? <PauseIcon /> : <PlayIcon />}
        </button>
        {!room ? (
          <button type="button" className="lmini-nx" aria-label={T.listen.next} title={T.listen.next} disabled={!hasNext} onClick={tap(() => playNext())}>
            <NextIcon />
          </button>
        ) : (
          room.host && (
            <button
              type="button"
              className="lmini-nx"
              aria-label={T.listen.next}
              title={T.listen.next}
              disabled={busy || place?.phase !== "playing"}
              onClick={tap(() => void next())}
            >
              <NextIcon />
            </button>
          )
        )}
      </div>
      <span className="lmini-line" aria-hidden="true">
        <i style={{ width: `${done}%` }} />
      </span>
    </div>
  );
}

/**
 * 浮岛's handle, on the middle of the bottom bar's top edge and one piece with it (two curves join it to the bar, the
 * bar's edge left out under them, chrome.css): tucked, the turning record, the song and ⌃; pulled out, only ⌄
 */
export function FloatMiniTab({ out }: { out: boolean }) {
  const { track: t, on, room, asks } = useSong();
  if (!t) return null;
  return (
    <span className={`lmini-tabw${out ? " out" : ""}${room ? " room-on" : ""}`} data-chrome-bottom>
      <span className="lmini-curve l" aria-hidden="true" />
      <button
        type="button"
        className="lmini-tab"
        aria-expanded={out}
        aria-label={out ? T.listen.mini.tuck.float : withAsks(fmt(T.listen.mini.pull.float, { name: t.name }), asks)}
        onClick={() => pullMini(!out)}
      >
        {out ? (
          <ChevIcon dir="down" />
        ) : (
          <>
            <MiniDisc file={t.album.cover} size={16} go={on} room={Boolean(room)} />
            <span className="tt">{t.name}</span>
            <ChevIcon dir="up" />
          </>
        )}
      </button>
      <span className="lmini-curve r" aria-hidden="true" />
      {/* at the tab's corner, out of its edge's clip (pulled out, the little bar says it) */}
      {!out && <AsksDot n={asks} />}
    </span>
  );
}

/**
 * 抽屉's handle on a phone: a capsule at the left of the drawer's top row (nothing pokes out over the map, whose foot
 * shows Amap's mark); its taps go through the drawer's swipe
 */
export function DrawerMiniPill({ out, tap }: { out: boolean; tap: Tap }) {
  const { track: t, on, room, asks } = useSong();
  if (!t) return null;
  return (
    <button
      type="button"
      className={`lmini-pill${out ? " out" : ""}`}
      aria-expanded={out}
      aria-label={out ? T.listen.mini.tuck.drawer : withAsks(fmt(T.listen.mini.pull.drawer, { name: t.name }), asks)}
      onClick={tap(() => pullMini(!out))}
    >
      {out ? (
        <>
          <ChevIcon dir="down" />
          <span className="tt" aria-hidden="true">
            {T.listen.mini.tuckWord}
          </span>
        </>
      ) : (
        <>
          <MiniDisc file={t.album.cover} size={14} go={on} room={Boolean(room)} />
          <span className="tt" aria-hidden="true">
            {t.name}
          </span>
          <ChevIcon dir="up" />
          <AsksDot n={asks} />
        </>
      )}
    </button>
  );
}

/** 游戏风's handle: a round button between 触须之交 and 我的蟑螂, the turning record in it and the song under it */
export function HudMiniRound({ out }: { out: boolean }) {
  const { track: t, on, room, asks } = useSong();
  if (!t) return null;
  return (
    <span className="rb lmini-rb">
      <button
        type="button"
        className="ob glass"
        aria-expanded={out}
        aria-label={out ? T.listen.mini.tuck.hud : withAsks(fmt(T.listen.mini.pull.hud, { name: t.name }), asks)}
        onClick={() => pullMini(!out)}
      >
        {out ? (
          <ChevIcon dir="down" />
        ) : (
          <>
            <MiniDisc file={t.album.cover} size={30} go={on} room={Boolean(room)} />
            <AsksDot n={asks} />
          </>
        )}
      </button>
      <span className="lbl" aria-hidden="true">
        {out ? T.listen.mini.tuckWord : t.name}
      </span>
    </span>
  );
}

function ChevIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d={dir === "up" ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 5.2v13.6L15 12z" fill="currentColor" />
      <rect x="16.2" y="5.2" width="2.8" height="13.6" rx="1" fill="currentColor" />
    </svg>
  );
}
