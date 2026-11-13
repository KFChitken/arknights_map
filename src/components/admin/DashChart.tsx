"use client";

import { createContext, useContext, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { colTop, highest, layout, tickWords, type ChartKind } from "./chartMath";

/**
 * 数据看板's charts (Dashboard.tsx), drawn as plain SVG to the width they have: columns, two stacked series, or
 * lines. Hovering one (or tapping, or the arrow keys once it has focus) shows that point's numbers in one tooltip
 * shared by the whole board. Each chart comes with a table under it on the board, for reading the numbers off.
 */

/** The board's colours: series first, second, third, fourth, and one quiet one */
export const COLORS = {
  s1: "#2253d1",
  s2: "#eb6834",
  s3: "#1baf7a",
  s4: "#eda100",
  quiet: "#b4bac4",
  grid: "#eef0f3",
  axis: "#cdd2da",
  band: "#f0f4fd",
  blank: "#f4f5f7",
} as const;

export type Series = { name: string; color: string; values: (number | null)[]; area?: boolean };
export type TipRow = { name: string; value: string; color?: string; sub?: boolean };
type Tip = { owner: string; x: number; y: number; title: string; rows: TipRow[] };

/** The one tooltip: who shows it and what, outside React's state so a moving pointer redraws only the tooltip */
function tipStore() {
  let tip: Tip | null = null;
  const subs = new Set<() => void>();
  const tell = () => subs.forEach((f) => f());
  return {
    get: () => tip,
    show(t: Tip) {
      tip = t;
      tell();
    },
    /** Hide it: anyone's, or only the owner's own */
    hide(owner?: string) {
      if (!tip || (owner && tip.owner !== owner)) return;
      tip = null;
      tell();
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}
type TipStore = ReturnType<typeof tipStore>;

const TipContext = createContext<TipStore | null>(null);

/** Hide whatever tooltip shows: on scrolling, a tap outside the charts, or a switch changing what they show */
export function useHideTip() {
  const store = useContext(TipContext);
  return () => store?.hide();
}

/** Where the board's charts share their tooltip */
export function TipLayer({ children }: { children: ReactNode }) {
  const [store] = useState(tipStore);
  useLayoutEffect(() => {
    const away = () => store.hide();
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".db-plot"))) store.hide();
    };
    window.addEventListener("scroll", away, { passive: true });
    document.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("scroll", away);
      document.removeEventListener("pointerdown", down);
    };
  }, [store]);
  return (
    <TipContext.Provider value={store}>
      {children}
      <TipBox store={store} />
    </TipContext.Provider>
  );
}

function TipBox({ store }: { store: TipStore }) {
  const tip = useSyncExternalStore(store.subscribe, store.get, () => null);
  const box = useRef<HTMLDivElement>(null);
  // beside the pointer, above it where there is room, and never off the screen
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = tip.x + 14;
    let top = tip.y - h - 12;
    if (left + w > window.innerWidth - 8) left = tip.x - w - 14;
    if (left < 8) left = 8;
    if (top < 8) top = tip.y + 16;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });
  if (!tip) return null;
  return (
    <div ref={box} className="db-tip" aria-hidden="true">
      <div className="t">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} className={`r${r.sub ? " sub" : ""}`}>
          {r.color && <span className="sw" style={{ background: r.color }} />}
          <span>{r.name}</span>
          <span className="v">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const BLANK_WORDS = "看板上线前没有记";

/**
 * One chart. The series' values are the points left to right (a day each, or an hour), null where nothing was
 * kept. Under the points: `xLabels` (one each, "" for none), or as many of `xLabel` as fit, always the last.
 * The first `blank` points were never kept: drawn as a grey patch, saying so where there is room.
 */
