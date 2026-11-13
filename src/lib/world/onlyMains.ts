import { inBounds } from "../shapes";
import type { LngLat } from "../types";
import { weightOf } from "./area";
import type { MapRoach } from "./types";

/**
 * 只看本体 (src/components/app/OnlyMainsSheet.tsx): what the page draws and counts with it on. Others' clones are not
 * drawn; 触须之交's are, and the player's own come from their own list anyway.
 */
export const drawnWith = (r: Pick<MapRoach, "clone">, friend: boolean, hideClones: boolean) => !(hideClones && r.clone && !friend);

/**
 * 祀's ink roaches from the tiles (src/components/useSiInks.ts): never your own, which the page draws apart (hide: its
 * tap number); with 只看本体 on, those of your 触须之交 only (keep: their tap numbers), as each is one of its owner's clones
 */
export const inkDrawn = (tap: number, hide: number | null, keep: ReadonlySet<number> | null) => tap !== hide && (!keep || keep.has(tap));

/**
 * How many players are in view with 只看本体 on: the overview's roaches stand for the main roaches of their squares
 * (n; 触须之交's drawn besides with n 0 count nobody); close up, the main roaches in view, others' and the player's
 * own (slot 0), clones never, nor the site's show roaches.
 */
export function countPlayers(
  roaches: (MapRoach & { friend?: boolean })[],
  bounds: [LngLat, LngLat],
  overview: boolean,
  own: (LngLat & { slot: number })[],
) {
  if (overview) return roaches.reduce((s, r) => s + (inBounds(r, bounds) ? weightOf(r) : 0), 0);
  let n = 0;
  for (const r of roaches) if (!r.clone && !r.bot && inBounds(r, bounds)) n++;
  for (const r of own) if (r.slot === 0 && inBounds(r, bounds)) n++;
  return n;
}
