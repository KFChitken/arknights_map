import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FISH_ITEMS, inDex } from "@/lib/fish/items";
import CatchPage from "./CatchPage";
import FishCard, { nameOf, wordsOf } from "./FishCard";
import { CAST_MS, LEAP_MS, poseAt as at, REEL_MS, type FishPhase } from "./pose";
import { WIN_PIER as SPOTS } from "./WinScene";

const poseAt = (phase: FishPhase, ms: number) => at(phase, ms, SPOTS);

describe("钓鳞's items", () => {
  it("have words for each item in the dex, a name and both lines for each that can bite, and a picture each", () => {
    for (const item of FISH_ITEMS.filter(inDex)) {
      const w = wordsOf(item.key);
      expect(w, item.key).not.toBeNull();
      if (!item.off) {
        expect(w!.name, item.key).not.toBe("");
        expect(w!.use, item.key).not.toBe("");
        expect(w!.flavor, item.key).not.toBe("");
      } else if (!w!.name) expect(w!.hint, item.key).toBeTruthy();
      expect(existsSync(path.join(process.cwd(), "public", "fish", `${item.key}.webp`)), item.key).toBe(true);
    }
    // numbered from 1, once each
    const nos = FISH_ITEMS.map((i) => i.no);
    expect(new Set(nos).size).toBe(nos.length);
    expect(Math.min(...nos)).toBe(1);
  });

  it("name a variant before the item, and none with no words yet", () => {
    expect(nameOf(21)).toBe("炎国锦鲤");
    expect(nameOf(21, 2)).toBe("源石结晶的炎国锦鲤");
    expect(nameOf(1, 7)).toBe("巨大的河鳞");
    expect(nameOf(8)).toBe("落日鳞");
    expect(nameOf(999)).toBe("???");
  });

  it("sit on a disc of their rarity, the size where the game writes how many, dark and pale before they are caught", () => {
    const disc = renderToStaticMarkup(createElement(FishCard, { no: 21, variant: 2, size: 150, cm: 6320 }));
    expect(disc).toContain('class="fish-disc r4 "');
    expect(disc).toContain("--d:150px");
    expect(disc).toContain('src="/fish/koi.webp"');
    expect(disc).toContain('class="v-crystal"');
    expect(disc).toContain("63.20<small>cm</small>");
    expect(renderToStaticMarkup(createElement(FishCard, { no: 5, size: 66, locked: true }))).toContain('class="fish-disc r3 locked "');
    expect(renderToStaticMarkup(createElement(FishCard, { no: 5, size: 14, bare: true }))).not.toContain("<img");
  });

  it("get a page of their own in the window with NEW the first time, 新纪录 with the site's biggest, and a gold light from purple up", () => {
    const page = (c: Partial<Parameters<typeof CatchPage>[0]["caught"]>) =>
      renderToStaticMarkup(
        createElement(CatchPage, {
          caught: { no: 5, variant: 0, cm: 2460, tier: 3, onTime: false, first: true, record: false, n: 1, top: 2460, ...c },
          onClose: () => {},
        }),
      );
    const first = page({});
    expect(first).toContain(">NEW</em>");
    expect(first).toContain("No.005 · 稀有度 3 · 第一次钓到这一种");
    expect(first).toContain('class="halo"');
    const purple = page({ no: 21, tier: 4, cm: 7106, first: false, record: true, n: 3, top: 7106 });
    expect(purple).not.toContain(">NEW</em>");
    expect(purple).toContain("新纪录");
    expect(purple).toContain("你钓过最大的炎国锦鲤，全站最大 71.06 cm");
    expect(purple).toContain('<b class="rec">新纪录</b>No.021 · 稀有度 4 · 第 3 次钓到');
    expect(purple).toContain('class="halo gold"');
    expect(page({ no: 21, variant: 2, tier: 4, cm: 6320 })).toContain("变异「源石结晶的」第一次钓到");
  });
});

describe("the bank's rod and line", () => {
  it("throw the float out to the water, drag the catch in under it, and land it by the roach", () => {
    expect(poseAt("idle", 0).line).toBeNull();
    expect(poseAt("wait", 0).bob).toEqual(SPOTS.B);
    const cast = poseAt("cast", CAST_MS);
    expect(cast.bob![0]).toBeCloseTo(SPOTS.B[0], 0);
    expect(cast.bob![1]).toBeCloseTo(SPOTS.B[1], 0);
    const reel = poseAt("reel", REEL_MS);
    expect(reel.fish?.under).toBe(true);
    expect(reel.fish!.at[0]).toBeCloseTo(SPOTS.S[0], 0);
    const leap = poseAt("leap", LEAP_MS);
    expect(leap.fish?.under).toBe(false);
    expect(leap.fish!.at[0]).toBeCloseTo(SPOTS.K[0], 0);
    expect(leap.fish!.at[1]).toBeCloseTo(SPOTS.K[1], 0);
  });
});
