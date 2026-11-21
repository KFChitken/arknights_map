"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmt, T } from "@/i18n";
import type { SquadRoom } from "@/lib/squad";
import {
  QUIZ_FETCH_MS,
  QUIZ_KINDS,
  QUIZ_QUESTIONS,
  QUIZ_REVEAL_MS,
  quizLast,
  type QuizAsk,
  type QuizMode,
  type QuizQuestion,
} from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { isListening, listenLiteNow, useListenPlayer } from "../listening";
import { SquadRoach } from "./SquadRoach";
import { StackBehind } from "./SquadStack";
import {
  closeSquadModeCard,
  loadSquadRoom,
  squadModeIn,
  squadQuizAnswer,
  squadQuizAsk,
  squadServerNow,
  useSquadModeCard,
  useSquadQuizPicks,
  useSquadRoom,
  type QuizPick,
  type QuizPicks,
} from "./squading";
import "./squadModes.css";

/**
 * 凯尔希随堂测 (玩点什么, src/lib/squadMode.ts), its card at the map's foot as 龙门广场舞's is, the fight and the room
 * going on above it. Over the question, everyone in it with their points; then the question: its kind among the four,
 * its picture (a silhouette, a part of a 立绘: made on the server, whose not told), its intro (played from its start
 * on the server's clock, to one 听歌 is open to, unless 听歌 itself plays) or its 方舟梗 words on a blackboard, the
 * seconds left and a bar running down, and its three, A/B/C. One in it picks once (squadQuizAnswer): the first right
 * gets the point. Once someone got it, or its time is up, the right one shows, who was first and how fast, and the
 * next comes on its own; after the fifth, where everyone came and who wears 漏勺. One watching sees it all and joins
 * from the next question. The questions follow the server's clock: each one's three (and picture or song) asked for
 * from just before it starts; the room asked again as a question's time is up, for its answer.
 */

/** The page's clock is looked at this often while the card is open */
const TICK_MS = 200;
/** A question is asked for this long after its window opens (the server's clock as the page has it may be off a little) */
const ASK_AFTER_MS = 120;
/** Asked for again this long after a try that did not go, this many times at most */
const ASK_AGAIN_MS = 400;
const ASK_TRIES = 6;
/** The room is asked again this long after a question's time is up, for its answer */
const ANSWER_AFTER_MS = 150;
/** The intro is put back where it should be when this far off it (s) */
const DRIFT_S = 0.3;
const NO_ASKS: Readonly<Record<number, QuizAsk>> = {};

/** Where the quiz is now (on the server's clock): before its first question, a question being answered, its answer showing, or the results */
export type QuizPhase = { at: "lead"; q: QuizQuestion } | { at: "ask"; q: QuizQuestion } | { at: "reveal"; q: QuizQuestion } | { at: "results" };
export function quizPhase(mode: QuizMode, now: number): QuizPhase {
  const qs = mode.questions;
  if (!qs.length) return { at: "results" };
  if (now < qs[0].at) return { at: "lead", q: qs[0] };
  const q = qs.findLast((x) => x.at <= now) ?? qs[0];
  if (now < q.ends) return { at: "ask", q };
  if (q.n < qs.length - 1 || now < q.ends + QUIZ_REVEAL_MS) return { at: "reveal", q };
  return { at: "results" };
}

/** Everyone in the quiz still in the room, as they are in it, with their points */
function playersOf(room: SquadRoom, mode: QuizMode) {
  const byH = new Map(room.members.map((m) => [m.h, m]));
  return mode.in.flatMap((x) => {
    const m = byH.get(x.h);
    return m ? [{ m, points: x.combo }] : [];
  });
}

const nameOf = (room: SquadRoom, h: number) => {
  const m = room.members.find((x) => x.h === h);
  return m?.you ? T.squad.room.you : (m?.name ?? T.squad.quiz.someone);
};

/**
 * The line under a question once there is something to say: your own answer as judged, who was first, or that no
 * one got it; tone: ok (yours the point), bad (yours wrong), or plain
 */
