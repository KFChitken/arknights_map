"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { isCourse, otherCourses, subjectOf, type CourseId } from "@/lib/study/courses";
import { drawCourse } from "@/lib/study/draw";
import { guestDone, guestGiveUp, guestToday, type GuestToday } from "@/lib/study/guest";
import type { PassesDot } from "@/lib/passes";
import { factIndex, GIVE_UP_AFTER, newSeed, nextSeal, roundTells, SEALS, type StudyMe, type StudySaid, type StudyToday } from "@/lib/study/rules";
import type { Sheet as Paper325, Show } from "@/lib/study/board";
import { NotToday, StaleToday, studyApi } from "@/lib/studyClient";
import { BoardPaused, writingApi } from "@/lib/writingClient";
import { WorldError } from "@/lib/world/types";
import RoachIcon from "../../RoachIcon";
import Sheet from "../Sheet";
import Board, { PutUp, type PaperUp } from "./Board";
import { loadGame, type Game, type Look, type Round } from "./games";
import { mapsOwn, sayWhy } from "./refused";
import "./study.css";

/**
 * 325大学习 (src/lib/study): the course drawn for today with the days studied and the seals towards which they count,
 * the rounds of it lost and, after GIVE_UP_AFTER of them, the way to give it up; the other courses, any of them for
 * those who may pick (the 站长 and the admins), and for everyone else one at random once today's is done, never one
 * held back (courses.ts HELD); and 下课's page after a round. A round is played on a layer of its own over everything
 * (the whole screen on a phone, a card in the middle on a computer), so that tapping and swiping in a game never closes
 * or scrolls a sheet. Each round is dealt from a seed of its own; a round of today's course counts the moment it is
 * over (won: today's is passed; lost: one more lost; a step on the way: nothing), and leaving before that counts
 * nothing. A player (never a visitor) says 苦也！ as they give today's course up, and may say 已完成今日的325大学习 once a
 * day after passing it. 徒手写's 手写榜 (Board.tsx) opens from the course list and from 下课's page after 徒手写; a
 * round of 徒手写 passed by a player sends the paper for the server to mark again (so they may rate others'), and 下课's
 * page then offers to put it up.
 * signedIn: the server draws and counts (src/lib/studyClient.ts); otherwise this browser draws, and counts no days
 * (src/lib/study/guest.ts). look: the player's roach, lying belly up after a round lost. onState: what the server last
 * said of the player's study (the dot on the way in, 抽屉's card); onGuestDone: a visitor passed the day's course (or
 * gave it up); onPassesDot: a declaration said lit the 每日任务 dot, or not; onRefused: what the map page answers itself
 * (sign in, say again they are 18, agree to the privacy policy), which closes this first.
 */
