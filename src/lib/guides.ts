import { T } from "@/i18n";
import type { PublicProfile } from "./profile";
import type { GuideAvatar, RoachColor } from "./types";

/**
 * The site's own guide roaches: 阿米娅向导 (src/lib/amiya.ts), 佩丽卡监督
 * (src/lib/perlica.ts), 塔露拉干员 (src/lib/talulah.ts), 明河都尉
 * (src/lib/minghe.ts) and 祀掌柜 (src/lib/si.ts). None is an account. Every page draws them for itself,
 * they are never in the shared roach list, and the server knows each only by
 * their id and the prefix of their inbox items, with their touches with each player
 * in a table of their own that only that player reads. Nothing of theirs counts
 * between players: the touch quota, 触须之交 badges, the radar or the admin's numbers.
 */

export type GuideId = "amiya" | "perlica" | "talulah" | "minghe" | "si";

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
  /** What her name card among the 触须之交 says of her, if more than the note */
  card?: string;
  /** How the page speaks of them: 她, or 他 for 明河都尉 */
  pronoun: string;
  /** What she says to a touch past her 20 a day, if not the words every guide shares */
  tooMany?: string;
};

// in this order everywhere they are listed together, as among the 触须之交
export const GUIDES: Record<GuideId, Guide> = {
  amiya: {
    id: "amiya",
    get name() {
      return T.lib.guides.amiya.name;
    },
    get short() {
      return T.lib.guides.amiya.short;
    },
    avatar: "amiya",
    color: "pink",
    prefix: "a:",
    get note() {
      return T.lib.guides.note;
    },
    get pronoun() {
      return T.lib.guides.she;
    },
  },
  perlica: {
    id: "perlica",
    get name() {
      return T.lib.guides.perlica.name;
    },
    get short() {
      return T.lib.guides.perlica.short;
    },
    avatar: "perlica",
    color: "cyan",
    prefix: "e:",
    get note() {
      return T.lib.guides.note;
    },
    get pronoun() {
      return T.lib.guides.she;
    },
  },
  talulah: {
    id: "talulah",
    get name() {
      return T.lib.guides.talulah.name;
    },
    get short() {
      return T.lib.guides.talulah.short;
    },
    avatar: "talulah",
    color: "orange",
    prefix: "h:",
    get note() {
      return T.lib.guides.talulah.note;
    },
    get pronoun() {
      return T.lib.guides.she;
    },
  },
  // white, for the Milky Way his name means
  minghe: {
    id: "minghe",
    get name() {
      return T.lib.guides.minghe.name;
    },
    get short() {
      return T.lib.guides.minghe.short;
    },
    avatar: "minghe",
    color: "white",
    prefix: "m:",
    get note() {
      return T.lib.guides.minghe.note;
    },
    get pronoun() {
      return T.lib.guides.he;
    },
  },
  // red, for the seal she stamps
  si: {
    id: "si",
    get name() {
      return T.lib.guides.si.name;
    },
    get short() {
      return T.lib.guides.si.short;
    },
    avatar: "si",
    color: "red",
    prefix: "i:",
    get note() {
      return T.lib.guides.si.note;
    },
    get card() {
      return T.lib.guides.si.card;
    },
    get pronoun() {
      return T.lib.guides.she;
    },
    get tooMany() {
      return T.lib.guides.si.tooMany;
    },
  },
};

/** Touches one player may give each guide in any 24 hours, apart from the touches between players */
export const GUIDE_TOUCHES_PER_DAY = 20;
/** Their latest touches the inbox shows, so they never flood it */
export const GUIDE_INBOX_SHOWN = 5;

export const guideById = (id: string): Guide | undefined =>
  Object.prototype.hasOwnProperty.call(GUIDES, id) ? GUIDES[id as GuideId] : undefined;

export const guideOfItem = (itemId: string): Guide | undefined =>
  Object.values(GUIDES).find((g) => itemId.startsWith(g.prefix));

/** One of their touches in the inbox, which has nobody behind it to block or report */
export const isGuideItem = (itemId: string) => Boolean(guideOfItem(itemId));

/** Their card for anyone who opens it: no games, UID, favourites or badges */
export const guideProfile = (g: Guide): PublicProfile => ({
  displayName: g.name,
  games: [],
  favourites: { arknights: [], endfield: [] },
  avatar: g.avatar,
  color: g.color,
});
