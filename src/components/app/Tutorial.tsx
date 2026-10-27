"use client";

import { declarationText, type Declaration } from "@/lib/declarations";
import { distanceKm } from "@/lib/geo";
import type { PublicProfile } from "@/lib/profile";
import { RADAR_RADIUS_KM } from "@/lib/rules";
import type { InboxItem, Me, PublicRoach } from "@/lib/world/types";

/**
 * The newcomer tutorial, after the first roach is down: a card for your roach,
 * a first declaration, a first touch (practised on a guide roach first). Every
 * step can be skipped. Whether you declared or touched comes from the server;
 * the card step and skipping are remembered in this browser only.
 */

export type TutorialStep = "card" | "greet" | "touch" | "done";

export type Progress = { card?: true; greet?: true; practiced?: true; touch?: true; done?: true; skipped?: true };

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
  if (!me.roaches.some((r) => r.slot === 0)) return null;
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

// ---- the guide roach: only on the newcomer's own screen, never sent anywhere ----

export const GUIDE_ID = "guide";
export const isGuideItem = (id: string) => id.startsWith("guide:");

export const GUIDE_PROFILE: PublicProfile = {
  displayName: "粥P地图向导",
  games: ["arknights", "endfield"],
  favourites: { arknights: [], endfield: [] },
  avatar: "endmin",
  color: "gold",
};

/** A little way off your main roach, so it shows up next to it. */
export function guideRoach(main: { lng: number; lat: number }): PublicRoach {
  return {
    id: GUIDE_ID,
    clone: false,
    avatar: GUIDE_PROFILE.avatar,
    color: GUIDE_PROFILE.color,
    friend: true,
    guide: true,
    lng: main.lng + 0.006,
    lat: main.lat + 0.004,
  };
}

/** The guide touching you back, as an inbox item that lives in memory only. */
export function guideTouchBack(): InboxItem {
  return {
    kind: "touch",
    id: `guide:${Date.now()}`,
    at: Date.now(),
    seen: false,
    bold: true,
    target: "touch",
    from: GUIDE_PROFILE,
    replied: false,
    ignored: false,
  };
}

export function TutorialCoach({
  step,
  me,
  progress,
  nearest,
  sending,
  onOpenCard,
  onCardLater,
  onGreet,
  onFindGuide,
  onFindNearest,
  onSkipStep,
  onFinish,
  onSkipAll,
}: {
  step: TutorialStep;
  me: Me;
  progress: Progress;
  nearest: PublicRoach | null;
  sending: boolean;
  onOpenCard: () => void;
  onCardLater: () => void;
  onGreet: (d: Declaration) => void;
  onFindGuide: () => void;
  onFindNearest: () => void;
  onSkipStep: (step: "greet" | "touch") => void;
  onFinish: () => void;
  onSkipAll: () => void;
}) {
  const number = { card: 1, greet: 2, touch: 3, done: 3 }[step];
  return (
    <div className="card stack coach" role="dialog" aria-label="新手教程">
      <div className="coach-top">
        <span className="muted">新手教程 · {step === "done" ? "完成" : `第 ${number}/3 步`}</span>
        {step !== "done" && (
          <button className="link" onClick={onSkipAll}>
            跳过教程
          </button>
        )}
      </div>

      {step === "card" && (
        <>
          <strong>给你的蟑螂做张名片吧</strong>
          <p>名字、玩的游戏、厨力角色和蟑螂的样子。不想露名字也可以保持匿名。</p>
          <div className="row-actions">
            <button className="pill dark" onClick={onOpenCard}>
              做名片
            </button>
            <button className="pill" onClick={onCardLater}>
              先匿名，以后再说
            </button>
          </div>
        </>
      )}

      {step === "greet" && (
        <>
          <strong>跟附近的舟p打个招呼吧</strong>
          <p>挑一句发给 10 公里内的舟p。他们不知道是谁发的，可以回应你。</p>
          <div className="chips">
            {greetings(me).map((d) => (
              <button key={declarationText(d)} className="chip" disabled={sending} onClick={() => onGreet(d)}>
                「{declarationText(d)}」
              </button>
            ))}
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onSkipStep("greet")}>
              跳过这一步
            </button>
          </div>
        </>
      )}

      {step === "touch" && !progress.practiced && (
        <>
          <strong>伸出触须碰碰别人</strong>
          <p>偷偷碰，对方只知道被一只蟑螂碰了一下；大胆碰，对方能看到你的名片。先跟向导蟑螂练一次吧，它会马上碰回你。</p>
          <div className="row-actions">
            <button className="pill dark" onClick={onFindGuide}>
              找到向导蟑螂
            </button>
            <button className="pill" onClick={() => onSkipStep("touch")}>
              跳过这一步
            </button>
          </div>
        </>
      )}

      {step === "touch" && progress.practiced && (
        <>
          <strong>{nearest ? "要不要碰碰离你最近的舟p？" : "附近还没有别的舟p"}</strong>
          <p>
            {nearest
              ? "碰过之后 TA 会收到消息。偷偷碰不会露出你是谁。"
              : `你的蟑螂 ${RADAR_RADIUS_KM} 公里内还没有别的舟p，等热闹起来再去碰碰 TA 们。`}
          </p>
          <div className="row-actions">
            {nearest && (
              <button className="pill dark" onClick={onFindNearest}>
                去看看
              </button>
            )}
            <button className="pill" onClick={() => onSkipStep("touch")}>
              {nearest ? "先不了" : "好的"}
            </button>
          </div>
        </>
      )}

      {step === "done" && (
        <>
          <strong>教程完成！</strong>
          <p>有人碰你或者回应你，左下角的信封会亮。右上角的方舟雷达能看附近的动静。</p>
          <div className="row-actions">
            <button className="pill dark" onClick={onFinish}>
              好的
            </button>
          </div>
        </>
      )}
    </div>
  );
}
