import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createElement as h, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanSource, scanTree, sourceFiles } from "../../scripts/i18n/scan.mts";
import { countText } from "../lib/counts";
import { FOODS, SPOUSES } from "../lib/declarations";
import { CHARACTERS, NICKNAMES } from "../lib/operators";
import { STAMPS } from "../lib/si";
import { SELF_TITLES } from "../lib/titles";
import { count, type Counted, fill, fmt, fmtParts, isCounted, LANGS, missing, type Messages } from "./core";
import { en } from "./en";
import { lang, localPath, sentences, T } from "./index";
import { characterName, foodName, nameMatches, spouseName, stampName, titleName } from "./names";
import { EN_MANIFEST, isEnglishPath, LANG_HEADER, langOfMark, pathIn } from "./lang";
import { requestLang } from "../lib/server/http";
import { fmtNodes } from "./nodes";
import { pageLang } from "./request";
import { wordsFile, wordsOf, wordsScript, wordsUrl, withLang } from "./server";
import { SERVER_ONLY } from "./words";
import { zh } from "./zh";

const ROOT = new URL("../..", import.meta.url).pathname;

describe("filling in blanks", () => {
  it("fills {name} as a template literal would, and leaves other braces alone", () => {
    expect(fmt("今天第 {times} 次", { times: 3 })).toBe("今天第 3 次");
    expect(fmt("{a}和{b}", { a: "x", b: null })).toBe(`x和${null}`);
    expect(fmt("{角色}{汪汪}", { 角色: "能天使" })).toBe("能天使{汪汪}");
    // a value is never read again for blanks
    expect(fmt("{a}{b}", { a: "{b}", b: "!" })).toBe("{b}!");
    expect(fmt("{n} 只", { n: 1.5 })).toBe(`${1.5} 只`);
  });

  it("fills a sentence shown as JSX text in pieces, each value a text node of its own", () => {
    const text = "全球 {total} 只 · 不算克隆体 {players} 位";
    const params = { total: "5,011", players: "5,007" };
    expect(fmtParts(text, params)).toEqual(["全球 ", "5,011", " 只 · 不算克隆体 ", "5,007", " 位"]);
    expect(fmtParts(text, params).join("")).toBe(fmt(text, params));
    expect(fmtParts("不算克隆体 {players}", { players: "9.1 万位" })).toEqual(["不算克隆体 ", "9.1 万位"]);
    expect(fmtParts("{a}和{b}", { a: "x" })).toEqual(["x", "和{b}"]);
    expect(fmtParts("{a}{b}", { a: "", b: 2 })).toEqual(["2"]);
  });

  it("fills a sentence with elements in its blanks as JSX did: the same children, so the same page", () => {
    const pick = h("select", { "aria-label": "称呼" }, h("option", null, "博士"));
    // <p>我是{pick}的{n}，{false}{null}</p>, written out as JSX writes it
    const jsx = h("p", null, "我是", pick, "的", 3, "，", false, null);
    const ours = h("p", null, fmtNodes("我是{a}的{n}，{gone}{none}", { a: pick, n: 3, gone: false, none: null }));
    // server rendering marks where each text node ends, as the browser then has them
    expect(renderToString(ours)).toBe(renderToString(jsx));
    expect(renderToString(ours)).toBe('<p>我是<select aria-label="称呼"><option>博士</option></select>的<!-- -->3<!-- -->，</p>');
    const lines = ["a", "b"].map((l) => h("span", { key: l }, l));
    expect(renderToString(h(Fragment, null, fmtNodes("「{first}{rest}」", { first: "x", rest: lines })))).toBe(
      renderToString(h(Fragment, null, "「", "x", lines, "」")),
    );
  });

  it("picks English's plural in a blank by its value, # standing for it; Chinese never writes one", () => {
    expect(fmt("{n} {n|roach|roaches}", { n: 1 })).toBe("1 roach");
    expect(fmt("{n} {n|roach|roaches}", { n: 0 })).toBe("0 roaches");
    expect(fmt("{n|# day|# days} left", { n: 2 })).toBe("2 days left");
    expect(fmt("{n|# roach}", { n: 3 })).toBe("3 roach");
    expect(fmt("{who|x|y}", {})).toBe("{who|x|y}");
    expect(fmtParts("in {n|# day|# days}!", { n: 1 })).toEqual(["in ", "1 day", "!"]);
    expect(renderToString(h("p", null, fmtNodes("{n|# roach|# roaches} by {who}", { n: 5, who: h("b", null, "Amiya") })))).toBe(
      "<p>5 roaches<!-- --> by <b>Amiya</b></p>",
    );
    // a count shown in an element picks its form by the number given for it
    const num = (n: string) => h("span", { className: "num" }, n);
    expect(renderToString(h("p", null, fmtNodes("{n} {n|Doctor|Doctors} here", { n: num("1") }, { n: "1" })))).toBe(
      '<p><span class="num">1</span> Doctor here</p>',
    );
    expect(renderToString(h("p", null, fmtNodes("{n} {n|Doctor|Doctors} here", { n: num("1,234") }, { n: "1,234" })))).toBe(
      '<p><span class="num">1,234</span> Doctors here</p>',
    );
    expect(renderToString(h("p", null, fmtNodes("这片地图里有 {n} 只舟P", { n: num("1") }, { n: "1" })))).toBe(
      '<p>这片地图里有 <span class="num">1</span> 只舟P</p>',
    );
    const bars: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string") for (const m of v.matchAll(/\{([^{}]+)\}/g)) if (m[1].includes("|")) bars.push(at);
      if (typeof v === "object" && v !== null) for (const [k, w] of Object.entries(v)) walk(w, `${at}.${k}`);
    };
    walk(zh, "zh");
    expect(bars).toEqual([]);
  });

  it("picks the form for a count", () => {
    const roaches = { one: "{n} roach", other: "{n} roaches" };
    expect(count(roaches, 1)).toBe("1 roach");
    expect(count(roaches, 2)).toBe("2 roaches");
    expect(count({ other: "{n} 只" }, 1)).toBe("1 只");
    expect(count("{n} 只，{who}", 3, { who: "我" })).toBe("3 只，我");
  });

  it("tells counts from groups", () => {
    expect(isCounted({ other: "x" })).toBe(true);
    expect(isCounted({ one: "x", other: "y" })).toBe(true);
    expect(isCounted({ other: "x", title: "y" })).toBe(false);
    expect(isCounted(["x"])).toBe(false);
  });
});

