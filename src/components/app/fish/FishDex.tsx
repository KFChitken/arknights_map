"use client";

import { useEffect, useMemo, useState } from "react";
import { fmt, T } from "@/i18n";
import { FISH_ITEMS, inDex, itemOf, variantsOf, type FishCat, type FishItem, type FishOdds, type FishSpot } from "@/lib/fish/items";
import { CASTS_A_DAY, type FishDex as Dex } from "@/lib/fish/rules";
import { fishApi } from "@/lib/fishClient";
import FishCard, { cmText, nameOf, picOf, wordsOf } from "./FishCard";

/**
 * 钓鳞图鉴, as the game's 藏品图鉴 (傀影's issue) in the bank's night blue and pale gold: tabs 全部 / 已钓到 / 没钓到 and
 * how many came in new since the dex was last looked at (this device), the items in groups (鳞, 杂物, 卫戍限定, and
 * 方舟原物 for a player FISH_GAME lets have them), a tile each with its number (NEW for one new), its disc and how many of its variants are in (◆◇); the
 * one picked in detail: its name, big picture, number and rarity, what it is for and the line in italics, where it bites
 * and how likely, the biggest the player caught and the site's biggest (no names), its variants, how often and when it
 * was first caught. Not caught: ???, a dark shape, a hint, and 「未知还潜伏在水面之下。」 On a phone the detail sits over
 * the grid; on a computer the whole screen, the detail at the left.
 */

type Tab = "all" | "have" | "miss";
const GROUPS: FishCat[] = ["fish", "junk", "squad", "game"];
const SEEN_KEY = "fish.dexAt";
const SPOT_ORDER: FishSpot[] = ["pond", "pier", "auto"];

/** When this device last looked at the dex (what was first caught since is NEW) */
function seenAt(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function keepSeen(at: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // this page alone, then
  }
}

