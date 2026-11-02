"use client";

import { callName } from "@/lib/amiya";
import { declarationText, type Declaration } from "@/lib/declarations";
import { distanceKm } from "@/lib/geo";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM } from "@/lib/rules";
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
    <div className="card coach" role="dialog" aria-label="新手教程">
      <div className="coach-amiya">
        <AmiyaPicture size={56} friend={me.amiya.friend} />
      </div>
      <div className="stack coach-body">
        <div className="coach-top">
          <span className="muted">阿米娅的新手教程 · {step === "done" ? "完成" : `第 ${number}/5 步`}</span>
          {!required && step !== "done" && (
            <button className="link" onClick={onSkipAll}>
              跳过教程
            </button>
          )}
        </div>

        {step === "main" && (
          <>
            <strong>{you}，欢迎来到舟P地图！</strong>
            <p>我是阿米娅。先把你的蟑螂本体放到地图上吧，大家能看到它在哪，但不知道是谁的。放好以后随时可以挪窝，也可以收回。</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onPlaceMain}>
                放下我的蟑螂
              </button>
            </div>
          </>
        )}

        {step === "clone" && (
          <>
            <strong>再放一只克隆体吧</strong>
            <p>克隆体可以放在别的地方，比如学校或者常去的地方，别人看不出它和本体是一个人的。不想要了，在「我的蟑螂」里就能收回。</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onPlaceClone}>
                放一只克隆体
              </button>
            </div>
          </>
        )}

        {step === "card" && (
          <>
            <strong>给你的蟑螂做张名片吧</strong>
            <p>名字、玩的游戏、厨力角色和蟑螂的样子。不想露名字，保持匿名也可以哦。</p>
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
            <strong>跟附近的舟P打个招呼吧</strong>
            <p>挑一句发给 {DECLARATION_RADIUS_KM} 公里内的舟P，他们不知道是谁发的，可以回应你。</p>
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
            <strong>{you}，我在罗德岛！</strong>
            <p>
              点一下我，伸出触须碰碰我吧。偷偷碰，对方只知道被一只蟑螂碰了一下；大胆碰，对方能看到你的名片，我们就成了触须之交。
            </p>
            <div className="row-actions">
              <button className="pill dark" onClick={onFindGuide}>
                碰碰我
              </button>
              <button className="pill" onClick={() => onSkipStep("touch")}>
                跳过这一步
              </button>
            </div>
          </>
        )}

        {step === "touch" && progress.practiced && (
          <>
            <strong>就是这样！</strong>
            <p>
              碰其他舟P也一样：点开 TA 的蟑螂，伸出触须就好。
              {nearest
                ? "要不要去碰碰离你最近的舟P？"
                : `你的蟑螂 ${RADAR_RADIUS_KM} 公里内还没有别的舟P，等热闹起来再去碰碰 TA 们。`}
            </p>
            <div className="row-actions">
              {nearest && (
                <button className="pill dark" onClick={onFindNearest}>
                  去碰碰离你最近的舟P
                </button>
              )}
              <button className={nearest ? "pill" : "pill dark"} onClick={onBackHome}>
                回到我的蟑螂
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <strong>教程完成啦！</strong>
            <p>有人碰你或者回应你，左下角的信封会亮。右上角的方舟雷达能看附近的动静。我一直在罗德岛，随时来找我玩。</p>
            <div className="row-actions">
              <button className="pill dark" onClick={onFinish}>
                好的
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
