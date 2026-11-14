"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { COURSE_IDS, isCourse, subjectOf, type CourseId } from "@/lib/study/courses";
import { guestDone, guestToday } from "@/lib/study/guest";
import { factIndex, nextSeal, SEALS, type StudyMe, type StudyToday } from "@/lib/study/rules";
import { NotToday, studyApi } from "@/lib/studyClient";
import type { DrawnAvatar, RoachColor, RoachStyle } from "@/lib/types";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "@/lib/world/types";
import RoachIcon from "../../RoachIcon";
import Sheet from "../Sheet";
import { loadGame, type Game, type Round } from "./games";
import "./study.css";

/**
 * 325大学习 (src/lib/study): the course drawn for today with the days studied and the seals towards which they count,
 * the other courses (open once today's is played), and 下课's page after a round. A round is played on a layer of its
 * own over everything (the whole screen on a phone, a card in the middle on a computer), so that tapping and swiping
 * in a game never closes or scrolls a sheet; it counts the moment it is over, and leaving before that counts nothing.
 * signedIn: the server draws and counts (src/lib/studyClient.ts); otherwise this browser draws, and counts no days
 * (src/lib/study/guest.ts). look: the player's roach, lying belly up after a round lost. onState: what the server last
 * said of the player's study (the dot on the way in, 抽屉's card); onGuestDone: a visitor played the day's course;
 * onRefused: what the map page answers itself (sign in, say again they are 18, agree to the privacy policy), which
 * closes this first.
 */