describe("the dictionaries", () => {
  it("fall back to Chinese for what English lacks, keeping only Chinese's names", () => {
    const base: { a: { b: string; c: string }; d: readonly [string, string]; e: Counted } = {
      a: { b: "一", c: "二" },
      d: ["三", "四"],
      e: { other: "{n} 只" },
    };
    const merged = fill(base, { a: { b: "one" }, e: { one: "{n} roach", other: "{n} roaches" } });
    expect(merged).toEqual({ a: { b: "one", c: "二" }, d: ["三", "四"], e: { one: "{n} roach", other: "{n} roaches" } });
    expect(missing(base, { a: { b: "one" } })).toEqual(["a.c", "d", "e"]);
  });

  it("use { one, other } only for counts", () => {
    const walk = (v: unknown, at: string) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return;
      if ("other" in v || "one" in v) expect(isCounted(v), at).toBe(true);
      else for (const [k, w] of Object.entries(v)) walk(w, `${at}.${k}`);
    };
    walk(zh, "zh");
    walk(en, "en");
  });

  it("give English lists of lines as long as the Chinese ones, as lines are stored by number", () => {
    const walk = (z: unknown, e: unknown, at: string) => {
      if (e === undefined) return;
      if (Array.isArray(z)) expect((e as unknown[]).length, at).toBe(z.length);
      else if (typeof z === "object" && z !== null) for (const [k, v] of Object.entries(z)) walk(v, (e as Record<string, unknown>)[k], `${at}.${k}`);
    };
    walk(zh, en, "en");
  });

  it("list the English still to write: a line added in Chinese shows in Chinese on /en until then", () => {
    const left = missing(zh, en);
    if (left.length) console.info(`English still to write: ${left.length}\n  ${left.slice(0, 20).join("\n  ")}${left.length > 20 ? "\n  …" : ""}`);
    expect(Array.isArray(left)).toBe(true);
  });

  it("give English the blanks Chinese has, by the same names, but where the code fills others in for it", () => {
    // what the code passes for English alone: a count for a plural, or thousands where Chinese counts in 万
    const english: Record<string, { adds?: string[]; drops?: string[] }> = {
      "radar.from": { adds: ["n"] },
      "help.rows.gave": { adds: ["n"] },
      "lib.help.clueNumbers": { adds: ["n"] },
      "map.view.tenThousands": { adds: ["thousands"], drops: ["count"] },
      "lib.counts.tenThousands": { adds: ["thousands"], drops: ["measure", "n"] },
    };
    const names = (text: string) => [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].split("|", 1)[0]))].sort();
    const odd: string[] = [];
    const walk = (z: unknown, e: unknown, at: string) => {
      if (e === undefined) return;
      if (typeof z === "string") {
        const want = names(z).filter((n) => !english[at]?.drops?.includes(n));
        const got = names(e as string).filter((n) => !english[at]?.adds?.includes(n));
        if (want.join() !== got.join()) odd.push(`${at}: ${want.join()} → ${got.join()}`);
      } else if (typeof z === "object" && z !== null) for (const [k, v] of Object.entries(z)) walk(v, (e as Record<string, unknown>)[k], at ? `${at}.${k}` : k);
    };
    walk(zh, en, "");
    expect(odd).toEqual([]);
    for (const at of Object.keys(english)) expect(at.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en), at).toBeTypeOf("string");
  });

  it("write English in English: Chinese only in its blanks' names, in names, poems and pictures kept as they are", () => {
    const kept = new Set([
      "server.privacy.operator",
      "server.privacy.images.text",
      "cards.amiya.credit",
      "cards.own.partyNote",
      "notices.log.about",
      "pamphlet.art.siSeal",
      "lib.minghe.stations.s2.line",
      "lib.minghe.stations.s6.line",
      // the kaomoji |ω・）
      "map.place.placed",
      "map.place.clonePlaced",
    ]);
    const chinese: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === "string") {
        if (/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/.test(v.replace(/\{[^{}]+\}/g, "")) && !kept.has(at)) chinese.push(`${at}: ${v}`);
      } else if (typeof v === "object" && v !== null && at !== "names") for (const [k, w] of Object.entries(v)) walk(w, at ? `${at}.${k}` : k);
    };
    walk(en, "");
    expect(chinese).toEqual([]);
  });

  it("show stored codes in English through maps zh.ts leaves empty, taken whole", () => {
    expect(fill({ names: { m: {} as Record<string, string> } }, { names: { m: { 甲: "A" } } })).toEqual({ names: { m: { 甲: "A" } } });
    for (const [group, map] of Object.entries(zh.names)) expect(Object.keys(map), group).toEqual([]);
    const names = en.names as unknown as Record<string, Record<string, string>>;
    // every code an English page can show has its English
    expect(Object.keys(names.titles).sort()).toEqual([...SELF_TITLES].sort());
    expect(Object.keys(names.foods).sort()).toEqual([...FOODS].sort());
    expect(Object.keys(names.spouses).sort()).toEqual([...SPOUSES].sort());
    expect(Object.keys(names.stamps).sort()).toEqual([...new Set(STAMPS)].sort());
    for (const g of ["arknights", "endfield"] as const) expect(CHARACTERS[g].filter((c) => !names.characters[c]), g).toEqual([]);
  });
});