export default function Study({
  signedIn,
  look,
  onClose,
  onState,
  onGuestDone,
  onPassesDot,
  onRefused,
}: {
  signedIn: boolean;
  look: Look;
  onClose: () => void;
  onState: (s: StudyMe) => void;
  onGuestDone: (day: string) => void;
  onPassesDot: (r: PassesDot) => void;
  onRefused: (e: unknown) => void;
}) {
  const [today, setToday] = useState<Today | null>(() => (signedIn ? null : guestsOwn(guestToday())));
  const [failed, setFailed] = useState<string | null>(null);
  /** Said over the course list: the day turned, so today's course is another */
  const [note, setNote] = useState("");
  const [screen, setScreen] = useState<"home" | "play" | "finish" | "board">("home");
  /** Where the 手写榜 was opened from, and goes back to */
  const [boardFrom, setBoardFrom] = useState<"home" | "finish">("home");
  const [game, setGame] = useState<{ id: CourseId; Game: Game; key: number; seed: number; mode?: string } | null>(null);
  /** A game being fetched, and one that could not be */
  const [opening, setOpening] = useState<CourseId | null>(null);
  const [openFailed, setOpenFailed] = useState<CourseId | null>(null);
  /** The round just over: which course, how it went, and the site day of the course list it was played from */
  const [ended, setEnded] = useState<{ id: CourseId; r: Round; day: string } | null>(null);
  /** Telling the server how a round of today's course went: on its way, or what went wrong */
  const [save, setSave] = useState<"saving" | { why: string } | null>(null);
  /** Giving today's course up: on its way, or what went wrong */
  const [giving, setGiving] = useState<"saving" | { why: string } | null>(null);
  /** What became of 苦也！, said as today's course was given up just now */
  const [said, setSaid] = useState<StudySaid | null>(null);
  /** 已完成今日的325大学习: on its way, how far it reached, or what went wrong */
  const [announcing, setAnnouncing] = useState<"saving" | StudySaid | null>(null);
  /** The round just over's paper of 徒手写, passed by a player: marked again by the server, and maybe put up */
  const [paper, setPaper] = useState<PaperUp | null>(null);

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const stateRef = useRef(onState);
  stateRef.current = onState;
  const guestDoneRef = useRef(onGuestDone);
  guestDoneRef.current = onGuestDone;
  const passesRef = useRef(onPassesDot);
  passesRef.current = onPassesDot;
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;
  const playNo = useRef(0);
  /** The courses dealt at random since this was opened, and the one played last: neither is dealt next */
  const dealt = useRef<string[]>([]);
  const lastPlayed = useRef<CourseId | null>(null);

  /** Today as the server has it: shown, and told to the map page */
  const took = useCallback((t: StudyToday) => {
    setToday({ day: t.day, course: t.course, done: t.done, days: t.days, fails: t.fails, skipped: t.skipped, pick: t.pick, announced: t.announced });
    // not said today: what this page last heard of it was another day's
    if (!t.announced) setAnnouncing((a) => (a === "saving" ? a : null));
    stateRef.current({ day: t.day, done: t.done, days: t.days, fails: t.fails });
  }, []);

  const load = useCallback(() => {
    setFailed(null);
    studyApi.today().then(
      (t) => live.current && took(t),
      (e) => {
        if (mapsOwn(e)) return refusedRef.current(e);
        // offline, the books did not open; any other refusal says why
        if (live.current) setFailed(e instanceof WorldError && e.message !== T.requests.offline ? e.message : T.study.failed);
      },
    );
  }, [took]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  /** Back to the course list: from a round not over, it counts nothing */
  const toList = useCallback(() => {
    setScreen("home");
    setGame(null);
    setEnded(null);
    setSaid(null);
  }, []);

  /** A visitor's course of that day was another by the time it counted: today's, drawn again, on the course list */
  const visitorsDayTurned = () => {
    setToday(guestsOwn(guestToday()));
    setNote(T.study.dayTurned);
  };

  /** A round of the course drawn on `day` was played: won, today's is passed (the first time); lost, one more lost */
  const record = (id: CourseId, day: string, won: boolean) => {
    if (!signedIn) {
      const t = guestDone(day, id, won);
      if (!t) return visitorsDayTurned();
      setToday(guestsOwn(t));
      if (t.done) guestDoneRef.current(day);
      return;
    }
    setSave("saving");
    studyApi.done(id, won).then(
      (d) => {
        if (!live.current) return;
        setSave(null);
        setToday((t) => (t && t.day === day ? { ...t, ...d } : t));
        stateRef.current({ day, done: d.done, days: d.days, fails: d.fails });
      },
      (e) => {
        if (!live.current) return;
        if (e instanceof StaleToday) {
          setSave(null);
          took(e.today);
          setNote(T.study.dayTurned);
        } else if (mapsOwn(e)) refusedRef.current(e);
        else setSave({ why: sayWhy(e) });
      },
    );
  };

  /** Today's course given up after GIVE_UP_AFTER rounds of it lost: a day studied all the same (saying 苦也！ if it can), then 下课's page */
  const giveUp = (id: CourseId, day: string) => {
    if (!signedIn) {
      const t = guestGiveUp(day, id);
      if (!t) {
        visitorsDayTurned();
        return toList();
      }
      setToday(guestsOwn(t));
      guestDoneRef.current(day);
      setScreen("finish");
      return;
    }
    setGiving("saving");
    studyApi.giveUp(id).then(
      ({ said, passesDot, ...d }) => {
        if (!live.current) return;
        setGiving(null);
        setToday((t) => (t && t.day === day ? { ...t, ...d } : t));
        stateRef.current({ day, done: d.done, days: d.days, fails: d.fails });
        setSaid(said ?? null);
        passesRef.current({ passesDot });
        setScreen("finish");
      },
      (e) => {
        if (!live.current) return;
        if (e instanceof StaleToday) {
          // the day turned, or too few lost after all: today's as the server has it
          setGiving(null);
          took(e.today);
          setNote(e instanceof NotToday ? T.study.dayTurned : e.message);
          toList();
        } else if (mapsOwn(e)) refusedRef.current(e);
        else setGiving({ why: sayWhy(e) });
      },
    );
  };

  /** 已完成今日的325大学习, said from the player's main roach once today's is passed */
  const announce = () => {
    setAnnouncing("saving");
    studyApi.announce().then(
      ({ reach, passesDot }) => {
        if (!live.current) return;
        setAnnouncing({ reach });
        setToday((t) => t && { ...t, announced: true });
        passesRef.current({ passesDot });
      },
      (e) => {
        if (!live.current) return;
        if (mapsOwn(e)) return refusedRef.current(e);
        setAnnouncing({ failed: sayWhy(e) });
      },
    );
  };

  const start = (id: CourseId, mode?: string) => {
    setOpening(id);
    setOpenFailed(null);
    setNote("");
    setSaid(null);
    setGiving((g) => (g === "saving" ? g : null));
    loadGame(id).then(
      (Game) => {
        if (!live.current) return;
        setOpening(null);
        setEnded(null);
        setPaper(null);
        setSave((s) => (s === "saving" ? s : null));
        setGame({ id, Game, key: ++playNo.current, seed: newSeed(), mode });
        lastPlayed.current = id;
        setScreen("play");
      },
      () => {
        if (!live.current) return;
        setOpening(null);
        setOpenFailed(id);
      },
    );
  };

  /** Another course at random, for one who may not pick, once today's is done: none dealt since this was opened, until all the others have been */
  const dealAnother = () => {
    if (!today) return;
    const others = otherCourses(today.pick, today.course);
    if (!others.length) return;
    const { course, bag } = drawCourse({ bag: dealt.current, last: lastPlayed.current }, others, Math.random);
    dealt.current = bag;
    start(course);
  };

  const roundOver = (id: CourseId, r: Round, key: number) => {
    if (!today) return;
    setEnded({ id, r, day: today.day });
    // a step on the way tells nothing; once today's is passed nothing more counts; no other course does
    if (roundTells(r, id === today.course && !today.done)) record(id, today.day, r.won);
    // 徒手写 passed: the server marks the paper again, and knows the player passed (to rate others'); a visitor's stays here
    if (r.paper && r.won && signedIn) sendPaper(key, r.paper);
  };

  /** 徒手写's paper passed sent to be marked again, and what the server says of it: their own up already, how many more may go up today */
  const sendPaper = (key: number, sheet: Paper325) => {
    setPaper({ key, sheet, pass: "sending", put: null });
    const mine = (p: PaperUp | null): p is PaperUp => p !== null && p.key === key;
    writingApi.pass(sheet).then(
      (passed) => live.current && setPaper((p) => (mine(p) ? { ...p, pass: passed } : p)),
      (e) => {
        if (!live.current) return;
        if (mapsOwn(e)) return refusedRef.current(e);
        setPaper((p) => (mine(p) ? { ...p, pass: { failed: sayWhy(e) } } : p));
      },
    );
  };

  /** That paper put on the 手写榜, as 匿名舟P or named */
  const putUp = (show: Show) => {
    if (!paper || paper.put === "sending") return;
    const { key, sheet } = paper;
    const mine = (p: PaperUp | null): p is PaperUp => p !== null && p.key === key;
    setPaper((p) => (mine(p) ? { ...p, put: "sending" } : p));
    writingApi.publish(sheet, show).then(
      ({ mine: up }) => live.current && setPaper((p) => (mine(p) ? { ...p, put: { mine: up } } : p)),
      (e) => {
        if (!live.current) return;
        if (mapsOwn(e)) return refusedRef.current(e);
        const why = e instanceof BoardPaused ? T.study.board.paused : sayWhy(e);
        setPaper((p) => (mine(p) ? { ...p, put: { failed: why } } : p));
      },
    );
  };

  const openBoard = (from: "home" | "finish") => {
    setBoardFrom(from);
    setScreen("board");
  };

  const replay = () => {
    const mode = ended?.r.again?.mode ?? game?.mode;
    setEnded(null);
    setPaper(null);
    setSave((s) => (s === "saving" ? s : null));
    setGiving((g) => (g === "saving" ? g : null));
    setGame((g) => g && { ...g, key: ++playNo.current, seed: newSeed(), mode });
    setScreen("play");
  };

  // what is pressed just as a round ends is not taken as a press on what then shows under the finger
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    if (!ended) return;
    const t = window.setTimeout(() => setArmed(true), 450);
    return () => window.clearTimeout(t);
  }, [ended]);

  // the play layer: the keyboard in it, Escape back to the course list
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (screen !== "play") return;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      toList();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, toList]);

  /** Today's course may be given up now: GIVE_UP_AFTER rounds of it lost, and not passed */
  const mayGiveUp = (t: Today) => !t.done && t.fails >= GIVE_UP_AFTER && isCourse(t.course);
  const giveUpButton = (t: Today, className: string) => (
    <>
      <button className={className} disabled={giving === "saving"} onClick={() => isCourse(t.course) && giveUp(t.course, t.day)}>
        {giving === "saving" ? T.study.saving : signedIn ? T.study.giveUpSay : T.study.giveUp}
      </button>
      {giving && giving !== "saving" && <p className="st-err">{fmt(T.study.giveUpFailed, { why: giving.why })}</p>}
    </>
  );
  /** 已完成今日的325大学习 may be said: a player's, today's passed (not given up), not said yet today unless just now */
  const mayAnnounce = (t: Today) => signedIn && t.done && !t.skipped && (!t.announced || (announcing !== null && announcing !== "saving" && "reach" in announcing));
  const announceButton = (className: string) =>
    announcing && announcing !== "saving" && "reach" in announcing ? (
      <p className="st-said">{fmt(T.map.declare.sent, { reach: announcing.reach })}</p>
    ) : (
      <>
        <button className={className} disabled={announcing === "saving"} onClick={announce}>
          {announcing === "saving" ? T.study.announcing : T.study.announce}
        </button>
        {announcing && announcing !== "saving" && "failed" in announcing && <p className="st-err">{fmt(T.study.announceFailed, { why: announcing.failed })}</p>}
      </>
    );

  if (screen === "play" && game && today) {
    const name = T.study.courses[game.id].name;
    const lost = ended && !ended.r.won;
    // today's course lost, as many times as it may be given up after
    const canQuit = ended && lost && ended.id === today.course && ended.day === today.day && mayGiveUp(today);
    return (
      <div className="study-play">
        <div ref={box} className="sp-box" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
          <header className="sp-head">
            <span className="sp-title">
              <small>{T.study.subjects[subjectOf(game.id)]}</small>
              <b>{name}</b>
            </span>
            <button className="sp-quit" data-quit aria-label={T.study.play.quit} title={T.study.play.quit} onClick={toList}>
              ×
            </button>
          </header>
          <div className="sp-game">
            <game.Game
              key={game.key}
              day={today.day}
              seed={game.seed}
              mode={game.mode}
              todays={game.id === today.course && !today.done}
              look={look}
              onRound={(r) => roundOver(game.id, r, game.key)}
            />
          </div>
          <footer className={`sp-end${armed ? " armed" : ""}`} role="status">
            {ended && (
              <>
                {lost && (
                  <span className="sp-belly">
                    <RoachIcon color={look.color} avatar={look.avatar} look={look.style} asleep size={56} />
                  </span>
                )}
                <p className="sp-verdict">{ended.r.verdict}</p>
                {save && save !== "saving" && ended.id === today.course && <Unsaved why={save.why} onResend={() => record(ended.id, ended.day, ended.r.won)} />}
                <div className="sp-btns">
                  <button className="st-ghost" onClick={replay}>
                    {ended.r.again?.label ?? T.study.play.replay}
                  </button>
                  <button className="st-go" onClick={() => setScreen("finish")}>
                    {T.study.play.end}
                  </button>
                </div>
                {canQuit && giveUpButton(today, "st-link sp-giveup")}
                {ended.r.paper && ended.r.won && signedIn && (
                  <button className="st-link sp-giveup" onClick={() => setScreen("finish")}>
                    {T.study.board.put.title}
                  </button>
                )}
              </>
            )}
          </footer>
        </div>
      </div>
    );
  }

  if (screen === "board") return <Board signedIn={signedIn} onUp={() => setScreen(boardFrom)} onClose={onClose} onRefused={(e) => refusedRef.current(e)} />;

  if (screen === "finish" && today) {
    // today's course, played on the day it was drawn for (or given up without a round)
    const todays = !ended || (ended.id === today.course && ended.day === today.day);
    const passed = todays && today.done;
    // a round of today's course lost, or only a step of it passed (the stopwatch's shown one), and today's not passed:
    // another round of it (one won is on its way to the server)
    const notYet = todays && !today.done && ended !== null && (!ended.r.won || Boolean(ended.r.step));
    const facts = T.study.facts;
    return (
      <Sheet title={T.study.title} className="study" onClose={onClose}>
        <div className="st-finish">
          {passed && (
            <>
              <span className="st-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30">
                  <path d="M5.5 12.5 10 17l8.5-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h3>{today.skipped ? T.study.finish.skipped : T.study.finish.done}</h3>
              <p className="st-sub">{today.days === null ? T.study.guest : fmt(T.study.days, { n: today.days })}</p>
              {said && today.skipped && (
                <p className={"reach" in said ? "st-said" : "st-err"}>
                  {"reach" in said ? fmt(T.map.declare.sent, { reach: said.reach }) : fmt(T.study.saidNot, { why: said.failed })}
                </p>
              )}
            </>
          )}
          {ended && <p className="st-round">{fmt(T.study.finish.round, { result: ended.r.result })}</p>}
          {ended?.r.paper &&
            ended.r.won &&
            (signedIn ? (
              paper && <PutUp paper={paper} onRetry={() => sendPaper(paper.key, paper.sheet)} onPut={putUp} onBoard={() => openBoard("finish")} />
            ) : (
              <p className="st-sub wb-sign-in">{T.study.board.put.signIn}</p>
            ))}
          {notYet && <p className="st-again">{ended?.r.step ? T.study.finish.stepped : T.study.finish.notYet}</p>}
          {todays && ended && save === "saving" && ended.r.won && !ended.r.step && <p className="st-sub">{T.study.saving}</p>}
          {todays && ended && save && save !== "saving" && <Unsaved why={save.why} onResend={() => record(ended.id, ended.day, ended.r.won)} />}
          {note && <p className="st-note">{note}</p>}
          {passed && (
            <div className="st-fact">
              <small>{T.study.finish.fact}</small>
              <p>{facts[factIndex(today.day, facts.length)]}</p>
            </div>
          )}
          {passed && mayAnnounce(today) && announceButton("st-ghost wide")}
          {notYet ? (
            <>
              <button className="st-go wide" onClick={replay}>
                {ended?.r.again?.label ?? T.study.play.replay}
              </button>
              {mayGiveUp(today) && giveUpButton(today, "st-ghost wide")}
              {today.pick && (
                <button className="st-ghost wide" onClick={toList}>
                  {T.study.finish.list}
                </button>
              )}
            </>
          ) : (
            <button className="st-go wide" disabled={opening !== null} onClick={() => (today.pick || !today.done ? toList() : dealAnother())}>
              {opening !== null ? T.study.loading : T.study.finish.another}
            </button>
          )}
          {openFailed && <p className="st-err">{T.study.failed}</p>}
          {ended?.r.paper && !(paper?.put && paper.put !== "sending" && "mine" in paper.put) && (
            <button className="st-ghost wide" onClick={() => openBoard("finish")}>
              {T.study.board.see}
            </button>
          )}
          <button className="st-ghost wide" onClick={onClose}>
            {T.study.finish.back}
          </button>
        </div>
      </Sheet>
    );
  }

  const others = today ? otherCourses(today.pick, today.course) : [];
  return (
    <Sheet title={T.study.title} className="study" onClose={onClose}>
      {!today ? (
        <div className="st-wait">
          <p>{failed ?? T.study.loading}</p>
          {failed && (
            <button className="st-ghost" onClick={load}>
              {T.study.retry}
            </button>
          )}
        </div>
      ) : (
        <>
          {note && (
            <p className="st-note" role="status">
              {note}
            </p>
          )}
          <p className="st-label">{T.study.today}</p>
          <section className={`st-today${today.done ? " done" : ""}`}>
            {isCourse(today.course) ? (
              <>
                <small className="st-subject">{T.study.subjects[subjectOf(today.course)]}</small>
                <b className="st-name">{T.study.courses[today.course].name}</b>
                <p className="st-rule">{todayRule(today.course, today.done)}</p>
                {today.done ? (
                  <p className="st-did">{today.skipped ? T.study.skippedToday : T.study.doneToday}</p>
                ) : today.fails > 0 ? (
                  <p className="st-fails">
                    <b>{fmt(T.study.fails, { n: today.fails })}</b>
                    {today.fails < GIVE_UP_AFTER && <span>{fmt(signedIn ? T.study.failsHintSay : T.study.failsHint, { n: GIVE_UP_AFTER })}</span>}
                  </p>
                ) : (
                  <p className="st-fails">{T.study.passToCount}</p>
                )}
                <button className="st-go" disabled={opening !== null} onClick={() => isCourse(today.course) && start(today.course)}>
                  {opening === today.course ? T.study.loading : today.done ? T.study.again : T.study.start}
                </button>
                {mayGiveUp(today) && giveUpButton(today, "st-ghost st-giveup")}
                {mayAnnounce(today) && announceButton("st-ghost st-say")}
                {openFailed === today.course && <p className="st-err">{T.study.failed}</p>}
              </>
            ) : (
              <>
                <p className="st-rule">{T.study.newCourse}</p>
                <button className="st-go" onClick={() => window.location.reload()}>
                  {T.study.reload}
                </button>
              </>
            )}
          </section>
          {today.days === null ? <p className="st-guest">{T.study.guest}</p> : <Days days={today.days} />}
          {others.length > 0 && (
            <div className="st-more">
              {today.pick ? (
                <>
                  <p>{T.study.moreOpen}</p>
                  <div className="st-chips">
                    {others.map((id) => (
                      <button key={id} className="st-chip" aria-disabled={opening !== null || undefined} onClick={() => opening === null && start(id)}>
                        {opening === id ? T.study.loading : T.study.courses[id].short}
                      </button>
                    ))}
                  </div>
                </>
              ) : today.done ? (
                <button className="st-ghost" disabled={opening !== null} onClick={dealAnother}>
                  {opening !== null && opening !== today.course ? T.study.loading : T.study.random}
                </button>
              ) : (
                <p>{T.study.more}</p>
              )}
              {openFailed && openFailed !== today.course && <p className="st-err">{T.study.failed}</p>}
            </div>
          )}
          <button className="st-ghost st-board" onClick={() => openBoard("home")}>
            {T.study.board.open}
          </button>
        </>
      )}
    </Sheet>
  );
}

