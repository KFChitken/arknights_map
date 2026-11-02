import { homeGame, type Game } from "./games";
import type { PublicProfile } from "./profile";
import { GUIDE_AVATAR, type LngLat } from "./types";
import type { PublicRoach } from "./world/types";

/**
 * 阿米娅向导: one guide roach that every player shares, on Rhode Island. She is
 * not an account: each page draws her from what is here, she is never in the
 * shared roach list, and the server knows her only by AMIYA_ID and her inbox
 * items ("a:<id>", src/lib/server/amiya.ts). Touch her and she touches back the
 * same way; touch her boldly and you are 触须之交, and from the next day on she
 * greets you once a day.
 */

export const AMIYA_ID = "amiya";
export const AMIYA_NAME = "阿米娅向导";
/** The middle of Aquidneck Island, Rhode Island */
export const AMIYA_AT: LngLat = { lng: -71.2647, lat: 41.5556 };
/** Touches one player may give her in any 24 hours, apart from the touches between players */
export const AMIYA_TOUCHES_PER_DAY = 20;
/** Flying to her on Amap stops at this zoom (MapLibre levels): Amap is blank abroad further in */
export const AMIYA_AMAP_ZOOM = 8;

export const isAmiyaItem = (id: string) => id.startsWith("a:");

/** Today on this device, turning at 04:00 like her greetings (the server works its own out from the time zone the page sends) */
export function localDay(now = Date.now()) {
  const d = new Date(now - 4 * 3_600_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 博士, or 管理员 for players who play only Endfield */
export const callName = (games: Game[]) => (homeGame(games) === "endfield" ? "管理员" : "博士");

/** Her lines, word for word as Breeze wrote them (欸 and 诶 are different on purpose) */
export function amiyaLine(what: "sneaky" | "bold" | "greet", games: Game[]) {
  const you = callName(games);
  if (what === "greet") return `欢迎回家，${you}`;
  return what === "bold" ? `诶嘿嘿...${you}` : `欸？${you}？`;
}

/** Her card for anyone who opens it: no games, UID, favourites or badges */
export const AMIYA_PROFILE: PublicProfile = {
  displayName: AMIYA_NAME,
  games: [],
  favourites: { arknights: [], endfield: [] },
  avatar: GUIDE_AVATAR,
  color: "pink",
};

export function amiyaRoach(friend: boolean): PublicRoach {
  return { id: AMIYA_ID, clone: false, avatar: GUIDE_AVATAR, color: "pink", friend, guide: true, ...AMIYA_AT };
}
