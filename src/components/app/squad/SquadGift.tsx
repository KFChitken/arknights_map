"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import { readDance, type DanceBeats } from "@/lib/dance";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { GIFT_GAP_MS, GIFT_HOLD_MS, GIFT_ROUNDS, giftAt, type DanceSong, type GiftMode, type GiftRound } from "@/lib/squadMode";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import { WorldError } from "@/lib/world/types";
import { beatAt } from "../../disco/clock";
import { picOf } from "../fish/words";
import { isListening, listenLiteNow, listenTap, useListenPlayer } from "../listening";
import { keepMusicWanted, musicWanted, musicWords, useDanceMusic, type DanceMusic } from "./SquadDance";
import { SquadRoach } from "./SquadRoach";
import { closeSquadModeCard, squadDanceSong, squadGiftPass, squadModeIn, squadServerNow, useSquadModeCard, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * W 的礼物 (玩点什么, src/lib/squadMode.ts), its card at the map's foot as 龙门广场舞's is. A drum in the middle,
 * beating to the song (its table of beats, as the dance's), and four seats about it, yours at the foot (the others
 * as the gift goes: left, top, right); the gift, its fuse lit, by the one holding it, as the passes, the two seconds
 * and the 人机's own time move it (giftAt, the server's rule, here too); a ring running down by you while it is in your
 * hands, and 传. When the song stops (the room told), 砰 by the one hit, turned over, 漏勺 on the head, and a line
 * saying so; the next round comes by itself. After the fifth, how often each was hit. One watching joins from the
 * next round. The music is the dance's (its own switch, silent while 听歌 plays), playing only while a round goes.
 */

/** The page's clock is looked at this often while the card is open */
const TICK_MS = 100;
/** With no beats, the drum beats this often (s) */
const FREE_BEAT_S = 0.5;

/** Where W 的礼物 is now (on the server's clock): before its first round, a round going, its 砰 showing, the results */
export type GiftPhase = { at: "lead"; r: number } | { at: "round"; r: number } | { at: "boom"; r: number } | { at: "results" };
export function giftPhase(mode: GiftMode, now: number): GiftPhase {
  const rounds = mode.rounds;
  if (!rounds.length) return { at: "results" };
  if (now < rounds[0].at) return { at: "lead", r: 0 };
  const r = Math.max(0, rounds.findLastIndex((x) => x.at <= now));
  const round = rounds[r];
  if (round.hit === undefined || round.stop === undefined) return { at: "round", r };
  if (r >= GIFT_ROUNDS - 1 && now >= round.stop + GIFT_GAP_MS) return { at: "results" };
  return { at: "boom", r };
}

/** Who sits in a seat (by number): one of the room (a player, or one of its 人机), or one of the mode's own 人机 */
export function seatOf(room: SquadRoom, mode: GiftMode, h: number): SquadMember | null {
  const m = room.members.find((x) => x.h === h);
  if (m) return m;
  const b = mode.bots.find((x) => x.h === h);
  if (!b) return null;
  return {
    h,
    name: fmt(T.squad.bot.name, { n: b.no }),
    host: false,
    you: false,
    friend: false,
    inGame: true,
    pose: 0,
    avatar: b.avatar as RoachAvatar,
    color: b.color as RoachColor,
    core: 0,
    strategy: null,
    extras: [],
    bot: true,
  };
}
const nameOf = (m: SquadMember | null) => (m?.you ? T.squad.room.you : (m?.name ?? ""));

/** The line under the drum once a round's song stopped: who was hit, and whether 漏勺 goes on their head */
export function hitLine(room: SquadRoom, mode: GiftMode, round: GiftRound): string {
  const t = T.squad.gift;
  const h = round.seats[round.hit ?? 0];
  const m = seatOf(room, mode, h);
  if (h < 0 || !m) return fmt(t.hitBot, { name: nameOf(m) });
  if (mode.in.length < 2) return m.you ? t.hitPractice : fmt(t.hitBot, { name: nameOf(m) });
  return m.you ? t.hitYou : fmt(t.hit, { name: nameOf(m) });
}

