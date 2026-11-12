import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NoticeBody from "@/components/app/NoticeBody";
import { db, pg } from "./db";
import { hearOthers, reloadEverywhere } from "./live";
import { forgetNotices, loadNotices, noticeList, NOTICES_SHOWN, startNotices, visibleNotices } from "./notices";
import { notices } from "./schema";

const HOUR = 3_600_000;

/**
 * The welcome notice's words as src/components/app/NoticeSheet.tsx showed them on 11/11, before notices were
 * kept in the database: what the page showed, saved before that component went
 */
const OLD_WELCOME =
  '<div class="notice"><p>大家好，我是 Breeze！一转眼地图上已经快 8 万只蟑螂了，真的谢谢大家 (≧▽≦) 人多起来以后，有几件事更想拜托大家：</p>' +
  "<h3>1. 保护隐私｜保护自己｜保护网站</h3>" +
  "<ul><li>别把蟑螂放在自己的住址（家门口、宿舍楼下），放在附近的商场、地铁站就好。已经放了的，在「我的蟑螂」里点「挪窝」。</li>" +
  "<li>UID 栏只填游戏 UID，别写 QQ、微信、手机号。</li></ul>" +
  "<p>舟P地图希望舟u们玩得开心，但最不希望的，是给有心之人搭了桥。保护好个人隐私，网站也能更耐活～</p>" +
  "<h3>2. 不要用蟑螂摆能认出来的字或图案</h3>" +
  "<p>明白大家想玩 325 这些梗，之后会加上的！但地图上的所有东西都要谨慎，我们不是 wplace。</p>" +
  "<h3>3. 守护地图社区，必要时举报</h3>" +
  "<p>为了让舟u们都有好的体验，发现任何可疑行为，请记得举报或直接反馈，交给站长处理：</p>" +
  "<ul><li>消息里每条下面、TA 的资料页最下面、地图上蟑螂的卡片里，都能举报。</li>" +
  "<li>举报只有站长看得到，TA 不会知道是谁；处理完会在消息里告诉你结果。</li></ul>" +
  "<h3>4. 关注近期 &amp; 后续更新</h3>" +
  "<ul><li>服务器升级了（买！）</li><li>验证码额度 +100%（买！）</li><li>高德地图应该更丝滑了</li>" +
  "<li>正在为 10 万舟u做准备！晚上人多时线路偶尔被限流，可能会卡一下～</li></ul>" +
  '<p>后续更新请关注 B站「<a href="https://space.bilibili.com/481828661" target="_blank" rel="noreferrer">Breeze青嵐</a>」；' +
  "任何反馈欢迎加企鹅群 1108446109：</p>" +
  // the QR code is the group NoticeBody shows now: the second group since the first filled up (11/12)
  '<a class="notice-qr" href="https://qm.qq.com/q/yEAmVqJZ4Y" target="_blank" rel="noreferrer" aria-label="加入QQ群 278579278">' +
  '<img src="/notice/qq-group-2.png" alt="QQ群 278579278 的二维码" width="160" height="160"/><span>扫一扫，或者点二维码加群</span></a>' +
  '<p class="notice-thanks">再次感谢大家！</p></div>';

type NewNotice = typeof notices.$inferInsert;

/** A live notice, unless said otherwise */
async function add(title: string, more: Partial<NewNotice> = {}) {
  const [n] = await db
    .insert(notices)
    .values({ title, body: title, status: "live", publishedAt: new Date(), ...more })
    .returning();
  return n;
}

const titles = (now?: number) => noticeList(now).notices.map((n) => n.title);