describe("the language of a page or ask", () => {
  it("is Chinese unless marked English: zhoupmap.com is always Chinese, English lives under /en", () => {
    expect(langOfMark("en")).toBe("en");
    for (const mark of ["zh", "EN", "en-US", "", null, undefined]) expect(langOfMark(mark)).toBe("zh");
    expect(isEnglishPath("/en")).toBe(true);
    expect(isEnglishPath("/en/privacy")).toBe(true);
    expect(isEnglishPath("/english")).toBe(false);
    expect(isEnglishPath("/")).toBe(false);
  });

  it("keeps a link on the site in the page's language", () => {
    for (const p of ["/", "/privacy", "/privacy#abroad", "/?x=1"]) expect(pathIn(p, "zh")).toBe(p);
    expect(pathIn("/", "en")).toBe("/en");
    expect(pathIn("/privacy", "en")).toBe("/en/privacy");
    expect(pathIn("/privacy#contact", "en")).toBe("/en/privacy#contact");
    expect(pathIn("/#x", "en")).toBe("/en#x");
    expect(localPath("/privacy")).toBe("/privacy");
    withLang("en", () => expect(localPath("/privacy")).toBe("/en/privacy"));
  });

  it("gives /en a manifest of its own, named by each English page", () => {
    expect(EN_MANIFEST).toBe("/en/app.webmanifest");
    expect(existsSync("src/app/en/app.webmanifest/route.ts")).toBe(true);
    // a manifest.* there is one Next takes for the site's own
    expect(readdirSync("src/app/en").filter((f) => f.startsWith("manifest."))).toEqual([]);
    // Next links the site's manifest over a layout's, so each page names it (the build checks the rest)
    for (const page of ["src/app/en/page.tsx", "src/app/en/privacy/page.tsx"]) expect(readFileSync(page, "utf8")).toContain("manifest: EN_MANIFEST");
  });

  it("answers an ask in English only when the English page marks it so, and not at all with ENGLISH=off", () => {
    const ask = (headers: Record<string, string>) => new Request("https://zhoupmap.com/api/x", { headers });
    expect(requestLang(ask({}))).toBe("zh");
    expect(requestLang(ask({ "accept-language": "en-US,en;q=0.9", cookie: "lang=en" }))).toBe("zh");
    expect(requestLang(ask({ [LANG_HEADER]: "en" }))).toBe("en");
    process.env.ENGLISH = "off";
    try {
      expect(requestLang(ask({ [LANG_HEADER]: "en" }))).toBe("zh");
      withLang("en", () => expect(lang()).toBe("zh"));
    } finally {
      delete process.env.ENGLISH;
    }
  });

  it("reads the page's mark the way Next keeps its request, without making the page one made for each visit", async () => {
    // what Next's headers() reads; a page built ahead of time has no such request, and is Chinese
    const request = (mark?: string) =>
      ({ type: "request", headers: new Headers(mark ? { [LANG_HEADER]: mark } : {}) }) as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];
    expect(workUnitAsyncStorage.run(request("en"), () => [lang(), T.map.loading])).toEqual(["en", wordsOf("en").map.loading]);
    expect(workUnitAsyncStorage.run(request(), () => lang())).toBe("zh");
    expect(workUnitAsyncStorage.run({ type: "prerender" } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0], () => lang())).toBe("zh");
    // what a handler says through withLang goes first
    expect(workUnitAsyncStorage.run(request("en"), () => withLang("zh", () => lang()))).toBe("zh");
    expect(await workUnitAsyncStorage.run(request("en"), () => pageLang())).toBe("en");
  });
});

