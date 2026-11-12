/**
 * The screenshot check: the main screens of two builds side by side, pixel for pixel.
 * Moving text into src/i18n must change nothing a player sees, down to a space.
 *
 *   node scripts/i18n/screens.mjs --base http://localhost:3201 --now http://localhost:3202 --out /tmp/shots
 *     [--only <regexp of screen names>] [--keep]
 *
 * Needs Playwright with its Chromium (not one of the site's packages: `npm i -g playwright`
 * and `npx playwright install chromium`) and two builds running at once, the one before
 * (say main, in a git worktree) and this one, each on its own copy of the same database,
 * so both go through the same steps from the same start. scripts/i18n/screens-setup.sh
 * makes the database and starts both.
 *
 * Every screen is opened in both at once, step by step, at a phone's width (375) and a
 * computer's (1280), with the clock stopped, Math.random seeded, animations finished
 * and the map's own drawing (WebGL, which is not drawn the same twice) hidden: the
 * roaches, not the words. Then the two pictures are compared pixel by pixel, and the
 * page's text too. Different ones are saved with a third picture marking where.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

/** The session cookies of the signed-in players screens-setup.sh makes */
export const PLAYER = "shots-token-0001";
export const NEWCOMER = "shots-token-0002";

const WIDTHS = [
  { name: "phone", viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true },
  { name: "computer", viewport: { width: 1280, height: 800 } },
];

/** 2026-11-12 12:00 Beijing time */
const NOW = new Date("2026-11-12T04:00:00Z");

/** Click the first visible element matching, if there is one; a step that finds nothing is noted, not fatal */
async function tap(page, selector) {
  const el = page.locator(selector).filter({ visible: true }).first();
  try {
    if (await el.count()) await el.click({ timeout: 5000 });
    else page.notes?.push(`nothing to tap: ${selector}`);
  } catch (e) {
    page.notes?.push(`could not tap ${selector}: ${String(e.message).split("\n")[0]}`);
  }
}
const button = (name) => `role=button[name="${name}"]`;

/** Put away what greets a visitor first: the welcome card */
const welcomed = (p) => tap(p, button("去地图上看看"));

/**
 * Put away what greets a signed-in player first: a new badge, the site's notice, and the hint
 * above the style picker, which goes by itself after 6 seconds (a real timer, so the two builds
 * could be pictured on either side of it). 存到桌面's hint comes only after 20 more.
 */
async function settle(page) {
  for (const s of [button("先收着"), button("知道了"), button("关闭")]) {
    await tap(page, s);
    await page.waitForTimeout(300);
  }
  await page
    .locator(".style-hint")
    .waitFor({ state: "detached", timeout: 10000 })
    .catch(() => page.notes?.push("the style hint stayed"));
}

/**
 * The screens: who looks (nobody, a player, a newcomer), where, and the steps there.
 * Steps run in both builds at once; they must not depend on anything random.
 */
export const SCREENS = [
  { name: "visitor-home", as: null, steps: [] },
  { name: "visitor-map", as: null, steps: [welcomed] },
  { name: "visitor-login", as: null, steps: [welcomed, (p) => tap(p, button("登录"))] },
  { name: "visitor-radar", as: null, steps: [welcomed, (p) => tap(p, ".radar-btn")] },
  { name: "visitor-guide-amiya", as: null, steps: [welcomed, (p) => tap(p, button("阿米娅向导"))] },
  { name: "visitor-hot", as: null, steps: [welcomed, (p) => tap(p, ".hot-btn")] },
  { name: "privacy", as: null, path: "/privacy", full: true, steps: [] },
  { name: "player-greeting", as: PLAYER, steps: [] },
  { name: "player-home", as: PLAYER, steps: [settle] },
  { name: "player-profile", as: PLAYER, steps: [settle, (p) => tap(p, ".dock-me")] },
  { name: "player-inbox", as: PLAYER, steps: [settle, (p) => tap(p, ".dock-mail")] },
  { name: "player-friends", as: PLAYER, steps: [settle, (p) => tap(p, ".dock-friends")] },
  { name: "player-declare", as: PLAYER, steps: [settle, (p) => tap(p, ".actions .announce")] },
  { name: "player-mine", as: PLAYER, steps: [settle, (p) => tap(p, button("我的蟑螂"))] },
  { name: "player-radar", as: PLAYER, steps: [settle, (p) => tap(p, ".radar-btn")] },
  { name: "player-styles", as: PLAYER, steps: [settle, (p) => tap(p, ".style-pill")] },
  { name: "player-guide-perlica", as: PLAYER, steps: [settle, (p) => tap(p, button("佩丽卡监督"))] },
  { name: "player-guide-talulah", as: PLAYER, steps: [settle, (p) => tap(p, button("塔露拉干员"))] },
  { name: "player-guide-minghe", as: PLAYER, steps: [settle, (p) => tap(p, button("明河都尉"))] },
  { name: "player-identity", as: PLAYER, steps: [settle, (p) => tap(p, ".who")] },
  { name: "player-hot", as: PLAYER, steps: [settle, (p) => tap(p, ".hot-btn")] },
  { name: "player-desk", as: PLAYER, steps: [settle, (p) => tap(p, ".desk-btn")] },
  { name: "newcomer", as: NEWCOMER, steps: [] },
];

