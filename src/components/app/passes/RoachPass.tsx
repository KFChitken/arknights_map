"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { artBoxVars, passArtUrl } from "@/lib/passArt";
import type { RoachPass } from "@/lib/passes";
import { passesApi } from "@/lib/passesClient";
import { setPassFolded, usePassFolded } from "@/lib/passFold";
import { useLeanArt } from "@/lib/passLean";
import { SI_ID } from "@/lib/si";
import type { PublicRoach } from "@/lib/world/types";
import "./roachPass.css";

/**
 * The pass the owner of a main roach wears, on the roach's card on the map (RoachPass, GET /api/passes/roach): hung
 * whole over the card (RoachPassHang.tsx, fetched only for a card with one, as most have none), printed with its
 * number, day and gold but nobody's name; folded by whoever looks (src/lib/passFold.ts), and where the window has no
 * room for it, the 立绘 peeking out of the card's top right, behind what the card says, and 「通行证 · 能天使」 on the
 * card's edge, which hangs it out again. To save data (src/lib/passLean.ts), the hung pass is its blur, and the peek
 * the glow and the name alone, as it is where there is no 立绘: a blur standing free over the map would be a smudge,
 * not a picture.
 */

const RoachPassHang = dynamic(() => import("./RoachPassHang"), { ssr: false });

/** How long what a roach's card was told is kept on this page before it asks again (the server keeps it as long) */
const KEEP_MS = 60_000;
const kept = new Map<string, { at: number; pass: RoachPass | null }>();
const asking = new Map<string, Promise<void>>();

/** For tests: as a fresh page */
export function forgetRoachPassesHere() {
  kept.clear();
  asking.clear();
}

/**
 * Ask for the pass on a roach's card, by its id in the feed, unless this page heard it within KEEP_MS; one ask at a
 * time for each roach. One that could not be had is asked again the next time.
 */
export function askRoachPass(id: string, now = Date.now()): Promise<void> {
  const hit = kept.get(id);
  if (hit && now - hit.at < KEEP_MS) return Promise.resolve();
  let ask = asking.get(id);
  if (!ask) {
    ask = passesApi
      .roach(id)
      .then(
        ({ pass }) => void kept.set(id, { at: Date.now(), pass }),
        // the card is the same without it
        () => {},
      )
      .finally(() => asking.delete(id));
    asking.set(id, ask);
  }
  return ask;
}

/** What this page last heard of the pass on a roach's card (null: none to show, or nothing heard yet) */
export const heardRoachPass = (id: string): RoachPass | null => kept.get(id)?.pass ?? null;

/**
 * Which roach's card to ask a pass for (useRoachPass): another player's main roach, and only by a player 寻访 is open
 * to (me.passes; while PASSES is admins, the 站长 and the admins), so nobody else asks, or sees a thing. Never a
 * clone, a guide, 祀 or a demo roach, which the server answers null anyway.
 */
export function passCardRoach(open: boolean, roach: Pick<PublicRoach, "id" | "clone" | "guide" | "bot"> | null | undefined): string | null {
  return open && roach && !roach.clone && !roach.guide && !roach.bot && roach.id !== SI_ID ? roach.id : null;
}

/**
 * The pass on this roach's card, asked for as it opens (askRoachPass); id null asks nothing (not a stranger's main
 * roach, or 寻访 not open to the player)
 */
export function useRoachPass(id: string | null): RoachPass | null {
  const [, heard] = useState(0);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void askRoachPass(id).then(() => live && heard((n) => n + 1));
    return () => {
      live = false;
    };
  }, [id]);
  return id ? heardRoachPass(id) : null;
}

/**
 * How a pass hangs over a roach's card (hangFor): w wide (a 长条挂牌 0.644 of it), beside the card on its right, or
 * over its top right
 */
export type Hang = { w: number; beside: boolean };

/** Above this, the bars along the top of the map stay clear of a hung pass */
const TOP_CLEAR = 140;

/**
 * Where a pass hangs, for a card at r in a window vw wide: beside the card, its foot a little above the card's (收起
 * under it), where the window has room for one 150 to 178 wide (as one popped up from a profile card); else over the
 * card's top right, 116 wide, or three tenths of a phone's screen, as on the design; else, with no room for that
 * either, nowhere (the peek shows). tall: a 长条挂牌, 0.644 as wide.
 */
