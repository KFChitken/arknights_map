import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { BADGES, badgeById, badgeTotal, earnableCount, wallBadges } from "./badges";
import {
  answerLove,
  dailyLine,
  HAIMAO_BADGE,
  HAIMAO_DAILY,
  HAIMAO_DAYS,
  HAIMAO_FACES,
  haimaoFaceUrl,
  storyEnd,
  storyScene,
  storyShape,
} from "./haimaoStory";

describe("香艳制作人's story", () => {
  it("has a line of words for every line said, every answer and every reply, word for word as approved", () => {
    const words = T.lib.haimao.story;
    const shape = storyShape();
    expect(shape.days).toHaveLength(HAIMAO_DAYS);
    expect(words.days).toHaveLength(HAIMAO_DAYS);
    shape.days.forEach((day, i) => {
      expect(words.days[i].lines, `day ${i + 1}`).toHaveLength(day.lines);
      expect(words.days[i].choices, `day ${i + 1}`).toHaveLength(3);
      expect(words.days[i].replies.map((r) => r.length), `day ${i + 1}`).toEqual(day.replies);
    });
    expect(words.end).toHaveLength(shape.end);
    expect(words.daily).toHaveLength(HAIMAO_DAILY);
    expect(shape.daily).toBe(HAIMAO_DAILY);
    // a told line is in （）, and only a told one has no face
    for (let n = 1; n <= HAIMAO_DAYS; n++) {
      const scene = storyScene(n);
      for (const l of [...scene.lines, ...scene.answers.flatMap((a) => a.reply)]) {
        expect(l.text, l.text).not.toBe("");
        if (l.face === null) expect(l.text, l.text).toMatch(/^（.*）$/);
      }
    }
    expect(storyScene(1).lines[0]).toEqual({ text: "这位博士，下班路过漕河泾？", face: "smile" });
    expect(storyEnd().map((l) => l.text)).toEqual(["这些天，你每天都来漕河泾找我。", "我想了想，没什么能送你的。", "那就……all 吧。"]);
  });

  it("raises her 好感度 by 8, 5 or 3, the cheekiest answered with dame dame, and ALL END after the twelfth whatever is picked", () => {
    for (let n = 1; n <= HAIMAO_DAYS; n++) {
      const scene = storyScene(n);
      expect(scene.answers.map((a) => a.love), `day ${n}`).toEqual([8, 5, 3]);
      expect(scene.answers.map((_, k) => answerLove(n, k))).toEqual([8, 5, 3]);
      expect(scene.answers[2]).toMatchObject({ dame: true });
      expect(scene.answers[2].reply[0]).toMatchObject({ face: "singing" });
      expect(scene.answers[2].reply[0].text).toMatch(/^dame dame～/);
      expect(scene.dusk).toBe(n === HAIMAO_DAYS);
    }
    // 全场一起: dame dame across the stage
    expect(storyScene(9).answers[0]).toMatchObject({ dame: true, danmaku: true });
    expect(storyScene(12).answers.map((a) => a.all)).toEqual([true, true, false]);
    expect([4, 5, 7].map((n) => storyScene(n).prop)).toEqual(["staff", "dice", "hammer"]);
    expect(storyScene(7)).toMatchObject({ eggs: true });
    expect(storyScene(7).lines.map((l) => l.cue ?? null)).toEqual(["prop", null, null, "crack"]);
  });

  it("has her line of a day after ALL END, the ten in turn, then from the first again", () => {
    expect(dailyLine(0)).toEqual({ text: "又见面了。今天路过鹰角楼下，顺手 all 了一下。", face: "smile" });
    expect(dailyLine(9)).toEqual({ text: "好感度已经满了。再来，就要溢出来了。", face: "shy" });
    expect(dailyLine(10)).toEqual(dailyLine(0));
    expect(dailyLine(23)).toEqual(dailyLine(3));
    expect(dailyLine(3).face).toBe("singing");
  });

  it("shows her faces from the server's own folder, never the repository's", () => {
    expect(HAIMAO_FACES.map(haimaoFaceUrl)).toContain("/guide-art/haimao-smile.webp?v=1");
  });
});

describe("被海猫 all 了", () => {
  it("is a guides badge on the wall only where she shows, or once held, and counted only there", () => {
    const badge = badgeById(HAIMAO_BADGE)!;
    expect(badge).toMatchObject({ name: "被海猫 all 了", series: "guides", guide: "haimao", quote: "那就……all 吧。" });
    expect(wallBadges(new Set()).map((b) => b.id)).not.toContain(HAIMAO_BADGE);
    expect(wallBadges(new Set(), undefined, true).map((b) => b.id)).toContain(HAIMAO_BADGE);
    expect(wallBadges(new Set([HAIMAO_BADGE])).map((b) => b.id)).toContain(HAIMAO_BADGE);
    expect(earnableCount(true)).toBe(earnableCount(false) + 1);
    // hers are two, this and the title her wheel gives (all 门信徒)
    expect(badgeTotal([], false)).toBe(BADGES.length - 2);
    expect(badgeTotal([], true)).toBe(BADGES.length);
    expect(badgeTotal([{ id: HAIMAO_BADGE }], false)).toBe(BADGES.length - 1);
  });
});
