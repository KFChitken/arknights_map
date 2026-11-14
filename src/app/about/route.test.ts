import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BADGES } from "@/lib/badges";
import { SERVERS } from "@/lib/games";
import { HELP_HOURS } from "@/lib/help";
import { MAP_STYLES } from "@/lib/mapStyle";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, KEEP_ACTIVITY_DAYS, MAX_CLONES, MIN_SIGNUP_AGE, RADAR_RADIUS_KM } from "@/lib/rules";
import { db } from "@/lib/server/db";
import { users } from "@/lib/server/schema";
import { endGray, loadSettings, setGray } from "@/lib/server/siteSettings";
import { UI_NAMES } from "@/lib/uiChoice";
import { escapeHtml, fillIntro, introFills } from "./introPage";
import { INTRO_TEMPLATE } from "./introTemplate";
import { GET } from "./route";

// Runs against the database named in vitest.config.mts (全站变灰 is kept there)

/** Players' posts about the map, shown with their sites' own embeds and players: what an embed's address may start with */
const EMBEDS = [
  "https://platform.twitter.com/embed/Tweet.html?",
  "https://embed.reddit.com/r/arknights/",
  "https://player.bilibili.com/player.html?",
];

const REDDIT_COMMENT = "https://www.reddit.com/r/arknights/comments/1xtpcwp/comment/19slrt5jlwqmb/?context=1";

/** Every link that leads off the site: the posts themselves, then the news about the map in Chinese */
const LINKS_OUT = [
  "https://x.com/bitoUtAkAtA/status/2120355023007920599",
  REDDIT_COMMENT,
  "https://bbs.ruliweb.com/community/board/300143/read/77349478",
  "https://www.bilibili.com/video/BV13YWN6bEnR/",
  "https://www.bilibili.com/video/BV1qxW86gELW/",
  "https://www.msn.com/zh-cn/news/other/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F%E7%8E%A9%E5%AE%B6%E8%87%AA%E5%88%B6%E8%88%9F%E5%8F%8B%E5%9C%B0%E5%9B%BE-%E6%95%B010%E4%B8%87%E8%88%9F%E5%8F%8B%E4%BA%92%E7%9B%B8%E4%BC%B8%E5%87%BA%E8%A7%A6%E9%A1%BB-%E5%A1%AB%E6%BB%A1%E5%9C%B0%E5%9B%BE/ar-AA2hitWe",
  "https://www.sohu.com/a/1099798153_122348420",
  "https://m.163.com/dy/article/LBFILPUN0526VGN7.html",
  "https://tieba.baidu.com/p/11186258188",
];

