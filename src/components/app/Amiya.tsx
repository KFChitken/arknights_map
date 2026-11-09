"use client";

import { useState } from "react";
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
  if (answer) return <p className="amiya-answer">她碰回来了：「{answer}」</p>;
  if (answer === "") return <p className="amiya-answer">她今天已经碰回过你了，明天再碰碰她吧。</p>;
  const go = async (bold: boolean) => {
    setBusy(true);
    setAnswer(await onTouchBack(bold));
    setBusy(false);
  };
  return (
    <div className="row-actions amiya-back">
      <button className="pill" disabled={busy} onClick={() => go(false)}>
        偷偷碰回去
      </button>
      <button className="pill dark" disabled={busy} onClick={() => go(true)}>
        大胆碰回去
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
      title="阿米娅向导碰了碰你"
      onClose={onClose}
      footer={
        <button className="primary wide" onClick={onClose}>
          好的
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
    <Sheet title="阿米娅向导" onClose={onLater}>
      <div className="amiya-greet">
        <AmiyaPicture size={96} friend={false} />
      </div>
      <p className="consent-place">阿米娅向导住进了罗德岛！大胆碰她一下，你们就是触须之交，以后她每天会跟你打招呼。</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onFind}>
          去找她
        </button>
        <button className="pill" onClick={onLater}>
          以后再说
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
