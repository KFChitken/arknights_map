"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { callName } from "@/lib/amiya";
import { declarationText, type Declaration } from "@/lib/declarations";
import { distanceKm } from "@/lib/geo";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM } from "@/lib/rules";
import type { UiName } from "@/lib/uiChoice";
import type { Me, PublicRoach } from "@/lib/world/types";
import { AmiyaPicture } from "./Amiya";

/**
 * The newcomer tutorial, told by 阿米娅向导: put down your main roach and a
 * clone (both required, and both can be taken back), a card for your roach, a
 * first declaration, and a first touch, practised on her on Rhode Island; she is
 * no player, so after it she points at real ones. Every step but the two roaches
 * can be skipped. What is on the map, and whether you declared or touched, comes
 * from the server; the rest is remembered in this browser only.
 */

export type TutorialStep = "main" | "clone" | "card" | "greet" | "touch" | "done";

export type Progress = {
  clone?: true;
  card?: true;
  greet?: true;
  practiced?: true;
  touch?: true;
  done?: true;
  skipped?: true;
};

const key = (userId: string) => `zhoup.tutorial.${userId}`;

export function loadProgress(userId: string): Progress {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? "{}") as Progress;
  } catch {
    return {};
  }
}

export function saveProgress(userId: string, p: Progress) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(p));
  } catch {}
}

export function tutorialStep(me: Me | null, p: Progress): TutorialStep | null {
  if (!me?.isNew || p.skipped || p.done) return null;
  if (!me.roaches.some((r) => r.slot === 0)) return "main";
  // once put down, taking the clone back later does not start this step again
  if (!p.clone && !me.roaches.some((r) => r.slot > 0)) return "clone";
  if (!p.card) return "card";
  if (!me.hasDeclared && !p.greet) return "greet";
  if (!me.hasTouched && !p.touch) return "touch";
  return "done";
}

/** A few ready sentences to greet the neighbourhood with; never 「我是…」, which shows your name. */
export function greetings(me: Me): Declaration[] {
  const game = me.profile.games[0] ?? "arknights";
  const favourite = me.profile.games.flatMap((g) => me.profile.favourites[g])[0];
  return [
    { template: "launch", game },
    { template: "welcome", game },
    ...(favourite ? [{ template: "love" as const, character: favourite }] : []),
  ];
}

/** The nearest roach of a real player within the radar's reach, for the first real touch. */
export function nearestReal(roaches: PublicRoach[], from: { lng: number; lat: number }) {
  let best: PublicRoach | null = null;
  let bestKm = RADAR_RADIUS_KM;
  for (const r of roaches) {
    if (r.bot || r.guide) continue;
    const d = distanceKm(from, r);
    if (d <= bestKm) {
      best = r;
      bestKm = d;
    }
  }
  return best;
}

