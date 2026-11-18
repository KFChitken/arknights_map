"use client";
/* eslint-disable @next/next/no-img-element -- small WebP files from our own server, which next/image would only copy */

import { useState } from "react";
import { fmt, T } from "@/i18n";
import { CORES, coreOf, LEVELS, NO_CORE, STRATEGIES, strategyOf, type SquadStrategy } from "@/lib/squad";
import type { Art } from "../OperatorNames";

/**
 * How 一起卫戍 shows a pick (src/lib/squad.ts): a core alliance as a badge (black; 随机应变 grey), a 难度 as a badge of
 * its colour, a strategy as its operator's small round picture (src/lib/server/operatorArt.ts) or, where there is
 * none, the operator's name; and the pickers of the card and of a room: core alliances, 难度, and the strategies as a
 * grid of pictures with those of the core alliance first and a search.
 */

export const coreName = (id: number) => (id === NO_CORE ? T.squad.noCore : (coreOf(id)?.name ?? T.squad.noCore));
export const levelName = (level: number) => T.squad.levels[level - 1] ?? "";
const strategyWords = (s: SquadStrategy) => `${s.op}${T.squad.dot}${s.name}`;

/** A core alliance's badge; a button where it can be changed (onClick) */
export function CoreBadge({ core, onClick }: { core: number; onClick?: () => void }) {
  const cls = `sq-core${core === NO_CORE ? " none" : ""}`;
  if (!onClick) return <span className={cls}>{coreName(core)}</span>;
  return (
    <button type="button" className={`${cls} pick`} onClick={onClick}>
      {coreName(core)}
      <i aria-hidden="true">▾</i>
    </button>
  );
}

/** A 难度's badge: 入门 green, 标准 blue, 险境 orange, 绝境 red, 终极 purple */
export function LevelBadge({ level }: { level: number }) {
  return <span className={`sq-lv lv${level}`}>{levelName(level)}</span>;
}

/** An operator's small round picture, or the first character of their name while there is none */
function Face({ op, art, size }: { op: string; art: Art | null; size: number }) {
  const file = art?.arknights?.[op];
  if (file) return <img className="sq-face" src={`/operator-art/${file}`} alt="" width={size} height={size} loading="lazy" />;
  return (
    <span className="sq-face letter" style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }} aria-hidden="true">
      {art ? [...op.replace(/[\u201c\u201d"]/g, "")][0] : ""}
    </span>
  );
}

/**
 * A strategy in a seat: its operator's picture (their name where there is none, or while pictures are off); a tap
 * tells the strategy, or, where it can be changed (onClick), opens the picker. None (无偏好) is a dashed 「无」.
 */
export function StrategyPic({ id, art, onClick, size = 24 }: { id: number | null; art: Art | null; onClick?: () => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const s = id === null ? null : strategyOf(id);
  const has = Boolean(s && art?.arknights?.[s.op]);
  const inner = !s ? (
    <span className="sq-face none" style={{ width: size, height: size }} aria-hidden="true">
      {T.squad.card.noneShort}
    </span>
  ) : has ? (
    <Face op={s.op} art={art} size={size} />
  ) : (
    <span className="sq-opname">{s.op}</span>
  );
  const label = s ? strategyWords(s) : T.squad.card.strategyNone;
  if (onClick) {
    return (
      <button type="button" className="sq-strat pick" aria-label={label} onClick={onClick}>
        {inner}
      </button>
    );
  }
  if (!s) {
    return (
      <span className="sq-strat" title={label}>
        {inner}
      </span>
    );
  }
  return (
    <button type="button" className="sq-strat" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      {inner}
      {open && <small className="sq-tip-pop">{label}</small>}
    </button>
  );
}

/** The core alliances: 随机应变 and the season's, one to pick */
export function CoreChips({ value, onPick }: { value: number | null; onPick: (core: number) => void }) {
  return (
    <div className="chips">
      {[NO_CORE, ...CORES.filter((c) => !c.gone).map((c) => c.id)].map((id) => (
        <button key={id} type="button" className={`chip${value === id ? " on" : ""}`} aria-pressed={value === id} onClick={() => onPick(id)}>
          {coreName(id)}
        </button>
      ))}
    </div>
  );
}

/** 难度: 无偏好 and the five */
export function LevelChips({ value, onPick }: { value: number | null; onPick: (level: number | null) => void }) {
  return (
    <div className="chips">
      {[null, ...LEVELS].map((l) => (
        <button key={l ?? 0} type="button" className={`chip${value === l ? " on" : ""}`} aria-pressed={value === l} onClick={() => onPick(l)}>
          {l === null ? T.squad.card.levelNone : levelName(l)}
        </button>
      ))}
    </div>
  );
}

/** How many of the grid show before 还有 N 个 */
const FOLDED = 16;

/**
 * The strategies to pick one from, as pictures with the operator's name under each: 无偏好 first, then those of the
 * core alliance (core), the other alliances', and the 44 general ones; folded after FOLDED until opened or searched
 * (by the operator's name or the strategy's).
 */
export function StrategyGrid({ value, core, art, onPick }: { value: number | null; core: number; art: Art | null; onPick: (id: number | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const live = STRATEGIES.filter((s) => !s.gone);
  const own = core === NO_CORE ? [] : live.filter((s) => s.core === core);
  const otherCovenant = live.filter((s) => s.core && s.core !== core);
  const general = live.filter((s) => !s.core);
  const needle = q.trim().toLowerCase();
  const all = [...own, ...otherCovenant, ...general];
  const found = needle ? all.filter((s) => s.op.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)) : all;
  const chosen = value === null ? null : strategyOf(value);
  // folded, the one picked stays in sight, right after 无偏好
  const folded = found.slice(0, FOLDED - 1);
  const shown = needle || open ? found : chosen && !folded.includes(chosen) ? [chosen, ...folded.slice(0, -1)] : folded;
  const tile = (s: SquadStrategy | null) => {
    const on = (s?.id ?? null) === value;
    return (
      <button key={s?.id ?? 0} type="button" className={`sq-st${on ? " on" : ""}`} aria-pressed={on} aria-label={s ? strategyWords(s) : T.squad.card.strategyNone} onClick={() => onPick(s?.id ?? null)}>
        {s ? (
          <Face op={s.op} art={art} size={40} />
        ) : (
          <span className="sq-face none" style={{ width: 40, height: 40 }} aria-hidden="true">
            {T.squad.card.noneShort}
          </span>
        )}
        <small>{s ? s.op : T.squad.card.strategyNone}</small>
      </button>
    );
  };
  return (
    <div className="sq-stgrid">
      <p className="sq-stnow">{chosen ? strategyWords(chosen) : T.squad.card.strategyNone}</p>
      <input className="search" type="search" placeholder={T.squad.card.search} aria-label={T.squad.card.search} value={q} onChange={(e) => setQ(e.target.value)} />
      {!needle && own.length > 0 && <p className="sgrp">{fmt(T.squad.card.ownFirst, { core: coreName(core) })}</p>}
      <div className="sq-sts">
        {!needle && tile(null)}
        {shown.map(tile)}
      </div>
      {!needle && !open && found.length > shown.length && (
        <button type="button" className="sq-more" onClick={() => setOpen(true)}>
          {fmt(T.squad.card.more, { n: found.length - shown.length })}
        </button>
      )}
      {needle && !found.length && <p className="hint">{T.squad.card.noneFound}</p>}
    </div>
  );
}
