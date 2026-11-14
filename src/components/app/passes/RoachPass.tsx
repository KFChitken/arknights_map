"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { passArtUrl } from "@/lib/passArt";
import type { RoachPass } from "@/lib/passes";
import { passesApi } from "@/lib/passesClient";
import { useLeanArt } from "@/lib/passLean";
import { SI_ID } from "@/lib/si";
import type { PublicRoach } from "@/lib/world/types";
import "./roachPass.css";

/**
 * The pass the owner of a main roach wears, on the roach's card on the map (RoachPass, GET /api/passes/roach): the
 * 立绘 peeking out of the card's top right, behind what the card says, and 「通行证 · 能天使」 on the card's edge. No
 * number, nothing gold. To save data (src/lib/passLean.ts), and where there is no 立绘, the glow and the name alone:
 * a blur standing free over the map would be a smudge, not a picture.
 */

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

export function RoachPassPeek({ pass }: { pass: RoachPass }) {
  const lean = useLeanArt();
  // the picture rises into view once it is here, not bit by bit
  const [shown, setShown] = useState<string | null>(null);
  const file = lean ? null : pass.art;
  return (
    <>
      <i className="rp-glow" style={{ "--pc": pass.color } as CSSProperties} aria-hidden="true" />
      {file && (
        <span className={`rp-art${shown === file ? " in" : ""}`} aria-hidden="true">
          <picture>
            <source type="image/avif" srcSet={passArtUrl(file, "big", "avif")} />
            <img src={passArtUrl(file, "big")} alt="" decoding="async" draggable={false} onLoad={() => setShown(file)} />
          </picture>
        </span>
      )}
      <span className="rp-tag">{fmt(T.passes.onMap.tag, { name: characterName(pass.name) })}</span>
    </>
  );
}
