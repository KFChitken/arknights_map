import type { MassPoint } from "./massPoints";
import { pileWork, type PileAnswer, type PileAsk } from "./pileWork";

/**
 * 轻量 for the 高德 map (AmapView): the roaches put into the worker (pileWorker.ts) whenever the list
 * changes, and the piles of the view asked for whenever the view leaves what the last answer covered.
 * The positions are those step 0 worked out once for each roach (massPoints.ts), where 高德 has them,
 * so the piles need no converting either.
 */

/** A pile or a lone roach as 轻量 draws it */
export type PileItem = {
  /** Where, as the map has it (GCJ-02 on 高德) */
  lng: number;
  lat: number;
  /** Its icon: the cartoon look's styleIndex of the roach it shows */
  style: number;
  /** How many: 1 for a roach on its own */
  n: number;
  /** A lone roach's id, or a pile's cluster id */
  ref: string | number;
  /** 0 the crowd; 2 a 触须之交's, never in a pile, drawn on top */
  kind: 0 | 2;
};

/** How much bigger than one roach a pile of n is: two a fifth bigger, ten three fifths, eighty and more 2.2 times */
export const pileMul = (n: number) => (n <= 1 ? 1 : Math.min(2.2, 1 + 0.18 * Math.log2(n)));
/** A pile is never wider than this many CSS px, unless one roach is */
export const PILE_MAX_PX = 64;
/** A pile's count sits right of and above its middle, by these fractions of its size (y down) */
export const BADGE_AT: [number, number] = [0.34, -0.36];
/** A pile's count: as it is up to 9999, then in 万 to one place (1.3万) */
export const countBadgeText = (n: number) => (n < 10_000 ? String(n) : `${Math.round(n / 1000) / 10}万`);

const BADGE_FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

/** A pile's count: a dark pill with white figures and a white rim, h tall, centred on (cx, cy) */
export function drawBadge(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, h: number) {
  ctx.save();
  ctx.font = `800 ${Math.round(h * 0.7)}px ${BADGE_FONT}`;
  const w = Math.max(h * 1.2, ctx.measureText(text).width + h * 0.66);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fillStyle = "#1b1d22";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, h * 0.12);
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + h * 0.04);
  ctx.restore();
}

/** West, south, east, north, in degrees */
export type Box = [number, number, number, number];

const inBox = (p: { lng: number; lat: number }, b: Box) => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

/** The view grown by one screen each way, kept on the map: what a query asks about */
export function grownBox(view: Box): Box {
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  return [Math.max(-180, view[0] - w), Math.max(-85, view[1] - h), Math.min(180, view[2] + w), Math.min(85, view[3] + h)];
}

type Piler = { post: (m: PileAsk) => void; stop: () => void };

/** The worker, or the same work on the page where none can be made (the page then stops while a list goes in) */
function makePiler(onAnswer: (a: PileAnswer) => void): Piler {
  const onPage = (): Piler => {
    const work = pileWork();
    let stopped = false;
    return {
      post: (m) => {
        setTimeout(() => {
          if (!stopped) onAnswer(work(m));
        }, 0);
      },
      stop: () => {
        stopped = true;
      },
    };
  };
  let worker: Worker;
  try {
    if (typeof Worker === "undefined") return onPage();
    worker = new Worker(new URL("./pileWorker.ts", import.meta.url));
  } catch {
    return onPage();
  }
  let fallback: Piler | null = null;
  let heard = false;
  // what was sent before the worker first answered, for the page to do should the worker not start
  const unanswered: PileAsk[] = [];
  worker.onmessage = (e: MessageEvent<PileAnswer>) => {
    heard = true;
    unanswered.length = 0;
    onAnswer(e.data);
  };
  worker.onerror = (e) => {
    if (heard || fallback) return;
    e.preventDefault();
    worker.terminate();
    fallback = onPage();
    for (const m of unanswered.splice(0)) fallback.post(m);
  };
  return {
    // a list's arrays are handed over once the worker has answered; before, they are copied, as the page
    // would need them should the worker not start
    post: (m) => {
      if (fallback) return fallback.post(m);
      if (!heard) {
        unanswered.push(m);
        return worker.postMessage(m);
      }
      worker.postMessage(m, m.type === "load" ? [m.lng.buffer, m.lat.buffer, m.look.buffer, m.key.buffer] : []);
    },
    stop: () => {
      worker.terminate();
      fallback?.stop();
    },
  };
}

