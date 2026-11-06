import type { PublicProfile } from "./profile";
import type { GuideAvatar, RoachColor } from "./types";

/**
 * The site's own guide roaches: 阿米娅向导 (src/lib/amiya.ts), 佩丽卡监督
 * (src/lib/perlica.ts) and 塔露拉干员 (src/lib/talulah.ts). None is an account. Every page draws them for itself,
 * they are never in the shared roach list, and the server knows each only by
 * her id and the prefix of her inbox items, with her touches with each player
 * in a table of her own that only that player reads. Nothing of theirs counts
 * between players: the touch quota, 触须之交 badges, the radar or the admin's numbers.
 */

export type GuideId = "amiya" | "perlica" | "talulah";

export type Guide = {
  id: GuideId;
  name: string;
  /** What players call her in a hurry */
  short: string;
  /** Her picture (never offered to players), and the colour of the hood she falls back to without it */
  avatar: GuideAvatar;
  color: RoachColor;
  /** Her inbox items' ids start with this */
  prefix: string;
  /** Who she is, on her card in place of a player's details */
  note: string;
};

/** Who the guides are, on their cards in place of a player's details */
export const GUIDE_NOTE = "舟P地图的向导，不是真人";

// in this order everywhere they are listed together, as among the 触须之交
export const GUIDES: Record<GuideId, Guide> = {
  amiya: { id: "amiya", name: "阿米娅向导", short: "阿米娅", avatar: "amiya", color: "pink", prefix: "a:", note: GUIDE_NOTE },
  perlica: { id: "perlica", name: "佩丽卡监督", short: "佩丽卡", avatar: "perlica", color: "cyan", prefix: "e:", note: GUIDE_NOTE },
  talulah: {
    id: "talulah",
    name: "塔露拉干员",
    short: "塔露拉",
    avatar: "talulah",
    color: "orange",
    prefix: "h:",
    note: "在太阳岛守着一堆篝火，不是真人",
  },
};

/** Touches one player may give each guide in any 24 hours, apart from the touches between players */
export const GUIDE_TOUCHES_PER_DAY = 20;
/** Her latest touches the inbox shows, so she never floods it */
export const GUIDE_INBOX_SHOWN = 5;

export const guideById = (id: string): Guide | undefined =>
  Object.prototype.hasOwnProperty.call(GUIDES, id) ? GUIDES[id as GuideId] : undefined;

export const guideOfItem = (itemId: string): Guide | undefined =>
  Object.values(GUIDES).find((g) => itemId.startsWith(g.prefix));

/** One of her touches in the inbox, which has nobody behind it to block or report */
export const isGuideItem = (itemId: string) => Boolean(guideOfItem(itemId));

/** Her card for anyone who opens it: no games, UID, favourites or badges */
export const guideProfile = (g: Guide): PublicProfile => ({
  displayName: g.name,
  games: [],
  favourites: { arknights: [], endfield: [] },
  avatar: g.avatar,
  color: g.color,
});
