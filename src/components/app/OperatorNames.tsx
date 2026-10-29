"use client";
/* eslint-disable @next/next/no-img-element -- small WebP files from our own server, which next/image would only copy */

import { useEffect, useState } from "react";
import type { Game } from "@/lib/games";

/**
 * Character names with their small round pictures. Which characters have one
 * comes from the server once per page; with none (a collaboration character,
 * one not downloaded yet, or pictures switched off) the name's first character
 * stands in.
 */

export type Art = Record<Game, Record<string, string>>;
const NONE: Art = { arknights: {}, endfield: {} };
let pending: Promise<Art> | null = null;

export function useOperatorArt() {
  const [art, setArt] = useState<Art | null>(null);
  useEffect(() => {
    let live = true;
    pending ??= fetch("/api/operator-art")
      .then((res) => (res.ok ? (res.json() as Promise<Art>) : NONE))
      .catch(() => NONE);
    pending.then((a) => live && setArt(a));
    return () => {
      live = false;
    };
  }, []);
  return art;
}

/** A character's small round picture, or the first character of their name where there is none. */
export function OperatorPic({ game, name, art }: { game: Game; name: string; art: Art | null }) {
  const file = art?.[game]?.[name];
  if (file) return <img className="op-pic" src={`/operator-art/${file}`} alt="" width={22} height={22} loading="lazy" />;
  return (
    // empty while the list is on its way, so a picture does not replace a letter a moment later
    <span className="op-pic op-initial" aria-hidden="true">
      {art ? [...name][0] : ""}
    </span>
  );
}

export default function OperatorNames({ game, names }: { game: Game; names: string[] }) {
  const art = useOperatorArt();
  return (
    <span className="op-list">
      {names.map((name) => (
        <span key={name} className="op">
          <OperatorPic game={game} name={name} art={art} />
          {name}
        </span>
      ))}
    </span>
  );
}
