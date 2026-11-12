"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ZONE_LABEL_MAX,
  ZONE_MAX_M,
  ZONE_MIN_M,
  ZONE_RADII,
  ZONE_RADIUS,
  ZONE_RADIUS_WRONG,
  ZONE_SURE_OVER,
  type ZoneDrawn,
  type ZonePreview,
} from "@/lib/adminConsole";
import type { LngLat } from "@/lib/types";
import type { MapLine } from "../map/types";
import { adminCall, AdminError, errorWords } from "./api";
import { circlePath, metresPerPx, spotAbove, zoomFor, type MapPulse } from "./zoneAim";

/**
 * 圈一块禁放区 on the owner's map (src/lib/server/zones.ts): a crosshair over the map with the ring of the size round it,
 * and a card below with the size, what the ring takes in now (zonePreview, once the map has rested or the size changed
 * for PREVIEW_MS), what of the site's own stands in it, and what and why. 圈好 draws it (drawZone), asking again first
 * over ZONE_SURE_OVER roaches; its circle then stays on the map, drawn by the map. Opened from 禁放区 in the 管理台
 * (/?draw=1, where the map was) or round a roach (its card, or 看被举报的蟑螂), the map going there.
 *
 * The crosshair keeps its height over the middle of the map, measured once as the card first shows: a keyboard coming
 * up for the label then moves it with the map, and it points at the same spot all along.
 */

/** The roach card's 站长 button (RoachCards.tsx): draw round that roach */
export const DRAW_HERE = "站长：以后也不让放";

const PREVIEW_MS = 300;
/** Of the room round the crosshair, how much a ring fills when the map is fitted to it */
const FILL = 0.6;
/** A ring larger than this (in pixels) is not drawn: the map is far too close to show it */
const RING_MAX_PX = 4000;
const zoomIn = (z: number) => Math.min(18, Math.max(3, z));
/** 「1,234」 */
const num = (x: number) => x.toLocaleString();

type Kept = Extract<ZoneDrawn, { id: string }>;
type Step =
  | { kind: "edit" }
  | { kind: "sure"; count: number; at: LngLat; radius: number }
  | { kind: "done"; kept: Kept; at: LngLat; radius: number };

/** The crosshair: how far above the middle of the map it is, and the room round it for a ring, in pixels */
type Aim = { up: number; room: number };

/** A size typed in: whole metres, ZONE_MIN_M to ZONE_MAX_M; anything else is no size */
function ownRadius(text: string) {
  const m = Math.round(Number(text));
  return text.trim() && Number.isFinite(m) && m >= ZONE_MIN_M && m <= ZONE_MAX_M ? m : null;
}

function doneWords(k: Kept) {
  if (!k.done) return `正在把圈里的 ${num(k.count)} 只挪到圈外，挪完列表上会显示。以后谁也放不进这个圈。`;
  const out = k.moved + k.home;
  return out
    ? `挪走了 ${num(out)} 只，${num(k.owners)} 个主人收到了站长通知，不记黄牌。以后谁也放不进这个圈。`
    : "圈里没有蟑螂要挪。以后谁也放不进这个圈。";
}