export function resultLine(room: SquadRoom, q: QuizQuestion, pick: QuizPick | undefined, now: number): { text: string; tone: "ok" | "bad" | "" } | null {
  const t = T.squad.quiz;
  const first = q.first;
  if (pick?.right) {
    if (pick.first || first?.h === room.you) return { text: t.right, tone: "ok" };
    return { text: fmt(t.rightLate, { name: first ? nameOf(room, first.h) : t.someone }), tone: "" };
  }
  if (first && first.h === room.you) return { text: t.right, tone: "ok" };
  if (first) return { text: fmt(t.firstOther, { name: nameOf(room, first.h) }), tone: pick && pick.right === false ? "bad" : "" };
  if (pick && pick.right === false) return { text: now >= q.ends ? t.none : t.wrong, tone: "bad" };
  if (now >= q.ends && q.answer !== undefined) return { text: t.none, tone: "" };
  return null;
}

/** The ranks at the end: by points, those with the same sharing a place */
export function quizRanks(room: SquadRoom, mode: QuizMode) {
  const players = playersOf(room, mode).sort((a, b) => b.points - a.points);
  const last = new Set(quizLast(mode.in));
  return players.map((p) => ({ ...p, place: 1 + players.filter((x) => x.points > p.points).length, ladle: last.has(p.m.h) }));
}

/** What the quiz's end says of 漏勺: one alone practising, all the same, or who wears it */
export function ladleLine(room: SquadRoom, mode: QuizMode) {
  const t = T.squad.quiz;
  if (mode.in.length < 2) return t.practice;
  const last = quizLast(mode.in);
  if (!last.length) return t.tied;
  return fmt(t.ladle, { names: last.map((h) => nameOf(room, h)).join(T.squad.quiz.and) });
}

/** The intro's sound for the player: none (听歌 not open to them), else (听歌 itself plays), blocked (the browser waits for a tap), or on */
export type QuizSound = "none" | "else" | "blocked" | "on";

/** The bar running down from a question's start to its end, set as it shows (it runs by itself) */
function Drain({ q, now, still }: { q: QuizQuestion; now: number; still: boolean }) {
  const [delay] = useState(() => Math.min(0, q.at - now));
  const len = q.ends - q.at;
  if (still) return <i style={{ width: `${Math.max(0, Math.min(100, ((q.ends - now) / len) * 100))}%` }} />;
  return <i className="run" style={{ animationDuration: `${len}ms`, animationDelay: `${delay}ms` }} />;
}

