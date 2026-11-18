import { T } from "@/i18n";
import type { SceneEgg } from "@/lib/squad";
import { ASPECT, behindB, bossAt, bossHp, BOSSES, bossWidth, seatB, type Foe } from "./geometry";
import { FOE_SRC, kit, pick, rnd, TINT, type FightMember, type SceneApi, type SceneOpts } from "./kit";

/**
 * B, 围着打一只大的: one big monster in the middle, the four round it taking turns to hit, a boss bar on top. 源石虫
 * and 高能源石虫 hop and slam the ground now and then (the awake dodge or are knocked back), 酸液源石虫 spits acid (防御↓
 * on the one it hits); 高能源石虫 blows up as it breaks, as in the game. Then the next drops in from above.
 */

type Shot = { el: HTMLElement; m: FightMember; x0: number; y0: number; x1: number; y1: number; t: number; dur: number; peak: number };
type Sneak = { el: HTMLElement; x: number; y: number; dir: number; rx: number; speed: number; said: boolean };

export function sceneB(stage: HTMLElement, opt: SceneOpts): SceneApi {
  const K = kit(stage, opt);
  stage.innerHTML = '<div class="glow"></div>';
  const S = {
    i: Math.floor(Math.random() * BOSSES.length),
    kind: "slug" as Foe,
    hp: 0,
    max: 0,
    big: false,
    bigNext: false,
    alive: false,
    gap: 0.2,
    busy: 0,
    cool: {} as Record<number, number>,
    fast: {} as Record<number, number>,
    moveIn: 4,
    faceIn: 2,
    dir: 1,
    shots: [] as Shot[],
    sneaks: [] as Sneak[],
    comboAt: 0,
    ended: false,
  };
  const G = { cx: 0, gy: 0, bw: 120 };
  const hpEl = document.createElement("div");
  hpEl.className = "sc-hp out";
  hpEl.innerHTML = "<b></b><i><s></s></i>";
  const mon = document.createElement("div");
  mon.className = "sc-boss";
  mon.style.visibility = "hidden";
  mon.innerHTML = '<div class="mv"><div class="gr"><div class="bd"><img alt=""></div></div></div>';
  stage.appendChild(mon);
  stage.appendChild(hpEl);
  const mv = mon.querySelector<HTMLElement>(".mv")!;
  const gr = mon.querySelector<HTMLElement>(".gr")!;
  const grow = () => (S.big ? 1.3 : 1);
  const bh = () => G.bw * ASPECT[S.kind];
  const seat = (h: number) => seatB(h, { ...G, rs: K.rs, grow: grow() });

  const layout = () => {
    K.measure();
    G.bw = bossWidth(K.W, K.H);
    G.cx = K.W / 2;
    G.gy = K.H * 0.7;
    mon.style.left = `${G.cx}px`;
    mon.style.top = `${G.gy}px`;
    mon.style.width = `${G.bw}px`;
    mon.style.height = `${bh()}px`;
    // the name and blood bar at the top, as a boss's, out of the way of the roaches and bubbles
    hpEl.style.left = `${G.cx}px`;
    hpEl.style.top = `${Math.round(6 + K.H * 0.02)}px`;
    hpEl.style.width = `${Math.round(Math.min(K.W * 0.62, 300))}px`;
  };
  // the two at the back stand behind the monster, the front two in front of it
  const draw = () => {
    K.prune();
    for (const m of K.members()) {
      const [x, y] = seat(m.h);
      K.roach(m, x, y).style.zIndex = behindB(m.h) ? "1" : "3";
    }
  };
  // the middle of the monster as it is on screen now (pushed, grown or not)
  const body = (): [number, number] => {
    const r = gr.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return [r.left - s.left + r.width / 2, r.top - s.top + r.height * 0.58];
  };
  const setHp = () => {
    hpEl.querySelector("s")!.style.width = `${Math.max(0, (S.hp / S.max) * 100).toFixed(1)}%`;
  };
  const label = () => {
    hpEl.querySelector("b")!.textContent = `${T.squad.foe[S.kind]}${S.big ? `${T.squad.dot}${T.squad.fight.big}` : ""}`;
  };

  const enter = () => {
    S.kind = bossAt(S.i++);
    S.big = S.bigNext;
    S.bigNext = false;
    S.max = S.hp = bossHp(S.kind, S.big);
    S.alive = true;
    S.dir = Math.random() < 0.5 ? -1 : 1;
    S.moveIn = rnd(3.2, 5);
    mon.querySelector("img")!.src = FOE_SRC[S.kind];
    mon.className = `sc-boss k-${S.kind}${S.dir < 0 ? " flip" : ""}`;
    mon.style.setProperty("--grow", String(grow()));
    mon.style.visibility = "";
    layout();
    draw();
    label();
    setHp();
    if (K.reduce) {
      hpEl.classList.remove("out");
      return;
    }
    S.busy = 0.75;
    mon.style.setProperty("--drop", `${-(G.gy + bh() * 1.4).toFixed(0)}px`);
    K.flash(mon, "drop", 700);
    K.later(() => {
      K.fx("sc-quake", G.cx, G.gy - 4, 720);
      hpEl.classList.remove("out");
      K.pop(G.cx + G.bw * 0.5, G.gy - bh() * 0.2, T.squad.fight.thud, "big");
      for (const m of K.members()) if (!K.awake(m) && K.els[m.h]) K.flash(K.els[m.h], "bump", 520);
    }, 470);
  };
  const knock = (m: FightMember, hard: boolean) => {
    const el = K.els[m.h];
    if (!el) return;
    if (!K.awake(m)) {
      K.flash(el, "bump", 520);
      return;
    }
    const sx = K.pos(el)[0] < G.cx ? -1 : 1;
    el.style.setProperty("--kx", `${(sx * K.rs * (hard ? 0.7 : 0.38)).toFixed(0)}px`);
    el.style.setProperty("--kr", `${sx * (hard ? 38 : 18)}deg`);
    K.flash(el, "knock", 640);
    if (hard || Math.random() < 0.45) {
      const [x, y] = K.pos(el);
      K.pop(x, y - K.rs * 0.62, pick(T.squad.fight.ouch));
    }
  };
  const die = () => {
    S.alive = false;
    const [bx, by] = body();
    const top = by - bh() * grow() * 0.6 - (Date.now() - S.comboAt < 700 ? 30 : 0);
    hpEl.classList.add("out");
    if (S.kind === "infused") {
      // it blows up as it breaks, as in the game
      K.fx("sc-boom", bx, by, 680, "", { "--bs": ((G.bw * grow()) / 30 * 1.5).toFixed(1) });
      K.flash(stage, "quake", 420);
      for (const m of K.members()) knock(m, true);
      K.pop(bx, top, T.squad.fight.boom, "big");
    } else {
      K.pop(bx, top, S.big ? T.squad.fight.bigDown : T.squad.fight.ko, "big");
      K.later(() => K.cheer(), 200);
    }
    K.shards(bx, by, S.big ? 18 : 14, G.bw * grow() * 0.85, TINT[S.kind]);
    mon.style.visibility = "hidden";
    S.gap = 1.7;
    for (const p of S.shots) p.el.remove();
    S.shots = [];
  };
  const hit = (m: FightMember | undefined, crit: boolean) => {
    if (!S.alive) return;
    S.hp -= crit ? Math.max(1, S.max * 0.25) : 1;
    const el = m ? K.els[m.h] : undefined;
    const [bx, by] = body();
    const [rx, ry] = el ? K.pos(el) : [bx, by];
    const d = Math.hypot(rx - bx, ry - by) || 1;
    const px = bx + ((rx - bx) / d) * G.bw * grow() * 0.3;
    const py = by + ((ry - by) / d) * G.bw * grow() * 0.15;
    K.spark(px, py);
    K.dmg(px, py - 14, crit);
    K.flash(mon, "hit", 110);
    setHp();
    if (S.hp <= 0) die();
  };
  const swingAt = (m: FightMember) => {
    const [bx, by] = body();
    K.swing(m, bx, by, K.rs * 0.42);
    K.later(() => hit(m, false), 130);
  };
  // its own move, every few seconds
  const move = () => {
    const kind = S.kind;
    if (kind === "acid") {
      K.flash(mon, "charge", 520);
      S.busy = 0.6;
      K.later(() => {
        if (!S.alive) return;
        const awake = K.members().filter((m) => K.els[m.h]);
        const n = Math.random() < 0.4 ? 2 : 1;
        for (let i = 0; i < n && awake.length; i++) {
          const m = awake.splice(Math.floor(Math.random() * awake.length), 1)[0];
          const [bx, by] = body();
          const [tx, ty] = K.pos(K.els[m.h]);
          const el = K.fx("sc-blob", bx, by, 0);
          S.shots.push({ el, m, x0: bx + (tx > bx ? 1 : -1) * G.bw * 0.3, y0: by - bh() * 0.2, x1: tx, y1: ty, t: -i * 0.18, dur: 0.55, peak: K.rs * 0.9 });
        }
      }, 480);
    } else {
      K.flash(mon, "charge", 760);
      S.busy = 1.3;
      K.later(() => {
        if (S.alive) K.flash(mon, "slam", 540);
      }, 760);
      K.later(() => {
        if (!S.alive) return;
        K.fx(`sc-quake${kind === "infused" ? " ember" : ""}`, G.cx, G.gy - 4, 720);
        for (const m of K.members()) {
          const el = K.els[m.h];
          if (!el) continue;
          if (K.awake(m) && Math.random() < 0.5) K.flash(el, "dodge", 520);
          else knock(m, false);
        }
      }, 1180);
    }
    S.moveIn = kind === "acid" ? rnd(2.8, 4.2) : rnd(4.2, 6.5);
  };
  // 我是漏勺我是区: a small slug squeezes out from under the big one and runs past this roach
  const sneak = (h: number) => {
    const el = K.els[h];
    if (!el) return;
    const [x, y] = K.pos(el);
    const dir = x < G.cx ? -1 : 1;
    const w = K.ss * 0.8;
    const s = document.createElement("div");
    s.className = `sc-s sneak${dir < 0 ? " flip" : ""}`;
    s.style.width = `${w}px`;
    s.style.height = `${w * 0.68}px`;
    s.style.margin = `${-w * 0.62}px 0 0 ${-w / 2}px`;
    s.innerHTML = `<div class="bd"><img alt="" src="${FOE_SRC.slug}"></div>`;
    stage.appendChild(s);
    S.sneaks.push({ el: s, x: G.cx, y: y + K.rs * 0.42, dir, rx: x, speed: K.ss * 1.5, said: false });
  };
  // 我全防出去了啊: the monster is shoved away from this roach, then crawls back
  const shove = (h: number) => {
    const el = K.els[h];
    if (!el || !S.alive) return;
    const [x, y] = K.pos(el);
    const dx = (x < G.cx ? 1 : -1) * K.W * 0.14;
    mv.style.transition = "transform .22s ease-out";
    mv.style.transform = `translateX(${dx.toFixed(0)}px)`;
    K.flash(mon, "hit", 160);
    K.ring(x, y);
    K.later(() => {
      mv.style.transition = "transform 1.4s ease-in-out";
      mv.style.transform = "";
    }, 520);
  };

  const step = (dt: number) => {
    if (!S.alive) {
      if (!S.ended) {
        S.gap -= dt;
        if (S.gap <= 0) enter();
      }
    } else {
      S.busy -= dt;
      S.faceIn -= dt;
      if (S.faceIn <= 0 && S.busy <= 0) {
        const ms = K.members().filter((m) => K.awake(m) && K.els[m.h]);
        if (ms.length) {
          const d = K.pos(K.els[pick(ms).h])[0] < G.cx ? -1 : 1;
          if (d !== S.dir) {
            S.dir = d;
            mon.classList.toggle("flip", d < 0);
          }
        }
        S.faceIn = rnd(1.6, 3);
      }
      S.moveIn -= dt;
      if (S.moveIn <= 0 && S.busy <= 0) move();
      // the roaches take turns hitting it
      for (const m of K.members()) {
        if (!K.awake(m) || S.busy > 0.45) continue;
        if (S.cool[m.h] === undefined) S.cool[m.h] = rnd(0.1, 0.9);
        S.cool[m.h] -= dt;
        if (S.cool[m.h] > 0) continue;
        swingAt(m);
        S.cool[m.h] = (S.fast[m.h] ?? 0) > 0 ? 0.2 : rnd(0.75, 1.45);
      }
    }
    for (const h of Object.keys(S.fast)) S.fast[Number(h)] -= dt;
    // acid in the air
    S.shots = S.shots.filter((p) => {
      p.t += dt;
      if (p.t < 0) return true;
      const u = Math.min(1, p.t / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * u;
      const y = p.y0 + (p.y1 - p.y0) * u - p.peak * 4 * u * (1 - u);
      p.el.style.left = `${x.toFixed(1)}px`;
      p.el.style.top = `${y.toFixed(1)}px`;
      if (u < 1) return true;
      p.el.remove();
      const el = K.els[p.m.h];
      if (el) {
        K.flash(el, "acid", 2200);
        K.fx("sc-splash", p.x1, p.y1, 500);
        K.pop(p.x1, p.y1 - K.rs * 0.62, T.squad.fight.defDown, "acidt");
      }
      return false;
    });
    // the little slug that slipped out
    S.sneaks = S.sneaks.filter((s) => {
      s.x += s.dir * s.speed * dt;
      s.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)`;
      if (!s.said && (s.x - s.rx) * s.dir > -K.rs * 0.2) {
        s.said = true;
        K.pop(s.rx, s.y - K.rs * 1.05, T.squad.fight.miss);
      }
      if (s.x < -K.ss || s.x > K.W + K.ss) {
        s.el.remove();
        return false;
      }
      return true;
    });
  };

  layout();
  draw();
  if (K.reduce) {
    // a still picture: the monster in the middle, its bar six tenths full
    enter();
    S.hp = Math.round(S.max * 0.6);
    setHp();
  } else K.loop(step);
  K.watchSize(() => {
    layout();
    draw();
  });

  const event = (kind: SceneEgg, h: number) => {
    if (K.off || K.reduce) return;
    const el = K.els[h];
    const m = K.who(h);
    if (kind === "boss") {
      if (S.alive && !S.big) {
        S.big = true;
        S.hp += S.max * 0.5;
        S.max *= 1.5;
        mon.style.setProperty("--grow", String(grow()));
        layout();
        draw();
        label();
        setHp();
        K.pop(G.cx, G.gy - bh() * grow() - 34, T.squad.fight.grow, "big");
      } else if (!S.alive) S.bigNext = true;
    } else if (kind === "slip" && el) {
      K.flash(el, "shake", 950);
      sneak(h);
    } else if (kind === "push" && el) {
      K.flash(el, "spin", 640);
      K.later(() => shove(h), 300);
    } else if (kind === "cheer") K.cheer();
    else if (kind === "glitch" && el) K.flash(el, "glitch", 1300);
    else if (kind === "ring" && el) K.ring(...K.pos(el));
    else if (kind === "frenzy" && m && K.awake(m)) {
      S.fast[h] = 1.6;
      S.cool[h] = 0;
    } else if (kind === "wave" && S.alive) {
      // everyone at once
      const ms = K.members().filter((x) => K.awake(x));
      ms.forEach((x, i) => K.later(() => K.swing(x, ...body(), K.rs * 0.5), i * 70));
      K.later(
        () => {
          if (!S.alive) return;
          const [bx, by] = body();
          S.comboAt = Date.now();
          K.pop(bx, by - bh() * grow() * 0.45, T.squad.fight.combo, "big");
          hit(ms[0] ?? m, true);
        },
        ms.length * 70 + 120,
      );
      for (const x of ms) S.cool[x.h] = rnd(0.8, 1.2);
    }
  };

  return {
    sync: draw,
    say: (h, text, egg) => K.say(h, text, egg, event),
    setOff: K.setOff,
    end() {
      // the round over: the monster breaks (高能源石虫 blows up all the same), and no next comes
      S.ended = true;
      if (S.alive) die();
    },
    destroy: K.destroy,
  };
}