export default function ZoneDraw({
  start,
  pulse,
  onFocus,
  onLines,
  onClose,
}: {
  /** Round this spot (a roach), the map going there; or null, where the map is */
  start: LngLat | null;
  /** Where the map rests and whether it moves (MapApp) */
  pulse: MapPulse;
  /** Fly to a spot, lift pixels above the middle of the map, at that zoom */
  onFocus: (at: LngLat, lift: number, zoom: number) => void;
  /** The circle the map draws, once one is asked about or kept */
  onLines: (lines: MapLine[]) => void;
  onClose: () => void;
}) {
  const [size, setSize] = useState<number | "own">(ZONE_RADIUS);
  const [own, setOwn] = useState("");
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<Step>({ kind: "edit" });
  const [preview, setPreview] = useState<{ key: string; p: ZonePreview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; shut: boolean } | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  // a new circle (再圈一块) measures the crosshair's place again
  const [round, setRound] = useState(0);
  const { view, moving } = useSyncExternalStore(pulse.on, pulse.get, pulse.get);

  const radius = size === "own" ? ownRadius(own) : size;
  const spot = aim ? spotAbove(view, aim.up) : null;
  const key = spot && radius ? `${spot.lng.toFixed(6)},${spot.lat.toFixed(6)},${radius}` : null;
  const ring = spot && radius ? radius / metresPerPx(spot.lat, view.zoom) : 0;
  const editing = step.kind === "edit";

  const fail = useCallback((e: unknown) => {
    const shut = e instanceof AdminError && Boolean(e.gate);
    setNote({ text: shut ? "先去管理台输验证码，再回来圈。" : errorWords(e), shut });
  }, []);

  // the crosshair halfway between the card at the top and the one below, measured against the middle of the map (this
  // layer covers the map exactly); again when the window turns or changes width, not when a keyboard takes its height
  const layer = useRef<HTMLDivElement>(null);
  const topEl = useRef<HTMLElement>(null);
  const sheetEl = useRef<HTMLElement>(null);
  const measure = useCallback(() => {
    const box = layer.current?.getBoundingClientRect();
    if (!box) return;
    const top = topEl.current?.getBoundingClientRect().bottom ?? box.top;
    const bottom = sheetEl.current?.getBoundingClientRect().top ?? box.bottom;
    const y = (top + bottom) / 2;
    setAim({ up: Math.round(box.top + box.height / 2 - y), room: Math.max(16, Math.min(y - top, bottom - y, box.width / 2) - 8) });
  }, []);
  useLayoutEffect(measure, [round, measure]);
  useEffect(() => {
    let width = window.innerWidth;
    const resized = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      measure();
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [measure]);

  // round a roach: the map goes there, the roach under the crosshair, close enough for the ring to show whole
  const started = useRef(false);
  useEffect(() => {
    if (!aim || !start || started.current) return;
    started.current = true;
    onFocus(start, aim.up, zoomIn(zoomFor(ZONE_RADIUS, start.lat, aim.room * FILL)));
  }, [aim, start, onFocus]);

  // the map at rest, or the size changed: after PREVIEW_MS, what the ring takes in now. A new size the ring no longer
  // fits round the crosshair at takes the map out to show it whole first (the count follows once it rests there)
  const asked = useRef(0);
  const fitted = useRef<number | null>(ZONE_RADIUS);
  useEffect(() => {
    if (!editing || moving || !key || !spot || !radius || !aim) return;
    const t = window.setTimeout(() => {
      if (fitted.current !== radius) {
        fitted.current = radius;
        if (ring > aim.room) return onFocus(spot, aim.up, zoomIn(zoomFor(radius, spot.lat, aim.room * FILL)));
      }
      const mine = ++asked.current;
      adminCall<ZonePreview>("zonePreview", [{ lng: spot.lng, lat: spot.lat, radiusM: radius }])
        .then((p) => {
          if (mine !== asked.current) return;
          setPreview({ key, p });
          setNote(null);
        })
        .catch((e) => mine === asked.current && fail(e));
    }, PREVIEW_MS);
    return () => window.clearTimeout(t);
    // the key says where and how big
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, moving, editing]);

  // asked about or kept: the circle stays where it is on the map, drawn by the map, whatever moves after
  useEffect(() => {
    onLines(step.kind === "edit" ? [] : [{ id: "zone-new", path: circlePath(step.at, step.radius), color: "blue", solid: step.kind === "done" }]);
  }, [step, onLines]);
  useEffect(() => () => onLines([]), [onLines]);

  const save = async (sure: boolean, at: LngLat, r: number) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await adminCall<ZoneDrawn>("drawZone", [{ lng: at.lng, lat: at.lat, radiusM: r, label: label.trim(), sure }]);
      setStep(res.needSure ? { kind: "sure", count: res.count, at, radius: r } : { kind: "done", kept: res, at, radius: r });
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };

  const shown = preview && preview.key === key ? preview.p : null;
  const tapSave = () => {
    if (!spot || !radius || !label.trim()) return;
    if (shown && shown.count > ZONE_SURE_OVER) setStep({ kind: "sure", count: shown.count, at: spot, radius });
    else void save(false, spot, radius);
  };

  const again = () => {
    setStep({ kind: "edit" });
    setLabel("");
    setSize(ZONE_RADIUS);
    setOwn("");
    setPreview(null);
    setNote(null);
    fitted.current = ZONE_RADIUS;
    setRound((r) => r + 1);
  };

  const pickOwn = () => {
    // starting from the size there was
    if (!own && size !== "own") setOwn(String(size));
    setSize("own");
  };

  const last = preview?.p ?? null;
  const countWords = !radius
    ? "先选圈多大。"
    : last
      ? `圈里现在有 ${num(last.count)} 只蟑螂，属于 ${num(last.owners)} 个人（你自己的也算在内）。`
      : "正在数圈里有几只蟑螂…";
  const needLabel = !label.trim();

  return (
    <>
      <div ref={layer} className="zone-layer" aria-hidden="true">
        {editing && aim && (
          <div className={`zone-aim${moving ? " moving" : ""}`} style={{ top: `calc(50% - ${aim.up}px)` }}>
            {ring >= 3 && ring <= RING_MAX_PX && <span className="zone-ring" style={{ width: ring * 2, height: ring * 2 }} />}
            <svg className="zone-cross" width="28" height="28" viewBox="0 0 28 28">
              <path d="M14 2v8M14 18v8M2 14h8M18 14h8" stroke="#173c9c" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="14" cy="14" r="3" fill="#173c9c" />
            </svg>
          </div>
        )}
      </div>

      <section ref={topEl} className="zone-top" aria-label="圈一块禁放区">
        <div className="zone-top-head">
          <strong>圈一块禁放区</strong>
          <button type="button" className="rep-btn small" onClick={onClose}>
            {step.kind === "done" ? "收起" : "取消"}
          </button>
        </div>
        {editing && <p>拖动地图，让十字对准要圈的地方的中间。只有站长能圈。</p>}
      </section>

      <section ref={sheetEl} className="zone-sheet" aria-label="圈多大">
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

        {step.kind === "edit" && (
          <>
            <div className="zone-size">
              <span id="zone-size-label" className="zone-label">
                圈多大（半径）
              </span>
              <div className="zone-opts" role="group" aria-labelledby="zone-size-label">
                {ZONE_RADII.map((r) => (
                  <button key={r} type="button" className="zone-opt" aria-pressed={size === r} onClick={() => setSize(r)}>
                    {r} 米
                  </button>
                ))}
                <button type="button" className="zone-opt" aria-pressed={size === "own"} onClick={pickOwn}>
                  自己填
                </button>
              </div>
              {size === "own" && (
                <label className="zone-own">
                  半径
                  <input
                    type="number"
                    inputMode="numeric"
                    min={ZONE_MIN_M}
                    max={ZONE_MAX_M}
                    step={10}
                    value={own}
                    onChange={(e) => setOwn(e.target.value)}
                  />
                  米（{ZONE_MIN_M} 到 {ZONE_MAX_M}）
                </label>
              )}
              {size === "own" && own.trim() !== "" && !radius && (
                <p className="zone-error" role="alert">
                  {ZONE_RADIUS_WRONG}
                </p>
              )}
            </div>
            <p className={`zone-count${last && !shown ? " stale" : ""}`}>{countWords}</p>
            {last?.warnings.map((w) => (
              <p key={w} className="zone-warn">
                {w}
              </p>
            ))}
            <label className="zone-field">
              是哪儿、为什么圈（只有你看得到）
              <input
                type="text"
                value={label}
                maxLength={ZONE_LABEL_MAX}
                placeholder="比如：示例县烈士陵园，有人举报"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <p className="zone-small">
              圈好马上生效：谁都不能把蟑螂放进或挪进这个圈，提示和别的禁放区一样。圈里现在的蟑螂挪到圈外 60 到 300 米，主人收到一条站长通知，不记黄牌。玩家看不到这个圈。
            </p>
            <button
              type="button"
              className="rep-btn primary zone-save"
              disabled={busy || needLabel || !radius || !spot || Boolean(note?.shut)}
              onClick={tapSave}
            >
              {shown && shown.count > 0 ? `圈好，挪走 ${num(shown.count)} 只` : "圈好"}
            </button>
            {needLabel && <p className="zone-small zone-need">先写一句是哪儿、为什么圈，才能保存。</p>}
          </>
        )}

        {step.kind === "sure" && (
          <>
            <div className="zone-sure" role="alert">
              <strong>
                圈里有 {num(step.count)} 只，超过 {ZONE_SURE_OVER} 只了
              </strong>
              <span>真的都挪走吗？挪走以后，就算解除这个圈，它们也不会挪回来。</span>
            </div>
            <div className="rep-acts">
              <button type="button" className="rep-btn danger-solid" disabled={busy} onClick={() => void save(true, step.at, step.radius)}>
                确认，挪走 {num(step.count)} 只
              </button>
              <button type="button" className="rep-btn" disabled={busy} onClick={() => setStep({ kind: "edit" })}>
                再想想
              </button>
            </div>
          </>
        )}

        {step.kind === "done" && (
          <>
            <div className="zone-done" role="status">
              <span className="zone-tick" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <strong>圈好了</strong>
            </div>
            <p className="zone-line">{doneWords(step.kept)}</p>
            <div className="rep-acts">
              <a className="rep-btn primary" href="/admin?page=zones">
                去禁放区列表看
              </a>
              <button type="button" className="rep-btn" onClick={again}>
                再圈一块
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
