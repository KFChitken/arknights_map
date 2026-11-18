"use client";

import { useEffect } from "react";
import { BOT_ACT_MS, BOT_SAY_SHARE } from "@/lib/squad";
import { squadBot, squadRoomNow, useSquadRoom } from "./squading";

/**
 * 人机 doing something by themselves (src/lib/squad.ts BOT_DOS): while the 站长 or an admin hosts a room with some in
 * it and the page is in sight, now and then (BOT_ACT_MS) one of them says a line, or changes its pose (BOT_SAY_SHARE).
 * The host's page alone sends it; everyone in the room sees it as anyone's. Stopped while the page is out of sight,
 * and started again as it comes back.
 */
export function useSquadBotsActing() {
  const room = useSquadRoom();
  const on = Boolean(room?.host && room.staff && room.members.some((m) => m.bot));
  useEffect(() => {
    if (!on) return;
    let timer = 0;
    const next = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      const [least, most] = BOT_ACT_MS;
      timer = window.setTimeout(act, least + Math.random() * (most - least));
    };
    const act = () => {
      const bots = (squadRoomNow()?.members ?? []).filter((m) => m.bot);
      const bot = bots[Math.floor(Math.random() * bots.length)];
      if (bot) void squadBot(Math.random() < BOT_SAY_SHARE ? "say" : "pose", bot.h).catch(() => {});
      next();
    };
    next();
    document.addEventListener("visibilitychange", next);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", next);
    };
  }, [on]);
}
