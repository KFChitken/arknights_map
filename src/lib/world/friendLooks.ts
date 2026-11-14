import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "../types";
import { feedIdsOf } from "./packed";
import type { Friend, MapRoach } from "./types";

/**
 * A 触须之交's clones as your map draws them: in TA's look, not in the plain one the shared list gives every
 * clone (server/roachFeed.ts lookOf), which stays as it is, so nobody else learns whose a clone is. You know
 * already: your list of 触须之交 has their roaches, clones too.
 */
export type Look = { avatar: RoachAvatar; color: RoachColor };

/** TA's look: TA's main roach's, or TA's own pick while it is not out, either kept to the looks players can pick */
export function friendLook(f: Pick<Friend, "roaches" | "profile">): Look {
  const from = f.roaches.find((r) => !r.clone) ?? f.profile;
  return {
    avatar: ROACH_AVATARS.find((a) => a === from.avatar) ?? "hood",
    color: ROACH_COLORS.find((c) => c === from.color) ?? "cyan",
  };
}

/** Each 触须之交's clones by their ids in the feed (either form, world/packed.ts), with TA's look */
export function friendCloneLooks(friends: readonly Pick<Friend, "roaches" | "profile">[]): Map<string, Look> {
  const looks = new Map<string, Look>();
  for (const f of friends) {
    const clones = f.roaches.filter((r) => r.clone);
    if (!clones.length) continue;
    const look = friendLook(f);
    for (const r of clones) for (const id of feedIdsOf(r.id)) looks.set(id, look);
  }
  return looks;
}

/** The main roaches the server names as 鸭爵 to the 站长 and the admins (Me ducks), by their ids in the feed (either form) */
export const duckIdsOf = (ducks: readonly string[] | undefined): ReadonlySet<string> => new Set((ducks ?? []).flatMap(feedIdsOf));

/**
 * A roach of the feed as your map draws it: a 触须之交's clone in TA's look (friendCloneLooks); a main roach the
 * server names as 鸭爵 (duckIdsOf: the 站长 and the admins see one another in him while DUCK is admins, where the feed,
 * the same for all, has the plain hood) in him, in its own colour; any other as the feed has it
 */
export function lookOnMap(
  r: Pick<MapRoach, "id" | "clone" | "avatar" | "color">,
  friend: boolean,
  cloneLooks: ReadonlyMap<string, Look>,
  ducks: ReadonlySet<string>,
): Pick<MapRoach, "avatar" | "color"> {
  if (r.clone) return (friend && cloneLooks.get(r.id)) || { avatar: r.avatar, color: r.color };
  return { avatar: ducks.has(r.id) ? "duck" : r.avatar, color: r.color };
}
