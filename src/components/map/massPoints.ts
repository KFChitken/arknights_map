import { toGcj } from "@/lib/coords";
import type { RoachOpts } from "@/lib/roachSvg";
import { HEADINGS, LEG_FRAMES, MASS_GROUPS } from "@/lib/swarm";
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor, type RoachStyle } from "@/lib/types";
import { weightOf } from "@/lib/world/area";
import type { PublicRoach } from "@/lib/world/types";
import type { GlRoach } from "./roachGl";
import { roachTraits } from "./types";

/**
 * The roaches as the 高德 map draws them (AmapView): where 高德 has them (GCJ-02), which icon, which
 * crawl batch. Worked out once for each roach and kept (MassCache): an update of the list, every two
 * minutes, changes a few hundred of tens of thousands, and working them all out again (the GCJ shift
 * above all) stopped the page for half a second each time.
 */

// MassMarks draws thousands of points on one canvas, unlike DOM markers.
// Roaches are split into batches, each with its own MassMarks redrawn in turn;
// every roach moves on its own rhythm. Style indexes (styleSpecs): cartoon = one per look
// and color, then one shared clone look, then the same again for 触须之交;
// real = pre-rendered heading, then see-through clone headings, then both
// again for 触须之交, and that whole block once per walk-cycle pose. Then the
// sleeping main roaches, and last (cartoon only) a 触须之交's clones in each look.
export type MassPoint = {
  lng: number;
  lat: number;
  /** [lng, lat] as one pair, made once, for the dark swarm */
  at: [number, number];
  cos: number;
  id: string;
  /** index into the cartoon looks: avatar * colors + color */
  color: number;
  heading: number;
  clone: boolean;
  friend: boolean;
  asleep: boolean;
  seed: number;
  group: number;
  /** The cartoon look's icon (styleIndex), as the GPU layer and 轻量 draw it */
  look: number;
  /** 轻量: which roach a pile shows, the lowest key winning (piles.ts) */
  key: number;
  /** How many roaches it stands for: in the overview (world/area.ts), all those in its square */
  n: number;
};

export const LOOKS = ROACH_AVATARS.length * ROACH_COLORS.length;
export const CARTOON_STYLES = LOOKS + 1;
const REAL_STYLES = HEADINGS.length * 2;
const REAL_POSE = REAL_STYLES * 2;
/** Where the sleeping icons start in each look's style list, after the awake ones */
export const asleepFrom = (look: RoachStyle) => (look === "real" ? REAL_POSE * LEG_FRAMES : CARTOON_STYLES * 2);
/** The cartoon look's icons for a 触须之交's clones, one for each look TA can have, after those asleep */
export const friendClonesFrom = asleepFrom("cartoon") + 2 * LOOKS;
/** How many icons the cartoon look has in all (styleSpecs) */
export const CARTOON_ICONS = friendClonesFrom + LOOKS;
/** The batch the crawl never moves: sleeping roaches lie still */
export const STILL = MASS_GROUPS;

/** The icon of each style index (styleIndex) in a look, as AmapView.tsx draws them: colour and how */
export function styleSpecs(look: RoachStyle): [RoachColor, RoachOpts][] {
  const block = (step?: number) =>
    [false, true].flatMap((friend): [RoachColor, RoachOpts][] =>
      look === "real"
        ? [
            ...HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, step }]),
            ...HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, clone: true, step }]),
          ]
        : [
            ...ROACH_AVATARS.flatMap((avatar) => ROACH_COLORS.map((color): [RoachColor, RoachOpts] => [color, { avatar, friend }])),
            ["white", { friend, clone: true }],
          ],
    );
  const awake = look === "real" ? Array.from({ length: LEG_FRAMES }, (_, f) => block(f / LEG_FRAMES)).flat() : block();
  // then the sleeping main roaches (asleepFrom), still and with no clones
  const asleep = [false, true].flatMap((friend): [RoachColor, RoachOpts][] =>
    look === "real"
      ? HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, asleep: true }])
      : ROACH_AVATARS.flatMap((avatar) => ROACH_COLORS.map((color): [RoachColor, RoachOpts] => [color, { avatar, friend, asleep: true }])),
  );
  // last, so the numbers before stay: a 触须之交's clones in every look TA can have (friendClonesFrom)
  const friendClones =
    look === "real"
      ? []
      : ROACH_AVATARS.flatMap((avatar) => ROACH_COLORS.map((color): [RoachColor, RoachOpts] => [color, { avatar, friend: true, clone: true }]));
  return [...awake, ...asleep, ...friendClones];
}

