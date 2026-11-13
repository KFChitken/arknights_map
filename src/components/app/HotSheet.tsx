"use client";

import { useEffect, useState } from "react";
import { fmtParts, T } from "@/i18n";
import { beijingDate } from "@/lib/beijing";
import type { Game } from "@/lib/games";
import { HOT_BOARDS, HOT_MIN_PLAYERS, WEEK, type HotBoard, type HotList } from "@/lib/hotList";
import { siteName } from "@/lib/rules";
import Sheet from "./Sheet";
import { apiFetch } from "@/lib/apiFetch";
import { characterName } from "@/i18n/names";

const GAME_TAGS: Record<Game, string> = {
  get arknights() {
    return T.hot.tag.arknights;
  },
  get endfield() {
    return T.hot.tag.endfield;
  },
};
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
    apiFetch("/api/hot")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) throw new Error(body?.error ?? T.hot.failed);
        setList(body as HotList);
      })
      .catch((e) => setError(e instanceof Error ? e.message : T.hot.failed));
  }, []);

  const shout = HOT_BOARDS.find((b) => b.id === board)!.shout;
  const rows = list?.boards[board] ?? [];
  const last = list?.lastWeek[board];

  return (
    <Sheet title={T.hot.title} onClose={onClose}>
      <div className="hot-card">
        <div className="hot-head">
          <span className="hot-kicker">WEEKLY HOT LIST</span>
          <strong>{T.hot.heading}</strong>
          {list && (
            <span className="hot-week">
              {/* Monday to Sunday, though the week runs on to 4:00 on Monday */}
              {fmtParts(T.hot.week, { from: day(list.weekStart), to: day(list.weekStart + WEEK - DAY_MS) })}
            </span>
          )}
        </div>
        <div className="seg tabs hot-tabs" role="group" aria-label={T.hot.listLabel}>
          {HOT_BOARDS.map((b) => (
            <button key={b.id} className={board === b.id ? "on" : ""} onClick={() => setBoard(b.id)}>
              {b.name}
            </button>
          ))}
        </div>

        {error && <p className="hot-empty">{error}</p>}
        {!list && !error && <p className="hot-empty">{T.hot.counting}</p>}
        {list && rows.length === 0 && (
          <p className="hot-empty">
            {fmtParts(T.hot.empty, { min: HOT_MIN_PLAYERS, shout: shout })}
          </p>
        )}
        {rows.map((r) => (
          <div key={r.character} className={`hot-row ${r.rank <= 3 ? "top" : ""}`}>
            <span className="hot-rank">{r.rank}</span>
            <span className="hot-name">
              {characterName(r.character)}
              {r.games.length > 0 && <span className="hot-tag">{r.games.map((g) => GAME_TAGS[g]).join(" / ")}</span>}
            </span>
            <span className="hot-n">{fmtParts(T.hot.players, { n: r.players })}</span>
          </div>
        ))}
        {last && (
          <p className="hot-last">
            {fmtParts(T.hot.lastWeek, { character: characterName(last.character), n: last.players })}
          </p>
        )}
        <div className="hot-foot">
          <span>zhoupmap.com</span>
          <span>{siteName()}</span>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        {fmtParts(T.hot.rule, { shout: shout, min: HOT_MIN_PLAYERS })}
      </p>
    </Sheet>
  );
}
