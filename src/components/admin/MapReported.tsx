"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ROACH_REASON_SHORT, type ReportedPlace, type ReportedRoachAll, type ReportedRoaches } from "@/lib/adminConsole";
import { ROACH_REPORT_REASONS, RULES, type RoachReportReason } from "@/lib/safety";
import type { LngLat } from "@/lib/types";
import { ago } from "../app/InboxSheet";
import type { MapLine, MapOverlay } from "../map/types";
import { adminCall, AdminError, errorWords } from "./api";
import { useHeld } from "./held";

/**
 * 看被举报的蟑螂, on the 站长's map: the roach cases open for where a roach was put (贴着别人放, 不合适的地方, 摆字或
 * 图案), each a red ring where it is now and a dashed one where it was at the report; or, the owner only, every
 * roach of a player with open reports, whatever for. A ring opens its card, to settle it there: 没问题 and 收回
 * wait HOLD_SECONDS for 撤销, as in the 管理台. Read once when opened; closed and opened again, it is read anew.
 */

type View = "place" | "all";
const REASONS: RoachReportReason[] = ["stalk", "place", "pattern"];
/** The switches' words: short enough for the three to sit in a row on a phone */
const CHIP: Record<RoachReportReason, string> = { stalk: "贴着别人放", place: "不合适的地方", pattern: "摆字或图案" };

type Item = { key: string; caseId: string; main: boolean; owner: string; place: ReportedPlace | null; roach: ReportedRoachAll | null };

const SPOT = {
  here: "举报以后还在原地。",
  moved: "举报以后挪过窝了，虚线圈是举报时它在哪。",
  gone: "已经收回了，虚线圈是举报时它在哪。",
} as const;

/** 「3 人举报，2 人算可靠 · 最早 5 小时前」 */
function metaOf(p: ReportedPlace, now: number) {
  const reliable =
    p.reliable === 0 ? "" : p.reporters === 1 ? "，算可靠" : p.reliable === p.reporters ? "，都算可靠" : `，${p.reliable} 人算可靠`;
  return `${p.reporters} 人举报${reliable} · ${p.reporters > 1 ? "最早 " : ""}${ago(p.since, now)}`;
}

const reasonsOf = (p: ReportedPlace) => p.reasons.map((r) => `${ROACH_REPORT_REASONS[r.reason]} ×${r.n}`).join("、");
const reportsOf = (p: ReportedPlace) => p.reasons.reduce((n, r) => n + r.n, 0);

/** A ring on the map: red where it is now, dashed where it was (with its word over it); the chosen one bolder */
function ringElement(kind: "now" | "was", main: boolean, label: string | null, aria: string) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `rep-ring${kind === "was" ? " was" : ""}`;
  el.setAttribute("aria-label", aria);
  if (kind === "now") el.textContent = main ? "本" : "克";
  if (label) {
    const tag = document.createElement("span");
    tag.className = "rep-ring-tag";
    tag.textContent = label;
    el.appendChild(tag);
  }
  return el;
}

