import { T } from "@/i18n";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl, type RoachOpts } from "@/lib/roachSvg";
import type { SceneEgg } from "@/lib/squad";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import { sizesOf, type Foe } from "./geometry";

/**
 * What the three versions of the fight on the map share (src/components/app/squad/scene): the stage's sizes, the
 * room's roaches on it (their look, colour and pose, their name under them), little effects (sparks, shards, words,
 * rings), the black bubble of a line, and a frame loop of about 30 a second that stops while the page is hidden, the
 * stage out of sight or switched off. Everything is drawn here in the page alone: the monsters are each viewer's own,
 * only the roaches' poses and lines come from the room.
 */

/** One of the room as the fight draws them: h, their number in the room (who they are); seat, where they stand (geometry.ts seatFor) */
export type FightMember = { h: number; seat: number; name: string; you: boolean; friend: boolean; look: RoachAvatar; color: RoachColor; pose: number };

export type SceneOpts = {
  members: () => FightMember[];
  /** Your own roach tapped */
  onMe?: () => void;
  /** Reduce motion: one still picture, no eggs */
  reduce: boolean;
  /** Monsters at once in A */
  max: number;
};

export type SceneApi = {
  /** The room changed (poses, someone in or out): drawn again */
  sync(): void;
  /** A line said by h, its words; false when the fight is off (the tile shows it then) */
  say(h: number, text: string, egg?: SceneEgg): boolean;
  setOff(off: boolean): void;
  /** The round over: what is left breaks, the awake hop */
  end(): void;
  destroy(): void;
};

export const FOE_SRC: Readonly<Record<Foe, string>> = {
  slug: "/squad/slug.svg",
  acid: "/squad/acid.svg",
  infused: "/squad/infused.svg",
  hound: "/squad/hound.svg",
  drone: "/squad/drone.svg",
};
/** The colours a monster breaks into (shards) */
export const TINT: Partial<Record<Foe, string>> = { acid: "acid", infused: "ember", drone: "metal" };

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <V>(list: readonly V[]): V => list[Math.floor(Math.random() * list.length)];
const PX = (n: number) => `${n.toFixed(1)}px`;

const awakeOf = (m: FightMember | undefined) => Boolean(m) && m!.pose !== 2;

/** The picture of one's roach: as it stands, sleeves up (the hood's swing), or asleep; set at once, or once drawn */
function roachImg(m: FightMember, variant: "plain" | "hands" | "asleep", px: number, cls = "") {
  const img = document.createElement("img");
  img.alt = "";
  if (cls) img.className = cls;
  const opts: RoachOpts = {
    avatar: m.look,
    mine: m.you,
    friend: m.friend && !m.you,
    ...(variant === "hands" ? { hands: true } : variant === "asleep" ? { asleep: true } : {}),
  };
  if (usesPicture(opts)) {
    void roachIconUrl(m.color, opts, Math.round(px * 2)).then((u) => (img.src = u));
  } else img.src = roachDataUrl(m.color, opts);
  return img;
}

export type Kit = ReturnType<typeof kit>;

