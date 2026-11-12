"use client";

import type { ReactNode } from "react";
import type { CaseLevel } from "@/lib/safety";
import type { RoachColor } from "@/lib/types";
import { markOf, type Fact } from "./words";

/** Small pieces every page of the 管理台 uses, styled in console.css */

export const LEVELS: Record<CaseLevel | "appeal", { name: string; cls: string }> = {
  red: { name: "红", cls: "red" },
  yellow: { name: "黄", cls: "yellow" },
  green: { name: "绿", cls: "green" },
  appeal: { name: "申诉", cls: "appeal" },
};

export function LevelTag({ level }: { level: CaseLevel | "appeal" }) {
  return <span className={`ac-level ${LEVELS[level].cls}`}>{LEVELS[level].name}</span>;
}

/** A mark beside a name: plain, a warning (red) or something waiting (yellow) */
export function Tag({ kind = "plain", children }: { kind?: "plain" | "warn" | "open"; children: ReactNode }) {
  return <span className={`ac-tag ${kind}`}>{children}</span>;
}

/** A player's round mark: the first character of their name on their roach's colour */
export function Mark({ name, color, size = 48 }: { name: string; color?: RoachColor; size?: number }) {
  const m = markOf(name, color);
  return (
    <span className="ac-mark" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: m.color }}>
      {m.initial}
    </span>
  );
}

export function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className="ac-facts">
      {facts.map((f, i) => (
        <div key={`${f.k}-${i}`}>
          <dt>{f.k}</dt>
          <dd className={f.warn ? "warn" : undefined}>{f.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Six digits from the authenticator: big, numeric on phones, filled in from a text message on iPhone */
export function CodeInput({
  value,
  onChange,
  id,
  big = false,
  disabled = false,
  invalid = false,
  autoFocus = false,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  big?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      id={id}
      className={`ac-code${big ? " big" : ""}${invalid ? " invalid" : ""}`}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      placeholder="000000"
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/** The 管理台's brand mark: a blue square with 「舟」 */
export function BrandMark() {
  return (
    <span className="ac-brand-mark" aria-hidden="true">
      舟
    </span>
  );
}

/** A panel's own header: its name, and who it is for */
export function PanelHead({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="ac-panel-head">
      <h2>{title}</h2>
      {aside && <span className="ac-muted">{aside}</span>}
    </div>
  );
}

export function Empty({ children, done = false }: { children: ReactNode; done?: boolean }) {
  return (
    <div className="ac-empty">
      {done && (
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1E6B34" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
      )}
      <p>{children}</p>
    </div>
  );
}

/** Icons of the menu and the top bar, drawn as in the design */
export const ICONS = {
  cases: (
    <>
      <path d="M4 4h16v10h-4l-2 3h-4l-2-3H4z" />
      <path d="M4 14v6h16v-6" />
    </>
  ),
  accounts: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  site: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  log: (
    <>
      <path d="M8 3h8v4H8z" />
      <path d="M8 5H5v16h14V5h-3" />
      <path d="M8 11h8" />
      <path d="M8 15h8" />
      <path d="M8 19h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  map: (
    <>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </>
  ),
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}