describe("T", () => {
  it("is Chinese outside any request, and the request's language inside one", async () => {
    expect(lang()).toBe("zh");
    expect(T.map.loading).toBe(zh.map.loading);
    await withLang("en", async () => {
      await Promise.resolve();
      expect(lang()).toBe("en");
      expect(T.map.loading).toBe(wordsOf("en").map.loading);
    });
    expect(lang()).toBe("zh");
  });

  it("is the request's language whichever copy of src/i18n/server.ts set it", async () => {
    // Next bundles a module once per layer and route, so a server holds several copies of it
    const another = "./server.ts?another-copy";
    const copy = (await import(/* @vite-ignore */ another)) as typeof import("./server");
    expect(copy.withLang).not.toBe(withLang);
    await copy.withLang("en", async () => expect(lang()).toBe("en"));
    await withLang("en", async () => expect(lang()).toBe("en"));
    expect(lang()).toBe("zh");
  });

  it("reads like the dictionary itself", () => {
    expect(Object.keys(T)).toEqual(Object.keys(zh));
    expect("map" in T).toBe(true);
    expect({ ...T.map }).toEqual(zh.map);
  });

  it("shows stored codes as they are in Chinese, and in English on an English page", () => {
    const shown = () => [characterName("能天使"), characterName("明河"), characterName("没这个人"), titleName("猫"), foodName("脚夹馍"), spouseName("老婆"), stampName("下不为例")];
    expect(shown()).toEqual(["能天使", "明河", "没这个人", "猫", "脚夹馍", "老婆", "下不为例"]);
    withLang("en", () => expect(shown()).toEqual(["Exusiai", "Argent Flow", "没这个人", "cat", "foot-wich", "waifu", "下不为例 (Just this once)"]));
    expect(nameMatches("能天使", "exu")).toBe(false);
    withLang("en", () => expect(nameMatches("能天使", "exu")).toBe(true));
  });

  it("runs sentences together in Chinese, and with a space in English", () => {
    expect(sentences("好。", "", "走吧！")).toBe("好。走吧！");
    withLang("en", () => expect(sentences("Fine.", "", "Let's go!")).toBe("Fine. Let's go!"));
  });

  it("counts roaches in 万 with their measure word in Chinese, in thousands without one in English", () => {
    expect([countText(9_999), countText(62_345), countText(91_000, "位")]).toEqual(["9,999 只", "6.2 万只", "9.1 万位"]);
    withLang("en", () => expect([countText(9_999), countText(62_345), countText(91_000, "位")]).toEqual(["9,999", "62.3k", "91k"]));
  });
});

