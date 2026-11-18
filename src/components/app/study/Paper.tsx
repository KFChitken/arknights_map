import type { Sheet } from "@/lib/study/board";
import { WRITE_DIGITS } from "@/lib/study/write325";

/** The copybook's frame and cross, and the ink, as 徒手写 draws them (Write325.tsx) */
const GRID = "#e8a29a";
const INK = "#1b1d22";
/** The ink's width, in thousandths of a square: the brush's own (Write325.tsx BRUSH.w), all one width here */
const INK_W = 66;
/** The gap between two squares, in thousandths of a square */
const GAP = 80;
/** The three squares and the gaps between them, across, in thousandths of a square */
const ACROSS = WRITE_DIGITS.length * 1000 + (WRITE_DIGITS.length - 1) * GAP;

/** A flat stroke's points as an SVG polyline takes them */
const pointsOf = (s: readonly number[]) => {
  const out: string[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push(`${s[i]},${s[i + 1]}`);
  return out.join(" ");
};

/**
 * A paper of 徒手写 as the 手写榜 keeps it (src/lib/study/board.ts Sheet): its three copybook squares side by side,
 * the strokes all one width and cut off at each square's edge. `size`: each square that many px across; without it, the
 * three as wide as the box they are in. Drawn whole with nothing but SVG, so the 管理台 shows it as the board does,
 * without the board's styles.
 */
export default function Paper({ sheet, size, label, className }: { sheet: Sheet; size?: number; label: string; className?: string }) {
  return (
    <svg
      className={className}
      role="img"
      aria-label={label}
      viewBox={`0 0 ${ACROSS} 1000`}
      style={{ display: "block", flex: "none", width: size ? Math.round((size * ACROSS) / 1000) : "100%", maxWidth: "100%", height: "auto", aspectRatio: `${ACROSS} / 1000` }}
    >
      {WRITE_DIGITS.map((d, i) => (
        // a square of its own, whose strokes it cuts off at its edge
        <svg key={d} x={i * (1000 + GAP)} y={0} width={1000} height={1000} viewBox="0 0 1000 1000" overflow="hidden">
          <rect width="1000" height="1000" fill="#ffffff" />
          <rect x="10" y="10" width="980" height="980" fill="none" stroke={GRID} strokeWidth="20" />
          <path d="M500 0V1000M0 500H1000" fill="none" stroke={GRID} strokeWidth="12" strokeDasharray="35 30" />
          {(sheet[i] ?? []).map((s, j) =>
            s.length === 2 ? (
              <circle key={j} cx={s[0]} cy={s[1]} r={INK_W / 2} fill={INK} />
            ) : (
              <polyline key={j} points={pointsOf(s)} fill="none" stroke={INK} strokeWidth={INK_W} strokeLinecap="round" strokeLinejoin="round" />
            ),
          )}
        </svg>
      ))}
    </svg>
  );
}