/** How often each who sat in it was hit, most first, those never hit last */
export function giftHits(room: SquadRoom, mode: GiftMode) {
  const hits = new Map<number, number>();
  for (const r of mode.rounds) {
    for (const h of r.seats) hits.set(h, hits.get(h) ?? 0);
    if (r.hit !== undefined) hits.set(r.seats[r.hit], (hits.get(r.seats[r.hit]) ?? 0) + 1);
  }
  return [...hits]
    .flatMap(([h, n]) => {
      const m = seatOf(room, mode, h);
      return m ? [{ m, n }] : [];
    })
    .sort((a, b) => b.n - a.n || Number(a.m.h < 0) - Number(b.m.h < 0) || a.m.h - b.m.h);
}

/** The gift: a box with its fuse lit */
function Gift() {
  return (
    <svg className="box" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path d="M15 11 Q14 5 19 3" stroke="#3a3f47" strokeWidth="1.6" fill="none" />
      <circle className="spark" cx="20" cy="3" r="2.6" fill="#ffb000" />
      <rect x="4" y="12" width="22" height="16" rx="2" fill="#d2342a" />
      <rect x="13" y="12" width="4" height="16" fill="#ffd23f" />
      <rect x="4" y="17" width="22" height="4" fill="#ffd23f" />
      <ellipse cx="11" cy="11" rx="4" ry="2.6" fill="#ffd23f" />
      <ellipse cx="19" cy="11" rx="4" ry="2.6" fill="#ffd23f" />
    </svg>
  );
}

/** The ring running down by you while the gift is in your hands, from when you got it (set as it shows) */
function Ring({ since, now }: { since: number; now: number }) {
  const [delay] = useState(() => Math.min(0, since - now));
  return (
    <svg className="ring" width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
      <circle cx="34" cy="34" r="24" fill="none" strokeWidth="3" strokeDasharray="151" strokeLinecap="round" transform="rotate(-90 34 34)" style={{ animationDuration: `${GIFT_HOLD_MS}ms`, animationDelay: `${delay}ms` }} />
    </svg>
  );
}

