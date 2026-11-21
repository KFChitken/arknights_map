import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "@/i18n/core";
import { zh } from "@/i18n/zh";
import { BADGES } from "@/lib/badges";
import { SERVERS } from "@/lib/games";
import { HELP_HOURS } from "@/lib/help";
import { MAP_STYLES } from "@/lib/mapStyle";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, KEEP_ACTIVITY_DAYS, MAX_CLONES, MIN_SIGNUP_AGE, RADAR_RADIUS_KM } from "@/lib/rules";
import { db } from "@/lib/server/db";
import { resetRoachFeed, roachCounts } from "@/lib/server/roachFeed";
import { roachChanges, users } from "@/lib/server/schema";
import { endGray, loadSettings, setGray } from "@/lib/server/siteSettings";
import * as world from "@/lib/server/world";
import { UI_NAMES } from "@/lib/uiChoice";
import { escapeHtml, fillIntro, introFills, introHtml } from "./introPage";
import { INTRO_TEMPLATE } from "./introTemplate";
import { GET } from "./route";
import { GET as GET_ZH } from "./zh/route";

// Runs against the database named in vitest.config.mts (全站变灰 is kept there)

/** Players' posts about the map, shown with their sites' own embeds and players: what an embed's address may start with */
const EMBEDS = [
  "https://platform.twitter.com/embed/Tweet.html?",
  "https://embed.reddit.com/r/arknights/",
  "https://player.bilibili.com/player.html?",
];

const REDDIT_POST = "https://www.reddit.com/r/arknights/comments/1xtpcwp/a_fangenerated_map_of_weak_social_interactions/";

/** Every link that leads off the site: the posts themselves, then the news about the map in Chinese */
const LINKS_OUT = [
  "https://x.com/bitoUtAkAtA/status/2120355023007920599",
  REDDIT_POST,
  "https://bbs.ruliweb.com/community/board/300143/read/77349478",
  "https://www.bilibili.com/video/BV13YWN6bEnR/",
  "https://www.bilibili.com/video/BV1qxW86gELW/",
  "https://www.msn.com/zh-cn/news/other/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F%E7%8E%A9%E5%AE%B6%E8%87%AA%E5%88%B6%E8%88%9F%E5%8F%8B%E5%9C%B0%E5%9B%BE-%E6%95%B010%E4%B8%87%E8%88%9F%E5%8F%8B%E4%BA%92%E7%9B%B8%E4%BC%B8%E5%87%BA%E8%A7%A6%E9%A1%BB-%E5%A1%AB%E6%BB%A1%E5%9C%B0%E5%9B%BE/ar-AA2hitWe",
  "https://www.sohu.com/a/1099798153_122348420",
  "https://m.163.com/dy/article/LBFILPUN0526VGN7.html",
  "https://tieba.baidu.com/p/11186258188",
];

/** Each page's own address, for the links people share */
const ADDRESS: Record<Lang, string> = { en: "https://zhoupmap.com/about", zh: "https://zhoupmap.com/about/zh" };

/** Both pages say where each one is, and that the English one is for everyone else */
const HREFLANG =
  '<link rel="alternate" hreflang="en" href="https://zhoupmap.com/about">\n' +
  '<link rel="alternate" hreflang="zh-CN" href="https://zhoupmap.com/about/zh">\n' +
  '<link rel="alternate" hreflang="x-default" href="https://zhoupmap.com/about">\n';

/** The line under the hero's buttons, with a number of players and without */
const LIVE: Record<Lang, (n: string) => string> = {
  en: (n) => `font-variant-numeric: tabular-nums">${n}</strong> players are on the map right now</p>`,
  zh: (n) => `>地图上现在有 <strong style="font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums">${n}</strong> 位舟P</p>`,
};
const NOLIVE: Record<Lang, string> = { en: ">100,000+ players joined in our first three weeks</p>", zh: ">开站三周，就有 10 万多位舟P加入</p>" };

