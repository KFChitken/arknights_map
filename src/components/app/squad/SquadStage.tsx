"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SCENE_EGGS, type SquadRoom } from "@/lib/squad";
import { ROACH_AVATARS, type RoachAvatar, type RoachColor } from "@/lib/types";
import { T } from "@/i18n";
import { makeScene, type FightMember, type SceneApi } from "./scene";
import { openSquadTalk, setSquadSceneShows, useSquadLines, useSquadRoom, useSquadSceneOn } from "./squading";
import "./scene/squadScene.css";

/**
 * The fight on the map while the player's room plays (step 5): the map dimmed, and in the middle of what it shows
 * (between the page's top and the bar of the round on a phone; left of the bar's column on a computer) the room's
 * four fight monsters, in the version the round picks (scene/). Lines said come out of the roaches there; your own
 * roach opens 说话 / 动作 / 这局. 看地图 on the bar puts it away on this device. As the round ends, what is left
 * breaks and it fades; the room gone (销毁, asked out, left), it goes at once. Nothing here is sent anywhere.
 */

/** How long the end of a round shows before the fight fades, and the fade */
const END_MS = 1_200;
const FADE_MS = 450;

const lookOf = (avatar: string): RoachAvatar => (ROACH_AVATARS.includes(avatar as RoachAvatar) ? (avatar as RoachAvatar) : "hood");
const fighters = (room: SquadRoom): FightMember[] =>
  room.members.map((m) => ({ h: m.h, name: m.name, you: m.you, friend: m.friend, look: lookOf(m.avatar), color: m.color as RoachColor, pose: m.pose }));

/** The stage's box: within what the map shows, clear of the page's top, its bottom bar and the bar of the round */
function useBox(shown: boolean) {
  const [box, setBox] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!shown) return;
    let last = "";
    const look = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      // below the page's top bar and what hangs under it (the counts, a notice: .hud)
      const top = Math.max(...[...document.querySelectorAll("[data-chrome-top], .hud > *")].map((e) => e.getBoundingClientRect()).filter((r) => r.height && r.top < H / 3).map((r) => r.bottom), 60) + 10;
      const low = [...document.querySelectorAll("[data-chrome-bottom]")].map((e) => e.getBoundingClientRect()).filter((r) => r.height && r.top > H / 2);
      const bottomBar = low.length ? Math.min(...low.map((r) => r.top)) : H - 10;
      const bar = document.querySelector(".sq-fight")?.getBoundingClientRect();
      const wide = Boolean(bar && bar.height > bar.width);
      const bottom = Math.round(H - (wide || !bar?.height ? bottomBar : bar.top) + 10);
      // on a computer, clear of the buttons down the sides (data-chrome-side) within its height; a phone has no room
      // to spare, and the monsters come in from behind them
      let left = wide ? 16 : 8;
      let right = wide ? Math.round(W - bar!.left + 16) : 8;
      for (const e of wide ? document.querySelectorAll("[data-chrome-side]") : []) {
        const r = e.getBoundingClientRect();
        if (!r.width || r.right <= 0 || r.left >= W || r.bottom <= top || r.top >= H - bottom) continue;
        if (r.left + r.width / 2 < W / 2) left = Math.max(left, Math.round(r.right + 6));
        else right = Math.max(right, Math.round(W - r.left + 6));
      }
      const next: CSSProperties = { left, right, top, bottom };
      const k = JSON.stringify(next);
      if (k === last) return;
      last = k;
      setBox(next);
    };
    look();
    const t = window.setInterval(look, 1_000);
    window.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
    };
  }, [shown]);
  return box;
}

export default function SquadStage({ hidden }: { hidden: boolean }) {
  const room = useSquadRoom();
  const on = useSquadSceneOn();
  const lines = useSquadLines();
  // the round on the stage (its room and start), kept a moment after it ends for its last scene
  const [round, setRound] = useState<{ id: string; wentAt: number } | null>(null);
  const [ending, setEnding] = useState(false);
  const [fading, setFading] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneApi | null>(null);
  const members = useRef<FightMember[]>([]);
  const heard = useRef(new Set<number>());
  members.current = room ? fighters(room) : members.current;
  const playing = Boolean(room && room.state === "go" && room.wentAt !== null);

  // a round starts, ends, or the room is gone
  const roundKey = playing ? `${room!.id}:${room!.wentAt}` : null;
  const roomGone = !room;
  useEffect(() => {
    if (roundKey) {
      const [id, at] = [roundKey.slice(0, roundKey.lastIndexOf(":")), Number(roundKey.slice(roundKey.lastIndexOf(":") + 1))];
      setRound((r) => (r && r.id === id && r.wentAt === at ? r : { id, wentAt: at }));
      setEnding(false);
      setFading(false);
      return;
    }
    if (roomGone) {
      setRound(null);
      return;
    }
    // waiting again: the round's end, then a fade, then nothing
    setEnding(true);
  }, [roundKey, roomGone]);
  useEffect(() => {
    if (!ending) return;
    if (!scene.current) {
      // nothing on the stage to end
      setRound(null);
      setEnding(false);
      return;
    }
    scene.current.end();
    const a = window.setTimeout(() => setFading(true), END_MS);
    const b = window.setTimeout(() => {
      setRound(null);
      setEnding(false);
      setFading(false);
    }, END_MS + FADE_MS);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [ending]);

  // kept as it is while the round's end plays out (the bar going away would move it)
  const box = useBox(Boolean(round) && !ending);
  const boxReady = Boolean(box);
  // the fight itself, made once a round (and once the stage has its box)
  useEffect(() => {
    const el = stage.current;
    if (!round || !el || !boxReady) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wide = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 900px)").matches;
    const s = makeScene(el, { members: () => members.current, onMe: openSquadTalk, reduce, max: wide ? 5 : 4 }, round.id, round.wentAt);
    scene.current = s;
    // only lines said from now on come out of its roaches
    heard.current = new Set();
    return () => {
      s.destroy();
      scene.current = null;
      el.replaceChildren();
    };
  }, [round, boxReady]);
  // who is in it and how they stand
  useEffect(() => {
    scene.current?.sync();
  }, [room]);
  // on or off: 看地图, a panel over it, or fading out
  const off = !on || hidden || fading;
  useEffect(() => {
    scene.current?.setOff(off);
  }, [off, round, boxReady]);
  // lines come out of the roaches while it shows; the bar's tiles take them otherwise
  const shows = Boolean(round) && !ending && on && !hidden;
  useEffect(() => {
    setSquadSceneShows(shows);
    return () => setSquadSceneShows(false);
  }, [shows]);
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const fresh = lines.filter((l) => !heard.current.has(l.key));
    for (const l of fresh) {
      heard.current.add(l.key);
      // lines from before the fight was made (its first look) only mark what was heard
      if (Date.now() - l.at > 2_000) continue;
      s.say(l.h, T.squad.say.lines[l.p - 1] ?? "", SCENE_EGGS[l.p]);
    }
  }, [lines, round, boxReady]);

  if (!round || !box) return null;
  return (
    <>
      <div className={`sq-dim${off ? " off" : ""}`} aria-hidden="true" />
      <div ref={stage} className={`sq-stage${off ? " off" : ""}`} style={box} aria-hidden="true" />
    </>
  );
}
