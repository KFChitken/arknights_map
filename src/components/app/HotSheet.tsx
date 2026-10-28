"use client";

import { useEffect, useState } from "react";
import { beijingDate } from "@/lib/beijing";
import type { Game } from "@/lib/games";
import { HOT_BOARDS, HOT_MIN_PLAYERS, WEEK, type HotBoard, type HotList } from "@/lib/hotList";
import { SITE_NAME } from "@/lib/rules";
import Sheet from "./Sheet";

const GAME_TAGS: Record<Game, string> = { arknights: "方舟", endfield: "终末地" };
const DAY_MS = 86_400_000;

/** 「10.26」 */
const day = (t: number) => {
  const [, m, d] = beijingDate(t).split("-");
  return `${Number(m)}.${Number(d)}`;
};

/**
 * 本周舟P热榜, open to everyone. Laid out to be screenshotted: a dark header,
 * the yellow bar, and the site's address at the foot.
 */
export default function HotSheet({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<HotList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<HotBoard>("love");

  useEffect(() => {
    fetch("/api/hot")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) throw new Error(body?.error ?? "热榜暂时打不开，稍后再试试。");
        setList(body as HotList);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "热榜暂时打不开，稍后再试试。"));
  }, []);

  const name = HOT_BOARDS.find((b) => b.id === board)!.name;
  const rows = list?.boards[board] ?? [];
  const last = list?.lastWeek[board];

  return (
    <Sheet title="热榜" onClose={onClose}>
      <div className="hot-card">
        <div className="hot-head">
          <span className="hot-kicker">WEEKLY HOT LIST</span>
          <strong>本周舟P热榜</strong>
          {list && (
            <span className="hot-week">
              {/* Monday to Sunday, though the week runs on to 4:00 on Monday */}
              {day(list.weekStart)} – {day(list.weekStart + WEEK - DAY_MS)} · 每周一 4:00 刷新
            </span>
          )}
        </div>
        <div className="seg tabs hot-tabs" role="group" aria-label="榜单">
          {HOT_BOARDS.map((b) => (
            <button key={b.id} className={board === b.id ? "on" : ""} onClick={() => setBoard(b.id)}>
              {b.name}
            </button>
          ))}
        </div>

        {error && <p className="hot-empty">{error}</p>}
        {!list && !error && <p className="hot-empty">正在统计…</p>}
        {list && rows.length === 0 && (
          <p className="hot-empty">
            这周还没有角色被 {HOT_MIN_PLAYERS} 位以上的舟P喊过。发一句「{name}…」，给你的厨力角色打榜吧！
          </p>
        )}
        {rows.map((r) => (
          <div key={r.character} className={`hot-row ${r.rank <= 3 ? "top" : ""}`}>
            <span className="hot-rank">{r.rank}</span>
            <span className="hot-name">
              {r.character}
              {r.games.length > 0 && <span className="hot-tag">{r.games.map((g) => GAME_TAGS[g]).join(" / ")}</span>}
            </span>
            <span className="hot-n">{r.players} 位舟P</span>
          </div>
        ))}
        {last && (
          <p className="hot-last">
            上周第一：{last.character}（{last.players} 位舟P）
          </p>
        )}
        <div className="hot-foot">
          <span>zhoupmap.com</span>
          <span>{SITE_NAME}</span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        按这周发「{name}…」宣言的人数排，同一个人对同一个角色只算一次；少于 {HOT_MIN_PLAYERS} 个人喊的角色不上榜，看不出是谁喊的。
      </p>
    </Sheet>
  );
}