describe("a page's words", () => {
  it("are one script per language, named by a hash of what it holds", () => {
    for (const l of LANGS) {
      const { body, hash } = wordsScript(l);
      const prefix = "self.__ZP_I18N=";
      expect(body.startsWith(prefix)).toBe(true);
      const parsed = JSON.parse(body.slice(prefix.length).replace(/;$/, "")) as { lang: string; t: Messages };
      expect(parsed.lang).toBe(l);
      expect(parsed.t.map).toEqual(wordsOf(l).map);
      expect(wordsUrl(l)).toBe(`/i18n/${l}-${hash}.js`);
      expect(wordsFile(`${l}-${hash}.js`)).toEqual({ lang: l, current: true });
      expect(wordsFile(`${l}-000000000000.js`)).toEqual({ lang: l, current: false });
    }
    expect(wordsFile("fr-000000000000.js")).toBe(null);
    expect(wordsFile("zh-abc.js")).toBe(null);
  });
});

/** Files whose words have been moved into the dictionaries: no Chinese may be written in them again (a folder ends in /) */
const MOVED: string[] = [
  // B1: what the server says
  "src/app/api/",
  "src/lib/consent.ts",
  "src/lib/server/account.ts",
  "src/lib/server/amiya.ts",
  "src/lib/server/consent.ts",
  "src/lib/server/deskCodes.ts",
  "src/lib/server/geo.ts",
  "src/lib/server/guides.ts",
  "src/lib/server/help.ts",
  "src/lib/server/http.ts",
  "src/lib/server/loginCodes.ts",
  "src/lib/server/mail.ts",
  "src/lib/server/minghe.ts",
  "src/lib/server/nameWords.ts",
  "src/lib/server/passwordHash.ts",
  "src/lib/server/passwords.ts",
  "src/lib/server/perlica.ts",
  "src/lib/server/si.ts",
  "src/lib/server/talulah.ts",
  "src/lib/world/server.ts",
  // B2: the map page
  "src/components/MapApp.tsx",
  "src/components/map/",
  // B3: the panels on it
  "src/components/app/",
  // B4: what the rest of src/lib says, and the pages' own words
  "src/lib/",
  "src/app/layout.tsx",
  "src/app/manifest.ts",
  "src/app/privacy/",
];