export default function MapReported({
  owner,
  start,
  hidden,
  panelSlot,
  onMarks,
  onFocus,
  onPick,
  onSay,
  onClose,
}: {
  owner: boolean;
  /** A case to open at once (/?case=, from the 管理台), or null */
  start: string | null;
  /** Placing, or a roach's own card open: the card here waits meanwhile */
  hidden: boolean;
  /** Where the panel goes: under the counts at the top of the map */
  panelSlot: HTMLElement | null;
  onMarks: (overlays: MapOverlay[], lines: MapLine[]) => void;
  /** Fly to a spot, lift pixels above the middle of the map */
  onFocus: (at: LngLat, lift: number) => void;
  /** A ring was tapped: the roach card open, if any, makes way */
  onPick: () => void;
  onSay: (text: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("place");
  const [places, setPlaces] = useState<ReportedPlace[] | null>(null);
  const [all, setAll] = useState<ReportedRoachAll[] | null>(null);
  const [on, setOn] = useState<Record<RoachReportReason, boolean>>({ stalk: true, place: true, pattern: true });
  // settled here: held for 撤销, or sent
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; shut: boolean } | null>(null);
  const [now] = useState(() => Date.now());
  const { held, hold, undo } = useHeld();

  const fail = useCallback((e: unknown) => {
    const shut = e instanceof AdminError && Boolean(e.gate);
    setNote({ text: shut ? "先去管理台输验证码，再回来看。" : errorWords(e), shut });
  }, []);

  // a spot goes in the middle of what the panel at the top and the card at the bottom leave of the map, measured
  // once the card for it is drawn
  const panelEl = useRef<HTMLElement | null>(null);
  const cardEl = useRef<HTMLElement | null>(null);
  const [aim, setAim] = useState<{ at: LngLat } | null>(null);
  const focus = (at: LngLat) => setAim({ at });
  useLayoutEffect(() => {
    if (!aim) return;
    const top = panelEl.current?.getBoundingClientRect().bottom ?? 0;
    const bottom = cardEl.current?.getBoundingClientRect().top ?? window.innerHeight;
    onFocus(aim.at, bottom > top ? Math.round(window.innerHeight / 2 - (top + bottom) / 2) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim]);

  // 位置被举报的: read when opened, and the case a link names opened from it
  const started = useRef(false);
  useEffect(() => {
    let live = true;
    adminCall<ReportedRoaches>("reportedRoaches", [{ view: "place" }])
      .then((r) => {
        if (!live || r.view !== "place") return;
        setPlaces(r.places);
        if (start && !started.current) {
          started.current = true;
          const p = r.places.find((x) => x.caseId === start);
          if (!p) return onSay("这件已经处理过了。");
          setSel(p.caseId);
          focus(p.now ?? p.was);
        }
      })
      .catch((e) => live && fail(e));
    return () => {
      live = false;
    };
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 被举报的人的全部蟑螂: read the first time it is asked for, the owner only
  const showAll = () => {
    setView("all");
    setSel(null);
    if (all) return;
    adminCall<ReportedRoaches>("reportedRoaches", [{ view: "all" }])
      .then((r) => r.view === "all" && setAll(r.roaches))
      .catch(fail);
  };

  const open = useMemo(() => (places ?? []).filter((p) => !gone.has(p.caseId)), [places, gone]);
  const items = useMemo<Item[]>(() => {
    if (view === "place") {
      return open
        .filter((p) => p.reasons.some((r) => on[r.reason]))
        .map((p) => ({ key: p.caseId, caseId: p.caseId, main: p.main, owner: p.owner, place: p, roach: null }));
    }
    const byCase = new Map(open.map((p) => [p.caseId, p]));
    return (all ?? [])
      .filter((r) => !gone.has(r.caseId) || r.about !== "self")
      .map((r) => ({
        key: `all:${r.id}`,
        caseId: r.caseId,
        main: r.main,
        owner: r.owner,
        place: r.about === "self" ? (byCase.get(r.caseId) ?? null) : null,
        roach: r,
      }));
  }, [view, open, all, on, gone]);

  const at = items.findIndex((x) => x.key === sel);
  const current = at >= 0 ? items[at] : null;
  const spotOf = (x: Item): LngLat => (x.roach ? { lng: x.roach.lng, lat: x.roach.lat } : (x.place!.now ?? x.place!.was));

  const pickRef = useRef<(key: string) => void>(() => {});
  pickRef.current = (key: string) => {
    onPick();
    setSel(key);
  };

  // the marks: built again when the list changes, the chosen one marked in place. A ring keeps its element while it
  // stays on the map, as the map keeps the element it was first given for that id
  const rings = useRef(new Map<string, HTMLElement[]>());
  const made = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const overlays: MapOverlay[] = [];
    const lines: MapLine[] = [];
    const els = new Map<string, HTMLElement[]>();
    const kept = new Map<string, HTMLElement>();
    const ring = (id: string, make: () => HTMLElement) => {
      const el = made.current.get(id) ?? make();
      kept.set(id, el);
      return el;
    };
    for (const x of items) {
      const tap = () => pickRef.current(x.key);
      const what = `${x.main ? "本体" : "克隆体"}，主人 ${x.owner}`;
      const mine: HTMLElement[] = [];
      if (x.roach) {
        const r = x.roach;
        const el = ring(`rep-${x.key}`, () => ringElement("now", x.main, null, `${what}，${r.why}`));
        overlays.push({ id: `rep-${x.key}`, at: { lng: r.lng, lat: r.lat }, el, onClick: tap });
        mine.push(el);
      } else if (x.place) {
        const p = x.place;
        const why = p.reasons.map((r) => ROACH_REASON_SHORT[r.reason]).join("、");
        if (p.now) {
          const el = ring(`rep-${x.key}`, () => ringElement("now", x.main, null, `${what}，${why}`));
          overlays.push({ id: `rep-${x.key}`, at: p.now, el, onClick: tap });
          mine.push(el);
        }
        if (p.state !== "here") {
          const gone = p.state === "gone";
          const el = ring(`rep-was-${x.key}`, () => ringElement("was", x.main, gone ? "已收回" : "举报时在这", `${what}，${why}，${gone ? "已经收回" : "举报时在这里"}`));
          overlays.push({ id: `rep-was-${x.key}`, at: p.was, el, onClick: tap });
          mine.push(el);
          if (p.now) lines.push({ id: `rep-${x.key}`, from: p.was, to: p.now });
        }
      }
      els.set(x.key, mine);
    }
    rings.current = els;
    made.current = kept;
    onMarks(overlays, lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => {
    for (const [key, list] of rings.current) for (const el of list) el.classList.toggle("sel", key === current?.key);
  }, [current, items]);
  // closed: off the map
  useEffect(
    () => () => onMarks([], []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const go = (i: number) => {
    if (!items.length) return;
    const x = items[(i + items.length) % items.length];
    onPick();
    setSel(x.key);
    focus(spotOf(x));
  };

  /** 没问题, or 收回: out of the list now and the next one up, sent once 撤销 has had its seconds */
  const settle = (x: Item, action: "dismiss" | "removeRoach") => {
    const rest = items.filter((y) => y.caseId !== x.caseId);
    const next = rest.length ? rest[Math.min(Math.max(at, 0), rest.length - 1)] : null;
    setGone((g) => new Set([...g, x.caseId]));
    setSel(next?.key ?? null);
    if (next) focus(spotOf(next));
    const back = () =>
      setGone((g) => {
        const s = new Set(g);
        s.delete(x.caseId);
        return s;
      });
    const n = x.place ? reportsOf(x.place) : 0;
    hold({
      text:
        action === "dismiss"
          ? n
            ? `已标成没问题，关掉了 ${n} 条举报`
            : "已标成没问题"
          : x.main
            ? "已收回这只和它的克隆体"
            : "已收回这只",
      send: (keepalive) => adminCall("resolve", [x.caseId, action, "roach"], { keepalive }),
      onUndo: () => {
        back();
        setSel(x.key);
        focus(spotOf(x));
      },
      onFail: (e) => {
        back();
        fail(e);
      },
    });
  };

  const placeCount = open.length;
  const counts = Object.fromEntries(REASONS.map((r) => [r, open.filter((p) => p.reasons.some((x) => x.reason === r)).length])) as Record<RoachReportReason, number>;
  const loaded = view === "place" ? places !== null : all !== null;

  const panel = (
    <section ref={panelEl} className="rep-panel" aria-label="看被举报的蟑螂">
      <div className="rep-panel-head">
        <strong>看被举报的蟑螂</strong>
        <button type="button" className="rep-btn small" onClick={onClose}>
          收起
        </button>
      </div>
      {owner && (
        <div className="rep-seg" role="group" aria-label="标出哪些">
          <button
            type="button"
            aria-pressed={view === "place"}
            onClick={() => {
              setView("place");
              setSel(null);
            }}
          >
            位置被举报的{places ? ` ${placeCount}` : ""}
          </button>
          <button type="button" aria-pressed={view === "all"} onClick={showAll}>
            被举报的人的全部蟑螂{all ? ` ${all.length}` : ""}
          </button>
        </div>
      )}
      {view === "place" ? (
        <>
          <div className="rep-chips" role="group" aria-label="哪几种位置问题">
            {REASONS.map((r) => (
              <button key={r} type="button" className="rep-chip" aria-pressed={on[r]} onClick={() => setOn((o) => ({ ...o, [r]: !o[r] }))}>
                {CHIP[r]} {places ? counts[r] : ""}
              </button>
            ))}
          </div>
          <p className="rep-hint">红圈是它现在在哪，虚线圈是举报时在哪。本＝本体，克＝克隆体。</p>
        </>
      ) : (
        <p className="rep-hint">被举报的人的每一只蟑螂，不管因为什么被举报（名字、联系方式也算）。只有站长能看这个。</p>
      )}
      {note && (
        <p className="rep-note" role="alert">
          {note.text}
          {note.shut && (
            <>
              {" "}
              <a href="/admin">去管理台</a>
            </>
          )}
        </p>
      )}
    </section>
  );

  const x = current;
  const p = x?.place ?? null;
  const card = (
    <section ref={cardEl} className="rep-card" aria-label="被举报的这只">
      {held && (
        <div className="rep-held" role="status">
          <span>{held.text}</span>
          <button type="button" onClick={undo}>
            撤销 {held.left}
          </button>
        </div>
      )}
      {!x ? (
        <>
          <p className="rep-count">
            <strong>{!loaded ? "正在读取…" : items.length ? `标出了 ${items.length} 只。` : "这几种都处理完了。"}</strong>
            {loaded && items.length > 0 && "点红圈，看是谁的、为什么被举报，可以直接处理。"}
          </p>
          {loaded && items.length > 0 && (
            <div>
              <button type="button" className="rep-btn primary" onClick={() => go(0)}>
                从第一只开始看
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rep-card-head">
            <strong>
              {x.main ? "本体" : "克隆体"} · 主人：{x.owner}
            </strong>
            <span className="rep-pos">
              {at + 1} / {items.length}
            </span>
            <button type="button" className="rep-btn icon" aria-label="上一只" onClick={() => go(at - 1)}>
              ‹
            </button>
            <button type="button" className="rep-btn icon" aria-label="下一只" onClick={() => go(at + 1)}>
              ›
            </button>
          </div>
          <div className="rep-why">
            <strong>{p ? `被举报：${reasonsOf(p)}` : x.roach?.about === "self" ? `被举报：${x.roach.why}` : `主人被举报：${x.roach?.why ?? ""}`}</strong>
            <span>{p ? metaOf(p, now) : x.roach?.about === "self" ? "这只蟑螂自己被举报了" : "这只蟑螂本身没被举报"}</span>
          </div>
          <p className="rep-line">{p ? SPOT[p.state] : "它现在就在这里。"}</p>
          {p?.nearM != null && <p className="rep-line">举报时离举报人最近的一只蟑螂 {p.nearM} 米。举报人的蟑螂在哪不显示。</p>}
          {p || x.roach?.about === "self" ? (
            <>
              <p className="rep-hint">按「{RULES.roach}」处理。主人收到的站长通知会写这一条，能申诉。</p>
              <div className="rep-acts">
                <button type="button" className="rep-btn" onClick={() => settle(x, "dismiss")}>
                  没问题
                </button>
                {p?.state !== "gone" && (
                  <button type="button" className="rep-btn danger" onClick={() => settle(x, "removeRoach")}>
                    {x.main ? "收回（连克隆体）" : "收回这只"}
                  </button>
                )}
                <a className="rep-btn" href={`/admin?case=${encodeURIComponent(x.caseId)}`}>
                  去管理台
                </a>
              </div>
            </>
          ) : (
            <>
              <p className="rep-line">这只蟑螂本身没被举报，是主人因为别的事被举报，才一起标出来。</p>
              <div className="rep-acts">
                <a className="rep-btn" href={`/admin?case=${encodeURIComponent(x.caseId)}`}>
                  去管理台处理
                </a>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );

  return (
    <>
      {panelSlot && createPortal(panel, panelSlot)}
      {!hidden && card}
    </>
  );
}