export function kit(stage: HTMLElement, opt: SceneOpts) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const flashes = new WeakMap<Element, Map<string, ReturnType<typeof setTimeout>>>();
  const obs: { disconnect(): void }[] = [];
  const els: Record<number, HTMLElement> = {};
  const K = {
    W: 0,
    H: 0,
    rs: 52,
    ss: 58,
    els,
    off: false,
    dead: false,
    reduce: opt.reduce,
    kick: () => {},
    stopLoop: () => {},
    /** fn after ms, unless the scene is gone by then */
    later(fn: () => void, ms: number) {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!K.dead) fn();
      }, ms);
      timers.add(t);
    },
    members: () => opt.members(),
    who: (h: number) => opt.members().find((m) => m.h === h),
    /** The seat of the one numbered h (1 while they are not there) */
    seatOf: (h: number) => opt.members().find((m) => m.h === h)?.seat ?? 1,
    awake: awakeOf,
    measure() {
      K.W = stage.clientWidth;
      K.H = stage.clientHeight;
      const { rs, ss } = sizesOf(K.W, K.H);
      K.rs = rs;
      K.ss = ss;
      stage.style.setProperty("--rs", `${rs}px`);
      stage.style.setProperty("--ss", `${ss}px`);
    },
    /** A class on el for ms, started again if it is on already */
    flash(el: Element, cls: string, ms: number) {
      el.classList.remove(cls);
      void (el as HTMLElement).offsetWidth;
      el.classList.add(cls);
      let m = flashes.get(el);
      if (!m) flashes.set(el, (m = new Map()));
      const old = m.get(cls);
      if (old) clearTimeout(old);
      m.set(
        cls,
        setTimeout(() => el.classList.remove(cls), ms),
      );
    },
    /** A little thing at x, y for ms (0: kept), with words, style variables, on the stage or the layer given */
    fx(cls: string, x: number, y: number, ms: number, text = "", vars?: Record<string, string>, layer?: HTMLElement) {
      const d = document.createElement("span");
      d.className = cls;
      if (text) d.textContent = text;
      d.style.left = PX(x);
      d.style.top = PX(y);
      if (vars) for (const [k, v] of Object.entries(vars)) d.style.setProperty(k, v);
      (layer ?? stage).appendChild(d);
      if (ms) setTimeout(() => d.remove(), ms);
      return d;
    },
    pop: (x: number, y: number, text: string, cls = "") => K.fx(`sc-pop${cls ? ` ${cls}` : ""}`, x, y, 1250, text),
    spark: (x: number, y: number) => K.fx("sc-spark", x, y, 360),
    dmg: (x: number, y: number, crit: boolean) => K.fx(`sc-dmg${crit ? " crit" : ""}`, x + rnd(-8, 8), y + rnd(-6, 4), 740, `-${crit ? 999 : Math.round(rnd(160, 420))}`),
    ring: (x: number, y: number) => [0, 260, 520].forEach((d) => K.later(() => K.fx("sc-ring", x, y, 1150), d)),
    shards(x: number, y: number, n: number, size: number, tint?: string) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1.05 + Math.random() * 0.9);
        const r = size * (0.35 + Math.random() * 0.55);
        K.fx(`sc-shard${i < 2 ? " hot" : i < 4 ? " lt" : ""}${tint ? ` ${tint}` : ""}`, x, y, 800, "", {
          "--dx": `${(Math.cos(a) * r).toFixed(0)}px`,
          "--dy": `${(Math.sin(a) * r * 0.9 + size * 0.2).toFixed(0)}px`,
          "--rot": `${rnd(-260, 260).toFixed(0)}deg`,
        });
      }
    },
    /** What a roach's body shows: asleep, sleeves up for a moment, dancing (both pictures, one at a time), or standing */
    body(m: FightMember, hands = false): HTMLElement[] {
      const px = K.rs;
      if (m.pose === 2) return [roachImg(m, "asleep", px)];
      if (hands && m.look === "hood") return [roachImg(m, "hands", px)];
      if (m.pose === 1 && m.look === "hood") return [roachImg(m, "plain", px, "a"), roachImg(m, "hands", px, "b")];
      return [roachImg(m, "plain", px)];
    },
    /** A roach on the stage, made once; its picture follows its pose; x, y is its middle (none: where it is) */
    roach(m: FightMember, x?: number, y?: number) {
      let el = els[m.h];
      if (!el) {
        el = els[m.h] = document.createElement("div");
        el.innerHTML = '<div class="bd"></div><span class="tag"></span>';
        el.dataset.h = String(m.h);
        stage.appendChild(el);
        // the stage is a picture to the screen reader: your tile on the bar opens the same panel
        if (m.you && opt.onMe) el.addEventListener("click", opt.onMe);
      }
      const keep = [...el.classList].filter((c) => /^(atk-|lunge|yell|cheer|hop2|whirl|glitch|spin|shake|knock|dodge|bump|acid|dizzy|fly|flail)/.test(c));
      el.className = `sc-r ${m.pose === 2 ? "sleep" : m.pose === 1 ? "dance" : "idle"}${m.you ? " me" : ""}${keep.length ? ` ${keep.join(" ")}` : ""}`;
      const look = `${m.pose}:${m.look}:${m.color}:${m.you}:${m.friend}:${K.rs}`;
      if (el.dataset.look !== look) {
        el.querySelector(".bd")!.replaceChildren(...K.body(m));
        el.dataset.look = look;
        el.dataset.pose = String(m.pose);
        const z = el.querySelector(".sc-zz");
        if (m.pose === 2 && !z) el.insertAdjacentHTML("beforeend", '<span class="sc-zz">z</span>');
        if (m.pose !== 2 && z) z.remove();
      }
      el.querySelector(".tag")!.textContent = m.you ? T.squad.room.youName : m.name;
      if (x !== undefined && y !== undefined) {
        el.style.left = PX(x);
        el.style.top = PX(y);
      }
      return el;
    },
    /** Those no longer in the room: off the stage */
    prune() {
      const here = new Set(opt.members().map((m) => m.h));
      for (const h of Object.keys(els).map(Number)) {
        if (here.has(h)) continue;
        els[h].remove();
        delete els[h];
      }
    },
    pos: (el: HTMLElement): [number, number] => [parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0],
    /** A quick swing towards a point (dist px), the hood with its sleeves up for a moment */
    swing(m: FightMember, tx: number, ty: number, dist: number) {
      const el = els[m.h];
      if (!el) return;
      const [x, y] = K.pos(el);
      const d = Math.hypot(tx - x, ty - y) || 1;
      el.style.setProperty("--lx", PX(((tx - x) / d) * dist));
      el.style.setProperty("--ly", PX(((ty - y) / d) * dist));
      el.style.setProperty("--lr", `${tx < x ? -11 : 11}deg`);
      const bd = el.querySelector(".bd")!;
      if (m.look === "hood" && m.pose !== 2) bd.replaceChildren(...K.body(m, true));
      K.flash(el, "lunge", 360);
      K.later(() => {
        if (el.dataset.pose === String(m.pose)) bd.replaceChildren(...K.body(m));
      }, 380);
    },
    /** Everyone awake hops (or the class given) */
    cheer(cls = "cheer") {
      for (const m of opt.members()) {
        const el = els[m.h];
        if (awakeOf(m) && el && !el.classList.contains("fly")) K.flash(el, cls, 950);
      }
    },
    /** The black bubble over a roach (x, y its tail), within the stage, never on another one: a later one sits higher */
    bubble(h: number, x: number, y: number, text: string) {
      stage.querySelectorAll(`.sc-bub[data-h="${h}"]`).forEach((o) => o.remove());
      const b = document.createElement("div");
      b.className = "sc-bub";
      b.dataset.h = String(h);
      b.textContent = text;
      b.style.left = PX(x);
      b.style.top = PX(y);
      stage.appendChild(b);
      const w = b.offsetWidth;
      const cx = Math.max(w / 2 + 4, Math.min(K.W - w / 2 - 4, x));
      b.style.left = PX(cx);
      b.style.setProperty("--tail", `${Math.max(12, Math.min(88, 50 + ((x - cx) / (w || 1)) * 100))}%`);
      const others = [...stage.querySelectorAll(".sc-bub")].filter((o) => o !== b && !o.classList.contains("out"));
      const clash = () => {
        const r = b.getBoundingClientRect();
        return others.some((o) => {
          const q = o.getBoundingClientRect();
          return r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 4 && r.bottom > q.top - 4;
        });
      };
      for (let lift = 8; clash() && lift <= 200; lift += 8) b.style.top = PX(y - lift);
      setTimeout(() => {
        b.classList.add("out");
        setTimeout(() => b.remove(), 360);
      }, 4000);
    },
    /** A line: the roach shouts, its bubble comes, and its egg plays a moment after; false while the fight is off */
    say(h: number, text: string, egg: SceneEgg | undefined, play: (egg: SceneEgg, h: number) => void) {
      if (K.off) return false;
      const el = els[h];
      if (!el) return false;
      K.flash(el, "yell", 620);
      const [x, y] = K.pos(el);
      K.bubble(h, x, y - K.rs * 0.52 - 8, text);
      if (egg && !K.reduce) K.later(() => play(egg, h), 260);
      return true;
    },
    /** About 30 frames a second, only while the page shows, the stage is in sight and the fight is on */
    loop(step: (dt: number) => void) {
      let raf = 0;
      let t = 0;
      let drawn = 0;
      let seen = typeof IntersectionObserver === "undefined";
      const tick = (now: number) => {
        raf = 0;
        if (K.dead || !(seen && !document.hidden && !K.off)) return;
        const dt = Math.min(0.05, (now - t) / 1000);
        if (now - drawn >= 30) {
          t = now;
          drawn = now;
          step(dt);
        }
        raf = requestAnimationFrame(tick);
      };
      const kick = () => {
        if (K.reduce || K.dead) return;
        if (seen && !document.hidden && !K.off && !raf) {
          t = performance.now();
          raf = requestAnimationFrame(tick);
        }
      };
      if (typeof IntersectionObserver !== "undefined") {
        const io = new IntersectionObserver((es) => {
          seen = es.some((x) => x.isIntersecting);
          kick();
        });
        io.observe(stage);
        obs.push(io);
      }
      document.addEventListener("visibilitychange", kick);
      K.kick = kick;
      K.stopLoop = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        document.removeEventListener("visibilitychange", kick);
      };
      kick();
    },
    /** fn as the stage changes size (the sizes measured again first) */
    watchSize(fn: () => void) {
      if (typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => {
        const w = K.W;
        const hh = K.H;
        K.measure();
        if (w !== K.W || hh !== K.H) fn();
      });
      ro.observe(stage);
      obs.push(ro);
    },
    setOff(v: boolean) {
      K.off = v;
      stage.classList.toggle("off", v);
      K.kick();
    },
    destroy() {
      K.dead = true;
      K.stopLoop();
      for (const o of obs) o.disconnect();
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },
  };
  return K;
}

/** A monster's picture in a box w px wide, x, y its middle */
export function foeImg(kind: Foe) {
  const img = document.createElement("img");
  img.alt = "";
  img.src = FOE_SRC[kind];
  return img;
}
