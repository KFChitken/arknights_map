import { T } from "@/i18n";
import type { SceneEgg } from "@/lib/squad";
import { seatA, sideOf, slips, stopA, targetA } from "./geometry";
import { foeImg, kit, type SceneApi, type SceneOpts } from "./kit";

/**
 * A, 两边爬过来: the four stand in two columns (1 and 2 left, 3 and 4 right) and slugs crawl in from both sides, each
 * for one roach of its side, stopping in front of it. The roaches awake hit the nearest in reach; three hits break one
 * (a big one, nine). One left alone in front of a sleeping roach for a while slips past (漏！).
 */

type Slug = { el: HTMLElement; side: number; h: number; big: boolean; sneak: boolean; dir: number; x: number; y: number; hp: number; wait: number; dead: boolean; speed: number; stopX: number; said?: boolean };

export function sceneA(stage: HTMLElement, opt: SceneOpts): SceneApi {
  const K = kit(stage, opt);
  const st = { slugs: [] as Slug[], spawnIn: 0.4, cool: {} as Record<number, number>, fast: {} as Record<number, number>, n: 0 };
  stage.innerHTML = '<div class="glow"></div>';
  K.measure();
  const at = (h: number) => seatA(h, K.W, K.H);
  const feet = (h: number) => at(h)[1] + K.rs * 0.42;
  const geo = () => ({ W: K.W, H: K.H, rs: K.rs, ss: K.ss });
  const draw = () => {
    K.prune();
    for (const m of K.members()) {
      const [x, y] = at(m.h);
      K.roach(m, x, y);
    }
  };
  const place = (s: Slug) => {
    s.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`;
  };

  // a slug: x, y is the middle of its foot; dir +1 crawls right (as drawn), -1 left (mirrored)
  const spawn = (o: { side?: number; h?: number; big?: boolean; sneak?: boolean } = {}) => {
    if (!K.W) return null;
    const side = o.side ?? (st.n++ % 2 ? 1 : -1);
    const hs = side < 0 ? [1, 2] : [3, 4];
    const h = o.h ?? hs[Math.random() < 0.5 ? 0 : 1];
    const big = Boolean(o.big);
    const half = K.ss * (big ? 0.85 : 0.5);
    const el = document.createElement("div");
    const s: Slug = {
      el,
      side,
      h,
      big,
      sneak: Boolean(o.sneak),
      dir: -side,
      x: big ? (side < 0 ? half * 0.15 : K.W - half * 0.15) : side < 0 ? -half - 4 : K.W + half + 4,
      y: feet(h) + (Math.random() * 8 - 4),
      hp: big ? 9 : 3,
      wait: 0,
      dead: false,
      speed: K.ss * (o.sneak ? 1.15 : big ? 0.4 : 0.5 + Math.random() * 0.12),
      stopX: stopA(h, K.W, K.rs, K.ss, big),
    };
    el.className = `sc-s${s.dir < 0 ? " flip" : ""}${big ? " big" : ""}${s.sneak ? " sneak" : ""}`;
    const bd = document.createElement("div");
    bd.className = "bd";
    bd.appendChild(foeImg("slug"));
    el.appendChild(bd);
    place(s);
    stage.insertBefore(el, stage.children[1] ?? null);
    st.slugs.push(s);
    return s;
  };
  const shatter = (s: Slug) => {
    s.dead = true;
    const cx = s.x;
    const cy = s.y - K.ss * (s.big ? 0.55 : 0.32);
    K.shards(cx, cy, s.big ? 12 : 7, K.ss * (s.big ? 1.5 : 1));
    setTimeout(() => s.el.remove(), 40);
    if (s.big) {
      K.cheer();
      K.pop(cx, cy - K.ss * 0.5, T.squad.fight.bigDown);
    }
  };
  const hit = (s: Slug) => {
    if (s.dead) return;
    s.hp -= 1;
    s.x += s.side * 4;
    place(s);
    K.flash(s.el, "hit", 110);
    K.spark(s.x + s.dir * K.ss * (s.big ? 0.6 : 0.36), s.y - K.ss * (s.big ? 0.5 : 0.3));
    if (s.hp <= 0) shatter(s);
  };
  const attack = (h: number, s: Slug) => {
    const m = K.who(h);
    const el = K.els[h];
    if (!m || !el) return;
    const bd = el.querySelector(".bd")!;
    if (m.look === "hood" && m.pose !== 2) bd.replaceChildren(...K.body(m, true));
    K.flash(el, sideOf(h) < 0 ? "atk-l" : "atk-r", 340);
    K.later(() => hit(s), 120);
    K.later(() => {
      if (el.dataset.pose === String(m.pose)) bd.replaceChildren(...K.body(m));
    }, 360);
  };

  const step = (dt: number) => {
    const ms = K.members();
    st.spawnIn -= dt;
    const live = st.slugs.filter((s) => !s.dead);
    if (st.spawnIn <= 0) {
      if (live.length < opt.max) spawn();
      st.spawnIn = 1.5 + Math.random() * 1.4;
    }
    for (const s of live) {
      if (s.sneak) {
        s.x += s.dir * s.speed * dt;
        if (!s.said && Math.abs(s.x - at(s.h)[0]) < K.rs * 0.3) {
          s.said = true;
          K.pop(at(s.h)[0], at(s.h)[1] - K.rs * 0.55, T.squad.fight.miss);
        }
        if (s.x < -K.ss * 1.2 || s.x > K.W + K.ss * 1.2) {
          s.dead = true;
          s.el.remove();
        }
      } else if ((s.stopX - s.x) * s.dir > 0) {
        s.x = s.dir > 0 ? Math.min(s.stopX, s.x + s.speed * dt) : Math.max(s.stopX, s.x - s.speed * dt);
      } else {
        s.wait += dt;
        // nobody hits it for a while (its roach is asleep): it slips through
        if (slips(s.wait, s.big)) {
          s.sneak = true;
          s.speed = K.ss * 1.15;
          s.el.classList.add("sneak");
        }
      }
      if (!s.dead) place(s);
    }
    // each roach awake hits the nearest slug of its side in reach; the other of its side asleep, its reach is wider
    for (const m of ms) {
      if (!K.awake(m)) continue;
      st.cool[m.h] = (st.cool[m.h] ?? 0) - dt;
      if (st.cool[m.h] > 0) continue;
      const mate = ms.find((x) => x.h !== m.h && sideOf(x.h) === sideOf(m.h));
      const wide = !K.awake(mate) || (st.fast[m.h] ?? 0) > 0;
      const best = targetA(
        m.h,
        live.filter((s) => !s.dead),
        geo(),
        wide,
      );
      if (!best) continue;
      attack(m.h, best);
      st.cool[m.h] = (st.fast[m.h] ?? 0) > 0 ? 0.26 : 0.85 + Math.random() * 0.8;
    }
    for (const h of Object.keys(st.fast)) st.fast[Number(h)] -= dt;
    st.slugs = st.slugs.filter((s) => !s.dead);
  };

  draw();
  if (K.reduce) {
    // a still picture: a slug in front of 1 and of 3
    for (const h of [1, 3]) {
      const s = spawn({ side: sideOf(h), h });
      if (s) {
        s.x = s.stopX;
        place(s);
      }
    }
  } else K.loop(step);
  K.watchSize(() => {
    draw();
    for (const s of st.slugs) {
      s.stopX = stopA(s.h, K.W, K.rs, K.ss, s.big);
      s.y = feet(s.h);
      place(s);
    }
  });

  const event = (kind: SceneEgg, h: number) => {
    if (K.off || K.reduce) return;
    const el = K.els[h];
    const m = K.who(h);
    if (kind === "boss") spawn({ big: true, side: Math.random() < 0.5 ? -1 : 1 });
    else if (kind === "slip" && el) {
      K.flash(el, "shake", 950);
      spawn({ sneak: true, side: sideOf(h), h });
    } else if (kind === "push" && el) {
      K.flash(el, "spin", 640);
      K.later(() => {
        for (const s of st.slugs) {
          if (s.dead || s.sneak) continue;
          s.x += s.side * K.W * 0.3;
          s.wait = 0;
          place(s);
        }
        K.ring(...at(h));
      }, 300);
    } else if (kind === "cheer") K.cheer();
    else if (kind === "glitch" && el) K.flash(el, "glitch", 1300);
    else if (kind === "ring" && el) K.ring(...at(h));
    else if (kind === "frenzy" && m && K.awake(m)) {
      st.fast[h] = 1.6;
      st.cool[h] = 0;
      spawn({ side: sideOf(h), h });
    } else if (kind === "wave") {
      K.cheer();
      [0, 350, 700].forEach((d, i) => K.later(() => spawn({ side: i % 2 ? 1 : -1 }), d));
    }
  };

  return {
    sync: draw,
    say: (h, text, egg) => K.say(h, text, egg, event),
    setOff: K.setOff,
    end() {
      // the round over: every slug left breaks at once, the awake hop
      for (const s of st.slugs) if (!s.dead) shatter(s);
      st.slugs = [];
      st.spawnIn = Infinity;
      K.later(() => K.cheer(), 200);
    },
    destroy: K.destroy,
  };
}
