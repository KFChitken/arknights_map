"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import { BOARD_TOP } from "@/lib/squadFire";
import type { StackBoard, StackBoardName, StackBoardRow, StackMine } from "@/lib/squadMode";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../../RoachIcon";
import { BadgeImg } from "../Badges";
import SmallTower from "./SmallTower";
import { loadStackBoard } from "./squading";
import "./squadFire.css";

/**
 * 基建周榜 (src/lib/server/stackBoard.ts), opened from 基建加盖's card in its place, as 火焰周榜 (SquadFireBoard.tsx):
 * this week's board (settled Monday 04:00 Beijing time, how long till then) or last week's as it was settled; a row a
 * tower, its place, how high it got that week (a small tower) and who is named; a line under the 100th (the title's),
 * and 20 more; 你们这座 pinned at the foot with the one thing to say of it (none: you put no block this week). The
 * banner opens what 基建狂魔 is.
 */

const leftWords = (ms: number) => {
  const t = T.squad.stackBoard;
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return fmt(t.leftDays, { d, h });
  if (h > 0) return fmt(t.leftHours, { h, m: m % 60 });
  return fmt(t.leftMinutes, { m: Math.max(1, m) });
};

function Name({ n, got }: { n: StackBoardName; got: boolean }) {
  return (
    <span className={`nm${n.you ? " you" : ""}`}>
      {n.look ? <RoachIcon color={n.look.color as RoachColor} avatar={n.look.avatar as RoachAvatar} size={18} /> : <span className="anon" aria-hidden="true" />}
      {n.name}
      {got && <SmallTower size={11} label={T.lib.badges.stacktop.name} />}
    </span>
  );
}

/** A row: its place, its tower's height, its names */
type ShownRow = Pick<StackBoardRow, "peak" | "names" | "got" | "mine"> & { rank: number | null };
export function TowerRow({ row, last }: { row: ShownRow; last?: boolean }) {
  const t = T.squad.stackBoard;
  return (
    <div className={`fb-row${row.mine ? " mine" : ""}`}>
      <span className={`rk${row.rank !== null && row.rank <= 3 ? ` r${row.rank}` : ""}`}>{row.rank ?? "–"}</span>
      <span className="lv">
        <SmallTower />
        {fmt(t.layers, { n: row.peak })}
      </span>
      <span className="names">
        {row.names.length ? row.names.map((n, i) => <Name key={i} n={n} got={Boolean(last && row.got)} />) : <small>{t.unranked}</small>}
      </span>
    </div>
  );
}

/** 你们这座's line: the first of these that is so */
export const towerSay = (m: StackMine) => {
  const s = T.squad.stackBoard.says;
  if (m.say === "in") return fmt(s.in, { n: m.n ?? m.names.length });
  if (m.say === "short") return fmt(s.short, { k: m.k ?? 0 });
  if (m.say === "below") return fmt(s.below, { d: m.d ?? 1 });
  return s[m.say];
};

/** 基建狂魔, as the banner opens it: when it is given, where it shows, that it goes by itself */
function TitleInfo({ onBack }: { onBack: () => void }) {
  const t = T.squad.stackBoard;
  return (
    <div className="fb-title">
      <button type="button" className="back" onClick={onBack}>
        ‹ {t.titleBack}
      </button>
      <div className="fb-title-head">
        <BadgeImg id="stacktop" size={84} alt="" />
        <span>
          <b>{t.titleHead}</b>
          <small>{t.titleSub}</small>
          <i>{fmt(T.common.quoted, { text: T.lib.badges.stacktop.quote })}</i>
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

/** The board as it shows: the week picked, the board as read (null: not yet), failed to read, or 基建狂魔's page */
export function StackBoardView({
  week,
  board,
  failed,
  title,
  onWeek,
  onTitle,
  onRetry,
  onBack,
  onClose,
}: {
  week: "this" | "last";
  board: StackBoard | null;
  failed: boolean;
  title: boolean;
  onWeek: (w: "this" | "last") => void;
  onTitle: (open: boolean) => void;
  onRetry: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const t = T.squad.stackBoard;
  const shown = board && board.week === week ? board : null;
  const top = shown?.rows.filter((r) => r.rank <= BOARD_TOP) ?? [];
  const more = shown?.rows.filter((r) => r.rank > BOARD_TOP) ?? [];
  const last = week === "last";
  return (
    <div className="sq-fire" role="dialog" aria-label={t.title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box fb sb">
        {title ? (
          <TitleInfo onBack={() => onTitle(false)} />
        ) : (
          <>
            <header>
              <b>{t.title}</b>
              <button type="button" className="x" onClick={onBack} aria-label={t.back}>
                ×
              </button>
            </header>
            <p className="fb-sub">{last ? t.lastWeek : shown?.left !== undefined ? fmt(t.thisWeek, { left: leftWords(shown.left) }) : " "}</p>
            <button type="button" className="fb-banner" onClick={() => onTitle(true)}>
              <BadgeImg id="stacktop" size={40} alt="" />
              <span>
                <b>{t.banner}</b>
                <strong>{t.bannerTitle}</strong>
              </span>
              <i aria-hidden="true">›</i>
            </button>
            <div className="fb-tabs" role="tablist">
              {(["this", "last"] as const).map((w) => (
                <button key={w} type="button" role="tab" aria-selected={week === w} className={week === w ? "on" : undefined} onClick={() => onWeek(w)}>
                  {t.tabs[w]}
                </button>
              ))}
            </div>
            <div className="fb-list">
              {failed ? (
                <p className="fb-empty">
                  {t.failed}{" "}
                  <button type="button" className="link" onClick={onRetry}>
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
                    <TowerRow key={r.rank} row={r} last={last} />
                  ))}
                  {!last && (
                    <p className="fb-line">
                      <span>{fmt(t.line, { n: shown.holders })}</span>
                    </p>
                  )}
                  {more.map((r) => (
                    <TowerRow key={r.rank} row={r} last={last} />
                  ))}
                  {last && <p className="fb-lead">{fmt(t.lastGot, { n: shown.holders })}</p>}
                </>
              )}
              <p className="note">{t.note}</p>
            </div>
            {shown?.mine ? (
              <div className="fb-mine">
                <small>{t.mine}</small>
                <TowerRow row={{ ...shown.mine, mine: true }} last={last} />
                {!last && <p>{towerSay(shown.mine)}</p>}
              </div>
            ) : (
              shown &&
              !last && (
                <div className="fb-mine none">
                  <p>{t.says.none}</p>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SquadStackBoard({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [week, setWeek] = useState<"this" | "last">("this");
  const [board, setBoard] = useState<StackBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadStackBoard(week)
      .then((b) => live && setBoard(b))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [week, tries]);
  return (
    <StackBoardView
      week={week}
      board={board}
      failed={failed}
      title={title}
      onWeek={setWeek}
      onTitle={setTitle}
      onRetry={() => setTries((n) => n + 1)}
      onBack={onBack}
      onClose={onClose}
    />
  );
}