beforeEach(async () => {
  await db.delete(notices);
  forgetNotices();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the notices everyone sees", () => {
  it("are the live ones not yet ended, pinned first, then the newest, at most 20", async () => {
    const now = Date.now();
    await add("草稿", { status: "draft", publishedAt: null });
    await add("撤下的", { status: "withdrawn", withdrawnAt: new Date(now - HOUR) });
    await add("到期的", { endsAt: new Date(now - HOUR) });
    await add("置顶", { pinned: true, publishedAt: new Date(now - 5 * HOUR) });
    await db
      .insert(notices)
      .values(Array.from({ length: 22 }, (_, i) => ({ title: `第${i}条`, body: `第${i}条`, status: "live", publishedAt: new Date(now - (30 - i) * 60_000) })));
    await loadNotices();

    const shown = visibleNotices(now);
    expect(shown).toHaveLength(NOTICES_SHOWN);
    expect(shown.slice(0, 3).map((n) => n.title)).toEqual(["置顶", "第21条", "第20条"]);
    expect(shown.at(-1)?.title).toBe("第3条");

    const list = noticeList(now);
    expect(list.notices.map((n) => n.title)).toEqual(shown.map((n) => n.title));
    // all a page gets of each, and the answer ready to send
    expect(Object.keys(list.notices[0]).sort()).toEqual(["body", "excerpt", "id", "pinned", "pop", "publishedAt", "title"]);
    expect(JSON.parse(list.json)).toEqual({ stamp: list.stamp, notices: list.notices });
  });

  it("leave out one whose end has passed, without the database being asked again", async () => {
    const now = Date.now();
    await add("长期", { publishedAt: new Date(now - 2 * HOUR) });
    await add("限时", { publishedAt: new Date(now - HOUR), endsAt: new Date(now + HOUR) });
    await loadNotices();
    const before = noticeList(now);
    expect(before.notices.map((n) => n.title)).toEqual(["限时", "长期"]);
    // made once, not for each request
    expect(noticeList(now + 60_000)).toBe(before);

    const after = noticeList(now + HOUR);
    expect(after.notices.map((n) => n.title)).toEqual(["长期"]);
    expect(after.stamp).not.toBe(before.stamp);
  });

  it("have the same stamp on every process for the same notices, and another once one is published, edited or taken down", async () => {
    await add("一", { publishedAt: new Date(Date.now() - HOUR) });
    await loadNotices();
    const first = noticeList().stamp;
    // another process, which read the same
    forgetNotices();
    await loadNotices();
    expect(noticeList().stamp).toBe(first);

    const two = await add("二");
    await loadNotices();
    const published = noticeList().stamp;
    expect(published).not.toBe(first);

    await db
      .update(notices)
      .set({ body: "改过的字", updatedAt: new Date(Date.now() + 5_000) })
      .where(eq(notices.id, two.id));
    await loadNotices();
    const edited = noticeList().stamp;
    expect(edited).not.toBe(published);
    expect(noticeList().notices.find((n) => n.id === two.id)?.body).toBe("改过的字");

    await db
      .update(notices)
      .set({ status: "withdrawn", withdrawnAt: new Date(), updatedAt: new Date(Date.now() + 10_000) })
      .where(eq(notices.id, two.id));
    await loadNotices();
    expect(titles()).toEqual(["一"]);
    expect(noticeList().stamp).toBe(first);
  });

  it("start with the welcome notice, which reads as it did before it was kept in the database", async () => {
    // what the migration puts in (the tests' database was wiped meanwhile)
    const migration = readFileSync(new URL("../../../drizzle/0042_notices.sql", import.meta.url), "utf8");
    const insert = migration.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "notices"'));
    expect(insert).toBeDefined();
    await db.execute(sql.raw(insert!));
    await loadNotices();

    const [welcome, ...others] = noticeList().notices;
    expect(others).toEqual([]);
    expect(welcome).toMatchObject({ title: "欢迎来到舟P地图", pop: "every", pinned: true, publishedAt: Date.parse("2026-11-11T15:08:00+08:00") });
    expect(Array.from(welcome.excerpt)).toHaveLength(60);
    expect(welcome.excerpt.startsWith("大家好，我是 Breeze！一转眼地图上已经快 8 万只蟑螂了")).toBe(true);

    const shown = renderToStaticMarkup(createElement(NoticeBody, { body: welcome.body }))
      // React's preload of the QR code's image, and the links' noopener, which is new
      .replace(/^<link [^>]*>/, "")
      .replaceAll('rel="noreferrer noopener"', 'rel="noreferrer"');
    expect(shown).toBe(OLD_WELCOME);
  });

  it("let only one live notice pop up on every visit, and nothing but the three ways and three states", async () => {
    await add("一", { pop: "every" });
    await expect(add("二", { pop: "every" })).rejects.toMatchObject({ cause: { code: "23505" } });
    // a draft, one taken down and one that pops up once are fine beside it
    await add("草稿", { pop: "every", status: "draft", publishedAt: null });
    await add("撤下的", { pop: "every", status: "withdrawn" });
    await add("一次", { pop: "once" });
    await expect(add("响", { pop: "loud" })).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(add("藏", { status: "hidden" })).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  // last: it leaves this process listening to the others
  it("are read again when the word comes, from this process or another", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await startNotices();
    await hearOthers();
    expect(titles()).toEqual([]);

    await add("一", { publishedAt: new Date(Date.now() - HOUR) });
    await reloadEverywhere("notices");
    expect(titles()).toEqual(["一"]);

    // another process changed them, and says so
    await add("二");
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "notices" }));
    await vi.waitFor(() => expect(titles()).toEqual(["二", "一"]));
  });
});
