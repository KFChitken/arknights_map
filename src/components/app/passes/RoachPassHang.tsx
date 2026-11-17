"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { padNo, type RoachPass } from "@/lib/passes";
import { charOfCard, FullPass, picOfCard } from "./PassCard";
import type { Hang } from "./RoachPass";

/**
 * The pass the owner of a main roach wears, hung whole over the roach's card on the map (RoachPass.tsx RoachPassOn,
 * which fetches this only for a card with one): on its strap or clip, swinging in as it comes unless the player asked
 * for less motion, printed with its number, day and any gold, and —— for its holder, as the map names nobody. 收起
 * folds it back to the 立绘 peeking out of the card (focus: 收起 taking the keyboard as it comes).
 */
export default function RoachPassHang({ pass, hang, onFold, focus }: { pass: RoachPass; hang: Hang; onFold: () => void; focus?: boolean }) {
  const fold = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) fold.current?.focus({ preventScroll: true });
  }, [focus]);
  const name = characterName(pass.name);
  const where = hang.beside ? " beside" : "";
  // how wide it shows, for 收起 to stand beside it
  const shows = Math.round(hang.w * (pass.game === "ef" ? 0.644 : 1));
  return (
    <>
      {/* a pass of its own swings in afresh */}
      <div key={`${pass.charId}:${pass.no}`} className={`rp-hang${where}`}>
        <FullPass
          c={charOfCard(pass)}
          no={pass.no}
          fancy={pass.fancy}
          pic={picOfCard(pass)}
          color={pass.color}
          holder=""
          anon
          at={pass.drawnAt}
          w={hang.w}
          hang
          label={fmt(T.passes.pass.label, { name, no: padNo(pass.no) })}
        />
      </div>
      <button
        ref={fold}
        type="button"
        className={`rp-fold${where}`}
        style={{ "--hw": `${shows}px` } as CSSProperties}
        aria-label={T.passes.onMap.foldLabel}
        onClick={onFold}
      >
        {T.passes.onMap.fold}
      </button>
    </>
  );
}
