"use client";

/** A small flame (12 × 12 as drawn), of a fire's colour: by names on the board, and by those wearing 篝火守夜人 in rooms */
export default function SmallFlame({ color = "#ff8a3a", inner = "#ffd23f", size = 12, label }: { color?: string; inner?: string; size?: number; label?: string }) {
  return (
    <svg className="sq-flame" width={size} height={size} viewBox="0 0 12 12" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path
        d="M6 0.6 C7.6 2.8 10 4.2 9.7 7.2 C9.5 9.6 7.9 11.2 6 11.2 C4.1 11.2 2.4 9.6 2.3 7.4 C2.2 5.4 3.7 4.4 4.3 2.8 C4.7 3.9 5.2 4.1 5.5 3.6 C5.8 2.6 5.6 1.6 6 0.6 Z"
        fill={color}
        stroke="#1b1d22"
        strokeWidth="0.9"
      />
      <path d="M6 5.4 C6.9 6.6 7.8 7.4 7.6 8.6 C7.5 9.6 6.8 10.2 6 10.2 C5.2 10.2 4.5 9.6 4.4 8.7 C4.3 7.6 5.3 6.9 6 5.4 Z" fill={inner} />
    </svg>
  );
}
