"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Disco } from "@/components/disco/engine";
import { loadDisco, useDiscoRoomMode } from "@/lib/disco";
import type { LngLat } from "@/lib/types";
import type { Friend } from "@/lib/world/types";
import { useListenPlayer, useListenRoom } from "./listening";

const ListenStage = dynamic(() => import("./ListenStage"), { ssr: false });
const ListenFar = dynamic(() => import("./ListenFar"), { ssr: false });

const STILL = "(prefers-reduced-motion: reduce)";
const onStill = (changed: () => void) => {
  const m = window.matchMedia(STILL);
  m.addEventListener("change", changed);
  return () => m.removeEventListener("change", changed);
};
const stillNow = () => window.matchMedia(STILL).matches;

/**
 * 听歌's disco on the map (MapApp.tsx puts it in the map's box, where it is open to the player): its part of the page
 * fetched (src/lib/disco.ts) and started the first time it is wanted with a song going, then told what is wanted,
 * whether less motion is asked for and whether you are in 一起听 (the room's stage, ListenStage.tsx, dancing then in
 * place of the map's roaches, or 拉远 as picked, ListenFar.tsx, up while the ball and lights are), and to look again
 * whenever the player changes; gone at once with this. want: its switch on, and no 舟友的酒; onShown: its ball and
 * lights are out, or gone; main, friends: your main roach and your list of 触须之交, where 拉远 finds the room's;
 * onFar: 拉远 out, flying back or over (MapApp.tsx onDiscoFar)
 */
export default function DiscoHost({
  want,
  onShown,
  main,
  friends,
  onFar,
}: {
  want: boolean;
  onShown: (on: boolean) => void;
  main: LngLat | null;
  friends: Friend[];
  onFar: (state: "on" | "back" | "off") => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const disco = useRef<Disco | null>(null);
  const shownRef = useRef(onShown);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(false);
  const p = useListenPlayer();
  const room = useListenRoom();
  const inRoom = Boolean(room);
  const far = useDiscoRoomMode() === "far";
  const still = useSyncExternalStore(onStill, stillNow, () => false);
  const going = p.status === "playing" || p.status === "starting";

  useEffect(() => {
    shownRef.current = onShown;
  });

  useEffect(() => {
    if (!want || !going || started) return;
    let gone = false;
    loadDisco()
      .then((m) => {
        if (gone || disco.current || !host.current) return;
        disco.current = m.startDisco(host.current, {
          onShown: (on) => {
            setShown(on);
            shownRef.current(on);
          },
        });
        setStarted(true);
      })
      .catch((e: unknown) => {
        // not fetched (the network): tried again the next time it is wanted
        console.warn("disco:", e);
      });
    return () => {
      gone = true;
    };
  }, [want, going, started]);

  useEffect(() => {
    disco.current?.set({ want, still, crowd: !inRoom });
  }, [want, still, inRoom, started]);

  useEffect(() => {
    disco.current?.poke();
  }, [p]);

  useEffect(
    () => () => {
      disco.current?.destroy();
      disco.current = null;
    },
    [],
  );

  return (
    <>
      <div className="disco-host" ref={host} />
      {shown && room && !far && <ListenStage room={room} />}
      {shown && room && far && <ListenFar room={room} main={main} friends={friends} leaving={!want} onFar={onFar} />}
    </>
  );
}