export function Chart({
  label,
  kind,
  series,
  xLabels,
  xLabel,
  blank = 0,
  title,
  rows,
}: {
  label: string;
  kind: ChartKind;
  series: Series[];
  xLabels?: string[];
  xLabel?: (k: number) => string;
  blank?: number;
  title: (k: number) => string;
  rows: (k: number) => TipRow[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const owner = useId();
  const store = useContext(TipContext);
  const mine = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.get()?.owner === owner,
    () => false,
  );
  const [point, setPoint] = useState<number | null>(null);

  // drawn to the width it has, and again whenever that changes
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(220, Math.floor(el.clientWidth));
      const h = Math.floor(el.clientHeight) || 180;
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    watch.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, []);

  const count = series[0]?.values.length ?? 0;
  const shown = mine && point !== null && point < count ? point : null;

  let drawing: ReactNode = null;
  let geo: ReturnType<typeof layout> | null = null;
  if (size && count > 0) {
    const { w: W, h: H } = size;
    const g = (geo = layout(W, H, count, kind, series.length, highest(kind, series)));
    const ks = Array.from({ length: count }, (_, k) => k);
    const parts: ReactNode[] = [];

    // the hovered column's band, under everything
    if (kind !== "line" && shown !== null) {
      parts.push(<rect key="hl" x={g.ml + g.band * shown} y={g.mt} width={g.band} height={g.ph} fill={COLORS.band} />);
    }
    // the grid and the axis's labels
    for (const t of g.ticks) {
      const y = Math.round(g.y(t)) + 0.5;
      parts.push(
        <line key={`g${t}`} x1={g.ml} x2={W - g.mr} y1={y} y2={y} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeWidth={1} />,
        <text key={`gt${t}`} x={g.ml - 6} y={y + 4} textAnchor="end">
          {tickWords(t)}
        </text>,
      );
    }
    // the days (or hours) under the points
    for (const k of ks) {
      const words = xLabels ? xLabels[k] : xLabel && g.labelled(k) ? xLabel(k) : "";
      if (!words) continue;
      parts.push(
        <text key={`x${k}`} x={g.x(k)} y={H - 6} textAnchor="middle">
          {words}
        </text>,
      );
    }
    // the points never kept
    const blankN = Math.min(blank, count);
    if (blankN > 0) {
      parts.push(<rect key="blank" x={g.ml} y={g.mt} width={g.band * blankN} height={g.ph} fill={COLORS.blank} />);
      if (g.band * blankN > 120) {
        parts.push(
          <text key="blank-t" x={g.ml + (g.band * blankN) / 2} y={g.mt + g.ph / 2 + 4} textAnchor="middle" className="blank-t">
            {BLANK_WORDS}
          </text>,
        );
      }
    }

    if (kind === "col" || kind === "stack") {
      for (const k of ks) {
        const x = g.x(k) - g.cw / 2;
        if (kind === "col") {
          const v = series[0].values[k];
          if (v == null) continue;
          const h = Math.max(v > 0 ? 1 : 0, (v / g.top) * g.ph);
          if (h > 0) parts.push(<path key={`c${k}`} d={colTop(x, g.mt + g.ph - h, g.cw, h, 4)} fill={series[0].color} />);
        } else {
          // the first series at the bottom, the second on it with a hair of a gap
          const a = series[0].values[k] ?? 0;
          const b = series[1]?.values[k] ?? 0;
          const ha = (a / g.top) * g.ph;
          const hb = (b / g.top) * g.ph;
          const gap = ha > 0 && hb > 3 ? 2 : 0;
          if (hb > 0) parts.push(<path key={`b${k}`} d={colTop(x, g.mt + g.ph - ha - hb, g.cw, Math.max(1, hb - gap), 4)} fill={series[1].color} />);
          if (ha > 0) parts.push(<path key={`a${k}`} d={colTop(x, g.mt + g.ph - ha, g.cw, ha, hb > 0 ? 0 : 4)} fill={series[0].color} />);
        }
      }
    } else {
      const ends: { name: string; x: number; y: number; early: boolean }[] = [];
      series.forEach((s, j) => {
        let d = "";
        let open = false;
        let first = -1;
        let last = -1;
        for (const k of ks) {
          const v = s.values[k];
          if (v == null) {
            open = false;
            continue;
          }
          d += `${open ? "L" : "M"}${g.x(k).toFixed(1)},${g.y(v).toFixed(1)}`;
          open = true;
          if (first < 0) first = k;
          last = k;
        }
        if (!d) return;
        if (s.area) parts.push(<path key={`area${j}`} d={`${d}L${g.x(last)},${g.mt + g.ph}L${g.x(first)},${g.mt + g.ph}Z`} fill={COLORS.band} />);
        parts.push(<path key={`l${j}`} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />);
        const v = s.values[last]!;
        parts.push(<circle key={`e${j}`} cx={g.x(last)} cy={g.y(v)} r={3} fill={s.color} />);
        ends.push({ name: s.name, x: g.x(last), y: g.y(v), early: last < count - 1 });
      });
      // two lines say which is which at their ends, apart from each other
      if (series.length > 1) {
        const right = ends.filter((e) => !e.early).sort((a, b) => a.y - b.y);
        for (let j = 1; j < right.length; j++) if (right[j].y - right[j - 1].y < 13) right[j].y = right[j - 1].y + 13;
        ends.forEach((e, j) =>
          parts.push(
            e.early ? (
              <text key={`n${j}`} x={e.x} y={e.y + 18} textAnchor="middle" className="end">
                {e.name}
              </text>
            ) : (
              <text key={`n${j}`} x={e.x + 7} y={e.y + 4} className="end">
                {e.name}
              </text>
            ),
          ),
        );
      }
      // the hovered hour or day: a line down, and a dot on each series
      if (shown !== null) {
        parts.push(<line key="cross" x1={g.x(shown)} x2={g.x(shown)} y1={g.mt} y2={g.mt + g.ph} stroke={COLORS.axis} strokeWidth={1} />);
        series.forEach((s, j) => {
          const v = s.values[shown];
          if (v != null) parts.push(<circle key={`d${j}`} cx={g.x(shown)} cy={g.y(v)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />);
        });
      }
    }
    drawing = parts;
  }

  const show = (k: number, x: number, y: number) => {
    setPoint(k);
    store?.show({ owner, x, y, title: title(k), rows: rows(k) });
  };
  const clear = () => {
    setPoint(null);
    store?.hide(owner);
  };
  const fromPointer = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || !geo) return;
    show(geo.at(e.clientX - r.left), e.clientX, e.clientY);
  };

  return (
    <div className="db-plot" ref={host}>
      {size && (
        <svg
          ref={svg}
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w} ${size.h}`}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape") return clear();
            if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !geo || !count) return;
            e.preventDefault();
            const from = shown ?? count;
            const k = Math.max(0, Math.min(count - 1, from + (e.key === "ArrowRight" ? 1 : -1)));
            const r = svg.current!.getBoundingClientRect();
            show(k, r.left + geo.x(k), r.top + geo.mt + 20);
          }}
          onBlur={clear}
        >
          {drawing}
          {geo && (
            <rect
              x={geo.ml}
              y={0}
              width={geo.pw}
              height={geo.mt + geo.ph}
              fill="transparent"
              onPointerMove={fromPointer}
              onPointerDown={fromPointer}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") clear();
              }}
            />
          )}
        </svg>
      )}
    </div>
  );
}

const noSubscribe = () => () => {};
