"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { offerRoomStage, type StageDancer } from "@/components/map/discoStage";
import { fmt, T } from "@/i18n";
import type { ListenRoom } from "@/lib/listen";
import { shownAvatar } from "@/lib/roachSvg";
import RoachIcon from "../RoachIcon";
import { useSpot } from "./listenSpot";
import "./listenStage.css";

/** On the stage at most (as many as a room holds), and in a row before a second one */
const MOST = 20;
const ROW = 10;
/** A roach there as big as fits, BIG at most and SMALL at least; its name no wider than NAME */
const BIG = 46;
const SMALL = 24;
const NAME = 64;
/** Between the roaches, and inside the stage's floor at each side (listenStage.css) */
const GAP = 6;
const PAD = 12;
/** The floor no wider than this much of the part of the screen it stands in */
const WIDE = 0.92;
/** Over what it stands on (listenSpot.ts) */
const OVER = 10;

/** Each roach's own part of the dance (choreo.ts danceTraits), from its number in the room */
const seedOf = (h: number) => Math.imul(h + 1, 0x9e3779b1) >>> 0;

/**
 * 一起听's stage, while 听歌's disco is out in a room (DiscoHost.tsx): the roaches of those in it in a row over the bottom
 * of the map (a second row past ROW), its host first, each in their own look with the name the room shows under it
 * (你 for yours), and 舞台 · 这场 n 人一起跳 over them. The disco (src/components/disco/engine.ts) fades it in and out with
 * its lights and dances them on the song's beat, every other one with its sleeves up, while the map's own roaches
 * stand; it finds them through what this offers (discoStage.ts offerRoomStage). Takes no taps, and says nothing to a
 * screen reader: the room's people are in the player.
 */
export default function ListenStage({ room }: { room: ListenRoom }) {
  const spot = useSpot();
  const el = useRef<HTMLDivElement>(null);
  const dancers = useRef<StageDancer[]>([]);
  const people = room.members
    .filter((m) => m.state === "in")
    .sort((a, b) => Number(b.host) - Number(a.host) || a.h - b.h)
    .slice(0, MOST);
  const cols = Math.max(1, people.length > ROW ? Math.ceil(people.length / 2) : people.length);
  // each roach's column as wide as fits, its name no wider than NAME; the roach no wider than its column
  const fits = spot ? Math.floor((spot.width * WIDE - PAD * 2 - GAP * (cols - 1)) / cols) : NAME;
  const col = Math.max(SMALL, Math.min(NAME, fits));
  const size = Math.max(SMALL, Math.min(BIG, col));

  // the roaches as the disco finds them, after each change
  useLayoutEffect(() => {
    const root = el.current;
    dancers.current = root
      ? [...root.querySelectorAll<HTMLElement>(".ls-fig")].map((f, i) => ({
          el: f,
          seed: Number(f.dataset.seed) || 0,
          size,
          sleeves: f.dataset.sleeves === "1",
          alt: i % 2 === 1,
        }))
      : [];
  });
  useEffect(() => {
    const root = el.current;
    if (!root) return;
    return offerRoomStage({ el: root, dancers: () => dancers.current });
  }, []);

  const style: CSSProperties = spot
    ? { bottom: spot.bottom + OVER, left: spot.left, width: spot.width }
    : { visibility: "hidden", bottom: 0, left: 0, right: 0 };
  return (
    <div ref={el} className="ls-stage" style={style} aria-hidden="true">
      <span className="ls-lbl">{fmt(T.listen.stage.label, { n: people.length })}</span>
      <div className="ls-floor" style={{ "--ls-cols": cols, "--ls-col": `${col}px`, "--ls-size": `${size}px` } as CSSProperties}>
        {people.map((m) => {
          const mine = m.h === room.you;
          // the hood has a copy with its sleeves up; the other looks dance as they are
          const sleeves = shownAvatar({ avatar: m.card.avatar }) === "hood";
          return (
            <span key={m.h} className="ls-d">
              <span className="ls-fig" data-seed={seedOf(m.h)} data-sleeves={sleeves ? "1" : "0"}>
                <RoachIcon color={m.card.color} size={size} avatar={m.card.avatar} mine={mine} friend={m.friend} />
                {sleeves && <RoachIcon color={m.card.color} size={size} avatar={m.card.avatar} mine={mine} friend={m.friend} hands />}
              </span>
              <b>{mine ? T.listen.stage.you : m.card.displayName}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}