/** An address on this site, or a place on the page */
const local = (address: string) => /^(\/(?!\/)|#)/.test(address);

/** A srcdoc attribute's value, as the frame reads it */
const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

async function page() {
  const res = GET();
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), html: await res.text() };
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  await loadSettings();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/about", () => {
  it("is a whole page of HTML, every blank filled", async () => {
    const p = await page();
    expect(p.status).toBe(200);
    expect(p.type).toBe("text/html; charset=utf-8");
    expect(p.cache).toBe("public, max-age=300");
    expect(p.html.startsWith("<!doctype html>")).toBe(true);
    expect(p.html).toContain('<html lang="en">');
    expect(p.html).not.toContain("{{");
    expect(p.html).not.toContain("<!--en:");
    expect(p.html).not.toContain("<!--/en:");
  });

  it("leads to the English site while it is on", async () => {
    const { html } = await page();
    expect(html).toContain('href="/en"');
    expect(html).toContain('href="/en/privacy"');
    expect(html).toContain("zhoupmap.com/en");
    expect(html).not.toContain("menus are in Chinese for now");
    expect(html).not.toContain("Coming soon");
  });

  it("leads to the Chinese site, and says the menus are in Chinese, with ENGLISH=off", async () => {
    vi.stubEnv("ENGLISH", "off");
    const { html } = await page();
    expect(html).not.toContain('href="/en');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("menus are in Chinese for now");
    expect(html).toContain("Coming soon");
  });

  it("is gray while the whole site is", async () => {
    const [u] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
    const now = Date.now();
    // the page's own animation lights its titles up from gray (grayscale(1) to grayscale(0)); this is the whole page
    const gray = "<style>html{filter:grayscale(1)}</style>";
    expect((await page()).html).not.toContain(gray);
    await setGray(u.id, now + 3_600_000, now);
    expect((await page()).html).toContain(gray);
    await endGray();
    expect((await page()).html).not.toContain(gray);
  });

  it("takes its numbers from the code", async () => {
    const { html } = await page();
    for (const said of [
      `within ${DECLARATION_RADIUS_KM}&nbsp;km`,
      `up to ${MAX_CLONES} clones`,
      `${BADGES.length} titles to earn`,
      `for ${DECLARATION_DAYS}&nbsp;days`,
      `up to ${RADAR_RADIUS_KM}&nbsp;km`,
      `after ${HELP_HOURS}&nbsp;hours`,
      `after ${KEEP_ACTIVITY_DAYS}&nbsp;days`,
      `players ${MIN_SIGNUP_AGE}+`,
    ])
      expect(html).toContain(said);
  });

  // what the page says in words of its own: when one of these changes, so must the page
  it("says what the code has: three layouts, five map styles, the diplomacy titles' goals, the servers", () => {
    expect(UI_NAMES.length).toBe(3);
    expect(MAP_STYLES.length).toBe(5);
    const goal = (id: string) => BADGES.find((b) => b.id === id)?.goal?.n;
    expect([goal("trainee"), goal("diplomat"), goal("ambassador")]).toEqual([1, 10, 30]);
    expect(SERVERS.arknights.length).toBe(6);
    expect(SERVERS.endfield.length).toBe(4);
  });

  it("runs no script, and asks other sites only for the posts it shows", async () => {
    for (const english of ["on", "off"]) {
      vi.stubEnv("ENGLISH", english);
      const { html } = await page();
      expect(html).not.toMatch(/<script/i);
      expect(unescapeHtml(html)).not.toMatch(/<script/i); // nor in the Reddit frame's own document
      const attr = (name: string) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, "g"))].map((m) => m[1]);
      // pictures from the site itself; from elsewhere only the posts, in their sites' own embeds
      const sources = attr("src");
      expect(sources.length).toBeGreaterThan(20);
      expect(sources.filter((s) => !local(s) && !EMBEDS.some((e) => s.startsWith(e)))).toEqual([]);
      // links off the site: its own address, and the posts and the news it names, each once (and the card in the Reddit frame, below)
      expect(attr("href").filter((h) => !local(h)).sort()).toEqual(["https://zhoupmap.com/about", ...LINKS_OUT].sort());
      // and no other site's address anywhere in the page
      const addresses = [...html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
      expect(addresses.filter((a) => !a.startsWith("https://zhoupmap.com/") && !EMBEDS.some((e) => a.startsWith(e)) && !LINKS_OUT.includes(a))).toEqual([]);
      // its own address, for the links people share: canonical, og:url and og:image
      expect(html.match(/https:\/\/zhoupmap\.com\//g)).toHaveLength(3);
      expect(html).toContain('<link rel="canonical" href="https://zhoupmap.com/about">');
      expect(html).toContain('<meta property="og:url" content="https://zhoupmap.com/about">');
      expect(html).toContain('<meta property="og:image" content="https://zhoupmap.com/intro-art/share.png">');
      // its name at the top leads back to the page itself
      expect(html).toContain('<a href="/about" aria-label=');
    }
  });

  it("frames each post with a title, lazily and sandboxed, and opens each link off the site in a new tab", async () => {
    const { html } = await page();
    const frames = html.match(/<iframe\b[^>]*>/g) ?? [];
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(frame).toMatch(/\btitle="[^"]+"/);
      expect(frame).toContain('loading="lazy"');
      const sandbox = /\bsandbox="([^"]*)"/.exec(frame)?.[1];
      expect(sandbox, frame).toBeDefined();
      // a post may open its own site in a new tab, but never take this page somewhere else
      expect(sandbox).not.toMatch(/allow-top-navigation/);
    }
    const out = html.match(/<a\b[^>]*\bhref="https?:\/\/[^"]*"[^>]*>/g) ?? [];
    expect(out).toHaveLength(LINKS_OUT.length);
    for (const a of out) {
      expect(a).toContain('target="_blank"');
      expect(a).toMatch(/\brel="[^"]*\bnoopener\b/);
    }
  });

  it("shows the Reddit comment through an <object>, which shows our own card instead when Reddit won't", async () => {
    const { html } = await page();
    // the <object> is the whole document of a sandboxed frame, so the embed keeps the frame's sandbox and lazy loading
    const docs = [...html.matchAll(/<iframe\b[^>]*\bsrcdoc="([^"]*)"[^>]*>/g)];
    expect(docs).toHaveLength(1);
    expect(docs[0][0]).toContain('title="Comment on r/arknights"');
    const doc = unescapeHtml(docs[0][1]);
    const objects = [...doc.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)];
    expect(objects).toHaveLength(1);
    const [, attrs, fallback] = objects[0];
    expect(attrs).toContain("data='https://embed.reddit.com/r/arknights/comments/1xtpcwp/comment/19slrt5jlwqmb/?embed=true&amp;");
    expect(attrs).toContain("type=text/html");
    // what shows when the load fails (an HTTP error, a network error, a refusal to be framed): a way to the comment
    expect([...fallback.matchAll(/<a\s+([^>]*)>/g)].map((m) => m[1])).toEqual([`href='${REDDIT_COMMENT}' target=_blank rel=noopener`]);
    // and nothing else is asked of anyone
    const addresses = [...doc.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
    expect(addresses).toHaveLength(2);
    expect(addresses.filter((a) => !a.startsWith("https://embed.reddit.com/r/arknights/") && a !== REDDIT_COMMENT)).toEqual([]);
  });

  it("has every picture it shows", async () => {
    const { html } = await page();
    const pictures = new Set([...html.matchAll(/\b(?:src|href)="(\/(?:intro-art|badges|avatars)\/[^"#?]+)"/g)].map((m) => m[1]));
    expect(pictures.size).toBeGreaterThanOrEqual(18);
    expect([...pictures].filter((p) => !existsSync(`public${p}`))).toEqual([]);
    expect(existsSync("public/intro-art/share.png")).toBe(true);
  });

  it("stays small", async () => {
    for (const english of ["on", "off"]) {
      vi.stubEnv("ENGLISH", english);
      const bytes = Buffer.from((await page()).html);
      expect(bytes.length).toBeLessThanOrEqual(100_000);
      expect(gzipSync(bytes).length).toBeLessThanOrEqual(15_000);
    }
  });

  it("writes the site's name as text, whatever it holds", () => {
    expect(escapeHtml(`A<b>"c'&`)).toBe("A&lt;b&gt;&quot;c&#x27;&amp;");
    const html = fillIntro(INTRO_TEMPLATE, true, introFills(true, false, 'Ark<map>"'));
    expect(html).toContain("<title>Ark&lt;map&gt;&quot;: ");
    expect(html).not.toContain('Ark<map>"');
    // a $ in it is the name, not a pattern
    expect(fillIntro("<p>{{siteName}}</p>", true, introFills(true, false, "$& $1"))).toBe("<p>$&amp; $1</p>");
  });

  it("takes no blank it cannot fill, and no block left open", () => {
    expect(() => fillIntro("<p>{{nope}}</p>", true, introFills(true, false))).toThrow("{{nope}}");
    expect(() => fillIntro("<!--en:on-->\n<p>a</p>\n", false, introFills(false, false))).toThrow("not closed");
    expect(() => fillIntro("<p>a</p>\n<!--/en:off-->\n", true, introFills(true, false))).toThrow("not closed");
  });
});