export default function Study({
  signedIn,
  look,
  onClose,
  onState,
  onGuestDone,
  onRefused,
}: {
  signedIn: boolean;
  look: { color: RoachColor; avatar: DrawnAvatar; style: RoachStyle };
  onClose: () => void;
  onState: (s: StudyMe) => void;
  onGuestDone: (day: string) => void;
  onRefused: (e: unknown) => void;
}) {
  const [today, setToday] = useState<Today | null>(() => (signedIn ? null : { ...guestToday(), days: null }));
  const [failed, setFailed] = useState<string | null>(null);
  /** Said over the course list: the day turned, so today's course is another */
  const [note, setNote] = useState("");
  const [screen, setScreen] = useState<"home" | "play" | "finish">("home");
  const [game, setGame] = useState<{ id: CourseId; Game: Game; key: number; mode?: string } | null>(null);
  /** A game being fetched, and one that could not be */
  const [opening, setOpening] = useState<CourseId | null>(null);
  const [openFailed, setOpenFailed] = useState<CourseId | null>(null);
  /** The round just over: which course, how it went, and the site day of the course list it was played from */
  const [ended, setEnded] = useState<{ id: CourseId; r: Round; day: string } | null>(null);
  /** Telling the server a round of today's course was played: on its way, or what went wrong */
  const [save, setSave] = useState<"saving" | { why: string } | null>(null);
  /** Other courses, pressed while still shut */
  const [lockedTap, setLockedTap] = useState(false);

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
  const refusedRef = useRef(onRefused);
  refusedRef.current = onRefused;
  const playNo = useRef(0);

  /** Today as the server has it: shown, and told to the map page */
  const took = useCallback((t: StudyToday) => {
    setToday({ day: t.day, course: t.course, done: t.done, days: t.days });
    stateRef.current({ day: t.day, done: t.done, days: t.days });
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

  /** A round of the course drawn on `day` was played: today's studied, the first time */
  const record = (id: CourseId, day: string) => {
    if (!signedIn) {
      if (guestDone(day, id)) {
        setToday((t) => t && { ...t, done: true });
        guestDoneRef.current(day);
      } else {
        // the day turned while it was played: today's is another course
        setToday({ ...guestToday(), days: null });
        setNote(T.study.dayTurned);
      }
      return;
    }
    setSave("saving");
    studyApi.done(id).then(
      (d) => {
        if (!live.current) return;
        setSave(null);
        setToday((t) => (t && t.day === day ? { ...t, done: true, days: d.days } : t));
        stateRef.current({ day, done: true, days: d.days });
      },
      (e) => {
        if (!live.current) return;
        if (e instanceof NotToday) {
          setSave(null);
          took(e.today);
          setNote(T.study.dayTurned);
        } else if (mapsOwn(e)) refusedRef.current(e);
        else setSave({ why: sayWhy(e) });
      },
    );
  };

  const start = (id: CourseId, mode?: string) => {
    setOpening(id);
    setOpenFailed(null);
    setLockedTap(false);
    setNote("");
    loadGame(id).then(
      (Game) => {
        if (!live.current) return;
        setOpening(null);
        setEnded(null);
        setSave((s) => (s === "saving" ? s : null));
        setGame({ id, Game, key: ++playNo.current, mode });
        setScreen("play");
      },
      () => {
        if (!live.current) return;
        setOpening(null);
        setOpenFailed(id);
      },
    );
  };

  const roundOver = (id: CourseId, r: Round) => {
    if (!today) return;
    setEnded({ id, r, day: today.day });
    // another round of it adds nothing, and no other course counts
    if (id === today.course && !today.done) record(id, today.day);
  };

  const replay = () => {
    const mode = ended?.r.again?.mode ?? game?.mode;
    setEnded(null);
    setSave((s) => (s === "saving" ? s : null));
    setGame((g) => g && { ...g, key: ++playNo.current, mode });
  };

  /** Back to the course list: from a round not over, it counts nothing */
  const toList = useCallback(() => {
    setScreen("home");
    setGame(null);
    setEnded(null);
  }, []);

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

  if (screen === "play" && game && today) {
    const name = T.study.courses[game.id].name;
    const lost = ended && !ended.r.won;
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
            <game.Game key={game.key} day={today.day} mode={game.mode} onRound={(r) => roundOver(game.id, r)} />
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
                {save && save !== "saving" && ended.id === today.course && <Unsaved why={save.why} onResend={() => record(ended.id, ended.day)} />}
                <div className="sp-btns">
                  <button className="st-ghost" onClick={replay}>
                    {ended.r.again?.label ?? T.study.play.replay}
                  </button>
                  <button className="st-go" onClick={() => setScreen("finish")}>
                    {T.study.play.end}
                  </button>
                </div>
              </>
            )}
          </footer>
        </div>
      </div>
    );
  }

  if (screen === "finish" && ended && today) {
    // today's course, played on the day it was drawn for
    const todays = ended.id === today.course && ended.day === today.day;
    const facts = T.study.facts;
    return (
      <Sheet title={T.study.title} className="study" onClose={onClose}>
        <div className="st-finish">
          {todays && today.done && (
            <>
              <span className="st-check" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30">
                  <path d="M5.5 12.5 10 17l8.5-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <h3>{T.study.finish.done}</h3>
              <p className="st-sub">{today.days === null ? T.study.guest : fmt(T.study.days, { n: today.days })}</p>
            </>
          )}
          <p className="st-round">{fmt(T.study.finish.round, { result: ended.r.result })}</p>
          {todays && save === "saving" && <p className="st-sub">{T.study.saving}</p>}
          {todays && save && save !== "saving" && <Unsaved why={save.why} onResend={() => record(ended.id, ended.day)} />}
          {note && <p className="st-note">{note}</p>}
          {todays && today.done && (
            <div className="st-fact">
              <small>{T.study.finish.fact}</small>
              <p>{facts[factIndex(today.day, facts.length)]}</p>
            </div>
          )}
          <button className="st-go wide" onClick={toList}>
            {T.study.finish.another}
          </button>
          <button className="st-ghost wide" onClick={onClose}>
            {T.study.finish.back}
          </button>
        </div>
      </Sheet>
    );
  }

  const others = today ? COURSE_IDS.filter((c) => c !== today.course) : [];
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
                <p className="st-rule">{T.study.courses[today.course].rule}</p>
                {today.done && <p className="st-did">{T.study.doneToday}</p>}
                <button className="st-go" disabled={opening !== null} onClick={() => isCourse(today.course) && start(today.course)}>
                  {opening === today.course ? T.study.loading : today.done ? T.study.again : T.study.start}
                </button>
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
              <p>{today.done ? T.study.moreOpen : T.study.more}</p>
              <div className="st-chips">
                {others.map((id) => (
                  <button
                    key={id}
                    className={`st-chip${today.done ? "" : " shut"}`}
                    aria-disabled={!today.done || opening !== null || undefined}
                    onClick={() => (!today.done ? setLockedTap(true) : opening === null && start(id))}
                  >
                    {opening === id ? T.study.loading : T.study.courses[id].short}
                  </button>
                ))}
              </div>
              {lockedTap && !today.done && <p className="st-hint">{T.study.locked}</p>}
              {openFailed && openFailed !== today.course && <p className="st-err">{T.study.failed}</p>}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

type Today = { day: string; course: string; done: boolean; days: number | null };

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

/** The refusals the map page answers itself: sign in, say again they are 18, agree to the updated privacy policy */
const mapsOwn = (e: unknown) => e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded;

/** What to say of any other refusal */
function sayWhy(e: unknown): string {
  if (e instanceof WorldError) return e.message;
  console.error(e);
  return T.map.common.tryAgain;
}
