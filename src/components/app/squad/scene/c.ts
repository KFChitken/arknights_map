import { T } from "@/i18n";
import { AVATAR_PICTURES } from "@/lib/roachImages";
import { roachDataUrl } from "@/lib/roachSvg";
import type { SceneEgg } from "@/lib/squad";
import { ANG_C, ASPECT, cloudR, PUFFS, rimC, seatC, type Foe } from "./geometry";
import { FOE_SRC, kit, pick, rnd, TINT, type SceneApi, type SceneOpts } from "./kit";

/**
 * C, 混乱乱斗: a cartoon brawl cloud in the middle, the four at its rim swinging into it. Bits of roaches and monsters
 * poke out of it, words pop, monsters are thrown out (they break, blow up, crash or run off as they land) and walk in,
 * a roach is flung out now and then (it tumbles, sees stars, walks back), and every few seconds something silly.
 */

const KINDS: readonly Foe[] = ["slug", "slug", "acid", "infused", "hound", "drone"];
let clouds = 0;

type Flyer = { el: HTMLElement; kind: Foe; w: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number; ground: number; run?: boolean; done?: boolean };
type Walker = { el: HTMLElement; kind: Foe; w: number; x: number; y: number; dir: number; speed: number; fly: boolean };
type Away = { phase: "fly" | "dizzy" | "back" | "chase"; x: number; y: number; vx: number; vy: number; rot: number; vr: number; ground: number; t: number; fx: number; fy: number };
type Special = { step(dt: number): boolean };

