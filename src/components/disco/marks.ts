import type { DiscoMark } from "@/components/map/discoStage";
import { BOB, danceTraits, FREE, WAVE, WILD, wildMove } from "./choreo";
import type { DanceNow } from "./glsl";
import { bounce, pose, posed } from "./pose";

/**
 * 听歌's disco for the few roaches the maps draw as page elements: your own on the 高德 map (your main one taking centre
 * stage, a third as big again while it dances, and dancing a little bigger), and the guides, who only nod to the beat.
 * Their pictures are moved by transform alone, about their feet; as they were the moment the dance stops.
 */

/** Your main roach dances this much bigger, and is this much bigger while it does */
const MAIN_AMP = 1.15;
const MAIN_SCALE = 0.35;
/** The guides nod this much of the crowd's size */
const NOD_AMP = 0.6;
/** Their feet, from the top of their pictures */
const FEET = "50% 92%";

const frac = (v: number) => v - Math.floor(v);

/**
 * A mark's pose now: [across, up (icons), tilt (deg), width, height]. xN: where it is across the screen (0..1), for the
 * wave; traits: its own part of the dance (choreo.ts danceTraits)
 */
export function markPose(kind: DiscoMark["kind"], n: DanceNow, xN: number, traits: readonly [number, number, number]) {
  if (kind === "guide") {
    // a nod on each beat (bobbing, smaller); still where there is no beat
    const nod = (m: number) => (m === FREE ? FREE : BOB);
    const [, y, , w, h] = posed(pose(nod(n.a), n.beat, n.free), pose(nod(n.b), n.beat, n.free), n.mix, n.amp * NOD_AMP, n.on);
    return [0, y, 0, w, h] as [number, number, number, number, number];
  }
  const amp = n.amp * (kind === "main" ? MAIN_AMP : 1);
  const move = (m: number) => (m === WILD ? wildMove(traits, n.beat) : m);
  const at = (m: number) => (m === WAVE ? n.beat - xN * 0.9 : n.beat);
  const a = move(n.a);
  const b = move(n.b);
  const out = posed(pose(a, at(a), n.free), pose(b, at(b), n.free), n.mix, amp, n.on);
  // the climax's first beat: everyone hops
  out[1] += bounce(frac(n.beat))[2] * 2.6 * n.drop * amp * n.on;
  return out;
}

/** CSS's own translate and scale, which add to a transform already there (a guide's turn, a wait): where the browser has them */
const parts = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("translate", "1px 1px") && CSS.supports("scale", "1 1");

/** The picture of a mark to move: your roach's icon as it is; a guide's picture inside her marker */
const pictureOf = (m: DiscoMark) =>
  m.kind === "guide" ? (m.el.querySelector<HTMLElement>(".minghe-flip") ?? m.el.querySelector<HTMLElement>(":scope > img:not(.guide-dance)")) : m.el;

export class DanceMarks {
  /** What was moved, and how, so it goes back as it was */
  private moved = new Map<HTMLElement, "transform" | "parts">();
  private was = new WeakMap<HTMLElement, Record<string, string>>();
  private canParts: boolean | null = null;

  /** The marks as they dance now; box: where the map is on screen, for the wave */
  draw(list: readonly DiscoMark[], n: DanceNow, box: { left: number; width: number }) {
    this.canParts ??= parts();
    const seen = new Set<HTMLElement>();
    // read where each is before anything is written, so the page lays out once
    const at = list.map((m) => {
      const el = pictureOf(m);
      if (!el || !el.isConnected) return null;
      // where the mark is, and how big its picture is laid out: neither as this dance has moved and scaled it
      const r = m.el.getBoundingClientRect();
      const size = m.size || el.offsetWidth || r.width;
      return { m, el, xN: box.width > 0 ? Math.min(1, Math.max(0, (r.left + r.width / 2 - box.left) / box.width)) : 0.5, size };
    });
    for (const it of at) {
      if (!it) continue;
      const { m, el, xN, size } = it;
      seen.add(el);
      const [x, y, tilt, w, h] = markPose(m.kind, n, xN, danceTraits(m.seed));
      const s = m.kind === "main" ? 1 + MAIN_SCALE * n.on : 1;
      if (m.kind === "guide") {
        if (!this.canParts) continue;
        this.moved.set(el, "parts");
        this.set(el, "transform-origin", FEET);
        this.set(el, "translate", `0px ${(y * size).toFixed(1)}px`);
        this.set(el, "scale", `${(w * s).toFixed(3)} ${(h * s).toFixed(3)}`);
        continue;
      }
      this.moved.set(el, "transform");
      this.set(el, "transform-origin", FEET);
      this.set(
        el,
        "transform",
        `translate(${(x * size).toFixed(1)}px, ${(y * size).toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(${(w * s).toFixed(3)}, ${(h * s).toFixed(3)})`,
      );
    }
    for (const el of [...this.moved.keys()]) if (!seen.has(el)) this.put(el);
  }

  /** Every mark back as it was */
  reset() {
    for (const el of [...this.moved.keys()]) this.put(el);
  }

  /** Written only when it changes, so the browser has nothing to do for what stays */
  private set(el: HTMLElement, prop: "transform" | "translate" | "scale" | "transform-origin", v: string) {
    let c = this.was.get(el);
    if (!c) this.was.set(el, (c = {}));
    if (c[prop] === v) return;
    c[prop] = v;
    el.style.setProperty(prop, v);
  }

  private put(el: HTMLElement) {
    const how = this.moved.get(el);
    this.moved.delete(el);
    this.was.delete(el);
    el.style.removeProperty("transform-origin");
    if (how === "parts") {
      el.style.removeProperty("translate");
      el.style.removeProperty("scale");
    } else el.style.removeProperty("transform");
  }
}
