"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { RACE_JUMP_MS, RACE_M, RACE_MAX_MS, RACE_TAPS_MAX, raceOrder, raceRun, type RaceMode, type RaceNow } from "@/lib/squadMode";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import { WorldError } from "@/lib/world/types";
import { picOf } from "../fish/words";
import { SquadRoach } from "./SquadRoach";
import { closeSquadModeCard, squadModeIn, squadOpenMode, squadRaceJump, squadRaceTap, squadServerNow, useSquadModeCard, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 企鹅物流急件赛 (玩点什么, src/lib/squadMode.ts), its card at the map's foot as the other modes'. A street of 龙门
 * (10 px a metre), the view following your roach (one watching: the one in front): the sky, buildings and shop signs
 * going by slower than the street, the four lanes with the obstacles (the same in each), the roaches with their parcels,
 * those out of sight told at the edges, the finish with 大帝 by the 企鹅物流 van. Over it the place and metres left
 * and the clock, and a strip with where the four are. Under it how many 加油 count now, 跳 and 加油！. Where everyone
 * is comes from what they did by the server's own rule (raceRun), the server's order in the end. The card follows the
 * canvas 「企鹅物流急件赛」.
 */

/** The street's length on the page (px), the lanes' middles (px from the scene's top) */
const WORLD = RACE_M * 10;
const LANES = [200, 260, 320, 380];
/** The lanes' colours on the strip */
const DOTS = ["#ffd23f", "#c9d2dc", "#ff8a3a", "#7fd1ff"];
/** The buildings far off: [x, width, height, colour], the signs: [x, colour, ink] */
const FAR: [number, number, number, string][] = [
  [0, 46, 70, "#b7c6d4"],
  [52, 30, 98, "#aebfcf"],
  [88, 54, 60, "#bccbd8"],
  [150, 26, 112, "#a9bbcc"],
  [182, 60, 78, "#b7c6d4"],
  [250, 36, 92, "#aebfcf"],
  [292, 50, 66, "#bccbd8"],
  [350, 28, 104, "#a9bbcc"],
  [384, 58, 74, "#b7c6d4"],
  [450, 40, 88, "#aebfcf"],
];
const SPAN = 520;
const SIGNS: [number, string, string][] = [
  [200, "#1b1d22", "#ffd23f"],
  [520, "#22406e", "#ffffff"],
  [840, "#6b2a4a", "#ffd9ea"],
  [1160, "#1d2a33", "#7fd1ff"],
  [1480, "#2a2140", "#e0d6ff"],
  [1800, "#2f5a46", "#e6f2ea"],
];
/** A line over your roach at an obstacle shows this long */
const TIP_MS = 1_300;

/** Who runs a lane (by number): one of the room (a player, or one of its 人机), or one of the mode's own 人机 */
export function laneOf(room: SquadRoom, mode: RaceMode, h: number): SquadMember | null {
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

/** Where the race is now (the server's clock): before its start, running, over here and waiting for the server's word, or settled */
export type RacePhase = "lead" | "run" | "checking" | "end";
export function racePhase(mode: RaceMode, run: RaceNow, now: number): RacePhase {
  if (mode.end) return "end";
  if (now < mode.start) return "lead";
  return run.over ? "checking" : "run";
}

/** The line over the street: the countdown, your place and the metres left, your time in, the one in front's, or the end */
export function raceStatus(room: SquadRoom, mode: RaceMode, run: RaceNow, now: number): string {
  const t = T.squad.race;
  const phase = racePhase(mode, run, now);
  if (phase === "lead") return fmt(t.startsIn, { s: Math.max(1, Math.ceil((mode.start - now) / 1000)) });
  if (phase === "checking") return t.checking;
  const mine = mode.lanes.findIndex((l) => l.h === room.you);
  if (phase === "end" && mode.end) {
    const first = mode.lanes[mode.end.order[0]];
    const m = laneOf(room, mode, first.h);
    const place = mine >= 0 ? mode.end.order.indexOf(mine) + 1 : 0;
    if (m?.you) return mode.lanes.filter((l) => l.h >= 0).length >= 2 ? t.wonYou : t.wonPractice;
    return `${fmt(t.won, { name: nameOf(m) })}${place ? ` ${fmt(t.youPlace, { rank: place })}` : ""}`;
  }
  if (mine < 0) return fmt(t.statusWatch, { m: Math.max(0, Math.round(RACE_M - Math.max(...run.x))) });
  if (run.done[mine] !== null) return fmt(t.statusIn, { rank: raceOrder(run).indexOf(mine) + 1 });
  const rank = 1 + run.x.filter((x, i) => i !== mine && x > run.x[mine]).length;
  return fmt(t.status, { rank, m: Math.max(0, Math.round(RACE_M - run.x[mine])) });
}

/** The line over your roach after it met an obstacle, while it shows */
export function raceTip(run: RaceNow, lane: number): string | null {
  const last = lane >= 0 ? run.last[lane] : null;
  if (!last || run.t - last.t > TIP_MS) return null;
  const t = T.squad.race.tips;
  if (last.k === "potion") return last.jumped ? t.potionMissed : t.potion;
  if (last.jumped) return t.jumped;
  return t[last.k];
}

/** The penguin, 大帝, by the van */
function Emperor() {
  return (
    <svg className="emperor" width="44" height="50" viewBox="0 0 44 50" aria-hidden="true">
      <ellipse cx="22" cy="30" rx="15" ry="18" fill="#1b1d22" />
      <ellipse cx="22" cy="34" rx="9" ry="12" fill="#ffffff" />
      <path d="M7 28 Q1 36 6 42" stroke="#1b1d22" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M37 28 Q43 36 38 42" stroke="#1b1d22" strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="10" y="16" width="10" height="6" rx="2" fill="#0b0c0e" />
      <rect x="24" y="16" width="10" height="6" rx="2" fill="#0b0c0e" />
      <path d="M20 18 H24" stroke="#0b0c0e" strokeWidth="1.6" />
      <path d="M12 17.5 L15 17.5" stroke="#ffffff" strokeWidth="1" />
      <path d="M19 24 L25 24 L22 28 Z" fill="#ff9a2a" />
      <path d="M13 30 Q22 38 31 30" stroke="#f4c040" strokeWidth="2" fill="none" />
      <circle cx="22" cy="35" r="2.4" fill="#f4c040" />
      <ellipse cx="16" cy="48" rx="4" ry="2" fill="#ff9a2a" />
      <ellipse cx="28" cy="48" rx="4" ry="2" fill="#ff9a2a" />
    </svg>
  );
}

function Crown() {
  return (
    <svg className="crown" width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
      <path d="M2 14 L4 4 L9 9 L13 2 L17 9 L22 4 L24 14 Z" fill="#f4c040" stroke="#b8860b" strokeWidth="1" />
    </svg>
  );
}

/** The street as it is now, W wide (px), following your roach (or, watching, the one in front) */
function Street({ room, mode, run, now, w }: { room: SquadRoom; mode: RaceMode; run: RaceNow; now: number; w: number }) {
  const t = T.squad.race;
  const mine = mode.lanes.findIndex((l) => l.h === room.you);
  const lead = run.x.reduce((b, x, i) => (x > run.x[b] ? i : b), 0);
  const follow = mine >= 0 ? mine : lead;
  const youX = run.x[follow] * 10;
  // the start line in sight at first (80 px in), the finish's van at the end
  const cam = Math.max(-80, Math.min(WORLD + 230 - w, youX - 110));
  const px = (v: number) => `${Math.round(v)}px`;
  const off = (((cam * 0.15) % SPAN) + SPAN) % SPAN;
  const phase = racePhase(mode, run, now);
  const racing = phase === "run";
  const winner = mode.end ? mode.end.order[0] : -1;
  const crowned = winner >= 0 && mode.lanes[winner].h >= 0 && mode.lanes.filter((l) => l.h >= 0).length >= 2 && mode.end?.times[winner] !== null;
  const finishX = WORLD - cam;
  const tip = raceTip(run, mine);
  return (
    <div className="street">
      {[0, 1].flatMap((k) =>
        FAR.map(([x0, bw, bh, c], i) => {
          const x = x0 + k * SPAN - off;
          return x > -70 && x < w + 10 ? <i key={`f${k}-${i}`} className="far" style={{ left: px(x), top: px(150 - bh), width: px(bw), height: px(bh), background: c }} /> : null;
        }),
      )}
      {SIGNS.map(([x0, bg, fg], i) => {
        const x = x0 - cam * 0.6;
        return x > -120 && x < w + 10 ? (
          <span key={`s${i}`} className="sign" style={{ left: px(x) }}>
            <b style={{ background: bg, color: fg }}>{t.signs[i]}</b>
            <i />
          </span>
        ) : null;
      })}
      <i className="walk" style={{ backgroundPosition: `${px(-(cam % 30))} 0` }} />
      {[50, 100, 150, 200, 250].map((m) => {
        const x = m * 10 - cam;
        return x > -40 && x < w ? (
          <span key={m} className="mark" style={{ left: px(x - 14) }}>
            {fmt(t.metres, { m })}
          </span>
        ) : null;
      })}
      <i className="kerb top" />
      <i className="road" />
      {[229, 289, 349].map((y) => (
        <i key={y} className="dash" style={{ top: px(y), backgroundPosition: `${px(-(cam % 40))} 0` }} />
      ))}
      <i className="kerb bottom" />
      <i className="side" />
      {cam < 10 && <i className="start" style={{ left: px(-cam - 3) }} />}
      {finishX < w + 20 && (
        <>
          <i className="finish" style={{ left: px(finishX - 6) }} />
          <span className="flabel" style={{ left: px(finishX - 40) }}>
            {t.finish}
          </span>
          <span className="van" style={{ left: px(finishX + 30) }}>
            <i className="vbox" />
            <i className="stripe" />
            <b>{t.van}</b>
            <small>{t.vanEn}</small>
            <i className="cab" />
            <i className="vwin" />
            <i className="wheel w1" />
            <i className="wheel w2" />
            <Emperor />
            {mine >= 0 && run.done[mine] !== null && <span className="stamp">{t.signed}</span>}
          </span>
        </>
      )}
      {LANES.flatMap((ly, li) =>
        mode.obs.map((o, oi) => {
          const sx = o.m * 10 - cam;
          if (sx < -50 || sx > w + 10 || (o.k === "potion" && run.ate[li] && run.x[li] >= o.m)) return null;
          return (
            <span key={`o${li}-${oi}`} className={`ob k-${o.k}`} style={{ left: px(sx - 22), top: px(ly - 22) }}>
              {o.k === "bar" ? (
                <>
                  <i className="board" />
                  <i className="leg l" />
                  <i className="leg r" />
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- the things' own small pictures, as 钓鳞 draws them
                <img src={picOf(o.k === "potion" ? "potion_full" : o.k)} alt="" />
              )}
            </span>
          );
        }),
      )}
      {mode.lanes.map((lane, i) => {
        const m = laneOf(room, mode, lane.h);
        if (!m) return null;
        const sx = run.x[i] * 10 - cam;
        if (sx < 14 || sx > w - 14) {
          const d = Math.round(run.x[i] - run.x[follow]);
          return (
            <span key={`e${i}`} className={`edge ${sx < 14 ? "l" : "r"}`} style={{ top: px(LANES[i] - 12) }}>
              {sx < 14 ? fmt(t.behind, { name: nameOf(m), m: Math.max(1, -d) }) : fmt(t.ahead, { name: nameOf(m), m: Math.max(1, d) })}
            </span>
          );
        }
        const air = run.airT[i];
        const jy = air === null ? 0 : -Math.sin((Math.PI * air) / RACE_JUMP_MS) * 34;
        const fx = run.done[i] !== null ? "cheer" : run.effect[i] === "slip" ? "spin" : run.effect[i] === "block" ? "shake" : run.effect[i] === "fall" ? "fall" : racing ? "run" : "";
        return (
          <span key={`r${i}`} className={`racer${m.you ? " you" : ""}`} style={{ left: px(sx - 32), top: px(LANES[i] - 34 + jy - (i === winner ? 12 : 0)) }}>
            {i === winner && crowned && <Crown />}
            <span className="rb">
              {run.effect[i] === "boost" && (
                <>
                  <i className="zoom z1" />
                  <i className="zoom z2" />
                  <i className="zoom z3" />
                </>
              )}
              <span className={`rr ${fx}`}>
                <SquadRoach m={{ ...m, pose: 0 }} size={44} />
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- 企鹅物流's parcel on its back */}
              <img className="parcel" src={picOf("parcel")} alt="" />
            </span>
            <span className="nm">
              {nameOf(m)}
              {m.bot && <em>{T.squad.bot.tag}</em>}
            </span>
          </span>
        );
      })}
      {tip && mine >= 0 && (
        <span key={tip} className="tip" style={{ left: px(Math.max(4, Math.min(w - 170, run.x[mine] * 10 - cam - 40))) }}>
          {tip}
        </span>
      )}
      <div className="bar">
        <b>{raceStatus(room, mode, run, now)}</b>
        <span className="clock">{`0:${String(Math.min(RACE_MAX_MS / 1000, Math.max(0, Math.floor(run.t / 1000)))).padStart(2, "0")}`}</span>
      </div>
      <div className="strip">
        <i className="line" />
        <i className="flag" />
        {mode.lanes
          .map((lane, i) => ({ i, you: lane.h === room.you }))
          .reverse()
          .map(({ i, you }) => (
            <i key={i} className={`dot${you ? " you" : ""}`} style={{ left: `calc(12px + (100% - 36px) * ${Math.min(1, run.x[i] / RACE_M).toFixed(4)})`, background: DOTS[i] }} />
          ))}
      </div>
    </div>
  );
}

/** The card as it shows, for the room and its race as they are now (on the server's clock) */
export function RaceView({
  room,
  mode,
  now,
  rate,
  busy,
  msg,
  width = 366,
  stageRef,
  onClose,
  onTap,
  onJump,
  onJoin,
  onLeave,
  onAgain,
}: {
  room: SquadRoom;
  mode: RaceMode;
  now: number;
  /** How many of your 加油 count now (the last second's, RACE_TAPS_MAX at most) */
  rate: number;
  busy: boolean;
  msg: string | null;
  /** The street's width as it shows (px) */
  width?: number;
  stageRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onTap: () => void;
  onJump: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onAgain: () => void;
}) {
  const t = T.squad.race;
  const run = raceRun(mode, now);
  const phase = racePhase(mode, run, now);
  const mine = mode.lanes.findIndex((l) => l.h === room.you);
  const me = mode.in.some((m) => m.h === room.you);
  // racing it: a lane and still in (one who went to watch keeps the lane, running on by itself)
  const racer = mine >= 0 && me;
  const running = phase === "run" && racer && run.done[mine] === null;
  const players = mode.lanes.filter((l) => l.h >= 0).length;
  return (
    <div className="sq-race" role="dialog" aria-label={t.title}>
      <header>
        <b>{fmt(t.count, { n: players })}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <div className="stage" ref={stageRef}>
        <Street room={room} mode={mode} run={run} now={now} w={width} />
      </div>
      {phase === "end" && mode.end ? (
        <div className="results">
          <h3>{t.results}</h3>
          <ol>
            {mode.end.order.map((i, k) => {
              const m = laneOf(room, mode, mode.lanes[i].h);
              if (!m) return null;
              const time = mode.end!.times[i];
              return (
                <li key={i} className={m.you ? "you" : ""}>
                  <span className="pn">{fmt(t.place, { n: k + 1 })}</span>
                  <SquadRoach m={{ ...m, pose: 0 }} size={26} />
                  <span className="nm">{nameOf(m)}</span>
                  {m.bot && <em>{T.squad.bot.tag}</em>}
                  {k === 0 && m.h >= 0 && players >= 2 && time !== null && <em className="cr">{t.crown}</em>}
                  <b>{time !== null ? fmt(t.time, { s: (time / 1000).toFixed(1) }) : fmt(t.notIn, { m: Math.round(mode.end!.metres[i]) })}</b>
                </li>
              );
            })}
          </ol>
          {players < 2 && <p className="end">{t.practice}</p>}
          <button type="button" className="again" disabled={busy} onClick={onAgain}>
            {t.again}
          </button>
        </div>
      ) : (
        <>
          {racer && (
            <div className="rate">
              <span>{t.rate}</span>
              <span className="segs" aria-hidden="true">
                {Array.from({ length: RACE_TAPS_MAX }, (_, k) => (
                  <i key={k} className={k < rate ? "on" : ""} />
                ))}
              </span>
            </div>
          )}
          {racer ? (
            <div className="acts">
              <button type="button" className="jump" disabled={!running} onPointerDown={(e) => e.button === 0 && running && onJump()} onClick={(e) => e.detail === 0 && running && onJump()}>
                {t.jump}
              </button>
              <button type="button" className="cheer" disabled={!running} onPointerDown={(e) => e.button === 0 && running && onTap()} onClick={(e) => e.detail === 0 && running && onTap()}>
                {t.cheer}
              </button>
            </div>
          ) : me ? (
            <p className="qline">{t.queued}</p>
          ) : (
            <div className="watch">
              <span>{t.watching}</span>
              <button type="button" disabled={busy} onClick={onJoin}>
                {t.join}
              </button>
            </div>
          )}
          {me && phase !== "checking" && (
            <button type="button" className="leave" disabled={busy} onClick={onLeave}>
              {t.leave}
            </button>
          )}
        </>
      )}
      {msg && (
        <p className="rmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{t.note}</p>
    </div>
  );
}

export default function SquadRace() {
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const [now, setNow] = useState(() => squadServerNow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [width, setWidth] = useState(366);
  const [taps, setTaps] = useState<number[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const mode = room?.mode?.kind === "race" && room.mode.at === openAt ? room.mode : null;
  const open = Boolean(mode);
  const running = Boolean(mode && !mode.end && now < mode.start + RACE_MAX_MS + 2_000);

  // every frame while it runs, else now and then
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let timer = 0;
    const tick = () => {
      setNow(squadServerNow());
      if (running) raf = window.requestAnimationFrame(tick);
      else timer = window.setTimeout(tick, 250);
    };
    tick();
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [open, running]);

  // the street as wide as the card
  useEffect(() => {
    const el = stageRef.current;
    if (!open || !el) return;
    const fit = () => setWidth(el.clientWidth || 366);
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open]);

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
  const here = Date.now();
  const rate = Math.min(RACE_TAPS_MAX, taps.filter((x) => here - x < 1_000).length);
  return (
    <RaceView
      room={room}
      mode={mode}
      now={now}
      rate={rate}
      busy={busy}
      msg={msg}
      width={width}
      stageRef={stageRef}
      onClose={closeSquadModeCard}
      onTap={() => {
        setTaps((was) => [...was.filter((x) => Date.now() - x < 1_000), Date.now()]);
        squadRaceTap();
      }}
      onJump={() => {
        squadRaceJump().catch((e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
      }}
      onJoin={() => void run(() => squadModeIn(true))}
      onLeave={() => void run(() => squadModeIn(false))}
      onAgain={() => void run(() => squadOpenMode("race"))}
    />
  );
}