export function hangFor(r: { top: number; right: number; bottom: number }, vw: number, tall: boolean): Hang | null {
  // the strap or clip above the pass, and the pass, for each of its width
  const per = (tall ? 0.56 : 0.64) + 380 / 236;
  const wide = tall ? 0.644 : 1;
  const beside = Math.floor(Math.min(178, (vw - r.right - 18 - 12) / wide, (r.bottom - 28 - TOP_CLEAR) / per));
  if (beside >= 150) return { w: beside, beside: true };
  const over = Math.floor(Math.min(116, vw * 0.3, (r.top - 8 - TOP_CLEAR) / per));
  return over >= 84 ? { w: over, beside: false } : null;
}

const same = (a: Hang | null | undefined, b: Hang | null) => a === b || (a != null && b !== null && a.w === b.w && a.beside === b.beside);

/** Where the pass hangs over the card the anchor is in, as it is laid out now; undefined until it is measured */
function useHang(at: RefObject<HTMLElement | null>, tall: boolean): Hang | null | undefined {
  const [hang, setHang] = useState<Hang | null | undefined>(undefined);
  useLayoutEffect(() => {
    const card = at.current?.closest<HTMLElement>(".card");
    if (!card) return setHang(null);
    const place = () => {
      const next = hangFor(card.getBoundingClientRect(), window.innerWidth, tall);
      setHang((was) => (same(was, next) ? was : next));
    };
    place();
    // the card grows and shrinks with what it says, its foot staying where it is
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watch?.observe(card);
    window.addEventListener("resize", place);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [at, tall]);
  return hang;
}

/**
 * The pass on another player's main roach's card: hung out, unless folded on this device or there is no room for it;
 * peeking out of the card until it is measured. Whichever was pressed to switch, the other takes the keyboard after it.
 */
export function RoachPassOn({ pass }: { pass: RoachPass }) {
  const at = useRef<HTMLElement>(null);
  const hang = useHang(at, pass.game === "ef");
  const folded = usePassFolded();
  const [pressed, setPressed] = useState(false);
  const fold = (on: boolean) => {
    setPressed(true);
    setPassFolded(on);
  };
  return (
    <>
      <i ref={at} className="rp-at" hidden />
      {hang && !folded ? (
        <RoachPassHang pass={pass} hang={hang} focus={pressed} onFold={() => fold(true)} />
      ) : (
        <RoachPassPeek pass={pass} focus={pressed} onUnfold={hang ? () => fold(false) : undefined} />
      )}
    </>
  );
}

/** The 立绘 peeking out of the card; onUnfold: its tag a button hanging the pass out (focus: taking the keyboard) */
export function RoachPassPeek({ pass, onUnfold, focus }: { pass: RoachPass; onUnfold?: () => void; focus?: boolean }) {
  const lean = useLeanArt();
  // the picture rises into view once it is here, not bit by bit
  const [shown, setShown] = useState<string | null>(null);
  const file = lean ? null : pass.art;
  const unfold = useRef<HTMLButtonElement>(null);
  const tag = fmt(T.passes.onMap.tag, { name: characterName(pass.name) });
  useEffect(() => {
    if (focus) unfold.current?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <>
      <i className="rp-glow" style={{ "--pc": pass.color } as CSSProperties} aria-hidden="true" />
      {file && (
        <span className={`rp-art${shown === file ? " in" : ""}`} style={artBoxVars(pass.frame?.p)} aria-hidden="true">
          <picture>
            <source type="image/avif" srcSet={passArtUrl(file, "big", "avif")} />
            <img src={passArtUrl(file, "big")} alt="" decoding="async" draggable={false} onLoad={() => setShown(file)} />
          </picture>
        </span>
      )}
      {onUnfold ? (
        <button ref={unfold} type="button" className="rp-tag" aria-label={fmt(T.passes.onMap.unfold, { name: characterName(pass.name) })} onClick={onUnfold}>
          {tag}
        </button>
      ) : (
        <span className="rp-tag">{tag}</span>
      )}
    </>
  );
}
