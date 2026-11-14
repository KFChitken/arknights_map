import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
const BOOKLET = "components/app/Pamphlet.tsx";

/** s cut at each sep that is outside any brackets */
function splitTop(s: string, sep: RegExp): string[] {
  const parts = [""];
  let depth = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && sep.test(ch)) parts.push("");
    else parts[parts.length - 1] += ch;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** The selectors of a stylesheet's rules, those inside @media and the like too, not @keyframes' steps */
function selectors(css: string): string[] {
  const found: string[] = [];
  const open: string[] = [];
  let text = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      const head = text.trim();
      if (!head.startsWith("@") && !open.some((h) => /^@(-\w+-)?keyframes/.test(h))) found.push(...splitTop(head, /,/));
      open.push(head);
      text = "";
    } else if (ch === "}") {
      open.pop();
      text = "";
    } else if (ch === ";") text = "";
    else text += ch;
  }
  return found;
}

/**
 * The classes a selector begins at: those of its first part that asks for one (`.pp-wide .pp-x`, `:lang(en)
 * .pp-stamp` and `:where(.pamphlet) button` begin at pp-wide, pp-stamp and pamphlet). What it matches is that class's
 * element or inside it; none, and it matches anywhere.
 */
function entryClasses(selector: string): string[] {
  for (const part of splitTop(selector, /[\s>+~]/)) {
    const asked = part.replace(/:(not|has)\([^)]*\)/g, "");
    const classes = [...asked.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    if (classes.length) return classes;
  }
  return [];
}

/** The class names a source file puts on elements: in className, in class="…" of the HTML it writes, in classList */
function classesPut(source: string): Set<string> {
  const places: string[] = [];
  for (const m of source.matchAll(/className\s*=\s*/g)) {
    const from = m.index + m[0].length;
    const quoted = /^(["'`])(?:(?!\1)[^\\]|\\.)*\1/.exec(source.slice(from));
    if (quoted) places.push(quoted[0]);
    else if (source[from] === "{") {
      let depth = 0;
      let to = from;
      for (; to < source.length; to++) {
        if (source[to] === "{") depth++;
        else if (source[to] === "}" && --depth === 0) break;
      }
      places.push(source.slice(from, to + 1));
    } else places.push(source.slice(from, source.indexOf("\n", from)));
  }
  for (const m of source.matchAll(/\bclass=\\?(["'])([^"'\\]*)/g)) places.push(`"${m[2]}"`);
  for (const m of source.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g)) places.push(m[1]);
  const names = new Set<string>();
  const add = (text: string) => text.split(/\s+/).forEach((w) => /^-?[_a-zA-Z][\w-]*$/.test(w) && names.add(w));
  for (const place of places) {
    // what is quoted, in a template's ${…} too, and a template's own words
    for (const m of place.matchAll(/"([^"]*)"|'([^']*)'/g)) add(m[1] ?? m[2]);
    for (const m of place.matchAll(/`([^`]*)`/g)) add(m[1].replace(/\$\{[^}]*\}/g, " "));
  }
  return names;
}

/** For each class some other part of the site puts on an element, the files that do */
function classesOutside(booklet: string): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const file of readdirSync(SRC, { recursive: true }) as string[]) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file) || file === booklet) continue;
    for (const name of classesPut(read(file))) by.set(name, [...(by.get(name) ?? []), file]);
  }
  return by;
}

/**
 * 最近更新's stylesheet comes with the booklet: it is on the page from the first time the booklet opens (by itself on
 * a first visit, or from 公告) until the page is left, the booklet closed or not. A rule of it that matched something
 * outside the booklet changed that from then on: its picture paper `.pa`, a 330 × 220 sheet, lay over 抽屉's row of
 * buttons on a computer, also `.pa`, and its `.pp-x` reached the ✕ of the pass popped up from a profile card.
 */
describe("最近更新's stylesheet", () => {
  const outside = classesOutside(BOOKLET);
  const sheet = selectors(read("components/app/pamphlet.css"));

  it("is read whole, and so are the classes the rest of the site puts on elements", () => {
    expect(sheet.length).toBeGreaterThan(200);
    expect(sheet).toContain(".pp-art");
    expect(sheet).toContain(":where(.pamphlet) .pp-x");
    expect(sheet).toContain(".pp-l-pic.cover");
    expect(entryClasses(".pp-wide .pp-x svg")).toEqual(["pp-wide"]);
    expect(entryClasses(":lang(en) .pp-stamp")).toEqual(["pp-stamp"]);
    expect(entryClasses(":where(.pamphlet) button")).toEqual(["pamphlet"]);
    expect(entryClasses(".pp-arrow.next:disabled")).toEqual(["pp-arrow", "next"]);
    expect(entryClasses("button:not(.pp-x)")).toEqual([]);
    const written = [
      `<div className={\`th\${on ? " on" : ""}\`} aria-label="x-label"><b className={big ? "big" : undefined} /></div>`,
      `el.className = \`rep-ring\${was ? " was" : ""}\`;`,
      `const g = '<g class="em-warn"><path class="em-ring" d="M0 0"/></g>';`,
      `el.classList.add("lit");`,
    ].join("\n");
    expect([...classesPut(written)].sort()).toEqual(["big", "em-ring", "em-warn", "lit", "on", "rep-ring", "th", "was"]);
    // what the booklet's rules reached before
    expect(outside.get("pa")).toContain("components/app/chrome/DrawerChrome.tsx");
    expect(outside.get("pp-x")).toContain("components/app/passes/ProfilePass.tsx");
  });

  it("reaches nothing outside the booklet: each rule begins at a class no other part of the site uses", () => {
    const reaching = sheet
      .filter((s) => !entryClasses(s).some((c) => !outside.has(c)))
      .map((s) => `${s} (${entryClasses(s).map((c) => `${c}: ${outside.get(c)?.join(", ")}`).join("; ") || "no class"})`);
    expect(reaching).toEqual([]);
  });
});