/** Seeded Math.random, a stopped clock, and the map's own drawing hidden (it still takes taps) */
function prepare(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    // and 塔露拉干员's fire, whose flames flicker on a clock of their own (it has no words)
    style.textContent = "canvas, .guide-fire { opacity: 0 !important; } * { caret-color: transparent !important; }";
    document.head.appendChild(style);
  });
}

async function open(browser, url, width, as) {
  const context = await browser.newContext({ ...width, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  if (as) await context.addCookies([{ name: "sid", value: as, url }]);
  await context.addInitScript(prepare, 20261112);
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

/** Pixels that differ between two PNGs, counted in a browser, with a picture marking them */
async function compare(page, a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const [x, y] = await Promise.all([load(a), load(b)]);
      const w = Math.max(x.width, y.width);
      const h = Math.max(x.height, y.height);
      const read = (img) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h);
      };
      const [p, q] = [read(x), read(y)];
      const out = new OffscreenCanvas(w, h);
      const g = out.getContext("2d");
      g.drawImage(y, 0, 0);
      g.fillStyle = "rgba(255,0,0,0.85)";
      let diff = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        if (p.data[i] !== q.data[i] || p.data[i + 1] !== q.data[i + 1] || p.data[i + 2] !== q.data[i + 2] || p.data[i + 3] !== q.data[i + 3]) {
          diff++;
          const n = i / 4;
          g.fillRect(n % w, Math.floor(n / w), 1, 1);
        }
      }
      const sizeDiffers = x.width !== y.width || x.height !== y.height;
      if (!diff && !sizeDiffers) return { diff: 0, sizeDiffers, marked: null };
      const blob = await out.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { diff, sizeDiffers, marked: btoa(s) };
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

export async function run({ base, now, out, only, keep }) {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const scratch = await (await browser.newContext()).newPage();
  const results = [];
  for (const screen of SCREENS.filter((s) => !only || new RegExp(only).test(s.name))) {
    for (const width of WIDTHS) {
      const name = `${screen.name}-${width.name}`;
      const sides = await Promise.all([base, now].map((url) => open(browser, url, width, screen.as)));
      const errors = [];
      for (const { page } of sides) {
        page.on("pageerror", (e) => errors.push(e.message));
        page.notes = [];
      }
      const path = `${screen.path ?? "/"}${(screen.path ?? "/") === "/" ? "?style=blank" : ""}`;
      await Promise.all(sides.map(({ page }, i) => page.goto(`${[base, now][i]}${path}`, { waitUntil: "networkidle" })));
      await Promise.all(sides.map(({ page }) => page.waitForTimeout(2500)));
      for (const step of screen.steps) {
        await Promise.all(sides.map(({ page }) => step(page)));
        await Promise.all(sides.map(({ page }) => page.waitForTimeout(1200)));
      }
      const shots = await Promise.all(
        sides.map(({ page }) => page.screenshot({ fullPage: Boolean(screen.full), animations: "disabled", caret: "hide" })),
      );
      const texts = await Promise.all(sides.map(({ page }) => page.evaluate(() => document.body.innerText)));
      const { diff, sizeDiffers, marked } = await compare(scratch, shots[0], shots[1]);
      const same = !diff && !sizeDiffers && texts[0] === texts[1];
      const notes = [...new Set(sides.flatMap(({ page }) => page.notes))];
      results.push({ name, same, diff, sizeDiffers, textSame: texts[0] === texts[1], errors, notes });
      if (!same || keep) {
        writeFileSync(join(out, `${name}-base.png`), shots[0]);
        writeFileSync(join(out, `${name}-now.png`), shots[1]);
        writeFileSync(join(out, `${name}-text.json`), JSON.stringify({ base: texts[0], now: texts[1] }, null, 1));
        if (marked) writeFileSync(join(out, `${name}-diff.png`), Buffer.from(marked, "base64"));
      }
      console.log(`${same ? "same     " : "DIFFERENT"}  ${name}${diff ? `  ${diff} pixels` : ""}${sizeDiffers ? "  (size)" : ""}${texts[0] === texts[1] ? "" : "  (text)"}${errors.length ? `  errors: ${errors.join("; ")}` : ""}${notes.length ? `  [${notes.join("; ")}]` : ""}`);
      await Promise.all(sides.map(({ context }) => context.close()));
    }
  }
  await browser.close();
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1));
  const bad = results.filter((r) => !r.same);
  console.log(bad.length ? `${bad.length} of ${results.length} screens differ (pictures in ${out})` : `All ${results.length} screens the same, pixel for pixel.`);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const results = await run({ base: opt("--base"), now: opt("--now"), out: opt("--out") ?? "/tmp/shots", only: opt("--only"), keep: argv.includes("--keep") });
  process.exitCode = results.every((r) => r.same) ? 0 : 1;
}