export function sceneC(stage: HTMLElement, opt: SceneOpts): SceneApi {
  const K = kit(stage, opt);
  stage.innerHTML = '<div class="glow"></div><div class="sc-parts"></div><div class="sc-cloud"></div>';
  const parts = stage.querySelector<HTMLElement>(".sc-parts")!;
  const cloud = stage.querySelector<HTMLElement>(".sc-cloud")!;
  const gid = `scl${++clouds}`;
  const puffs = PUFFS.map(([x, y, r]) => ({ x, y, r, w: rnd(5, 9), p: rnd(0, 6.3) }));
  cloud.innerHTML =
    `<svg viewBox="-1.25 -1 2.5 2" aria-hidden="true"><defs><g id="${gid}">${puffs.map(() => '<circle cx="0" cy="0" r=".3"/>').join("")}</g></defs>` +
    `<use href="#${gid}" fill="#1b1d22" stroke="#1b1d22" stroke-width=".1"/><use href="#${gid}" fill="#f3efe6"/>` +
    '<g fill="none" stroke="#bdb4a3" stroke-width=".04" stroke-linecap="round"><path class="sw" d="M-.58 -.12 a.13 .13 0 1 1 .22 .06"/><path class="sw b" d="M.28 .16 a.15 .15 0 1 0 -.24 .02"/><path class="sw" d="M.06 -.44 a.11 .11 0 1 1 .18 .05"/></g></svg>';
  const circles = [...cloud.querySelectorAll("defs circle")];
  const G = { cx: 0, cy: 0, R: 80 };
  const C = { t: 0, scale: 1, scaleT: 1, sy: 1, syT: 1, hop: 0, frozen: 0, pokeIn: 0, wordIn: 0.2, throwIn: 1.2, walkIn: 0.4, ejectIn: 3.5, gagIn: 5, cool: {} as Record<number, number>, fast: {} as Record<number, number>, ended: false };
  const flyers: Flyer[] = [];
  const walkers: Walker[] = [];
  const specials: Special[] = [];
  const away: Record<number, Away> = {};

  const layout = () => {
    K.measure();
    G.R = cloudR(K.W, K.H);
    G.cx = K.W / 2;
    G.cy = K.H * 0.56;
    cloud.style.left = `${G.cx}px`;
    cloud.style.top = `${G.cy}px`;
    cloud.style.width = `${2.5 * G.R}px`;
    cloud.style.height = `${2 * G.R}px`;
  };
  // where the one numbered h stands: their seat's place at the rim
  const seat = (h: number) => seatC(K.seatOf(h), G, K.awake(K.who(h)));
  const draw = () => {
    K.prune();
    for (const m of K.members()) {
      if (away[m.h]) {
        K.roach(m);
        continue;
      }
      const [x, y] = seat(m.h);
      K.roach(m, x, y).classList.toggle("flail", m.pose === 0);
    }
  };
  const wobble = () => {
    const t = C.t;
    puffs.forEach((p, i) => {
      const c = circles[i];
      c.setAttribute("cx", (p.x + 0.035 * Math.sin(t * p.w * 0.7 + p.p * 2)).toFixed(3));
      c.setAttribute("cy", (p.y + 0.035 * Math.cos(t * p.w * 0.8 + p.p)).toFixed(3));
      c.setAttribute("r", (p.r * (1 + 0.08 * Math.sin(t * p.w + p.p))).toFixed(3));
    });
    const up = C.hop > 0 ? -Math.sin(Math.PI * (1 - C.hop / 0.55)) * G.R * 0.35 : 0;
    const j = K.reduce ? 0 : 1.6;
    cloud.style.transform = `translate(-50%,-50%) translate(${rnd(-j, j).toFixed(1)}px,${(up + rnd(-j, j)).toFixed(1)}px) scale(${C.scale.toFixed(3)},${(C.scale * C.sy).toFixed(3)})`;
  };
  const sprite = (kind: Foe, w: number, cls = "", layer: HTMLElement = parts) => {
    const el = document.createElement("div");
    el.className = `sc-fly${cls ? ` ${cls}` : ""}`;
    const h = w * ASPECT[kind];
    el.style.width = `${w.toFixed(0)}px`;
    el.style.height = `${h.toFixed(0)}px`;
    el.style.margin = `${(-h / 2).toFixed(0)}px 0 0 ${(-w / 2).toFixed(0)}px`;
    el.innerHTML = `<img alt="" src="${FOE_SRC[kind]}">`;
    layer.appendChild(el);
    return el;
  };
  const put = (el: HTMLElement, x: number, y: number, rot = 0, flip = false) => {
    el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)${rot ? ` rotate(${rot.toFixed(0)}deg)` : ""}${flip ? " scaleX(-1)" : ""}`;
  };
  const word = (text: string, x: number, y: number, cls = "") => K.fx(`sc-word${cls ? ` ${cls}` : ""}`, x, y, 780, text, { "--wr": `${rnd(-24, 24).toFixed(0)}deg` });
  const stars = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.28);
      K.fx("sc-star", x, y, 820, "★", { "--dx": `${(Math.cos(a) * K.rs * 0.9).toFixed(0)}px`, "--dy": `${(Math.sin(a) * K.rs * 0.7).toFixed(0)}px` });
    }
  };
  const rim = (a: number, k: number) => rimC(a, k, G);

  // a bit of someone sticking out of the cloud for a moment
  const poke = () => {
    const ms = K.members();
    let src: string;
    let w: number;
    let ar = 1;
    if (Math.random() < 0.4 && ms.length) {
      // a look that is a picture shows it as it is; the hood is drawn in TA's colour
      const m = pick(ms);
      src = AVATAR_PICTURES[m.look] ?? roachDataUrl(m.color, { avatar: "hood" });
      w = K.rs * 0.95;
    } else {
      const k = pick(KINDS);
      src = FOE_SRC[k];
      w = K.ss * (k === "drone" ? 0.85 : 1.08);
      ar = ASPECT[k];
    }
    const a = (rnd(-190, 12) * Math.PI) / 180;
    const [x, y] = rim(a, 0.92);
    const el = K.fx(
      "sc-part",
      x,
      y,
      900,
      "",
      {
        "--pw": `${w.toFixed(0)}px`,
        "--ph": `${(w * ar).toFixed(0)}px`,
        "--pr": `${((a * 180) / Math.PI + 90 + rnd(-35, 35)).toFixed(0)}deg`,
        "--ox": `${(Math.cos(a) * w * 0.42).toFixed(0)}px`,
        "--oy": `${(Math.sin(a) * w * 0.42).toFixed(0)}px`,
        "--pl": `${rnd(0.45, 0.85).toFixed(2)}s`,
      },
      parts,
    );
    el.innerHTML = `<img alt="" src="${src}">`;
  };
  const noise = () => {
    const a = rnd(-Math.PI * 1.05, 0.25);
    const [x, y] = rim(a, rnd(0.9, 1.25));
    word(pick(T.squad.fight.words), x, y, pick(["", "w", "o"]));
    if (Math.random() < 0.35) stars(x, y, 3);
  };
  // a monster thrown out of the cloud in an arc: it breaks, runs off or crashes where it lands
  const throwOut = (kind: Foe = pick(KINDS), ang?: number) => {
    const w = K.ss * (kind === "drone" ? 0.85 : 1.05);
    const el = sprite(kind, w);
    const a = ang ?? ((Math.random() < 0.5 ? rnd(-170, -115) : rnd(-65, -10)) * Math.PI) / 180;
    const sp = K.H * rnd(1.25, 1.65);
    flyers.push({ el, kind, w, x: G.cx + rnd(-0.2, 0.2) * G.R, y: G.cy - G.R * 0.1, vx: Math.cos(a) * sp * 0.75, vy: Math.sin(a) * sp, rot: 0, vr: rnd(380, 760) * (Math.cos(a) < 0 ? -1 : 1), ground: G.cy + G.R * rnd(0.55, 0.95) });
  };
  const land = (f: Flyer) => {
    const { x, y, kind } = f;
    if (kind === "hound") {
      // lands on its feet and runs off
      f.run = true;
      f.vx = (f.vx < 0 ? -1 : 1) * K.W * 0.9;
      f.y = f.ground;
      f.el.classList.add("run");
      word(T.squad.fight.howl, x, y - K.ss * 0.5, "w");
      return;
    }
    f.done = true;
    f.el.remove();
    if (kind === "infused") {
      K.fx("sc-boom", x, y, 680, "", { "--bs": "3.2" });
      word(T.squad.fight.boom, x, y - K.ss * 0.5, "o");
    } else word(kind === "drone" ? T.squad.fight.crash : pick([T.squad.fight.splat, T.squad.fight.crack]), x, y - K.ss * 0.4, kind === "drone" ? "w" : "");
    K.shards(x, y - K.ss * 0.2, kind === "infused" ? 10 : 7, K.ss * 0.9, TINT[kind]);
  };
  // a monster walking (or flying) in from the edge and diving into the cloud
  const walkIn = (kind: Foe = pick(KINDS), side: number = Math.random() < 0.5 ? -1 : 1, delay = 0) => {
    const fly = kind === "drone";
    const w = K.ss * (fly ? 0.75 : 0.9);
    const el = sprite(kind, w, kind === "hound" ? "run" : fly ? "hover" : "crawl");
    const o: Walker = {
      el,
      kind,
      w,
      x: side < 0 ? -w - delay : K.W + w + delay,
      y: fly ? rnd(K.H * 0.08, K.H * 0.26) : G.cy + G.R * rnd(0.4, 0.78),
      dir: -side,
      speed: K.ss * (kind === "hound" ? 3 : fly ? 1.7 : 1.1),
      fly,
    };
    put(el, o.x, o.y, 0, o.dir < 0);
    walkers.push(o);
  };
  // a roach flung out of the cloud: it tumbles, lands, sees stars, walks back
  const eject = (h: number) => {
    const m = K.who(h);
    const el = K.els[h];
    if (!m || !el || away[h]) return;
    const [x, y] = K.pos(el);
    const sx = x < G.cx ? -1 : 1;
    away[h] = { phase: "fly", x, y, vx: sx * K.W * rnd(0.22, 0.36), vy: -K.H * rnd(1.05, 1.35), rot: 0, vr: sx * rnd(520, 820), ground: Math.min(K.H - K.rs * 0.75, y + K.rs * rnd(0.3, 0.7)), t: 0, fx: x, fy: y };
    el.classList.remove("flail");
    el.classList.add("fly");
    K.pop(x, y - K.rs * 0.6, pick(T.squad.fight.help));
  };
  const moveAway = (h: number, dt: number) => {
    const a = away[h];
    const el = K.els[h];
    const m = K.who(h);
    if (!el || !m) {
      delete away[h];
      return;
    }
    const bd = el.querySelector<HTMLElement>(".bd")!;
    if (a.phase === "fly") {
      a.vy += K.H * 3.2 * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.vr * dt;
      if (a.x < K.rs * 0.5 || a.x > K.W - K.rs * 0.5) {
        a.vx = -a.vx * 0.6;
        a.x = Math.max(K.rs * 0.5, Math.min(K.W - K.rs * 0.5, a.x));
      }
      if (a.vy > 0 && a.y >= a.ground) {
        a.y = a.ground;
        a.phase = "dizzy";
        a.t = 0.9;
        bd.style.transform = "";
        el.classList.remove("fly");
        el.classList.add("dizzy");
        word(T.squad.fight.thud, a.x, a.y + K.rs * 0.2, "w");
      } else bd.style.transform = `rotate(${a.rot.toFixed(0)}deg)`;
    } else if (a.phase === "dizzy") {
      a.t -= dt;
      if (a.t <= 0) {
        a.phase = "back";
        a.t = 0;
        a.fx = a.x;
        a.fy = a.y;
        el.classList.remove("dizzy");
      }
    } else {
      a.t += dt / 0.6;
      const [sx, sy] = seat(h);
      const u = Math.min(1, a.t);
      a.x = a.fx + (sx - a.fx) * u;
      a.y = a.fy + (sy - a.fy) * u - Math.sin(Math.PI * u) * K.rs * 0.25;
      if (u >= 1) {
        delete away[h];
        draw();
        return;
      }
    }
    el.style.left = `${a.x.toFixed(1)}px`;
    el.style.top = `${a.y.toFixed(1)}px`;
  };

  // now and then something silly
  const gag = (k: "freeze" | "giant" | "chase" | "ride" | "hop" = pick(["freeze", "giant", "chase", "ride", "hop"] as const)) => {
    if (k === "freeze") {
      // everything stops for a moment ……
      C.frozen = 0.9;
      stage.classList.add("freeze");
      const d = K.fx("sc-word still", G.cx, G.cy - G.R * 1.05, 0, T.squad.fight.dots, { "--wr": "0deg" });
      K.later(() => {
        d.remove();
        stage.classList.remove("freeze");
        word(T.squad.fight.bang, G.cx, G.cy - G.R * 0.9, "o");
        throwOut();
        throwOut();
      }, 900);
    } else if (k === "giant") {
      // a big slug drops on the cloud, squashes it, and is sent flying
      const w = K.ss * 2.3;
      const el = sprite("slug", w, "giant", stage);
      const g = { x: G.cx + rnd(-0.15, 0.15) * G.R, y: -w, vx: 0, vy: 0, phase: "fall", t: 0, rot: 0 };
      specials.push({
        step(dt) {
          if (g.phase === "fall") {
            g.vy += K.H * 3 * dt;
            g.y += g.vy * dt;
            const sit = G.cy - G.R * 0.55;
            if (g.y >= sit) {
              g.y = sit;
              g.phase = "sit";
              g.t = 1.2;
              C.syT = 0.78;
              word(T.squad.fight.thud, g.x, sit - w * 0.3, "o");
              stars(g.x, sit, 4);
            }
          } else if (g.phase === "sit") {
            g.t -= dt;
            if (g.t <= 0) {
              g.phase = "up";
              g.vy = -K.H * 2.4;
              g.vx = pick([-1, 1]) * K.W * 0.5;
              C.syT = 1;
              word(T.squad.fight.flyAway, g.x, g.y - w * 0.4, "w");
            }
          } else {
            g.vy += K.H * 1.2 * dt;
            g.y += g.vy * dt;
            g.x += g.vx * dt;
            g.rot += 540 * dt;
            if (g.y < -w * 2 || g.x < -w * 2 || g.x > K.W + w * 2) {
              el.remove();
              return false;
            }
          }
          put(el, g.x, g.y, g.rot);
          return true;
        },
      });
    } else if (k === "chase") {
      // a hound chases one roach once round the cloud
      const ms = K.members().filter((m) => K.awake(m) && !away[m.h] && K.els[m.h]);
      if (!ms.length) return;
      const m = pick(ms);
      const el = K.els[m.h];
      const dog = sprite("hound", K.ss * 0.95, "run", stage);
      const a0 = ((ANG_C[m.seat] ?? 0) * Math.PI) / 180;
      away[m.h] = { phase: "chase", x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, ground: 0, t: 0, fx: 0, fy: 0 };
      el.classList.remove("flail");
      K.pop(...K.pos(el), T.squad.fight.run);
      let t = 0;
      specials.push({
        step(dt) {
          t += dt / 2.4;
          const u = Math.min(1, t);
          const a = a0 + u * Math.PI * 2;
          const pos = (b: number) => [G.cx + Math.cos(b) * G.R * 1.3, G.cy + Math.sin(b) * G.R * 1.0];
          const [x, y] = pos(a);
          el.style.left = `${x.toFixed(1)}px`;
          el.style.top = `${y.toFixed(1)}px`;
          const [dx, dy] = pos(a - 0.75);
          put(dog, dx, dy + K.rs * 0.15, 0, Math.sin(a - 0.75) > 0);
          if (u >= 1) {
            dog.remove();
            delete away[m.h];
            draw();
            word(T.squad.fight.whoosh, G.cx, G.cy, "w");
            return false;
          }
          return true;
        },
      });
    } else if (k === "ride") {
      // the drone flies over with a slug and drops it in
      const dir = pick([-1, 1]);
      const dr = sprite("drone", K.ss * 0.8, "hover", stage);
      const sl = sprite("slug", K.ss * 0.75, "", stage);
      const r = { x: dir < 0 ? K.W + K.ss : -K.ss, y: G.cy - G.R * 1.35, dropped: false, sx: 0, sy: 0, svy: 0 };
      specials.push({
        step(dt) {
          r.x += dir * K.ss * 2.4 * dt;
          put(dr, r.x, r.y);
          if (!r.dropped) {
            put(sl, r.x, r.y + K.ss * 0.55);
            if ((r.x - G.cx) * dir > 0) {
              r.dropped = true;
              r.sx = r.x;
              r.sy = r.y + K.ss * 0.55;
              word(T.squad.fight.drop, r.x, r.y - K.ss * 0.5, "o");
            }
          } else if (sl.parentNode) {
            r.svy += K.H * 3 * dt;
            r.sy += r.svy * dt;
            put(sl, r.sx, r.sy, r.sy * 2);
            if (r.sy > G.cy - G.R * 0.2) {
              sl.remove();
              word(T.squad.fight.whoosh, r.sx, G.cy - G.R * 0.5, "w");
            }
          }
          if (r.x < -K.ss * 2 || r.x > K.W + K.ss * 2) {
            dr.remove();
            sl.remove();
            return false;
          }
          return true;
        },
      });
    } else if (k === "hop") {
      C.hop = 0.55;
      K.later(() => {
        word(T.squad.fight.thud, G.cx, G.cy + G.R * 0.75, "o");
        stars(G.cx, G.cy + G.R * 0.7, 3);
      }, 550);
    }
  };

  const step = (dt: number) => {
    if (C.frozen > 0) {
      C.frozen -= dt;
      return;
    }
    C.t += dt;
    C.scale += (C.scaleT - C.scale) * Math.min(1, dt * 5);
    C.sy += (C.syT - C.sy) * Math.min(1, dt * 9);
    if (C.hop > 0) C.hop = Math.max(0, C.hop - dt);
    wobble();
    if (!C.ended) {
      C.pokeIn -= dt;
      if (C.pokeIn <= 0) {
        if (parts.querySelectorAll(".sc-part").length < 7) poke();
        C.pokeIn = rnd(0.12, 0.3);
      }
      C.wordIn -= dt;
      if (C.wordIn <= 0) {
        noise();
        C.wordIn = rnd(0.3, 0.65);
      }
      C.throwIn -= dt;
      if (C.throwIn <= 0) {
        throwOut();
        C.throwIn = rnd(1.4, 2.6);
      }
      C.walkIn -= dt;
      if (C.walkIn <= 0) {
        walkIn();
        C.walkIn = rnd(1, 2);
      }
      C.ejectIn -= dt;
      if (C.ejectIn <= 0) {
        const ms = K.members().filter((m) => !away[m.h] && K.els[m.h]);
        if (ms.length) eject(pick(ms).h);
        C.ejectIn = rnd(4.5, 7.5);
      }
      C.gagIn -= dt;
      if (C.gagIn <= 0) {
        gag();
        C.gagIn = rnd(5.5, 8.5);
      }
      // the roaches at the rim keep swinging into the cloud
      for (const m of K.members()) {
        if (!K.awake(m) || away[m.h] || !K.els[m.h]) continue;
        if (C.cool[m.h] === undefined) C.cool[m.h] = rnd(0.1, 0.8);
        C.cool[m.h] -= dt;
        if (C.cool[m.h] > 0) continue;
        K.swing(m, G.cx, G.cy, K.rs * 0.38);
        C.cool[m.h] = (C.fast[m.h] ?? 0) > 0 ? 0.18 : rnd(0.5, 1.1);
      }
    }
    for (const h of Object.keys(C.fast)) C.fast[Number(h)] -= dt;
    for (const h of Object.keys(away)) if (away[Number(h)].phase !== "chase") moveAway(Number(h), dt);
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      if (f.run) f.x += f.vx * dt;
      else {
        f.vy += K.H * 3.2 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
        if (f.vy > 0 && f.y >= f.ground) land(f);
      }
      if (!f.done && (f.x < -f.w * 2 || f.x > K.W + f.w * 2 || f.y > K.H + f.w)) {
        f.done = true;
        f.el.remove();
      }
      if (f.done) flyers.splice(i, 1);
      else put(f.el, f.x, f.y, f.run ? 0 : f.rot, Boolean(f.run && f.vx < 0));
    }
    for (let i = walkers.length - 1; i >= 0; i--) {
      const o = walkers[i];
      o.x += o.dir * o.speed * dt;
      if (o.fly) o.y += (G.cy - G.R * 0.5 - o.y) * Math.min(1, dt * 1.2);
      put(o.el, o.x, o.y, 0, o.dir < 0);
      if (Math.abs(o.x - G.cx) < G.R * (o.fly ? 0.5 : 0.85)) {
        o.el.classList.add("dive");
        const gone = o.el;
        setTimeout(() => gone.remove(), 260);
        walkers.splice(i, 1);
        if (Math.random() < 0.5) word(T.squad.fight.whoosh, o.x, o.y - o.w * 0.4, "w");
      }
    }
    for (let i = specials.length - 1; i >= 0; i--) if (!specials[i].step(dt)) specials.splice(i, 1);
  };

  layout();
  draw();
  wobble();
  if (K.reduce) {
    // a still picture: the cloud, the roaches round it, three bits and three words
    for (const [k, a] of [
      ["slug", -2.2],
      ["hound", -0.8],
      ["drone", -1.6],
    ] as const) {
      const [x, y] = rim(a, 1);
      const el = K.fx("sc-part", x, y, 0, "", { "--pw": `${(K.ss * 0.9).toFixed(0)}px`, "--ph": `${(K.ss * 0.9 * ASPECT[k]).toFixed(0)}px`, "--pr": "0deg", "--ox": "0px", "--oy": "0px" }, parts);
      el.style.transform = `rotate(${((a * 180) / Math.PI + 90).toFixed(0)}deg)`;
      el.innerHTML = `<img alt="" src="${FOE_SRC[k]}">`;
    }
    for (const [t, a, k] of [
      [T.squad.fight.words[0], -2.6, 1.2],
      [T.squad.fight.words[1], -0.5, 1.15],
      [T.squad.fight.words[5], -1.55, 1.25],
    ] as const) {
      const [x, y] = rim(a, k);
      K.fx("sc-word", x, y, 0, t, { "--wr": "-12deg" });
    }
  } else K.loop(step);
  K.watchSize(() => {
    layout();
    draw();
    wobble();
  });

  const event = (kind: SceneEgg, h: number) => {
    if (K.off || K.reduce) return;
    const el = K.els[h];
    const m = K.who(h);
    if (kind === "boss") gag("giant");
    else if (kind === "slip" && el) {
      K.flash(el, "shake", 950);
      K.later(() => {
        eject(h);
        // and a slug runs off past where it stood
        const [x] = seat(h);
        const s = sprite("slug", K.ss * 0.8, "crawl");
        const dir = x < G.cx ? -1 : 1;
        flyers.push({ el: s, kind: "slug", w: K.ss * 0.8, x: G.cx + dir * G.R * 0.6, y: G.cy + G.R * 0.7, vx: dir * K.W * 0.7, vy: 0, run: true, rot: 0, vr: 0, ground: 0 });
        K.later(() => K.pop(x, G.cy + G.R * 0.25, T.squad.fight.miss), 350);
      }, 300);
    } else if (kind === "push" && el) {
      K.flash(el, "spin", 640);
      K.later(() => {
        // everything inside is blown out at once
        for (const d of [-168, -138, -108, -72, -42, -12]) throwOut(undefined, ((d + rnd(-8, 8)) * Math.PI) / 180);
        C.scaleT = 0.6;
        word(T.squad.fight.bang, G.cx, G.cy - G.R * 0.2, "o");
        K.ring(...K.pos(el));
        K.later(() => (C.scaleT = 1), 1300);
      }, 300);
    } else if (kind === "cheer") {
      K.cheer("hop2");
      word(T.squad.fight.yay, G.cx, G.cy - G.R * 1.05, "o");
    } else if (kind === "glitch") {
      if (el) K.flash(el, "glitch", 1300);
      K.flash(stage, "glitchall", 1150);
    } else if (kind === "ring" && el) K.ring(...K.pos(el));
    else if (kind === "frenzy" && m && K.awake(m) && !away[h] && el) {
      C.fast[h] = 1.6;
      C.cool[h] = 0;
      K.flash(el, "whirl", 1000);
      [0, 300, 600].forEach((d) => K.later(() => throwOut(), d));
    } else if (kind === "wave") {
      // a convoy runs in from one side, all into the cloud
      const side = pick([-1, 1]);
      (["hound", "slug", "acid", "drone", "infused"] as const).forEach((k, i) => walkIn(k, side, i * K.ss * 0.75));
      K.later(() => {
        C.scaleT = 1.2;
        K.cheer();
      }, 1300);
      K.later(() => (C.scaleT = 1), 2600);
    }
  };

  return {
    sync: draw,
    say: (h, text, egg) => K.say(h, text, egg, event),
    setOff: K.setOff,
    end() {
      // the round over: the cloud goes 噗, what was in it flies out, the awake hop
      C.ended = true;
      C.scaleT = 0;
      for (const d of [-160, -120, -60, -20]) throwOut(undefined, ((d + rnd(-8, 8)) * Math.PI) / 180);
      K.later(() => K.cheer(), 300);
    },
    destroy: K.destroy,
  };
}
