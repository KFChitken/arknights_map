"use client";

import { fmtParts, T } from "@/i18n";
import { dateOfDay, MINGHE, MINGHE_NAME, ROUTE, stopOf } from "@/lib/minghe";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/** 明河都尉 (src/lib/minghe.ts) on the page: his picture, his introduction, and his route. */

export const MinghePicture = ({ size, friend = false }: { size: number; friend?: boolean }) => (
  <RoachIcon color={MINGHE.color} size={size} avatar={MINGHE.avatar} friend={friend} />
);

/** Once, for players with a roach who are not his 触须之交 and have no clone riding with him. */
export function MingheIntroSheet({ station, onGo, onLater }: { station: string; onGo: () => void; onLater: () => void }) {
  return (
    <Sheet title={MINGHE_NAME} onClose={onLater}>
      <div className="amiya-greet">
        <MinghePicture size={96} />
      </div>
      <p className="consent-place">{fmtParts(T.guides.minghe.intro, { station: station })}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          {T.guides.minghe.goSee}
        </button>
        <button className="pill" onClick={onLater}>
          {T.common.later}
        </button>
      </div>
    </Sheet>
  );
}

/** 「11/6」 */
const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** 路线: the 30 stations of the lap he is on, each with the day he gets there, today's marked. */
export function MingheRoute({ day }: { day: number }) {
  const lapStart = day - stopOf(day);
  return (
    <details className="minghe-route">
      <summary>{T.guides.minghe.route}</summary>
      <ol>
        {ROUTE.map((s, i) => {
          const when = lapStart + i;
          return (
            <li key={s.name} className={when === day ? "today" : when < day ? "past" : ""}>
              <span>
                {i + 1}. {s.name}
              </span>
              <span>{when === day ? T.common.today : short(dateOfDay(when))}</span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// ---- what this browser remembers about him, per player ----

const introKey = (userId: string) => `zhoup.mingheIntro.${userId}`;

export function mingheIntroShown(userId: string) {
  try {
    return localStorage.getItem(introKey(userId)) === "1";
  } catch {
    // without storage, rather say it happened than repeat it on every visit
    return true;
  }
}
export function markMingheIntroShown(userId: string) {
  try {
    localStorage.setItem(introKey(userId), "1");
  } catch {}
}

/** 清掉我和明河的记录 (local testing only) */
export function forgetMingheHere(userId: string) {
  try {
    localStorage.removeItem(introKey(userId));
  } catch {}
}