export class Piles {
  private piler: Piler;
  private loadSeq = 0;
  private askSeq = 0;
  private expandSeq = 0;
  /** The index in the worker is the one last loaded */
  private ready = false;
  private asking = false;
  /** The roaches loaded, by their index there, and the 触须之交 drawn on their own: of the load in the worker, and of the one going in */
  private ids: string[] = [];
  private friends: MassPoint[] = [];
  private next: { ids: string[]; friends: MassPoint[] } | null = null;
  /** What the last answer covers, and the view as it is now */
  private held: { z: number; bbox: Box } | null = null;
  private want: { z: number; view: Box } | null = null;
  private expands = new Map<number, (z: number) => void>();

  constructor(private onItems: (items: PileItem[]) => void) {
    this.piler = makePiler((a) => this.answer(a));
  }

  /** The roaches to pile, from step 0's batches: every one but the 触须之交's, who are drawn on their own; the piles drawn now stay until the new ones come */
  load(groups: readonly MassPoint[][]) {
    let n = 0;
    for (const g of groups) for (const p of g) if (!p.friend) n++;
    const lng = new Float64Array(n);
    const lat = new Float64Array(n);
    const look = new Uint8Array(n);
    const key = new Float64Array(n);
    const w = new Float64Array(n);
    const ids = new Array<string>(n);
    const friends: MassPoint[] = [];
    let i = 0;
    for (const g of groups) {
      for (const p of g) {
        if (p.friend) {
          friends.push(p);
          continue;
        }
        lng[i] = p.lng;
        lat[i] = p.lat;
        look[i] = p.look;
        key[i] = p.key;
        w[i] = p.n;
        ids[i] = p.id;
        i++;
      }
    }
    this.next = { ids, friends };
    this.ready = false;
    // an answer on its way is about the index before: dropped
    this.asking = false;
    this.askSeq++;
    this.piler.post({ type: "load", seq: ++this.loadSeq, lng, lat, look, key, w });
  }

  /** The view as it is now (as the map has it) at a MapLibre zoom: asked about unless the last answer covers it */
  view(view: Box, z: number) {
    this.want = { z, view };
    if (!this.covers()) this.ask();
  }

  /** The zoom (MapLibre's) at which a pile comes apart */
  expand(id: number): Promise<number> {
    const seq = ++this.expandSeq;
    return new Promise((resolve) => {
      this.expands.set(seq, resolve);
      this.piler.post({ type: "expand", seq, id });
    });
  }

  stop() {
    this.piler.stop();
    this.expands.clear();
  }

  private covers() {
    const h = this.held;
    const w = this.want;
    if (!h || !w || h.z !== w.z) return false;
    return w.view[0] >= h.bbox[0] && w.view[1] >= h.bbox[1] && w.view[2] <= h.bbox[2] && w.view[3] <= h.bbox[3];
  }

  private ask() {
    if (!this.ready || this.asking || !this.want) return;
    this.asking = true;
    this.piler.post({ type: "query", seq: ++this.askSeq, bbox: grownBox(this.want.view), z: this.want.z });
  }

  private answer(a: PileAnswer) {
    if (a.type === "loaded") {
      if (a.seq !== this.loadSeq || !this.next) return;
      this.ids = this.next.ids;
      this.friends = this.next.friends;
      this.next = null;
      this.ready = true;
      this.held = null;
      this.ask();
      return;
    }
    if (a.type === "expand") {
      const done = this.expands.get(a.seq);
      this.expands.delete(a.seq);
      done?.(a.z);
      return;
    }
    if (a.seq !== this.askSeq) return;
    this.asking = false;
    const items: PileItem[] = [];
    const d = a.data;
    for (let o = 0; o < d.length; o += 5) {
      const which = d[o + 4];
      items.push({ lng: d[o], lat: d[o + 1], n: d[o + 2], style: d[o + 3], ref: which < 0 ? this.ids[-which - 1] : which, kind: 0 });
    }
    // the southern ones in front, as things stand on a map, then the 触须之交 on top of them all
    items.sort((p, q) => q.lat - p.lat);
    for (const f of this.friends) {
      // a 触须之交's roach added to the overview (n 0: its square's own roach counts it) is still one roach
      if (inBox(f, a.bbox)) items.push({ lng: f.lng, lat: f.lat, n: 1, style: f.look, ref: f.id, kind: 2 });
    }
    this.held = { z: a.z, bbox: a.bbox };
    this.onItems(items);
    if (!this.covers()) this.ask();
  }
}
