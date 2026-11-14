import { T } from "@/i18n";
import type { ShownBadge } from "./badges";
import type { Game } from "./games";
import type { PassOnCard } from "./passes";
import type { DrawnAvatar, RoachAvatar, RoachColor } from "./types";

/** Everything a player can fill in about themselves. Only the owner ever sees all of it. */
export type Profile = {
  anonymous: boolean;
  name: string;
  drPrefix: boolean;
  games: Game[];
  favourites: Record<Game, string[]>;
  /** "" when not filled in */
  uid: Record<Game, string>;
  /** Which of the game's SERVERS the UID is on; "" until picked */
  uidServer: Record<Game, string>;
  /** Show the UIDs to players this player touches boldly */
  shareUid: boolean;
  avatar: RoachAvatar;
  color: RoachColor;
  /** 我的助战: operator names, for Arknights players only */
  support: string[];
  /** 好久没来时，蟑螂翻肚皮睡觉 */
  flipWhenAway: boolean;
  /** 让触须之交来串门: their clones may come and sit by your roaches */
  welcomeGuests: boolean;
};

/**
 * What a player shows of themselves when they touch someone boldly.
 * Never carries an email, an id or a position.
 */
export type PublicProfile = {
  displayName: string;
  games: Game[];
  favourites: Record<Game, string[]>;
  uid?: Partial<Record<Game, string>>;
  /** The server of each shared UID */
  uidServer?: Partial<Record<Game, string>>;
  avatar: DrawnAvatar;
  color: RoachColor;
  support?: string[];
  /** Their badges, the worn one first */
  badges?: ShownBadge[];
  worn?: string | null;
  /** 通行证寻访: the pass they wear (src/lib/server/passes.ts wornPasses), for those who may see it */
  pass?: PassOnCard;
};

export const EMPTY_PROFILE: Profile = {
  anonymous: true,
  name: "",
  drPrefix: false,
  games: [],
  favourites: { arknights: [], endfield: [] },
  uid: { arknights: "", endfield: "" },
  uidServer: { arknights: "", endfield: "" },
  shareUid: false,
  avatar: "hood",
  color: "cyan",
  support: [],
  flipWhenAway: true,
  welcomeGuests: true,
};

export function displayName(p: Pick<Profile, "anonymous" | "name" | "drPrefix">) {
  const name = p.name.trim();
  if (p.anonymous || !name) return T.lib.profile.anonymous;
  return p.drPrefix ? `Dr. ${name}` : name;
}
