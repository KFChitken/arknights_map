"use client";

import { useState } from "react";
import { fmtParts, T } from "@/i18n";
import { AMIYA, amiyaLine } from "@/lib/amiya";
import type { Game } from "@/lib/games";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/** 阿米娅向导 (src/lib/amiya.ts) on cards: her greeting, her introduction, and touching her back. */

export const AmiyaPicture = ({ size, friend = true }: { size: number; friend?: boolean }) => (
  <RoachIcon color={AMIYA.color} size={size} avatar={AMIYA.avatar} friend={friend} />
);

/**
 * 偷偷碰回去 / 大胆碰回去 on one of her touches; once answered, what she said back.
 * onTouchBack resolves to her line, "" when she has touched back once already today (she
 * does once a day), or null when the touch did not go through.
 */
export function AmiyaTouchBack({ onTouchBack }: { onTouchBack: (bold: boolean) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  if (answer) return <p className="amiya-answer">{fmtParts(T.guides.amiya.answered, { answer: answer })}</p>;
  if (answer === "") return <p className="amiya-answer">{T.guides.amiya.backToday}</p>;
  const go = async (bold: boolean) => {
    setBusy(true);
    setAnswer(await onTouchBack(bold));
    setBusy(false);
  };
  return (
    <div className="row-actions amiya-back">
      <button className="pill" disabled={busy} onClick={() => go(false)}>
        {T.common.sneakyBack}
      </button>
      <button className="pill dark" disabled={busy} onClick={() => go(true)}>
        {T.common.boldBack}
      </button>
    </div>
  );
}

/** Her greeting of the day. */
export function AmiyaGreetingSheet({
  games,
  onTouchBack,
  onClose,
}: {
  games: Game[];
  onTouchBack: (bold: boolean) => Promise<string | null>;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={T.guides.amiya.touchedYou}
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          {T.common.ok}
        </button>
      }
    >
      <div className="amiya-greet">
        <AmiyaPicture size={96} />
        <p className="amiya-line">{amiyaLine("greet", games)}</p>
      </div>
      <AmiyaTouchBack onTouchBack={onTouchBack} />
    </Sheet>
  );
}

/** Once, for players who have not met her: where she lives and what she does. */
export function AmiyaIntroSheet({ onFind, onLater }: { onFind: () => void; onLater: () => void }) {
  return (
    <Sheet title={T.guides.amiya.intro.title} onClose={onLater}>
      <div className="amiya-greet">
        <AmiyaPicture size={96} friend={false} />
      </div>
      <p className="consent-place">{T.guides.amiya.intro.text}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onFind}>
          {T.guides.amiya.intro.find}
        </button>
        <button className="pill" onClick={onLater}>
          {T.common.later}
        </button>
      </div>
    </Sheet>
  );
}

const introKey = (userId: string) => `zhoup.amiyaIntro.${userId}`;

/** Whether this browser already introduced her to this player; without storage, say yes rather than ask again and again. */
export function introShown(userId: string) {
  try {
    return localStorage.getItem(introKey(userId)) === "1";
  } catch {
    return true;
  }
}

export function markIntroShown(userId: string) {
  try {
    localStorage.setItem(introKey(userId), "1");
  } catch {}
}