/** What today's course is, on its card: how it is passed today, while it is not yet, for a course passed in steps */
function todayRule(id: CourseId, done: boolean): string {
  const c = T.study.courses[id];
  return !done && "todayRule" in c ? c.todayRule : c.rule;
}

/** Today's course as this page shows it: days null for a visitor, whose days are not counted */
type Today = { day: string; course: string; done: boolean; days: number | null; fails: number; skipped: boolean; pick: boolean; announced: boolean };

/** A visitor's day, as this page shows it: no days counted, courses dealt at random rather than picked, nothing said */
const guestsOwn = (t: GuestToday): Today => ({ ...t, days: null, pick: false, announced: false });

/** The days studied, the next seal and the six of them (got: filled; to come: dashed) */
function Days({ days }: { days: number }) {
  const next = nextSeal(days);
  return (
    <div className="st-days">
      <b>{fmt(T.study.days, { n: days })}</b>
      {next && <small>{fmt(T.study.nextSeal, { n: next.left, k: next.k })}</small>}
      <ol className="st-seals" aria-label={T.study.seals}>
        {SEALS.map((n) => (
          <li key={n} className={days >= n ? "got" : undefined}>
            <span aria-hidden="true">{n}</span>
            <span className="st-sr">{fmt(days >= n ? T.study.sealGot : T.study.seal, { n })}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A round of today's course the server was not told of, with the way to tell it again */
function Unsaved({ why, onResend }: { why: string; onResend: () => void }) {
  return (
    <p className="st-err">
      {fmt(T.study.notSaved, { why })}{" "}
      <button className="st-link" onClick={onResend}>
        {T.study.resend}
      </button>
    </p>
  );
}
