import type { Game } from "./games";
import type { RoachAvatar, RoachColor } from "./types";

/** Everything a player can fill in about themselves. Only the owner ever sees all of it. */
export type Profile = {
  anonymous: boolean;
  name: string;
  drPrefix: boolean;
  games: Game[];
  favourites: Record<Game, string[]>;
  /** "" when not filled in */
  uid: Record<Game, string>;
  /** Show the UIDs to players this player touches boldly */
  shareUid: boolean;
  avatar: RoachAvatar;
  color: RoachColor;
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
  avatar: RoachAvatar;
  color: RoachColor;
};

export const EMPTY_PROFILE: Profile = {
  anonymous: true,
  name: "",
  drPrefix: false,
  games: [],
  favourites: { arknights: [], endfield: [] },
  uid: { arknights: "", endfield: "" },
  shareUid: false,
  avatar: "hood",
  color: "cyan",
};

export function displayName(p: Pick<Profile, "anonymous" | "name" | "drPrefix">) {
  const name = p.name.trim();
  if (p.anonymous || !name) return "匿名舟p";
  return p.drPrefix ? `Dr. ${name}` : name;
}
