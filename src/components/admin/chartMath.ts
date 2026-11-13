/**
 * The arithmetic of 数据看板's charts (DashChart.tsx), kept apart so it can be tested: round numbers for the
 * axis, their short labels, where each point and column goes, and a column's rounded top.
 */

/** Round steps from 0 past `max`, about four of them; whole numbers, as everything counted is */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let i = 0; i * step < max + step - 1e-9; i++) out.push(Math.round(i * step));
  return out;
}

/** An axis label: 9,500, then 1万, 1.5万 */
export const tickWords = (v: number) => (v >= 10_000 ? `${+(v / 10_000).toFixed(1)}万` : Math.round(v).toLocaleString("en-US"));

/** A column from (x, y), w wide and h tall, its top corners rounded by r */
export function colTop(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

export type ChartKind = "col" | "stack" | "line";

/**
 * Where everything goes in a chart W × H with `count` points: the margins (room for the axis's labels on the left,
 * and for the lines' names on the right when there are two), the plot, each point's band, and the columns' width.
 * `stacked` is each point's total when the series stack, else the largest of any series.
 */
export function layout(W: number, H: number, count: number, kind: ChartKind, lines: number, stacked: number) {
  const ticks = niceTicks(stacked);
  const top = ticks[ticks.length - 1];
  const longest = Math.max(...ticks.map((t) => tickWords(t).length));
  const ml = Math.max(30, Math.round(longest * 6.6) + 10);
  const mr = kind === "line" && lines > 1 ? 40 : kind === "line" ? 10 : 4;
  const mt = 8;
  const mb = 22;
  const pw = Math.max(1, W - ml - mr);
  const ph = Math.max(1, H - mt - mb);
  const n = Math.max(1, count);
  const band = pw / n;
  return {
    ticks,
    top,
    ml,
    mr,
    mt,
    mb,
    pw,
    ph,
    band,
    /** A column's width: most of its band, never above 24 */
    cw: Math.max(2, Math.min(24, band - Math.max(2, band * 0.3))),
    x: (k: number) => ml + band * (k + 0.5),
    y: (v: number) => mt + ph - (v / top) * ph,
    /** The point under a place across the plot (from the chart's left edge), within the points */
    at: (px: number) => Math.max(0, Math.min(n - 1, Math.floor((px - ml) / band))),
    /** Which points get a day under them: as many as fit 34px apart, counted back from the last */
    labelled: (k: number) => (n - 1 - k) % Math.max(1, Math.ceil(34 / band)) === 0,
  };
}

/** The highest a chart has to reach: each point's series added up when they stack, else the largest of any */
export function highest(kind: ChartKind, series: { values: (number | null)[] }[]) {
  let max = 0;
  const count = series[0]?.values.length ?? 0;
  for (let k = 0; k < count; k++) {
    if (kind === "stack") max = Math.max(max, series.reduce((s, x) => s + (x.values[k] ?? 0), 0));
    else for (const s of series) max = Math.max(max, s.values[k] ?? 0);
  }
  return max;
}
