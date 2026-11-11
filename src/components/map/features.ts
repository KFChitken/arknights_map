import { HEADINGS, LAYER_GROUPS, LEG_PHASES } from "@/lib/swarm";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar } from "@/lib/types";
import { weightOf } from "@/lib/world/area";
import type { PublicRoach } from "@/lib/world/types";
import { sameRoach } from "./massPoints";
import { roachTraits } from "./types";

/**
 * The roaches as the MapLibre map's data has them (MaplibreView), one GeoJSON point each, kept by id
 * across updates of the list. The map is handed only what changed (MapLibre's updateData): packing the
 * whole crowd up for its worker stopped the page for a quarter of a second at every update.
 */

/**
 * The most changes handed over as a diff. MapLibre's own tiler takes a diff's features as the arguments of one
 * call (push(...features)) in its worker: 60,000 at once overflowed the worker's stack in Chrome, and Safari
 * caps arguments at 65,536. More changes than this go as all of the data, which costs what an update used to.
 */
export const MAX_DIFF = 5000;

/** One roach as the map's data has it; its id is the feature's id too (the source's promoteId) */
export function roachFeature(r: PublicRoach, t = roachTraits(r.id, LAYER_GROUPS, HEADINGS.length)): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    // a fixed slight tilt per roach so the crowd looks alive
    properties: {
      id: r.id,
      avatar: r.avatar,
      color: r.color,
      clone: r.clone,
      friend: r.friend,
      asleep: Boolean(r.asleep),
      rot: t.rot,
      heading: t.heading,
      g: t.group,
      lp: t.seed % LEG_PHASES,
      // in the overview (world/area.ts): how many roaches it stands for, for the dark swarm
      ...(weightOf(r) !== 1 ? { n: weightOf(r) } : {}),
    },
  };
}

type Traits = ReturnType<typeof roachTraits>;

/**
 * 轻量's icons on this map, by number: every look awake (avatar × colour), a clone, then every look asleep.
 * A pile shows the icon numbered in the lowest bits of its lowest key (liteFeature).
 */
export const LITE_LOOKS: string[] = [
  ...ROACH_AVATARS.flatMap((a) => ROACH_COLORS.map((c) => `roach-${a}-${c}`)),
  "clone",
  ...ROACH_AVATARS.flatMap((a) => ROACH_COLORS.map((c) => `sleep-roach-${a}-${c}`)),
];

/** A roach's icon in LITE_LOOKS */
export function liteLook(r: Pick<PublicRoach, "avatar" | "color" | "clone" | "asleep">) {
  if (r.clone) return ROACH_AVATARS.length * ROACH_COLORS.length;
  const look = ROACH_AVATARS.indexOf(r.avatar as RoachAvatar) * ROACH_COLORS.length + ROACH_COLORS.indexOf(r.color);
  return r.asleep ? ROACH_AVATARS.length * ROACH_COLORS.length + 1 + look : look;
}

/**
 * One roach as 轻量's piles take it: where, and its key, the lowest of which picks the roach a pile shows:
 * awake and no clone first, then clones, then those asleep (× 2^40); within one, the lowest seed (× 2^8);
 * and in the lowest bits, its icon (liteLook). Below 2^53, so exact.
 */
export function liteFeature(r: PublicRoach, t: Traits): GeoJSON.Feature {
  const tier = r.asleep ? 2 : r.clone ? 1 : 0;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    // n: how many roaches it stands for (the overview's, world/area.ts), summed into each pile's count
    properties: { id: r.id, key: tier * 2 ** 40 + t.seed * 2 ** 8 + liteLook(r), n: weightOf(r) },
  };
}

/**
 * What to hand the map after the list changed. all: every feature, when the map's data must be set
 * from scratch (after reset, or past MAX_DIFF changes); otherwise null, and diff says what changed: features put down or changed
 * (each takes the place of the one with its id) and the ids gone. fresh: the roaches behind the new
 * features, the only ones that can need an icon the map has not drawn yet.
 */
export type FeatureUpdate = {
  all: GeoJSON.FeatureCollection | null;
  diff: { add: GeoJSON.Feature[]; remove: string[] };
  fresh: PublicRoach[];
};

/** seen: the last round (update) the roach was in the list */
type Entry = { src: PublicRoach; f: GeoJSON.Feature; seed: number; group: number; seen: number };

/**
 * Each roach's feature kept by its id while it stays as it was (its traits' hash is what costs), so an
 * update of the list works out only the roaches that changed; the ones gone are swept out after each
 * round. What the map last had is what the next update is measured against.
 */
export class FeatureCache {
  private byId = new Map<string, Entry>();
  private round = 0;
  private lost = true;

  /** make: each roach's feature (roachFeature, or liteFeature for 轻量's piles) */
  constructor(private make: (r: PublicRoach, t: Traits) => GeoJSON.Feature = roachFeature) {}

  /** Every roach's feature, for the map's data from scratch */
  collection(roaches: readonly PublicRoach[]): GeoJSON.FeatureCollection {
    this.lost = false;
    return { type: "FeatureCollection", features: this.take(roaches).features };
  }

  /** What changed since the map last had the crowd; all of it once reset, or when too much changed */
  update(roaches: readonly PublicRoach[]): FeatureUpdate {
    const lost = this.lost;
    this.lost = false;
    const { features, add, remove, fresh } = this.take(roaches);
    if (lost || add.length + remove.length > MAX_DIFF) {
      // after a lost update the map may lack icons too, so all of the crowd counts as new
      return { all: { type: "FeatureCollection", features }, diff: { add: [], remove: [] }, fresh: lost ? [...roaches] : fresh };
    }
    return { all: null, diff: { add, remove }, fresh };
  }

  /** The map missed an update (it failed on the way, or its worker did): the next one sends everything */
  reset() {
    this.lost = true;
  }

  /** A roach's crawl group and rhythm, as its feature has them (舟u本色's hearts) */
  traits(id: string): { seed: number; group: number } | undefined {
    return this.byId.get(id);
  }

  private take(roaches: readonly PublicRoach[]) {
    const round = ++this.round;
    const features: GeoJSON.Feature[] = [];
    const add: GeoJSON.Feature[] = [];
    const fresh: PublicRoach[] = [];
    for (const r of roaches) {
      let e = this.byId.get(r.id);
      if (!e) {
        const t = roachTraits(r.id, LAYER_GROUPS, HEADINGS.length);
        e = { src: r, f: this.make(r, t), seed: t.seed, group: t.group, seen: round };
        this.byId.set(r.id, e);
        add.push(e.f);
        fresh.push(r);
      } else if (e.seen === round) {
        continue; // MapLibre's updates need every id once
      } else {
        if (e.src !== r) {
          // a new feature (one handed out is never changed); seed and group come from the id alone
          if (!sameRoach(e.src, r)) {
            e.f = this.make(r, roachTraits(r.id, LAYER_GROUPS, HEADINGS.length));
            add.push(e.f);
            fresh.push(r);
          }
          e.src = r;
        }
        e.seen = round;
      }
      features.push(e.f);
    }
    const remove: string[] = [];
    for (const [id, e] of this.byId) {
      if (e.seen === round) continue;
      remove.push(id);
      this.byId.delete(id);
    }
    return { features, add, remove, fresh };
  }
}