export function styleIndex(p: MassPoint, look: RoachStyle, pose: number) {
  if (p.asleep) return asleepFrom(look) + (look === "real" ? (p.friend ? HEADINGS.length : 0) + p.heading : (p.friend ? LOOKS : 0) + p.color);
  if (look === "real") return pose * REAL_POSE + (p.friend ? REAL_STYLES : 0) + (p.clone ? HEADINGS.length : 0) + p.heading;
  // a 触须之交's clone in TA's look (MapApp gives it them), after all the rest
  if (p.clone && p.friend) return friendClonesFrom + p.color;
  return (p.friend ? CARTOON_STYLES : 0) + (p.clone ? LOOKS : p.color);
}

/** One roach worked out from scratch */
export function massPointOf(r: PublicRoach): MassPoint {
  const [lng, lat] = toGcj(r);
  const t = roachTraits(r.id, MASS_GROUPS, HEADINGS.length);
  const p: MassPoint = {
    lng,
    lat,
    at: [lng, lat],
    cos: Math.cos((lat * Math.PI) / 180),
    id: r.id,
    // the shared list only ever holds the looks players pick
    color: ROACH_AVATARS.indexOf(r.avatar as RoachAvatar) * ROACH_COLORS.length + ROACH_COLORS.indexOf(r.color),
    heading: t.headingIndex,
    clone: r.clone,
    friend: r.friend,
    asleep: Boolean(r.asleep),
    seed: t.seed,
    group: r.asleep ? STILL : t.group,
    look: 0,
    // awake and no clone first, then clones, then those asleep; within one, the lowest seed
    key: (r.asleep ? 2 : r.clone ? 1 : 0) * 2 ** 32 + t.seed,
    n: weightOf(r),
  };
  p.look = styleIndex(p, "cartoon", 0);
  return p;
}

/** Whether a roach is drawn the same as before: the same object, or the same where and how */
export const sameRoach = (a: PublicRoach, b: PublicRoach) =>
  a === b ||
  (a.lng === b.lng &&
    a.lat === b.lat &&
    Boolean(a.asleep) === Boolean(b.asleep) &&
    a.clone === b.clone &&
    a.friend === b.friend &&
    a.avatar === b.avatar &&
    a.color === b.color &&
    weightOf(a) === weightOf(b));

/** The roach as the GPU layer takes it (roachGl.ts), the cartoon look's icon */
const glOf = (p: MassPoint): GlRoach => ({
  id: p.id,
  lng: p.lng,
  lat: p.lat,
  style: p.look,
  still: p.asleep,
  seed: p.seed,
  friend: p.friend,
  clone: p.clone,
});

/** seen: the last round (groups call) the roach was in the list */
type Entry = { src: PublicRoach; point: MassPoint; gl: GlRoach | null; seen: number };

/**
 * Each roach's MassPoint kept by its id, used again while the roach stays as it was: only those put down,
 * moved, fallen asleep or woken up, or become a 触须之交's, are worked out again (a new MassPoint: those
 * handed out are never changed). The ones gone are swept out after each round.
 */
export class MassCache {
  private byId = new Map<string, Entry>();
  private round = 0;
  /** The last round's entries by batch, as its groups hold them: the crowd, and 触须之交 apart */
  private last: { crowd: Entry[][]; friends: Entry[][] } = { crowd: [], friends: [] };

  /** The crawl batches (the last one: sleeping roaches), 触须之交 last in each so MassMarks paints them on top */
  groups(roaches: readonly PublicRoach[]): MassPoint[][] {
    const batches = () => Array.from({ length: MASS_GROUPS + 1 }, () => []);
    const crowd: Entry[][] = batches();
    const friends: Entry[][] = batches();
    const crowdPoints: MassPoint[][] = batches();
    const friendPoints: MassPoint[][] = batches();
    const round = ++this.round;
    for (const r of roaches) {
      let e = this.byId.get(r.id);
      if (!e) {
        e = { src: r, point: massPointOf(r), gl: null, seen: round };
        this.byId.set(r.id, e);
      } else if (e.seen === round) {
        continue; // the same id twice: drawn once
      } else {
        if (e.src !== r) {
          if (!sameRoach(e.src, r)) {
            e.point = massPointOf(r);
            e.gl = null;
          }
          e.src = r;
        }
        e.seen = round;
      }
      const g = e.point.group;
      if (e.point.friend) {
        friends[g].push(e);
        friendPoints[g].push(e.point);
      } else {
        crowd[g].push(e);
        crowdPoints[g].push(e.point);
      }
    }
    for (const [id, e] of this.byId) if (e.seen !== round) this.byId.delete(id);
    this.last = { crowd, friends };
    return crowdPoints.map((g, i) => (friendPoints[i].length ? g.concat(friendPoints[i]) : g));
  }

  /** Every roach of the last groups() for the GPU layer, batch by batch, 触须之交 last so they are drawn on top */
  gl(): GlRoach[] {
    const out: GlRoach[] = [];
    for (const part of [this.last.crowd, this.last.friends]) for (const g of part) for (const e of g) out.push((e.gl ??= glOf(e.point)));
    return out;
  }
}
