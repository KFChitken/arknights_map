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

  it("asks nothing of another site, and runs no script", async () => {
    for (const english of ["on", "off"]) {
      vi.stubEnv("ENGLISH", english);
      const { html } = await page();
      expect(html).not.toMatch(/<script/i);
      const links = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(20);
      expect(links.filter((l) => !/^(\/|#|https:\/\/zhoupmap\.com\/)/.test(l))).toEqual([]);
      // its own address, for the links people share: canonical, og:url and og:image
      expect(html.match(/https:\/\/zhoupmap\.com\//g)).toHaveLength(3);
      expect(html).not.toMatch(/https?:\/\/(?!zhoupmap\.com\/)/);
      expect(html).toContain('<link rel="canonical" href="https://zhoupmap.com/about">');
      expect(html).toContain('<meta property="og:url" content="https://zhoupmap.com/about">');
      expect(html).toContain('<meta property="og:image" content="https://zhoupmap.com/intro-art/share.png">');
      // its name at the top leads back to the page itself
      expect(html).toContain('<a href="/about" aria-label=');
    }
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
      expect(bytes.length).toBeLessThanOrEqual(90_000);
      expect(gzipSync(bytes).length).toBeLessThanOrEqual(14_000);
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
