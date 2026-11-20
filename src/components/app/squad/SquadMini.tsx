"use client";
/* eslint-disable @next/next/no-img-element -- the quiz's own small pictures, made on the server as data URLs */

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { fmt, T } from "@/i18n";
import { serverName } from "@/lib/games";
import type { FishSpot } from "@/lib/fish/items";
import { SQUAD_MAX, type SquadMember, type SquadRoom } from "@/lib/squad";
import {
  giftAt,
  RACE_M,
  raceOrder,
  raceRun,
  stackHand,
  stackHeight,
  stackSwing,
  STACK_SWING_PX,
  type QuizAsk,
  type QuizMode,
  type SquadMode,
  type SquadModeKind,
  type StackMode,
} from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { openFishWin, tapFishNow, useFishWin } from "../fish/winStore";
import { giftPhase } from "./SquadGift";
import { ListenRow } from "./SquadListen";
import { quizPhase, resultLine, useIntro, useQuizAsks } from "./SquadQuiz";
import { racePhase } from "./SquadRace";
import { Bubble, liftsOf, SquadRoach } from "./SquadRoach";
import { SayTab } from "./SquadTalk";
import ThrowPicker from "./SquadThrow";
import {
  lineWords,
  squadDanceTap,
  squadGiftPass,
  squadModeIn,
  squadOpenMode,
  squadQuizAnswer,
  squadRaceJump,
  squadRaceTap,
  squadServerNow,
  squadStackAgain,
  squadStackDrop,
  useSquadLines,
  useSquadMoves,
  useSquadQuizPicks,
  useSquadRoom,
  type QuizPicks,
  type SquadLine,
  type SquadMoveDone,
} from "./squading";
import { closeSquadPip, useMiniPage, useSquadPip } from "./miniState";
import "./squadMini.css";

/**
 * The room of 一起卫戍 small (卫戍碎片时间玩法 ⑧, the canvases Pip and Mini): the room's line and its clock in a round;
 * the mode playing as a strip, lit when it is your turn, with what it needs (传, 跳 and 加油, 跳, 放, the quiz's three,
 * or 加入); the four roaches with what they said and what sits on their heads; the last two lines said; 钓鳞's float,
 * 咕咚 and 收竿; and 说话, 扔东西 and 跟着听, each opening its page in place of the rest. The same in a window over the game
 * (SquadPip: 电脑小窗, from 弹出小窗) and as the whole page while the page is small (SquadMiniPage: 窗口很小时).
 */

/** The page's clock is looked at this often while it shows (the swing of 基建加盖 goes every frame) */
const TICK_MS = 250;
/** Lines kept in the box under the roaches */
const LINES_SHOWN = 2;

type Panel = "say" | "throw" | "listen";
/** What a strip's button does */
export type StripAct = "join" | "danceTap" | "pass" | "jump" | "cheer" | "raceAgain" | "drop" | "stackAgain";
/** The strip of the mode playing: which, how it stands, lit when it is your turn, its buttons (on: may be tapped now) */
export type Strip = { kind: SquadModeKind; text: string; lit: boolean; acts: { act: StripAct; label: string; on: boolean }[] };

