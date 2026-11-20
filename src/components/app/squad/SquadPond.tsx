"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { fmt, T } from "@/i18n";
import { POND_PROTECT } from "@/lib/fish/rules";
import { serverName } from "@/lib/games";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl } from "@/lib/roachSvg";
import { BUBBLE_MS, CORES, type SquadMember } from "@/lib/squad";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { PondFlag, PondSeat } from "../fish/PondScene";
import { closeSquadPond, lineWords, useSquadFloats, useSquadLines, useSquadPondOpen, useSquadRoom } from "./squading";
import { squadDing, useSquadMuted } from "./squadSound";

const Fish = dynamic(() => import("../fish/Fish"), { ssr: false });

/**
 * 卫戍池塘, the room's own pond (钓鳞's page with the pond in place of the bank; 「玩」 → 钓鳞 opens it, in the room's
 * sheet and the computer's bar panel): the room's others round it (who fishes, 爆护, what they just said, 人机 sitting),
 * a flag on the wall for each core alliance picked, the fight's glow past it while a round plays, a 鱼群 with its time
 * left; this 局's 鳞 and how far to 爆护 in the panel; 咕咚 out loud at the bite (the sound of 🔔), the player likely in
 * the game. Out of the room, it goes.
 */

/** Each core alliance's flag: a colour of its own, the first character of its name */
const FLAG: Record<number, [string, string]> = {
  1: ["#b3312a", "#f4c040"],
  2: ["#c08a3a", "#fff1d0"],
  3: ["#273e72", "#e8c66a"],
  4: ["#e9eef3", "#2c5a8a"],
  5: ["#1f5f74", "#bfe6f0"],
  6: ["#38383e", "#d9b36a"],
  7: ["#8a2b3a", "#f0e0c0"],
  8: ["#5a1f1f", "#e8d0a0"],
  9: ["#2f3a4a", "#d8c8a0"],
  10: ["#3d2a5a", "#e0c8f0"],
};

/** The roaches as pictures, by number in the room, as RoachIcon draws them */
function useRoachPics(members: readonly SquadMember[]) {
  const key = JSON.stringify(members.map((m) => [m.h, m.color, m.avatar]));
  const [pics, setPics] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let live = true;
    const next = new Map<number, string>();
    void Promise.all(
      members.map(async (m) => {
        const opts = { avatar: m.avatar as RoachAvatar };
        next.set(m.h, usesPicture(opts) ? await roachIconUrl(m.color as RoachColor, opts, 112) : roachDataUrl(m.color as RoachColor, opts));
      }),
    ).then(() => live && setPics(next));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return pics;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function SquadPond({
  look,
  holder,
  onRefused,
  onPasses,
}: {
  look: { color: string; avatar: string; style?: RoachStyle };
  /** The name printed on the player's passes (a 漂流瓶's) */
  holder: string;
  onRefused: (e: unknown) => void;
  /** A 寻访券 went into the wallet */
  onPasses: (p: { tickets: number; dot: boolean }) => void;
}) {
  const open = useSquadPondOpen();
  const room = useSquadRoom();
  const lines = useSquadLines();
  const floats = useSquadFloats();
  const muted = useSquadMuted();
  const others = useMemo(() => room?.members.filter((m) => !m.you) ?? [], [room]);
  const pics = useRoachPics(others);
  const [now, setNow] = useState(() => Date.now());
  // a clock for the 鱼群's time left and the words just said
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [open]);
  if (!open || !room) return null;
  const me = room.members.find((m) => m.you)!;
  const real = room.members.filter((m) => !m.bot);
  const fishing = real.filter((m) => m.fishing).length;
  const seats: PondSeat[] = others.slice(0, 3).map((m) => {
    const said = lines.find((l) => l.h === m.h && now - l.at < BUBBLE_MS);
    return {
      key: m.h,
      pic: pics.get(m.h) ?? null,
      name: m.name,
      fishing: Boolean(m.fishing),
      protect: (m.fishN ?? 0) >= POND_PROTECT,
      admiral: Boolean(m.admiral),
      said: said ? lineWords(said.p, said.s) : null,
    };
  });
  const cores = [...new Set(room.members.map((m) => m.core).filter((c) => c > 0))];
  const flags: PondFlag[] = cores.flatMap((c) => {
    const name = CORES.find((x) => x.id === c)?.name;
    return name ? [{ text: [...name][0], bg: FLAG[c]?.[0] ?? "#38383e", fg: FLAG[c]?.[1] ?? "#d9b36a" }] : [];
  });
  const caught = me.fishN ?? 0;
  const school = room.school !== undefined && room.school > now;
  return (
    <Fish
      look={look}
      holder={holder}
      onPasses={onPasses}
      pond={{
        seats,
        flags,
        fire: room.state === "go",
        school,
        place: fmt(T.fish.pond.place, { server: serverName("arknights", room.server) ?? room.server, level: T.squad.levelsShort[room.level - 1] ?? "" }),
        badge: fishing === 0 ? T.fish.pond.nobody : fishing === real.length && real.length > 1 ? fmt(T.fish.pond.fishingAll, { n: fishing }) : fmt(T.fish.pond.fishing, { n: fishing }),
        schoolBadge: school ? fmt(T.fish.pond.school, { left: clock(room.school! - now) }) : null,
        round: fmt(T.fish.pond.round, { n: caught }),
        toProtect: caught >= POND_PROTECT ? T.fish.pond.protected : fmt(T.fish.pond.toProtect, { n: POND_PROTECT - caught }),
        onBite: () => {
          if (!muted) squadDing();
        },
        toast: floats.at(-1)?.text ?? null,
      }}
      onClose={closeSquadPond}
      onRefused={(e) => {
        closeSquadPond();
        onRefused(e);
      }}
    />
  );
}