/** The Reddit post's frame, by its title */
const REDDIT_TITLE: Record<Lang, string> = { en: "Post on r/arknights", zh: "r/arknights 上的帖子" };

const LANGS: Lang[] = ["en", "zh"];
const ROUTES: Record<Lang, () => Response> = { en: GET, zh: GET_ZH };

/** An address on this site, or a place on the page */
const local = (address: string) => /^(\/(?!\/)|#)/.test(address);

/** A srcdoc attribute's value, as the frame reads it */
const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

async function page(lang: Lang = "en") {
  const res = ROUTES[lang]();
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), html: await res.text() };
}

const SHANGHAI = { lng: 121.47, lat: 31.23 };
const TOKYO = { lng: 139.7, lat: 35.68 };

async function player(email: string) {
  const [u] = await db
    .insert(users)
    .values({ email, policyAcceptedAt: new Date(), crossBorderAcceptedAt: new Date(), publicPlaceAcceptedAt: new Date() })
    .returning({ id: users.id });
  return u.id;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${roachChanges} cascade`);
  await loadSettings();
  // no roaches held, as in a process that has not read them yet
  resetRoachFeed();
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
    expect(p.html).not.toMatch(/<!--\/?(en:|live|nolive)/);
    expect(p.html).not.toContain("\u0000");
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

  it("leads to the page in Chinese at the top and at the foot, and to the Chinese map at the end", async () => {
    const { html } = await page();
    expect(html.match(/<a href="\/about\/zh" lang="zh-CN" hreflang="zh-CN"[^>]*>/g)).toHaveLength(2);
    // the one at the top has a globe, which narrow screens leave out
    expect(html).toMatch(/<a href="\/about\/zh" lang="zh-CN" hreflang="zh-CN" class="ak-lang" [^>]*><svg [^>]*aria-hidden="true"[^]*?<\/svg>中文<\/a>/);
    expect(html).toContain("@container (max-width: 399px){.ak-lang svg{display:none}}");
    expect(html).toMatch(/<a href="\/" lang="zh-CN" [^>]*>中文版 · 舟P地图<\/a>/);
  });

  it("takes its numbers from the code", async () => {
    const { html } = await page();
    for (const said of [
      `within ${DECLARATION_RADIUS_KM}&nbsp;km`,
      `up to ${MAX_CLONES} clones`,
      // 香艳制作人's and 325大学习's not yet: HAIMAO and STUDY are off here
      `${BADGES.filter((b) => !b.unlisted && !b.guide && !b.study).length} titles to earn`,
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

  it("writes the site's name as text, whatever it holds", () => {
    expect(escapeHtml(`A<b>"c'&`)).toBe("A&lt;b&gt;&quot;c&#x27;&amp;");
    const html = fillIntro(INTRO_TEMPLATE, { english: true, live: false }, introFills("en", true, false, 'Ark<map>"'));
    expect(html).toContain("<title>Ark&lt;map&gt;&quot;: ");
    expect(html).not.toContain('Ark<map>"');
    // a $ in it is the name, not a pattern
    expect(fillIntro("<p>{{siteName}}</p>", { english: true, live: false }, introFills("en", true, false, "$& $1"))).toBe("<p>$&amp; $1</p>");
  });

  it("takes no blank it cannot fill, and no block left open", () => {
    const fills = introFills("en", true, false);
    expect(() => fillIntro("<p>{{nope}}</p>", { english: true, live: false }, fills)).toThrow("{{nope}}");
    expect(() => fillIntro("<!--en:on-->\n<p>a</p>\n", { english: false, live: false }, fills)).toThrow("not closed");
    expect(() => fillIntro("<p>a</p>\n<!--/en:off-->\n", { english: true, live: false }, fills)).toThrow("not closed");
    expect(() => fillIntro("<!--live-->\n<p>a</p>\n", { english: true, live: true }, fills)).toThrow("not closed");
    expect(() => fillIntro("<p>a</p>\n<!--/nolive-->\n", { english: true, live: false }, fills)).toThrow("not closed");
  });

  it("keeps one block of each pair", () => {
    const template =
      "<!--en:on-->\n<p>on</p>\n<!--/en:on-->\n<!--en:off-->\n<p>off</p>\n<!--/en:off-->\n" +
      "<!--live-->\n<p>{{players}} now</p>\n<!--/live-->\n<!--nolive-->\n<p>before</p>\n<!--/nolive-->\n<hr>\n";
    const fills = { players: "5" };
    expect(fillIntro(template, { english: true, live: true }, fills)).toBe("<p>on</p>\n<p>5 now</p>\n<hr>\n");
    expect(fillIntro(template, { english: false, live: false }, fills)).toBe("<p>off</p>\n<p>before</p>\n<hr>\n");
  });
});