/** The Chinese code decides by, where it must: what it compares, looks for or names a property with */
const DECIDED_BY = new Set([
  // 高德's own error message: its words, not ours
  "src/components/map/report.ts KEY异常",
  // a reply's blanks, and the title (a code, as stored) that barks 喵～ instead
  "src/lib/declarations.ts {角色}",
  "src/lib/declarations.ts {游戏}",
  "src/lib/declarations.ts {名字}",
  "src/lib/declarations.ts {称呼}",
  "src/lib/declarations.ts {汪汪}",
  "src/lib/declarations.ts 猫",
  // characters' names (codes, as stored) with the nicknames players search them by
  "src/lib/operators.ts 祀",
  "src/lib/operators.ts 塔露拉",
  // 「1.04 吨 的思念」 is said 「1.04 吨的思念」: no space after 吨, as there is after kg
  "src/lib/perlica.ts 吨 ",
  // the change log's vague row (its rows are only in Chinese, src/lib/changelog.ts), greyed and folded like 后台调整
  "src/lib/changelogView.ts 一些小改动",
  // the stored codes (Chinese, as stored) that English pages show in English: en.ts's names, looked up by them
  ...Object.values(en.names ?? {}).flatMap((map) => Object.keys(map ?? {}).map((code) => `src/i18n/en.ts ${code}`)),
]);

/** Chinese that stays in a file whose words have moved, as a code another function takes or a picture, not words */
const CODES = new Set([
  // the measure word countText (src/lib/counts.ts) counts players with
  "src/components/MapApp.tsx 位",
  // the seal stamped on 祀掌柜's pictures, drawn on a canvas
  "src/components/app/SiBook.tsx 祀",
  // the measure word countText counts roaches with, unless it is given 位
  "src/lib/counts.ts 只",
  // what a declaration stores and is shown by: the foods of 我想吃<角色>的<食物>, 老婆/老公 of 氪了168
  ...[...FOODS, ...SPOUSES].map((w) => `src/lib/declarations.ts ${w}`),
  // the self-titles of 我是<角色>的<称呼>, stored as they are
  ...SELF_TITLES.map((w) => `src/lib/titles.ts ${w}`),
  // the nicknames players type to find a character
  ...Object.values(NICKNAMES).flatMap((ns) => ns.map((n) => `src/lib/operators.ts ${n}`)),
  // what the 戳一戳, 啵 and 嗒 pictures say, drawn in them
  "src/lib/flipArt.ts 戳!",
  "src/lib/touchArt.ts 啵!",
  "src/lib/touchArt.ts 嗒",
  // what a 公告's author writes on a line of its own where the QQ group's QR code goes
  "src/lib/noticeText.ts 【Q群二维码】",
  // what that 「吨 」 becomes
  "src/lib/perlica.ts 吨",
  // 祀掌柜's seals, in her seal font (scripts/si-seal-font.py reads them from src/lib/si.ts)
  ...STAMPS.map((w) => `src/lib/si.ts ${w}`),
  // what is written on her portraits, in that font: 「<name>小像」 (管理员 for the nameless) and the day in Chinese numerals
  "src/lib/si.ts {0}小像",
  "src/lib/si.ts 管理员",
  "src/lib/si.ts 〇一二三四五六七八九",
  "src/lib/si.ts {0}十{1}",
  "src/lib/si.ts {0}年{1}月{2}日",
  // her family and herself as players' 厨力 lists have them (characters' names, as stored)
  ...["年", "夕", "令", "重岳", "黍", "余", "望", "祀"].map((w) => `src/lib/si.ts ${w}`),
  // her seal's character, drawn on her scroll paintings
  "src/lib/siArt.ts 祀",
]);

