import Supercluster from "supercluster";

/**
 * 轻量's piles (src/lib/mapStyle.ts): roaches close together on screen go into one, worked out by
 * supercluster in a worker of its own (pileWorker.ts), or on the page where no worker can be made
 * (piles.ts). Every message carries a seq, so an answer to one asked before the latest is dropped.
 */

/** Roaches within this many CSS px of one another (MapLibre's 512 px tiles) go together, at least two */
export const PILE_RADIUS = 40;
/** The last MapLibre zoom with piles (高德's 16); closer in, every roach is drawn on its own */
export const PILE_MAX_ZOOM = 15;

export type PileAsk =
  /**
   * Every roach but the 触须之交's: where (as the map has them), which icon, and the key that picks the
   * look of a pile: tier × 2^32 + seed, the lowest winning (awake and no clone first, then clones, then
   * those asleep; within one, the lowest seed), so a pile shows the same roach of its own every time
   */
  | { type: "load"; seq: number; lng: Float64Array; lat: Float64Array; look: Uint8Array; key: Float64Array; w: Float64Array }
  /** The piles and lone roaches in a box (west, south, east, north, in degrees) at a MapLibre zoom */
  | { type: "query"; seq: number; bbox: [number, number, number, number]; z: number }
  /** The zoom at which a pile comes apart */
  | { type: "expand"; seq: number; id: number };

export type PileAnswer =
  | { type: "loaded"; seq: number; ms: number }
  /**
   * data: five numbers for each pile or lone roach: lng, lat, how many (each roach counting as many as it
   * stands for: one of the overview, world/area.ts, for its whole square), its look, and which: a pile's
   * cluster id, or -(i + 1) for the i-th roach loaded
   */
  | { type: "piles"; seq: number; z: number; bbox: [number, number, number, number]; data: Float64Array; ms: number }
  | { type: "expand"; seq: number; z: number };

type Props = { s: number; k: number; i: number; n: number };

/** The work itself, the same in the worker and on the page */
export function pileWork() {
  let index: Supercluster<Props, { s: number; k: number; n: number }> | null = null;
  return (m: PileAsk): PileAnswer => {
    if (m.type === "load") {
      const t0 = performance.now();
      const n = m.lng.length;
      const points = new Array<Supercluster.PointFeature<Props>>(n);
      for (let i = 0; i < n; i++) {
        points[i] = {
          type: "Feature",
          properties: { s: m.look[i], k: m.key[i], i, n: m.w[i] },
          geometry: { type: "Point", coordinates: [m.lng[i], m.lat[i]] },
        };
      }
      index = new Supercluster<Props, { s: number; k: number; n: number }>({
        radius: PILE_RADIUS,
        maxZoom: PILE_MAX_ZOOM,
        minPoints: 2,
        map: (p) => ({ s: p.s, k: p.k, n: p.n }),
        reduce: (a, b) => {
          a.n += b.n;
          if (b.k < a.k) {
            a.k = b.k;
            a.s = b.s;
          }
        },
      }).load(points);
      return { type: "loaded", seq: m.seq, ms: performance.now() - t0 };
    }
    if (m.type === "query") {
      const t0 = performance.now();
      const found = index ? index.getClusters(m.bbox, m.z) : [];
      const data = new Float64Array(found.length * 5);
      found.forEach((c, j) => {
        const o = j * 5;
        data[o] = c.geometry.coordinates[0];
        data[o + 1] = c.geometry.coordinates[1];
        const p = c.properties as Partial<Supercluster.ClusterProperties> & { s: number; i?: number; n: number };
        data[o + 2] = p.n;
        data[o + 3] = p.s;
        data[o + 4] = p.cluster ? p.cluster_id! : -((p.i ?? 0) + 1);
      });
      return { type: "piles", seq: m.seq, z: m.z, bbox: m.bbox, data, ms: performance.now() - t0 };
    }
    return { type: "expand", seq: m.seq, z: index ? index.getClusterExpansionZoom(m.id) : PILE_MAX_ZOOM + 1 };
  };
}