describe("/about/zh", () => {
  it("is a whole page of HTML, every blank filled", async () => {
    const p = await page("zh");
    expect(p.status).toBe(200);
    expect(p.type).toBe("text/html; charset=utf-8");
    expect(p.cache).toBe("public, max-age=300");
    expect(p.html.startsWith("<!doctype html>")).toBe(true);
    expect(p.html).toContain('<html lang="zh-CN">');
    expect(p.html).not.toContain("{{");
    expect(p.html).not.toMatch(/<!--\/?(en:|live|nolive)/);
    expect(p.html).not.toContain("\u0000");
  });

  it("goes by the site's Chinese name, with its English one beside it at the foot", async () => {
    const { html } = await page("zh");
    expect(html).toContain("<title>舟P地图：看看你身边有多少舟P</title>");
    expect(html).toContain('<meta property="og:site_name" content="舟P地图">');
    expect(html).toContain('舟P地图 <span lang="en" style="font-weight: 600; color: #5d5a52">Arkmap</span>');
  });

  it("leads to the Chinese map, and from its end to the English one while it is open", async () => {
    const { html } = await page("zh");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toContain('href="/en/privacy"');
    // the English map only from the end and from its line among the servers
    expect(html.match(/href="\/en"/g)).toHaveLength(2);
    expect(html).toMatch(/<a href="\/en" lang="en" [^>]*>English · Arkmap<\/a>/);
    expect(html).toContain('<span style="color: #5d5a52">英文版</span><a href="/en" style="font-weight: 700; color: #1b1d22">zhoupmap.com/en</a>');
    expect(html).not.toContain("即将上线");
    // the English site's note that its menus are in Chinese is not for this page
    expect(html).not.toContain("Heads-up");
  });

  it("leads to the Chinese map only, and says the English one is coming, with ENGLISH=off", async () => {
    vi.stubEnv("ENGLISH", "off");
    const { html } = await page("zh");
    expect(html).not.toContain('href="/en');
    expect(html).not.toContain("English · Arkmap");
    expect(html).toContain("即将上线");
    expect(html).not.toContain("Heads-up");
  });

  it("leads to the page in English at the top and at the foot", async () => {
    const { html } = await page("zh");
    expect(html.match(/<a href="\/about" lang="en" hreflang="en"[^>]*>/g)).toHaveLength(2);
    expect(html).toMatch(/<a href="\/about" lang="en" hreflang="en" class="ak-lang" [^>]*><svg [^>]*aria-hidden="true"[^]*?<\/svg>English<\/a>/);
  });

  it("takes its numbers from the code", async () => {
    const { html } = await page("zh");
    for (const said of [
      `${DECLARATION_RADIUS_KM}&nbsp;公里内的舟P都能收到`,
      `最多 ${MAX_CLONES} 只克隆体`,
      `${BADGES.filter((b) => !b.unlisted && !b.guide && !b.study).length} 个称号等你拿`,
      `宣言挂 ${DECLARATION_DAYS}&nbsp;天`,
      `最远扫到 ${RADAR_RADIUS_KM}&nbsp;公里`,
      `${HELP_HOURS}&nbsp;小时后自己消失`,
      `${KEEP_ACTIVITY_DAYS}&nbsp;天后删除`,
      `${MIN_SIGNUP_AGE} 岁以上`,
    ])
      expect(html).toContain(said);
  });

  // the joke the English page leaves out, in the site's own words: as the map's card for visitors and its declarations say it
  it("opens with the roach joke, and shows the roach declaration with its replies, as the map has them", async () => {
    const { html } = await page("zh");
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(h1.replace(/<[^>]*>/g, "")).toBe(zh.guest.intro.doubt);
    const { r1, r2, r3, r4 } = zh.lib.declarations.replies.rental;
    for (const said of [`「${zh.declare.line.roaches}」`, r1, r2, r3, r4]) expect(html).toContain(`>${said}</`);
  });

  it("says nothing in English where it means Chinese", async () => {
    const { html } = await page("zh");
    for (const english of ["Open the map", "How it works", "players are on the map", "Feeler Friends", "Privacy Notice"])
      expect(html).not.toContain(english);
  });
});

