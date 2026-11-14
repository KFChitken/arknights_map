"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { padNo, type PassOnCard } from "@/lib/passes";
import { charOfCard, FullPass, MiniPass, picOfCard } from "./PassCard";

/**
 * The pass a player wears, on the right of their profile card (我的资料, TA 的资料, 触须之交; ../WornPass.tsx loads it
 * only for a card with one): small, and pressed, whole with its strap, leaning after the pointer. On a phone it comes
 * over the middle of the screen, ✕ or a tap beside it putting it away; on a computer beside the card where there is
 * room, 收起, a click elsewhere or the small one again putting it away. Escape does either, and leaves the card open.
 */
export default function ProfilePass({ pass, holder }: { pass: PassOnCard; holder: string }) {
  const [open, setOpen] = useState(false);
  const mini = useRef<HTMLButtonElement>(null);
  const name = characterName(pass.name);
  return (
    <>
      <button
        ref={mini}
        type="button"
        className="who-pass"
        aria-label={fmt(T.passes.card.open, { name })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MiniPass c={charOfCard(pass)} no={pass.no} fancy={pass.fancy} art={null} pic={picOfCard(pass)} color={pass.color} />
      </button>
      {open && (
        <Popped
          pass={pass}
          holder={holder}
          mini={mini}
          onClose={() => {
            setOpen(false);
            mini.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

/** How wide a pass pops up */
const W = 178;
/** From this wide, it pops up beside the card when there is room */
const BESIDE_FROM = 760;

function Popped({ pass, holder, mini, onClose }: { pass: PassOnCard; holder: string; mini: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const tall = pass.game === "ef";
  // undefined until measured (before it is painted); null: over the middle of the screen
  const [beside, setBeside] = useState<{ left: number; top: number } | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const shut = useRef(onClose);
  shut.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const card = mini.current?.closest(".sheet") ?? mini.current;
      if (!card || window.innerWidth < BESIDE_FROM) return setBeside(null);
      const r = card.getBoundingClientRect();
      const width = tall ? W * 0.644 : W;
      // the strap above it, the pass, and 收起 under it
      const height = W * (tall ? 0.56 : 0.64) + W * (380 / 236) + 48;
      const gap = 20;
      const left = r.right + gap + width + 12 <= window.innerWidth ? r.right + gap : r.left - gap - width >= 12 ? r.left - gap - width : null;
      if (left === null) return setBeside(null);
      setBeside({ left: Math.round(left), top: Math.round(Math.max(12, Math.min(r.top + 8, window.innerHeight - height - 12))) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [mini, tall]);

  // the keyboard on its button; Escape puts it away before the card hears it
  const shown = beside !== undefined;
  useEffect(() => {
    if (!shown) return;
    box.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      shut.current();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [shown]);
  // beside the card: a press anywhere else puts it away (the small one toggles it itself)
  useEffect(() => {
    if (!beside) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || mini.current?.contains(t)) return;
      shut.current();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [beside, mini]);

  if (beside === undefined) return null;
  const label = fmt(T.passes.pass.label, { name: characterName(pass.name), no: padNo(pass.no) });
  const whole = (
    <FullPass
      c={charOfCard(pass)}
      no={pass.no}
      fancy={pass.fancy}
      pic={picOfCard(pass)}
      color={pass.color}
      holder={holder}
      at={pass.drawnAt}
      w={W}
      hang
      tilt
      label={label}
    />
  );
  if (beside) {
    return createPortal(
      <div ref={box} className="pass-pop beside" role="dialog" aria-label={label} style={{ left: beside.left, top: beside.top }}>
        {whole}
        <button type="button" className="pp-close" onClick={onClose}>
          {T.passes.card.close}
        </button>
      </div>,
      document.body,
    );
  }
  // over the screen, the only thing to press is ✕
  const keep = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    box.current?.querySelector<HTMLElement>("button")?.focus();
  };
  return createPortal(
    <div
      ref={box}
      className="pass-pop over"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={keep}
      onClick={(e) => {
        if (!(e.target as Element).closest(".zp")) onClose();
      }}
    >
      <button type="button" className="pp-x" aria-label={T.passes.card.close}>
        ✕
      </button>
      {whole}
      <span className="pp-tip">{T.passes.card.tapAway}</span>
    </div>,
    document.body,
  );
}
