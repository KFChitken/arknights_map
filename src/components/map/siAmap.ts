import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import { innDrawing, queueLine } from "@/lib/siInn";
import { inkGl, type InkGl } from "./inkGl";
import {
  FAR_BELOW,
  INK,
  INN_FROM,
  INN_OPACITY,
  interp,
  NEAR_FROM,
  QUEUE_OPACITY,
  QUEUE_WIDTH,
  RAILING_WIDTH,
  WALL_WIDTH,
} from "./siLook";
import type { SiMapData } from "./types";

/**
 * 祀掌柜's corner of the 高德 map: the inn's walls and the yard's railings, and the queue's line from the door to
 * its end, as 高德's own lines (thicker and stronger by the zoom, as on MapLibre, siLook.ts), under everything
 * else of hers, which the GPU draws (inkGl.ts); all under the roaches, and never in the way of a tap.
 */

export type SiAmap = {
  set: (si: SiMapData | undefined, changed: { inn?: boolean; inks?: boolean; mine?: boolean; tier?: boolean }) => void;
  setActive: (on: boolean) => void;
  destroy: () => void;
};

/** Over 明河都尉's trail (100, 101), under 两面包夹芝士 (110) and the GPU's part of hers */
const QUEUE_Z = 102;
const INN_Z = 103;
/** Of the queue's thickness and strength: worked out again at most this often while a zoom goes on */
const RESTYLE_MS = 120;

const line = (AMap: AMapNS, pts: [number, number][], zIndex: number, dashed = false) =>
  new AMap.Polyline({
    path: pts.map(([lng, lat]) => toGcj({ lng, lat })),
    strokeColor: INK,
    strokeWeight: 1,
    strokeOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
    ...(dashed ? { strokeStyle: "dashed", strokeDasharray: [2, 1.5] } : {}),
    zIndex,
    bubble: true,
    cursor: "default",
  });

export function amapSi(AMap: AMapNS, map: AMapNS, zoomOffset: number, si: SiMapData | undefined, onFail: (why: string) => void): SiAmap {
  const d = innDrawing();
  const walls = d.walls.map((pts) => line(AMap, pts, INN_Z));
  const railings = d.railings.map((pts) => line(AMap, pts, INN_Z, true));
  map.add([...walls, ...railings]);
  let queue: AMapNS | null = null;
  let queueLength = 0;
  const gpu: InkGl | null = inkGl(AMap, map, { zIndex: 115, zoomOffset, onFail });

  /** Each line as thick and strong as the zoom has it, or out of sight */
  let shown = { inn: true, queue: true };
  const restyle = () => {
    const z = map.getZoom() - zoomOffset;
    const inn = z >= INN_FROM;
    if (inn !== shown.inn) [...walls, ...railings].forEach((p) => (inn ? p.show() : p.hide()));
    if (inn) {
      const opacity = interp(INN_OPACITY, z);
      walls.forEach((p) => p.setOptions({ strokeWeight: interp(WALL_WIDTH, z, 2), strokeOpacity: opacity }));
      const w = interp(RAILING_WIDTH, z, 2);
      railings.forEach((p) => p.setOptions({ strokeWeight: w, strokeOpacity: opacity, strokeDasharray: [2 * w, 1.5 * w] }));
    }
    const q = Boolean(queue) && z >= FAR_BELOW - 0.5 && z < NEAR_FROM + 0.6;
    if (queue && q !== shown.queue) {
      if (q) queue.show();
      else queue.hide();
    }
    if (queue && q) queue.setOptions({ strokeWeight: interp(QUEUE_WIDTH, z, 2), strokeOpacity: interp(QUEUE_OPACITY, z) });
    shown = { inn, queue: q };
  };
  let restyledAt = 0;
  const meanwhile = () => {
    if (performance.now() - restyledAt < RESTYLE_MS) return;
    restyledAt = performance.now();
    restyle();
  };
  map.on("zoomchange", meanwhile);
  map.on("zoomend", restyle);

  const placeQueue = (length: number) => {
    if (length === queueLength && (queue || !length)) return;
    queueLength = length;
    if (queue) map.remove(queue);
    queue = length > 0 ? line(AMap, queueLine(length), QUEUE_Z) : null;
    if (queue) {
      map.add(queue);
      shown.queue = true;
    }
    restyle();
  };

  const set: SiAmap["set"] = (next, changed) => {
    if (changed.inn) {
      placeQueue(next?.inn?.queue ?? 0);
      gpu?.setInn(next?.inn ?? null);
    }
    if (changed.inks) gpu?.setInks(next?.inks ?? []);
    if (changed.mine) gpu?.setMine(next?.mine ?? null);
    if (changed.tier) gpu?.setTier(next?.tier ?? 0);
  };
  set(si, { inn: true, inks: true, mine: true, tier: true });
  restyle();

  return {
    set,
    setActive: (on) => gpu?.setActive(on),
    destroy: () => {
      map.off("zoomchange", meanwhile);
      map.off("zoomend", restyle);
      map.remove([...walls, ...railings, ...(queue ? [queue] : [])]);
      gpu?.destroy();
    },
  };
}