function Stage({ q, ask, sound, phase, now, onSound }: { q: QuizQuestion; ask: QuizAsk | undefined; sound: QuizSound | null; phase: QuizPhase["at"]; now: number; onSound: () => void }) {
  const t = T.squad.quiz;
  const asking = phase === "ask" && q.answer === undefined;
  let mid: ReactNode;
  if (phase === "lead") mid = <span className="lead">{Math.max(1, Math.ceil((q.at - now) / 1000))}</span>;
  else if (q.kind === "meme") mid = <b className="board">{ask?.ask ?? q.ask ?? t.loading}</b>;
  else if (q.kind === "intro") {
    mid =
      sound === "none" ? (
        <span className="say">{t.noSound}</span>
      ) : sound === "else" ? (
        <span className="say">{t.listening}</span>
      ) : sound === "blocked" && asking ? (
        <button type="button" className="play" onClick={onSound}>
          {t.play}
        </button>
      ) : (
        <>
          <span className={`eq${asking ? " on" : ""}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="say">{asking ? t.intro : t.types.intro}</span>
        </>
      );
  } else if (ask?.pic)
    // eslint-disable-next-line @next/next/no-img-element -- a small WebP made on the server for this question, as a data URL
    mid = <img className={q.kind} src={ask.pic} alt={t.types[q.kind]} draggable={false} />;
  else mid = <span className="say">{ask ? t.noPicture : t.loading}</span>;
  return (
    <div className={`stage k-${q.kind}${phase === "lead" ? " k-lead" : ""}`}>
      <div className="mid">{mid}</div>
      {asking && <span className="secs">{fmt(t.secs, { s: Math.max(0, Math.ceil((q.ends - now) / 1000)) })}</span>}
    </div>
  );
}

/** The card as it shows, for the room and its quiz as they are now (on the server's clock) */
export function QuizView({
  room,
  mode,
  now,
  asks,
  picks,
  sound,
  busy,
  msg,
  still = false,
  onClose,
  onPick,
  onJoin,
  onLeave,
  onSound,
}: {
  room: SquadRoom;
  mode: QuizMode;
  now: number;
  /** Each question's three and picture or song, by number, once the page has it */
  asks: Readonly<Record<number, QuizAsk>>;
  picks: QuizPicks | null;
  sound: QuizSound | null;
  busy: boolean;
  msg: string | null;
  /** No motion (prefers-reduced-motion): the bar drawn where it is */
  still?: boolean;
  onClose: () => void;
  onPick: (n: number, pick: number) => void;
  /** 下一局算我: one not in this round asks for the next */
  onJoin: () => void;
  onLeave: () => void;
  onSound: () => void;
}) {
  const t = T.squad.quiz;
  const phase = quizPhase(mode, now);
  const me = mode.in.some((m) => m.h === room.you);
  const queued = !me && mode.next.includes(room.you);
  // your answers in this round (a match plays round after round from one start)
  const mine = picks?.at === mode.begun ? picks : null;
  const head =
    phase.at === "lead"
      ? fmt(t.startsIn, { s: Math.max(1, Math.ceil((phase.q.at - now) / 1000)) })
      : phase.at === "results"
        ? t.done
        : fmt(t.count, { n: phase.q.n + 1, of: QUIZ_QUESTIONS });
  const players = playersOf(room, mode);
  return (
    <div className="sq-quiz" role="dialog" aria-label={t.title}>
      <header>
        <b>{head}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <StackBehind />
      {players.length > 0 && (
        <div className="players">
          {players.map(({ m, points }) => (
            <span key={m.h} className={`pl${m.you ? " you" : ""}`}>
              <SquadRoach m={{ ...m, pose: 0 }} size={28} />
              <span className="tx">
                <small>{m.you ? T.squad.room.you : m.name}</small>
                <b>{points}</b>
              </span>
            </span>
          ))}
        </div>
      )}
      {phase.at === "results" ? (
        <Results room={room} mode={mode} />
      ) : (
        <Question room={room} mode={mode} phase={phase} now={now} ask={asks[phase.q.n]} pick={mine?.picks[phase.q.n]} me={me} sound={sound} busy={busy} still={still} onPick={onPick} onSound={onSound} />
      )}
      {queued && phase.at !== "results" && <p className="qline">{T.squad.lobby.queued}</p>}
      {!me && !queued && phase.at !== "results" && (
        <div className="watch">
          <button type="button" disabled={busy} onClick={onJoin}>
            {T.squad.lobby.late}
          </button>
        </div>
      )}
      {me && phase.at !== "results" && (
        <button type="button" className="leave" disabled={busy} onClick={onLeave}>
          {t.leave}
        </button>
      )}
      {msg && (
        <p className="qmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{t.note}</p>
    </div>
  );
}

function Question({
  room,
  mode,
  phase,
  now,
  ask,
  pick,
  me,
  sound,
  busy,
  still,
  onPick,
  onSound,
}: {
  room: SquadRoom;
  mode: QuizMode;
  phase: Exclude<QuizPhase, { at: "results" }>;
  now: number;
  ask: QuizAsk | undefined;
  pick: QuizPick | undefined;
  me: boolean;
  sound: QuizSound | null;
  busy: boolean;
  still: boolean;
  onPick: (n: number, pick: number) => void;
  onSound: () => void;
}) {
  const t = T.squad.quiz;
  const { q } = phase;
  const answer = q.answer ?? pick?.answer;
  const shown = phase.at !== "lead";
  const options = shown ? (ask?.options ?? q.options) : undefined;
  const open = phase.at === "ask" && q.answer === undefined && me && !pick;
  const res = shown ? resultLine(room, q, pick, now) : null;
  const next = mode.questions[q.n + 1];
  const decided = q.answer !== undefined || now >= q.ends;
  const after =
    !decided || phase.at === "lead" ? null : next ? fmt(t.next, { s: Math.max(1, Math.ceil((next.at - now) / 1000)) }) : t.lastOne;
  return (
    <>
      <div className="qcard">
        <div className="types" aria-hidden="true">
          {QUIZ_KINDS.map((k) => (
            <span key={k} className={k === q.kind ? "on" : ""}>
              {t.types[k]}
            </span>
          ))}
        </div>
        <Stage q={q} ask={ask} sound={sound} phase={phase.at} now={now} onSound={onSound} />
        <div className="drain">{phase.at === "ask" && q.answer === undefined && <Drain key={q.n} q={q} now={now} still={still} />}</div>
        {shown && q.kind !== "meme" && <p className="ask">{t.asks[q.kind]}</p>}
        <div className="opts">
          {[0, 1, 2].map((k) => {
            const ok = answer === k;
            const bad = pick?.pick === k && answer !== undefined && !ok;
            const firstHere = ok && q.first;
            const tag = firstHere
              ? fmt(t.fast, { name: nameOf(room, q.first!.h), s: (q.first!.ms / 1000).toFixed(1) })
              : pick?.pick === k
                ? t.yours
                : "";
            return (
              <button
                key={k}
                type="button"
                className={`opt${ok ? " ok" : bad ? " bad" : pick?.pick === k ? " mine" : ""}`}
                disabled={!open || busy || !options}
                onClick={() => onPick(q.n, k)}
              >
                <b>{"ABC"[k]}</b>
                <span>{options?.[k] ?? "…"}</span>
                {tag && <small>{tag}</small>}
              </button>
            );
          })}
        </div>
      </div>
      {(res || after) && (
        <div className="res">
          {res ? <span key={`${q.n}:${res.text}`} className={res.tone || undefined}>{res.text}</span> : <span />}
          {after && <small>{after}</small>}
        </div>
      )}
    </>
  );
}

function Results({ room, mode }: { room: SquadRoom; mode: QuizMode }) {
  const t = T.squad.quiz;
  const ranks = quizRanks(room, mode);
  return (
    <div className="results">
      <h3>{t.results}</h3>
      <ol>
        {ranks.map(({ m, points, place, ladle }) => (
          <li key={m.h} className={m.you ? "you" : ""}>
            <span className="pn">{fmt(t.place, { n: place })}</span>
            <SquadRoach m={{ ...m, pose: 0 }} size={28} />
            <span className="nm">{m.you ? T.squad.room.you : m.name}</span>
            {ladle && <em>{t.ladleTag}</em>}
            <b>{fmt(t.points, { n: points })}</b>
          </li>
        ))}
      </ol>
      <p className="end">{ladleLine(room, mode)}</p>
    </div>
  );
}

/** The intro's music, one element for the page (made at the first play) */
let el: HTMLAudioElement | null = null;
let elSrc: string | null = null;
const audio = () => (el ??= Object.assign(new Audio(), { preload: "auto" }));

/**
 * The intro put where it is now on the server's clock (its 0 at `at`, len ms long) and played; held at 0 before its
 * start, stopped at its end. Says how long till the next thing to do (ms, else 0). refused: the browser will play it
 * only from a tap.
 */
function placeIntro(src: string, at: number, len: number, refused: () => void, played: () => void): number {
  const a = audio();
  if (elSrc !== src) {
    a.src = src;
    elSrc = src;
  }
  const now = squadServerNow();
  const t = (now - at) / 1000;
  if (t < 0) {
    if (!a.paused) a.pause();
    if (a.currentTime > 0.05) a.currentTime = 0;
    return at - now;
  }
  if (now >= at + len) {
    if (!a.paused) a.pause();
    return 0;
  }
  if (Math.abs(a.currentTime - t) > DRIFT_S) a.currentTime = t;
  if (a.paused)
    a.play().then(played, (e: unknown) => {
      if (e instanceof DOMException && e.name === "NotAllowedError") refused();
    });
  return at + len - now;
}

/** An intro's music while src is given (null: none, or not now): kept where it is, stopped at its end; and what plays it from a tap */
export function useIntro(src: string | null, at: number, len: number) {
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let timer = 0;
    const go = () => {
      window.clearTimeout(timer);
      const wait = placeIntro(src, at, len, () => setBlocked(src), () => setBlocked(null));
      if (wait > 0) timer = window.setTimeout(go, Math.min(wait, 1_000));
    };
    go();
    const a = audio();
    a.addEventListener("loadedmetadata", go);
    return () => {
      window.clearTimeout(timer);
      a.removeEventListener("loadedmetadata", go);
      a.pause();
    };
  }, [src, at, len]);
  useEffect(() => () => el?.pause(), []);
  return {
    blocked: Boolean(src) && blocked === src,
    start: () => {
      if (src) placeIntro(src, at, len, () => setBlocked(src), () => setBlocked(null));
    },
  };
}

/**
 * Each question of the quiz playing asked for from just before it starts (its three, its picture or song), and the
 * room read again once its time is up, for its answer; failed: why one could not be had, after its tries
 */
export function useQuizAsks(mode: QuizMode | null, now: number, failed: (text: string) => void) {
  const [asks, setAsks] = useState<{ at: number; got: Record<number, QuizAsk> }>({ at: 0, got: {} });
  const asking = useRef(new Map<string, number>());
  const looked = useRef(new Set<string>());
  const fail = useRef(failed);
  fail.current = failed;
  // by round: a match plays round after round from one start (at), each its own questions (begun)
  const got = mode && asks.at === mode.begun ? asks.got : NO_ASKS;
  useEffect(() => {
    if (!mode) return;
    for (const q of mode.questions) {
      const key = `${mode.begun}:${q.n}`;
      const tries = asking.current.get(key) ?? 0;
      if (!got[q.n] && tries >= 0 && tries < ASK_TRIES && now >= q.at - QUIZ_FETCH_MS + ASK_AFTER_MS && now < q.ends + QUIZ_REVEAL_MS) {
        // -1: on its way
        asking.current.set(key, -1);
        squadQuizAsk(q.n)
          .then((a) => {
            asking.current.delete(key);
            setAsks((was) => ({ at: mode.begun, got: { ...(was.at === mode.begun ? was.got : {}), [q.n]: a } }));
          })
          .catch((e: unknown) => {
            window.setTimeout(() => asking.current.set(key, tries + 1), ASK_AGAIN_MS);
            if (tries + 1 >= ASK_TRIES) fail.current(e instanceof WorldError ? e.message : T.map.common.tryAgain);
          });
      }
      if (q.answer === undefined && now >= q.ends + ANSWER_AFTER_MS && !looked.current.has(key)) {
        looked.current.add(key);
        void loadSquadRoom().catch(() => {});
      }
    }
  }, [mode, now, got]);
  return got;
}

export default function SquadQuiz() {
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const picks = useSquadQuizPicks();
  useListenPlayer();
  const [now, setNow] = useState(() => squadServerNow());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [still] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const mode = room?.mode?.kind === "quiz" && !room.mode.wait && room.mode.at === openAt ? room.mode : null;
  const open = Boolean(mode);
  const got = useQuizAsks(mode, now, setMsg);

  useEffect(() => {
    if (!open) return;
    setNow(squadServerNow());
    const t = window.setInterval(() => setNow(squadServerNow()), TICK_MS);
    return () => window.clearInterval(t);
  }, [open]);

  const phase = mode ? quizPhase(mode, now) : null;
  const q = phase && phase.at !== "results" ? phase.q : null;
  const ask = q ? got[q.n] : undefined;
  const listening = isListening();
  const src = q?.kind === "intro" && ask?.url ? (ask.lite && listenLiteNow() ? ask.lite : ask.url) : null;
  const intro = useIntro(src && !listening ? src : null, q?.at ?? 0, q ? q.ends - q.at : 0);

  if (!mode || !room) return null;
  const sound: QuizSound | null =
    q?.kind !== "intro" ? null : ask && !ask.url ? "none" : listening ? "else" : intro.blocked ? "blocked" : "on";
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
  return (
    <QuizView
      room={room}
      mode={mode}
      now={now}
      asks={got}
      picks={picks}
      sound={sound}
      busy={busy}
      msg={msg}
      still={still}
      onClose={closeSquadModeCard}
      onPick={(n, pick) => {
        setMsg(null);
        squadQuizAnswer(n, pick).catch((e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
      }}
      onJoin={() => void run(() => squadModeIn(true))}
      onLeave={() => void run(() => squadModeIn(false))}
      onSound={intro.start}
    />
  );
}
