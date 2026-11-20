"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import { BOARD_TOP, type FireBoard, type FireBoardName, type FireBoardRow, type FireMine } from "@/lib/squadFire";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";
import { BadgeImg } from "../Badges";
import { flameColor, flameInner } from "./FireScene";
import SmallFlame from "./SmallFlame";
import { loadFireBoard } from "./squading";
import "./squadFire.css";

/**
 * 火焰周榜 (篝火不封顶; src/lib/server/fireBoard.ts), opened from 篝火's card in its place: this week's board (settled
 * Monday 04:00 Beijing time, how long till then) or last week's as it was settled; a row a room, its place, how high
 * its fire went that week (a small flame of its colour) and who is named; a line under the 100th (the title's), and 20
 * more; 你们这堆 pinned at the foot with the one thing to say of it. The banner opens what 篝火守夜人 is.
 */

const leftWords = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return fmt(T.squad.fireBoard.leftDays, { d, h });
  if (h > 0) return fmt(T.squad.fireBoard.leftHours, { h, m: m % 60 });
  return fmt(T.squad.fireBoard.leftMinutes, { m: Math.max(1, m) });
};

function Name({ n, got }: { n: FireBoardName; got: boolean }) {
  return (
    <span className={`nm${n.you ? " you" : ""}`}>
      {n.look ? <RoachIcon color={n.look.color as RoachColor} avatar={n.look.avatar as RoachAvatar} size={18} /> : <span className="anon" aria-hidden="true" />}
      {n.name}
      {got && <SmallFlame label={T.lib.badges.firewatch.name} />}
    </span>
  );
}

/** A row: its place, its fire's level in its colour, its names */
type ShownRow = Pick<FireBoardRow, "peak" | "color" | "names" | "got" | "mine"> & { rank: number | null };
export function BoardRow({ row, last }: { row: ShownRow; last?: boolean }) {
  const t = T.squad.fireBoard;
  return (
    <div className={`fb-row${row.mine ? " mine" : ""}`}>
      <span className={`rk${row.rank !== null && row.rank <= 3 ? ` r${row.rank}` : ""}`}>{row.rank ?? "–"}</span>
      <span className="lv">
        <SmallFlame color={flameColor(row.color)} inner={flameInner(row.color)} />
        {fmt(T.squad.fire.level, { n: row.peak })}
      </span>
      <span className="names">
        {row.names.length ? row.names.map((n, i) => <Name key={i} n={n} got={Boolean(last && row.got)} />) : <small>{t.unranked}</small>}
      </span>
    </div>
  );
}

/** 你们这堆's line: the first of these that is so */
export const mineSay = (m: FireMine) => {
  const s = T.squad.fireBoard.says;
  if (m.say === "in") return fmt(s.in, { n: m.n ?? m.names.length });
  if (m.say === "short") return fmt(s.short, { k: m.k ?? 0 });
  if (m.say === "elsewhere") return fmt(s.elsewhere, { r: m.r ?? 0 });
  if (m.say === "below") return fmt(s.below, { d: m.d ?? 1 });
  return s[m.say];
};

/** 篝火守夜人, as the banner opens it: when it is given, where it shows, that it goes by itself */
function TitleInfo({ onBack }: { onBack: () => void }) {
  const t = T.squad.fireBoard;
  return (
    <div className="fb-title">
      <button type="button" className="back" onClick={onBack}>
        ‹ {t.titleBack}
      </button>
      <div className="fb-title-head">
        <BadgeImg id="firewatch" size={84} alt="" />
        <span>
          <b>{t.titleHead}</b>
          <small>{t.titleSub}</small>
          <i>{fmt(T.common.quoted, { text: T.lib.badges.firewatch.quote })}</i>
        </span>
      </div>
      <ol>
        {t.titleSteps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className="note">{t.titleNote}</p>
    </div>
  );
}

export default function SquadFireBoard({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [week, setWeek] = useState<"this" | "last">("this");
  const [board, setBoard] = useState<FireBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadFireBoard(week)
      .then((b) => live && setBoard(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [week, tries]);
  const t = T.squad.fireBoard;
  const shown = board && board.week === week ? board : null;
  const top = shown?.rows.filter((r) => r.rank <= BOARD_TOP) ?? [];
  const more = shown?.rows.filter((r) => r.rank > BOARD_TOP) ?? [];
  const last = week === "last";
  return (
    <div className="sq-fire" role="dialog" aria-label={t.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box fb">
        {title ? (
          <TitleInfo onBack={() => setTitle(false)} />
        ) : (
          <>
            <header>
              <b>{t.title}</b>
              <button type="button" className="x" onClick={onBack} aria-label={t.back}>
                ×
              </button>
            </header>
            <p className="fb-sub">{last ? t.lastWeek : shown?.left !== undefined ? fmt(t.thisWeek, { left: leftWords(shown.left) }) : " "}</p>
            <button type="button" className="fb-banner" onClick={() => setTitle(true)}>
              <BadgeImg id="firewatch" size={40} alt="" />
              <span>
                <b>{t.banner}</b>
                <strong>{t.bannerTitle}</strong>
              </span>
              <i aria-hidden="true">›</i>
            </button>
            <div className="fb-tabs" role="tablist">
              {(["this", "last"] as const).map((w) => (
                <button key={w} type="button" role="tab" aria-selected={week === w} className={week === w ? "on" : undefined} onClick={() => setWeek(w)}>
                  {t.tabs[w]}
                </button>
              ))}
            </div>
            <div className="fb-list">
              {failed ? (
                <p className="fb-empty">
                  {t.failed}{" "}
                  <button type="button" className="link" onClick={() => setTries((n) => n + 1)}>
                    {t.retry}
                  </button>
                </p>
              ) : !shown ? (
                <p className="fb-empty">{t.loading}</p>
              ) : !shown.rows.length ? (
                <p className="fb-empty">{last ? t.lastEmpty : t.thisEmpty}</p>
              ) : (
                <>
                  {last && <p className="fb-lead">{t.lastDone}</p>}
                  {top.map((r) => (
                    <BoardRow key={r.rank} row={r} last={last} />
                  ))}
                  {!last && (
                    <p className="fb-line">
                      <span>{fmt(t.line, { n: shown.holders })}</span>
                    </p>
                  )}
                  {more.map((r) => (
                    <BoardRow key={r.rank} row={r} last={last} />
                  ))}
                  {last && <p className="fb-lead">{fmt(t.lastGot, { n: shown.holders })}</p>}
                </>
              )}
              <p className="note">{t.note}</p>
            </div>
            {shown?.mine && (
              <div className="fb-mine">
                <small>{t.mine}</small>
                <BoardRow row={{ ...shown.mine, mine: true }} last={last} />
                {!last && <p>{mineSay(shown.mine)}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