/**
 * Where a pattern matches what people type, whatever the page's language: full-width dashes in a 登录码,
 * 。 for a dot and contact details in a name, the Chinese punctuation that ends a bare address in a 公告
 */
const TYPED = new Set(["src/lib/deskCode.ts", "src/lib/nameCheck.ts", "src/lib/nameRules.ts", "src/lib/noticeText.ts"]);

describe("the code", () => {
  it("writes no Chinese of its own where the words have been moved (they go into src/i18n/zh.ts)", () => {
    const left = scanTree(ROOT).filter(
      (h) =>
        !h.kept &&
        MOVED.some((m) => (m.endsWith("/") ? h.file.startsWith(m) : h.file === m)) &&
        !(h.logic && DECIDED_BY.has(`${h.file} ${h.text}`)) &&
        !(h.kind === "regex" && TYPED.has(h.file)) &&
        !CODES.has(`${h.file} ${h.text}`),
    );
    expect(left.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  it("decides nothing by Chinese words but the places that must", () => {
    const found = scanTree(ROOT)
      .filter((h) => !h.kept && h.logic && !(h.kind === "regex" && TYPED.has(h.file)))
      .map((h) => `${h.file} ${h.text}`);
    expect(found.filter((f) => !DECIDED_BY.has(f))).toEqual([]);
  });

  it("never reads T at the top of a module, which a server shares between languages", () => {
    const bad: string[] = [];
    for (const file of sourceFiles(ROOT)) {
      if (file.startsWith("src/i18n/")) continue;
      const source = readFileSync(`${ROOT}/${file}`, "utf8");
      if (!/\bT\.|\bT\[/.test(source)) continue;
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node, inFunction: boolean) => {
        const fn =
          inFunction ||
          ts.isFunctionLike(node) ||
          // a class's own fields are read when one is made, not when the module loads
          (ts.isPropertyDeclaration(node) && !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword));
        if (!fn && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === "T")
          bad.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
        ts.forEachChild(node, (c) => visit(c, fn));
      };
      visit(sf, false);
    }
    expect(bad).toEqual([]);
  });

  it("reads the server's own words (T.server, which pages never download) only on the server", () => {
    expect(SERVER_ONLY).toContain("server");
    const onServer = (f: string) =>
      f.startsWith("src/lib/server/") ||
      f.startsWith("src/app/api/") ||
      // what only the server makes: the privacy page, every page's head, the app's manifest
      ["src/app/privacy/page.tsx", "src/app/layout.tsx", "src/app/manifest.ts"].includes(f);
    const read = (f: string) => readFileSync(`${ROOT}/${f}`, "utf8");
    const files = sourceFiles(ROOT).filter((f) => !f.startsWith("src/i18n/"));
    expect(files.filter((f) => !onServer(f) && /\bT\.server\b/.test(read(f)))).toEqual([]);
    // nor does a page's own code take anything from there
    expect(files.filter((f) => /^["']use client["']/m.test(read(f)) && /from ["']@\/lib\/server\//.test(read(f)))).toEqual([]);
  });

  it("is scanned the way React shows it", () => {
    const hits = scanSource(
      "x.tsx",
      'const a = <p title="标题">\n  你好，\n  世界 {name}！\n</p>;\nconst b = `第 ${n} 次`;\nimport "./中文";\nconsole.log("日志");',
    );
    expect(hits.map((h) => [h.kind, h.text, h.kept])).toEqual([
      ["jsx-attr", "标题", null],
      ["jsx-text", "你好， 世界 ", null],
      ["jsx-text", "！", null],
      ["template", "第 {0} 次", null],
      ["string", "日志", "console"],
    ]);
  });
});