const pad = (no: number) => String(no).padStart(3, "0");
const when = (at: number) => {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

export default function FishDex({
  owned,
  cells,
  casts,
  game,
  onClose,
  onRefused,
}: {
  owned: number;
  cells: number;
  casts: number;
  /** FISH_GAME lets the player have the 方舟原物: their column shows */
  game: boolean;
  onClose: () => void;
  onRefused: (e: unknown) => void;
}) {
  const [dex, setDex] = useState<Dex | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [pick, setPick] = useState<number | null>(null);
  const [seen] = useState(seenAt);
  useEffect(() => {
    let live = true;
    fishApi
      .dex()
      .then((d) => live && setDex(d))
      .catch((e) => live && onRefused(e));
    // what came in is not new once the dex was looked at
    return () => {
      live = false;
      keepSeen(Date.now());
    };
  }, [onRefused]);

  // each item's catches, any variant: how many, the variants in, the biggest, the first
  const mine = useMemo(() => {
    const by = new Map<number, { n: number; vars: Set<number>; best: number | null; first: { at: number; spot: FishSpot } | null; fresh: boolean }>();
    for (const r of dex?.mine ?? []) {
      const it = by.get(r.no) ?? { n: 0, vars: new Set<number>(), best: null, first: null, fresh: false };
      it.n += r.n;
      it.vars.add(r.variant);
      // the biggest of it, whichever variant
      if (r.best !== null) it.best = Math.max(it.best ?? 0, r.best);
      if (!it.first || r.firstAt < it.first.at) it.first = { at: r.firstAt, spot: r.firstSpot };
      if (r.firstAt > seen) it.fresh = true;
      by.set(r.no, it);
    }
    return by;
  }, [dex, seen]);
  const records = useMemo(() => {
    const by = new Map<number, number>();
    for (const r of dex?.records ?? []) by.set(r.no, Math.max(by.get(r.no) ?? 0, r.cm));
    return by;
  }, [dex]);
  const shown = FISH_ITEMS.filter((i) => inDex(i, game));
  const has = (i: FishItem) => (mine.get(i.no)?.n ?? 0) > 0;
  const fresh = [...mine.values()].filter((m) => m.fresh).length;
  const inTab = (i: FishItem) => (tab === "all" ? true : tab === "have" ? has(i) : !has(i));
  // the one picked while it is in the tab, else the first caught in it, else its first
  const visible = shown.filter(inTab);
  const sel = itemOf(pick !== null && visible.some((i) => i.no === pick) ? pick : ((visible.find(has) ?? visible[0] ?? shown[0])?.no ?? 1));

  return (
    <div className="fish-dex" role="dialog" aria-label={T.fish.dexPage.title}>
      <div className="top">
        <button type="button" className="back" onClick={onClose} aria-label={T.fish.dexPage.back}>
          ‹
        </button>
        <span className="ttl" aria-hidden="true">
          {T.fish.dexPage.title}
        </span>
        {fresh > 0 && (
          <span className="newc">
            <b>{fresh}</b>
            {T.fish.dexPage.newCount}
          </span>
        )}
      </div>
      <div className="tabs" role="tablist">
        {(["all", "have", "miss"] as const).map((k, i) => (
          <span key={k} style={{ display: "contents" }}>
            {i > 0 && <span className="sep" aria-hidden="true" />}
            <button type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
              <span className="brush" aria-hidden="true" />
              <span>{T.fish.dexPage.tabs[k]}</span>
            </button>
          </span>
        ))}
        <span className="ftally">{fmt(T.fish.dexPage.tally, { n: owned, max: cells, casts, limit: CASTS_A_DAY })}</span>
      </div>
      {!dex ? (
        <p className="empty">{T.fish.dexPage.loading}</p>
      ) : (
        <div className="body">
          {sel && <Detail item={sel} got={mine.get(sel.no)} record={records.get(sel.no) ?? null} />}
          <div className="grid">
            {GROUPS.map((g) => {
              const list = shown.filter((i) => i.cat === g);
              if (!list.length) return null;
              const inIt = list.filter(inTab);
              return (
                <section key={g}>
                  <div className="sec">
                    <span className="dia" aria-hidden="true" />
                    <span className="chev" aria-hidden="true">
                      ‹
                    </span>
                    <span className="nm">{T.fish.dexPage.groups[g]}</span>
                    <span className="ln" aria-hidden="true" />
                    <span className="en" aria-hidden="true">
                      {T.fish.dexPage.groupsEn[g]}
                    </span>
                    <span className="ct">
                      {list.filter(has).length} / {list.length}
                    </span>
                  </div>
                  {inIt.length ? (
                    <div className="cells">
                      {inIt.map((i) => {
                        const m = mine.get(i.no);
                        const vars = variantsOf(i);
                        const got = vars.filter((v) => m?.vars.has(v)).length;
                        return (
                          <button
                            key={i.no}
                            type="button"
                            className={`tile${sel?.no === i.no ? " on" : ""}`}
                            aria-label={`No.${pad(i.no)} ${has(i) ? nameOf(i.no) : T.fish.dexPage.unknown}`}
                            aria-pressed={sel?.no === i.no}
                            onClick={() => setPick(i.no)}
                          >
                            {m?.fresh ? <em className="fish-new">NEW</em> : <span className="no">{pad(i.no)}</span>}
                            <FishCard no={i.no} size={66} locked={!has(i)} />
                            {vars.length > 0 && got > 0 && (
                              <span className="vd" aria-hidden="true">
                                {"◆".repeat(got)}
                                {"◇".repeat(vars.length - got)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="empty">{T.fish.dexPage.none}</p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  item,
  got,
  record,
}: {
  item: FishItem;
  got: { n: number; vars: Set<number>; best: number | null; first: { at: number; spot: FishSpot } | null } | undefined;
  record: number | null;
}) {
  const w = wordsOf(item.key);
  const caught = Boolean(got && got.n > 0);
  const spots = SPOT_ORDER.filter((s) => item.at[s]);
  const vars = variantsOf(item);
  const hint = w?.hint || fmt(T.fish.dexPage.hintAt, { spots: spots.map((s) => T.fish.dexPage.spots[s]).join(T.fish.dexPage.hintSep) });
  return (
    <section className="detail" aria-live="polite">
      <b className="nm">{caught ? nameOf(item.no) : T.fish.dexPage.unknown}</b>
      <span className="pic">
        {caught ? (
          // eslint-disable-next-line @next/next/no-img-element -- a picture of our own
          <img src={picOf(item.key)} alt="" />
        ) : (
          <span className="shade" aria-hidden="true" />
        )}
      </span>
      <span className="no">
        <b>No.{pad(item.no)}</b>
        <span>
          <FishCard no={item.no} size={14} bare />
          {fmt(T.fish.dexPage.tier, { n: item.tier })}
        </span>
      </span>
      <span className="line" aria-hidden="true" />
      {!caught ? (
        <>
          <p>{hint}</p>
          <p className="fl">{T.fish.dexPage.unknownLine}</p>
        </>
      ) : (
        <>
          <p>{w?.use}</p>
          {w?.flavor && <p className="fl">{w.flavor}</p>}
          <span className="lab">{T.fish.dexPage.where}</span>
          <span className="fchips">
            {spots.map((s) => (
              <span key={s} className="fchip">
                <span>{T.fish.dexPage.spots[s]}</span>
                <b className={item.at[s]}>{T.fish.dexPage.odds[item.at[s] as FishOdds]}</b>
              </span>
            ))}
          </span>
          {item.cm && (
            <span className="sizes">
              <div>
                <small>{T.fish.dexPage.best}</small>
                <b>{got?.best ? cmText(got.best) : "—"}</b>
              </div>
              <div>
                <small>{T.fish.dexPage.record}</small>
                <b>{record ? cmText(record) : "—"}</b>
              </div>
            </span>
          )}
          {vars.length > 0 && (
            <>
              <span className="lab">{fmt(T.fish.dexPage.variants, { n: vars.length })}</span>
              <span className="vars">
                {vars.map((v) => (
                  <span key={v} className={got?.vars.has(v) ? "have" : undefined}>
                    <FishCard no={item.no} variant={v} size={40} locked={!got?.vars.has(v)} />
                    {T.fish.variantShort[v]}
                  </span>
                ))}
              </span>
            </>
          )}
          {got?.first && (
            <span className="count">
              {fmt(T.fish.dexPage.times, { n: got.n })} · {fmt(T.fish.dexPage.first, { when: when(got.first.at), spot: T.fish.dexPage.spots[got.first.spot] })}
            </span>
          )}
        </>
      )}
    </section>
  );
}
