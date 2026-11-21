"use client";

/** A small tower of three blocks on a plank (12 × 12 as drawn): by names on 基建周榜, and by those wearing 基建狂魔 in rooms */
export default function SmallTower({ size = 12, label }: { size?: number; label?: string }) {
  return (
    <svg className="sq-tower" width={size} height={size} viewBox="0 0 12 12" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="3.2" y="0.8" width="6" height="3" rx="1.4" fill="#9b72e8" stroke="#1b1d22" strokeWidth="0.8" />
      <rect x="1.8" y="4.2" width="6.6" height="3" rx="1.4" fill="#6a3fc0" stroke="#1b1d22" strokeWidth="0.8" />
      <rect x="2.8" y="7.6" width="6.6" height="3" rx="1.4" fill="#9b72e8" stroke="#1b1d22" strokeWidth="0.8" />
      <rect x="0.8" y="10.6" width="10.4" height="1.2" rx="0.5" fill="#8a6b45" />
    </svg>
  );
}