const secs = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** The strip of the mode playing, for the room as it is now (on the server's clock) and your quiz answers */
export function stripOf(room: SquadRoom, mode: SquadMode, now: number, picks: QuizPicks | null = null): Strip {
  const t = T.squad.mini;
  const kind = mode.kind;
  const line = (what: string) => fmt(t.line, { mode: t.short[kind], what });
  const me = mode.in.find((m) => m.h === room.you);
  if (!me) return { kind, text: line(fmt(t.people, { n: mode.in.length })), lit: false, acts: [{ act: "join", label: T.squad.plays.join, on: true }] };
  if (mode.kind === "dance") {
    const going = now >= mode.songAt && now < mode.until;
    const text = now < mode.songAt ? fmt(t.startsIn, { s: secs(mode.songAt - now) }) : fmt(t.danceCombo, { n: me.combo });
    return { kind, text: line(text), lit: going, acts: [{ act: "danceTap", label: T.squad.dance.tap, on: going }] };
  }
  if (mode.kind === "quiz") {
    const ph = quizPhase(mode, now);
    if (ph.at === "results") return { kind, text: line(t.done), lit: false, acts: [] };
    if (ph.at === "lead") return { kind, text: line(fmt(t.startsIn, { s: secs(ph.q.at - now) })), lit: false, acts: [] };
    const mine = picks?.at === mode.at ? picks : null;
    const late = (mine?.joinedAt ?? 0) > ph.q.at;
    const open = ph.at === "ask" && ph.q.answer === undefined && !late && !mine?.picks[ph.q.n];
    return { kind, text: line(fmt(t.quizNo, { n: ph.q.n + 1, of: mode.questions.length })), lit: open, acts: [] };
  }
  if (mode.kind === "gift") {
    const ph = giftPhase(mode, now);
    if (ph.at === "results") return { kind, text: line(t.done), lit: false, acts: [] };
    const round = mode.rounds[ph.r];
    if (ph.at === "lead") return { kind, text: line(fmt(t.startsIn, { s: secs(round.at - now) })), lit: false, acts: [] };
    const mine = round.seats.indexOf(room.you);
    if (mine < 0) return { kind, text: line(T.squad.gift.joining), lit: false, acts: [] };
    if (ph.at === "boom") return { kind, text: line(T.squad.gift.boom), lit: false, acts: [] };
    const yours = giftAt(round, mode.seed, ph.r, now).seat === mine;
    return { kind, text: line(yours ? t.giftYours : T.squad.gift.waiting), lit: yours, acts: [{ act: "pass", label: T.squad.gift.pass, on: yours }] };
  }
  if (mode.kind === "race") {
    const lane = mode.lanes.findIndex((l) => l.h === room.you);
    if (lane < 0) return { kind, text: line(t.raceNext), lit: false, acts: [] };
    const run = raceRun(mode, now);
    const ph = racePhase(mode, run, now);
    if (ph === "lead") return { kind, text: line(fmt(T.squad.race.startsIn, { s: secs(mode.start - now) })), lit: false, acts: [] };
    if (ph === "checking") return { kind, text: line(T.squad.race.checking), lit: false, acts: [] };
    if (ph === "end" && mode.end) {
      return { kind, text: line(fmt(T.squad.race.youPlace, { rank: mode.end.order.indexOf(lane) + 1 })), lit: false, acts: [{ act: "raceAgain", label: T.squad.race.again, on: true }] };
    }
    if (run.done[lane] !== null) return { kind, text: line(fmt(T.squad.race.youPlace, { rank: raceOrder(run).indexOf(lane) + 1 })), lit: false, acts: [] };
    const rank = 1 + run.x.filter((x, i) => i !== lane && x > run.x[lane]).length;
    return {
      kind,
      text: line(fmt(t.raceRun, { rank, m: Math.max(0, Math.round(RACE_M - run.x[lane])) })),
      lit: true,
      acts: [
        { act: "jump", label: T.squad.race.jump, on: true },
        { act: "cheer", label: T.squad.race.cheer, on: true },
      ],
    };
  }
  const hand = stackHand(mode.hand, now);
  if (mode.fell) return { kind, text: line(fmt(T.squad.stack.fell, { n: mode.fell.height })), lit: false, acts: [{ act: "stackAgain", label: T.squad.stack.again, on: true }] };
  return {
    kind,
    text: line(fmt(t.stackNow, { n: stackHeight(mode), k: hand.n })),
    lit: hand.n > 0,
    acts: [{ act: "drop", label: hand.n > 0 ? T.squad.stack.drop : T.squad.stack.empty, on: hand.n > 0 }],
  };
}

/** The room's line at the top: as the bar beside 卫戍 has it; in a round, how long it has gone */
export function headOf(room: SquadRoom, now: number) {
  const waiting = room.state !== "go";
  const text = fmt(waiting ? T.squad.fight.headWait : T.squad.fight.head, {
    dot: T.squad.dot,
    level: T.squad.levelsShort[room.level - 1] ?? "",
    server: serverName("arknights", room.server) ?? room.server,
    n: room.members.length,
    max: SQUAD_MAX,
  });
  if (waiting || room.wentAt === null) return { text, clock: null };
  const s = Math.max(0, Math.floor((now - room.wentAt) / 1000));
  const two = (v: number) => String(v).padStart(2, "0");
  const clock = s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
  return { text, clock };
}

/** The last lines said in the room, the newest last: whose (你 for yours) and what */
export function lastLines(room: SquadRoom, lines: readonly SquadLine[], n = LINES_SHOWN) {
  return [...lines]
    .filter((l) => room.members.some((m) => m.h === l.h))
    .sort((a, b) => a.at - b.at)
    .slice(-n)
    .map((l) => {
      const m = room.members.find((x) => x.h === l.h)!;
      return { key: l.key, who: m.you ? T.squad.room.you : m.name, text: lineWords(l.p, l.s) };
    });
}

/** 基建加盖's top and your roach over it, small: a track of the swing, the top block marked, your roach moving (every frame by swingRef) */
function StackTrack({ mode, now, swingRef }: { mode: StackMode; now: number; swingRef?: RefObject<HTMLElement | null> }) {
  const top = mode.blocks.length && !mode.fell ? mode.blocks[mode.blocks.length - 1].x : 0;
  const at = (x: number) => `${(50 + (50 * x) / (STACK_SWING_PX + 20)).toFixed(2)}%`;
  return (
    <span className="trk" aria-hidden="true">
      <i className="top" style={{ left: at(top) }} />
      <i className="you" ref={swingRef} style={{ left: at(stackSwing(mode.roundAt, now)) }} />
    </span>
  );
}

/** 凯尔希随堂测 small: the question's picture or words, and its three */
function QuizBit({ room, mode, now, ask, picks, busy, onPick }: { room: SquadRoom; mode: QuizMode; now: number; ask: QuizAsk | undefined; picks: QuizPicks | null; busy: boolean; onPick: (n: number, k: number) => void }) {
  const ph = quizPhase(mode, now);
  if (ph.at !== "ask" && ph.at !== "reveal") return null;
  const q = ph.q;
  const mine = picks?.at === mode.at ? picks : null;
  const pick = mine?.picks[q.n];
  const late = (mine?.joinedAt ?? 0) > q.at;
  const answer = q.answer ?? pick?.answer;
  const open = ph.at === "ask" && q.answer === undefined && !late && !pick;
  const options = ask?.options ?? q.options;
  const res = resultLine(room, q, pick, now);
  const ask2 = q.kind === "meme" ? (ask?.ask ?? q.ask) : T.squad.quiz.asks[q.kind as "sil" | "crop" | "intro"];
  return (
    <div className="qz">
      <div className="qa">
        {ask?.pic && <img src={ask.pic} alt="" />}
        <span>{q.kind === "intro" ? T.squad.quiz.intro : ask2}</span>
      </div>
      <div className="qo">
        {[0, 1, 2].map((k) => (
          <button
            key={k}
            type="button"
            className={answer === k ? "ok" : pick?.pick === k && answer !== undefined ? "bad" : pick?.pick === k ? "mine" : undefined}
            disabled={!open || busy || !options}
            onClick={() => onPick(q.n, k)}
          >
            <b>{"ABC"[k]}</b>
            <span>{options?.[k] ?? "…"}</span>
          </button>
        ))}
      </div>
      {res && <small className={`qr ${res.tone}`}>{res.text}</small>}
    </div>
  );
}

/** What the small room shows, for the room as it is now (on the server's clock) */
export function MiniView({
  room,
  now,
  fish,
  lines,
  moves,
  picks,
  ask,
  panel,
  mate,
  busy,
  msg,
  where,
  swingRef,
  rootRef,
  onAct,
  onPick,
  onPull,
  onFish,
  onPanel,
  onMate,
  onListen,
  onToast,
}: {
  room: SquadRoom;
  now: number;
  /** 钓鳞's line: where it is in the water (null: none), and whether it has bitten */
  fish: { line: FishSpot | null; bite: boolean };
  lines: readonly SquadLine[];
  moves: readonly SquadMoveDone[];
  picks: QuizPicks | null;
  /** The quiz's question now, as the server gave it */
  ask: QuizAsk | undefined;
  panel: Panel | null;
  /** 扔东西: the teammate picked (by number) */
  mate: number | null;
  busy: boolean;
  msg: string | null;
  where: "pip" | "page";
  swingRef?: RefObject<HTMLElement | null>;
  rootRef?: RefObject<HTMLDivElement | null>;
  onAct: (act: StripAct) => void;
  onPick: (n: number, k: number) => void;
  onPull: () => void;
  onFish: () => void;
  onPanel: (panel: Panel | null) => void;
  onMate: (h: number | null) => void;
  onListen: () => void;
  onToast: (text: string) => void;
}) {
  const t = T.squad.mini;
  const head = headOf(room, now);
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  const strip = mode ? stripOf(room, mode, now, picks) : null;
  const order = room.members.map((m) => m.h);
  const lifts = liftsOf(lines, order, 22, now);
  const said = lastLines(room, lines);
  const mates = room.members.filter((m) => !m.you);
  const target = mate === null ? null : (mates.find((m) => m.h === mate) ?? null);
  const roach = (m: SquadMember, i: number) => {
    const line = lines.find((l) => l.h === m.h);
    const edge = i === 0 ? " edge-l" : i === room.members.length - 1 ? " edge-r" : "";
    return (
      <span key={m.h} className={`mr${m.you ? " you" : ""}${edge}`}>
        <Bubble line={line} lift={lifts.get(m.h) ?? 0} side="up" to={line?.to === undefined ? null : room.members.find((x) => x.h === line.to)} />
        <SquadRoach m={m} size={44} line={line} move={moves.find((x) => x.h === m.h)} toMe={moves.find((x) => x.to === m.h)} play="tile" />
        <span className="nm">{m.you ? T.squad.room.you : m.name}</span>
      </span>
    );
  };
  return (
    <div ref={rootRef} className={`sq-mini ${where}`} role="region" aria-label={head.text}>
      <div className="mh">
        <b>{head.text}</b>
        {head.clock && <span className="clk">{head.clock}</span>}
      </div>
      {panel === null ? (
        <>
          {strip && (
            <div className={`ms k-${strip.kind}${strip.lit ? " lit" : ""}`}>
              <div className="mt">
                <span className="tx">{strip.text}</span>
                {mode?.kind === "stack" && mode.in.some((m) => m.h === room.you) && !mode.fell && <StackTrack mode={mode} now={now} swingRef={swingRef} />}
                {strip.acts.map((a) => (
                  <button
                    key={a.act}
                    type="button"
                    className={`ma a-${a.act}`}
                    disabled={!a.on || (busy && (a.act === "join" || a.act === "raceAgain" || a.act === "stackAgain"))}
                    onPointerDown={(e) => e.button === 0 && a.on && (a.act === "jump" || a.act === "cheer" || a.act === "drop" || a.act === "danceTap" || a.act === "pass") && onAct(a.act)}
                    onClick={(e) => {
                      // the quick ones go at the press; the rest, and keys, at the click
                      const quick = a.act === "jump" || a.act === "cheer" || a.act === "drop" || a.act === "danceTap" || a.act === "pass";
                      if (!quick || e.detail === 0) onAct(a.act);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              {mode?.kind === "quiz" && mode.in.some((m) => m.h === room.you) && <QuizBit room={room} mode={mode} now={now} ask={ask} picks={picks} busy={busy} onPick={onPick} />}
            </div>
          )}
          <div className="mr4">{room.members.map(roach)}</div>
          {said.length > 0 && (
            <div className="ml">
              {said.map((l) => (
                <span key={l.key}>{fmt(T.squad.mini.said, { name: l.who, line: l.text })}</span>
              ))}
            </div>
          )}
          <div className={`mf${fish.bite ? " bite" : fish.line ? " lined" : ""}`}>
            <span className="fl">{fish.bite ? T.fish.bang : fish.line === "pond" ? T.fish.win.stripPond : fish.line ? T.fish.win.stripPier : T.fish.win.stripHand}</span>
            {fish.line && <i className="flt" aria-hidden="true" />}
            {fish.bite ? (
              <button type="button" className="pull" onClick={onPull}>
                {t.pull}
              </button>
            ) : (
              !fish.line && (
                <button type="button" className="cast" onClick={onFish}>
                  {T.fish.buttons.cast}
                </button>
              )
            )}
          </div>
        </>
      ) : (
        <div className="mp">
          <button type="button" className="back" onClick={() => (panel === "throw" && target ? onMate(null) : onPanel(null))}>
            {`‹ ${t.back}`}
          </button>
          {panel === "say" && <SayTab room={room} onDone={() => onPanel(null)} docked />}
          {panel === "throw" &&
            (target ? (
              <ThrowPicker m={target} onBack={() => onMate(null)} />
            ) : (
              <div className="who">
                <b>{t.throwWho}</b>
                {mates.length ? (
                  mates.map((m) => (
                    <button key={m.h} type="button" disabled={Boolean(m.noThrow)} onClick={() => onMate(m.h)}>
                      <SquadRoach m={{ ...m, pose: 0 }} size={30} />
                      <span>{m.name}</span>
                      {m.noThrow && <small>{T.squad.throw.off}</small>}
                    </button>
                  ))
                ) : (
                  <small>{T.squad.talk.noMate}</small>
                )}
              </div>
            ))}
          {panel === "listen" && <ListenRow room={room} onListen={onListen} onToast={onToast} />}
        </div>
      )}
      {msg && (
        <p className="mm" role="status">
          {msg}
        </p>
      )}
      <div className="mb">
        <button type="button" className={panel === "say" ? "on" : undefined} onClick={() => onPanel(panel === "say" ? null : "say")}>
          {t.say}
        </button>
        <button type="button" className={panel === "throw" ? "on" : undefined} onClick={() => (onMate(null), onPanel(panel === "throw" ? null : "throw"))}>
          {t.throw}
        </button>
        {room.hear && (
          <button type="button" className={panel === "listen" ? "on" : undefined} onClick={() => onPanel(panel === "listen" ? null : "listen")}>
            {t.listen}
          </button>
        )}
      </div>
    </div>
  );
}

/** The small room as it plays: its state and what each tap does */
function SquadMini({ room, where, onListen, onToast }: { room: SquadRoom; where: "pip" | "page"; onListen: () => void; onToast: (text: string) => void }) {
  const lines = useSquadLines();
  const moves = useSquadMoves();
  const picks = useSquadQuizPicks();
  const win = useFishWin();
  const [now, setNow] = useState(() => squadServerNow());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [mate, setMate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const swingRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastDrop = useRef(0);
  const mode = room.mode && room.mode.endsAt > now ? room.mode : null;
  const quiz = mode?.kind === "quiz" && mode.in.some((m) => m.h === room.you) ? mode : null;
  const asks = useQuizAsks(quiz, now, setMsg);
  const ph = quiz ? quizPhase(quiz, now) : null;
  const q = ph && ph.at !== "results" ? ph.q : null;
  const ask = q ? asks[q.n] : undefined;
  // a 前奏 question plays its song here too (the quiz's own card may be shut)
  useIntro(q?.kind === "intro" && ask?.url ? ask.url : null, q?.at ?? 0, q ? q.ends - q.at : 0);
  const stacking = mode?.kind === "stack";
  const roundAt = mode?.kind === "stack" ? mode.roundAt : 0;
  // the clock and the frames of the window it is drawn in: in the window over everything they go on while the page
  // itself is hidden behind the game
  const own = () => rootRef.current?.ownerDocument.defaultView ?? window;

  useEffect(() => {
    const w = own();
    const timer = w.setInterval(() => setNow(squadServerNow()), TICK_MS);
    return () => w.clearInterval(timer);
  }, []);
  // 基建加盖's swing, every frame
  useEffect(() => {
    if (!stacking) return;
    const w = own();
    let raf = 0;
    const frame = () => {
      const el = swingRef.current;
      if (el) el.style.left = `${(50 + (50 * stackSwing(roundAt, squadServerNow())) / (STACK_SWING_PX + 20)).toFixed(2)}%`;
      raf = w.requestAnimationFrame(frame);
    };
    raf = w.requestAnimationFrame(frame);
    return () => w.cancelAnimationFrame(raf);
  }, [stacking, roundAt]);

  const fail = (e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await p();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const onAct = (act: StripAct) => {
    setMsg(null);
    if (act === "join") return void run(() => squadModeIn(true));
    if (act === "danceTap") return void squadDanceTap(null).catch(fail);
    if (act === "pass") return void squadGiftPass().catch(fail);
    if (act === "jump") return void squadRaceJump().catch(fail);
    if (act === "cheer") return squadRaceTap();
    if (act === "raceAgain") return void run(() => squadOpenMode("race"));
    if (act === "stackAgain") return void run(() => squadStackAgain());
    // 放: one a second, as the server takes them
    const tap = Date.now();
    if (tap - lastDrop.current < 1_000) return setMsg(T.squad.stack.slow);
    lastDrop.current = tap;
    void squadStackDrop().catch(fail);
  };
  return (
    <MiniView
      room={room}
      now={now}
      fish={{ line: win.line, bite: win.bite }}
      lines={lines}
      moves={moves}
      picks={picks}
      ask={ask}
      panel={panel}
      mate={mate}
      busy={busy}
      msg={msg}
      where={where}
      swingRef={swingRef}
      rootRef={rootRef}
      onAct={onAct}
      onPick={(n, k) => void squadQuizAnswer(n, k).catch(fail)}
      onPull={tapFishNow}
      onFish={openFishWin}
      onPanel={(p) => {
        setMsg(null);
        setPanel(p);
      }}
      onMate={setMate}
      onListen={onListen}
      onToast={onToast}
    />
  );
}

/** 窗口很小时: the whole page the room small, over the map and its cards (under 钓鳞's window, the dialogs and the toast) */
export function SquadMiniPage({ onListen, onToast }: { onListen: () => void; onToast: (text: string) => void }) {
  const room = useSquadRoom();
  const small = useMiniPage();
  if (!room || !small) return null;
  return (
    <div className="sq-minipage">
      <SquadMini room={room} where="page" onListen={onListen} onToast={onToast} />
    </div>
  );
}

/** 电脑小窗: the room small in the window over everything while it is open; it closes once one is out of the room */
export function SquadPip({ onListen, onToast }: { onListen: () => void; onToast: (text: string) => void }) {
  const room = useSquadRoom();
  const pip = useSquadPip();
  useEffect(() => {
    if (pip && !room) closeSquadPip();
  }, [pip, room]);
  if (!pip || !room) return null;
  return createPortal(<SquadMini room={room} where="pip" onListen={onListen} onToast={onToast} />, pip.document.body);
}
