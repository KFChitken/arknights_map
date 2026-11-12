import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scanSource, scanTree, sourceFiles } from "../../scripts/i18n/scan.mts";
import { count, type Counted, fill, fmt, isCounted, LANGS, missing, type Messages } from "./core";
import { en } from "./en";
import { lang, T } from "./index";
import { firstLanguage, pickLang } from "./lang";
import { wordsFile, wordsOf, wordsScript, wordsUrl, withLang } from "./server";
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

  it("list the English still to write (not a failure until English is offered)", () => {
    const left = missing(zh, en);
    if (left.length) console.info(`English still to write: ${left.length}\n  ${left.slice(0, 20).join("\n  ")}${left.length > 20 ? "\n  …" : ""}`);
    expect(Array.isArray(left)).toBe(true);
  });
});

describe("the language of a visitor", () => {
  const visitor = { cookie: undefined, acceptLanguage: "en-US,en;q=0.9", signedIn: false, mainland: false };

  it("follows the cookie first", () => {
    expect(pickLang({ ...visitor, cookie: "zh" })).toBe("zh");
    expect(pickLang({ ...visitor, cookie: "en", signedIn: true, mainland: true })).toBe("en");
    expect(pickLang({ ...visitor, cookie: "fr" })).toBe("en");
  });

  it("keeps signed-in players and visitors from mainland China in Chinese, whatever the phone says", () => {
    expect(pickLang({ ...visitor, signedIn: true })).toBe("zh");
    expect(pickLang({ ...visitor, mainland: true })).toBe("zh");
  });

  it("otherwise goes by the language the browser wants most", () => {
    expect(pickLang(visitor)).toBe("en");
    expect(pickLang({ ...visitor, acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8" })).toBe("zh");
    expect(pickLang({ ...visitor, acceptLanguage: "zh" })).toBe("zh");
    expect(pickLang({ ...visitor, acceptLanguage: "ja-JP,zh-CN;q=0.5" })).toBe("en");
    expect(pickLang({ ...visitor, acceptLanguage: "en;q=0.5,zh-CN" })).toBe("zh");
    expect(pickLang({ ...visitor, acceptLanguage: "zhx" })).toBe("en");
    expect(pickLang({ ...visitor, acceptLanguage: null })).toBe("zh");
    expect(pickLang({ ...visitor, acceptLanguage: "" })).toBe("zh");
  });

  it("reads Accept-Language by weight, the first of equal weight winning", () => {
    expect(firstLanguage("en-US,en;q=0.9,zh;q=0.8")).toBe("en-us");
    expect(firstLanguage("fr;q=0.3, de;q=0.7, *;q=0.9")).toBe("de");
    expect(firstLanguage("fr, de")).toBe("fr");
    expect(firstLanguage("fr;q=0, de;q=x")).toBe(null);
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

/** Files whose words have been moved into the dictionaries: no Chinese may be written in them again */
const MOVED: string[] = [];

describe("the code", () => {
  it("writes no Chinese of its own where the words have been moved (they go into src/i18n/zh.ts)", () => {
    const left = scanTree(ROOT).filter((h) => !h.kept && MOVED.some((m) => (m.endsWith("/") ? h.file.startsWith(m) : h.file === m)));
    expect(left.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  it("decides nothing by Chinese words but the places that must", () => {
    const known = new Set([
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
      // 「1.04 吨的思念」: no space after 吨 (moves with 佩丽卡监督's words)
      "src/lib/perlica.ts 吨 ",
    ]);
    // what players type, whatever the page's language: full-width dashes in a 登录码, 。 for a dot and contact details in a name
    const typed = new Set(["src/lib/deskCode.ts", "src/lib/nameCheck.ts", "src/lib/nameRules.ts"]);
    const found = scanTree(ROOT)
      .filter((h) => !h.kept && h.logic && !(h.kind === "regex" && typed.has(h.file)))
      .map((h) => `${h.file} ${h.text}`);
    expect(found.filter((f) => !known.has(f))).toEqual([]);
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