describe("/about and /about/zh", () => {
  it("say how many players are on the map, from the roaches the process holds, and the line from before until it holds them", async () => {
    for (const lang of LANGS) {
      const { html } = await page(lang);
      expect(html).toContain(NOLIVE[lang]);
      expect(html).not.toContain(LIVE[lang](""));
    }
    const a = await player("a@example.com");
    const b = await player("b@example.com");
    await player("c@example.com"); // signed up, no roach yet: not on the map
    await world.placeRoach(a, { kind: "main" }, SHANGHAI);
    await world.placeRoach(a, { kind: "clone" }, TOKYO); // a clone is not a player more
    await world.placeRoach(b, { kind: "main" }, TOKYO);
    // the map reads them (a page asks), and the pages say as many as the map does
    expect((await roachCounts()).players).toBe(2);
    for (const lang of LANGS) {
      const { html } = await page(lang);
      expect(html).toContain(LIVE[lang]("2"));
      expect(html).not.toContain(NOLIVE[lang]);
    }
  });

  it("write the number as the map does", () => {
    for (const lang of LANGS) {
      expect(introHtml(lang, true, false, 103_286)).toContain(LIVE[lang]("103,286"));
      expect(introHtml(lang, false, true, 0)).toContain(LIVE[lang]("0"));
      expect(introHtml(lang, true, false, null)).toContain(NOLIVE[lang]);
    }
  });

  it("are gray while the whole site is", async () => {
    const [u] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
    const now = Date.now();
    // the page's own animation lights its titles up from gray (grayscale(1) to grayscale(0)); this is the whole page
    const gray = "<style>html{filter:grayscale(1)}</style>";
    for (const lang of LANGS) expect((await page(lang)).html).not.toContain(gray);
    await setGray(u.id, now + 3_600_000, now);
    for (const lang of LANGS) expect((await page(lang)).html).toContain(gray);
    await endGray();
    for (const lang of LANGS) expect((await page(lang)).html).not.toContain(gray);
  });

  it("run no script, and ask other sites only for the posts they show", async () => {
    for (const lang of LANGS)
      for (const english of ["on", "off"]) {
        vi.stubEnv("ENGLISH", english);
        const { html } = await page(lang);
        expect(html).not.toMatch(/<script/i);
        expect(unescapeHtml(html)).not.toMatch(/<script/i); // nor in the Reddit frame's own document
        const attr = (name: string) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, "g"))].map((m) => m[1]);
        // pictures from the site itself; from elsewhere only the posts, in their sites' own embeds
        const sources = attr("src");
        expect(sources.length).toBeGreaterThan(20);
        expect(sources.filter((s) => !local(s) && !EMBEDS.some((e) => s.startsWith(e)))).toEqual([]);
        // links off the site: its own address and both pages' (for search engines), and the posts and the news it
        // names, each once (and the card in the Reddit frame, below)
        expect(attr("href").filter((h) => !local(h)).sort()).toEqual([ADDRESS[lang], ADDRESS.en, ADDRESS.zh, ADDRESS.en, ...LINKS_OUT].sort());
        // and no other site's address anywhere in the page
        const addresses = [...html.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
        expect(addresses.filter((a) => !a.startsWith("https://zhoupmap.com/") && !EMBEDS.some((e) => a.startsWith(e)) && !LINKS_OUT.includes(a))).toEqual([]);
        // its own address, for the links people share: canonical, og:url and og:image; and both pages', as hreflang
        expect(html.match(/https:\/\/zhoupmap\.com\//g)).toHaveLength(6);
        expect(html).toContain(`<link rel="canonical" href="${ADDRESS[lang]}">\n${HREFLANG}`);
        expect(html).toContain(`<meta property="og:url" content="${ADDRESS[lang]}">`);
        expect(html).toContain('<meta property="og:image" content="https://zhoupmap.com/intro-art/share.png">');
        // its name at the top leads back to the page itself
        expect(html).toContain(`<a href="${lang === "en" ? "/about" : "/about/zh"}" aria-label=`);
      }
  });

  it("frame each post with a title, lazily and sandboxed, and open each link off the site in a new tab", async () => {
    for (const lang of LANGS) {
      const { html } = await page(lang);
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
    }
  });

  it("show the Reddit post through an <object>, which shows our own card instead when Reddit won't", async () => {
    for (const lang of LANGS) {
      const { html } = await page(lang);
      // the <object> is the whole document of a sandboxed frame, so the embed keeps the frame's sandbox and lazy loading
      const docs = [...html.matchAll(/<iframe\b[^>]*\bsrcdoc="([^"]*)"[^>]*>/g)];
      expect(docs).toHaveLength(1);
      expect(docs[0][0]).toContain(`title="${REDDIT_TITLE[lang]}"`);
      const doc = unescapeHtml(docs[0][1]);
      const objects = [...doc.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)];
      expect(objects).toHaveLength(1);
      const [, attrs, fallback] = objects[0];
      expect(attrs).toContain("data='https://embed.reddit.com/r/arknights/comments/1xtpcwp/a_fangenerated_map_of_weak_social_interactions/?embed=true&amp;");
      expect(attrs).toContain("type=text/html");
      // what shows when the load fails (an HTTP error, a network error, a refusal to be framed): a way to the post
      expect([...fallback.matchAll(/<a\s+([^>]*)>/g)].map((m) => m[1])).toEqual([`href='${REDDIT_POST}' target=_blank rel=noopener`]);
      // and nothing else is asked of anyone
      const addresses = [...doc.matchAll(/https?:\/\/[^"'\s<>]+/g)].map((m) => m[0]);
      expect(addresses).toHaveLength(2);
      expect(addresses.filter((a) => !a.startsWith("https://embed.reddit.com/r/arknights/") && a !== REDDIT_POST)).toEqual([]);
    }
  });

  it("have every picture they show", async () => {
    for (const lang of LANGS) {
      const { html } = await page(lang);
      const pictures = new Set([...html.matchAll(/\b(?:src|href)="(\/(?:intro-art|badges|avatars)\/[^"#?]+)"/g)].map((m) => m[1]));
      expect(pictures.size).toBeGreaterThanOrEqual(18);
      expect([...pictures].filter((p) => !existsSync(`public${p}`))).toEqual([]);
    }
    expect(existsSync("public/intro-art/share.png")).toBe(true);
  });

  it("stay small", async () => {
    // Chinese packs less tightly than English: a limit of its own
    const gzipped: Record<Lang, number> = { en: 15_000, zh: 16_000 };
    for (const lang of LANGS)
      for (const english of ["on", "off"]) {
        vi.stubEnv("ENGLISH", english);
        const bytes = Buffer.from((await page(lang)).html);
        expect(bytes.length).toBeLessThanOrEqual(100_000);
        expect(gzipSync(bytes).length).toBeLessThanOrEqual(gzipped[lang]);
        // however many players there are
        const most = Buffer.from(introHtml(lang, english === "on", false, 9_999_999));
        expect(most.length).toBeLessThanOrEqual(100_000);
        expect(gzipSync(most).length).toBeLessThanOrEqual(gzipped[lang]);
      }
  });
});