export function TutorialCoach({
  ui,
  step,
  me,
  progress,
  nearest,
  sending,
  onPlaceMain,
  onPlaceClone,
  onOpenCard,
  onCardLater,
  onGreet,
  onFindGuide,
  onFindNearest,
  onBackHome,
  onSkipStep,
  onFinish,
  onSkipAll,
}: {
  /** The layout in use, where the buttons it speaks of are (src/lib/uiChoice.ts) */
  ui: UiName;
  step: TutorialStep;
  me: Me;
  progress: Progress;
  nearest: PublicRoach | null;
  sending: boolean;
  onPlaceMain: () => void;
  onPlaceClone: () => void;
  onOpenCard: () => void;
  onCardLater: () => void;
  onGreet: (d: Declaration) => void;
  onFindGuide: () => void;
  onFindNearest: () => void;
  /** Done practising: back from Rhode Island to your own roach */
  onBackHome: () => void;
  onSkipStep: (step: "greet" | "touch") => void;
  onFinish: () => void;
  onSkipAll: () => void;
}) {
  const number = { main: 1, clone: 2, card: 3, greet: 4, touch: 5, done: 5 }[step];
  // everyone puts down a main roach and a clone; the rest can be skipped
  const required = step === "main" || step === "clone";
  const you = callName(me.profile.games);
  return (
    <div className="card coach" role="dialog" aria-label={T.tutorial.title}>
      <div className="coach-amiya">
        <AmiyaPicture size={56} friend={me.amiya.friend} />
      </div>
      <div className="stack coach-body">
        <div className="coach-top">
          <span className="muted">{fmtParts(T.tutorial.progress, { step: step === "done" ? T.tutorial.complete : fmt(T.tutorial.step, { n: number }) })}</span>
          {!required && step !== "done" && (
            <button className="link" onClick={onSkipAll}>
              {T.tutorial.skip}
            </button>
          )}
        </div>

        {step === "main" && (
          <>
            <strong>{fmtParts(T.tutorial.welcome, { you: you })}</strong>
            <p>{T.tutorial.place.text}</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onPlaceMain}>
                {T.map.bar.placeMine}
              </button>
            </div>
          </>
        )}

        {step === "clone" && (
          <>
            <strong>{T.tutorial.clone.title}</strong>
            <p>{T.tutorial.clone.text}</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onPlaceClone}>
                {T.tutorial.clone.button}
              </button>
            </div>
          </>
        )}

        {step === "card" && (
          <>
            <strong>{T.profile.makeCard}</strong>
            <p>{T.tutorial.card.text}</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onOpenCard}>
                {T.tutorial.card.button}
              </button>
              <button className="pill" onClick={onCardLater}>
                {T.profile.anonymousForNow}
              </button>
            </div>
          </>
        )}

        {step === "greet" && (
          <>
            <strong>{T.tutorial.greet.title}</strong>
            <p>{fmtParts(T.tutorial.greet.text, { km: DECLARATION_RADIUS_KM })}</p>
            <div className="chips">
              {greetings(me).map((d) => (
                <button key={declarationText(d)} className="chip" disabled={sending} onClick={() => onGreet(d)}>
                  {fmtParts(T.common.quoted, { text: declarationText(d) })}
                </button>
              ))}
            </div>
            <div className="row-actions">
              <button className="pill" onClick={() => onSkipStep("greet")}>
                {T.tutorial.skipStep}
              </button>
            </div>
          </>
        )}

        {step === "touch" && !progress.practiced && (
          <>
            <strong>{fmtParts(T.tutorial.touch.title, { you: you })}</strong>
            <p>
              {T.tutorial.touch.text}
            </p>
            <div className="row-actions">
              <button className="pill dark" onClick={onFindGuide}>
                {T.tutorial.touch.button}
              </button>
              <button className="pill" onClick={() => onSkipStep("touch")}>
                {T.tutorial.skipStep}
              </button>
            </div>
          </>
        )}

        {step === "touch" && progress.practiced && (
          <>
            <strong>{T.tutorial.touched.title}</strong>
            <p>
              {T.tutorial.touched.text}
              {nearest
                ? T.tutorial.touched.ask
                : fmt(T.tutorial.touched.none, { km: RADAR_RADIUS_KM })}
            </p>
            <div className="row-actions">
              {nearest && (
                <button className="pill dark" onClick={onFindNearest}>
                  {T.tutorial.touched.go}
                </button>
              )}
              <button className={nearest ? "pill" : "pill dark"} onClick={onBackHome}>
                {T.tutorial.touched.back}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <strong>{T.tutorial.finished.title}</strong>
            <p>
              {ui === "hud" ? (
                T.tutorial.finished.hud
              ) : ui === "drawer" ? (
                <>
                  <span className="on-phone">{T.tutorial.finished.drawer}</span>
                  <span className="on-computer">{T.tutorial.finished.drawerWide}</span>
                </>
              ) : (
                T.tutorial.finished.text
              )}
            </p>
            <div className="row-actions">
              <button className="pill dark" onClick={onFinish}>
                {T.common.ok}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