/** The card as it shows, for the room and its gift as they are now (on the server's clock) */
export function GiftView({
  room,
  mode,
  now,
  music,
  busy,
  msg,
  drumRef,
  onClose,
  onPass,
  onPassClick,
  onJoin,
  onMusic,
  onLeave,
}: {
  room: SquadRoom;
  mode: GiftMode;
  now: number;
  music: DanceMusic;
  busy: boolean;
  msg: string | null;
  drumRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** 传, as a finger or the mouse goes down on it */
  onPass: () => void;
  /** 传 clicked: by a key (detail 0), a pass of its own; else after the finger's, where the music may start */
  onPassClick: (byKey: boolean) => void;
  onJoin: () => void;
  onMusic: () => void;
  onLeave: () => void;
}) {
  const t = T.squad.gift;
  const phase = giftPhase(mode, now);
  const me = mode.in.some((m) => m.h === room.you);
  const r = phase.at === "results" ? mode.rounds.length - 1 : phase.r;
  const round = mode.rounds[r];
  const mine = round ? round.seats.indexOf(room.you) : -1;
  const held = phase.at === "round" && round ? giftAt(round, mode.seed, r, now) : null;
  const holder = phase.at === "lead" ? round?.from : held?.seat;
  const yours = held !== null && held.seat === mine && mine >= 0;
  const next = mode.rounds[r + 1];
  const head =
    phase.at === "lead"
      ? fmt(t.startsIn, { s: Math.max(1, Math.ceil(((round?.at ?? now) - now) / 1000)) })
      : phase.at === "results"
        ? t.done
        : fmt(t.count, { n: r + 1, of: GIFT_ROUNDS });
  const drum = phase.at === "round" ? (mode.name ? fmt(t.drum, { name: mode.name }) : t.drumFree) : phase.at === "lead" ? t.drumFree : t.stopped;
  const mw = musicWords(music);
  let button: { text: string; on: boolean; join?: boolean } | null = null;
  if (phase.at !== "results") {
    if (!me) button = { text: t.join, on: !busy, join: true };
    else if (phase.at === "lead") button = { text: fmt(t.startIn, { s: Math.max(1, Math.ceil((round.at - now) / 1000)) }), on: false };
    else if (phase.at === "boom") button = { text: next ? fmt(t.nextIn, { s: Math.max(1, Math.ceil((next.at - now) / 1000)) }) : t.waiting, on: false };
    else button = yours ? { text: t.pass, on: true } : { text: t.waiting, on: false };
  }
  return (
    <div className="sq-gift" role="dialog" aria-label={t.title}>
      <header>
        <b>{head}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      {phase.at === "results" ? (
        <div className="results">
          <h3>{t.results}</h3>
          <ol>
            {giftHits(room, mode).map(({ m, n }) => (
              <li key={m.h} className={m.you ? "you" : ""}>
                <SquadRoach m={{ ...m, pose: 0 }} size={28} />
                <span className="nm">{nameOf(m)}</span>
                {m.bot && <em>{T.squad.bot.tag}</em>}
                <b>{n ? fmt(t.hits, { n }) : t.none}</b>
              </li>
            ))}
          </ol>
          {mode.in.length < 2 && <p className="end">{t.practice}</p>}
        </div>
      ) : (
        <div className="stage">
          <span className="song">{drum}</span>
          <div className={`drum${phase.at === "round" ? " on" : ""}`} ref={drumRef} aria-hidden="true">
            <svg width="110" height="110" viewBox="0 0 110 110">
              <rect x="18" y="38" width="74" height="46" fill="#c8372a" />
              <ellipse cx="55" cy="84" rx="37" ry="12" fill="#a32a20" />
              <ellipse cx="55" cy="38" rx="37" ry="12" fill="#f3e2c4" stroke="#7a2018" strokeWidth="3" />
              <path d="M22 46 L40 80 M50 48 L60 84 M70 46 L88 80" stroke="#f4c040" strokeWidth="2" />
              <text x="55" y="43" textAnchor="middle" fontSize="13" fontWeight="900" fill="#7a2018">
                {t.dong}
              </text>
            </svg>
          </div>
          {round?.seats.map((h, i) => {
            const m = seatOf(room, mode, h);
            if (!m) return null;
            const pos = (i - Math.max(0, mine) + round.seats.length) % round.seats.length;
            const hit = phase.at === "boom" && round.hit === i;
            return (
              <span key={h} className={`gseat p${pos}${m.you ? " you" : ""}`}>
                <span className="gw">
                  <span className={`body${hit ? " hit" : ""}`}>
                    <SquadRoach m={{ ...m, pose: 0 }} size={56} />
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 漏勺's small picture, as 扔东西 draws it on a head */}
                  {hit && <img className="ladle" src={picOf("ladle")} alt="" />}
                  {hit && <span className="bang">{t.boom}</span>}
                  {holder === i && <Gift />}
                  {yours && i === mine && held && <Ring key={held.since} since={held.since} now={now} />}
                </span>
                <span className="nm">
                  {nameOf(m)}
                  {m.bot && <em>{T.squad.bot.tag}</em>}
                </span>
              </span>
            );
          })}
          {phase.at === "boom" && round && (
            <p key={r} className="boom" role="status">
              {hitLine(room, mode, round)}
            </p>
          )}
        </div>
      )}
      {yours && <p className="yours">{t.yours}</p>}
      {me && mine < 0 && phase.at !== "results" && <p className="yours wait">{t.joining}</p>}
      {!me && phase.at !== "results" && <p className="yours wait">{t.watching}</p>}
      {button && (
        <div className="acts">
          <button
            type="button"
            className={`pass${button.join ? " join" : ""}`}
            disabled={!button.on}
            aria-label={yours ? t.passLabel : undefined}
            onPointerDown={(e) => {
              if (e.button === 0 && yours) onPass();
            }}
            onClick={(e) => (button.join ? onJoin() : onPassClick(e.detail === 0))}
          >
            {button.text}
          </button>
          <button type="button" className="music" disabled={mw.off} aria-pressed={music === "on"} onClick={onMusic}>
            {mw.line}
            <small>{mw.sub}</small>
          </button>
        </div>
      )}
      {me && phase.at !== "results" && (
        <button type="button" className="leave" disabled={busy} onClick={onLeave}>
          {t.leave}
        </button>
      )}
      {msg && (
        <p className="gmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{t.note}</p>
    </div>
  );
}

export default function SquadGift() {
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  useListenPlayer();
  const [now, setNow] = useState(() => squadServerNow());
  const [song, setSong] = useState<{ key: string; got: DanceSong; beats: DanceBeats | null } | null>(null);
  const [wanted, setWanted] = useState(musicWanted);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const drumRef = useRef<HTMLDivElement>(null);
  const mode = room?.mode?.kind === "gift" && room.mode.at === openAt ? room.mode : null;
  const open = Boolean(mode);
  const key = mode ? `${mode.at}:${mode.song}` : null;
  const songAt = mode?.songAt ?? 0;
  const beats = song?.key === key ? song.beats : null;
  const phase = mode ? giftPhase(mode, now) : null;
  const playing = phase?.at === "round";

  useEffect(() => {
    if (!open) return;
    setNow(squadServerNow());
    const t = window.setInterval(() => setNow(squadServerNow()), TICK_MS);
    return () => window.clearInterval(t);
  }, [open]);

  // the song's beats and link, once a game
  useEffect(() => {
    if (!key) return;
    let gone = false;
    setMsg(null);
    squadDanceSong()
      .then((got) => {
        if (gone) return;
        const map = readDance(got.dance);
        setSong({ key, got, beats: map && !map.none ? map : null });
      })
      .catch((e: unknown) => !gone && setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
    return () => {
      gone = true;
    };
  }, [key]);

  // the drum beating on the song's beats while a round goes, every frame
  useEffect(() => {
    if (!open || !playing) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    const drum = drumRef.current;
    if (!drum) return;
    let raf = 0;
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const t = (squadServerNow() - songAt) / 1000;
      const b = beats ? beatAt(beats.beats, t, beats.bpm) : t / FREE_BEAT_S;
      const f = Number.isNaN(b) ? 1 : b - Math.floor(b);
      drum.style.transform = `scale(${(1 + 0.08 * Math.max(0, 1 - f * 4)).toFixed(3)})`;
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
      drum.style.transform = "";
    };
  }, [open, playing, songAt, beats]);

  const got = song?.key === key ? song.got : null;
  const lite = Boolean(got?.lite && listenLiteNow());
  const src = got?.url ? (lite ? (got.lite ?? null) : got.url) : null;
  const liteS = lite ? (beats?.liteS ?? 0) : 0;
  const listening = isListening();
  const here = listening && Boolean(mode) && listenTap()?.song === mode?.song;
  const can = open && playing && !listening && Boolean(src);
  const music = useDanceMusic({ can, want: can && wanted, src, songAt, liteS, len: Number.POSITIVE_INFINITY });

  if (!mode || !room) return null;
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await p();
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  const pass = () => {
    squadGiftPass().catch((e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
  };
  const state: DanceMusic = got && !got.url ? "none" : here ? "here" : listening ? "else" : music.blocked ? "blocked" : wanted ? "on" : "off";
  return (
    <GiftView
      room={room}
      mode={mode}
      now={now}
      music={state}
      busy={busy}
      msg={msg}
      drumRef={drumRef}
      onClose={closeSquadModeCard}
      onPass={pass}
      onPassClick={(byKey) => {
        // a key (Enter, space) passes here; a finger or the mouse did on its way down, and the music may start here
        if (byKey) pass();
        if (music.blocked) music.start();
      }}
      onJoin={() => {
        music.start();
        void run(() => squadModeIn(true));
      }}
      onMusic={() => {
        if (music.blocked) return music.start();
        const on = !wanted;
        setWanted(on);
        keepMusicWanted(on);
        if (on) music.start(true);
      }}
      onLeave={() => void run(() => squadModeIn(false))}
    />
  );
}
