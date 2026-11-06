import { generateFakeRoaches } from "../fakeRoaches";
import { distanceKm } from "../geo";
import { mulberry32 } from "../prng";
import { MINGHE_BOT_FREE_KM, ROUTE } from "../minghe";
import { FIRE_AT, FIRE_BOT_FREE_KM } from "../talulah";
import type { LngLat, RoachAvatar } from "../types";
import type { MapRoach } from "./types";

/**
 * Show roaches that make the live map look the way it will once many players
 * have joined. They belong to nobody and exist only in the shared roach feed:
 * no accounts, nothing in the database, so the radar, declarations, touches,
 * reports and emails never see them. SHOW_BOTS on the server sets how many;
 * 0 removes them all.
 */

const PREFIX = "bot-";

/** Breeze asked for none in Beijing, so testers there can find the real players. */
const BEIJING = { lng: 116.4, lat: 39.9 };
export const BOT_FREE_KM = 60;
/**
 * None by 塔露拉干员's fire either, where they would look like players sitting by it
 * (src/lib/talulah.ts), nor at 明河都尉's stations, where they would look like his riders (src/lib/minghe.ts)
 */
const NO_BOTS: [LngLat, number][] = [
  [BEIJING, BOT_FREE_KM],
  [FIRE_AT, FIRE_BOT_FREE_KM],
  ...ROUTE.map((s): [LngLat, number] => [s.at, MINGHE_BOT_FREE_KM]),
];

export const isBotId = (id: string) => id.startsWith(PREFIX);

const cache = new Map<number, MapRoach[]>();

/** The same n roaches on every start, spread like real players would be. */
export function botRoaches(n: number): MapRoach[] {
  if (n <= 0) return [];
  let bots = cache.get(n);
  if (!bots) {
    // a few spare, since rounding each city's share and the gap around Beijing can leave it short
    bots = generateFakeRoaches(n + 50, 20261026, ["北京"])
      .filter((r) => NO_BOTS.every(([at, km]) => distanceKm(r, at) > km))
      .slice(0, n)
      .map((r, i) => {
        const a = mulberry32(0xb07 + i * 7919)();
        const avatar: RoachAvatar = a < 0.4 ? "hood" : a < 0.6 ? "doctor" : a < 0.8 ? "endmin" : "imp";
        return { id: `${PREFIX}${i}`, clone: false, avatar, color: r.color, lng: r.lng, lat: r.lat, bot: true as const };
      });
    cache.set(n, bots);
  }
  return bots;
}
