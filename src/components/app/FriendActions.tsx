"use client";

import type { ReactNode } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { FRIEND_ACTS_PER_DAY, GESTURE_DONE, GESTURE_NAMES, isAwakeGesture, type Gesture } from "@/lib/friendly";
import { POKE_EVERY_DAYS } from "@/lib/rules";
import type { FriendBetween } from "@/lib/world/types";

/** One button of the row: 做客, 催理智, 戳一戳, or one of the gestures */
export type FriendAct = "visit" | "sanity" | "poke" | Gesture;

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ICONS: Record<FriendAct, ReactNode> = {
  visit: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M3.5 11.5 12 4l8.5 7.5" />
      <path {...stroke} d="M6 10v9.5h12V10" />
      <path {...stroke} d="M10 19.5v-5h4v5" />
    </svg>
  ),
  sanity: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M9.5 3.5h5M10.5 3.5v4.2L6.6 15a4.2 4.2 0 0 0 3.7 6h3.4a4.2 4.2 0 0 0 3.7-6l-3.9-7.3V3.5" />
      <path d="M7.4 15.5h9.2l.4.8a3.3 3.3 0 0 1-2.9 4.2h-4.2a3.3 3.3 0 0 1-2.9-4.2z" fill="currentColor" opacity="0.55" />
    </svg>
  ),
  poke: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M10 13V5.5a1.6 1.6 0 0 1 3.2 0V12l4.3.9a2 2 0 0 1 1.6 2.3L18.3 20H10l-3.7-4.6a1.5 1.5 0 0 1 2.2-2z" />
    </svg>
  ),
  hug: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor" />
    </svg>
  ),
  highfive: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M7 12.5V7a1.4 1.4 0 0 1 2.8 0v4.5M9.8 11V4.8a1.4 1.4 0 0 1 2.8 0V11M12.6 11V5.6a1.4 1.4 0 0 1 2.8 0v6.9M15.4 11.6V8.4a1.4 1.4 0 0 1 2.8 0v6.1a6 6 0 0 1-6 6h-.6a5.4 5.4 0 0 1-4.3-2.2l-3-4a1.4 1.4 0 0 1 2.2-1.7L7 13.4" />
    </svg>
  ),
  luck: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 15.9l-5 2.8 1.2-5.6L4 9.3l5.6-.6z" fill="currentColor" />
    </svg>
  ),
  blanket: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M3.5 10.5c3-2 5.5-2 8.5 0s5.5 2 8.5 0v7c-3 2-5.5 2-8.5 0s-5.5-2-8.5 0z" />
      <path {...stroke} d="M8 12.5v4M12.5 13.5v4M17 12.5v4" opacity="0.6" />
    </svg>
  ),
  water: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...stroke} d="M6.5 4.5h11l-1.6 15a1.5 1.5 0 0 1-1.5 1.3H9.6a1.5 1.5 0 0 1-1.5-1.3z" />
      <path d="M7.6 10h8.8l-1 9.3a.8.8 0 0 1-.8.7H9.4a.8.8 0 0 1-.8-.7z" fill="currentColor" opacity="0.4" />
    </svg>
  ),
};

/** The plain name of each, before it is used */
const NAMES: Record<FriendAct, string> = {
  get visit() {
    return T.friendActs.visit;
  },
  get sanity() {
    return T.friendActs.sanity;
  },
  get poke() {
    return T.common.poke;
  },
  get hug() {
    return GESTURE_NAMES.hug;
  },
  get highfive() {
    return GESTURE_NAMES.highfive;
  },
  get luck() {
    return GESTURE_NAMES.luck;
  },
  get blanket() {
    return GESTURE_NAMES.blanket;
  },
  get water() {
    return GESTURE_NAMES.water;
  },
};

/**
 * 触须之交专属: the row of what only 触须之交 do, on their roach's card and their page. Awake:
 * 做客 · 催理智 · 贴贴 · 击掌 · 吸欧气; their main roach asleep: 做客 · 催理智 · 戳一戳 ·
 * 盖被子 · 放杯白开水. 催理智 and the gestures share FRIEND_ACTS_PER_DAY a day and all turn grey
 * once those are used; 催理智 once a day, 盖被子 and 放杯白开水 once a sleep.
 */
export default function FriendActions({
  between,
  pokeAgainAt,
  riding = false,
  busy = false,
  onAct,
}: {
  between: FriendBetween;
  /** You poked them lately: when you may again */
  pokeAgainAt: number | null;
  /** The roach whose card this is rides with 明河都尉, so nobody can visit it */
  riding?: boolean;
  /** Something is under way */
  busy?: boolean;
  /** at: the middle of the button on screen, where 催理智's bottle flies from */
  onAct: (act: FriendAct, at: { x: number; y: number }) => void;
}) {
  const now = Date.now();
  const days = (t: number) => Math.max(1, Math.ceil((t - now) / 86_400_000));
  const acts: FriendAct[] = between.asleep ? ["visit", "sanity", "poke", "blanket", "water"] : ["visit", "sanity", "hug", "highfive", "luck"];
  const visiting = between.visiting;
  // why 做客 cannot be used now, if it cannot
  const visitNote = visiting
    ? visiting.left
      ? T.friendActs.visitMoved
      : T.friendActs.visitThere
    : !between.welcome
      ? T.friendActs.visitClosed
      : between.visitAgainAt
        ? fmt(T.friendActs.visitSentHome, { days: days(between.visitAgainAt) })
        : riding
          ? T.friendActs.visitRiding
          : null;
  const full = between.actsLeft <= 0;
  const state = (act: FriendAct): { label: string; off: boolean } => {
    if (act === "visit") {
      if (visiting) return { label: T.common.goThere, off: false };
      return { label: NAMES.visit, off: Boolean(visitNote) };
    }
    if (act === "poke") return pokeAgainAt ? { label: T.common.poked, off: true } : { label: NAMES.poke, off: false };
    if (act === "sanity") return between.done.sanity ? { label: T.friendActs.sanityDone, off: true } : { label: NAMES.sanity, off: full };
    if (!isAwakeGesture(act) && between.done[act]) return { label: GESTURE_DONE[act], off: true };
    return { label: NAMES[act], off: full };
  };
  const notes = [
    full ? fmt(T.friendActs.full, { n: FRIEND_ACTS_PER_DAY }) : null,
    visitNote,
    pokeAgainAt && between.asleep ? fmt(T.friendActs.pokeWait, { days: days(pokeAgainAt), every: POKE_EVERY_DAYS }) : null,
  ].filter(Boolean);
  return (
    <div className="friend-acts">
      <span className="friend-acts-label">{fmtParts(T.friendActs.only, { left: full ? "" : fmt(T.friendActs.left, { n: between.actsLeft }) })}</span>
      <div className="friend-acts-row">
        {acts.map((act) => {
          const { label, off } = state(act);
          return (
            <button
              key={act}
              type="button"
              className={`friend-act fa-${act}`}
              disabled={busy || off}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onAct(act, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
              }}
            >
              <span className="fa-ico">{ICONS[act]}</span>
              <span className="fa-t">{label}</span>
            </button>
          );
        })}
      </div>
      {notes.map((n) => (
        <p key={n} className="hint friend-acts-note">
          {n}
        </p>
      ))}
    </div>
  );
}
